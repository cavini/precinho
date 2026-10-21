# Chains with no catalogue to collect

Each of these was investigated and found to publish no machine-readable
priced catalogue. They are recorded here so the investigation is not
repeated — every one of them looks collectable from the outside, and the
reason each is not takes a couple of hours to establish.

A chain belongs here when the evidence is that the prices do not exist in
public, structured form. A chain whose robots.txt forbids us, or whose
catalogue is behind a bot wall, is a different case and is not the same
answer.

## Assaí

Its site is per-branch promotional flyers. There is no priced catalogue
behind them.

## Bacana

The chain is real — three units in the second region, CNPJs `58.259.050/0001-78` and
`58.303.774/0001-71`, both registered at Praça Santa Terezinha 185 under
one owner, opened November and December 2024.

**The obvious website belongs to somebody else.** `bacanasupermercado.com.br`
is the Bacana of Salto de Pirapora, 250km away in the Sorocaba region: area
code 15 rather than 12, a different Instagram account, and a page
advertising "120 anos de história", which a company registered in November
2024 cannot have. Collecting from it would have filed Sorocaba-region
prices under a the second region label, which is precisely the failure this project
spent a day removing from the VTEX chains.

the second region's Bacana serves no host of its own: every plausible domain is
NXDOMAIN, and it is a tenant of no white-label grocery platform (checked
against instabuy, mercadapp, vipcommerce, mercashop, superon and
mercafacil, with a control that answers). Its app is CresceVendas, a
CPF-at-the-till loyalty club with no cart, no catalogue and no product
pages. Prices are published in Instagram reels and a WhatsApp channel —
the Assaí pattern, distributed as video instead of PDF.

CresceVendas is multi-tenant across 1,300+ shops, but it is a loyalty
vendor rather than a commerce platform, so it is not a route to anybody's
prices.

## OXXO

`www.oxxo.com.br` is a static SPA on a public Oracle Object Storage
bucket. Because the bucket lists, the inventory is exhaustive rather than
inferred: 293 objects, of which four are JSON, and **none carries a price
field**. The offer cards are `{img, imgAlt, category, startDate, endDate}`
and the prices exist only as pixels inside the JPEGs — the `/ofertas` page
returns no `R$` in its DOM at all.

The clearest single fact: `mercadooxxo.com.br` now redirects to the
brochure site. The storefront existed and was retired.

There is also no region dimension to find. The offers JSON requested with a
the second region CEP and with a Rio Branco, Acre CEP came back byte-identical — same
sha256, same content-md5 — and the site has no address input anywhere to
set one with. Their own `lojas.json` lists 36 shops, all in São Paulo
capital, while the press reports three OXXO units in the second region; nothing they
publish ties a price to a shop.

Worth knowing even if it were collectable: alcohol, confectionery, snacks
and soft drinks are 164 of their 239 published offers — 69%. Groceries are
12%, perishables 6%, hygiene and cleaning 5%. The slice that compares with
a supermarket basket is about a fifth of the range.

The two places OXXO prices do appear online are both closed. iFood serves a
Cloudflare challenge and then a PerimeterX wall, and marketplace prices are
not shelf prices in any case. Rappi's robots.txt disallows `/api`,
`/api-services` and `/producto`.

**Revisit when:** OXXO has announced a first-party ordering app with
click-and-collect and delivery, enabled on roughly 75 of 600+ shops as of
early 2025. A public HTTP API there would be a per-shop endpoint, which is
exactly what a the second region row needs.
