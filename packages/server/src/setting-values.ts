import { secret } from '../../store/src/settings.ts';

/** Parse settings as decimal whole numbers; Number alone also accepts blanks, hex and exponents. */
export function positiveWholeNumber(name: string, value: string | undefined, fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) {
    const form = min === 1 ? 'a positive whole number' : `a whole number of ${min} or more`;
    throw new Error(`${name} must be ${form} using decimal digits only (maximum ${max})`);
  }
  return n;
}

/** Unset means no encryption; a blank key must never silently disable it (the store's `secret` refuses it). Preserves passphrase bytes. */
export function encryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return secret('TABULARIUS_ENCRYPTION_KEY', env);
}
