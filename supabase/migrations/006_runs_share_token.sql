-- Public share tokens for runs.
-- A run with a non-null share_token can be viewed at /track/<token> without
-- authentication. The /track route uses the service-role client to look the
-- run up, so RLS isn't relaxed; access is purely token-gated.
alter table runs
  add column if not exists share_token text,
  add column if not exists share_token_created_at timestamptz;

create unique index if not exists runs_share_token_unique
  on runs (share_token)
  where share_token is not null;
