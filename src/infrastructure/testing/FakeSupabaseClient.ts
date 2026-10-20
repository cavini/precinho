import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>

/**
 * Just enough Supabase for the catalogue writer.
 *
 * Deliberately records what was asked for rather than only what came
 * back. The lookup that recreated 6,707 merged-away products sent a URL
 * too long to be sent at all, and no assertion about returned rows could
 * have caught it — the question is whether the writer asked, and what it
 * did with the answer.
 */
export class FakeSupabaseClient {
  /** Products the writer tried to create or update. */
  readonly upserted: Row[] = []
  /** Offers the writer inserted. */
  readonly inserted: Row[] = []
  /** Every rpc call, in order, with its arguments. */
  readonly rpcCalls: Array<{ name: string; args: Row }> = []

  constructor(
    private readonly knownNames: ReadonlyMap<string, string> = new Map(),
    private readonly knownAliases: ReadonlyMap<string, string> = new Map(),
    /** Set to fail every rpc, the way a rejected request does. */
    private readonly rpcFails: string | null = null,
  ) {}

  async rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args })

    if (this.rpcFails) return { data: null, error: { message: this.rpcFails } }

    if (name === 'resolve_product_names') {
      const asked = (args.p_names ?? []) as string[]
      return {
        data: asked
          .filter((value) => this.knownNames.has(value))
          .map((value) => ({ name: value, product_id: this.knownNames.get(value) })),
        error: null,
      }
    }

    if (name === 'resolve_product_aliases') {
      const asked = (args.p_keys ?? []) as string[]
      return {
        data: asked
          .filter((value) => this.knownAliases.has(value))
          .map((value) => ({ match_key: value, product_id: this.knownAliases.get(value) })),
        error: null,
      }
    }

    return { data: [], error: null }
  }

  from(table: string) {
    const client = this

    return {
      upsert(rows: Row[]) {
        client.upserted.push(...rows)
        return {
          select() {
            return {
              data: rows.map((row, index) => ({
                id: `new-${index}`,
                match_key: row.match_key,
              })),
              error: null,
            }
          },
        }
      },

      insert(rows: Row[]) {
        if (table === 'offers') client.inserted.push(...rows)
        return { count: rows.length, error: null }
      },
    }
  }

  /** The writer only uses the surface above; the rest is never reached. */
  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient
  }
}
