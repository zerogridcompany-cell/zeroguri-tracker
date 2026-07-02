"use client";

// web/components/OrganizerDashboard.tsx — オーガナイザー（案件主催）画面
// 主催案件ごとに、参加クリエイターの再生数・確定報酬を一覧。案件作成も可能。

import { useCallback, useEffect, useRef, useState } from "react";
import { functionsUrl, supabase } from "@/lib/supabase";
import { getAccessToken, getUserEmail, signOut } from "@/lib/auth";
import { PlatformIcon } from "@/components/PlatformIcon";
import { CampaignFormModal } from "@/components/CampaignFormModal";
import { PayoutLedgerLog } from "@/components/PayoutLedgerLog";
import { PostingCalendar } from "@/components/PostingCalendar";
import { SubmissionApprovals } from "@/components/SubmissionApprovals";
import { LecturesAdmin } from "@/components/LecturesAdmin";
import { OrganizerPayouts } from "@/components/OrganizerPayouts";
import { VideoTrendModal } from "@/components/VideoTrendModal";
import { PencilIcon } from "@/components/VideoRow";
import { CampaignProgressBar } from "@/components/CampaignProgressBar";
import { formatYen, formatNumber, payoutNet } from "@/lib/format";
import { profileUrl } from "@/lib/links";

type Platform = "youtube" | "tiktok" | "instagram";

interface Creator {
  handle: string | null;
  platform: Platform;
  email: string | null;
  videos: number;
  activeVideos: number;
  totalViews: number;
  billableAmount: number;
}
interface OrgCampaign {
  campaignId: string;
  title: string;
  status: string;
  unitPrice: number;
  capDefault: number;
  collectionStartDate: string | null;
  creatorCount: number;
  totalViews: number;
  totalBillableAmount: number;
  creators: Creator[];
  cap: { value: number; type: string; views: number | null } | null;
  earnedAmount: number;
  countedAmount: number;
  overAmount: number;
  earnedViews: number;
  progressPct: number | null;
}
interface OrgData {
  isOrganizer: boolean;
  campaigns: OrgCampaign[];
  totals: { campaigns: number; totalViews: number; totalBillableAmount: number };
}

interface MemberPlatform {
  platform: Platform;
  videos: number;
  activeVideos: number;
  views: number;
  earnings: number;
}
interface MemberTopVideo {
  trackedVideoId: string;
  title: string | null;
  contentId: string;
  platform: Platform;
  url: string | null;
  views: number;
}
interface MemberAccount {
  platform: Platform;
  handle: string | null;
  status: string | null;
}
interface Member {
  internalId: string;
  userId: string;
  nameKanji: string | null; // 姓 名 の合成
  lastNameKana: string | null;
  firstNameKana: string | null;
  nameKanaHalf: string | null;
  discord: string | null;
  sns: { youtube: string | null; tiktok: string | null; instagram: string | null };
  bank: {
    bankCode: string | null;
    bankName: string | null;
    branchCode: string | null;
    branchName: string | null;
    accountType: string | null;
    accountNumber: string | null;
    holderKana: string | null;
  };
  onboarded: boolean;
  accounts: MemberAccount[];
  totals: { views: number; earnings: number; videos: number; activeVideos: number };
  platforms: MemberPlatform[];
  topVideos: MemberTopVideo[];
  videos: MemberTopVideo[];
  posting?: {
    days: { date: string; posted: boolean; count: number }[];
    streak: number;
    postedToday: boolean;
    todayCount: number;
    total14: number;
    avgPerDay: number;
    maxCount: number;
    lastPostedDate: string | null;
  };
}
interface MembersData {
  members: Member[];
}

