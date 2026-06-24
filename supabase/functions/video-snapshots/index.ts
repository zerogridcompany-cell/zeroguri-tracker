// video-snapshots — 動画の再生数推移（view_snapshots）を返す（verify_jwt=true / オーガナイザー専用）
import { error, handleOptions, json } from "../_shared/cors.ts";
import { admin, getUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const user = await getUser(req);
    if (!user) return error("unauthorized", 401);
    const db = admin();

    // オーガナイザー確認
    const { data: me } = await db.from("app_users").select("email").eq("id", user.id).maybeSingle();
    const { data: org } = await db
      .from("organizer_emails").select("email").ilike("email", me?.email ?? "___none___").maybeSingle();
    if (!org) return error("forbidden", 403);

    const url = new URL(req.url);
    let id = url.searchParams.get("trackedVideoId") ?? undefined;
    if (!id && (req.method === "POST")) {
      const body = await req.json().catch(() => ({}));
      id = body.trackedVideoId;
    }
    if (!id) return error("trackedVideoId required", 400);

    const [{ data: v }, { data: snaps }] = await Promise.all([
      db.from("tracked_videos")
        .select("id, platform, content_id, title, url, cap, last_views, status, next_check_at, last_checked_at")
        .eq("id", id).maybeSingle(),
      db.from("view_snapshots")
        .select("captured_at, views, raw_views")
        .eq("tracked_video_id", id)
        .order("captured_at", { ascending: true })
        .limit(2000),
    ]);
    if (!v) return error("video not found", 404);

    return json({
      video: {
        trackedVideoId: v.id,
        platform: v.platform,
        contentId: v.content_id,
        title: v.title,
        url: v.url,
        cap: Number(v.cap ?? 0),
        lastViews: Number(v.last_views ?? 0),
        status: v.status,
        nextCheckAt: v.next_check_at,
        lastCheckedAt: v.last_checked_at,
      },
      snapshots: (snaps ?? []).map((s) => ({
        capturedAt: s.captured_at,
        views: Number(s.views ?? 0),
        rawViews: Number(s.raw_views ?? 0),
      })),
    });
  } catch (e) {
    return error(String(e), 500);
  }
});
