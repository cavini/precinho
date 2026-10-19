import {
  PREFERENCES_COOKIE,
  PREFERENCES_MAX_AGE_SECONDS,
  type ShoppingPreferences,
  serializePreferences,
} from './preferences'

/**
 * Writes the preference cookie from the browser.
 *
 * Lives outside any component for two reasons: the store picker sets it from
 * more than one place and should not repeat the string, and touching
 * `document` inside a component body is exactly what the React compiler
 * refuses — correctly, since this is a side effect on something the
 * component does not own.
 *
 * Not httpOnly, deliberately. The server reads it to render regional prices
 * and the picker writes it without a round trip, and there is nothing secret
 * in a CEP and a list of shops.
 */
export function writePreferencesCookie(preferences: ShoppingPreferences): void {
  const value = encodeURIComponent(serializePreferences(preferences))
  document.cookie = `${PREFERENCES_COOKIE}=${value}; path=/; max-age=${PREFERENCES_MAX_AGE_SECONDS}; samesite=lax`
}
