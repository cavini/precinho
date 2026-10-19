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
  ('curitiba-pr',       'Curitiba',       'Curitiba',       'PR', true, '80010000'),
  -- Tauste trades in the Marília and Bauru area, not the capital. A separate
  -- region rather than folding it into São Paulo, because somebody in the
  -- capital cannot buy there and should never be quoted its prices.
  ('marilia-sp',        'Marília',        'Marília',        'SP', false, '17500000')
on conflict (slug) do nothing;

insert into stores (slug, name, chain, region_id, platform, host, sales_channel, path_prefix, store_view)
select v.slug, v.name, v.chain, r.id, v.platform, v.host, v.sales_channel, v.path_prefix, v.store_view
from (values
  -- São Paulo
  ('mambo',            'Mambo',            'Mambo',            'sao-paulo-sp',      'vtex-legacy',     'www.mambo.com.br',                          '1',  null,  null),
  ('hortifruti-sp',    'Hortifruti',       'Hortifruti',       'sao-paulo-sp',      'vtex-legacy',     'www.hortifruti.com.br',                     '1',  null,  null),
  ('naturaldaterra',   'Natural da Terra', 'Natural da Terra', 'sao-paulo-sp',      'vtex-legacy',     'www.naturaldaterra.com.br',                 '1',  null,  null),
  -- The big chains. Sam's Club answers on its own domain, Atacadão mounts
  -- the catalogue under /io, and Oba is read through its VTEX account host
  -- because its own domain refuses connections outright.
  ('samsclub',         'Sam''s Club',      'Sam''s Club',      'sao-paulo-sp',      'vtex-legacy',     'www.samsclub.com.br',                       '1',  null,  null),
  ('atacadao',         'Atacadão',         'Atacadão',         'sao-paulo-sp',      'vtex-legacy',     'www.atacadao.com.br',                       '1',  '/io', null),
  -- No sales channel: this account answers 206 without one and 401 with
  -- sc=1, which failed a whole sweep while single requests kept working.
  ('carrefour',        'Carrefour',        'Carrefour',        'sao-paulo-sp',      'vtex-legacy',     'carrefourbrfood.vtexcommercestable.com.br', null, null,  null),
  ('oba',              'Oba Hortifruti',   'Oba Hortifruti',   'sao-paulo-sp',      'vtex-legacy',     'obahortifruti.vtexcommercestable.com.br',   '1',  null,  null),
  -- Rio de Janeiro
  ('zonasul',          'Zona Sul',         'Zona Sul',         'rio-de-janeiro-rj', 'vtex-legacy',     'www.zonasul.com.br',                        '1',  null,  null),
  ('hortifruti-rj',    'Hortifruti',       'Hortifruti',       'rio-de-janeiro-rj', 'vtex-legacy',     'www.hortifruti.com.br',                     '1',  null,  null),
  -- Curitiba
  ('festval',          'Festval',          'Festval',          'curitiba-pr',       'vtex-legacy',     'www.festval.com',                           '1',  null,  null),
  ('supermuffato',     'Super Muffato',    'Super Muffato',    'curitiba-pr',       'vtex-legacy',     'www.supermuffato.com.br',                   '1',  null,  null),
  -- Marília: Magento rather than VTEX, priced per store view.
  ('tauste',           'Tauste',           'Tauste',           'marilia-sp',        'magento-graphql', 'tauste.com.br',                             null, null,  'marilia')
) as v (slug, name, chain, region_slug, platform, host, sales_channel, path_prefix, store_view)
join regions r on r.slug = v.region_slug
on conflict (slug) do nothing;

-- Pão de Açúcar. GPA's own API, so the configuration lives in the two
-- columns that already mean this: region_token is their numeric store (the
-- trading area), store_view is the banner path.
insert into stores (slug, name, chain, region_id, platform, host, region_token, store_view)
select 'paodeacucar', 'Pão de Açúcar', 'Pão de Açúcar', r.id,
       'gpa-api', 'api.vendas.gpa.digital', '461', 'pa'
from regions r where r.slug = 'sao-paulo-sp'
on conflict (slug) do nothing;
