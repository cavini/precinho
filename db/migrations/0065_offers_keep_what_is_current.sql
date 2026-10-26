-- Offers stop being append-only forever.
--
-- 0001 made offers append-only and called price history "a by-product of
-- collecting rather than a second feature". Nothing ever grew into reading
-- it: every query that reaches offers — search_products, product_offers,
-- the feed ranking — takes `distinct on (product_id, store_id) ... order by
-- collected_at desc`, exactly one row per pair. Eight nights of collecting
-- bought 1,085,069 rows to serve 131,777 of them, and the 500 MB the
-- project is allowed was 99.5% spent.
--
-- Two kinds of row are dead weight, and they need different rules.
--
-- **Stores that are no longer collected.** 0051 narrowed collection to one
-- region; the sixteen stores of the four regions left behind still hold
-- 221,314 offers that nothing will ever refresh. The site filters stores on
-- `active`, so those rows are already invisible — every one of them goes,
-- the most recent included.
--
-- **Superseded history on a store still collected.** Here the most recent
-- offer for a (product, store) pair is never touched, whatever its age. The
-- readers have no staleness filter, so deleting that row does not show a
-- stale price: it removes the store from the product's page. Sweeps can be
-- two days apart — Carrefour, Extra and Atacadão have been — and a store
-- that stops answering for a week has to keep its last known price until it
-- answers again.
--
-- The window is a parameter rather than a policy welded into SQL. Three
-- days is longer than the widest gap yet seen between two sweeps, so every
-- store always has a previous price to check a new one against, which is
-- what the history was useful for in practice.

create or replace function prune_offers(
  p_keep_history interval default interval '3 days',
  p_batch integer default 20000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - p_keep_history;
  v_store  uuid;
  v_rows   integer;
  v_total  integer := 0;
begin
  -- Phase 1 — a store nobody collects any more keeps nothing.
  --
  -- Driven from the store list so `offers_store_collected_idx` does the
  -- finding. A predicate on `active` alone would have to join every offer
  -- to its store, which is a sequential scan of the whole table once per
  -- batch on an instance whose buffer pool is smaller than the table.
  for v_store in select id from stores where not active loop
    loop
      delete from offers
       where id in (select id from offers where store_id = v_store limit p_batch);

      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      exit when v_rows = 0;
    end loop;
  end loop;

  -- Phase 2 — past the window, keep only what is current.
  --
  -- "Superseded" is spelled as `a newer row exists for the same pair`,
  -- which `offers_current_idx` answers with one probe, rather than as a
  -- window function over the table. A tie on `collected_at` leaves both
  -- rows in place: keeping one row too many is the harmless direction, and
  -- keeping one too few is the one that empties a product's page.
  --
  -- Complexity: O(k log n) for k doomed rows, one index probe each, issued
  -- in ceil(k / p_batch) statements per store — so no single statement runs
  -- long enough to meet the statement timeout, which is the constraint that
  -- decided the shape of this function.
  for v_store in select id from stores where active loop
    loop
      delete from offers
       where id in (
         select o.id
           from offers o
          where o.store_id = v_store
            and o.collected_at < v_cutoff
            and exists (
              select 1
                from offers newer
               where newer.product_id = o.product_id
                 and newer.store_id = o.store_id
                 and newer.collected_at > o.collected_at
            )
          limit p_batch
       );

      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
      exit when v_rows = 0;
    end loop;
  end loop;

  return v_total;
end;
$$;

-- A `security definer` function that deletes prices must not be callable by
-- the public. Postgres grants execute to `public` on a new function by
-- default, and the site's anon key would inherit it — which would put "wipe
-- the catalogue" one unauthenticated RPC call away.
revoke all on function prune_offers(interval, integer) from public;
grant execute on function prune_offers(interval, integer) to service_role;
