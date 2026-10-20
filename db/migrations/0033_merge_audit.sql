-- Keeps a record of which rows were folded into which.
--
-- Merging is destructive: the losing row is deleted and its offers move.
-- That is fine when the judgement was right and unrecoverable when it was
-- not, and a run that judges forty-five thousand pairs will get some of
-- them wrong. Without this, a bad verdict is a product that silently
-- stopped existing and a price quoted under somebody else's name.
--
-- Not a full undo — the row is gone, and rebuilding it would mean
-- re-collecting. What this gives is the ability to answer "why does this
-- product now show a price from a shop that does not sell it", which is
-- the question that will actually be asked, and to delete the verdict so
-- the next collection run keeps the two apart again.

create table if not exists product_merges (
  id          bigint generated always as identity primary key,
  survivor_id uuid not null references products (id) on delete cascade,
  -- Deliberately not a foreign key: the row it names no longer exists.
  absorbed_id uuid not null,
  absorbed_name text not null,
  absorbed_gtin14 char(14),
  decided_by  text,
  merged_at   timestamptz not null default now()
);

create index if not exists product_merges_survivor_idx on product_merges (survivor_id);
create index if not exists product_merges_absorbed_idx on product_merges (absorbed_id);

comment on table product_merges is
  'What was folded into what, so a wrong merge can be explained and the verdict behind it withdrawn.';

-- Recorded inside the merge itself, so the two cannot drift apart.
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

    -- Before anything is destroyed.
    insert into product_merges (survivor_id, absorbed_id, absorbed_name, absorbed_gtin14, decided_by)
    select survivor, p.id, p.name, p.gtin14, g ->> 'decided_by'
    from products p
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
