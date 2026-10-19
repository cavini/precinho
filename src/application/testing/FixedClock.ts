import type { Clock } from '../ports/Clock'

/** A clock that only moves when a test moves it. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000)
  }

  set(at: Date): void {
    this.current = at
  }
}
