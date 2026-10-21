-- Every name a product is known by, in every shop that sells it.
--
-- Arthur's framing, and it is the right one: what has to survive is not
-- the derived key but the name itself — "this is called X at Pão de
-- Açúcar and Y at Atacadão, and they are the same thing".
--
-- product_aliases, added an hour ago, keeps the match *key* of an
-- absorbed row. That works until the day the key changes shape. The key
-- is a slug of the name plus the pack size, and it has already changed
-- once today: barcode-less products went from "store:{shop}:{slug}" to
-- "pkg:{slug}:{size}". Every alias recorded under the old shape would
-- have been dead on arrival. The name does not move.
--
-- It is also the only form a person can audit. "pkg:sabonete-barra-
-- vegetal-odor-de-rosas-phebo-envoltorio-90g:0.09kg" says nothing to
-- somebody asking why two prices sit on one row; "Sabonete Barra Vegetal
-- Odor de Rosas Phebo Envoltório 90g" answers it.

create table if not exists product_names (
  -- Accent-free, lower-case, collapsed: what two spellings of one name
  -- have in common. Unique, because a name belongs to one product.
  normalized text primary key,
  product_id uuid not null references products (id) on delete cascade,
  -- As the shop writes it, for reading and for showing.
  name       text not null,
  -- Which shop calls it this. Null for names recovered from merges, where
  -- the row that carried them is already gone.
  store_id   uuid references stores (id) on delete set null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index if not exists product_names_product_idx on product_names (product_id);

comment on table product_names is
  'Every name a product goes by. The durable record of a grouping: a key is derived and can change shape, a name cannot.';

-- Names follow the survivor, the same way offers and aliases do.
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

    -- The name the absorbed row went by is now one of the survivor's.
    -- This is what stops the next sweep recreating it.
    insert into product_names (normalized, product_id, name)
    select lower(unaccent(regexp_replace(p.name, '\s+', ' ', 'g'))), survivor, p.name
    from products p
    where p.id = any (losers)
    on conflict (normalized) do update set product_id = excluded.product_id;

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
