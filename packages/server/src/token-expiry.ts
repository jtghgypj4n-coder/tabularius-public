// How long a token lives when whoever makes it does not say. A token that never expires works until someone remembers to
// revoke it, so the places people make tokens (the admin console, Manage Security, the `token` command, calendar feeds) give
// one a lifetime unless asked for none: 0 days means "never", said on purpose.

import { expiryClock } from '../../store/src/clock.ts';
import { StoreError } from '../../store/src/index.ts';

/** Days an API or AI-app token lives when no lifetime is asked for; TABULARIUS_TOKEN_DEFAULT_DAYS changes it (0 for no expiry). */
export const DEFAULT_TOKEN_DAYS = 90;
/** Days a calendar feed address lives when none is asked for: people subscribe a calendar app to it and would not notice it stop. */
export const DEFAULT_FEED_DAYS = 365;
/** The longest lifetime a person can ask for. */
export const MAX_TOKEN_DAYS = 3650;

/** The default lifetime of an API or AI-app token in days, 0 for none, from TABULARIUS_TOKEN_DEFAULT_DAYS. */
export function defaultTokenDays(): number {
  const text = process.env.TABULARIUS_TOKEN_DEFAULT_DAYS?.trim();
  if (!text) return DEFAULT_TOKEN_DAYS;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= MAX_TOKEN_DAYS ? n : DEFAULT_TOKEN_DAYS;
}

/**
 * The date a new token stops working. `requested` is what the person asked for in days: nothing (undefined, null or empty) takes
 * `fallbackDays` (0 for none), 0 means never, and anything else must be above 0 and at most MAX_TOKEN_DAYS, fractions allowed.
 * Undefined means the token never expires.
 */
export function tokenExpiry(requested: unknown, fallbackDays: number = defaultTokenDays()): Date | undefined {
  let days = fallbackDays;
  if (requested !== undefined && requested !== null && requested !== '') {
    days = typeof requested === 'number' ? requested : typeof requested === 'string' && requested.trim() ? Number(requested) : NaN;
    if (!(days >= 0 && days <= MAX_TOKEN_DAYS)) throw new StoreError(960, `Days should be above 0 and at most ${MAX_TOKEN_DAYS}, or 0 for a token that never expires`);
  }
  return days > 0 ? new Date(expiryClock.now() + days * 86_400_000) : undefined;
}
