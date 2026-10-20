# Judging product pairs

Decide, for each pair of Brazilian supermarket product names in your input
file, whether the two names refer to the **same product**.

**Input** — one JSON object per line:
`{"id": "...", "a": "name | brand | size", "b": "name | brand | size"}`

**Output** — one JSON object per line, one per input line, same order:
`{"id": "<the id verbatim>", "same": true|false, "reason": "<under 12 words, Portuguese>"}`

Judge **every** line. Do not skip any, do not reorder, do not merge lines.
The `id` must be copied exactly.

## The same product

The chains write the same item differently:

- `Sabonete Barra Vegetal Odor de Rosas Phebo Envoltório 90g` /
  `Sabonete Barra Odor de Rosas Phebo Envoltório - 90g` — one shop is wordier
- `Whisky Johnnie Walker Black Label 750ml` /
  `Whisky Escocês Blended Black Label Johnnie Walker 750ml` — word order, extra origin
- ``Vinho Taylor`s Porto Ruby`` / `Vinho Taylors Porto Ruby` — punctuation
- `Gin London Dry Beefeater Garrafa 750ml` / `Gin Beefeater London Dry - 750ml`
- Marketing noise that changes nothing: `Oferta`, `Promoção`, `Leve Mais`,
  redundant descriptors, `Garrafa`/`Frasco`/`Pacote` where the item is obvious

## Different products

A single word often carries the whole difference:

- **Variant or line** — `Black Label` vs `Red Label` / `Blue` / `Gold` / `Green`;
  `Beefeater` vs `Beefeater 24`; `Absolut` vs `Absolut Vanilia` / `Citron` /
  `Tabasco`; `Cepacol Menta Fusion` vs `Cepacol 3 em 1 Menta Fusion`;
  `Nivea Uniformiza` vs `Nivea Derma Control Uniformiza`
- **Flavour or ingredient** — `Bolo de Brigadeiro` vs `Bolo de Brigadeiro com Amêndoas`
- **Sweetness, grape, style** — `Suave` vs `Seco`; `Carménère` vs
  `Cabernet Sauvignon`; `Brut` vs `Rosé Brut`
- **Brand** — `Linguado Frumar` vs `Linguado Frescatto`; `Tunupa` vs `Queulat`,
  even when every other word matches
- **Pack or count** — `50 Litros C/10` vs `100 Litros C/5`
- **Kits and bundles** — `Black Label 750ml` vs `Black Label 1L + Black Label 750ml`;
  `Gin Beefeater` vs `Vodka Absolut + Gin Beefeater`; anything with `Kit`, `+`,
  or a free glass
- **One name omits the brand** and you would have to guess which brand it is

## When unsure, answer false

A missed match costs a duplicate row that somebody will notice. A wrong match
quotes a shopper the price of a product they are not looking at, and nobody
notices. That asymmetry is the whole reason a reader is doing this instead of
a similarity score. Do not stretch to find a match.

## Rules

- Write **only** your own output file. Do not touch any other file, do not run
  git, do not run npm, do not change any code. Other agents are working in this
  repository at the same time.
- The reason is for a human auditing a wrong merge later, so say what actually
  decided it — `"Red Label é outro rótulo"`, not `"produtos diferentes"`.
- Work through the file in order and write the whole output in one go.
- Report back only: how many lines you judged, how many were `true`, and any
  line you could not parse.
