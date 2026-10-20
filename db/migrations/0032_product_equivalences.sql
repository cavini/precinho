-- Remembers which pairs of rows are the same product, and which are not.
--
-- Name similarity gets a comparator most of the way and then fails in a
-- way no threshold fixes. Measured on a sample of 17 candidate pairs,
-- roughly two thirds were right and the rest were these:
--
--   Bolo de Brigadeiro            vs  Bolo de Brigadeiro com Amêndoas
--   Cepacol Menta Fusion          vs  Cepacol 3 em 1 Menta Fusion
--   Nivea Uniformiza              vs  Nivea Derma Control Uniformiza
--   Saco de Lixo Ecolix 50L c/10  vs  Ecolix 100L c/5
--
-- Every one fails the same way: a single word carries the whole
-- difference, and a coefficient over shared words cannot tell "Amêndoas"
-- or "100 Litros", which change the product, from "Vegetal" or "Oferta",
-- which do not. That is a reading problem, not a tuning problem.
--
-- So the judgement is made once, by something that can read, and kept
-- here. The cheap heuristic stays as the recall stage — it reduces four
-- billion possible pairs to about twelve thousand worth asking about —
-- and this table is the answer to each question, asked once ever.
--
-- Negative verdicts are kept deliberately. They are most of the value: a
-- pair ruled different stays ruled, and a later run neither re-asks nor
-- re-merges it.

create table if not exists product_equivalences (
  -- Ordered so a pair has one row whichever way round it is found.
  left_id     uuid not null references products (id) on delete cascade,
  right_id    uuid not null references products (id) on delete cascade,
  same        boolean not null,
  -- Why, in the judge's own words. A wrong merge is a wrong price shown
  -- to somebody, so it has to be auditable after the fact.
  reason      text,
  -- Which judge said so, so a verdict can be revisited when it changes.
  decided_by  text not null,
  decided_at  timestamptz not null default now(),

  constraint product_equivalences_ordered check (left_id < right_id),
  primary key (left_id, right_id)
);

comment on table product_equivalences is
  'Judged same-product verdicts for candidate pairs. Negatives matter as much as positives: they stop the pair being asked about again.';

-- The merge pass reads every positive verdict at once.
create index if not exists product_equivalences_same_idx
  on product_equivalences (same)
  where same;
