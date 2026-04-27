-- Customer-facing "loads" — separated from dispatch runs.
--
-- Why this exists
-- ----------------
-- Until now, /portal/loads (customer tracking + Ashwood forward-planning) and
-- the dispatch planner (/runs, /portal/planner) both read/write the same
-- `runs` table. That meant:
--   1. Bulk-deleting on /portal/loads wiped rows from the planner too.
--   2. Customer portal bookings (`createPortalBooking`, id LIKE 'portal-%')
--      were polluting the invoicing view.
--
-- This migration splits the two:
--   * `loads`  — customer pre-bookings + Ashwood forward planning.
--   * `runs`   — dispatch planner (unchanged).
--
-- Schema is identical so we can reuse the existing PlannedRun type +
-- rowToRun / runToRow converters. Rather than re-listing every column
-- (which risks type drift — collection_date came from a UI-side ALTER and
-- ended up `text` in production, not `date` like an earlier draft of this
-- migration assumed), we use `CREATE TABLE loads (LIKE runs INCLUDING ALL)`
-- so column types and defaults are guaranteed to match runs exactly.
--
-- LIKE does NOT copy foreign keys, so we re-add the `created_by` FK by hand.
--
-- Data migration (one-shot, idempotent via "loads is empty" guard):
--   * Move Ashwood non-legacy rows from runs → loads (forward planning).
--   * Move ALL portal-booked rows (id LIKE 'portal-%') from runs → loads.
-- Done atomically with DELETE … RETURNING so there's no race window.
--
-- Legacy Excel imports (id LIKE 'legacy-%') stay in `runs` for invoicing
-- reconciliation regardless of customer.

-------------------------------------------------------------------------------
-- 0. If a previous, broken run created an empty `loads` table with drifted
--    types, drop it so we can recreate cleanly. Only drops when empty so
--    re-running this migration is safe.
-------------------------------------------------------------------------------

do $$
declare
  v_exists boolean;
  v_count  integer;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = current_schema() and table_name = 'loads'
  ) into v_exists;

  if v_exists then
    execute 'select count(*) from loads' into v_count;
    if v_count = 0 then
      raise notice 'loads table exists but is empty — dropping for clean recreate';
      drop table loads cascade;
    else
      raise notice 'loads table exists with % rows — leaving it alone', v_count;
    end if;
  end if;
end $$;

-------------------------------------------------------------------------------
-- 1. Create `loads` as an exact structural clone of `runs`.
--    INCLUDING ALL preserves: defaults, constraints, indexes, identity,
--    storage, comments, statistics. It does NOT copy foreign keys — those
--    are re-added below.
-------------------------------------------------------------------------------

create table if not exists loads (like runs including all);

-- Re-add the created_by → profiles(id) FK that LIKE doesn't copy.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'loads' and c.conname = 'loads_created_by_fkey'
  ) then
    alter table loads
      add constraint loads_created_by_fkey
      foreign key (created_by) references profiles(id);
  end if;
end $$;

-------------------------------------------------------------------------------
-- 2. RLS — same posture as runs (admins everything; customer scoping is
--    enforced in app code via profile.allowed_customers, identical to the
--    runs flow).
-------------------------------------------------------------------------------

alter table loads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema() and tablename = 'loads'
      and policyname = 'Authenticated users can read loads'
  ) then
    create policy "Authenticated users can read loads"
      on loads for select
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema() and tablename = 'loads'
      and policyname = 'Authenticated users can insert loads'
  ) then
    create policy "Authenticated users can insert loads"
      on loads for insert
      with check (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema() and tablename = 'loads'
      and policyname = 'Authenticated users can update loads'
  ) then
    create policy "Authenticated users can update loads"
      on loads for update
      using (auth.uid() is not null);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = current_schema() and tablename = 'loads'
      and policyname = 'Authenticated users can delete loads'
  ) then
    create policy "Authenticated users can delete loads"
      on loads for delete
      using (auth.uid() is not null);
  end if;
end $$;

-------------------------------------------------------------------------------
-- 3. One-shot data migration runs ↦ loads.
--    Atomic via DELETE … RETURNING into a CTE so there's no window where a
--    concurrent insert into runs could be deleted but never copied across.
--    Guarded with "only when loads is empty" so re-running is a no-op.
-------------------------------------------------------------------------------

do $$
declare
  v_loads_count integer;
  v_moved       integer := 0;
begin
  select count(*) into v_loads_count from loads;
  if v_loads_count > 0 then
    raise notice 'loads table not empty (%) — skipping data migration', v_loads_count;
    return;
  end if;

  -- Atomic move: DELETE matching rows from runs, INSERT them into loads.
  --   a) Ashwood non-legacy rows (forward planning lives on /portal/loads).
  --   b) All portal bookings (id like 'portal-%') so they leave invoicing.
  --
  -- Because loads has identical structure to runs (CREATE TABLE LIKE runs),
  -- we can omit the column lists entirely — `insert into loads select * from
  -- moved` is type-safe.
  with moved as (
    delete from runs
    where (
      (lower(customer) = 'ashwood' and id not like 'legacy-%')
      or id like 'portal-%'
    )
    returning *
  )
  insert into loads
  select * from moved;

  get diagnostics v_moved = row_count;
  raise notice 'Moved % rows from runs to loads', v_moved;
end $$;
