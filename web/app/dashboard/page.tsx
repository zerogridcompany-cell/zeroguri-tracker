"use client";

// web/app/dashboard/page.tsx — トラッキングダッシュボード本体
// LoginGate で認証ゲート。hasSupabase=true なら実データ（Edge Function）、
// それ以外はデモ用モック（/api/summary）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasSupabase, functionsUrl, supabase } from "@/lib/supabase";
import { getAccessToken, getUserEmail, isOrganizer, signOut } from "@/lib/auth";
import { LoginGate } from "@/components/LoginGate";
import { OrganizerDashboard } from "@/components/OrganizerDashboard";
import { OnboardingForm } from "@/components/OnboardingForm";
import { DiscordGateModal } from "@/components/DiscordGateModal";
import { SummaryBar } from "@/components/SummaryBar";
import { ConnectionHub } from "@/components/ConnectionHub";
import { CampaignCard } from "@/components/CampaignCard";
import { CampaignProgressBar } from "@/components/CampaignProgressBar";
import { PostingCalendar } from "@/components/PostingCalendar";
import { VideoSubmit, type SubmitPrefill } from "@/components/VideoSubmit";
import { CreatorReservations } from "@/components/CreatorReservations";
import { LecturesView } from "@/components/LecturesView";
import { NoticeModal } from "@/components/NoticeModal";
import { RejectionPopup } from "@/components/RejectionPopup";
import { ManualPending } from "@/components/ManualPending";
import { AddVideoModal } from "@/components/AddVideoModal";
import { RankingView } from "@/components/RankingView";
import { BufferConnect } from "@/components/BufferConnect";
import { SettingsView } from "@/components/SettingsView";
import { PayoutView } from "@/components/PayoutView";
import type { DashboardData } from "@/lib/types";

export default function DashboardPage() {
  return (
    <LoginGate>
      <RoleRouter />
    </LoginGate>
  );
}

