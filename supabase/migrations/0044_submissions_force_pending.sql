-- 0044: 提出insert時に status='pending' を強制し、承認系の列を null 化（偽装防止）。
-- 承認は submission-approve(service_role) の UPDATE のみで行う。
create or replace function public.video_submissions_force_pending() returns trigger
language plpgsql as $$
begin
  new.status := 'pending';
  new.buffer_result := null;
  new.drive_folder := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end $$;

drop trigger if exists trg_video_submissions_insert on public.video_submissions;
create trigger trg_video_submissions_insert
  before insert on public.video_submissions
  for each row execute function public.video_submissions_force_pending();
