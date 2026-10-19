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

insert into stores (slug, name, chain, region_id, platform, host, sales_channel)
select v.slug, v.name, v.chain, r.id, v.platform, v.host, v.sales_channel
from (values
  -- São Paulo
  ('mambo',            'Mambo',            'Mambo',            'sao-paulo-sp',      'vtex-legacy', 'www.mambo.com.br',           '1'),
  ('hortifruti-sp',    'Hortifruti',       'Hortifruti',       'sao-paulo-sp',      'vtex-legacy', 'www.hortifruti.com.br',      '1'),
  ('naturaldaterra',   'Natural da Terra', 'Natural da Terra', 'sao-paulo-sp',      'vtex-legacy', 'www.naturaldaterra.com.br',  '1'),
  -- Rio de Janeiro
  ('zonasul',          'Zona Sul',         'Zona Sul',         'rio-de-janeiro-rj', 'vtex-legacy', 'www.zonasul.com.br',         '1'),
  ('hortifruti-rj',    'Hortifruti',       'Hortifruti',       'rio-de-janeiro-rj', 'vtex-legacy', 'www.hortifruti.com.br',      '1'),
  -- Curitiba
  ('festval',          'Festval',          'Festval',          'curitiba-pr',       'vtex-legacy', 'www.festval.com',            '1'),
  ('supermuffato',     'Super Muffato',    'Super Muffato',    'curitiba-pr',       'vtex-legacy', 'www.supermuffato.com.br',    '1')
) as v (slug, name, chain, region_slug, platform, host, sales_channel)
join regions r on r.slug = v.region_slug
on conflict (slug) do nothing;
