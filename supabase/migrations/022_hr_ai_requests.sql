-- Log of HR assistant requests (drafts, revisions and reviews).
--
-- Kept so MLC can see what the assistant was asked and what it produced,
-- and to track usage. Written by the /api/hr/assistant route with the
-- service role; admins can read it. Nothing here is shown to drivers.

create table if not exists hr_ai_requests (
  id             uuid primary key default gen_random_uuid(),
  mode           text not null check (mode in ('draft', 'revise', 'review')),
  request        text not null,
  document_id    uuid references hr_documents(id) on delete set null,
  output         text,
  model          text,
  stop_reason    text,
  input_tokens   integer,
  output_tokens  integer,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists hr_ai_requests_created_idx on hr_ai_requests (created_at desc);

alter table hr_ai_requests enable row level security;

drop policy if exists "Admins read hr ai requests" on hr_ai_requests;
create policy "Admins read hr ai requests"
  on hr_ai_requests for select
  using (public.get_my_role() = 'admin');
