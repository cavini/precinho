/**
 * Reading the time is an effect, so it comes through a port.
 *
 * Rate limiting and offer staleness both turn on "now", and a test that has
 * to wait real seconds to check a window is a test nobody runs.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
