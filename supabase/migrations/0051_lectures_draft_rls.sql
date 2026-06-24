-- 0051: 下書き（未公開）講義は本人=オーガナイザーのみ閲覧可に。
-- 0050 は read を using(true) にしていたため、未公開でもAPI直叩きで読めてしまう（公開フィルタはクライアント側のみ）。
drop policy if exists lectures_read on public.lectures;
create policy lectures_read on public.lectures
  for select using (published = true or public.is_organizer());

drop policy if exists lecture_steps_read on public.lecture_steps;
create policy lecture_steps_read on public.lecture_steps
  for select using (
    public.is_organizer()
    or exists (
      select 1 from public.lectures l
      where l.id = lecture_steps.lecture_id and l.published = true
    )
  );
