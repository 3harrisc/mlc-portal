-- Customer notification contacts.
-- When a customer is referenced for the first time (via portal booking or
-- email-to-run), we auto-create a customers row with `auto_created=true` and
-- pre-populate notification_emails with the originating user's address.
-- Admin can then enrich the record via /admin/customers.
alter table customers
  add column if not exists notification_emails text[] not null default '{}',
  add column if not exists primary_contact_name text,
  add column if not exists auto_created boolean not null default false;

create index if not exists customers_name_lower_idx
  on customers (lower(name));