export function OrganizerDashboard() {
  const [data, setData] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // タブ: 案件 / 承認 / 講義 / 振込管理（予約投稿はクリエイター側に移行）。振込管理のみサブタブあり。
  const [section, setSection] = useState<"campaigns" | "approvals" | "lectures" | "payouts">("campaigns");
  const [payoutsTab, setPayoutsTab] = useState<"requests" | "history" | "ledger">("requests");
  const [trendVideoId, setTrendVideoId] = useState<string | null>(null);
  const [editCampaign, setEditCampaign] = useState<OrgCampaign | null>(null); // フル編集モーダル対象
  const [editCampaignId, setEditCampaignId] = useState<string | null>(null);
  const [editCampaignDraft, setEditCampaignDraft] = useState("");
  const skipCampaignRename = useRef(false);
  const [openAccount, setOpenAccount] = useState<Set<string>>(new Set()); // メンバー×プラットフォームの展開

  function toggleAccount(key: string) {
    setOpenAccount((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      setError(null);
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-summary`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as OrgData);
    } catch {
      setError("読み込みに失敗しました");
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-members`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MembersData;
      setMembers(json.members ?? []);
    } catch {
      setMembers([]);
    }
  }, []);

  function toggleMember(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 承認待ちの件数（承認タブのバッジ用）
  const [pendingCount, setPendingCount] = useState(0);
  const loadPending = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${functionsUrl}/organizer-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { submissions?: { status?: string }[] };
      setPendingCount((j.submissions ?? []).filter((s) => s.status === "pending").length);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMembers();
    void loadPending();
    const id = setInterval(() => void loadPending(), 60000);
    return () => clearInterval(id);
  }, [load, loadMembers, loadPending]);
  useEffect(() => {
    let active = true;
    void getUserEmail().then((e) => {
      if (active) setEmail(e);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    if (typeof window !== "undefined") window.location.reload();
  }

  async function endCampaign(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("campaigns").update({ status: "ended" }).eq("id", id);
    if (error) {
      window.alert("案件の終了に失敗しました: " + error.message);
      return;
    }
    await load();
    await loadMembers();
  }

  async function resumeCampaign(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("campaigns").update({ status: "active" }).eq("id", id);
    if (error) {
      window.alert("案件の再開に失敗しました: " + error.message);
      return;
    }
    await load();
    await loadMembers();
  }

  // キャップ到達時の「継続」: 上限を解除し、超過分も報酬として計上する
  async function continueCampaign(id: string) {
    if (!supabase) return;
    if (!window.confirm("この案件を継続しますか？\n上限を解除し、超過していた分も報酬として計上されます。")) return;
    // RLS: campaigns_update_org
    const { error } = await supabase.from("campaigns").update({ cap_value: null, cap_type: null }).eq("id", id);
    if (error) {
      window.alert("案件の継続に失敗しました: " + error.message);
      return;
    }
    await load();
    await loadMembers();
  }

  async function deleteCampaign(id: string) {
    if (!supabase) return;
    if (!window.confirm("この案件を削除しますか？参加動画も削除されます")) return;
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) {
      window.alert("案件の削除に失敗しました: " + error.message);
      return;
    }
    await load();
    await loadMembers();
  }

  // 案件名のインライン編集（Enter / フォーカス外で保存）
  function startCampaignEdit(id: string, current: string) {
    setEditCampaignDraft(current);
    setEditCampaignId(id);
  }
  async function commitCampaignRename(id: string, current: string) {
    setEditCampaignId(null);
    if (skipCampaignRename.current) {
      skipCampaignRename.current = false;
      return;
    }
    if (!supabase) return;
    const t = editCampaignDraft.trim();
    if (!t || t === current) return;
    // 即時反映（先に楽観的更新 → ラグなし）
    setData((d) =>
      d ? { ...d, campaigns: d.campaigns.map((c) => (c.campaignId === id ? { ...c, title: t } : c)) } : d,
    );
    const { error } = await supabase.rpc("rename_campaign", { p_campaign_id: id, p_title: t });
    if (error) {
      window.alert("案件名の変更に失敗しました: " + error.message);
      await load();
      return;
    }
    await load();
    await loadMembers();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between gap-4">
        <span className="font-display text-sm tracking-wide text-sumi">ZeroGuri ・ 主催者</span>
        <div className="flex shrink-0 items-center gap-3">
          {email && (
            <span className="hidden font-display text-[11px] text-faint sm:inline">{email}</span>
          )}
          <button type="button" onClick={handleSignOut} className="zg-capsule">
            サインアウト
          </button>
        </div>
      </header>

      {error ? (
        <div className="py-16 text-center text-sm text-faint">{error}</div>
      ) : !data ? (
        <div className="py-16 text-center text-sm text-faint">読み込み中…</div>
      ) : (
        <div className="space-y-10">
          {/* HERO: 送金額（クリエイターへの振込額 = 報酬総額 − ゼログリ手数料） */}
          <div>
            <div className="zg-eyebrow-ja">送金額</div>
            <div className="zg-hero">{formatYen(payoutNet(data.totals.totalBillableAmount))}</div>
            <div className="mt-1.5 text-xs text-faint">
              {data.totals.campaigns} 案件 · 総再生 {formatNumber(data.totals.totalViews)}
            </div>
          </div>

          {/* 大分類タブ: 案件 / 投稿管理 / 振込管理 */}
          <div className="space-y-3">
            <div className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([
                ["campaigns", "案件"],
                ["approvals", "承認"],
                ["lectures", "講義"],
                ["payouts", "振込管理"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSection(key)}
                  className={"relative shrink-0 " + (section === key ? "zg-capsule-accent" : "zg-capsule")}
                >
                  {label}
                  {key === "approvals" && pendingCount > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#A8443A] px-1 font-display text-[9px] leading-none text-white">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* サブタブ（振込管理のみ） */}
            {section === "payouts" && (
              <div className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {([
                  ["requests", "引き出し"],
                  ["history", "振込履歴"],
                  ["ledger", "ペイアウト済み"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPayoutsTab(key)}
                    className={
                      "shrink-0 text-xs " + (payoutsTab === key ? "zg-capsule-accent" : "zg-capsule")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {section === "campaigns" ? (
          <>
          {/* 主催案件 */}
          <section>
            <div className="mb-6 flex items-center justify-between gap-3">
              <span className="zg-eyebrow-ja">主催案件</span>
              <button type="button" onClick={() => setNewOpen(true)} className="zg-capsule-accent">
                案件を作成
              </button>
            </div>

            <div className="space-y-8">
              {data.campaigns.length === 0 && (
                <div className="text-sm text-faint">
                  まだ案件がありません。「案件を作成」から始めましょう。
                </div>
              )}

              {data.campaigns.map((c) => (
                <div
                  key={c.campaignId}
                  className={c.status === "ended" ? "rounded-xl bg-line p-3 opacity-60 grayscale" : ""}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {editCampaignId === c.campaignId ? (
                          <input
                            autoFocus
                            value={editCampaignDraft}
                            onChange={(e) => setEditCampaignDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              else if (e.key === "Escape") {
                                skipCampaignRename.current = true;
                                e.currentTarget.blur();
                              }
                            }}
                            onBlur={() => commitCampaignRename(c.campaignId, c.title)}
                            className="zg-input py-0.5 text-sm"
                            placeholder="案件名"
                          />
                        ) : (
                          <>
                            <h3 className="truncate text-sumi">{c.title}</h3>
                            <button
                              type="button"
                              onClick={() => startCampaignEdit(c.campaignId, c.title)}
                              className="shrink-0 text-faint transition-colors hover:text-sumi"
                              aria-label="案件名を編集"
                              title="案件名を編集"
                            >
                              <PencilIcon />
                            </button>
                            {c.status === "ended" && (
                              <span className="shrink-0 text-[10px] text-faint">終了</span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="mt-0.5 font-display text-[11px] text-faint">
                        {c.creatorCount} 名 · 再生 {formatNumber(c.totalViews)} ·{" "}
                        <span className="text-sumi">{formatYen(c.totalBillableAmount)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.status === "ended" ? (
                        <button
                          type="button"
                          onClick={() => resumeCampaign(c.campaignId)}
                          className="zg-capsule"
                        >
                          再開
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => endCampaign(c.campaignId)}
                          className="zg-capsule"
                        >
                          終了
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditCampaign(c)}
                        className="zg-capsule"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCampaign(c.campaignId)}
                        className="zg-capsule text-[#A8443A]"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {/* 案件キャップ進捗 + 到達時の継続/終了 */}
                  {c.cap && (
                    <div className="mt-6 mb-2">
                      <CampaignProgressBar
                        cap={c.cap}
                        earnedAmount={c.earnedAmount}
                        countedAmount={c.countedAmount}
                        overAmount={c.overAmount}
                        earnedViews={c.earnedViews}
                        progressPct={c.progressPct}
                      />
                      {c.overAmount > 0 && c.status !== "ended" && (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-[#A8443A]">上限に到達しています。</span>
                          <button
                            type="button"
                            onClick={() => continueCampaign(c.campaignId)}
                            className="zg-capsule"
                          >
                            継続（超過分も計上）
                          </button>
                          <button
                            type="button"
                            onClick={() => endCampaign(c.campaignId)}
                            className="zg-capsule text-[#A8443A]"
                          >
                            終了（超過分は破棄）
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              ))}
            </div>
          </section>

          {/* メンバー一覧（一元管理） */}
          <section>
            <div className="mb-6 flex items-baseline gap-3">
              <span className="zg-eyebrow-ja">メンバー</span>
            </div>

            <div>
              {members && members.length === 0 && (
                <div className="text-sm text-faint">まだメンバーがいません</div>
              )}

              {members?.map((m, i) => {
                const isOpen = expanded.has(m.internalId);
                const hasSns = Boolean(m.sns.youtube || m.sns.tiktok || m.sns.instagram);
                const hasBank = Boolean(m.bank.bankCode || m.bank.accountNumber);
                const kana =
                  [m.lastNameKana, m.firstNameKana].filter(Boolean).join(" ") || m.nameKanaHalf;
                return (
                  <div
                    key={m.internalId}
                    className={i < members.length - 1 ? "hairline" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => toggleMember(m.internalId)}
                      className="zg-row w-full text-left"
                      aria-expanded={isOpen}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="font-display text-sm text-sumi">{m.internalId}</span>
                        <span className="truncate text-sm text-sumi">{m.nameKanji ?? "—"}</span>
                        {!m.onboarded && (
                          <span className="shrink-0 text-[10px] text-faint">未登録</span>
                        )}
                        {m.posting && (
                          <span
                            className={
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] " +
                              (m.posting.postedToday
                                ? "bg-accent/15 text-accent"
                                : "bg-[#A8443A]/10 text-[#A8443A]")
                            }
                            title={
                              m.posting.postedToday
                                ? `今日 ${m.posting.todayCount}本投稿・連続${m.posting.streak}日`
                                : "今日 未投稿"
                            }
                          >
                            {m.posting.postedToday ? `今日${m.posting.todayCount}本・連続${m.posting.streak}日` : "今日未投稿"}
                          </span>
                        )}
                        {m.posting && (
                          <span
                            className="shrink-0 font-display text-[9px] tabular-nums text-faint"
                            title="直近14日の1日あたり平均投稿本数"
                          >
                            平均{m.posting.avgPerDay}本/日
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <div className="font-display text-base text-sumi">
                            {formatYen(m.totals.earnings)}
                          </div>
                          <div className="font-display text-[10px] text-faint">
                            再生 {formatNumber(m.totals.views)}
                          </div>
                        </div>
                        <span
                          className={
                            "text-xs text-faint transition-transform" +
                            (isOpen ? " rotate-180" : "")
                          }
                        >
                          ▾
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="space-y-5 pb-5">
                        {/* 毎日投稿トラッキング（目標は zeroguri-report で設定） */}
                        <PostingCalendar posting={m.posting} />

                        {/* 連携アカウント（クリックで各SNSのプロフィールへ） */}
                        {m.accounts.length > 0 && (
                          <div>
                            <div className="zg-eyebrow-ja mb-2">アカウント</div>
                            <div className="flex flex-wrap gap-2">
                              {m.accounts.map((a, j) => {
                                const href = profileUrl(a.platform, a.handle);
                                const label = a.handle ?? a.platform;
                                return href ? (
                                  <a
                                    key={a.platform + j}
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="zg-capsule inline-flex items-center gap-1.5 hover:text-accent"
                                    title={`${label} を開く`}
                                  >
                                    <PlatformIcon platform={a.platform} size={16} />
                                    {label}
                                  </a>
                                ) : (
                                  <span
                                    key={a.platform + j}
                                    className="zg-capsule inline-flex items-center gap-1.5"
                                  >
                                    <PlatformIcon platform={a.platform} size={16} />
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* アカウント別（タップでその アカウントの動画を表示） */}
                        {m.platforms.length > 0 && (
                          <div>
                            <div className="zg-eyebrow-ja mb-2">アカウント別（タップで動画）</div>
                            <div>
                              {m.platforms.map((pl, j) => {
                                const akey = m.internalId + ":" + pl.platform;
                                const aopen = openAccount.has(akey);
                                const accVideos = m.videos.filter((v) => v.platform === pl.platform);
                                return (
                                  <div
                                    key={pl.platform + j}
                                    className={j < m.platforms.length - 1 ? "hairline" : ""}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => toggleAccount(akey)}
                                      className="zg-row w-full text-left"
                                      aria-expanded={aopen}
                                    >
                                      <div className="flex min-w-0 items-center gap-3">
                                        <PlatformIcon platform={pl.platform} size={20} />
                                        <span className="text-[11px] text-faint">
                                          {pl.activeVideos}/{pl.videos}本 · 再生 {formatNumber(pl.views)}
                                        </span>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <span className="font-display text-sm text-sumi">
                                          {formatYen(pl.earnings)}
                                        </span>
                                        <span
                                          className={
                                            "text-xs text-faint transition-transform" +
                                            (aopen ? " rotate-180" : "")
                                          }
                                        >
                                          ▾
                                        </span>
                                      </div>
                                    </button>
                                    {aopen && (
                                      <div className="pb-2 pl-8">
                                        {accVideos.length === 0 && (
                                          <div className="py-2 text-[11px] text-faint">動画なし</div>
                                        )}
                                        {accVideos.map((v, k) => {
                                          const inner = (
                                            <>
                                              <span className="truncate text-sm text-sumi">
                                                {v.title ?? v.contentId}
                                              </span>
                                              <span className="shrink-0 font-display text-[11px] text-faint">
                                                再生 {formatNumber(v.views)}
                                              </span>
                                            </>
                                          );
                                          return v.url ? (
                                            <a
                                              key={v.trackedVideoId + k}
                                              href={v.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="zg-row hairline hover:text-accent"
                                            >
                                              {inner}
                                            </a>
                                          ) : (
                                            <div key={v.trackedVideoId + k} className="zg-row hairline">
                                              {inner}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 伸びてる動画 */}
                        {m.topVideos.length > 0 && (
                          <div>
                            <div className="mb-2 flex items-baseline gap-2">
                              <span className="zg-eyebrow-ja">伸びてる動画</span>
                            </div>
                            <div>
                              {m.topVideos.map((v, j) => (
                                <div
                                  key={v.contentId + j}
                                  className={
                                    "zg-row" + (j < m.topVideos.length - 1 ? " hairline" : "")
                                  }
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <span className="w-3 shrink-0 font-display text-[11px] text-faint">
                                      {j + 1}
                                    </span>
                                    <PlatformIcon platform={v.platform} size={18} />
                                    <button
                                      type="button"
                                      onClick={() => setTrendVideoId(v.trackedVideoId)}
                                      className="truncate text-left text-sm text-sumi underline decoration-line underline-offset-2 hover:text-accent"
                                      title="再生数の推移を見る"
                                    >
                                      {v.title ?? v.contentId}
                                    </button>
                                  </div>
                                  <span className="shrink-0 font-display text-[11px] text-faint">
                                    再生 {formatNumber(v.views)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 登録情報 */}
                        <div className="space-y-1.5 font-serif text-[11px] leading-relaxed text-faint">
                          {hasSns ? (
                            <div className="flex flex-col gap-0.5">
                              {m.sns.youtube && (
                                <span className="break-all">YouTube · {m.sns.youtube}</span>
                              )}
                              {m.sns.tiktok && (
                                <span className="break-all">TikTok · {m.sns.tiktok}</span>
                              )}
                              {m.sns.instagram && (
                                <span className="break-all">Instagram · {m.sns.instagram}</span>
                              )}
                            </div>
                          ) : null}
                          {hasBank && (
                            <div className="break-all">
                              銀行名 · {m.bank.bankName ?? "—"} · 支店名 ·{" "}
                              {m.bank.branchName ?? "—"} · {m.bank.bankCode ?? "—"}-
                              {m.bank.branchCode ?? "—"} {m.bank.accountType ?? ""}{" "}
                              {m.bank.accountNumber ?? ""} {kana ?? m.bank.holderKana ?? ""}
                            </div>
                          )}
                          {m.discord && <div className="break-all">Discord · {m.discord}</div>}
                          {!hasSns && !hasBank && !m.discord && (
                            <div className="text-faint">登録情報なし</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          </>
          ) : section === "approvals" ? (
            <SubmissionApprovals />
          ) : section === "lectures" ? (
            <LecturesAdmin />
          ) : payoutsTab === "ledger" ? (
            <PayoutLedgerLog />
          ) : (
            <OrganizerPayouts view={payoutsTab === "history" ? "history" : "requests"} />
          )}
        </div>
      )}

      {/* 新規作成 */}
      <CampaignFormModal
        open={newOpen}
        campaign={null}
        onClose={() => setNewOpen(false)}
        onSaved={() => {
          setNewOpen(false);
          void load();
          void loadMembers();
        }}
      />

      {/* フル編集（案件名・単価・上限・収集開始日） */}
      <CampaignFormModal
        open={editCampaign !== null}
        campaign={editCampaign}
        onClose={() => setEditCampaign(null)}
        onSaved={() => {
          setEditCampaign(null);
          void load();
          void loadMembers();
        }}
      />

      <VideoTrendModal
        trackedVideoId={trendVideoId}
        open={trendVideoId !== null}
        onClose={() => setTrendVideoId(null)}
      />
    </main>
  );
}
