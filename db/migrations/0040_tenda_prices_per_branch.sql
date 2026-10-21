-- Tenda prices per branch, and 0008 said it did not.
--
-- Measured against the live catalogue on 2026-10-20. Two branches of the
-- same chain, read through the same endpoint seconds apart: 7 of 117
-- matched products carry different prices, acucar cristal Colombo 5kg by
-- R$1.90 (13.99 at Taubate against 15.89), and 27% of the default listing
-- is not carried at Taubate at all. A control run with no branch set,
-- taken at both moments, matched 160 of 160 — so the movement is the
-- branch, not the clock.
--
-- The branch travels as one thing only: `cartId`, the id of a cart their
-- storefront creates the moment a shopper gives a CEP. branchId, idFilial,
-- filial, filialId, idLoja, storeId, region_id and the rest were each
-- tried as query parameter and as header; the endpoint ignores all of
-- them. So the token that pins a Tenda store's region is a cart of ours,
-- already bound to that branch, and `region_token` carries it — the same
-- column VTEX, GPA and SFCC already use for the same job.
--
-- The existing 'tenda' row has no cart and keeps none. It is filed under
-- Sao Paulo, and the catalogue's no-cart default IS Sao Paulo's list:
-- 160 of 160 prices matched the Guarapiranga branch, the one their own
-- /api/public/branch/zip/01310100 returns for Avenida Paulista. Those
-- 12,961 offers are that region's prices. Right by coincidence rather
-- than by design, which is why the collector now warns when a tenda-api
-- row has no cart, and why any second branch must carry one.

comment on column stores.region_token is
  'Token that pins this store to a region: a VTEX regionId, a GPA or SFCC '
  'numeric store, or a Tenda cart id already bound to the branch. Null '
  'where the platform has no such notion — and, for tenda-api, the reason '
  'the catalogue answers with Sao Paulo prices whatever the row claims.';

comment on column stores.store_view is
  'Storefront variant: a Magento store view, a GPA banner, a Demandware '
  'site id, or a Tenda branch id. For Tenda this narrows the in-stock flag '
  'to one shelf and nothing more — the price follows region_token.';
