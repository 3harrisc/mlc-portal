-- Driver records (the HR file for each driver) and the files MLC holds on them.
--
-- hr_drivers is the single source of truth for a driver's personal and
-- employment details. It is filled largely from an AssetGo licence check (read
-- by the HR assistant), plus details AssetGo doesn't hold (NI number, phone,
-- start date...). profile_id links the record to the driver's portal login so
-- their signed documents can be shown alongside it.
--
-- licence holds the details from the most recent licence check as JSON
-- (categories, endorsements, tacho card, CPC) - the source PDF is kept in
-- hr_driver_files.
--
-- Contains special category and criminal offence data (see MLC's Appropriate
-- Policy Document): admin-only reads, writes via server actions only.

create table if not exists hr_drivers (
  id                          uuid primary key default gen_random_uuid(),
  profile_id                  uuid unique references profiles(id) on delete set null,
  status                      text not null default 'starter'
                                check (status in ('starter', 'active', 'left')),
  first_names                 text not null check (length(trim(first_names)) > 0),
  surname                     text not null check (length(trim(surname)) > 0),
  date_of_birth               date,
  address                     text,
  postcode                    text,
  phone                       text,
  email                       text,
  ni_number                   text,
  emergency_contact_name      text,
  emergency_contact_phone     text,
  start_date                  date,
  continuous_employment_date  date,
  leave_date                  date,
  notes                       text,
  licence                     jsonb,
  licence_checked_on          date,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists hr_drivers_status_idx on hr_drivers (status);

create table if not exists hr_driver_files (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references hr_drivers(id) on delete cascade,
  kind          text not null check (kind in ('licence_check', 'right_to_work', 'cpc_card', 'tacho_card', 'other')),
  title         text not null,
  storage_path  text not null unique,
  file_sha256   text not null,
  file_size     integer,
  -- What the assistant read from a licence check, kept for the audit trail.
  extracted     jsonb,
  uploaded_by   uuid references auth.users(id) on delete set null,
  uploaded_at   timestamptz not null default now()
);

create index if not exists hr_driver_files_driver_idx on hr_driver_files (driver_id, uploaded_at desc);

alter table hr_drivers      enable row level security;
alter table hr_driver_files enable row level security;

drop policy if exists "Admins read hr drivers" on hr_drivers;
create policy "Admins read hr drivers"
  on hr_drivers for select
  using (public.get_my_role() = 'admin');

drop policy if exists "Admins read hr driver files" on hr_driver_files;
create policy "Admins read hr driver files"
  on hr_driver_files for select
  using (public.get_my_role() = 'admin');

-- Driver files share the private hr-documents bucket; allow common scan and
-- photo formats for right-to-work evidence and card copies.
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/heic']
 where id = 'hr-documents';
