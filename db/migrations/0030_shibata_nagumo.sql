-- Two Vale do Paraíba chains, and two more platforms.
--
-- Shibata runs on VipCommerce and Nagumo on Salesforce Commerce Cloud.
-- Neither was guessable from the page: Shibata's shop is a separate
-- Angular app at loja.shibata.com.br whose only tell is a <vip-root>
-- element, and Nagumo's 730KB homepage carries no platform marker at all —
-- what gave it away was the response headers, `x-dw-request-base-id` and
-- the dwsid/dwanonymous_/dwac_ cookies, which are Demandware's.
--
-- robots.txt was read before anything was collected, for every host the
-- collector actually touches:
--
--   www.loja.shibata.com.br   Allow: / , with checkout, login and the
--                             client area disallowed. Also disallows
--                             /produtos/detalhe, which is the storefront
--                             route product links point at — we build
--                             those links for a shopper to click and never
--                             fetch one.
--   services.vipcommerce.com.br  404, so nothing disallowed. This is the
--                             host the catalogue is actually read from.
--   www.nagumo.com.br         404, so nothing disallowed.
--
-- The Turnstile widget on shibata.com.br is on the WordPress marketing
-- site, not on the shop; the catalogue API is not challenged at all.
--
-- Both chains were checked for the bug this collector already shipped
-- once — storing a default price list under a regional label — and both
-- came back clean, measured rather than assumed:
--
--   Shibata  centre 10 and centre 11 return
--            different assortments for "arroz". Switching the shop's own
--            storefront to its second region's branch reproduced centre 10's list
--            exactly, down to the 4.49 Raroz 1kg only the second region stocks.
--            Prices match between the two centres, but that is Shibata
--            pricing its branches alike — confirmed on its own screen —
--            not a parameter being ignored.
--
--   Nagumo   Arroz T 1 Momiji 5kg is 49.90 at branch 25 and
--            59.90 at 7, 46 and 20 around São Paulo. Reproduced across
--            four branches, then confirmed on the storefront: selecting
--            025-TAUBATE1 changed the number on the page from 59,90 to
--            49,90.
--
-- Both resolvers answer nothing for the Rio Branco control (69900-000),
-- which is what makes a positive answer mean anything. Shibata also
-- answers nothing for São Paulo capital, so it gets a the second region row only.

alter table stores
  drop constraint if exists stores_platform_known;

alter table stores
  add constraint stores_platform_known
  check (platform in ('vtex-legacy', 'magento-graphql', 'gpa-api', 'tenda-api',
                      'vipcommerce', 'sfcc'));

comment on column stores.store_view is
  'Storefront variant: a Magento store view, a GPA banner, a Tenda branch id, a VipCommerce filial, or a Demandware site id. Null elsewhere.';

comment on column stores.region_token is
  'The per-region lever, whatever the platform calls it: a VTEX trading area, a GPA numeric store, a VipCommerce distribution centre, or a Demandware branch.';

comment on column stores.sales_channel is
  'VTEX sales channel, or a VipCommerce organisation id — which tenant of the shared platform is asking.';

-- Shibata, Vale do Paraíba.
--
-- VipCommerce is multi-tenant: every shop on it answers on the same
-- services.vipcommerce.com.br host and is told apart by the organisation
-- id in sales_channel and the domain key, which the collector derives from
-- storefront_host the way the storefront's own bundle does. So the adapter
-- is worth more than this one chain — another VipCommerce grocer is a row.
--
-- Swept by category rather than by keyword. The shop publishes a clean
-- department tree and pages a department to its end without the offset
-- ceiling VTEX imposes, so browsing costs 19 planning requests and reaches
-- the whole catalogue instead of whatever thirty search terms happen to
-- hit.
insert into stores (slug, name, chain, region_id, platform, host, storefront_host,
                    sales_channel, store_view, region_token, sweep_mode)
select 'shibata', 'Shibata', 'Shibata Supermercados', r.id,
       'vipcommerce', 'services.vipcommerce.com.br', 'www.loja.shibata.com.br',
       '161', '1', '10', 'categories'
from regions r where r.slug = 'taubate-sp'
on conflict (slug) do nothing;

-- Nagumo, in both regions it actually serves.
--
-- The branch per region is the chain's own answer, not ours: its CEP
-- resolver sends 01310-000 to 046-OSASCO and 12010-000 to 025-TAUBATE1.
-- Osasco rather than one of the nine São Paulo branches because those are
-- all in the east zone, far from Paulista, and Osasco is the one that
-- delivers there on its own fleet. Same principle as GPA's delivery
-- endpoint in 0021: the store locator is marketing, the delivery endpoint
-- is the system of record.
--
-- Terms rather than categories for now: the branch is carried in a
-- Demandware session, and the category tree is only published as
-- navigation HTML, so planning a sweep would mean parsing a page rather
-- than reading an endpoint. Left until that can be done properly, the way
-- Tenda is.
insert into stores (slug, name, chain, region_id, platform, host, store_view, region_token)
select v.slug, v.name, v.chain, r.id, 'sfcc', 'www.nagumo.com.br', 'Nagumo', v.region_token
from (values
  ('nagumo',         'Nagumo', 'Supermercados Nagumo', 'sao-paulo-sp', '46'),
  ('nagumo-taubate', 'Nagumo', 'Supermercados Nagumo', 'taubate-sp',   '25')
) as v(slug, name, chain, region_slug, region_token)
join regions r on r.slug = v.region_slug
on conflict (slug) do nothing;
