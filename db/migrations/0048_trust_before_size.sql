-- Put the comparisons we are sure of above the ones that merely look big.
--
-- Ranking by percentage removed the whisky and replaced it with
-- something subtler: a 500g cheese at 44,95 in one shop and 129,90 in
-- another, top of the screen at 189%. By construction the widest
-- relative gap is the most likely to be a bad match, so "biggest
-- saving" and "least trustworthy" are close to the same ordering.
--
-- Shop count is the evidence we have. Seven shops pricing a Vapza
-- chicken breast from 18,97 to 49,99 is a fact about the market; two
-- shops 2.9x apart on a cheese is more likely a fact about our
-- matching, and with two prices nothing can say which of them is wrong.
--
-- So cards priced by three or more shops rank first, and within each
-- group by what fraction of the price is saved. Two-shop cards still
-- appear — they are often right, and a shopper scrolling deserves them
-- — just not on the first screen, where being wrong costs the most.

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
                 -- Saving too small to change where anybody shops.
                 case when s.spread_cents < 150 then 1 else 0 end,
                 -- Then what we can stand behind: three shops or more.
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
