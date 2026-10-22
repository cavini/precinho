-- Carrefour's prices come back, after two days of the app showing none.
--
-- Every Carrefour offer collected since 2026-10-19 23:05 was stored out of
-- stock — 3,682 of 3,684 on the latest run — and search only considers
-- offers that are in stock, so the chain was absent from every result.
-- Somebody standing in a Carrefour with the app open saw Tauste's price
-- and not the one on the shelf in front of them. That is how this was
-- found, and it is the worst way to find it.
--
-- The cause is in Carrefour's own responses. Asking Intelligent Search for
-- a trading area's prices returns a stripped commercial offer, measured
-- today on carrefourbrfood.vtexcommercestable.com.br for CEP 12010-000,
-- Arroz Branco Camil Tipo 1 1kg:
--
--   with regionId     Price 5.19  AvailableQuantity 0      Installments 0
--   without regionId  Price 4.49  AvailableQuantity 10000  Installments 14
--
-- 5.19 is what the shop charges; 4.49 is the default sales policy nobody
-- there pays. So the correct price arrives with no stock figure, the wrong
-- one arrives with a stock figure, and no third request returns both:
-- hideUnavailableItems=true against the region returns an empty catalogue,
-- and the legacy catalogue endpoint quotes 4.49 whether a regionId is
-- passed or not.
--
-- A column rather than a code branch, because "does this catalogue report
-- stock" is a property of the shop's API, like sweep_mode and
-- sales_channel. Default true: Oba reports 9% of its catalogue out of
-- stock and means it.
--
-- Under a region token the price is the availability signal. An item the
-- area does not sell comes back at Price 0, and the collector already
-- drops those rather than storing a free product.

alter table stores
  add column if not exists reports_stock boolean not null default true;

comment on column stores.reports_stock is
  'Whether this store''s catalogue reports stock. False means a priced item is on sale and an unpriced one is not carried.';

update stores set reports_stock = false where slug like 'carrefour%';
