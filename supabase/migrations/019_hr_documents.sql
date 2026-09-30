-- HR documents: contracts, health & safety policies and handbooks that
-- drivers read and sign electronically in driver mode.
--
-- Why this shape
-- --------------
-- * hr_documents holds one uploaded PDF each. The file's SHA-256 is recorded
--   at upload so a signature can prove exactly which bytes were signed.
--   Changing a document means uploading a new one (optionally pointing
--   supersedes_id at the old one) and archiving the old — the stored file is
--   never replaced in place.
-- * audience = 'all' applies to every driver, including ones added later.
--   audience = 'selected' applies only to rows in hr_document_assignments.
-- * resign_months (optional) makes a signature lapse, e.g. 12 for an annual
--   H&S refresher. Status is derived in src/lib/hr/status.ts, not stored.
-- * hr_signatures is an append-only audit log. A trigger blocks UPDATE and
--   DELETE for every role, including the service role. Driver name and email
--   are snapshotted so the record survives the driver's account being removed.
--
-- All writes go through server actions (src/app/actions/hr.ts) using the
-- service role after an explicit role check, so there are no insert/update
-- policies here — RLS only grants reads.

create table if not exists hr_documents (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  category       text not null default 'other'
                   check (category in ('contract', 'health_safety', 'policy', 'handbook', 'other')),
  description    text,
  storage_path   text not null unique,
  file_name      text,
  file_size      integer,
  file_sha256    text not null,
  audience       text not null default 'all' check (audience in ('all', 'selected')),
  resign_months  integer check (resign_months is null or resign_months between 1 and 120),
  status         text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  supersedes_id  uuid references hr_documents(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  archived_at    timestamptz
);

create index if not exists hr_documents_status_idx on hr_documents (status);

create table if not exists hr_document_assignments (
  document_id  uuid not null references hr_documents(id) on delete cascade,
  driver_id    uuid not null references profiles(id) on delete cascade,
  assigned_by  uuid references auth.users(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (document_id, driver_id)
);

create index if not exists hr_document_assignments_driver_idx
  on hr_document_assignments (driver_id);

create table if not exists hr_signatures (
  id                    uuid primary key default gen_random_uuid(),
  -- restrict: a document with signatures can be archived but never deleted.
  document_id           uuid not null references hr_documents(id) on delete restrict,
  driver_id             uuid references auth.users(id) on delete set null,
  driver_email          text not null,
  driver_name           text,
  signed_name           text not null check (length(trim(signed_name)) > 1),
  agreement_text        text not null,
  document_sha256       text not null,
  signed_pdf_path       text not null,
  signed_pdf_sha256     text not null,
  signature_image_path  text not null,
  ip_address            text,
  user_agent            text,
  signed_at             timestamptz not null default now()
);

create index if not exists hr_signatures_driver_doc_idx
  on hr_signatures (driver_id, document_id, signed_at desc);

-- ── Append-only signatures ──────────────────────────────────────────────────

-- One UPDATE is allowed: the FK's ON DELETE SET NULL clearing driver_id when a
-- driver's account is removed. Everything else about the row must be unchanged,
-- and the snapshotted name/email keep the record meaningful.
create or replace function public.hr_signatures_immutable()
returns trigger as $$
begin
  if tg_op = 'UPDATE'
     and old.driver_id is not null
     and new.driver_id is null
     and (to_jsonb(new) - 'driver_id') = (to_jsonb(old) - 'driver_id') then
    return new;
  end if;
  raise exception 'hr_signatures is append-only; % is not allowed', tg_op;
end;
$$ language plpgsql;

drop trigger if exists hr_signatures_no_update on hr_signatures;
create trigger hr_signatures_no_update
  before update or delete on hr_signatures
  for each row execute function public.hr_signatures_immutable();

-- ── Row level security (reads only) ─────────────────────────────────────────

alter table hr_documents            enable row level security;
alter table hr_document_assignments enable row level security;
alter table hr_signatures           enable row level security;

drop policy if exists "Admins read hr documents" on hr_documents;
create policy "Admins read hr documents"
  on hr_documents for select
  using (public.get_my_role() = 'admin');

drop policy if exists "Drivers read their published hr documents" on hr_documents;
create policy "Drivers read their published hr documents"
  on hr_documents for select
  using (
    status = 'published'
    and public.get_my_role() = 'driver'
    and (
      audience = 'all'
      or exists (
        select 1 from hr_document_assignments a
        where a.document_id = hr_documents.id and a.driver_id = auth.uid()
      )
    )
  );

drop policy if exists "Admins read hr assignments" on hr_document_assignments;
create policy "Admins read hr assignments"
  on hr_document_assignments for select
  using (public.get_my_role() = 'admin');

drop policy if exists "Drivers read own hr assignments" on hr_document_assignments;
create policy "Drivers read own hr assignments"
  on hr_document_assignments for select
  using (driver_id = auth.uid());

drop policy if exists "Admins read hr signatures" on hr_signatures;
create policy "Admins read hr signatures"
  on hr_signatures for select
  using (public.get_my_role() = 'admin');

drop policy if exists "Drivers read own hr signatures" on hr_signatures;
create policy "Drivers read own hr signatures"
  on hr_signatures for select
  using (driver_id = auth.uid());

-- ── Private storage bucket ──────────────────────────────────────────────────
-- No storage.objects policies: only the service role can read or write, and
-- people get time-limited signed URLs from server actions.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-documents', 'hr-documents', false, 20971520, array['application/pdf', 'image/png'])
on conflict (id) do nothing;
