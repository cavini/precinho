-- A tied price stops being a coin flip.
--
-- `distinct on (product_id, store_id) order by collected_at desc` picks one
-- row per shop, and when a run has written two rows for the same product and
-- shop at the same instant with different prices, which one it picks is up
-- to the planner. Shibata has the Delfonte 20L at 13,99 as a refill and
-- 39,99 with the bottle, both on the same timestamp, both the same product
-- here. The page can show either.
--
-- I told Arthur this affected about 500 products. It does not: 624 pairs
-- have had such a tie at some point in their history, and **four** have one
-- on their current row. The fix is two words in an order by, so it is worth
-- having for four — a price that is a coin flip is the kind of fault that
-- stays invisible until somebody is standing in a shop — but it was not
-- worth the billing I gave it.
--
-- Cheapest of the tie, then the newest row id. Cheapest because the url
-- travels with the price in the same row, so the figure shown is one the
-- shopper can actually reach and buy. Newest id only to make it total.
--
-- What this does not fix is why two rows exist. All 341 of the historical
-- groups have different urls, so they are genuinely different listings at
-- one shop that got merged onto one product — a refill and a bottle, an old
-- SKU and a new one. That is the matcher's business, and five product/shop
-- pairs currently hold several live listings at different prices. Left
-- alone deliberately: merging two listings that really are the same product
-- is correct, and telling those apart from a refill and a bottle needs more
-- than a price.

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
    -- Two branches, and only ever one of them runs.
    --
    -- A trigram is three characters, so pg_trgm cannot index a pattern
    -- shorter than that: it answers `like '%ar%'` by returning every entry
    -- in the index and then visiting every heap page they point at, which
    -- is the seq scan it replaced plus the index read on top. Measured,
    -- best of three interleaved runs: "ar" 148ms/18,380 blocks before,
    -- 278ms/20,718 after; "tv" 38ms/5,727 before, 157ms/8,065 after.
    --
    -- So the indexable predicate is emitted only when the longest token can
    -- produce a trigram. The length test is a one-time filter over the
    -- parameter rather than a per-row condition, which is why this is two
    -- branches and not an OR: an OR would be evaluated per row and would
    -- put the planner back where it started, while a branch whose one-time
    -- filter is false is skipped whole.
    (
      select p.id, p.name, p.description, p.brand, p.size_amount, p.size_unit,
             p.image_url, p.gtin14, p.search_text
      from products p
      where (select max(length(tok)) from unnest(p_tokens) as tok) >= 3
        -- One token, written so the planner can reach the trigram index.
        --
        -- The two ALL(array) forms are correct and unindexable: the planner
        -- cannot push a scalar array operator into an index condition, so it
        -- read all 78,610 rows every time. This repeats the same test for
        -- the most selective token as a plain predicate against a pattern it
        -- can extract trigrams from, which turns the scan into a bitmap
        -- index scan and leaves the ALL forms as residual filters.
        --
        -- The longest token, because trigram selectivity goes with length:
        -- "sanitaria" has nine trigrams to intersect on. Ties broken by
        -- value so the choice is deterministic and the plan is stable.
        --
        -- Implied by the regex, exactly as the cheap test below is, so it
        -- cannot change which products qualify.
        and p.search_text like (
          '%' || (select tok from unnest(p_tokens) as tok
                   order by length(tok) desc, tok limit 1) || '%'
        )
        -- Cheap test next. `like '%tok%'` is implied by the regex — a match
        -- at a word start means the substring is somewhere in the text — so
        -- adding it cannot change which products qualify. It only spares the
        -- regex from being run against the rows that cannot match.
        and p.search_text like all (
          array(select '%' || tok || '%' from unnest(p_tokens) as tok)
        )
        and p.search_text ~ all (
          array(select '\m' || tok from unnest(p_tokens) as tok)
        )
      -- Products the query names first, then shortest text, and only then
      -- the cap. See the note at the top: name length alone was cutting a
      -- salt nine shops carry.
      order by (p.search_text like (
                 (select tok from unnest(p_tokens) as tok
                   order by length(tok) desc, tok limit 1) || '%')) desc,
               length(p.search_text), p.name, p.id
      limit 1200
    )
    union all
    (
      select p.id, p.name, p.description, p.brand, p.size_amount, p.size_unit,
             p.image_url, p.gtin14, p.search_text
      from products p
      where (select max(length(tok)) from unnest(p_tokens) as tok) < 3
        and p.search_text like all (
          array(select '%' || tok || '%' from unnest(p_tokens) as tok)
        )
        and p.search_text ~ all (
          array(select '\m' || tok from unnest(p_tokens) as tok)
        )
      order by (p.search_text like (
                 (select tok from unnest(p_tokens) as tok
                   order by length(tok) desc, tok limit 1) || '%')) desc,
               length(p.search_text), p.name, p.id
      limit 1200
    )
  ),
  current_offers as (
    -- The price compared and shown is the shop's REGULAR price, not today's
    -- online promotion. See the note at the top of this migration.
    select distinct on (o.product_id, o.store_id)
      o.product_id, o.store_id,
      coalesce(o.list_price_cents, o.price_cents) as price_cents,
      null::integer                               as list_price_cents,
      o.url, o.in_stock, o.collected_at
    from offers o
    join stores s on s.id = o.store_id
    where o.product_id in (select id from bounded)
      and o.store_id = any (p_store_ids)
      and s.region_id = p_region_id
      and s.active
    -- Cheapest of a tie, then the newest row, so the pick is never
    -- arbitrary. See the note at the top.
    order by o.product_id, o.store_id, o.collected_at desc,
             coalesce(o.list_price_cents, o.price_cents) asc, o.id desc
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
  ,
  -- One pass over the comparable offers, grouped by product. Every
  -- figure the four laterals used to fetch separately is an aggregate
  -- over this same group.
  -- Materialised on purpose: see the note at the top. Without it this
  -- runs 1,200 times instead of once.
  priced as materialized (
    select
      c.product_id,
      (array_agg(c.store_id order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_store_id,
      min(c.price_cents) as cheapest_price_cents,
      (array_agg(c.list_price_cents order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_list_price_cents,
      (array_agg(c.url order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_url,
      (array_agg(c.collected_at order by c.price_cents asc, c.store_id asc))[1]
        as cheapest_collected_at,
      max(c.price_cents) as dearest_price_cents,
      count(*)::integer as available_store_count,
      jsonb_agg(
        jsonb_build_object(
          'store_id', c.store_id,
          'price_cents', c.price_cents,
          'url', c.url,
          'collected_at', c.collected_at
        )
        order by c.price_cents asc, c.store_id asc
      ) as offers
    from comparable c
    group by c.product_id
  )
  select
    b.id, b.name, b.description, b.brand, b.size_amount, b.size_unit,
    b.image_url, b.gtin14,
    pr.cheapest_store_id, pr.cheapest_price_cents, pr.cheapest_list_price_cents,
    pr.cheapest_url, pr.cheapest_collected_at, pr.dearest_price_cents,
    pr.available_store_count, pr.offers
  from bounded b
  -- Inner, not left: a product nobody nearby sells has no group here, and
  -- nothing the shopper can buy is nothing worth listing. Those rows used
  -- to be fetched and then discarded by a where clause.
  join priced pr on pr.product_id = b.id
  order by
    -- What the shopper asked for, before anything about price.
    --
    -- Three buckets, cheapest first, both tests pure text on a column
    -- already in hand:
    --   0  the name begins with one of the query's words  "Sal Refinado..."
    --   1  every word appears whole somewhere in it       "Margarina com Sal"
    --   2  a word only matched another word's prefix      "Salame"
    --
    -- The word boundary matters. `like tok || '%'` would put Salame and
    -- Salgadinho in bucket 0 for "sal" and Macarrao in bucket 0 for "maca",
    -- which is how I wrote it first and it made "maca" worse rather than
    -- better.
    case
      when exists (select 1 from unnest(p_tokens) as tok
                    where b.search_text ~ ('^' || tok || '\M')) then 0
      when b.search_text ~ all (array(select '\m' || tok || '\M'
                                       from unnest(p_tokens) as tok)) then 1
      else 2
    end,
    -- Most shops first: a product three shops carry is a comparison, one
    -- shop carries is a listing.
    pr.available_store_count desc,
    -- Then where they disagree most, which is what the app is for.
    pr.dearest_price_cents - pr.cheapest_price_cents desc,
    -- A photo makes a row readable; without one the shopper sees a grey box.
    (b.image_url is not null) desc,
    b.name asc,
    b.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function search_products(text[], uuid, uuid[], integer, integer) to anon, authenticated;


-- The feed ranks on the gap between shops, so it has to compare the same
-- prices the listing does or the two screens disagree about what is a deal.

create or replace function product_feed(
  p_region_id uuid,
  p_store_ids uuid[],
  p_limit     integer,
  p_offset    integer default 0
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
language sql
stable
as $$
  with current_offers as (
    -- The regular price, not today's online promotion. See 0062.
    select distinct on (o.product_id, o.store_id)
      o.product_id, o.store_id,
      coalesce(o.list_price_cents, o.price_cents) as price_cents,
      o.url, o.in_stock, o.collected_at
    from offers o
    join stores s on s.id = o.store_id
    where o.store_id = any (p_store_ids)
      and s.region_id = p_region_id
      and s.active
    -- Cheapest of a tie, then the newest row, so the pick is never
    -- arbitrary. See the note at the top.
    order by o.product_id, o.store_id, o.collected_at desc,
             coalesce(o.list_price_cents, o.price_cents) asc, o.id desc
  ),
  available as (
    select * from current_offers where in_stock
  ),
  middles as (
    select a.product_id,
           min(a.price_cents) as cheapest_cents,
           count(*) as shops,
           percentile_cont(0.5) within group (order by a.price_cents) as median_cents
    from available a
    group by a.product_id
  ),
  comparable as (
    -- The refusal, anchored on the middle where there is one.
    --
    -- Against the cheapest, a real spread and one bad row widen the same
    -- end and cannot be told apart. Against the median they separate:
    -- chocolate em pó at 12,98 / 22,49 / 29,90 / 34,99 is a gradient
    -- (1.35x) and stays; fio dental at 17,90 / 19,69 / 20,79 / 46,69 is
    -- three shops agreeing and one multipack (2.31x), and the multipack
    -- goes. 1.75 rather than 2: a Heinz ketchup put its Sam's Club
    -- multipack 1.84x above the middle and reached the top of the feed.
    --
    -- With only two prices there is no middle, so the old rule stands and
    -- the cheapest is kept: it is almost always the single unit and a
    -- real price, even though the card then has nothing to compare it
    -- with and drops out below.
    --
    -- Mirrors ComparablePrices in the domain. If one changes, change both.
    select a.*
    from available a
    join middles m on m.product_id = a.product_id
    where case
            when m.shops >= 3 then a.price_cents <= m.median_cents * 1.75
            else a.price_cents <= m.cheapest_cents * 3
          end
  ),
  spreads as (
    select
      c.product_id,
      (max(c.price_cents) - min(c.price_cents))::integer as spread_cents,
      count(*) as store_count
    from comparable c
    group by c.product_id
    -- Two stores minimum, counted after the refusal: a product left with
    -- one believable price is no longer a comparison.
    having count(*) > 1
  )
  select
    p.id,
    p.name,
    p.brand,
    p.size_amount,
    p.size_unit,
    p.image_url,
    p.gtin14,
    sp.spread_cents,
    (
      select jsonb_agg(
               jsonb_build_object(
                 'store_id', c.store_id,
                 'price_cents', c.price_cents,
                 'url', c.url,
                 'collected_at', c.collected_at
               )
               order by c.price_cents asc, c.store_id asc
             )
      from comparable c
      where c.product_id = p.id
    ) as offers
  from spreads sp
  join products p on p.id = sp.product_id
  order by (p.image_url is not null) desc,
           sp.spread_cents desc,
           sp.store_count desc,
           p.id
  limit least(greatest(p_limit, 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- The old three-argument signature would otherwise linger beside the new one.
drop function if exists product_feed(uuid, uuid[], integer);

grant execute on function product_feed(uuid, uuid[], integer, integer) to anon, authenticated;


-- And the product page, which is where somebody checks the figure before
-- walking to a shop.

create or replace function product_offers(
  p_product_id uuid,
  p_store_ids  uuid[]
)
returns table (
  store_id         uuid,
  price_cents      integer,
  list_price_cents integer,
  url              text,
  in_stock         boolean,
  collected_at     timestamptz
)
language sql
stable
as $$
  -- The regular price, not today's online promotion. See 0062.
  select distinct on (o.store_id)
    o.store_id,
    coalesce(o.list_price_cents, o.price_cents) as price_cents,
    null::integer                              as list_price_cents,
    o.url, o.in_stock, o.collected_at
  from offers o
  join stores s on s.id = o.store_id
  where o.product_id = p_product_id
    and o.store_id = any (p_store_ids)
    and s.active
  order by o.store_id, o.collected_at desc,
           coalesce(o.list_price_cents, o.price_cents) asc, o.id desc;
$$;

-- No feed rebuild here. The ordering only settles ties, and the nightly
-- run refreshes the cache anyway — a rebuild holds the function's lock for
-- half a minute against live traffic, which is how applying this the first
-- time ended up stuck in an open transaction.
