/**
 * Intl puts a non-breaking space between the currency symbol and the digits,
 * so "R$\u00a010,49" and "R$ 10,49" look identical in a diff and are not.
 * Tests compare through this rather than typing an invisible character.
 */
export function plainSpaces(value: string): string {
  return value.replace(/\u00a0/g, ' ')
}
