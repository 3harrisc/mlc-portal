-- Cache geocoded postcodes so the progress cron doesn't re-geocode every 2 minutes
create table if not exists postcode_coords (
  postcode text primary key,
  lat      double precision not null,
  lng      double precision not null,
  cached_at timestamptz not null default now()
);

-- No RLS needed — this is only accessed server-side by the cron (via service role)
