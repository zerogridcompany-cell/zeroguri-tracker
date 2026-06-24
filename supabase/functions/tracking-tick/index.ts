// tracking-tick — コスト最適化エンジン本体（pg_cron / service_role が10分毎に起動）
// verify_jwt=false。docs/architecture.md §5 の state machine + backoff を実装。
// 無審査ルート対応: 取得は youtube=APIキー / instagram=Business Discovery(handle) / tiktok=本人OAuth(token)。
// billing-integrity: peak_views 追跡 + 再生数減少(drop)/急増(spike) を anomaly_flag で検知。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { config } from "../_shared/env.ts";
import { admin, decryptAccountToken, type LinkedAccountRow, persistAccountToken } from "../_shared/supabase.ts";
import { getProvider } from "../_shared/providers/index.ts";
import type { Platform, Token } from "../_shared/providers/types.ts";

type Interval = "1 day" | "3 days" | "7 days";

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function intervalMs(interval: Interval): number {
  switch (interval) {
    case "1 day":
      return DAY_MS;
    case "3 days":
      return 3 * DAY_MS;
    case "7 days":
      return 7 * DAY_MS;
  }
}

interface TrackedVideoRow {
  id: string;
  platform: Platform;
  linked_account_id: string;
  content_id: string;
  cap: number;
  baseline_views: number;
  last_views: number;
  peak_views: number;
  stall_count: number;
  error_count: number;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const limit = config.batchLimit();

    // 1. due な active 動画を claim（部分インデックス + FOR UPDATE SKIP LOCKED）。
    const { data: due, error: claimErr } = await admin().rpc("claim_due_tracked_videos", { p_limit: limit });
    if (claimErr) return error(claimErr.message, 500);
    const videos = (due ?? []) as TrackedVideoRow[];
    if (!videos.length) return json({ claimed: 0 });

    // 2. linked_account 単位にグルーピング。
    const byAccount = new Map<string, TrackedVideoRow[]>();
    for (const v of videos) {
      const arr = byAccount.get(v.linked_account_id) ?? [];
      arr.push(v);
      byAccount.set(v.linked_account_id, arr);
    }

    const ids = [...byAccount.keys()];
    const { data: accounts } = await admin()
      .from("linked_accounts")
      .select("id, user_id, platform, platform_user_id, handle, access_token_enc, refresh_token_enc, token_expires_at, status")
      .in("id", ids);
    const accMap = new Map<string, LinkedAccountRow>();
    for (const a of accounts ?? []) accMap.set(a.id, a as LinkedAccountRow);

    let updated = 0;
    let retired = 0;
    let flagged = 0;

    for (const [accId, group] of byAccount) {
      const accRow = accMap.get(accId);
      if (!accRow) continue;
      const provider = getProvider(accRow.platform);

      // 3. oauth モード（tiktok）のみトークンを復号。期限間近なら refresh して永続化。
      //    challenge モード（youtube=APIキー / instagram=Business Discovery）はトークン不要。
      let token: Token | undefined;
      if (provider.linkMode === "oauth") {
        try {
          token = await decryptAccountToken(accRow, "tracking-tick");
          if (token.expiresAt && new Date(token.expiresAt).getTime() < now + REFRESH_SKEW_MS) {
            token = await provider.refresh(token);
            await persistAccountToken(accRow.id, token);
          }
        } catch (e) {
          await admin().from("linked_accounts").update({ status: "error", last_error: String(e) }).eq("id", accRow.id);
          continue;
        }
      }

      // 4. 取得（platform 別の無審査ルート）。
      let views: Map<string, number>;
      try {
        const contentIds = group.map((v) => v.content_id);
        views = await provider.fetchViews({ token, handle: accRow.handle }, contentIds);
      } catch (e) {
        await admin().from("linked_accounts").update({ status: "error", last_error: String(e) }).eq("id", accRow.id);
        continue;
      }

      // 5. 各動画に state machine + billing-integrity を適用。
      for (const v of group) {
        const current = views.get(v.content_id);

        // 取得不能 → error_count を加算。3回連続で動画削除とみなし retire(expired)。
        if (current === undefined) {
          const error_count = v.error_count + 1;
          const upd: Record<string, unknown> = { error_count, last_checked_at: nowIso };
          if (error_count >= 3) {
            upd.status = "retired";
            upd.retired_reason = "expired";
            upd.retired_at = nowIso;
            retired++;
          }
          await admin().from("tracked_videos").update(upd).eq("id", v.id);
          updated++;
          continue;
        }

        const attributable = Math.max(0, current - v.baseline_views);

        // ── billing-integrity ──
        const peak = Math.max(v.peak_views ?? 0, attributable);
        const dropDelta = v.last_views - attributable;
        const riseDelta = attributable - v.last_views;
        let anomaly: "drop" | "spike" | null = null;
        if (dropDelta >= Math.max(100, v.cap * 0.01)) {
          anomaly = "drop"; // 再生数が有意に減少（スパム除去/クローバック）
        } else if (v.last_views > 0 && riseDelta >= v.cap * 0.5) {
          anomaly = "spike"; // 1tickで cap の半分以上急増 = viewbot 疑い
        }

        const upd: Record<string, unknown> = {
          last_views: attributable,
          peak_views: peak,
          anomaly_flag: anomaly,
          last_checked_at: nowIso,
        };
        let didRetire = false;

        if (anomaly === "spike") {
          // 自動 cap-retire / 課金確定を保留し、次tickで再確認（請求は別途レビュー）。
          upd.next_check_at = new Date(now + DAY_MS).toISOString();
          upd.check_interval = "1 day";
          upd.stall_count = 0;
          upd.error_count = 0;
          flagged++;
        } else if (attributable >= v.cap) {
          upd.status = "retired";
          upd.retired_reason = "cap";
          upd.retired_at = nowIso;
          didRetire = true;
        } else {
          const delta = riseDelta;
          let interval: Interval;
          let stall = 0;
          if (delta >= v.cap * 0.05) interval = "1 day";
          else if (delta >= v.cap * 0.01) interval = "3 days";
          else if (delta > 0) interval = "7 days";
          else {
            stall = v.stall_count + 1;
            interval = "7 days";
            if (stall >= 2) {
              upd.status = "retired";
              upd.retired_reason = "stalled";
              upd.retired_at = nowIso;
              didRetire = true;
            }
          }
          if (!didRetire) {
            upd.next_check_at = new Date(now + intervalMs(interval)).toISOString();
            upd.check_interval = interval;
            upd.stall_count = stall;
            upd.error_count = 0;
          }
        }
        if (anomaly === "drop") flagged++;

        await admin().from("tracked_videos").update(upd).eq("id", v.id);
        await admin().from("view_snapshots").insert({
          tracked_video_id: v.id,
          views: attributable,
          raw_views: current,
        });
        if (didRetire) retired++;
        updated++;
      }
    }

    return json({ claimed: videos.length, updated, retired, flagged });
  } catch (e) {
    return error(String(e), 500);
  }
});
