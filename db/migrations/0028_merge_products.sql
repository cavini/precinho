-- Merges product rows that turned out to be the same product.
--
-- Until now a row without a barcode was keyed per store, so the same
-- packaged item existed once per shop: "Sabonete Barra Original Dove 90G"
-- was three products with one price each, and the comparator compared
-- nothing. Roughly four in five rows carry no barcode — GPA and Tenda
-- publish none — so this is most of the catalogue, not an edge.
--
-- The grouping is decided in TypeScript by ProductMatcher, because the
-- name normalisation lives there and a second implementation in SQL would
-- drift from it the first time either changed. This function only applies
-- a decision already made: move the offers, fold in whatever metadata the
-- survivor is missing, delete the losers, take the new key.
--
-- Takes every group in one call. One round trip per group would be tens of
-- thousands of them.
--
-- Complexity: O(total offers moved + rows deleted), one statement each.

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

    -- Price history belongs to the product, so it follows the survivor
    -- rather than being deleted with the row it happened to be filed under.
    update offers set product_id = survivor where product_id = any (losers);

    -- Whichever row has a photo, a blurb or a barcode, the survivor ends up
    -- with it: the shops describe the same item with different completeness.
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

comment on function merge_product_groups(jsonb) is
  'Applies product merges decided by ProductMatcher. Groups: [{survivor, losers[], key}].';
