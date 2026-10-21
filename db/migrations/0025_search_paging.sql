-- Pages the search, which until now only ever showed its first page.
--
-- Searching "sabonete" returned 19 results and stopped. There are
-- thousands in the catalogue: the listing was capped at the use case's
-- default of 20 and had no way to ask for more, so the shopper saw one
-- screen and concluded the data was missing. The feed has paged since
-- 0013; search simply never gained an offset.
--
-- The candidate cap goes from 300 to 1,200 at the same time. It exists so
-- one broad word cannot turn into a catalogue scan, but 300 is below the
-- paging window, and a reader scrolling past result 300 would have hit an
-- invisible wall. 1,200 also gives the ranking more to choose from, so the
-- products several shops carry are more likely to be among the candidates
-- at all.
--
-- Complexity unchanged in order: bounded by the candidate cap, then
-- O(candidates * stores_picked) index lookups.

drop function if exists search_products(text[], uuid, uuid[], integer);

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
