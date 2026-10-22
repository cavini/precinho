-- Carrefour's region token returns invented prices. Stop sending it.
--
-- The app quoted R$ 9,49 for a Lysoform Original 1L that was then bought
-- for R$ 19,19. Three more of the same: Comfort refil 900ml quoted 14,29
-- and paid 22,99; Tacolac 500ml quoted 14,85 and paid 16,99; Cif refil
-- 450ml quoted 8,69 and paid 11,49. Every one too cheap, which is the
-- direction that does real damage — the listing ranks on cheapest, so
-- Carrefour won each of those comparisons with a price nobody charges.
--
-- Measured today on the Lysoform, shelf price 19,19:
--
--   no regionId              Price 19.39  Avail 10000  Inst 14  valid 2027-10-22
--   regionId, Taubate        Price  9.49  Avail 0      Inst 0   valid 2050-01-01
--   regionId, Sao Paulo      Price  9.49  Avail 0      Inst 0   valid 2050-01-01
--
-- Both tokens, the same figure, and that figure is not a price. No stock, no
-- instalments, and a PriceValidUntil sentinel forty years out: it is a
-- skeleton the pricing layer returns when it has nothing to say, and we were
-- reading the placeholder in it as money.
--
-- 0010 concluded the opposite — that regionId was the only honest price and
-- the catalogue endpoint the liar — and everything since has been built on
-- it, including my own 0054 yesterday, which made these offers visible by
-- declaring Avail 0 to be "no stock reported". That part stands. What was
-- wrong is that I trusted the Price sitting next to it.
--
-- Scale of it, before this: against the median of every other active shop on
-- the same product, Carrefour ran 17% low, with 1,192 of 2,578 comparable
-- products more than 20% below and 384 more than 40% below. Every other shop
-- sits between -9% and +26%. Dropping the token moved 6 of 7 sampled
-- products back in line — 3,98 to 7,13 against a median of 7,19; 7,59 to
-- 13,19 against 12,99.
--
-- A column rather than a code branch, same as sweep_mode and reports_stock:
-- whether a token buys real prices is a property of the shop's API. Default
-- true, because Atacadao and Sam's answer a token with their commercial
-- offer intact — Installments populated, prices in line with everyone else —
-- so their regional prices are real and stay.
--
-- What is given up: Carrefour's prices are now the default sales policy
-- rather than Taubate's. For the four products checked by hand that policy
-- is what the shop charges, within 2% on two of them. It is a worse answer
-- in principle and a far better one in fact.

alter table stores
  add column if not exists uses_region_token boolean not null default true;

comment on column stores.uses_region_token is
  'Whether passing this store a region token yields real prices. False where the regioned response is a placeholder.';

update stores set uses_region_token = false where slug like 'carrefour%';
