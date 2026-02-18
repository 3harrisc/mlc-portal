-- Runs table: stores all planned delivery runs
create table if not exists runs (
  id                     text primary key,
  job_number             text not null,
  load_ref               text not null default '',
  date                   date not null,
  customer               text not null,
  vehicle                text not null default '',
  from_postcode          text not null,
  to_postcode            text not null default '',
  return_to_base         boolean not null default true,
  start_time             text not null default '08:00',
  service_mins           integer not null default 25,
  include_breaks         boolean not null default true,
  raw_text               text not null default '',
  completed_stop_indexes integer[] not null default '{}',
  completed_meta         jsonb not null default '{}',
  progress               jsonb not null default '{"completedIdx":[],"onSiteIdx":null,"onSiteSinceMs":null,"lastInside":false}',
  created_by             uuid references profiles(id),
  created_at             timestamptz not null default now()
);

create index if not exists runs_date_idx on runs (date desc);
create index if not exists runs_customer_idx on runs (customer);

alter table runs enable row level security;

-- All authenticated users can read runs
create policy "Authenticated users can read runs"
  on runs for select
  using (auth.uid() is not null);

-- All authenticated users can insert runs
create policy "Authenticated users can insert runs"
  on runs for insert
  with check (auth.uid() is not null);

-- All authenticated users can update runs
create policy "Authenticated users can update runs"
  on runs for update
  using (auth.uid() is not null);

-- All authenticated users can delete runs
create policy "Authenticated users can delete runs"
  on runs for delete
  using (auth.uid() is not null);

-- Templates table: saved route configurations
create table if not exists templates (
  id               text primary key,
  name             text not null,
  customer         text not null,
  from_postcode    text not null,
  to_postcode      text not null default '',
  return_to_base   boolean not null default true,
  start_time       text not null default '08:00',
  service_mins     integer not null default 25,
  include_breaks   boolean not null default true,
  raw_text         text not null default '',
  active_weekdays  jsonb not null default '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true}',
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now()
);

alter table templates enable row level security;

create policy "Authenticated users can read templates"
  on templates for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert templates"
  on templates for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update templates"
  on templates for update
  using (auth.uid() is not null);

create policy "Authenticated users can delete templates"
  on templates for delete
  using (auth.uid() is not null);

-- Job counters: atomic per-date counter for job numbers
create table if not exists job_counters (
  date_key text primary key,
  counter  integer not null default 0
);

alter table job_counters enable row level security;

create policy "Authenticated users can read job counters"
  on job_counters for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert job counters"
  on job_counters for insert
  with check (auth.uid() is not null);

create policy "Authenticated users can update job counters"
  on job_counters for update
  using (auth.uid() is not null);

-- Atomic job counter increment (upsert + return new value)
create or replace function increment_job_counter(p_date_key text)
returns integer as $$
  insert into job_counters (date_key, counter)
  values (p_date_key, 1)
  on conflict (date_key) do update set counter = job_counters.counter + 1
  returning counter;
$$ language sql;
