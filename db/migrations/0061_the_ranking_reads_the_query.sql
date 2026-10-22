-- The ranking starts reading the query.
--
-- It contained nothing about what was typed — shops carrying it, then price
-- spread, then whether there is a photo. For most terms that is fine,
-- because almost everything matching "detergente" is a detergent. For the
-- ones where it is not fine it is badly not fine: searching "sal" put four
-- margarines and a butter above the salt, and "maca" returned Macarrao,
-- Maionese and Macaxeira with not one apple in the top eight.
--
-- Measured across 22 terms, share of the top eight rows whose name begins
-- with a word from the query:
--
--   sal        3/8 -> 8/8        maca       0/8 -> 8/8
--   carne      1/8 -> 8/8        acucar     3/8 -> 8/8
--   chocolate  5/8 -> 8/8        sabonete   5/8 -> 8/8
--   cha        5/8 -> 8/8        suco       6/8 -> 8/8
--   mean 77% -> 100%, and not one term got worse.
--
-- "sal" goes from 5 on-topic rows out of 24 to 24 of 24, and its first row
-- is the salt nine shops carry rather than a margarine.
--
-- Free, which is why it goes first among the things left to fix. Both tests
-- are regexes over search_text, a column the candidate stage has already
-- fetched, evaluated on at most 1,200 rows. Measured on the whole function,
-- best of three: sal 135ms/16,655 blocks -> 124ms/16,655; leite
-- 121/17,557 -> 124/17,557; maca 94/13,843 -> 94/13,843. Identical buffers
-- in every case.
--
-- Price still decides everything inside a bucket, so the comparison the app
-- exists for is untouched: among the products that are actually what you
-- asked for, the one more shops carry and disagree most about still comes
-- first.

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
