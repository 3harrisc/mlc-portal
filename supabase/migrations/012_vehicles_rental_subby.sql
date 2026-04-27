-- Add RENTAL and SUBBY to the canonical vehicles list.
--
-- These aren't fleet vehicles in the traditional sense:
--   RENTAL — a hired lorry covering a leg when own fleet is at capacity
--   SUBBY  — a subcontractor handling the leg
-- They appear in the operator's planner exactly as if they were trucks, so
-- they belong in the same dropdown / availability strip. Sorted to the end
-- of the list (sort_order = 900/910) so they don't crowd real fleet pills.

insert into vehicles (id, sort_order, description) values
  ('RENTAL', 900, 'Hired lorry'),
  ('SUBBY',  910, 'Subcontractor')
on conflict (id) do update
  set sort_order = excluded.sort_order,
      description = excluded.description;
