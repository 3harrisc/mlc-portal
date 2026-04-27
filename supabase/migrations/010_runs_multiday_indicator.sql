-- Multi-day trip indicator on `runs`.
--
-- Mirrors the spreadsheet's "DAYS · 1 OF 2" three-cell layout. We store it
-- as two integers and let the UI render "1 OF 2".
--   day_index = which day of the multi-day trip this leg represents (1, 2, …)
--   day_count = how many days the whole trip lasts (2, 3, …)
-- Both null means a single-day leg (the default).

alter table runs
  add column if not exists day_index integer,
  add column if not exists day_count integer;

-- Sanity: a leg must either have neither set, or both set with index ≤ count.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runs_day_indicator_check'
  ) then
    alter table runs
      add constraint runs_day_indicator_check
      check (
        (day_index is null and day_count is null)
        or (day_index is not null and day_count is not null
            and day_index >= 1 and day_count >= 1
            and day_index <= day_count)
      );
  end if;
end $$;
