// submission-tick — 提出の通知＆自動承認を確実に処理する内部関数（verify_jwt=false）。
//  - submission_id 指定: その提出（グループ）だけ即処理（DBトリガから提出直後に呼ばれる＝~1-2秒で承認）。
//  - 指定なし: pg_cron から1分毎。取りこぼし（直近30分の未通知 / 直近15分の未承認）を拾うバックアップ。
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin } from "../_shared/supabase.ts";
import { processGroupApproval } from "../_shared/approve-core.ts";

const FN = "https://xapgynzijixztvrucppe.supabase.co/functions/v1";

async function notify(anon: string, submissionId: string) {
  await fetch(`${FN}/discord-notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ submission_id: submissionId, event: "submitted" }),
  });
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const db = admin();
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const body = await req.json().catch(() => ({}));
    const targetId = (body.submission_id as string | undefined)?.trim();

    // ── 即時モード（提出直後・1グループ1回）──
    if (targetId) {
      const { data: s } = await db.from("video_submissions").select("*").eq("id", targetId).maybeSingle();
      if (!s) return json({ ok: true, skipped: "no submission" });
      let notified = 0;
      if (!s.discord_message_id && (s.status as string) === "pending") {
        try { await notify(anon, targetId); notified = 1; } catch { /* best-effort */ }
      }
      let approved = 0;
      const { data: setting } = await db.from("org_settings").select("auto_approve").eq("id", 1).maybeSingle();
      if (setting?.auto_approve) {
        const { data: s2 } = await db.from("video_submissions").select("*").eq("id", targetId).maybeSingle();
        if (s2 && (s2.status as string) === "pending") {
          const r = await processGroupApproval(db, s2, (s2.caption as string | null) ?? "", null);
          if (r.ok) approved = 1;
        }
      }
      return json({ ok: true, targeted: true, notified, approved });
    }

    // ── cronモード（取りこぼし回収）: 承認待ちは全件処理する（窓なし）。溜まったバックログも一掃。
    // 1) 未通知の承認待ちを全部通知（グループは代表1件）
    const { data: pend } = await db.from("video_submissions")
      .select("id, group_id, discord_message_id").eq("status", "pending")
      .order("created_at", { ascending: true }).limit(300);
    let notified = 0;
    const seen = new Set<string>();
    for (const s of (pend ?? [])) {
      if (s.discord_message_id) continue;
      const key = (s.group_id as string | null) ?? (s.id as string);
      if (seen.has(key)) continue;
      seen.add(key);
      try { await notify(anon, s.id as string); notified++; } catch { /* best-effort */ }
    }
    // 2) auto_approve ON なら承認待ちを全件承認
    const { data: setting } = await db.from("org_settings").select("auto_approve").eq("id", 1).maybeSingle();
    let approved = 0;
    if (setting?.auto_approve) {
      const { data: pend2 } = await db.from("video_submissions")
        .select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(300);
      const done = new Set<string>();
      for (const s of (pend2 ?? [])) {
        const key = (s.group_id as string | null) ?? (s.id as string);
        if (done.has(key)) continue;
        done.add(key);
        try { const r = await processGroupApproval(db, s, (s.caption as string | null) ?? "", null); if (r.ok) approved++; } catch { /* retry next cycle */ }
      }
    }
    return json({ ok: true, notified, approved });
  } catch (e) {
    return error(String(e), 500);
  }
});
