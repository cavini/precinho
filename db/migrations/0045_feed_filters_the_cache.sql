-- Serve a custom shop selection from the cache too, filtered.
--
-- 0044 ranked live for anybody who unticked a shop. Measured against the
-- anon role the website uses, that query does not finish: it is
-- cancelled by the 3-second statement timeout, every time. So a custom
-- selection has never worked in production — before this week the
-- failure was swallowed and shown as "no products", which is how it went
-- unnoticed.
--
-- The cache already holds every shop's offer for each card, so a
-- selection can be served by filtering those and dropping the cards left
-- with fewer than two — which is the feed's own rule, since one price is
-- not a comparison. The spread is recomputed from what remains.
--
-- What this gives up: the ordering is the region's, not the shopper's. A
-- card whose biggest gap came from a shop they unticked sits higher than
-- it has earned. That is a worse ranking of correct data, against a
-- correct ranking that times out — and the prices on screen are right
-- either way.

create or replace function feed_for(
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer,
  p_offset    integer
)
returns table (
  product_id   uuid,
  name         text,
  brand        text,
  size_amount  numeric,
  size_unit    text,
  image_url    text,
  gtin14       char(14),
  spread_cents integer,
  offers       jsonb
)
language sql
stable
as $$
  with kept as (
    select f.position, f.product_id, f.name, f.brand, f.size_amount, f.size_unit,
           f.image_url, f.gtin14,
           (
             select jsonb_agg(o order by (o ->> 'price_cents')::integer)
             from jsonb_array_elements(f.offers) o
             where (o ->> 'store_id')::uuid = any (p_store_ids)
           ) as offers
    from feed_cache f
    where f.region_id = p_region_id
  )
  select k.product_id, k.name, k.brand, k.size_amount, k.size_unit,
         k.image_url, k.gtin14,
         -- Recomputed: the region's spread may have come from a shop the
         -- shopper does not want to see.
         (
           (select max((o ->> 'price_cents')::integer) from jsonb_array_elements(k.offers) o)
           - (select min((o ->> 'price_cents')::integer) from jsonb_array_elements(k.offers) o)
         )::integer,
         k.offers
  from kept k
  -- One price is not a comparison, which is the feed's rule everywhere.
  where k.offers is not null and jsonb_array_length(k.offers) > 1
  order by k.position
  limit least(greatest(p_limit, 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function feed_for(uuid, uuid[], integer, integer) to anon, authenticated;
