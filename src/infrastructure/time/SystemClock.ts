import type { Clock } from '@/application/ports/Clock'

/** The real clock. Lives here because a concrete clock is an adapter. */
export const systemClock: Clock = {
  now: () => new Date(),
}
