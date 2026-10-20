// Time-based one-time passwords (RFC 6238, the TOTP that Google Authenticator,
// 1Password, Authy and the like generate), for a second factor at sign-in.
// Secrets are base32 (RFC 4648), codes are 6 digits over a 30-second step with
// HMAC-SHA1, which is what every authenticator app expects.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
const PERIOD = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new random base32 secret (160 bits, the recommended size). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error(`invalid base32 character "${c}"`);
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for a secret at a given time step (default: now). */
export function totpCode(secret: string, step = Math.floor(Date.now() / 1000 / PERIOD)): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Whether `code` is valid for `secret` now, allowing one step either side for
 * clock drift. Returns the step the code matched (so callers can refuse to
 * accept the same one twice), or undefined when it doesn't match.
 */
export function checkTotp(secret: string, code: string, now = Date.now()): number | undefined {
  const clean = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return undefined;
  const current = Math.floor(now / 1000 / PERIOD);
  for (const step of [current, current - 1, current + 1]) {
    const want = Buffer.from(totpCode(secret, step));
    const got = Buffer.from(clean);
    if (want.length === got.length && timingSafeEqual(want, got)) return step;
  }
  return undefined;
}

/** The otpauth:// URI an authenticator app reads from a QR code. */
export function totpUri(account: string, secret: string, issuer = 'tabularius'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD) });
  return `otpauth://totp/${label}?${params}`;
}
