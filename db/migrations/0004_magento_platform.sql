-- A second storefront platform.
--
-- Tauste runs Magento, not VTEX, and publishes its catalogue over GraphQL.
-- That is why StoreCatalogGateway is an interface: a new platform is a new
-- adapter plus a row, and nothing above the infrastructure layer changes.

alter table stores
  drop constraint if exists stores_platform_known;

alter table stores
  add constraint stores_platform_known
  check (platform in ('vtex-legacy', 'magento-graphql'));

-- Magento prices per store view, one per town on a chain like Tauste. Sent
-- as the `Store` header; collecting without it records whichever view is
-- default rather than the region's own prices.
alter table stores
  add column if not exists store_view text;

comment on column stores.store_view is
  'Magento store view sent as the Store header, e.g. ''marilia''. Null on other platforms.';
