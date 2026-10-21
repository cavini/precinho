import { describe, expect, it } from 'vitest'
import { emptySearchBox, reconcileSearchBox } from './searchBox'

describe('what the search box shows', () => {
  it('starts with whatever the URL is asking for', () => {
    expect(emptySearchBox('cafe').typed).toBe('cafe')
  })

  it('leaves typing alone while the URL stays put', () => {
    // Re-renders happen for all sorts of reasons; none of them should wipe
    // out half-typed input.
    const start = emptySearchBox('cafe')
    const typing = { ...start, typed: 'deterg' }

    expect(reconcileSearchBox(typing, 'cafe').typed).toBe('deterg')
  })

  it('follows the browser going back to an earlier search', () => {
    // Pressing back from ?q=cafe to ?q=detergente used to leave "cafe" in
    // the box, so hitting enter searched a term from the page before.
    const onCafe = emptySearchBox('cafe')

    expect(reconcileSearchBox(onCafe, 'detergente').typed).toBe('detergente')
  })

  it('empties when the browser lands somewhere with no query', () => {
    // The home page. "detergente" sitting in the box there is a term
    // belonging to a page the reader has left.
    const onDetergente = emptySearchBox('detergente')

    expect(reconcileSearchBox(onDetergente, '').typed).toBe('')
  })

  it('does not re-wipe typing after it has followed the URL once', () => {
    // The reconciliation has to remember which query it already applied,
    // or every keystroke after a navigation would be thrown away.
    const arrived = reconcileSearchBox(emptySearchBox('cafe'), '')
    const typing = { ...arrived, typed: 'macarrao' }

    expect(reconcileSearchBox(typing, '').typed).toBe('macarrao')
  })

  it('follows the URL back to a term the reader had typed before', () => {
    const typing = { typed: 'arroz', fromUrl: '' }

    expect(reconcileSearchBox(typing, 'cafe')).toEqual({ typed: 'cafe', fromUrl: 'cafe' })
  })
})
