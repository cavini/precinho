-- A survivor only adopts a barcode nobody else holds.
--
-- The merge filled a missing gtin14 from the absorbed row with a plain
-- coalesce. That is fine until the absorbed row's barcode already belongs
-- to a third product, and then the whole merge call fails on
-- products_gtin14_idx — taking every other group in the same batch down
-- with it, because they share one statement.
--
-- Hit while folding back 6,707 rows that a failed lookup had let a
-- collection recreate.
--
-- Declining the barcode is the right loss: the survivor keeps its own
-- identity, the offers still move, and the row that really owns the
-- barcode is untouched.

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
        -- Only a barcode nobody else holds. Adopting one that is already
        -- somebody's fails the unique index and takes the whole batch with
        -- it.
        gtin14      = coalesce(
                        p.gtin14,
                        case
                          when best.gtin14 is null then null
                          when exists (
                            select 1 from products other
                            where other.gtin14 = best.gtin14
                              and other.id <> survivor
                              and other.id <> all (losers)
                          ) then null
                          else best.gtin14
                        end
                      )
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
