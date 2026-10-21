-- Rank the feed once a day instead of once a request.
--
-- The feed scans 130,594 offers and ranks 60,238 products to return 24
-- cards, every time somebody opens the home page. Warm that is about a
-- second; on a cold serverless start it is slow enough to fail, and a
-- failed feed is what the site showed its first visitor.
--
-- No index fixes it — the work is a full ranking of the region's
-- catalogue, and an index on (store_id, product_id, collected_at) made
-- it slower, 1,199 ms to 1,987 ms, because the ordering the DISTINCT ON
-- needs is product-major. Measured, not assumed, and dropped again.
--
-- Prices change once a day, when the collector runs. So the ranking is
-- computed once, after collection, and read back by position.
--
-- The cache covers the whole region. A shopper who unticks shops gets
-- the live query instead, because their ranking genuinely differs and
-- serving them a ranking built from shops they excluded would be worse
-- than being slow.

create table if not exists feed_cache (
  region_id    uuid not null references regions (id) on delete cascade,
  position     integer not null,
  product_id   uuid not null references products (id) on delete cascade,
  name         text not null,
  brand        text,
  size_amount  numeric,
  size_unit    text,
  image_url    text,
  gtin14       char(14),
  spread_cents integer not null,
  offers       jsonb not null,
  built_at     timestamptz not null default now(),

  primary key (region_id, position)
);

comment on table feed_cache is
  'The home feed, ranked once after each collection. Read by position; rebuilt by refresh_feed_cache().';

-- How many cards to keep per region. The scroll pages through them, and
-- past a few hundred nobody is still reading.
create or replace function refresh_feed_cache(p_depth integer default 300)
returns integer
language plpgsql
as $$
declare
  r       record;
  written integer := 0;
begin
  for r in select id from regions loop
    delete from feed_cache where region_id = r.id;

    insert into feed_cache
      (region_id, position, product_id, name, brand, size_amount, size_unit,
       image_url, gtin14, spread_cents, offers)
    select r.id,
           row_number() over (order by f.spread_cents desc, f.product_id),
           f.product_id, f.name, f.brand, f.size_amount, f.size_unit,
           f.image_url, f.gtin14, f.spread_cents, f.offers
    from product_feed(
           r.id,
           array(select id from stores where region_id = r.id and active),
           least(greatest(p_depth, 1), 2000),
           0
         ) f;

    written := written + 1;
  end loop;

  return written;
end;
$$;

grant execute on function refresh_feed_cache(integer) to anon, authenticated;
