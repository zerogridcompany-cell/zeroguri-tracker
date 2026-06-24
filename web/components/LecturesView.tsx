"use client";

// web/components/LecturesView.tsx — 講義（クリエイター・閲覧専用）
// オーガナイザーが作成した講義をステップ順に表示。

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Step {
  id: string;
  idx: number;
  title: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
}

// 本文中の URL をクリック可能なリンクにする（テキストは React がエスケープ）
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
interface Lecture {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  steps: Step[];
}

// Loom / YouTube の共有URLを埋め込みURLに。非対応はnull（→リンク表示）。
function embedUrl(url: string): string | null {
  let m = url.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  return null;
}

export function LecturesView() {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [lr, sr] = await Promise.all([
        supabase.from("lectures").select("id, title, description, video_url").eq("published", true).order("sort_order").order("created_at"),
        supabase.from("lecture_steps").select("id, lecture_id, idx, title, body, link_url, link_label").order("idx"),
      ]);
      const byLec = new Map<string, Step[]>();
      for (const s of sr.data ?? []) {
        const a = byLec.get(s.lecture_id as string) ?? [];
        a.push({
          id: s.id as string, idx: s.idx as number, title: s.title as string,
          body: (s.body as string | null) ?? null,
          link_url: (s.link_url as string | null) ?? null,
          link_label: (s.link_label as string | null) ?? null,
        });
        byLec.set(s.lecture_id as string, a);
      }
      setLectures(
        (lr.data ?? []).map((l) => ({
          id: l.id as string,
          title: l.title as string,
          description: (l.description as string | null) ?? null,
          video_url: (l.video_url as string | null) ?? null,
          steps: byLec.get(l.id as string) ?? [],
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <section className="space-y-5">
      <div>
        <span className="zg-eyebrow-ja">講義</span>
        <p className="mt-1 text-[11px] text-faint">使い方や手順をステップごとに確認できます。</p>
      </div>

      {loading ? (
        <div className="py-6 text-sm text-faint">読み込み中…</div>
      ) : lectures.length === 0 ? (
        <div className="text-sm text-faint">まだ講義がありません</div>
      ) : (
        <div className="space-y-3">
          {lectures.map((l) => {
            const isOpen = open.has(l.id);
            return (
              <div key={l.id} className="overflow-hidden rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => toggle(l.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-sumi">{l.title}</div>
                    {l.description && <div className="mt-0.5 truncate text-[11px] text-faint">{l.description}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] text-faint">{l.steps.length} ステップ</span>
                    <span className={"text-xs text-faint transition-transform" + (isOpen ? " rotate-180" : "")}>▾</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-4 border-t border-line px-4 py-4">
                    {l.video_url && (
                      embedUrl(l.video_url) ? (
                        <div className="relative w-full overflow-hidden rounded-lg border border-line" style={{ paddingTop: "56.25%" }}>
                          <iframe
                            src={embedUrl(l.video_url)!}
                            className="absolute inset-0 h-full w-full"
                            allowFullScreen
                            allow="fullscreen; picture-in-picture"
                            title={l.title}
                          />
                        </div>
                      ) : (
                        <a href={l.video_url} target="_blank" rel="noopener noreferrer" className="zg-capsule-accent inline-block text-[11px]">
                          解説動画を見る ↗
                        </a>
                      )
                    )}
                    {l.steps.length === 0 ? (
                      <div className="text-[11px] text-faint">（内容はまだありません）</div>
                    ) : (
                      l.steps.map((s, i) => (
                        <div key={s.id} className="flex gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 font-display text-[11px] text-accent">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-sumi">{s.title}</div>
                            {s.body && (
                              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-mid">{linkify(s.body)}</p>
                            )}
                            {s.link_url && /^https?:\/\//.test(s.link_url) && (
                              <a
                                href={s.link_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="zg-capsule-accent mt-2 inline-block text-[11px]"
                              >
                                {s.link_label?.trim() || "リンクを開く"} ↗
                              </a>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
