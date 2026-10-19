-- The feed: what the home page shows before anybody searches.
--
-- Ranked by how much is on the table rather than by recency or price,
-- because the one thing this app has to say is "you are overpaying for
-- this". A product carried by one store has nothing to say and is left out.
--
-- Returns every offer per product as JSON, not just the cheapest, because
-- each card lists the stores underneath the picture. One row per product
-- instead of one per offer keeps the payload proportional to what is shown.
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
    -- One row per (product, store): the most recent. Same rule as search.
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
  spreads as (
    select
      a.product_id,
      (max(a.price_cents) - min(a.price_cents))::integer as spread_cents,
      count(*) as store_count
    from available a
    group by a.product_id
    -- Two stores minimum: one price is not a comparison.
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
                 'store_id', a.store_id,
                 'price_cents', a.price_cents,
                 'url', a.url,
                 'collected_at', a.collected_at
               )
               order by a.price_cents asc, a.store_id asc
             )
      from available a
      where a.product_id = p.id
    ) as offers
  from spreads sp
  join products p on p.id = sp.product_id
  -- A picture is most of a card, so products that have one come first.
  order by (p.image_url is not null) desc,
           sp.spread_cents desc,
           sp.store_count desc,
           p.id
  limit least(greatest(p_limit, 1), 60);
$$;

grant execute on function product_feed(uuid, uuid[], integer) to anon, authenticated;
