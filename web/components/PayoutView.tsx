"use client";

// web/components/PayoutView.tsx — クリエイターの引き出し画面
// 残高 = 稼いだ額(v_user_totals) − 保留中(pending)の引き出しリクエスト。
// 引き出しリクエストすると保留中になり、その額が残高から差し引かれる。
// 保留中はキャンセルでき、キャンセルすると残高に戻る（返金）。

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { formatYen, zeroguriFee, payoutNet, MIN_PAYOUT } from "@/lib/format";

type PayoutStatus = "pending" | "paid" | "rejected";

interface PayoutRequest {
  id: string;
  user_id: string;
  amount: number;
  fee: number;
  status: PayoutStatus;
  requested_at: string;
}

const STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  pending: { label: "保留中", cls: "text-accent" },
  paid: { label: "振込済み", cls: "text-status-completed" },
  rejected: { label: "却下", cls: "text-faint" },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function PayoutView() {
  const [uid, setUid] = useState<string | null>(null);
  // 稼いだ額 = 未払いの差分のみ（v_user_totals は台帳で支払い済み分を差し引いた net）
  const [earned, setEarned] = useState(0);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyCancel, setBusyCancel] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadRequests = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("payout_requests")
      .select("*")
      .order("requested_at", { ascending: false });
    setRequests((data as PayoutRequest[] | null) ?? []);
  }, []);

  const loadEarned = useCallback(async () => {
    if (!supabase) return;
    // v_user_totals は owner 権限で全ユーザー行を返すので、必ず本人で絞る（ダッシュボードと同期）
    const { data: u } = await supabase.auth.getUser();
    const id = u?.user?.id;
    if (!id) return;
    const { data: totals } = await supabase
      .from("v_user_totals")
      .select("billable_amount")
      .eq("user_id", id)
      .maybeSingle();
    setEarned(Number(totals?.billable_amount ?? 0));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!alive) return;
      setUid(userData?.user?.id ?? null);
      await loadEarned();
      await loadRequests();
    })();
    return () => {
      alive = false;
    };
  }, [loadEarned, loadRequests]);

  // 稼いだ額(earned) は既に支払い済み分を差し引いた net。残高 = 稼いだ額 − 保留中。
  const pendingSum = requests.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount, 0);
  const paidSum = requests.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);
  const balance = Math.max(0, earned - pendingSum);
  const fee = zeroguriFee(balance);
  const net = payoutNet(balance);
  const belowMin = balance < MIN_PAYOUT;
  const disabled = busy || belowMin || !uid;

  async function requestPayout() {
    if (!supabase || !uid || disabled) return;
    if (!window.confirm(`${formatYen(net)}（手数料 ${formatYen(fee)} 差引後）を振込リクエストしますか？`)) return;
    setError("");
    setBusy(true);
    try {
      // この創作者の案件を特定（1アカウント=1案件なので通常1つ）。案件削除で履歴もカスケード削除される。
      const { data: vids } = await supabase.from("tracked_videos").select("campaign_id");
      const campaignId =
        [...new Set((vids ?? []).map((v) => v.campaign_id as string).filter(Boolean))][0] ?? null;
      const { error: insErr } = await supabase
        .from("payout_requests")
        .insert({ user_id: uid, amount: balance, fee: zeroguriFee(balance), campaign_id: campaignId });
      if (insErr) {
        setError("リクエストに失敗しました。時間をおいて再度お試しください");
        return;
      }
      await loadRequests();
    } catch {
      setError("リクエストに失敗しました。時間をおいて再度お試しください");
    } finally {
      setBusy(false);
    }
  }

  // 保留中のキャンセル（削除）→ 残高に戻る
  async function cancelRequest(id: string) {
    if (!supabase) return;
    if (!window.confirm("この引き出しリクエストをキャンセルしますか？\n金額は残高に戻ります。")) return;
    setBusyCancel(id);
    try {
      await supabase.from("payout_requests").delete().eq("id", id); // RLS: 本人の pending のみ
      await loadRequests();
    } finally {
      setBusyCancel(null);
    }
  }

  return (
    <div className="space-y-12">
      {/* ===== 残高 ===== */}
      <section>
        <div className="zg-eyebrow-ja">残高</div>
        <div className="zg-hero mt-2">{formatYen(balance)}</div>
        <div className="mt-2 text-[11px] text-faint">
          稼いだ額（未払い分）{formatYen(earned)}
          {pendingSum > 0 && <span className="text-accent"> ・ 保留中 −{formatYen(pendingSum)}</span>}
          {paidSum > 0 && <span> ・ 支払い済み（計上対象外）{formatYen(paidSum)}</span>}
        </div>

        {balance >= MIN_PAYOUT && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[13px] text-mid">
                ゼログリ手数料
                <span className="ml-1 text-[10px] text-faint">残高の8% ＋ ¥330</span>
              </span>
              <span className="font-display text-sm tabular-nums text-mid">−{formatYen(fee)}</span>
            </div>
            <div className="hairline" />
            <div className="flex items-baseline justify-between gap-4 pt-0.5">
              <span className="text-sm text-sumi">受取額</span>
              <span className="font-display text-xl font-semibold tabular-nums text-sumi">
                {formatYen(net)}
              </span>
            </div>
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={requestPayout}
            disabled={disabled}
            className="zg-capsule-accent disabled:opacity-40"
          >
            {busy ? "送信中…" : "引き出しリクエスト"}
          </button>

          {belowMin && (
            <p className="mt-3 text-xs text-faint">
              ¥2,000以上で引き出しできます（あと {formatYen(Math.max(0, MIN_PAYOUT - balance))}）
            </p>
          )}
          {error && (
            <p className="mt-3 text-xs text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>

      {/* ===== リクエスト履歴 ===== */}
      <section>
        <div className="zg-eyebrow-ja mb-2">リクエスト履歴</div>

        {requests.length === 0 ? (
          <div className="py-6 text-sm text-faint">リクエストはありません</div>
        ) : (
          <div>
            {requests.map((r, i) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.pending;
              return (
                <div
                  key={r.id}
                  className={"zg-row" + (i < requests.length - 1 ? " hairline" : "")}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-display text-sm tabular-nums text-mid">
                      {formatDate(r.requested_at)}
                    </span>
                    <span className={"text-xs " + meta.cls}>{meta.label}</span>
                    {r.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => cancelRequest(r.id)}
                        disabled={busyCancel === r.id}
                        className="text-[11px] text-faint underline underline-offset-2 hover:text-[#A8443A] disabled:opacity-50"
                      >
                        {busyCancel === r.id ? "取消中…" : "キャンセル"}
                      </button>
                    )}
                  </div>
                  <span className="shrink-0 font-display text-base font-semibold tabular-nums text-sumi">
                    {/* 振込済みは実際に引かれた手数料(r.fee)で確定。未処理は予定手数料で表示。 */}
                    {formatYen(
                      Math.max(0, r.amount - (r.status === "paid" ? (r.fee ?? 0) : (r.fee ?? zeroguriFee(r.amount)))),
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
