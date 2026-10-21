import { timingSafeEqual } from 'node:crypto';

/** Compare encoded secret bytes; equal JS string lengths need not mean equal UTF-8 lengths. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
