-- Manual stage override for runs and loads.
--
-- Why this exists
-- ----------------
-- Load status is DERIVED, not stored — deriveStatus() in
-- src/lib/portal/loads.ts infers it from geofence progress + date + vehicle.
-- That's right almost always and wrong exactly when it matters: a breakdown,
-- a refused delivery, a tracker outage. These columns let an admin pin the
-- status; deriveStatus returns the override before consulting anything else.
--
-- The override is sticky. Nothing in /api/cron/update-progress reads or
-- writes it — only an explicit admin action sets or clears it.
--
-- IMPORTANT: both tables need altering separately. Migration 013 created
-- `loads` with CREATE TABLE loads (LIKE runs INCLUDING ALL), which copies
-- the shape at creation time and does NOT track columns added to `runs`
-- afterwards.

alter table runs  add column if not exists status_override    text;
alter table runs  add column if not exists status_override_by uuid;
alter table runs  add column if not exists status_override_at timestamptz;

alter table loads add column if not exists status_override    text;
alter table loads add column if not exists status_override_by uuid;
alter table loads add column if not exists status_override_at timestamptz;

-- Constraints are added conditionally so re-running the migration is safe
-- (ADD CONSTRAINT has no IF NOT EXISTS form).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'runs_status_override_check'
  ) then
    alter table runs add constraint runs_status_override_check
      check (status_override is null or status_override in
        ('in-transit', 'delivered', 'scheduled', 'exception', 'delayed', 'loading'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'loads_status_override_check'
  ) then
    alter table loads add constraint loads_status_override_check
      check (status_override is null or status_override in
        ('in-transit', 'delivered', 'scheduled', 'exception', 'delayed', 'loading'));
  end if;

  -- LIKE doesn't copy foreign keys, so both get theirs added by hand — same
  -- reason migration 013 re-added the created_by FK.
  if not exists (
    select 1 from pg_constraint where conname = 'runs_status_override_by_fkey'
  ) then
    alter table runs add constraint runs_status_override_by_fkey
      foreign key (status_override_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'loads_status_override_by_fkey'
  ) then
    alter table loads add constraint loads_status_override_by_fkey
      foreign key (status_override_by) references auth.users(id) on delete set null;
  end if;
end $$;
