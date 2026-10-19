-- Product links have to reach a shop, not an admin login.
--
-- Oba and Carrefour are read through their VTEX account hosts, and VTEX
-- returns each product's link on whichever host answered. Visiting one of
-- those redirects to /admin/login — so 1,317 stored offers had a "ver na
-- loja" button that went somewhere no shopper can use. The link is the
-- entire point of a price comparison.
--
-- So the host the collector reads from and the host a link points at are
-- now separate things.

alter table stores
  add column if not exists storefront_host text;

comment on column stores.storefront_host is
  'Public domain for product links, when it differs from the host the collector reads. Null means the link is used as given.';

update stores set storefront_host = 'www.oba.com.br'            where slug = 'oba';
update stores set storefront_host = 'mercado.carrefour.com.br'  where slug = 'carrefour';

-- Repair what is already stored rather than waiting for the next sweep:
-- every one of these links is currently dead.
update offers o
   set url = regexp_replace(o.url, '^https://[^/]+', 'https://' || s.storefront_host)
  from stores s
 where s.id = o.store_id
   and s.storefront_host is not null
   and o.url like 'https://%vtexcommercestable.com.br/%';
