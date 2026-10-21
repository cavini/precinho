-- Every store's price in the search listing, not just the cheapest.
--
-- The listing already carries a photo and a blurb like the feed does, but
-- it answered "cheapest at Oba, R$ 5,19" and stopped. That is the answer
-- to a question nobody asked: somebody comparing wants to see that it is
-- 5.19 at Oba and 6.49 at Carrefour, because the gap is the whole point
-- and a single number hides it.
--
-- The feed has returned the full list since 0013; this brings search into
-- line rather than inventing a second shape for the same idea.
--
-- Complexity unchanged in order: one more lateral over `available`, which
-- is already materialised and indexed by product. O(candidates * stores).

drop function if exists search_products(text[], uuid, uuid[], integer);

create function search_products(
  p_tokens    text[],
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer
)
returns table (
  product_id          uuid,
  name                text,
  description         text,
  brand               text,
  size_amount         numeric,
  size_unit           text,
  image_url           text,
  gtin14              char(14),
  cheapest_store_id   uuid,
  cheapest_price_cents integer,
  cheapest_list_price_cents integer,
  cheapest_url        text,
  cheapest_collected_at timestamptz,
  dearest_price_cents integer,
  available_store_count integer,
  offers              jsonb
)
language sql
stable
as $$
  with bounded as (
    select p.id, p.name, p.description, p.brand, p.size_amount, p.size_unit,
           p.image_url, p.gtin14, p.search_text
    from products p
    where p.search_text ~ all (
      array(select '\m' || tok from unnest(p_tokens) as tok)
    )
    order by length(p.search_text), p.name, p.id
    limit 300
  ),
  current_offers as (
    select distinct on (o.product_id, o.store_id)
      o.product_id, o.store_id, o.price_cents, o.list_price_cents,
      o.url, o.in_stock, o.collected_at
    from offers o
    join stores s on s.id = o.store_id
    where o.product_id in (select id from bounded)
      and o.store_id = any (p_store_ids)
      and s.region_id = p_region_id
      and s.active
    order by o.product_id, o.store_id, o.collected_at desc
  ),
  available as (
    select * from current_offers where in_stock
  )
  select
    b.id, b.name, b.description, b.brand, b.size_amount, b.size_unit,
    b.image_url, b.gtin14,
    cheap.store_id, cheap.price_cents, cheap.list_price_cents, cheap.url,
    cheap.collected_at, dear.price_cents,
    coalesce(counted.available_store_count, 0)::integer,
    coalesce(listed.offers, '[]'::jsonb)
  from bounded b
  left join lateral (
    select a.store_id, a.price_cents, a.list_price_cents, a.url, a.collected_at
    from available a where a.product_id = b.id
    order by a.price_cents asc, a.store_id asc limit 1
  ) cheap on true
  left join lateral (
    select a.price_cents from available a
    where a.product_id = b.id
    order by a.price_cents desc, a.store_id desc limit 1
  ) dear on true
  left join lateral (
    select count(*)::integer as available_store_count
    from available a where a.product_id = b.id
  ) counted on true
  left join lateral (
    -- Cheapest first, store id breaking ties, so the same search always
    -- lists the same stores in the same order.
    select jsonb_agg(
             jsonb_build_object(
               'store_id', a.store_id,
               'price_cents', a.price_cents,
               'url', a.url,
               'collected_at', a.collected_at
             )
             order by a.price_cents asc, a.store_id asc
           ) as offers
    from available a where a.product_id = b.id
  ) listed on true
  order by (coalesce(counted.available_store_count, 0) > 0) desc, b.name asc, b.id asc
  limit least(greatest(p_limit, 1), 50);
$$;

grant execute on function search_products(text[], uuid, uuid[], integer) to anon, authenticated;
