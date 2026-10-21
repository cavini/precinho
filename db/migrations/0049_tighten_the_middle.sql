-- 1.75 times the middle, not twice it.
--
-- Heinz ketchup, priced by five shops: 11,99 / 18,49 / 18,99 / 19,99 and
-- 34,98 at Sam's Club. Four shops agree and one sells the multipack, and
-- at 1.84x the middle it cleared a threshold of 2 and reached the top of
-- the feed as "economize R$22,99".
--
-- Measured before moving it, across the second region: 1.75 refuses 106 prices of
-- 15,869 against 84 at 2x — 0.7% either way — and the genuinely wide
-- spreads survive, a Vapza chicken breast across seven shops sitting at
-- 1.25x.
--
-- Mirrors MAX_MEDIAN_RATIO in the domain. If one changes, change both.

drop function if exists product_feed(uuid, uuid[], integer, integer);

create or replace function product_feed(
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer,
  p_offset    integer default 0
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
  middles as (
    select a.product_id,
           min(a.price_cents) as cheapest_cents,
           count(*) as shops,
           percentile_cont(0.5) within group (order by a.price_cents) as median_cents
    from available a
    group by a.product_id
  ),
  comparable as (
    -- The refusal, anchored on the middle where there is one.
    --
    -- Against the cheapest, a real spread and one bad row widen the same
    -- end and cannot be told apart. Against the median they separate:
    -- chocolate em pó at 12,98 / 22,49 / 29,90 / 34,99 is a gradient
    -- (1.35x) and stays; fio dental at 17,90 / 19,69 / 20,79 / 46,69 is
    -- three shops agreeing and one multipack (2.31x), and the multipack
    -- goes. 1.75 rather than 2: a Heinz ketchup put its Sam's Club
    -- multipack 1.84x above the middle and reached the top of the feed.
    --
    -- With only two prices there is no middle, so the old rule stands and
    -- the cheapest is kept: it is almost always the single unit and a
    -- real price, even though the card then has nothing to compare it
    -- with and drops out below.
    --
    -- Mirrors ComparablePrices in the domain. If one changes, change both.
    select a.*
    from available a
    join middles m on m.product_id = a.product_id
    where case
            when m.shops >= 3 then a.price_cents <= m.median_cents * 1.75
            else a.price_cents <= m.cheapest_cents * 3
          end
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
  limit least(greatest(p_limit, 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- The old three-argument signature would otherwise linger beside the new one.
drop function if exists product_feed(uuid, uuid[], integer);

grant execute on function product_feed(uuid, uuid[], integer, integer) to anon, authenticated;
