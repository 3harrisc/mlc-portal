-- vehicle_position_log retention
--
-- The collector cron appends a row per vehicle every 2 minutes and nothing
-- ever deletes them — the table reached ~3.4M rows (roughly half the free
-- plan's database quota). This migration:
--   1. adds an index so time-based deletes don't scan the whole table
--   2. purges everything older than 30 days
--   3. schedules a daily pg_cron job to keep it that way

-- 1. Index for retention deletes (existing index leads on vehicle, so it
--    can't serve a pure collected_at range scan)
create index if not exists vehicle_position_log_collected_only_idx
  on vehicle_position_log (collected_at);

-- 2. One-off purge. If the SQL editor times out on this, run it a few times
--    with a shorter interval first (e.g. '120 days', '90 days', '60 days').
delete from vehicle_position_log
where collected_at < now() - interval '30 days';

-- 3. Daily cleanup at 03:00 UTC. cron.schedule upserts by job name, so
--    re-running this migration is safe.
create extension if not exists pg_cron;

select cron.schedule(
  'purge-vehicle-position-log',
  '0 3 * * *',
  $$delete from vehicle_position_log where collected_at < now() - interval '30 days'$$
);

-- Note: Postgres reuses the freed space for new rows, but the reported
-- database size only shrinks after a VACUUM. Optionally run (on its own,
-- outside a transaction):
--   vacuum vehicle_position_log;
