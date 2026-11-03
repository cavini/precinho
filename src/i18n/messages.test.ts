import { type Locale, createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import pt from '../../messages/pt.json'
import { routing } from './routing'

/**
 * What the compiler cannot say about the message files.
 *
 * `AppConfig['Messages']` is typed from the Portuguese, so a key missing
 * from Portuguese is a build error at the call site. Nothing types the
 * English against it, and nothing types the ICU inside either: a message
 * that forgets `{seconds}`, or spells it `{second}`, compiles fine and
 * then shows a shopper a sentence with a hole in it.
 *
 * Checked through next-intl's own translator rather than against a regex,
 * so what passes here is what the screens will render.
 */
const CATALOGUES: Record<Locale, Record<string, unknown>> = { pt, en }

type Entry = [path: string, message: string]

function entries(node: object, prefix = ''): Entry[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? entries(value, path)
      : [[path, String(value)] as Entry]
  })
}

/** The `{name}` arguments and `<tag>` wrappers a message expects. */
function slotsOf(message: string): string[] {
  const args = [...message.matchAll(/\{(\w+)[,}]/g)].map((match) => `{${match[1]}}`)
  const tags = [...message.matchAll(/<(\w+)>/g)].map((match) => `<${match[1]}>`)
  return [...new Set([...args, ...tags])].sort()
}

/** Something to pass for every slot, so a message can actually be formatted. */
function valuesFor(message: string): Record<string, unknown> {
  return Object.fromEntries(
    slotsOf(message).map((slot) =>
      slot.startsWith('<')
        ? [slot.slice(1, -1), (chunks: unknown) => chunks]
        : [slot.slice(1, -1), 'value'],
    ),
  )
}

describe('the message files', () => {
  it('say the same things in both languages', () => {
    expect(entries(en).map(([path]) => path)).toEqual(entries(pt).map(([path]) => path))
  })

  it('ask for the same values in both languages', () => {
    // A translation that drops a placeholder loses the price, the term or
    // the countdown it was meant to carry, and nothing else would notice.
    const english = new Map(entries(en))

    for (const [path, message] of entries(pt)) {
      expect(slotsOf(english.get(path) ?? ''), path).toEqual(slotsOf(message))
    }
  })

  it.each(routing.locales)('formats every message in %s', (language: Locale) => {
    // next-intl reports a bad message rather than throwing, and then
    // renders the key. Collecting the reports is the only way a broken
    // one fails here instead of on the page.
    const reported: string[] = []
    const t = createTranslator({
      locale: language,
      messages: CATALOGUES[language],
      onError: (error) => reported.push(error.message),
    })

    for (const [path, message] of entries(CATALOGUES[language])) {
      expect(message.trim(), path).not.toBe('')
      t.rich(path as never, valuesFor(message) as never)
    }

    expect(reported).toEqual([])
  })

  it('keeps apostrophes out of ICU escaping', () => {
    // ICU reads a quote as an escape when it precedes a brace, so the
    // English copy — "couldn't", "chains'", "That's" — is exactly the
    // shape that silently swallows the rest of a sentence if one is ever
    // written next to a placeholder.
    const t = createTranslator({ locale: 'en', messages: en })

    expect(t('Footer.disclaimer')).toBe(en.Footer.disclaimer)
    expect(t('Feed.exhausted')).toContain("That's")
    expect(t('Common.unavailable')).toContain("couldn't")
  })

  it('leaves nothing untranslated on the English page', () => {
    const english = new Map(entries(en))

    for (const [path, message] of entries(pt)) {
      expect(english.get(path), path).not.toBe(message)
    }
  })
})
