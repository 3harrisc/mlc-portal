-- Vehicles table — the canonical fleet list.
--
-- Until now the portal inferred vehicles from `runs.vehicle` (free-text). The
-- planner needs an authoritative list for the "vehicle availability strip" at
-- the top of the daily transport sheet (greys out / hides vehicles that have
-- already been assigned to a leg today).
--
-- Seeded with the 10 vehicles the operator confirmed:
-- B12MLC, B14MLC, B15MLC, B7MLC, C2MLC, C12MLC, C20MLC, D1MLC, E1MLC, X24CAL.

create table if not exists vehicles (
  id           text primary key,        -- e.g. 'B12MLC' (uppercase)
  description  text not null default '',
  active       boolean not null default true,
  /* Display order (lower = earlier). Defaults to 100 so seeded rows
     keep their alphabetical order; admin UI can override. */
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now()
);

create index if not exists vehicles_active_sort_idx
  on vehicles (active, sort_order, id);

alter table vehicles enable row level security;

create policy "Authenticated users can read vehicles"
  on vehicles for select
  using (auth.uid() is not null);

create policy "Admins can manage vehicles"
  on vehicles for all
  using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

-- Seed the canonical 10. Idempotent.
insert into vehicles (id) values
  ('B7MLC'), ('B12MLC'), ('B14MLC'), ('B15MLC'),
  ('C2MLC'), ('C12MLC'), ('C20MLC'),
  ('D1MLC'), ('E1MLC'),
  ('X24CAL')
on conflict (id) do nothing;
