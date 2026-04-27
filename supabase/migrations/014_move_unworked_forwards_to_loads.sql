-- Move "unworked" forwarded-email runs from `runs` to `loads`.
--
-- Why
-- ---
-- The email-to-run pipeline used to insert into `runs`. After the loads/runs
-- split (migration 013) we redirected new forwards to `loads`, but rows
-- forwarded between the change landing on main and Vercel actually serving
-- the new code still went to `runs`. Those rows belong on the customer
-- portal -- the customer can't see them in /portal/loads because they're
-- in the wrong table.
--
-- Detection signature
-- -------------------
-- The email-to-run inserter has a fingerprint that distinguishes its rows
-- from dispatch-created rows:
--
--   * id is a v4 UUID (crypto.randomUUID() in route.ts) — dispatch creates
--     ids prefixed `run-`, `tpl-`, etc.
--   * created_by IS NULL — the email webhook is unauthenticated, so
--     getUser() never runs and created_by stays null. Dispatch flows
--     always set created_by from the authed session.
--
-- The two conditions together are unambiguous.
--
-- Safety: only move "unworked" rows
-- ----------------------------------
-- If the dispatcher has already assigned a vehicle, made progress, or
-- billed one of these rows, moving it wholesale could break invoicing.
-- We restrict the move to rows that look fresh:
--
--   * vehicle = ''         (no reg assigned yet)
--   * completed_stop_indexes = '{}' (no stops completed)
--   * billable = false     (not in the bill cycle)
--   * xero_invoice_id IS NULL (not exported to Xero)
--
-- A worked forwarded row stays in `runs` until the dispatcher moves it
-- manually -- the operator's existing work isn't lost.

do $$
declare
  v_moved integer := 0;
begin
  with moved as (
    delete from runs
    where created_by is null
      and id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (vehicle is null or vehicle = '')
      and (completed_stop_indexes is null or completed_stop_indexes = '{}')
      and billable = false
      and xero_invoice_id is null
    returning *
  )
  insert into loads
  select * from moved
  on conflict (id) do nothing;

  get diagnostics v_moved = row_count;
  raise notice 'Moved % unworked forwarded-email runs from runs to loads', v_moved;
end $$;
