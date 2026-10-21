-- Reads Oba from its public shop instead of its VTEX account host.
--
-- Two problems, one cause.
--
-- The account host carrefourbrfood/obahortifruti.vtexcommercestable.com.br
-- serves a blanket robots.txt — "User-agent: * / Disallow: /" — on every
-- VTEX account, verified today on five of them. We had been sweeping Oba
-- through that host nightly. Nobody at Oba has told us we may, and unlike
-- Carrefour there is no standing authorisation behind it, so the sweep
-- was simply not compliant. It was chosen because www.oba.com.br, the
-- domain on their packaging, does not resolve.
--
-- The right host does exist: www.obahortifruti.com.br is the same VTEX
-- account (window.VTEX_METADATA says account:'obahortifruti') served
-- through their FastStore front. It answers Intelligent Search with
-- prices, resolves regions — 12010-000 returns the seller "obataubate" —
-- and its /robots.txt route returns the application's own HTML rather
-- than a robots file, so it carries no directive forbidding us.
--
-- The second problem is user-facing and worse. storefront_host was set to
-- www.oba.com.br in 0015 to stop links landing on an admin login, and
-- that domain does not resolve at all. Every "ver na loja" link for Oba
-- has been dead: 16,675 offers pointing at a host with no DNS record, and
-- another 1,987 still on the account host. The link is the whole point of
-- a price comparison, so this is the sort of thing to check by following
-- one rather than by reading the code.
--
-- Carrefour stays on its account host deliberately, and that is a
-- different decision rather than an oversight. Arthur works for
-- Unlimitail, Carrefour group's retail-media arm, and has stated
-- repeatedly that he has explicit permission to query the group's data
-- for this internal proof of concept. Their public shop,
-- mercado.carrefour.com.br, does allow crawling in robots.txt but answers
-- 503 to our collector on the search path, and getting past that would
-- mean pretending to be a browser, which is not something to do to
-- somebody who is refusing us.

update stores
   set host            = 'www.obahortifruti.com.br',
       storefront_host = 'www.obahortifruti.com.br'
 where slug in ('oba', 'oba-taubate');

-- Existing rows carry the dead links until they are collected again, and
-- the next sweep is a day away. The path is the same on both hosts, so
-- this is a host swap rather than a re-fetch.
update offers
   set url = replace(url, 'https://www.oba.com.br/', 'https://www.obahortifruti.com.br/')
 where url like 'https://www.oba.com.br/%';

update offers
   set url = replace(
         url,
         'https://obahortifruti.vtexcommercestable.com.br/',
         'https://www.obahortifruti.com.br/'
       )
 where url like 'https://obahortifruti.vtexcommercestable.com.br/%';
