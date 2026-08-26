-- Manually add ESL Job Confirmation Instruction SD/5763091 as a load.
--
-- Why this exists
-- ----------------
-- This job was emailed to us on 20 Aug and never reached the portal (no
-- Telegram ping from the forwarder). The collection was 26/08/26 09:00 and
-- the delivery 26/08/26 14:00, so it needed to be in the portal before the
-- inbound path was fixed. Everything below is transcribed from the PDF.
--
-- It inserts into `loads`, not `runs`, to match where /api/email-to-run puts
-- forwarded customer emails.
--
-- The point of getting it in is the customer-facing ETA to the COLLECTION
-- point. Nothing in the codebase computes that today: collectionTimes()
-- only reports geofence arrive/depart after the fact, and deliveryEta()
-- always targets a raw_text stop. Stop 0 below is the collection, which
-- makes the existing ETA maths do the right thing without a code change.
-- See the note on raw_text. Use the admin-only "Copy to planner" on
-- /portal/loads to get a dispatch row.
--
-- Deliberately does NOT reference status_override / status_override_by /
-- status_override_at, so this works whether or not migration 018 has been
-- applied to production — which is the suspected reason the inbound insert
-- was failing in the first place.
--
-- Run in the Supabase SQL editor (bypasses RLS as the postgres role).
-- Safe to run once; re-running creates a duplicate, so check first with:
--   select id, job_number, load_ref from loads where load_ref = 'SD/5763091';

with bumped as (
  insert into job_counters (date_key, counter)
  values ('20260826', 1)
  on conflict (date_key)
    do update set counter = job_counters.counter + 1
  returning counter
)
insert into loads (
  id,
  job_number,
  load_ref,
  date,
  customer,
  vehicle,
  from_postcode,
  to_postcode,
  return_to_base,
  start_time,
  service_mins,
  include_breaks,
  raw_text,
  completed_stop_indexes,
  completed_meta,
  progress,
  run_type,
  run_order,
  collection_time,
  booking_time,
  reference,
  revenue,
  billable,
  invoice_status
)
select
  gen_random_uuid()::text,
  'MLC-20260826-' || lpad(bumped.counter::text, 3, '0'),
  'SD/5763091',                       -- Job Number / Haulage Job Number
  date '2026-08-26',
  'STOBART',                          -- who we invoice; AGBARR is the end client
  '',                                 -- SET THIS. No vehicle = no tracker fix =
                                      -- no live ETA; deliveryEta() falls back to
                                      -- the booked 14:00, which reads as an ETA
                                      -- but is only the delivery slot.
  'MK17 8EW',                         -- collection: AG Barr, Magna Park, Milton Keynes
  'MK17 8EW',                         -- backloads don't return to base
  false,
  '09:00',                            -- on site at collection
  25,
  true,
  -- Stop 0 is the COLLECTION, deliberately. liveEtaToNextStop() targets
  -- stops[nextOutstandingIndex()], and nextOutstandingIndex() reads only
  -- raw_text — from_postcode is never an ETA target. Leaving the
  -- collection out of raw_text makes the tracker's ETA read the S75 5NH
  -- delivery while the lorry is still running in to Milton Keynes.
  -- Listing it here makes the ETA count down to the collection, then
  -- flip to the delivery once the geofence marks stop 0 complete.
  -- displayDestination() takes the LAST stop, so the load still reads
  -- as going to S75 5NH.
  E'MK17 8EW 09:00 REF:SD/5763091 ADDR:AG Barr Ltd, Crossley Drive, Off Fenn St, Magna Park, Milton Keynes, Buckinghamshire, MK17 8EW\n'
  'S75 5NH 14:00 REF:34-13114 ADDR:One Below Limited, Bays 1-2 Dearne Mills, Darton, South Yorkshire, S75 5NH',
  '{}'::integer[],
  '{}'::jsonb,
  '{"completedIdx":[],"onSiteIdx":null,"onSiteSinceMs":null,"lastInside":false}'::jsonb,
  'backload',                         -- point-to-point collection, no return leg
  null,
  '09:00',                            -- collection booking at MK17 8EW
  '14:00',                            -- delivery booking at S75 5NH
  'SO10531858',                       -- ESL "Reference" (Bkg Ref 66613)
  280.00,                             -- Rate
  true,
  'open'
from bumped;
