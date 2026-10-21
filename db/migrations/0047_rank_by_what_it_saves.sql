-- Rank by how much of the price it saves, not how many reais.
--
-- Ranked by reais, the first screen was six whiskies. R$190 off a
-- Johnnie Walker is a real difference and a useless one: somebody opens
-- a supermarket comparator to find out where the shopping is cheaper,
-- not to be shown the spirits aisle, and the ranking was simply reading
-- "expensive" as "worth seeing".
--
-- Percentage reads what a shopper actually feels — a third off the
-- coffee matters more than a tenth off a bottle of whisky — with a
-- floor, because half off an 80-cent packet is forty cents and nobody
-- changes shop for it.
--
-- The floor is R$1.50: above the noise, below anything worth a detour.

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
  for r in select id from regions loop
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

    -- Ranked after the pages are in, because the order wanted here is not
    -- the order product_feed pages in, and paging by one while ranking by
    -- the other would shuffle cards between pages.
    with ranked as (
      select f.region_id, f.position,
             row_number() over (
               order by
                 case
                   when f.spread_cents < 150 then 1
                   else 0
                 end,
                 f.spread_cents::numeric
                   / nullif((select min((o ->> 'price_cents')::integer)
                             from jsonb_array_elements(f.offers) o), 0) desc,
                 f.spread_cents desc,
                 f.product_id
             ) as rank
      from feed_cache f
      where f.region_id = r.id
    )
    update feed_cache f
    set position = -ranked.rank
    from ranked
    where f.region_id = ranked.region_id and f.position = ranked.position;

    -- Negated above so the rewrite cannot collide with a position it has
    -- not reached yet; flipped back now that every row has moved.
    update feed_cache set position = -position where region_id = r.id and position < 0;
  end loop;

  return written;
end;
$$;
