-- Stop the feed headlining package differences as savings.
--
-- Barcodes get shared between a unit and its multipack. Sam's Club lists
-- "Pack 6 Galões 1,27l Cada" at R$ 35,98 under the same EAN as the single
-- bottle everyone else sells at R$ 6,59, so the merge is technically right
-- and the R$ 29,39 "saving" is fiction. The feed ranks by saving, so every
-- one of these sorted straight to the top — the first screen anybody sees
-- was showing the worst data first.
--
-- A price more than this many times the cheapest is dropped rather than
-- shown, because nothing in the catalogue says which of the two readings is
-- right, and claiming a saving that is really a package difference is the
-- fastest way to make a comparison worthless.
--
-- Calibrated on real data: Serrano ham genuinely spans 1.8x across four
-- chains and survives; the six-pack is 5.5x and does not. The same constant
-- lives in src/domain/services/ComparablePrices.ts as MAX_PRICE_RATIO —
-- change both together.
create or replace function product_feed(
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer
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
  with current_offers as (
    select distinct on (o.product_id, o.store_id)
      o.product_id, o.store_id, o.price_cents, o.url, o.in_stock, o.collected_at
    from offers o
    join stores s on s.id = o.store_id
    where o.store_id = any (p_store_ids)
      and s.region_id = p_region_id
      and s.active
    order by o.product_id, o.store_id, o.collected_at desc
  ),
  available as (
    select * from current_offers where in_stock
  ),
  floors as (
    select a.product_id, min(a.price_cents) as cheapest_cents
    from available a
    group by a.product_id
  ),
  comparable as (
    -- The refusal: anything more than 3x the cheapest is a different
    -- package, not a worse deal.
    select a.*
    from available a
    join floors f on f.product_id = a.product_id
    where a.price_cents <= f.cheapest_cents * 3
  ),
  spreads as (
    select
      c.product_id,
      (max(c.price_cents) - min(c.price_cents))::integer as spread_cents,
      count(*) as store_count
    from comparable c
    group by c.product_id
    -- Two stores minimum, counted after the refusal: a product left with
    -- one believable price is no longer a comparison.
    having count(*) > 1
  )
  select
    p.id,
    p.name,
    p.brand,
    p.size_amount,
    p.size_unit,
    p.image_url,
    p.gtin14,
    sp.spread_cents,
    (
      select jsonb_agg(
               jsonb_build_object(
                 'store_id', c.store_id,
                 'price_cents', c.price_cents,
                 'url', c.url,
                 'collected_at', c.collected_at
               )
               order by c.price_cents asc, c.store_id asc
             )
      from comparable c
      where c.product_id = p.id
    ) as offers
  from spreads sp
  join products p on p.id = sp.product_id
  order by (p.image_url is not null) desc,
           sp.spread_cents desc,
           sp.store_count desc,
           p.id
  limit least(greatest(p_limit, 1), 60);
$$;

grant execute on function product_feed(uuid, uuid[], integer) to anon, authenticated;
