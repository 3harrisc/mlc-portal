-- One-shot reset of `runs` + the fixed-run ledger so the Excel master
-- planner import can be re-run from a clean slate.
--
-- SCOPE (narrowed per dispatcher: keep Ashwood/customer-portal forward
-- planning intact)
--   1. Wipes every row from `runs` (legacy Excel imports, fixed runs,
--      manually planned rows — everything).
--   2. Wipes `fixed_run_materializations` so today's standing Consolid8
--      runs re-materialise on the next planner open / cron tick.
--   3. Leaves `loads` UNTOUCHED so Ashwood forward planning, customer
--      portal bookings, and any email-to-run rows survive.
--
-- WHAT THIS DOES NOT TOUCH
--   * loads (Ashwood forward planning, portal-* bookings, email-to-run rows)
--   * profiles / allowed_customers
--   * vehicles / depots / trailers / drivers
--   * postcode_coords (geocode cache)
--   * customers / customer_contacts
--   * nicknames
--   * weekly_costs
--   * Xero map / customers config
--
-- AFTER RUNNING THIS
--   * Re-run the Excel import:
--       npx tsx scripts/import-master-planner.ts --in tmp/all-weeks.json --commit
--   * /portal/planner/<today> will auto-materialise the 4 fixed Consolid8
--     rows on first open.
--   * /portal/loads (customer portal) is unchanged.
--
-- USAGE: paste into the Supabase SQL editor; review the row counts in the
-- RAISE NOTICE output before committing.

begin;

do $$
declare
  v_runs   integer;
  v_loads  integer;
  v_ledger integer;
begin
  select count(*) into v_runs   from runs;
  select count(*) into v_loads  from loads;
  select count(*) into v_ledger from fixed_run_materializations;

  raise notice 'Before reset: runs=%, loads=% (preserved), fixed_run_materializations=%',
    v_runs, v_loads, v_ledger;
end $$;

delete from runs;
delete from fixed_run_materializations;

do $$
declare
  v_runs   integer;
  v_loads  integer;
  v_ledger integer;
begin
  select count(*) into v_runs   from runs;
  select count(*) into v_loads  from loads;
  select count(*) into v_ledger from fixed_run_materializations;

  raise notice 'After reset: runs=%, loads=% (preserved), fixed_run_materializations=%',
    v_runs, v_loads, v_ledger;
end $$;

-- Review the NOTICE output above. The "After reset" line should show
--   runs=0, loads=<unchanged>, fixed_run_materializations=0.
-- If that's right, run COMMIT in a new query. To bail out, run ROLLBACK.
