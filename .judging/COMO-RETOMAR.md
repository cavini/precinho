# Resuming the judging run

18 of 30 batches are judged. Everything judged is already in the database;
the remaining work is `lote-18` through `lote-29`, about 18,000 pairs.

Nothing needs undoing or redoing. `scripts/import-verdicts.sh` skips any
batch with an `.importado-*` marker beside it, and `--merge` only applies
verdicts that have not been applied, so every step here is safe to repeat.

## To finish with agents (no money, costs plan usage)

Spawn one agent per remaining batch, each with this instruction:

> Read `.judging/INSTRUCOES.md` first — it defines the task completely.
> Your input file is `.judging/lote-NN`. Write your verdicts to
> `.judging/veredito-NN`. Judge every line. Write only that output file.
> Build each output line by joining your verdict with the id read straight
> from the input rather than retyping it — one agent lost alignment that
> way and had to redo a block.

Six at a time has been comfortable. Measured cost: ~287,000 tokens per
batch, so the twelve remaining come to roughly 3.4 million.

## To finish with the API (about US$4)

Put `ANTHROPIC_API_KEY` in `.env.local` — a key scoped to a workspace, or
an organisation key plus `ANTHROPIC_WORKSPACE_ID` — with credit on the
account. Then:

    npx tsx scripts/judge-equivalences.ts --judge
    npx tsx scripts/judge-equivalences.ts --merge

## After either one

    ./scripts/import-verdicts.sh
    npx tsx scripts/judge-equivalences.ts --merge
    npx tsx scripts/verdict-stats.ts

## Where to look if a merge turns out wrong

`product_merges` holds every fold: what was absorbed into what, its name
and barcode, which batch judged it and the reason given. Deleting the row
in `product_equivalences` stops the next collection joining them again.
The absorbed row itself is gone and only a collection run brings it back.
