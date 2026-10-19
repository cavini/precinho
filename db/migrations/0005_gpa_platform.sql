-- A third storefront platform.
--
-- GPA runs neither VTEX nor Magento but its own service, and its search
-- takes a POST body rather than a query string.
--
-- Two existing columns carry its configuration rather than adding more, and
-- the reuse is deliberate because the meaning lines up:
--
--   region_token -> GPA's numeric store id ("461"), which is exactly what
--                   that column is for: the identifier that pins this row
--                   to a trading area. Different store, different price.
--   store_view   -> the banner path ("pa"), the same role it plays for
--                   Magento: which storefront variant of the chain this is.

alter table stores
  drop constraint if exists stores_platform_known;

alter table stores
  add constraint stores_platform_known
  check (platform in ('vtex-legacy', 'magento-graphql', 'gpa-api'));

comment on column stores.region_token is
  'Platform identifier for this trading area: a VTEX region token, or GPA''s numeric store id.';

comment on column stores.store_view is
  'Storefront variant: a Magento store view, or a GPA banner path. Null elsewhere.';
