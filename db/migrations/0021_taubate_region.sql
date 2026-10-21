-- the second region, Vale do Paraíba.
--
-- Which chains go in was probed rather than assumed, and the first probe
-- was wrong in a way worth recording: asking each chain's region endpoint
-- whether it serves 12010-000 reported that Zona Sul does — a chain that
-- only operates in Rio. A VTEX account hands back a region id for almost
-- any address, and the search returns a full page regardless, so "it
-- answered" means nothing at all.
--
-- What separates coverage from noise is the seller list. Against a control
-- CEP in Rio Branco, Acre — 3,000km from every chain here — four of the
-- ten came back with their own branches:
--
--   carrefour  19 sellers around the second region, none of them the capital's 35
--   oba        obataubate, against obapamplona in São Paulo
--   atacadao   its own branch sellers
--   samsclub   samsclub4931 and samsclub6058
--
-- Hortifruti and Natural da Terra answered with a single store in Tijuca,
-- Rio, which is a fallback rather than a branch, so they are left out.
--
-- GPA does not expose a store list, but it does expose the store that
-- serves an address: /{banner}/delivery-v2/ecom/deliveryOptions?zipCode=
-- names the branch and carries its numeric id. For 12010-000 that is
-- "0186 - Independência Taubaté" (1384) and "5657 - Taubaté" (1647), both
-- confirmed against /{banner}/stores/{id}/humanization. Worth recording
-- that the static locator JSON lists Pão de Açúcar in the second region but not
-- Extra, and the delivery endpoint shows Extra serving it anyway — the
-- locator is a marketing page, the delivery endpoint is the system of
-- record.
--
-- Sam's Club's branch is in São José dos Campos, 20km away, and is where
-- people in the second region actually shop, so it counts.
--
-- Still outstanding: Tenda and Tauste both have branches in the second region, but
-- Tenda's search API returns no per-branch availability — one national
-- price list — so a the second region row would duplicate São Paulo's rather than
-- price the local shop. Tauste's town is set by a Magento store view that
-- has not been identified yet. Both are left out until they can be
-- priced locally rather than guessed.
--
-- Six chains is a comparison. Marília has one store and therefore has
-- nothing to compare, which is the state this is meant to avoid repeating.

insert into regions (slug, name, city, uf, probe_cep)
values ('taubate-sp', 'Taubaté', 'Taubaté', 'SP', '12010000')
on conflict (slug) do nothing;

-- GPA prices by numeric store rather than by delivery area, so the id goes
-- in region_token the way it does for the capital's rows.
insert into stores (slug, name, chain, region_id, platform, host, region_token, store_view)
select v.slug, v.name, v.chain, r.id, 'gpa-api', 'api.vendas.gpa.digital', v.region_token, v.store_view
from (values
  ('paodeacucar-taubate', 'Pão de Açúcar', 'Pão de Açúcar', '1384', 'pa'),
  ('extra-taubate',       'Extra Mercado', 'Extra',         '1647', 'ex')
) as v(slug, name, chain, region_token, store_view)
cross join regions r
where r.slug = 'taubate-sp'
on conflict (slug) do nothing;

-- Same chains, same accounts, different trading area: a store row is a
-- chain in a place, which is already how Hortifruti sits in both São Paulo
-- and Rio. region_token is left null so the collector resolves it from the
-- region's probe CEP at run time, the way it does everywhere else.
insert into stores (slug, name, chain, region_id, platform, host, sales_channel, path_prefix, storefront_host)
select v.slug, v.name, v.chain, r.id, v.platform, v.host, v.sales_channel, v.path_prefix, v.storefront_host
from (values
  ('carrefour-taubate', 'Carrefour',      'Carrefour',      'vtex-legacy', 'carrefourbrfood.vtexcommercestable.com.br', null, null,  'mercado.carrefour.com.br'),
  ('atacadao-taubate',  'Atacadão',       'Atacadão',       'vtex-legacy', 'www.atacadao.com.br',                       '1',  '/io', null),
  ('samsclub-taubate',  'Sam''s Club',    'Sam''s Club',    'vtex-legacy', 'www.samsclub.com.br',                       '1',  null,  null),
  ('oba-taubate',       'Oba Hortifruti', 'Oba Hortifruti', 'vtex-legacy', 'obahortifruti.vtexcommercestable.com.br',   '1',  null,  'www.oba.com.br')
) as v(slug, name, chain, platform, host, sales_channel, path_prefix, storefront_host)
cross join regions r
where r.slug = 'taubate-sp'
on conflict (slug) do nothing;
