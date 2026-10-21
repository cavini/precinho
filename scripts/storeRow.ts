/**
 * The store columns the operator scripts read.
 *
 * Declared once rather than inferred from Supabase's untyped client, so
 * these tools type-check like the rest of the codebase instead of being
 * a corner where `any` is allowed to live.
 */
export type StoreRow = {
  id: string
  slug: string
  host: string
  platform: string
  active: boolean
  sweep_mode: 'terms' | 'categories'
  sales_channel: string | null
  path_prefix: string | null
  store_view: string | null
  storefront_host: string | null
  region_token: string | null
  daily_request_budget: number | null
  regions: { slug: string; name?: string; probe_cep?: string } | null
}

export type RegionRow = {
  slug: string
  name: string
  probe_cep: string
}
