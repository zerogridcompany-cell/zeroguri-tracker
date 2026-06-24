"use client";

// web/components/ManualPending.tsx — 手動（投稿前承認）の提出状況（クリエイター）。
//  承認は「投稿してOK」の確認。承認後は自分で投稿し、「動画を追加」で計測登録する。

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PlatformIcon } from "@/components/PlatformIcon";

type Platform = "youtube" | "tiktok" | "instagram";

interface ManualSub {
  id: string;
  platform: Platform | null;
  handle: string | null;
  caption: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export function ManualPending({ refreshKey }: { refreshKey?: number }) {
  const [items, setItems] = useState<ManualSub[]>([]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return;
    const { data } = await supabase
      .from("video_submissions")
      .select("id, platform, handle, caption, status, created_at")
      .eq("user_id", uid)
      .eq("submission_type", "manual")
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as ManualSub[]);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh, refreshKey]);

  if (items.length === 0) return null;

  return (
    <section>
      <div className="zg-eyebrow-ja mb-2">提出状況（{items.length}）</div>
      <div className="space-y-2">
        {items.map((s) => {
          const approved = s.status === "approved";
          return (
            <div key={s.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2">
                {s.platform && <PlatformIcon platform={s.platform} size={16} />}
                <div className="min-w-0 flex-1">
                  {s.handle && <span className="block truncate text-[12px] text-sumi">@{s.handle.replace(/^@/, "")}</span>}
                  {s.caption && <span className="block truncate text-[11px] text-faint">{s.caption}</span>}
                </div>
                <span className={"shrink-0 text-[10px] " + (approved ? "text-status-completed" : "text-accent")}>
                  {approved ? "✓ 承認済み・投稿OK" : "承認待ち"}
                </span>
              </div>
              {approved && (
                <p className="mt-2 text-[11px] text-faint">
                  投稿したら「動画を追加」から計測に登録してください。
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
