-- Keeps a merge from being undone by the next collection run.
--
-- Products upsert on match_key. When two rows are folded together the
-- loser is deleted and its key goes with it, so the next sweep computes
-- that key again, finds nothing, and creates the row back. Every
-- judgement would have been quietly reversed within a day — the work
-- would have looked done and then come undone while nobody was watching.
--
-- An alias is the absorbed key pointing at the row that absorbed it. The
-- collector resolves incoming keys through this before writing, so the
-- shop that produced the old key keeps attaching its offers to the
-- surviving product.
--
-- Aliases chain: if A is absorbed by B and B is later absorbed by C, A's
-- alias is repointed at C, so a lookup is always one hop.

create table if not exists product_aliases (
  match_key  text primary key,
  product_id uuid not null references products (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists product_aliases_product_idx on product_aliases (product_id);

comment on table product_aliases is
  'Match keys of absorbed products, pointing at the survivor. Without these a merge is undone by the next collection run.';

-- Recorded going forward, so the backfill below is needed only once.
alter table product_merges
  add column if not exists absorbed_match_key text;

create or replace function merge_product_groups(p_groups jsonb)
returns integer
language plpgsql
as $$
declare
  g         jsonb;
  survivor  uuid;
  losers    uuid[];
  new_key   text;
  merged    integer := 0;
begin
  for g in select * from jsonb_array_elements(p_groups)
  loop
    survivor := (g ->> 'survivor')::uuid;
    new_key  := g ->> 'key';
    losers   := array(select jsonb_array_elements_text(g -> 'losers')::uuid);

    -- Before anything is destroyed, and with the verdict still readable.
    insert into product_merges
      (survivor_id, absorbed_id, absorbed_name, absorbed_gtin14, absorbed_match_key,
       decided_by, reason)
    select survivor, p.id, p.name, p.gtin14, p.match_key, g ->> 'decided_by', e.reason
    from products p
    left join lateral (
      select pe.reason
      from product_equivalences pe
      where pe.same
        and ((pe.left_id = survivor and pe.right_id = p.id)
          or (pe.left_id = p.id and pe.right_id = survivor))
      limit 1
    ) e on true
    where p.id = any (losers);

    -- The keys that must keep working after the rows are gone.
    insert into product_aliases (match_key, product_id)
    select p.match_key, survivor
    from products p
    where p.id = any (losers)
      and p.match_key is distinct from new_key
    on conflict (match_key) do update set product_id = excluded.product_id;

    -- Price history belongs to the product, so it follows the survivor
    -- rather than being deleted with the row it was filed under.
    update offers set product_id = survivor where product_id = any (losers);

    update products p
    set image_url   = coalesce(p.image_url, best.image_url),
        description = coalesce(p.description, best.description),
        brand       = coalesce(p.brand, best.brand),
        gtin14      = coalesce(p.gtin14, best.gtin14)
    from (
      select max(image_url)   as image_url,
             max(description) as description,
             max(brand)       as brand,
             max(gtin14)      as gtin14
      from products
      where id = any (losers)
    ) as best
    where p.id = survivor;

    -- Anything already pointing at a row about to disappear follows it,
    -- so a lookup never needs more than one hop.
    update product_aliases set product_id = survivor where product_id = any (losers);

    delete from products where id = any (losers);

    update products set match_key = new_key where id = survivor;

    merged := merged + 1;
  end loop;

  return merged;
end;
$$;

-- The survivor's own key resolves to itself, so the collector can do one
-- lookup instead of two.
insert into product_aliases (match_key, product_id)
select p.match_key, p.id
from products p
on conflict (match_key) do update set product_id = excluded.product_id;
