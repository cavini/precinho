-- The refresh has to page, because product_feed caps a call at 60 rows.
--
-- 0042 asked it for 300 in one go and would have got 60, filling a cache
-- a fifth as deep as intended and stopping the scroll early — a quiet
-- wrong answer rather than an error.

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
      -- A product can only hold one position, and a rebuild that trips on
      -- that should keep what it already wrote rather than abort.
      on conflict (region_id, position) do nothing;

      get diagnostics taken = row_count;
      written := written + taken;
      offset_n := offset_n + page;

      exit when taken < page or offset_n >= depth;
    end loop;
  end loop;

  return written;
end;
$$;
