-- MLC countersignature for HR documents (e.g. employment contracts).
--
-- A document flagged requires_countersign is only complete once the driver
-- has signed AND an MLC signatory (Transport Manager / Company Director) has
-- countersigned that specific driver signature. The countersignature appends
-- a second certificate page to the driver-signed PDF, so the final file
-- carries both.
--
-- Same rules as hr_signatures (migration 019): append-only, written only by
-- server actions using the service role, RLS grants reads only.

alter table hr_documents
  add column if not exists requires_countersign boolean not null default false;

create table if not exists hr_countersignatures (
  id                        uuid primary key default gen_random_uuid(),
  -- unique: one countersignature per driver signature.
  signature_id              uuid not null unique references hr_signatures(id) on delete restrict,
  signer_id                 uuid references auth.users(id) on delete set null,
  signer_email              text not null,
  signer_name               text not null,
  signer_title              text not null,
  agreement_text            text not null,
  input_pdf_sha256          text not null,
  countersigned_pdf_path    text not null,
  countersigned_pdf_sha256  text not null,
  signature_image_path      text not null,
  ip_address                text,
  user_agent                text,
  signed_at                 timestamptz not null default now()
);

-- Append-only, except the FK clearing signer_id if the admin account is removed.
create or replace function public.hr_countersignatures_immutable()
returns trigger as $$
begin
  if tg_op = 'UPDATE'
     and old.signer_id is not null
     and new.signer_id is null
     and (to_jsonb(new) - 'signer_id') = (to_jsonb(old) - 'signer_id') then
    return new;
  end if;
  raise exception 'hr_countersignatures is append-only; % is not allowed', tg_op;
end;
$$ language plpgsql;

drop trigger if exists hr_countersignatures_no_update on hr_countersignatures;
create trigger hr_countersignatures_no_update
  before update or delete on hr_countersignatures
  for each row execute function public.hr_countersignatures_immutable();

alter table hr_countersignatures enable row level security;

drop policy if exists "Admins read hr countersignatures" on hr_countersignatures;
create policy "Admins read hr countersignatures"
  on hr_countersignatures for select
  using (public.get_my_role() = 'admin');

drop policy if exists "Drivers read countersignatures of own signatures" on hr_countersignatures;
create policy "Drivers read countersignatures of own signatures"
  on hr_countersignatures for select
  using (
    exists (
      select 1 from hr_signatures s
      where s.id = hr_countersignatures.signature_id and s.driver_id = auth.uid()
    )
  );
