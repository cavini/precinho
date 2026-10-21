-- Read the ranked feed, falling back to ranking it live.
--
-- The cache is built for a whole region. A shopper who unticks shops has
-- a genuinely different ranking — products their remaining shops do not
-- carry, comparisons that no longer have two sides — so handing them the
-- region's ranking would be answering a question they did not ask.
--
-- So the cached path is taken only when the picked set is every active
-- shop in the region, which is what almost every visitor has, and the
-- live query stays for the rest. Same shape out of both, so the caller
-- cannot tell which it got.

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
language plpgsql
stable
as $$
declare
  all_stores uuid[];
  cached     integer;
begin
  select array_agg(id) into all_stores
  from stores where region_id = p_region_id and active;

  -- Same shops, whatever order they arrived in.
  if all_stores is not null
     and p_store_ids @> all_stores
     and all_stores @> p_store_ids then

    select count(*) into cached from feed_cache f where f.region_id = p_region_id;

    if cached > 0 then
      return query
        select f.product_id, f.name, f.brand, f.size_amount, f.size_unit,
               f.image_url, f.gtin14, f.spread_cents, f.offers
        from feed_cache f
        where f.region_id = p_region_id
        order by f.position
        limit least(greatest(p_limit, 1), 60)
        offset greatest(coalesce(p_offset, 0), 0);
      return;
    end if;
  end if;

  return query
    select f.product_id, f.name, f.brand, f.size_amount, f.size_unit,
           f.image_url, f.gtin14, f.spread_cents, f.offers
    from product_feed(p_region_id, p_store_ids, p_limit, p_offset) f;
end;
$$;

grant execute on function feed_for(uuid, uuid[], integer, integer) to anon, authenticated;
