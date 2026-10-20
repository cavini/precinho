-- The merge record keeps the reason the pair was judged the same.
--
-- product_equivalences references products with "on delete cascade", so
-- applying a merge deletes the losing row and takes the verdict that
-- justified it down with it. That is right for the negatives — a pair
-- whose row no longer exists cannot come up again — and wrong for the
-- positives, because the question somebody will ask is "why does this
-- product show a price from a shop that does not sell it", and the answer
-- was being deleted at exactly the moment it became worth having.
--
-- Caught by watching the counter: 6,007 judged pairs became 4,154 after
-- the first merge ran.

alter table product_merges
  add column if not exists reason text;

comment on column product_merges.reason is
  'Why the judge called the pair the same product. Copied at merge time because the verdict row is cascade-deleted with the absorbed product.';

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
      (survivor_id, absorbed_id, absorbed_name, absorbed_gtin14, decided_by, reason)
    select survivor, p.id, p.name, p.gtin14, g ->> 'decided_by', e.reason
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

    -- Price history belongs to the product, so it follows the survivor
    -- rather than being deleted with the row it was filed under.
    update offers set product_id = survivor where product_id = any (losers);

    -- Whichever row has a photo, a blurb or a barcode, the survivor ends
    -- up with it: the shops describe the same item with different
    -- completeness.
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

    delete from products where id = any (losers);

    -- Last, so the unique index cannot be hit by a key still held by a row
    -- that is about to go.
    update products set match_key = new_key where id = survivor;

    merged := merged + 1;
  end loop;

  return merged;
end;
$$;
