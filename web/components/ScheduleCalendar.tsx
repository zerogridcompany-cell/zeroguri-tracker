"use client";

// web/components/ScheduleCalendar.tsx — 予約投稿の月カレンダー（プレゼンテーション）
// 予約が入っている日に印（件数バッジ＋プラットフォームのドット）を出す。日付タップで親に通知。

import { useMemo, useState } from "react";

type Platform = "youtube" | "tiktok" | "instagram";
export type CalTone = "scheduled" | "pending" | "manual";

export interface CalEvent {
  id: string;
  key: string; // YYYY-MM-DD（ローカル＝JST想定）
  platform: Platform | null;
  tone: CalTone;
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const DOT: Record<string, string> = { instagram: "#C13584", youtube: "#C4302B", tiktok: "#111111" };
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
export function localKey(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return keyOf(d.getFullYear(), d.getMonth(), d.getDate());
}
// buffer_result が「実際に Buffer 予約済み（unscheduled/no_channel 以外）」か。3画面で共通利用。
export const REAL_BUFFER = (b: string | null): boolean =>
  Boolean(b && !["unscheduled", "no_channel"].includes(b));

export function ScheduleCalendar({
  events,
  selectedKey,
  onSelectDay,
  onMonthChange,
}: {
  events: CalEvent[];
  selectedKey: string | null;
  onSelectDay: (key: string) => void;
  onMonthChange?: (y: number, m: number) => void;
}) {
  const today = new Date();
  const todayKey = keyOf(today.getFullYear(), today.getMonth(), today.getDate());
  const [view, setView] = useState<{ y: number; m: number }>({ y: today.getFullYear(), m: today.getMonth() });

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const arr = map.get(e.key) ?? [];
      arr.push(e);
      map.set(e.key, arr);
    }
    return map;
  }, [events]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    setView((v) => {
      const m = v.m + delta;
      const next = { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
      onMonthChange?.(next.y, next.m);
      return next;
    });
  };

  return (
    <div>
      {/* 月ナビ */}
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="zg-capsule" aria-label="前の月">
          ‹
        </button>
        <div className="font-display text-sm text-sumi">
          {view.y}年 {view.m + 1}月
        </div>
        <button type="button" onClick={() => shift(1)} className="zg-capsule" aria-label="次の月">
          ›
        </button>
      </div>

      {/* 曜日 */}
      <div className="grid grid-cols-7 gap-1">
        {WEEK.map((w, i) => (
          <div
            key={w}
            className={"pb-1 text-center text-[10px] " + (i === 0 ? "text-[#A8443A]" : i === 6 ? "text-accent" : "text-faint")}
          >
            {w}
          </div>
        ))}

        {/* 日セル */}
        {cells.map((d, i) => {
          if (d === null) return <div key={"b" + i} />;
          const key = keyOf(view.y, view.m, d);
          const evs = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSel = key === selectedKey;
          const platforms = [...new Set(evs.map((e) => e.platform).filter(Boolean))] as Platform[];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(key)}
              className={
                "flex aspect-square flex-col items-center justify-start rounded-lg border p-1 text-center transition-colors " +
                (isSel
                  ? "border-accent bg-accent/10"
                  : evs.length > 0
                    ? "border-line bg-accent/[0.04] hover:border-accent/40"
                    : "border-transparent hover:bg-line")
              }
            >
              <span
                className={
                  "text-[11px] " +
                  (isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-sumi font-display text-white" : "text-sumi")
                }
              >
                {d}
              </span>
              {evs.length > 0 && (
                <span className="mt-auto flex flex-col items-center gap-0.5">
                  <span className="flex items-center gap-0.5">
                    {platforms.slice(0, 3).map((p) => (
                      <span key={p} className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[p] ?? "#888" }} />
                    ))}
                  </span>
                  <span className="rounded-full bg-accent/15 px-1.5 text-[9px] leading-tight text-accent">
                    {evs.length}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
