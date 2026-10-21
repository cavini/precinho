-- Tenda in the second region, branch 13 (CT15).
--
-- The branch reaches the API as a cart id and nothing else — every other
-- spelling is ignored, which 0040 records. So region_token here is a
-- cart, not a region, and the column name is a poor fit that the comment
-- has to carry.
--
-- Verified before writing it down rather than after: the same search for
-- Açúcar cristal Colombo 5kg answers 13.99 through this cart and 15.89
-- through none, and the live site set to collect in the second region shows 13,99.
--
-- The São Paulo row keeps no cart on purpose. The default list was
-- measured against the Guarapiranga branch — which is what their own zip
-- endpoint returns for Avenida Paulista — and matched 160 of 160 prices
-- with nothing missing from the assortment. Binding it to a cart would
-- swap a measured correctness for an id that can expire.
--
-- A cart that Tenda no longer recognises makes the search fail rather
-- than quietly answer with the default, so an expired one costs the term
-- and shows up in the run report instead of filing São Paulo prices
-- under the second region.

insert into stores (slug, name, chain, region_id, platform, host, region_token, min_interval_ms)
select 'tenda-taubate', 'Tenda Atacado', 'Tenda', r.id,
       'tenda-api', 'api.tendaatacado.com.br', '39875841', 1200
from regions r
where r.slug = 'taubate-sp'
on conflict (slug) do nothing;
