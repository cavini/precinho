-- How each store's catalogue gets read.
--
-- Keyword sweeps only ever find what somebody thought to type: the app
-- returned nothing for "azeite" because the word was not on the list.
-- Browsing the shop's own category tree is bounded by their taxonomy
-- instead of by our imagination, and on Magento it is roughly seven times
-- cheaper per product — 200 to a page against about 30 for a search.
--
-- A column rather than a constant so a chain can be switched over one at a
-- time and switched back if its category endpoint turns out to lie, which
-- is exactly what Tenda's does: duplicate rows, early termination, and not
-- one product its search did not already return.

alter table stores
  add column if not exists sweep_mode text not null default 'terms';

alter table stores drop constraint if exists stores_sweep_mode_check;
alter table stores add constraint stores_sweep_mode_check
  check (sweep_mode in ('terms', 'categories'));

-- Tauste first: it is the store that asked us to collect sparingly, so it
-- is the one with most to gain from pages that carry 200 products.
update stores set sweep_mode = 'categories' where slug = 'tauste';
