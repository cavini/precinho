import { InvalidQuantityError } from '../errors/DomainError'

/** Every size is reduced to one of three units so they stay comparable. */
export type CanonicalUnit = 'kg' | 'L' | 'un'

/** How a catalogue unit maps onto a canonical one. */
type UnitSpec = { unit: CanonicalUnit; divisor: number; multiplier: number }

/**
 * Unit spellings seen in Brazilian store catalogues.
 *
 * Division rather than multiplication by a fraction: 395 / 1000 is exactly
 * 0.395, while 395 * 0.001 is not.
 */
const UNITS: Readonly<Record<string, UnitSpec>> = Object.freeze({
  kg: { unit: 'kg', divisor: 1, multiplier: 1 },
  g: { unit: 'kg', divisor: 1000, multiplier: 1 },
  mg: { unit: 'kg', divisor: 1_000_000, multiplier: 1 },
  l: { unit: 'L', divisor: 1, multiplier: 1 },
  lt: { unit: 'L', divisor: 1, multiplier: 1 },
  litro: { unit: 'L', divisor: 1, multiplier: 1 },
  litros: { unit: 'L', divisor: 1, multiplier: 1 },
  ml: { unit: 'L', divisor: 1000, multiplier: 1 },
  cl: { unit: 'L', divisor: 100, multiplier: 1 },
  un: { unit: 'un', divisor: 1, multiplier: 1 },
  und: { unit: 'un', divisor: 1, multiplier: 1 },
  unid: { unit: 'un', divisor: 1, multiplier: 1 },
  unidade: { unit: 'un', divisor: 1, multiplier: 1 },
  unidades: { unit: 'un', divisor: 1, multiplier: 1 },
  rolo: { unit: 'un', divisor: 1, multiplier: 1 },
  rolos: { unit: 'un', divisor: 1, multiplier: 1 },
  dz: { unit: 'un', divisor: 1, multiplier: 12 },
  duzia: { unit: 'un', divisor: 1, multiplier: 12 },
  duzias: { unit: 'un', divisor: 1, multiplier: 12 },
})

/**
 * The unit spellings a name parser may look for, longest first — otherwise
 * "l" swallows the "l" of "ml" and "g" swallows the "g" of "kg".
 */
export const KNOWN_UNIT_SPELLINGS: readonly string[] = Object.freeze(
  Object.keys(UNITS).sort((a, b) => b.length - a.length),
)

/** A package size, already converted to kg, L or un. Immutable. */
export class Quantity {
  private constructor(
    readonly amount: number,
    readonly unit: CanonicalUnit,
  ) {
    Object.freeze(this)
  }

  /** Complexity: O(1). */
  static of(amount: number, unit: CanonicalUnit): Quantity {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InvalidQuantityError('A size must be a positive amount')
    }
    return new Quantity(amount, unit)
  }

  /**
   * Converts a catalogue measurement into canonical form, or returns null
   * when the unit is unknown or the amount could not be a real size.
   *
   * Null rather than a throw: unparseable sizes are routine in catalogue
   * data, and a product without a size is still worth listing — it just gets
   * no price-per-unit.
   *
   * Complexity: O(1); the unit table is a hash lookup.
   */
  static fromMeasurement(amount: number, rawUnit: string): Quantity | null {
    const spec = UNITS[rawUnit.trim().toLowerCase()]
    if (!spec) return null
    if (!Number.isFinite(amount) || amount <= 0) return null
    return new Quantity((amount * spec.multiplier) / spec.divisor, spec.unit)
  }

  equals(other: Quantity): boolean {
    return this.amount === other.amount && this.unit === other.unit
  }

  /** Reads the way a package label does: "395 g", not "0,395 kg". */
  label(): string {
    if (this.unit === 'un') return `${formatAmount(this.amount)} un`
    if (this.amount < 1) {
      const smaller = Math.round(this.amount * 1000)
      return this.unit === 'kg' ? `${smaller} g` : `${smaller} ml`
    }
    return `${formatAmount(this.amount)} ${this.unit}`
  }
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(amount)
}
