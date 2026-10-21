-- Collect the one region this is actually for.
--
-- A nightly sweep was 26 shops across five regions, about 237 minutes of
-- paced requests. Four of those regions exist because they were useful
-- while proving the collector could read a platform at all — and they go
-- on costing a sweep every night, against shops nobody using this app
-- can buy from.
--
-- Keeping one region takes it to 10 shops and about 78 minutes. The two
-- thirds saved is not only ours: it is requests that stop arriving at
-- shops we have no reason to be asking.
--
-- Deactivated rather than deleted. The rows and their price history stay,
-- and turning a region back on is an update. Nothing is lost by stopping.
--
-- A region with no active shops already reads as no coverage — that rule
-- was settled when the first region was opened — so somebody arriving
-- from an uncovered city is told so rather than shown prices from shops
-- that will not serve them.

update stores
   set active = false
 where region_id <> (select id from regions where slug = 'sp-2');

-- Their ranked feeds are now unreachable; leaving them would keep stale
-- cards one toggle away from being served.
delete from feed_cache
 where region_id <> (select id from regions where slug = 'sp-2');

-- And the rebuild stops walking regions it can no longer rank: with no
-- active shops product_feed returns nothing, so every one of them was a
-- wasted pass.
create or replace function refresh_feed_cache(p_depth integer default 300)
returns integer
language plpgsql
as $$
declare
  r        record;
  depth    integer := least(greatest(p_depth, 1), 2000);
  page     integer := 60;
  taken    integer;
  offset_n integer;
  written  integer := 0;
begin
  for r in
    select g.id
    from regions g
    where exists (select 1 from stores s where s.region_id = g.id and s.active)
  loop
    delete from feed_cache where region_id = r.id;

    offset_n := 0;
    loop
      insert into feed_cache
        (region_id, position, product_id, name, brand, size_amount, size_unit,
         image_url, gtin14, spread_cents, offers)
      select r.id,
             offset_n + row_number() over (order by f.spread_cents desc, f.product_id),
             f.product_id, f.name, f.brand, f.size_amount, f.size_unit,
             f.image_url, f.gtin14, f.spread_cents, f.offers
      from product_feed(
             r.id,
             array(select id from stores where region_id = r.id and active),
             page,
             offset_n
           ) f
      on conflict (region_id, position) do nothing;

      get diagnostics taken = row_count;
      written := written + taken;
      offset_n := offset_n + page;

      exit when taken < page or offset_n >= depth;
    end loop;

    with scored as (
      select f.region_id, f.position,
             jsonb_array_length(f.offers) as shops,
             f.spread_cents,
             (select min((o ->> 'price_cents')::integer)
              from jsonb_array_elements(f.offers) o) as cheapest
      from feed_cache f
      where f.region_id = r.id
    ),
    ranked as (
      select s.region_id, s.position,
             row_number() over (
               order by
                 case when s.spread_cents < 150 then 1 else 0 end,
                 case when s.shops >= 3 then 0 else 1 end,
                 s.spread_cents::numeric / nullif(s.cheapest, 0) desc,
                 s.spread_cents desc,
                 s.position
             ) as rank
      from scored s
    )
    update feed_cache f
    set position = -ranked.rank
    from ranked
    where f.region_id = ranked.region_id and f.position = ranked.position;

    update feed_cache set position = -position where region_id = r.id and position < 0;
  end loop;

  return written;
end;
$$;
