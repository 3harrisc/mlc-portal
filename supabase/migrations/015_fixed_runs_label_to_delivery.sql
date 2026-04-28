-- Re-shape any already-materialised standing weekday runs (id LIKE 'fixed-%')
-- so the operator-friendly label lives in the Delivery column (to_postcode)
-- and the Factory column is blank.
--
-- Earlier shape (created by 014's cron / on-page-load materialiser):
--    to_postcode = "B78 3HJ"      (raw postcode)
--    factory     = "Tamworth 1"   (friendly label)
--    raw_text    = "B78 3HJ"
--
-- New shape (matches the operator's preference — friendly label on Delivery,
-- Factory blank, real postcode preserved in raw_text for geo/cron):
--    to_postcode = "Tamworth 1"
--    factory     = null
--    raw_text    = "B78 3HJ"
--
-- We only touch rows that still match the old shape (raw_text already
-- contains the postcode + factory is non-null) so any row the dispatcher
-- has manually edited stays as-is.

update runs
set
  to_postcode = factory,
  factory = null
where id like 'fixed-%'
  and factory is not null
  and factory <> ''
  -- Defensive: only flip when raw_text holds the postcode (i.e. row hasn't
  -- been hand-edited away from the auto-generated shape).
  and raw_text is not null
  and raw_text <> '';
