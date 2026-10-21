-- Look products up through a request body instead of a query string.
--
-- The collector resolved known names and keys with `in (...)`, which
-- PostgREST takes as a URL parameter. Two hundred product names make a
-- URL long enough that fetch gives up before sending it, and the error
-- was "TypeError: fetch failed" with nothing about length in it.
--
-- The lookup then failed open — a warning, and every product treated as
-- new. So a collection run recreated exactly the rows the merges had
-- removed, reported success, and the only trace was two warnings in a
-- log nobody reads. The Phebo soap was back as two rows within minutes
-- of the fix that was supposed to prevent it.
--
-- Found by running a real collection and looking at the product
-- afterwards. The unit tests passed throughout: they exercise the
-- adapter against a fake client that has no URL.
--
-- An rpc call posts its arguments, so length stops being a limit.

create or replace function resolve_product_names(p_names text[])
returns table (name text, product_id uuid)
language sql
stable
as $$
  select n.name, n.product_id
  from product_names n
  where n.name = any (p_names);
$$;

create or replace function resolve_product_aliases(p_keys text[])
returns table (match_key text, product_id uuid)
language sql
stable
as $$
  select a.match_key, a.product_id
  from product_aliases a
  where a.match_key = any (p_keys);
$$;

grant execute on function resolve_product_names(text[]) to anon, authenticated;
grant execute on function resolve_product_aliases(text[]) to anon, authenticated;
