-- Schedule of Particulars for HR documents (e.g. one blank employment contract).
--
-- A document with collects_particulars = true is issued per driver: MLC sets
-- the start date and continuous employment date when sending it (stored on the
-- assignment), and the driver confirms their full legal name and home address
-- when signing. The signed PDF gets a "Schedule of Particulars" page before the
-- signature certificate, and the details are snapshotted on the signature row
-- (hr_signatures stays append-only via the migration 019 trigger).

alter table hr_documents
  add column if not exists collects_particulars boolean not null default false;

alter table hr_document_assignments
  add column if not exists start_date date,
  add column if not exists continuous_employment_date date;

alter table hr_signatures
  add column if not exists particulars jsonb;
