-- Coverage seed.
--
-- Every host here was verified answering its public catalogue on 2026-10-19.
-- Hortifruti appears twice because it trades in two regions: same host,
-- different trading area, therefore different prices and a separate row.
--
-- probe_cep is the CEP the collector shops from for that region. It decides
-- which prices the run records, so it is a real central address rather than
-- an arbitrary number.

insert into regions (slug, name, city, uf, is_uf_default, probe_cep) values
  ('sao-paulo-sp',      'São Paulo',      'São Paulo',      'SP', true, '01310100'),
  ('rio-de-janeiro-rj', 'Rio de Janeiro', 'Rio de Janeiro', 'RJ', true, '22071900'),
  ('curitiba-pr',       'Curitiba',       'Curitiba',       'PR', true, '80010000')
on conflict (slug) do nothing;

insert into stores (slug, name, chain, region_id, platform, host, sales_channel, path_prefix)
select v.slug, v.name, v.chain, r.id, v.platform, v.host, v.sales_channel, v.path_prefix
from (values
  -- São Paulo
  ('mambo',            'Mambo',            'Mambo',            'sao-paulo-sp',      'vtex-legacy', 'www.mambo.com.br',           '1',  null),
  ('hortifruti-sp',    'Hortifruti',       'Hortifruti',       'sao-paulo-sp',      'vtex-legacy', 'www.hortifruti.com.br',      '1',  null),
  ('naturaldaterra',   'Natural da Terra', 'Natural da Terra', 'sao-paulo-sp',      'vtex-legacy', 'www.naturaldaterra.com.br',  '1',  null),
  -- The big chains. Sam's Club answers on its own domain; Atacadão mounts
  -- the catalogue under /io; Carrefour's storefront challenges automated
  -- requests, so it is read through its VTEX account host instead.
  ('samsclub',         'Sam''s Club',      'Sam''s Club',      'sao-paulo-sp',      'vtex-legacy', 'www.samsclub.com.br',        '1',  null),
  ('atacadao',         'Atacadão',         'Atacadão',         'sao-paulo-sp',      'vtex-legacy', 'www.atacadao.com.br',        '1',  '/io'),
  ('carrefour',        'Carrefour',        'Carrefour',        'sao-paulo-sp',      'vtex-legacy', 'carrefourbrfood.vtexcommercestable.com.br', '1', null),
  -- Rio de Janeiro
  ('zonasul',          'Zona Sul',         'Zona Sul',         'rio-de-janeiro-rj', 'vtex-legacy', 'www.zonasul.com.br',         '1',  null),
  ('hortifruti-rj',    'Hortifruti',       'Hortifruti',       'rio-de-janeiro-rj', 'vtex-legacy', 'www.hortifruti.com.br',      '1',  null),
  -- Curitiba
  ('festval',          'Festval',          'Festval',          'curitiba-pr',       'vtex-legacy', 'www.festval.com',            '1',  null),
  ('supermuffato',     'Super Muffato',    'Super Muffato',    'curitiba-pr',       'vtex-legacy', 'www.supermuffato.com.br',    '1',  null)
) as v (slug, name, chain, region_slug, platform, host, sales_channel, path_prefix)
join regions r on r.slug = v.region_slug
on conflict (slug) do nothing;
