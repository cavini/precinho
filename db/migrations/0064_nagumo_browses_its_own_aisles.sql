-- Nagumo stops being swept by keyword, using a taxonomy it already gave us.
--
-- Its keyword sweep keeps 24 of the 577 products matching "arroz" — 4.2%,
-- the worst depth of the ten shops — and no term on the list reaches an
-- aisle nobody thought to name.
--
-- 0030 left it on terms because "the category tree is only published as
-- navigation HTML, so planning a sweep would mean parsing a page rather
-- than reading an endpoint". That is still true of their storefront and no
-- longer true of our database: every Nagumo offer URL carries its category
-- path, so the 7,144 links already stored yield 148 third-level categories
-- for no requests at all.
--
--   https://www.nagumo.com.br/categoria/departamentos/basicos-e-matinais
--                                      /commodities/acucar-cristal-...html
--                                       ^^^^^^^^^^^ the cgid
--
-- The cgid is the LAST segment. Verified today against the live
-- controller: `cgid=commodities` answers with count 1,951 and
-- `cgid=bovino` with 462, while the full path answers with none.
--
-- Also verified: `sz=100` is honoured, on the category path and the keyword
-- path alike. The gateway has been asking for 24.
--
-- No region trap here, which is why this one needed none of the price-table
-- archaeology the VTEX shops did. Demandware keeps the branch in
-- server-side session state and `Search-UpdateGrid` is the only product
-- controller there is, so a category request rides the same branch-bound
-- session and carries the same prices as the keyword request we already
-- trust.

create table if not exists store_categories (
  store_id uuid not null references stores (id) on delete cascade,
  cgid     text not null,
  primary key (store_id, cgid)
);

comment on table store_categories is
  'Categories to sweep per store, for platforms that publish no machine-readable tree.';

-- Third level rather than fourth: 148 paths against 155, and the fourth
-- level is mostly single-product leaves whose parent already covers them.
insert into store_categories (store_id, cgid)
select distinct s.id,
       split_part(
         regexp_replace(o.url, '^.*/categoria/(.+)/[^/]+\.html$', '\1'),
         '/', 3)
  from offers o
  join stores s on s.id = o.store_id
 where s.slug like 'nagumo%'
   and o.url ~ '/categoria/([^/]+/){3,}[^/]+\.html$'
on conflict do nothing;

update stores set sweep_mode = 'categories' where slug like 'nagumo%';
