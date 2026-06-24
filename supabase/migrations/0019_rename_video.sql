-- 0019_rename_video.sql — クリエイターが自分の動画のタイトルだけ変更できる安全な関数
-- （tracked_videos に汎用 UPDATE ポリシーを付けると last_views 等 課金列も触れてしまうため関数で限定）
create or replace function public.rename_tracked_video(p_video_id uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tracked_videos tv
     set title = nullif(btrim(p_title), ''), updated_at = now()
   where tv.id = p_video_id
     and exists (
       select 1 from public.linked_accounts la
       where la.id = tv.linked_account_id and la.user_id = auth.uid()
     );
  if not found then
    raise exception 'not found or not allowed';
  end if;
end $$;
grant execute on function public.rename_tracked_video(uuid, text) to authenticated;
