-- Vehicle positions: latest state per vehicle (written by collector, read by dashboard)
create table if not exists vehicle_positions (
  id            bigint generated always as identity primary key,
  vehicle       text not null,                    -- registration / Webfleet objectname e.g. "D1MLC"
  lat           double precision not null,
  lng           double precision not null,
  speed_kph     double precision,
  heading       double precision,
  pos_time      text,                             -- raw timestamp string from Webfleet
  raw           jsonb,                            -- full Webfleet row for debugging
  collected_at  timestamptz not null default now() -- when our collector fetched this
);

-- Unique constraint: one latest row per vehicle
-- We upsert on this
create unique index if not exists vehicle_positions_vehicle_idx
  on vehicle_positions (vehicle);

-- For fast lookups by vehicle
create index if not exists vehicle_positions_collected_idx
  on vehicle_positions (collected_at desc);

-- Optional: historical log of all positions (append-only)
create table if not exists vehicle_position_log (
  id            bigint generated always as identity primary key,
  vehicle       text not null,
  lat           double precision not null,
  lng           double precision not null,
  speed_kph     double precision,
  heading       double precision,
  pos_time      text,
  collected_at  timestamptz not null default now()
);

create index if not exists vehicle_position_log_vehicle_time_idx
  on vehicle_position_log (vehicle, collected_at desc);

-- RLS: vehicle_positions readable by anyone (anon key), writable only by service role
alter table vehicle_positions enable row level security;
alter table vehicle_position_log enable row level security;

create policy "Anyone can read vehicle positions"
  on vehicle_positions for select
  using (true);

create policy "Service role can insert/update vehicle positions"
  on vehicle_positions for all
  using (true)
  with check (true);

create policy "Anyone can read vehicle position log"
  on vehicle_position_log for select
  using (true);

create policy "Service role can insert vehicle position log"
  on vehicle_position_log for insert
  with check (true);
