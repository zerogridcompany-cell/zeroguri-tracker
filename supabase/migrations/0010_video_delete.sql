-- 0010_video_delete.sql — tracked_videos の削除権限
-- 自分の連携アカウント由来の動画（クリエイター）、または 主催案件の動画（オーガナイザー）を削除可。
-- view_snapshots / campaign_video_links は FK on delete cascade で自動削除。

drop policy if exists tracked_delete on public.tracked_videos;
create policy tracked_delete on public.tracked_videos
  for delete using (
    exists (
      select 1 from public.linked_accounts la
      where la.id = tracked_videos.linked_account_id and la.user_id = auth.uid()
    )
    or exists (
      select 1 from public.campaigns c
      where c.id = tracked_videos.campaign_id and c.owner_id = auth.uid()
    )
  );
