-- The nightly job stops reading the whole catalogue to do nothing.
--
-- `reconcile` runs judge-equivalences twice a night, and the script reads
-- three tables in full before it looks at which mode it is in: every
-- product, every offer, every verdict. Measured against this database that
-- is 84.8 MB a pass, 169.6 MB a night, about 5 GB a month — the entire
-- egress allowance, spent by a step that on 27 October took the project
-- past it and had Supabase cut the collector off for three nights running
-- (`exceed_egress_quota`).
--
-- Most of that read is answerable without leaving the database. This
-- migration supplies the one piece that is pure aggregation; the rest is a
-- change of shape in the script, which now loads the catalogue only for
-- the modes that shortlist.
--
-- `product_regions` replaces this, which the script ran over 386,662 rows:
--
--     .from('offers').select('product_id, stores(region_id)')
--
-- Every reader of it only ever asked "do these two products share a
-- region", so the rows beyond the first per (product, region) were carried
-- across the wire to be thrown away. Aggregating here turns 386,662 nested
-- objects into one flat row per pair — about 8 MB instead of 36.9 MB, and
-- it shrinks as the offers table grows rather than keeping pace with it.
--
-- A view rather than a materialised one: it is read by hand a few times a
-- week, not on a request path, and a stale answer here would silently
-- stop proposing merges between two shops.
create or replace view product_regions as
  select distinct o.product_id, s.region_id
    from offers o
    join stores s on s.id = o.store_id;

comment on view product_regions is
  'Which regions sell each product. For the equivalence shortlist, which '
  'needs the pairs and never the offers behind them.';

-- The collector reaches this with the service role, which bypasses row
-- level security; granting read to the anon role as well keeps the view
-- usable from the app if a screen ever wants it, and it exposes nothing a
-- product page does not already show.
grant select on product_regions to anon, authenticated, service_role;