// ログイン後の振り分け: オーガナイザー(指定メール) / 未登録クリエイター(オンボーディング) / クリエイター。
function RoleRouter() {
  const [role, setRole] = useState<"loading" | "organizer" | "onboarding" | "creator">(
    hasSupabase ? "loading" : "creator",
  );
  // Discord 表示名ゲート用（onboarded と同時に取得して、creator 描画と同時にゲートを出す＝チラつき防止）
  const [gateUid, setGateUid] = useState<string | null>(null);
  const [needsDiscord, setNeedsDiscord] = useState(false);

  const check = useCallback(async () => {
    if (!hasSupabase || !supabase) {
      setRole("creator");
      return;
    }
    if (await isOrganizer()) {
      setRole("organizer");
      return;
    }
    // クリエイター: プロフィール未登録ならオンボーディングへ
    let onboarded = false;
    let fetchOk = true; // 取得が成功したか（失敗を「未登録」と誤認しない）
    try {
      const { data: u, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      const uid = u?.user?.id;
      if (uid) {
        const { data: p, error: pErr } = await supabase
          .from("profiles")
          .select("onboarded, discord_display_name")
          .eq("user_id", uid)
          .maybeSingle();
        if (pErr) throw pErr;
        onboarded = Boolean(p?.onboarded);
        setGateUid(uid);
        // 登録済みなのに表示名が未入力 → ゲート対象
        setNeedsDiscord(onboarded && !String(p?.discord_display_name ?? "").trim());
      } else {
        fetchOk = false;
      }
    } catch {
      // 取得失敗 → オンボーディングへ誤誘導しない（再提出ポップアップを載せた creator 画面を保持）
      fetchOk = false;
    }
    // オンボーディングは「確実に未登録」のときだけ。失敗時は creator 扱い（Dashboard 側に独自のエラーUIあり）。
    setRole(onboarded ? "creator" : fetchOk ? "onboarding" : "creator");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (role === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-faint">
        読み込み中…
      </div>
    );
  }
  if (role === "organizer") return <OrganizerDashboard />;
  if (role === "onboarding") return <OnboardingForm onDone={() => setRole("creator")} />;
  // クリエイター: Discord 表示名が未入力なら閉じられないゲートを重ねて必ず入力させる
  return (
    <>
      <Dashboard />
      <DiscordGateModal uid={gateUid} initialNeedsGate={needsDiscord} />
    </>
  );
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [manualRefresh, setManualRefresh] = useState(0); // 手動提出後に「提出状況」一覧を更新
  const [addVideoOpen, setAddVideoOpen] = useState(false); // 動画を追加モーダル
  const [manualView, setManualView] = useState<"main" | "approval">("main"); // 手動: メイン(動画追加) / 承認画面
  const [activeCampaigns, setActiveCampaigns] = useState<{ campaignId: string; title: string }[]>([]);
  // 案件詳細（説明・画像・素材リンク・自由リンク）
  const [campaignDetails, setCampaignDetails] = useState<
    Record<string, { description: string | null; imageUrl: string | null; materialUrl: string | null; links: { label: string; url: string }[] }>
  >({});
  // タブ統一: 案件 / 成績 / 出金 / 連携 / 投稿 / 講義（＋設定はヘッダー）。デフォルトは成績。
  const [view, setView] = useState<"home" | "campaigns" | "payout" | "link" | "post" | "lectures" | "settings">("home");
  const [postMode, setPostMode] = useState<"auto" | "manual">("manual"); // 投稿タブ: デフォは手動
  // 出金/連携はタブではなくボタンから開くサブ画面。戻る先を覚えておく。
  const [returnTo, setReturnTo] = useState<"home" | "campaigns" | "post" | "lectures">("home");
  const [bufferReady, setBufferReady] = useState(false); // Buffer連携済み（投稿先チャンネルあり）か
  // 却下からの再提出: ポップアップから内容を引き継いで提出フォームへ
  const [resubmit, setResubmit] = useState<SubmitPrefill | null>(null);
  // 選択中の案件。"" = 未選択（まだどの案件にも参加していない）。
  const [campaignFilter, setCampaignFilter] = useState<string>("");

  const load = useCallback(async () => {
    try {
      setError(null);
      let json: DashboardData;
      if (hasSupabase) {
        // 実データ: Supabase Edge Function（要 Bearer トークン）
        const token = await getAccessToken();
        const res = await fetch(`${functionsUrl}/dashboard-summary`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = (await res.json()) as DashboardData;
      } else {
        // デモ用モック
        const res = await fetch("/api/summary");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = (await res.json()) as DashboardData;
      }
      setData(json);
    } catch {
      setError("ダッシュボードの読み込みに失敗しました");
    }
  }, []);

  // 計測待ち（初回計測待ち or まもなく次回計測）の動画があるか
  const hasPending = useMemo(() => {
    if (!data) return false;
    const now = Date.now();
    return data.campaigns.some((c) =>
      c.videos.some((v) => {
        if (v.displayStatus === "retired" || v.displayStatus === "completed") return false;
        if (!v.lastCheckedAt) return true; // 追加直後・初回計測待ち
        return v.nextCheckAt ? new Date(v.nextCheckAt).getTime() <= now + 60000 : false;
      }),
    );
  }, [data]);

  useEffect(() => {
    void load();
    // 自動リフレッシュ: 計測待ちがあるときは速く(10秒)、通常は30秒。手動更新なしで反映。
    const id = setInterval(() => void load(), hasPending ? 10000 : 30000);
    return () => clearInterval(id);
  }, [load, hasPending]);

  // 参加済みの案件ID = 連携アカウントを持つ案件 ∪ 動画がある案件。
  // 「参加」= その案件にアカウントを連携すること。連携した時点で参加済みになる。
  const joinedIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of data?.accounts ?? []) if (a.campaignId) s.add(a.campaignId);
    for (const c of data?.campaigns ?? []) s.add(c.campaignId);
    return s;
  }, [data]);

  // ドロップダウンに出すのは参加済みの案件だけ（募集中はここには出さない）。
  const joinedCampaigns = useMemo(() => {
    const titleOf = (id: string) =>
      data?.campaigns.find((c) => c.campaignId === id)?.title ??
      activeCampaigns.find((c) => c.campaignId === id)?.title ??
      "案件";
    return [...joinedIds].map((id) => ({ campaignId: id, title: titleOf(id) }));
  }, [joinedIds, data, activeCampaigns]);

  // 選択中の案件が「参加手続き中（募集中を選んだがまだ未参加）」か
  const joiningTitle = useMemo(() => {
    if (!campaignFilter || joinedIds.has(campaignFilter)) return null;
    return activeCampaigns.find((c) => c.campaignId === campaignFilter)?.title ?? null;
  }, [campaignFilter, joinedIds, activeCampaigns]);

  // 手動タブ用の「参加済みの有効な案件」（参加手続き中の未参加idを掴んでいてもズレない）
  const manualCampaign = joinedIds.has(campaignFilter) ? campaignFilter : joinedCampaigns[0]?.campaignId ?? "";

  // 参加済みが無ければ未選択のまま（募集中から「参加」して連携する）。
  // 参加済みがあり、選択が無効（未選択 or 消えた案件）なら先頭の参加済みを選ぶ。
  // ただし参加手続き中（募集中を選択した状態）は維持する。
  useEffect(() => {
    if (joinedCampaigns.length === 0) return;
    if (joiningTitle) return; // 参加手続き中はそのまま
    const valid = joinedCampaigns.some((c) => c.campaignId === campaignFilter);
    if (!valid) setCampaignFilter(joinedCampaigns[0].campaignId);
  }, [joinedCampaigns, joiningTitle, campaignFilter]);

  // ログイン中ユーザーのメール（hasSupabase のときのみ）
  useEffect(() => {
    if (!hasSupabase) return;
    let active = true;
    void getUserEmail().then((e) => {
      if (active) setEmail(e);
    });
    return () => {
      active = false;
    };
  }, []);

  // Buffer連携済み（投稿先チャンネルが紐付いているアカウントがある）か
  const checkBufferReady = useCallback(async () => {
    if (!supabase) return;
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return;
    const { data: rows } = await supabase
      .from("linked_accounts").select("id").eq("user_id", uid).not("buffer_channel_id", "is", null).limit(1);
    setBufferReady((rows?.length ?? 0) > 0);
  }, []);
  useEffect(() => {
    void checkBufferReady();
  }, [checkBufferReady]);

  // 募集中（active）の案件 = オーガナイザーが作った案件もここに出る
  useEffect(() => {
    if (!hasSupabase || !supabase) return;
    let active = true;
    void supabase
      .from("campaigns")
      .select("id, title, description, image_url, material_url, links")
      .eq("status", "active")
      .then(({ data: cs }) => {
        if (active && cs) {
          setActiveCampaigns(cs.map((c) => ({ campaignId: c.id as string, title: c.title as string })));
          const m: Record<string, { description: string | null; imageUrl: string | null; materialUrl: string | null; links: { label: string; url: string }[] }> = {};
          for (const c of cs) {
            m[c.id as string] = {
              description: (c.description as string | null) ?? null,
              imageUrl: (c.image_url as string | null) ?? null,
              materialUrl: (c.material_url as string | null) ?? null,
              links: Array.isArray(c.links) ? (c.links as { label: string; url: string }[]) : [],
            };
          }
          setCampaignDetails(m);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    if (typeof window !== "undefined") window.location.reload();
  }

  async function deleteVideo(id: string) {
    if (!supabase) return;
    if (!window.confirm("この動画を削除しますか？\nこの動画の計測データも削除されます。")) return;
    // 即時反映: 画面から先に消す
    setData((d) =>
      d
        ? { ...d, campaigns: d.campaigns.map((c) => ({ ...c, videos: c.videos.filter((v) => v.trackedVideoId !== id) })) }
        : d,
    );
    await supabase.from("tracked_videos").delete().eq("id", id);
    void load();
  }

  async function renameVideo(id: string, newTitle: string | null) {
    if (!supabase) return;
    // 即時反映（先に楽観的更新 → ラグなし）
    setData((d) =>
      d
        ? {
            ...d,
            campaigns: d.campaigns.map((c) => ({
              ...c,
              videos: c.videos.map((v) => (v.trackedVideoId === id ? { ...v, title: newTitle } : v)),
            })),
          }
        : d,
    );
    // 背後で保存（タイトルのみ更新する安全な rpc。課金列には触れない）
    const { error: rpcErr } = await supabase.rpc("rename_tracked_video", { p_video_id: id, p_title: newTitle ?? "" });
    if (rpcErr) {
      window.alert("名前の変更に失敗しました: " + rpcErr.message);
      void load(); // 失敗時は元に戻す
      return;
    }
    void load();
  }

  async function leaveCampaign(campaignId: string, title: string) {
    if (!supabase) return;
    if (!window.confirm(`「${title}」から抜けますか？\nこの案件のあなたの集計・動画はすべて削除されます。`)) return;
    // RLS により自分の連携アカウント由来の動画のみ削除される
    await supabase.from("tracked_videos").delete().eq("campaign_id", campaignId);
    void load();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {/* ヘッダー */}
      <header className="mb-10 flex items-center justify-between gap-4">
        <span className="font-display text-sm tracking-wide text-sumi">ZeroGuri Tracker</span>

        {hasSupabase && (
          <div className="flex shrink-0 items-center gap-3">
            {email && (
              <span className="hidden font-display text-[11px] text-faint sm:inline">
                {email}
              </span>
            )}
            <button
              type="button"
              onClick={() => setView("settings")}
              className="zg-capsule"
            >
              設定
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="zg-capsule"
            >
              サインアウト
            </button>
          </div>
        )}
      </header>

      {hasSupabase && (
        <nav className="mb-8 flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            ["campaigns", "案件"],
            ["home", "成績"],
            ["post", "投稿"],
            ["lectures", "講義"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key !== "post") setResubmit(null);
                setView(key);
              }}
              className={"shrink-0 " + (view === key ? "zg-capsule-accent" : "zg-capsule")}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {view === "settings" ? (
        <SettingsView
          onAccountDeleted={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
        />
      ) : view === "lectures" ? (
        <LecturesView />
      ) : view === "payout" ? (
        <div className="space-y-5">
          <button type="button" onClick={() => setView(returnTo)} className="zg-capsule">← 戻る</button>
          <PayoutView />
        </div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-faint">{error}</div>
      ) : !data ? (
        <div className="py-16 text-center text-sm text-faint">読み込み中…</div>
      ) : view === "home" ? (
        /* 成績: 稼いだ額（隣に出金ボタン）+ 連続日数 + ランキング */
        <div className="space-y-10">
          <SummaryBar totals={data.totals} onWithdraw={() => { setReturnTo("home"); setView("payout"); }} />
          <PostingCalendar posting={data.posting} />
          <RankingView />
        </div>
      ) : view === "campaigns" ? (
        /* 案件: 参加中＋キャップ / 募集中（参加） */
        <div className="space-y-10">
          {joinedCampaigns.length > 0 && (
            <section>
              <span className="zg-eyebrow-ja mb-4 block">参加中の案件</span>
              <div className="space-y-8">
                {joinedCampaigns.map((c) => {
                  const prog = data.progressByCampaign?.[c.campaignId];
                  return (
                    <div key={c.campaignId}>
                      <div className="mb-2 truncate text-sm text-sumi">{c.title}</div>
                      {prog?.cap ? (
                        <CampaignProgressBar
                          cap={prog.cap}
                          earnedAmount={prog.earnedAmount}
                          countedAmount={prog.countedAmount}
                          overAmount={prog.overAmount}
                          earnedViews={prog.earnedViews}
                          progressPct={prog.progressPct}
                        />
                      ) : (
                        <div className="text-[11px] text-faint">上限なし</div>
                      )}

                      {/* 案件詳細（主催者が設定） */}
                      {(() => {
                        const d = campaignDetails[c.campaignId];
                        return (
                          <div className="mt-3 space-y-3">
                            {d?.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={d.imageUrl} alt="" className="w-full rounded-lg border border-line object-contain" />
                            )}
                            {d?.description && (
                              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-mid">{d.description}</p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              {d?.materialUrl && (
                                <a href={d.materialUrl} target="_blank" rel="noopener noreferrer" className="zg-capsule-accent text-[11px]">素材 ↗</a>
                              )}
                              <a href="https://youtube-discord-downloader.vercel.app/" target="_blank" rel="noopener noreferrer" className="zg-capsule text-[11px]">
                                YouTubeダウンローダー ↗
                              </a>
                              {(d?.links ?? []).map((l, i) => (
                                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="zg-capsule text-[11px]">
                                  {l.label} ↗
                                </a>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {(() => {
            const available = activeCampaigns.filter((a) => !joinedIds.has(a.campaignId));
            if (available.length === 0) {
              return joinedCampaigns.length === 0 ? (
                <div className="text-sm text-faint">参加できる案件がありません</div>
              ) : null;
            }
            return (
              <section>
                <span className="zg-eyebrow-ja mb-4 block">募集中の案件</span>
                <div>
                  {available.map((a, i) => (
                    <div key={a.campaignId} className={"zg-row" + (i < available.length - 1 ? " hairline" : "")}>
                      <span className="truncate text-sm text-sumi">{a.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCampaignFilter(a.campaignId);
                          setReturnTo("campaigns");
                          setView("link");
                        }}
                        className="zg-capsule"
                      >
                        参加
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}
        </div>
      ) : view === "link" ? (
        /* 連携: 案件選択 + アカウント連携 + Buffer（タブではなくボタンから開くサブ画面） */
        <div className="space-y-8">
          <button type="button" onClick={() => setView(returnTo)} className="zg-capsule">← 戻る</button>
          {joiningTitle ? (
            <div>
              <span className="zg-eyebrow-ja mb-1 block">参加する案件</span>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-sumi">{joiningTitle}</span>
                <button type="button" onClick={() => setCampaignFilter(joinedCampaigns[0]?.campaignId ?? "")} className="zg-capsule">
                  やめる
                </button>
              </div>
              <p className="mt-2 text-xs text-mid">この案件に参加するには、下でアカウントを連携してください。</p>
            </div>
          ) : joinedCampaigns.length > 0 ? (
            <div>
              <label className="zg-eyebrow-ja mb-1 block">案件</label>
              <select className="zg-input cursor-pointer" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
                {joinedCampaigns.map((c) => (
                  <option key={c.campaignId} value={c.campaignId}>{c.title}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-faint">先に「案件」タブから参加する案件を選んでください。</p>
          )}
          {campaignFilter && (
            <ConnectionHub
              accounts={data.accounts}
              campaignId={campaignFilter}
              onChanged={() => { void load(); void checkBufferReady(); }}
            />
          )}
          <BufferConnect connected={bufferReady} onConnected={() => { void load(); void checkBufferReady(); }} />
        </div>
      ) : (
        /* 投稿: 自動 / 手動 */
        <div className="space-y-6">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPostMode("manual")} className={postMode === "manual" ? "zg-capsule-accent" : "zg-capsule"}>
              手動
            </button>
            <button type="button" onClick={() => setPostMode("auto")} className={postMode === "auto" ? "zg-capsule-accent" : "zg-capsule"}>
              自動
            </button>
            <button type="button" onClick={() => { setReturnTo("post"); setView("link"); }} className="zg-capsule-accent ml-auto shrink-0 text-[11px]">
              連携
            </button>
          </div>

          {postMode === "auto" ? (
            <>
              <NoticeModal
                storageKey="autoInfo"
                variant="info"
                title="提出するだけでOK"
                body={
                  <>
                    動画を<span className="text-sumi">提出</span>すれば、主催者が承認したタイミングで
                    <span className="text-sumi">あなたのアカウントへ自動投稿</span>されます。
                    Bufferに自分でアップロードする必要はありません。
                  </>
                }
              />
              {bufferReady || resubmit ? (
              <div className="space-y-8">
                <VideoSubmit prefill={resubmit} onSubmitted={() => setResubmit(null)} />
                <CreatorReservations />
              </div>
            ) : (
              /* Buffer未連携 → 薄暗いゲート + 登録ボタン */
              <div className="rounded-2xl border border-line bg-sumi px-6 py-12 text-center">
                <p className="text-sm text-white/90">自動投稿には Buffer の連携が必要です</p>
                <p className="mt-1 text-[11px] text-white/55">「連携」タブでアカウント連携・アクセストークンを設定してください</p>
                <button type="button" onClick={() => { setReturnTo("post"); setView("link"); }} className="zg-capsule-accent mt-5">
                  Bufferを登録
                </button>
              </div>
            )}
            </>
          ) : manualView === "approval" ? (
            /* 手動 → 承認画面（投稿前の承認をもらう）。戻るで動画追加に戻る。 */
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => { setManualView("main"); setResubmit(null); }}
                className="flex items-center gap-1 text-sm text-mid transition-colors hover:text-sumi"
              >
                ← 戻る
              </button>
              <NoticeModal
                storageKey="manualPreApprovalInfo"
                variant="info"
                title="投稿前に承認をもらいます"
                body={
                  <>
                    <span className="text-sumi">これから投稿する動画とキャプション</span>を提出して、主催者の承認をもらいます。
                    承認されたら自分で投稿し、「動画を追加」から計測に登録してください。
                  </>
                }
              />
              <VideoSubmit
                manual
                prefill={resubmit}
                onSubmitted={() => { setResubmit(null); setManualRefresh((n) => n + 1); }}
              />
              <ManualPending refreshKey={manualRefresh} />
            </div>
          ) : (
            /* 手動 メイン: 動画追加（直接トラッキング）＋アカウント選択。承認ボタンで承認画面へ。 */
            <div className="space-y-8">
              {joinedCampaigns.length > 0 ? (
                <div>
                  <label className="zg-eyebrow-ja mb-1 block">案件</label>
                  <select className="zg-input cursor-pointer" value={manualCampaign} onChange={(e) => setCampaignFilter(e.target.value)}>
                    {joinedCampaigns.map((c) => (
                      <option key={c.campaignId} value={c.campaignId}>{c.title}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-sm text-faint">先に「案件」タブから案件に参加してください。</p>
              )}

              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setManualView("approval")} className="zg-capsule">
                  承認をもらう
                </button>
                <button type="button" onClick={() => setAddVideoOpen(true)} className="zg-capsule-accent">
                  動画を追加
                </button>
              </div>

              {joinedIds.has(manualCampaign) && (
                <div className="space-y-8">
                  {data.campaigns
                    .filter((c) => c.campaignId === manualCampaign)
                    .map((c) => (
                      <CampaignCard
                        key={c.campaignId}
                        campaign={c}
                        onDeleteVideo={deleteVideo}
                        onRenameVideo={renameVideo}
                        onLeave={leaveCampaign}
                      />
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 却下の確実な通知（未読の却下があれば最前面に出す） */}
      {hasSupabase && (
        <RejectionPopup
          onResubmit={(p) => {
            // 提出タイプに応じて手動/自動の提出フォームへ（動画は再アップロード、キャプション等はプリフィル）
            setResubmit(p);
            if (p.submissionType === "manual") {
              setPostMode("manual");
              setManualView("approval"); // 手動の提出フォームは承認画面にある
            } else {
              setPostMode("auto");
            }
            setView("post");
            if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}

      {/* 動画を追加モーダル（直接トラッキング） */}
      {hasSupabase && data && (
        <AddVideoModal
          open={addVideoOpen}
          onClose={() => setAddVideoOpen(false)}
          campaigns={data.campaigns}
          accounts={data.accounts}
          defaultCampaignId={manualCampaign}
          onAdded={() => {
            setAddVideoOpen(false);
            void load();
          }}
        />
      )}
    </main>
  );
}
