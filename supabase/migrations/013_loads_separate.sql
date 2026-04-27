-- Customer-facing "loads" — separated from dispatch runs.
--
-- Why this exists
-- ----------------
-- Until now, /portal/loads (customer tracking + Ashwood forward-planning) and
-- the dispatch planner (/runs, /portal/planner) both read/write the same
-- `runs` table. That meant:
--   1. Bulk-deleting on /portal/loads wiped rows from the planner too.
--   2. Customer portal bookings (`createPortalBooking`, id LIKE 'portal-%')
--      were polluting the invoicing view because they sat next to real
--      dispatch runs in the same table.
--
-- This migration splits the two:
--   * `loads`  — customer pre-bookings + Ashwood forward planning.
--   * `runs`   — dispatch planner (unchanged).
--
-- Schema is identical so we can reuse the existing PlannedRun type +
-- rowToRun / runToRow converters. The only thing that differs is the table.
--
-- Data migration (one-shot, idempotent via "if loads is empty" guard):
--   * Copy Ashwood non-legacy rows from runs → loads (forward planning).
--   * Copy ALL portal-booked rows (id LIKE 'portal-%') from runs → loads.
--   * Delete those moved rows from runs so they no longer appear in the
--     planner / invoicing / figures totals.
--
-- Legacy Excel imports (id LIKE 'legacy-%') stay in `runs` for invoicing
-- reconciliation regardless of customer.

-------------------------------------------------------------------------------
-- 1. Create the loads table — exact mirror of runs (+ same indexes & RLS).
-------------------------------------------------------------------------------

create table if not exists loads (
  id                       text primary key,
  job_number               text not null default '',
  load_ref                 text not null default '',
  date                     date not null,
  customer                 text not null,
  vehicle                  text not null default '',
  from_postcode            text not null,
  to_postcode              text not null default '',
  return_to_base           boolean not null default true,
  start_time               text not null default '08:00',
  service_mins             integer not null default 25,
  include_breaks           boolean not null default true,
  raw_text                 text not null default '',
  completed_stop_indexes   integer[] not null default '{}',
  completed_meta           jsonb not null default '{}',
  progress                 jsonb not null default '{"completedIdx":[],"onSiteIdx":null,"onSiteSinceMs":null,"lastInside":false}',
  created_by               uuid references profiles(id),
  created_at               timestamptz not null default now(),
  -- Mirrored from migration 006 (share token)
  share_token              text,
  share_token_created_at   timestamptz,
  -- Mirrored from migration 008 (planner / invoicing extension columns)
  factory                  text,
  booking_time             text,
  subby_driver             text,
  subby_cost               numeric(10, 2),
  trailer_number           text,
  trailer_dropped          boolean not null default false,
  reference                text,
  revenue                  numeric(10, 2) not null default 0,
  billable                 boolean not null default false,
  invoice_status           text not null default 'open',
  xero_invoice_id          text,
  xero_exported_at         timestamptz,
  -- Mirrored from migration 010 (multi-day indicator)
  day_index                integer,
  day_count                integer,
  -- Mirrored from runs.run_type / run_order / collection_time / collection_date
  run_type                 text not null default 'regular',
  run_order                integer,
  collection_time          text,
  collection_date          date
);

-- Same constraint runs has on invoice_status.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loads_invoice_status_check'
  ) then
    alter table loads
      add constraint loads_invoice_status_check
      check (invoice_status in ('open', 'billable', 'sent', 'paid', 'cancelled'));
  end if;
end $$;

create index if not exists loads_date_idx          on loads (date desc);
create index if not exists loads_customer_idx      on loads (customer);
create index if not exists loads_load_ref_idx      on loads (load_ref) where load_ref <> '';
create unique index if not exists loads_share_token_unique
  on loads (share_token) where share_token is not null;

-------------------------------------------------------------------------------
-- 2. RLS — match the runs policies (admins everything; everyone else gated by
--    profile.allowed_customers in app code, same as the runs flow).
-------------------------------------------------------------------------------

alter table loads enable row level security;

create policy "Authenticated users can read loads"
  on loads for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert loads"
  on loads for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update loads"
  on loads for update
  using (auth.uid() is not null);

create policy "Authenticated users can delete loads"
  on loads for delete
  using (auth.uid() is not null);

-------------------------------------------------------------------------------
-- 3. One-shot data migration runs ↦ loads.
--    Guarded with "only when loads is empty" so re-running the migration is a
--    no-op. If you need to re-migrate, truncate `loads` first.
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

  -- Atomic move: DELETE … RETURNING into a CTE, then INSERT the returned
  -- rows into loads. This avoids any race window where a concurrent insert
  -- to runs could be deleted but never copied across.
  --   a) Ashwood non-legacy rows (forward planning lives on /portal/loads).
  --   b) All portal bookings (id like 'portal-%') so they leave invoicing.
  with moved as (
    delete from runs
    where (
      (lower(customer) = 'ashwood' and id not like 'legacy-%')
      or id like 'portal-%'
    )
    returning *
  )
  insert into loads (
    id, job_number, load_ref, date, customer, vehicle,
    from_postcode, to_postcode, return_to_base, start_time, service_mins,
    include_breaks, raw_text, completed_stop_indexes, completed_meta, progress,
    created_by, created_at, share_token, share_token_created_at,
    factory, booking_time, subby_driver, subby_cost, trailer_number,
    trailer_dropped, reference, revenue, billable, invoice_status,
    xero_invoice_id, xero_exported_at, day_index, day_count,
    run_type, run_order, collection_time, collection_date
  )
  select
    id, job_number, load_ref, date, customer, vehicle,
    from_postcode, to_postcode, return_to_base, start_time, service_mins,
    include_breaks, raw_text, completed_stop_indexes, completed_meta, progress,
    created_by, created_at, share_token, share_token_created_at,
    factory, booking_time, subby_driver, subby_cost, trailer_number,
    trailer_dropped, reference, revenue, billable, invoice_status,
    xero_invoice_id, xero_exported_at, day_index, day_count,
    run_type, run_order, collection_time, collection_date
  from moved;

  get diagnostics v_moved = row_count;
  raise notice 'Moved % rows from runs to loads', v_moved;
end $$;
