-- Paging for the feed.
--
-- The home page now loads more cards as you scroll, so the function takes an
-- offset. Its ordering is fully deterministic — image first, then spread,
-- then store count, then id — so offset paging cannot repeat or skip a card
-- within a collection run, which is the usual reason to reach for a cursor.
--
-- Everything else is unchanged from 0007, including the three-times-cheapest
-- refusal that keeps package differences out of the rankings.
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
  limit least(greatest(p_limit, 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- The old three-argument signature would otherwise linger beside the new one.
drop function if exists product_feed(uuid, uuid[], integer);

grant execute on function product_feed(uuid, uuid[], integer, integer) to anon, authenticated;
