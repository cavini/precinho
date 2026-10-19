-- A fourth storefront platform.
--
-- Tenda runs its own REST API. Unlike GPA and Magento it does publish
-- barcodes — the search endpoint returns one per row even though the
-- product page does not — so its products merge on a verified GTIN like
-- the VTEX chains rather than falling back to approximate matching.
--
-- It prices nationally but stocks per branch, so store_view carries the
-- branch id: the thing that turns a chain-wide "in stock" into an answer
-- for a shopper at one CEP.

alter table stores
  drop constraint if exists stores_platform_known;

alter table stores
  add constraint stores_platform_known
  check (platform in ('vtex-legacy', 'magento-graphql', 'gpa-api', 'tenda-api'));

comment on column stores.store_view is
  'Storefront variant: a Magento store view, a GPA banner, or a Tenda branch id. Null elsewhere.';

insert into stores (slug, name, chain, region_id, platform, host)
select 'tenda', 'Tenda Atacado', 'Tenda Atacado', r.id,
       'tenda-api', 'api.tendaatacado.com.br'
from regions r where r.slug = 'sao-paulo-sp'
on conflict (slug) do nothing;
