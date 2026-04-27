-- Weekly cost tables for the Figures sheet.
--
-- Replaces the spreadsheet's `Figures_WK<n>_<yy>` sheets. Two tables:
--
-- 1. `weekly_vehicle_costs` — per-vehicle, per-week running costs and
--    consumables. One row per (year, week, vehicle).
-- 2. `weekly_extras` — per-week non-vehicle costs (Office, Vans, BBL,
--    SubbyCost) plus driver wages stored as JSON for flexibility.
--
-- Earnings, Profit/Loss, Gross Earnings, and Total Profit/Loss are NEVER
-- stored — they are derived from `runs.revenue` and these two tables.
-- (See lib/figures/aggregate.ts for the calculation.)

-------------------------------------------------------------------------------
-- 1. Per-vehicle weekly costs
-------------------------------------------------------------------------------

create table if not exists weekly_vehicle_costs (
  iso_year         integer not null,
  iso_week         integer not null,
  vehicle          text    not null,
  -- Total Running Costs (fixed weekly leasing/insurance/etc).
  running_cost     numeric(10, 2) not null default 0,
  -- Fuel UK (litres dispensed and £ ex-VAT).
  fuel_uk_litres   numeric(10, 2) not null default 0,
  fuel_uk_amount   numeric(10, 2) not null default 0,
  -- Fuel Lux (continental fuel, billed in £ after EU VAT recovery).
  fuel_lux_litres  numeric(10, 2) not null default 0,
  fuel_lux_amount  numeric(10, 2) not null default 0,
  -- Road tolls split by currency (the spreadsheet does the same).
  tolls_euro       numeric(10, 2) not null default 0,
  tolls_gbp        numeric(10, 2) not null default 0,
  parking          numeric(10, 2) not null default 0,
  adblue           numeric(10, 2) not null default 0,
  -- Catch-all for "Any other vehicle costing".
  other_cost       numeric(10, 2) not null default 0,
  notes            text,
  updated_at       timestamptz not null default now(),
  primary key (iso_year, iso_week, vehicle)
);

create index if not exists weekly_vehicle_costs_year_week_idx
  on weekly_vehicle_costs (iso_year, iso_week);

alter table weekly_vehicle_costs enable row level security;

create policy "Authenticated users can read weekly_vehicle_costs"
  on weekly_vehicle_costs for select
  using (auth.uid() is not null);

create policy "Admins can manage weekly_vehicle_costs"
  on weekly_vehicle_costs for all
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

-------------------------------------------------------------------------------
-- 2. Per-week extra costs (non-vehicle-keyed)
-------------------------------------------------------------------------------

create table if not exists weekly_extras (
  iso_year         integer not null,
  iso_week         integer not null,
  -- Fixed pots from the spreadsheet's "Extra Costings" block.
  office           numeric(10, 2) not null default 0,
  vans             numeric(10, 2) not null default 0,
  bbl              numeric(10, 2) not null default 0,
  subby_cost       numeric(10, 2) not null default 0,
  -- Driver wages — flexible because the named-driver list changes over time.
  -- Shape: { "Aussie": 0, "Roger": 0, "Fred": 0, ... }
  driver_wages     jsonb not null default '{}'::jsonb,
  notes            text,
  updated_at       timestamptz not null default now(),
  primary key (iso_year, iso_week)
);

alter table weekly_extras enable row level security;

create policy "Authenticated users can read weekly_extras"
  on weekly_extras for select
  using (auth.uid() is not null);

create policy "Admins can manage weekly_extras"
  on weekly_extras for all
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );
