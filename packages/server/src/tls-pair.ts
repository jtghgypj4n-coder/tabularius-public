import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createSecureContext } from 'node:tls';
import { atomicWrite } from '../../store/src/durable.ts';

export interface TlsPair { cert: string; key: string }

/** Validate with the same TLS implementation that will serve the certificate. */
export function validateTlsPair(pair: TlsPair): void {
  createSecureContext(pair);
  if (!new X509Certificate(pair.cert).checkPrivateKey(createPrivateKey(pair.key))) throw new Error('TLS key does not match certificate');
}

/** Read one immutable generation, or a matching pair from the earlier layout. */
export function readTlsPair(base: string): TlsPair | undefined {
  try {
    let pair: TlsPair;
    if (existsSync(base + '.current')) {
      const file = readFileSync(base + '.current', 'utf8').trim();
      if (!file.startsWith(basename(base) + '.') || !/^[a-f0-9]{64}\.pem$/.test(file.slice(basename(base).length + 1))) return undefined;
      const pem = readFileSync(join(dirname(base), file), 'utf8');
      const cert = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)?.join('\n');
      if (!cert) return undefined;
      pair = { cert: cert + '\n', key: createPrivateKey(pem).export({ type: 'pkcs8', format: 'pem' }) as string };
    } else {
      pair = { cert: readFileSync(base + '.crt', 'utf8'), key: readFileSync(base + '.key', 'utf8') };
    }
    validateTlsPair(pair);
    return pair;
  } catch { return undefined; }
}

/** Complete and flush both PEMs before switching the sole publication pointer. */
export function writeTlsPair(base: string, pair: TlsPair): string {
  validateTlsPair(pair);
  const pem = pair.cert.trimEnd() + '\n' + pair.key.trimEnd() + '\n';
  const path = `${base}.${createHash('sha256').update(pem).digest('hex')}.pem`;
  // Older generations remain readable by processes that have already resolved the pointer.
  atomicWrite(path, pem);
  atomicWrite(base + '.current', basename(path) + '\n');
  return path;
}
