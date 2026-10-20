-- Search refuses the same impossible comparisons the feed does.
--
-- Searching "sabonete nivea" offered a Nivea bar at R$1,99 in Atacadão
-- against R$24,91 in Sam's Club and announced "economize R$22,92 (92%)".
-- Nobody sells one 85g soap for twenty-five reais: Sam's Club lists the
-- box under the same barcode as the bar, and the listing compared a box
-- with a bar and called the difference a saving.
--
-- The feed has refused this since 0013 — anything more than three times
-- the cheapest is a different package, not a worse deal, a ratio
-- calibrated on real rows (a Serrano ham at 1.8x is real, a six-pack at
-- 5.5x is not). Search gained the price list without the refusal, so it
-- inherited the bug the feed had already been fixed for.
--
-- The cheapest, the dearest, the count and the list are now all taken
-- from the comparable set. The product still appears; only the price that
-- is not a price for this product is left out.
--
-- Complexity unchanged in order: one more grouped pass over a set already
-- materialised per product.

drop function if exists search_products(text[], uuid, uuid[], integer, integer);

create function search_products(
  p_tokens    text[],
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer,
  p_offset    integer
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
    -- Shortest text first still decides which 300 candidates are considered:
    -- it favours "Arroz Camil 5kg" over a name padded with marketing. The
    -- ranking below then decides what the shopper actually sees.
    order by length(p.search_text), p.name, p.id
    limit 1200
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
  ),
  floors as (
    select a.product_id, min(a.price_cents) as cheapest_cents
    from available a
    group by a.product_id
  ),
  comparable as (
    -- Same refusal as the feed: more than 3x the cheapest is a different
    -- package sharing a barcode, not a worse deal.
    select a.*
    from available a
    join floors f on f.product_id = a.product_id
    where a.price_cents <= f.cheapest_cents * 3
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
    from comparable a where a.product_id = b.id
    order by a.price_cents asc, a.store_id asc limit 1
  ) cheap on true
  left join lateral (
    select a.price_cents from available a
    where a.product_id = b.id
    order by a.price_cents desc, a.store_id desc limit 1
  ) dear on true
  left join lateral (
    select count(*)::integer as available_store_count
    from comparable a where a.product_id = b.id
  ) counted on true
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'store_id', a.store_id,
               'price_cents', a.price_cents,
               'url', a.url,
               'collected_at', a.collected_at
             )
             order by a.price_cents asc, a.store_id asc
           ) as offers
    from comparable a where a.product_id = b.id
  ) listed on true
  order by
    -- Most shops first: a product three shops carry is a comparison, one
    -- shop carries is a listing.
    coalesce(counted.available_store_count, 0) desc,
    -- Then where they disagree most, which is what the app is for.
    coalesce(dear.price_cents, 0) - coalesce(cheap.price_cents, 0) desc,
    -- A photo makes a row readable; without one the shopper sees a grey box.
    (b.image_url is not null) desc,
    b.name asc,
    b.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function search_products(text[], uuid, uuid[], integer, integer) to anon, authenticated;
