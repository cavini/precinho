-- Match the stored name exactly, and stop normalising it in two places.
--
-- 0036 keyed product_names on lower(unaccent(name)). That puts a second
-- notion of "the same name" in SQL beside normalizeText in TypeScript,
-- and the two will drift the first time either changes — which is the
-- failure that was avoided deliberately an hour earlier by deciding the
-- product grouping in TypeScript and letting SQL only apply it.
--
-- Nothing needs the fuzzy form. A shop publishes the same string in every
-- sweep: "Sabonete Barra Vegetal Odor de Rosas Phebo Envoltório 90g" came
-- back byte for byte on each run. Exact is enough, and it cannot drift.

drop table if exists product_names;

create table product_names (
  name       text primary key,
  product_id uuid not null references products (id) on delete cascade,
  -- Which shop calls it this. Null for names recovered from a merge,
  -- where the row that carried them is already gone.
  store_id   uuid references stores (id) on delete set null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index if not exists product_names_product_idx on product_names (product_id);

comment on table product_names is
  'Every name a product goes by, as the shops write it. The durable record of a grouping: a match key is derived and has already changed shape once, a name has not.';

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

    -- The name the absorbed row went by becomes one of the survivor's.
    -- This is what stops the next sweep recreating the row.
    insert into product_names (name, product_id)
    select p.name, survivor
    from products p
    where p.id = any (losers)
    on conflict (name) do update set product_id = excluded.product_id;

    insert into product_aliases (match_key, product_id)
    select p.match_key, survivor
    from products p
    where p.id = any (losers)
      and p.match_key is distinct from new_key
    on conflict (match_key) do update set product_id = excluded.product_id;

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

    update product_aliases set product_id = survivor where product_id = any (losers);
    update product_names   set product_id = survivor where product_id = any (losers);

    delete from products where id = any (losers);

    update products set match_key = new_key where id = survivor;

    merged := merged + 1;
  end loop;

  return merged;
end;
$$;

-- Seed from what is already known: every surviving product's own name,
-- and every name absorbed into one.
insert into product_names (name, product_id)
select p.name, p.id from products p
on conflict (name) do nothing;

insert into product_names (name, product_id)
select m.absorbed_name, m.survivor_id
from product_merges m
join products p on p.id = m.survivor_id
on conflict (name) do nothing;
