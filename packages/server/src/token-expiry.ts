// How long a token lives when whoever makes it does not say. A token that never expires works until someone remembers to
// revoke it, so every API token has a lifetime: the places people make tokens (the admin console, Manage Security, the
// `token` command, calendar feeds) give one the default unless asked for another, and nobody can ask for none.

import { expiryClock } from '../../store/src/clock.ts';
import { API_TOKEN_DEFAULT_DAYS, API_TOKEN_MAX_DAYS, StoreError } from '../../store/src/index.ts';

/** Days an API or AI-app token lives when no lifetime is asked for; TABULARIUS_TOKEN_DEFAULT_DAYS changes it. */
export const DEFAULT_TOKEN_DAYS = API_TOKEN_DEFAULT_DAYS;
/** Days a calendar feed address lives when none is asked for: people subscribe a calendar app to it and would not notice it stop. */
export const DEFAULT_FEED_DAYS = 365;
/** The longest lifetime a person can ask for. */
export const MAX_TOKEN_DAYS = API_TOKEN_MAX_DAYS;

/** The default lifetime of an API or AI-app token in days, from TABULARIUS_TOKEN_DEFAULT_DAYS: above 0 and at most MAX_TOKEN_DAYS, else 90. */
export function defaultTokenDays(): number {
  const text = process.env.TABULARIUS_TOKEN_DEFAULT_DAYS?.trim();
  if (!text) return DEFAULT_TOKEN_DAYS;
  const n = Number(text);
  return /^\d+(\.\d+)?$/.test(text) && n > 0 && n <= MAX_TOKEN_DAYS ? n : DEFAULT_TOKEN_DAYS;
}

/**
 * The date a new token stops working. `requested` is what the person asked for in days: nothing (undefined, null or empty) takes
 * `fallbackDays`, and anything else must be above 0 and at most MAX_TOKEN_DAYS, fractions allowed. There is no way to ask for a
 * token that never expires.
 */
export function tokenExpiry(requested: unknown, fallbackDays: number = defaultTokenDays()): Date {
  let days = fallbackDays;
  if (requested !== undefined && requested !== null && requested !== '') {
    days = typeof requested === 'number' ? requested : typeof requested === 'string' && requested.trim() ? Number(requested) : NaN;
    if (!(days > 0 && days <= MAX_TOKEN_DAYS)) throw new StoreError(960, `Days should be above 0 and at most ${MAX_TOKEN_DAYS}; a token always expires`);
  }
  return new Date(expiryClock.now() + days * 86_400_000);
}
