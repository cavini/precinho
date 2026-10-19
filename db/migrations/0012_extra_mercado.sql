-- Extra Mercado, the other GPA banner.
--
-- clubeextra.com.br redirects to extramercado.com.br and the page loads
-- static.gpa.digital, so Extra is still GPA — the same API the Pão de
-- Açúcar adapter already reads, under the /ex/ banner.
--
-- My earlier 404 on /ex/search/search was my own fault: I sent storeId 461,
-- which is a Pão de Açúcar store. Extra's own site sends 483. The route was
-- there all along; the store was wrong.

insert into stores (slug, name, chain, region_id, platform, host, region_token, store_view)
select 'extra', 'Extra Mercado', 'Extra', r.id,
       'gpa-api', 'api.vendas.gpa.digital', '483', 'ex'
from regions r where r.slug = 'sao-paulo-sp'
on conflict (slug) do nothing;
