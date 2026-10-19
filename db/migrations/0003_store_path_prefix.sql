-- Some storefronts mount the catalogue API under a prefix.
--
-- Atacadão serves it at /io/api/catalog_system/..., and a chain whose own
-- domain sits behind a WAF can often be read through its VTEX account host
-- instead ("<account>.vtexcommercestable.com.br"), which is the same public
-- catalogue without the custom routing. Both are configuration, so they
-- belong in the store row rather than in a branch in the collector.

alter table stores
  add column if not exists path_prefix text;

comment on column stores.path_prefix is
  'Mount point for the catalogue API when it is not at the host root, e.g. ''/io'' for Atacadão.';

-- A prefix is a path fragment, not a URL: it starts with a slash and does
-- not end with one, so joining it to the API path can never produce '//'.
alter table stores
  drop constraint if exists stores_path_prefix_shape;

alter table stores
  add constraint stores_path_prefix_shape
  check (path_prefix is null or path_prefix ~ '^/[A-Za-z0-9._~-]+$');
