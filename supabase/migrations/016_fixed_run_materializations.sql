-- Track which fixed-run specs have already been materialised for a given
-- date so that deleting a fixed-run row from the planner doesn't cause it
-- to reappear on the next page-load or cron tick.
--
-- Before this migration, `materializeFixedRuns(date)` decided whether to
-- (re)insert a fixed-run row purely by checking whether a `runs` row with
-- the deterministic id `fixed-{slug}-{date}` existed. Deleting the row
-- removed that id, so the very next call recreated it. The dispatcher
-- couldn't permanently dismiss a fixed run for the day.
--
-- With this table:
--   * Each (slug, date) pair gets a marker row when the run is materialised.
--   * The materialiser checks the marker first; if present, the spec is
--     skipped for that date even if the underlying `runs` row no longer
--     exists.
--   * The next weekday is unaffected — it has its own (slug, date) row to
--     create from scratch.

create table if not exists fixed_run_materializations (
  slug text not null,
  date date not null,
  materialized_at timestamptz not null default now(),
  primary key (slug, date)
);

alter table fixed_run_materializations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema() and tablename = 'fixed_run_materializations'
      and policyname = 'Authenticated users can read fixed_run_materializations'
  ) then
    create policy "Authenticated users can read fixed_run_materializations"
      on fixed_run_materializations for select
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema() and tablename = 'fixed_run_materializations'
      and policyname = 'Authenticated users can insert fixed_run_materializations'
  ) then
    create policy "Authenticated users can insert fixed_run_materializations"
      on fixed_run_materializations for insert
      with check (auth.uid() is not null);
  end if;
end $$;

-- Backfill: any existing fixed-run rows in `runs` should be treated as
-- already-materialised so we don't try to recreate them on the first
-- post-migration call.
insert into fixed_run_materializations (slug, date)
select
  -- id format is `fixed-{slug}-{yyyy-mm-dd}`; strip the prefix and the
  -- trailing date to recover the slug.
  substring(id from 7 for length(id) - 17) as slug,
  date
from runs
where id like 'fixed-%'
on conflict (slug, date) do nothing;
