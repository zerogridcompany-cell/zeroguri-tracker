"use client";

// web/components/OrganizerPayouts.tsx — オーガナイザーの振込管理
// 引き出しリクエストごとに「報酬総額 / ゼログリ手数料 / 送金額(手数料込み)」を内訳表示し、
// 手数料を編集して振込済み化。ユーザー口座検索も提供。
// ゼログリ手数料 = 報酬総額 × 8% ＋ ¥330（DBトリガ set_payout_fee と一致 / 編集可）。
// 和デザイン: フラット / 明朝ラベル / 数字は Playfair + tabular-nums / hairline で区切る。

import { useCallback, useEffect, useMemo, useState } from "react";
import { functionsUrl, supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";
import { formatYen, zeroguriFee, payoutNet } from "@/lib/format";

interface Bank {
  bankCode: string | null;
  bankName: string | null;
  branchCode: string | null;
  branchName: string | null;
  accountType: string | null;
  accountNumber: string | null;
  holderKana: string | null;
}

interface PayoutRequest {
  id: string;
  userId: string;
  status: string;
  campaignId: string | null;
  campaign: string | null;
  internalId: string | null;
  name: string | null;
  discord: string | null;
  bank: Bank;
  amount: number;
  fee: number;
  net: number;
  currentBalance: number;
  requestedAt: string | null;
  paidAt: string | null;
}

interface PayoutUser {
  userId: string;
  internalId: string | null;
  name: string | null;
  discord: string | null;
  bank: Bank;
  balance: number;
}

interface PayoutsData {
  requests: PayoutRequest[];
  users: PayoutUser[];
}

/** 口座・Discord を整列したラベル付きブロックで表示 */
function AccountBlock({ bank, discord }: { bank: Bank; discord: string | null }) {
  const where = [bank.bankName, bank.branchName].filter(Boolean).join(" ");
  const detail = [bank.accountType, bank.accountNumber].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5 font-serif text-[11px] leading-relaxed text-faint">
      <div className="flex gap-3">
        <span className="w-12 shrink-0 text-mid">口座</span>
        <span className="break-all">
          {where || "—"}
          {detail && <>　{detail}</>}
          {bank.holderKana && <>　{bank.holderKana}</>}
        </span>
      </div>
      {discord && (
        <div className="flex gap-3">
          <span className="w-12 shrink-0 text-mid">Discord</span>
          <span className="break-all">{discord}</span>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function OrganizerPayouts({ view }: { view: "requests" | "history" }) {
  const [data, setData] = useState<PayoutsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [historyUser, setHistoryUser] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      setError(null);
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-payouts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PayoutsData;
      setData(json);
      // 各リクエストの手数料初期値: 保存値（トリガ算出）が無ければ式から
      setFees((prev) => {
        const next = { ...prev };
        for (const r of json.requests ?? []) {
          if (next[r.id] === undefined) {
            next[r.id] = r.fee && r.fee > 0 ? r.fee : zeroguriFee(r.amount);
          }
        }
        return next;
      });
    } catch {
      setError("読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // pending を先頭に
  const requests = useMemo(() => {
    const list = data?.requests ?? [];
    return [...list].sort((a, b) => {
      const ap = a.status === "pending" ? 0 : 1;
      const bp = b.status === "pending" ? 0 : 1;
      return ap - bp;
    });
  }, [data]);

  const matchedUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (data?.users ?? []).filter((u) => {
      const id = (u.internalId ?? "").toLowerCase();
      const name = (u.name ?? "").toLowerCase();
      return id.includes(q) || name.includes(q);
    });
  }, [data, query]);

  async function markPaid(req: PayoutRequest) {
    if (!supabase) return;
    const fee = fees[req.id] ?? req.fee ?? 0;
    setBusyId(req.id);
    try {
      // 支払い確定 + そのユーザーの全動画の現在再生数を「支払い済み」として台帳記録
      // （削除→再追加や継続成長で再計上されないようにする）。
      const { error: rpcErr } = await supabase.rpc("mark_payout_paid", {
        p_request_id: req.id,
        p_fee: fee,
      });
      if (rpcErr) {
        // フォールバック（台帳記録なしでも支払いは確定させる）
        await supabase
          .from("payout_requests")
          .update({ status: "paid", fee, paid_at: new Date().toISOString() })
          .eq("id", req.id);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // 振込履歴から支払いを取り消し（削除）。ひも付く台帳も消えて、その動画は最初から計上され直す。
  async function voidRequest(req: PayoutRequest) {
    if (
      !window.confirm(
        "この振込履歴を削除しますか？\nこの支払いに含まれる動画は最初から計上され直します。",
      )
    ) {
      return;
    }
    setBusyId(req.id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-ledger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "void_request", request_id: req.id }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j?.error ?? "削除に失敗しました");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const paidRequests = requests.filter((r) => r.status === "paid");
  const historyRequests =
    historyUser === "all" ? paidRequests : paidRequests.filter((r) => r.userId === historyUser);

  function renderRequest(req: PayoutRequest) {
    const isPaid = req.status === "paid";
    // 振込済みは「実際に適用した手数料(req.fee)」で確定表示（＝実際に送金した額）。
    // 未処理は編集中の手数料で「これから送る額」を表示。
    const fee = isPaid ? (req.fee ?? 0) : (fees[req.id] ?? req.fee ?? 0);
    const net = Math.max(0, req.amount - fee); // 振込額 = 報酬総額 − ゼログリ手数料
    return (
      <div key={req.id}>
                  {/* 見出し: 内部ID / 氏名 / 状態 */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-display text-sm text-sumi">
                        {req.internalId ?? "—"}
                      </span>
                      <span className="truncate text-sm text-sumi">{req.name ?? "—"}</span>
                    </div>
                    {isPaid ? (
                      <span className="shrink-0 text-[10px] text-status-completed">振込済み</span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-accent">未処理</span>
                    )}
                  </div>
                  {/* どの案件から来たリクエストか */}
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                    <span className="text-faint">案件</span>
                    <span className="truncate text-mid">{req.campaign ?? "—"}</span>
                  </div>

                  {/* 内訳: 報酬総額 / ゼログリ手数料 / 送金額（数字を右端で揃える） */}
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[13px] text-mid">報酬総額</span>
                      <span className="font-display text-sm tabular-nums text-mid">
                        {formatYen(req.amount)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[13px] text-mid">
                        ゼログリ手数料
                        <span className="ml-1 text-[10px] text-faint">8%＋¥330</span>
                      </span>
                      {isPaid ? (
                        <span className="font-display text-sm tabular-nums text-mid">
                          −{formatYen(fee)}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <span className="font-display text-sm text-faint">¥</span>
                          <input
                            type="number"
                            className="zg-input w-24 py-1 text-right tabular-nums"
                            value={fee}
                            min={0}
                            onChange={(e) =>
                              setFees((prev) => ({
                                ...prev,
                                [req.id]: Number(e.target.value) || 0,
                              }))
                            }
                          />
                        </span>
                      )}
                    </div>

                    <div className="hairline" />

                    <div className="flex items-baseline justify-between gap-4 pt-0.5">
                      <span className="text-sm text-sumi">
                        振込額<span className="ml-1 text-[10px] text-faint">手数料差引後</span>
                      </span>
                      <span className="font-display text-xl font-semibold tabular-nums text-sumi">
                        {formatYen(net)}
                      </span>
                    </div>
                  </div>

                  {/* 口座・Discord */}
                  <div className="mt-4">
                    <AccountBlock bank={req.bank} discord={req.discord} />
                  </div>

                  {/* 振込操作 */}
                  <div className="mt-4">
                    {isPaid ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-faint">振込済み · {formatDate(req.paidAt)}</span>
                        <button
                          type="button"
                          onClick={() => voidRequest(req)}
                          disabled={busyId === req.id}
                          className="zg-capsule text-[#A8443A] disabled:opacity-50"
                        >
                          {busyId === req.id ? "削除中…" : "削除"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markPaid(req)}
                        disabled={busyId === req.id}
                        className="zg-capsule-accent disabled:opacity-50"
                      >
                        {busyId === req.id ? "処理中…" : "振込済みにする"}
                      </button>
                    )}
                  </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {error ? (
        <div className="py-12 text-center text-sm text-faint">{error}</div>
      ) : !data ? (
        <div className="py-12 text-center text-sm text-faint">読み込み中…</div>
      ) : view === "requests" ? (
        <>
          {/* 未処理の引き出しリクエスト（振込済みは履歴へ移動） */}
          <section>
            <div className="zg-eyebrow-ja mb-6">引き出しリクエスト（未処理）</div>
            {pendingRequests.length === 0 ? (
              <div className="text-sm text-faint">未処理のリクエストはありません</div>
            ) : (
              <div className="space-y-9">{pendingRequests.map(renderRequest)}</div>
            )}
          </section>

          {/* ユーザー検索 */}
          <section>
            <div className="zg-eyebrow-ja mb-4">ユーザー検索</div>

        <input
          type="text"
          className="zg-input w-full"
          placeholder="内部ID（ZG-0001）または 氏名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="mt-6">
          {query.trim() === "" ? null : matchedUsers.length === 0 ? (
            <div className="text-sm text-faint">該当するユーザーがいません</div>
          ) : (
            <div className="space-y-6">
              {matchedUsers.map((u) => {
                const fee = zeroguriFee(u.balance);
                return (
                  <div key={u.userId}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="font-display text-sm text-sumi">
                          {u.internalId ?? "—"}
                        </span>
                        <span className="truncate text-sm text-sumi">{u.name ?? "—"}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-faint">残高（報酬総額）</div>
                        <div className="font-display text-base tabular-nums text-sumi">
                          {formatYen(u.balance)}
                        </div>
                      </div>
                    </div>
                    {u.balance > 0 && (
                      <div className="mt-2 flex items-center justify-between gap-4 text-[11px] text-faint">
                        <span>ゼログリ手数料 −¥{fee.toLocaleString("ja-JP")}（8%＋¥330）</span>
                        <span className="font-display tabular-nums">
                          振込予定額 {formatYen(payoutNet(u.balance))}
                        </span>
                      </div>
                    )}
                    <div className="mt-3">
                      <AccountBlock bank={u.bank} discord={u.discord} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </section>
        </>
      ) : (
        /* 振込履歴: ドロップダウンでユーザー別 or 全ユーザー */
        <section>
          <div className="zg-eyebrow-ja mb-4">振込履歴</div>
          <select
            className="zg-input w-full cursor-pointer"
            value={historyUser}
            onChange={(e) => setHistoryUser(e.target.value)}
          >
            <option value="all">全ユーザー</option>
            {(data?.users ?? []).map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.internalId ?? "—"} {u.name ?? ""}
              </option>
            ))}
          </select>
          <div className="mt-6">
            {historyRequests.length === 0 ? (
              <div className="text-sm text-faint">振込履歴はありません</div>
            ) : (
              <div className="space-y-9">{historyRequests.map(renderRequest)}</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
