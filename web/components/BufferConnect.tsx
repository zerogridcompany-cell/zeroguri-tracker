"use client";

// web/components/BufferConnect.tsx — Buffer連携をステップ式ウィザードに（連携タブで使用）
// ①アカウント作成 ②SNS連携 ③APIキー発行→貼り付け。各ボタンで該当ページを新規タブで開き、
// 押したステップはチェック（localStorage 保持）。③は貼り付け→検証→本人アカウント紐付け。

import { useEffect, useState } from "react";
import { functionsUrl } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth";

const STEPS = [
  {
    n: 1,
    title: "Bufferアカウントを作る",
    desc: "無料で登録できます（既にあればログイン）。",
    url: "https://login.buffer.com/signup?product=buffer&plan=free&cycle=month&cta=bufferSite-signin-createAccountLink-oneBuffer-1&redirect=https%3A%2F%2Fpublish.buffer.com",
    btn: "Bufferに登録 / ログイン",
  },
  {
    n: 2,
    title: "SNSアカウントを連携",
    desc: "投稿したいInstagram等をBufferに接続します。",
    url: "https://publish.buffer.com/settings/channels",
    btn: "連携ページを開く",
  },
  {
    n: 3,
    title: "APIキーを発行して貼り付け",
    desc: "発行された「Access Token（API key）」を下に貼り付けます。",
    url: "https://publish.buffer.com/settings/api",
    btn: "APIキー発行ページを開く",
  },
] as const;

const LS_KEY = "zg.bufferSteps.v1";

export function BufferConnect({
  onConnected,
  connected,
}: {
  onConnected?: () => void;
  connected?: boolean;
} = {}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [visited, setVisited] = useState<Record<number, boolean>>({});

  // 押したステップのチェックを復元
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
      if (raw) setVisited(JSON.parse(raw) as Record<number, boolean>);
    } catch {
      /* ignore */
    }
  }, []);

  function openStep(step: number, url: string) {
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
    setVisited((v) => {
      const next = { ...v, [step]: true };
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function connect() {
    if (!token.trim()) {
      setMsg("APIキー（アクセストークン）を貼り付けてください");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const t = await getAccessToken();
      const res = await fetch(`${functionsUrl}/buffer-connect-self`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ token: token.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; linkedAccounts?: number; channelNames?: string[];
      };
      if (!res.ok || !j.ok) {
        setMsg(j.error ?? "連携に失敗しました");
        return;
      }
      setToken("");
      const names = (j.channelNames ?? []).join(", ");
      setMsg(
        (j.linkedAccounts ?? 0) > 0
          ? `✓ 連携できました（${j.linkedAccounts}アカウント）。予約投稿が使えます。`
          : names
            ? `Bufferに繋がっている垢: ${names} — このサイトの連携アカウントと一致しませんでした。`
            : "Bufferにアカウントが接続されていません。先にステップ2でSNSを接続してください。",
      );
      onConnected?.();
    } catch {
      setMsg("連携に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-line p-4">
      <div className="flex items-center gap-2">
        <span className="zg-eyebrow-ja">Bufferと連携</span>
        {connected && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">✓ 連携済み</span>
        )}
      </div>

      {STEPS.map((s) => {
        const isConnectStep = s.n === 3;
        const checked = isConnectStep ? Boolean(connected) : Boolean(visited[s.n]);
        return (
          <div key={s.n} className="flex gap-3">
            <span
              className={
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-[11px] " +
                (checked ? "bg-accent text-white" : "bg-line text-mid")
              }
            >
              {checked ? "✓" : s.n}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-sumi">{s.title}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{s.desc}</p>
              <button
                type="button"
                onClick={() => openStep(s.n, s.url)}
                className={"mt-1.5 text-[11px] " + (visited[s.n] ? "zg-capsule-accent" : "zg-capsule")}
              >
                {s.btn} ↗{visited[s.n] && !isConnectStep ? " ✓" : ""}
              </button>

              {isConnectStep && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="APIキー（アクセストークン）を貼り付け"
                    className="zg-input flex-1 text-sm"
                  />
                  <button type="button" onClick={connect} disabled={busy} className="zg-capsule-accent shrink-0 disabled:opacity-50">
                    {busy ? "連携中…" : "連携する"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {msg && <p className="text-[11px] text-faint">{msg}</p>}
    </div>
  );
}
