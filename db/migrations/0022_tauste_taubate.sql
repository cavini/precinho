-- Tauste prices by city, and there are seven of them.
--
-- I claimed twice that Tauste published a single price list, and was
-- wrong both times. The first claim came from asking GraphQL for
-- availableStores, which answers in the context of the store you are
-- already in and so reported one. Their own homepage carries the real
-- list in window.availableCities: Marília, Bauru, Jundiaí, Sorocaba,
-- São José dos Campos, Campinas and the second region, each with a Magento store
-- view code.
--
-- Checked rather than assumed this time. Same products, two store views:
--
--   Arroz Tio João Integral     Marília 11.79   the second region 10.77
--   Arroz Paganini Caixa 1000g  Marília 28.98   the second region 29.47
--
-- Arthur said he doubted any chain priced a whole state from one list and
-- told me to look properly. He was right, and not only about Tauste.

update stores set store_view = 'marilia' where slug = 'tauste';

insert into stores (slug, name, chain, region_id, platform, host, store_view, sweep_mode, min_interval_ms, daily_request_budget)
select 'tauste-taubate', 'Tauste', 'Tauste', r.id,
       'magento-graphql', 'www.tauste.com.br', 'taubate', 'categories', 2000, 200
from regions r
where r.slug = 'taubate-sp'
on conflict (slug) do nothing;

-- 200 a city, measured: 115 categories come to 186 pages of 200 plus one
-- request for the tree, and today's run covered 110 of them in 180. Two
-- cities is 400 requests a day reaching Tauste's servers, about thirteen
-- minutes at two seconds apart — half a request a second against the
-- 400-1,250 every other chain here takes without being asked.
--
-- The budget is enforced per store row, so the number to defend is the
-- sum, not the row. If the other five cities are ever added this becomes
-- roughly 1,350 a day and is worth another conversation with them first.
update stores set daily_request_budget = 200 where slug in ('tauste', 'tauste-taubate');
