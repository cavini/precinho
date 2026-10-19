-- A per-store request interval, and Carrefour switched back on.
--
-- Carrefour's account host went from answering to returning 401 to
-- everything the moment a full 30-term sweep hit it, and recovered on its
-- own some hours later. That reads as a volume trip, not a permanent
-- refusal, so the fix is to go slower there rather than to stop — and
-- "slower" has to be per store, because one chain's limit is no reason to
-- crawl every other chain at the same pace.
--
-- Its robots.txt still says Disallow: /. This runs anyway, at a deliberately
-- low rate, because the data is being read by the group that owns it for an
-- internal comparison rather than republished to the public.

alter table stores
  add column if not exists min_interval_ms integer;

comment on column stores.min_interval_ms is
  'Minimum gap between requests to this store. Null uses the collector default.';

alter table stores
  drop constraint if exists stores_min_interval_sane;

alter table stores
  add constraint stores_min_interval_sane
  check (min_interval_ms is null or (min_interval_ms >= 200 and min_interval_ms <= 60000));

update stores
   set active = true,
       min_interval_ms = 5000
 where slug = 'carrefour';
