import { timingSafeEqual } from 'node:crypto';

/**
 * Whether two secrets (tokens, hashes, codes, challenges, passwords) are equal, in time that does not depend on where they
 * differ. The one way to compare a secret: `===` stops at the first difference, and a Buffer's own `equals` does too. Both
 * sides are compared as UTF-16 code units, so strings of equal length compare byte for byte (equal JS lengths need not mean
 * equal UTF-8 lengths, and a lone surrogate is not turned into the same replacement character as another). Anything that is
 * not a string is never equal, which makes a missing value (`undefined` from a lookup that found nothing) a refusal.
 * scripts/check-secret-primitives.ts fails the build on a comparison of a secret-named value that does not come through here.
 */
export function sameSecret(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf16le'), right = Buffer.from(b, 'utf16le');
  return left.length === right.length && timingSafeEqual(left, right);
}
