-- Invoicing & Xero export.
--
-- Extends `runs` with the columns the legacy Master Planner spreadsheet kept in
-- its daily transport sheets and Invoicing sheets, then adds three small
-- reference tables (trailers, depots, customer_xero_map) and an
-- invoice_counter for atomic sequence reservation during CSV export.
--
-- See planning notes in the chat history for the original VBA mapping.

-------------------------------------------------------------------------------
-- 1. Extend runs with planner / invoicing columns
-------------------------------------------------------------------------------

alter table runs
  -- Daily-sheet columns that have no portal equivalent yet
  add column if not exists factory          text,
  add column if not exists booking_time     text,
  add column if not exists subby_driver     text,
  add column if not exists subby_cost       numeric(10, 2),
  add column if not exists trailer_number   text,
  add column if not exists trailer_dropped  boolean not null default false,
  add column if not exists reference        text,
  -- Invoicing columns. Revenue is the £ amount that lives in the bottom
  -- "Vehicle Earnings UK Deliveries" matrix today; we promote it to a first-
  -- class column on the run row.
  add column if not exists revenue          numeric(10, 2) not null default 0,
  add column if not exists billable         boolean not null default false,
  add column if not exists invoice_status   text not null default 'open',
  add column if not exists xero_invoice_id  text,
  add column if not exists xero_exported_at timestamptz;

-- Constrain invoice_status to the values we actually use.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runs_invoice_status_check'
  ) then
    alter table runs
      add constraint runs_invoice_status_check
      check (invoice_status in ('open', 'billable', 'sent', 'paid', 'cancelled'));
  end if;
end $$;

create index if not exists runs_billable_idx
  on runs (billable)
  where billable = true;

create index if not exists runs_invoice_status_idx
  on runs (invoice_status);

create index if not exists runs_xero_invoice_id_idx
  on runs (xero_invoice_id)
  where xero_invoice_id is not null;

-------------------------------------------------------------------------------
-- 2. Trailers reference table
--    Replaces the spreadsheet's TrailerList sheet (objectname column).
-------------------------------------------------------------------------------

create table if not exists trailers (
  id           text primary key,        -- e.g. 'MLC014'
  description  text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table trailers enable row level security;

create policy "Authenticated users can read trailers"
  on trailers for select
  using (auth.uid() is not null);

create policy "Admins can insert trailers"
  on trailers for insert
  with check (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

create policy "Admins can update trailers"
  on trailers for update
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

create policy "Admins can delete trailers"
  on trailers for delete
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

-- Seed from the spreadsheet's TrailerList. Idempotent.
insert into trailers (id) values
  ('MLC001'), ('MLC002'), ('LTL121'), ('MLC004'), ('MLC005'),
  ('MLC006'), ('MLC007'), ('MLC008'), ('MLC009'), ('MLC010'),
  ('MLC012'), ('MLC014'), ('MLC015'), ('MLC016'), ('MLC017'),
  ('MLC020'), ('MLC023'), ('MLC024'), ('MLC025'), ('MLC026'),
  ('MLC034'), ('MLC035')
on conflict (id) do nothing;

-------------------------------------------------------------------------------
-- 3. Depots reference table
--    Replaces the spreadsheet's Depots sheet. Used to classify a trailer
--    as "at depot" vs "on the road" using a radius check against the
--    WebFleet feed.
-------------------------------------------------------------------------------

create table if not exists depots (
  id          text primary key,        -- short slug, e.g. 'hq'
  name        text not null,
  latitude    double precision not null,
  longitude   double precision not null,
  radius_m    integer not null default 200,
  created_at  timestamptz not null default now()
);

alter table depots enable row level security;

create policy "Authenticated users can read depots"
  on depots for select
  using (auth.uid() is not null);

create policy "Admins can manage depots"
  on depots for all
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

insert into depots (id, name, latitude, longitude, radius_m) values
  ('hq',           'HQ',           51.872640, -1.964977, 100),
  ('montpellier',  'Montpellier',  51.782087, -2.311855, 200),
  ('ashwood',      'Ashwood',      51.720697, -3.449099, 150),
  ('brakes_newark','Brakes Newark',53.126452, -1.011047, 200),
  ('rlc',          'RLC',          52.002252, -2.131956, 200)
on conflict (id) do nothing;

-------------------------------------------------------------------------------
-- 4. Customer → Xero mapping table
--    Replaces the spreadsheet's XeroMap sheets. Each weekly XeroMap sheet was
--    identical, so we collapse them into one canonical mapping.
-------------------------------------------------------------------------------

create table if not exists customer_xero_map (
  id                  uuid primary key default gen_random_uuid(),
  -- The name as it appears on the run row (planner-side).
  planner_name        text not null unique,
  -- What Xero expects in the ContactName column. If null, falls back to
  -- planner_name. Lets the planner say "Montpellier" while Xero gets the full
  -- registered company name.
  xero_contact_name   text,
  account_code        text not null default '200',
  tax_type            text not null default 'OUTPUT2',
  -- Days after end-of-invoice-month before payment is due. 30 = net-30 from
  -- end-of-month (~net-60 from invoice date in practice).
  due_days            integer not null default 30,
  email_address       text,
  branding_theme      text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists customer_xero_map_planner_name_lower_idx
  on customer_xero_map (lower(planner_name));

alter table customer_xero_map enable row level security;

create policy "Authenticated users can read xero map"
  on customer_xero_map for select
  using (auth.uid() is not null);

create policy "Admins can manage xero map"
  on customer_xero_map for all
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

-- Seed the defaults that appeared in the spreadsheet's XeroMap.
insert into customer_xero_map (planner_name, account_code, tax_type, due_days)
values
  ('MONTPELLIER', '400', 'OUTPUT2', 30),
  ('CONSOLID8',   '400', 'OUTPUT2', 30),
  ('COTTESWOLD',  '400', 'OUTPUT2', 30),
  ('default',     '400', 'OUTPUT2', 30)
on conflict (planner_name) do nothing;

-------------------------------------------------------------------------------
-- 5. Invoice counter
--    Atomic sequence for Xero invoice numbers. Mirrors the existing
--    `job_counters` / `increment_job_counter()` pattern from migration 003.
-------------------------------------------------------------------------------

create table if not exists invoice_counter (
  id          text primary key,        -- 'xero' (room for future sequences)
  counter     integer not null default 0
);

alter table invoice_counter enable row level security;

create policy "Authenticated users can read invoice counter"
  on invoice_counter for select
  using (auth.uid() is not null);

-- Reservation is done exclusively through the rpc; deny direct writes from
-- clients so the counter can only advance through the atomic increment.
create policy "Service role only invoice counter writes"
  on invoice_counter for insert
  with check (false);

create policy "Service role only invoice counter updates"
  on invoice_counter for update
  using (false);

-- Seed the counter so the first reserved number is 99450 (the spreadsheet's
-- LastInvoiceNumber on Dashboard!A16 was 99449 at handover).
insert into invoice_counter (id, counter)
values ('xero', 99449)
on conflict (id) do nothing;

-- Atomically reserve `n` invoice numbers and return the highest one issued.
-- Caller numbers each invoice as (returned - n + 1) ... returned.
create or replace function reserve_invoice_numbers(p_id text, p_count integer)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into invoice_counter (id, counter)
  values (p_id, p_count)
  on conflict (id) do update
    set counter = invoice_counter.counter + p_count
  returning counter;
$$;

revoke all on function reserve_invoice_numbers(text, integer) from public;
grant execute on function reserve_invoice_numbers(text, integer) to authenticated;
