-- Search stops returning products nobody nearby sells.
--
-- "Suco Integral Uva Tinto Aurora 500ml" came up in a search from the second region
-- and the product page then said no marked shop had a price for it. Both
-- screens were right: its only offer is from Pão de Açúcar in São Paulo.
-- The row had no business being in a the second region listing.
--
-- These rows were always returned — the laterals are left joins and the
-- ordering only pushed zero-availability to the end. That was invisible
-- while the listing stopped at twenty results. Adding the infinite scroll
-- made them reachable, so a bug that had been dormant since the first
-- search function became a dead-end link.
--
-- A product carried by exactly one marked shop still belongs here: one
-- price is a price. Zero is not.

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
    select a.price_cents from comparable a
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
  -- Nothing the shopper can buy is nothing worth listing. These rows were
  -- always returned and merely sorted last, which was invisible while the
  -- listing stopped at twenty; once it scrolled, they became reachable and
  -- every one of them is a dead end.
  where coalesce(counted.available_store_count, 0) > 0
  order by
    -- Most shops first: a product three shops carry is a comparison, one
    -- shop carries is a listing.
    counted.available_store_count desc,
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
