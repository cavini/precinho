import { describe, expect, it } from 'vitest'
import { systemClock } from './SystemClock'

describe('systemClock', () => {
  it('reads the real clock', () => {
    const before = Date.now()
    const now = systemClock.now()
    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('moves forward between calls', () => {
    expect(systemClock.now().getTime()).toBeLessThanOrEqual(systemClock.now().getTime())
  })
})
