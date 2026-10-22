# Carrefour's region token returns a placeholder, not a price

Probed 2026-10-21 and corrected 2026-10-22 against
`carrefourbrfood.vtexcommercestable.com.br`.

**The correction first, because the earlier version of this file had it
backwards and the app quoted fiction for a day on the strength of it.**

Lysoform Original 1L, `ean 7897000800548`, bought at the Taubaté shop for
**R$ 19,19**:

| request                               | Price | Avail | Instalments | PriceValidUntil |
| ------------------------------------- | ----- | ----- | ----------- | --------------- |
| Intelligent Search, no region         | 19.39 | 10000 | 14          | 2027-10-22      |
| Intelligent Search, Taubaté token     | 9.49  | 0     | 0           | 2050-01-01      |
| Intelligent Search, São Paulo token   | 9.49  | 0     | 0           | 2050-01-01      |

Both tokens return the same figure and that figure is not a price. No stock,
no instalments, and a validity sentinel forty years out: it is the skeleton
the pricing layer returns when it has nothing to say. The unregioned
response is within 1% of the shelf.

Three more bought the same day, all quoted too cheap by the app:

| product                      | app (regioned) | shelf | no region |
| ---------------------------- | -------------- | ----- | --------- |
| Comfort refil 900ml          | 14,29          | 22,99 | 19,29     |
| Cera Tacolac 500ml           | 14,85          | 16,99 | 16,59     |
| Cif refil 450ml              | 8,69           | 11,49 | 8,09      |

Measured at scale against the median of every other active shop on the same
product: Carrefour ran **17% low**, with 1,192 of 2,578 comparable products
more than 20% below and 384 more than 40% below. Every other shop sits
between −9% and +26%. On a sample of eight of the worst, dropping the token
moved six back into line — 3,98 → 7,13 against a median of 7,19; 7,59 →
13,19 against 12,99.

So `stores.uses_region_token` is false for Carrefour and the sweep sends no
`regionId`. See migration 0060.

## What this costs

Carrefour's stored prices are now its default sales policy rather than
Taubaté's. That is worse in principle and much better in fact: for the four
products checked by hand the default policy is what the shop charges, within
2% on two of them.

It also means `AvailableQuantity` comes back as 10000 on every row — VTEX's
"unlimited" sentinel, the same thing Atacadão and Sam's Club return. So
`reports_stock` stays false for Carrefour, now because the figure is a
sentinel rather than because it is absent.

**0010 concluded the opposite** — that `regionId` was the honest price and
the legacy catalogue endpoint the liar — and everything after it was built
on that, including 0054. The part of 0054 that stands is reading `Avail: 0`
as "no stock reported" rather than "sold out". The part that was wrong was
trusting the Price beside it.

## Still true: Carrefour cannot be swept by category

Intelligent Search on this account ignores every category filter.
`fq=C:/path`, the category path in the URL and
`selected_facets=category-1:<id>` all return `recordsFiltered: 79841` — the
whole catalogue — with a washing machine first in Mercearia.

The legacy catalogue endpoint is the only category-filterable one. It also
ignores `regionId`, which no longer matters now that we send none, so
`sweep_mode = 'categories'` is worth revisiting for Carrefour: 50 roots,
4,309 nodes at depth 3, 79,943 products, of which roughly 65,000 are in the
grocery, drugstore, cleaning and hygiene aisles against about 6,400 the term
sweep stores. What has to be checked first is whether the legacy endpoint's
prices match the unregioned Intelligent Search prices now taken as correct.

## Online price is not shelf price

A separate limit, and not fixable by collecting differently. The Cif refil
above reads `Price 8.09, ListPrice 11.56` unregioned: 8,09 is an online
promotion and 11,56 the regular price. The shelf charged 11,49. Reading
`Price` gives the promotional figure, which is right for somebody buying
online through the link and wrong for somebody standing in the shop.

Every chain here is read from its delivery catalogue, so every price in the
app is an online price. That is what the footer's instruction to confirm
before buying is for.
