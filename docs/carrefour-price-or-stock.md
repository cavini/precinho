# Carrefour gives a regional price or a stock figure, never both

Probed 2026-10-21 against `carrefourbrfood.vtexcommercestable.com.br`, CEP
12010-000 (Taubaté), region token `v2.FD738B5EBA0B624D1D7724CE42CC6CCE`.

One product, Arroz Branco Camil Tipo 1 1kg (`productId=15309`), four ways:

| request                        | Price | ListPrice | AvailableQuantity | Installments |
| ------------------------------ | ----- | --------- | ----------------- | ------------ |
| Intelligent Search, no region  | 4.49  | 5.29      | 10000             | 14           |
| Intelligent Search, `regionId` | 5.19  | 5.19      | **0**             | 0            |
| legacy catalogue, no region    | 4.49  | 5.29      | 99999             | 14           |
| legacy catalogue, `regionId`   | 4.49  | 5.29      | 99999             | 14           |

5.19 is what the shop charges at that CEP. 4.49 is the default sales policy,
which nobody there pays.

So the regional price arrives in a stripped commercial offer — no stock, no
instalments, and `PriceValidUntil` set to the sentinel `2050-01-01` — and the
only response carrying a stock figure carries the wrong price. The legacy
catalogue endpoint accepts `regionId` and ignores it.

There is no third request. `hideUnavailableItems=true` with `regionId`
returns an empty catalogue, which is the same zero stock read back. Passing
`sc=1` or a regional seller as `sc` changes nothing.

**What follows from it.** Under a region token the price is the only
availability signal, so `stores.reports_stock` is false for Carrefour and a
priced item is taken as on sale. An item the area does not sell comes back at
`Price: 0` and is dropped anyway — 7 of 24 results for "esponja" were.

Reading the zero as "sold out" is what hid every Carrefour price in the app
between 2026-10-19 23:05 and 2026-10-21: 3,682 of 3,684 offers on the last
run were stored out of stock, and search only considers offers in stock.

## Why Carrefour cannot be swept by category

Intelligent Search on this account ignores category filters. `fq=C:/path`,
the category path in the URL, and `selected_facets=category-1:<id>` all
return `recordsFiltered: 79841` — the whole catalogue — and a washing
machine as the first result in Mercearia.

Category browsing therefore only works through the legacy catalogue
endpoint, which prices the wrong area. `sweep_mode = 'categories'` on a
Carrefour row would trade this bug for the one in migration 0010.

What the tree does answer, and it is worth knowing: 50 roots, 4,309 nodes at
depth 3, 79,943 products, of which roughly 65,000 are in the grocery,
drugstore, cleaning and hygiene aisles. The term sweep stores about 6,600.

The way out is to enumerate SKUs through the legacy catalogue, which pages
50 at a time and is cheap, and price them through Intelligent Search or
`POST /api/checkout/pub/orderForms/simulation`, which takes a batch of SKUs
and a postcode. Not built.
