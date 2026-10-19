/**
 * What the collector sweeps for.
 *
 * Search terms, in Portuguese, because they are matched against Brazilian
 * store catalogues — this is product data, not code. Deliberately broad
 * staples rather than specific brands: a term like "arroz" returns every
 * brand the store carries, so a short list covers a basic basket at a
 * fraction of the requests.
 *
 * Keep it ordered roughly by how often people buy, so a run cut short still
 * covered what matters.
 */
export const BASIC_BASKET: readonly string[] = [
  'arroz',
  'feijao',
  'leite',
  'cafe',
  'acucar',
  'oleo de soja',
  'macarrao',
  'farinha de trigo',
  'ovos',
  'pao de forma',
  'manteiga',
  'queijo mussarela',
  'presunto',
  'frango',
  'carne moida',
  'banana',
  'tomate',
  'batata',
  'cebola',
  'refrigerante',
  'suco',
  'agua mineral',
  'papel higienico',
  'detergente',
  'sabao em po',
  'amaciante',
  'desinfetante',
  'creme dental',
  'shampoo',
  'sabonete',
]
