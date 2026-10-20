// HTTP Digest authentication (RFC 7616, which keeps RFC 2617's MD5 form) for Insert from URL's --digest and
// --anyauth: reads a `WWW-Authenticate: Digest ...` challenge and writes the matching `Authorization` header.
// Supported: MD5, MD5-sess, SHA-256, SHA-256-sess, qop "auth" and no qop (RFC 2069). A challenge that offers only
// qop "auth-int", or an algorithm named here as unsupported, gets no answer (the caller then reports the 401).

import { createHash, randomBytes } from 'node:crypto';

export interface DigestChallenge {
  realm: string;
  nonce: string;
  opaque?: string;
  algorithm: 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess';
  /** "auth" when the server offers it; undefined for the old no-qop form. */
  qop?: 'auth';
  userhash?: boolean;
}

const ALGORITHMS = new Set(['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS']);

/** The parameters of one challenge: `key=value` or `key="quoted value"`, comma separated. */
function params(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([a-z][a-z0-9-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/gi)) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
  return out;
}

/**
 * The first Digest challenge a WWW-Authenticate header value offers that this can answer, or undefined. A response
 * may carry several challenges ("Basic realm=x, Digest realm=y"); fetch joins repeated headers with ", ".
 */
export function parseDigestChallenge(header: string | null | undefined): DigestChallenge | undefined {
  if (!header) return undefined;
  const parts = header.split(/(?:^|,\s*)(?=Digest\s)/i).filter((x) => /^Digest\s/i.test(x));
  for (const part of parts) {
    // A later scheme in the same value ("Digest ..., Basic realm=...") ends this challenge.
    const text = part.replace(/^Digest\s+/i, '').split(/,\s*(?=(?:Basic|Bearer|Negotiate|NTLM)\s)/i)[0];
    const p = params(text);
    if (!p.realm || !p.nonce) continue;
    const algorithm = (p.algorithm ?? 'MD5').toUpperCase();
    if (!ALGORITHMS.has(algorithm)) continue;
    const qops = (p.qop ?? '').split(',').map((q) => q.trim().toLowerCase()).filter(Boolean);
    // Only "auth" is answered: "auth-int" hashes the request body and is not offered here.
    if (qops.length && !qops.includes('auth')) continue;
    return {
      realm: p.realm, nonce: p.nonce, ...(p.opaque !== undefined ? { opaque: p.opaque } : {}),
      algorithm: { MD5: 'MD5', 'MD5-SESS': 'MD5-sess', 'SHA-256': 'SHA-256', 'SHA-256-SESS': 'SHA-256-sess' }[algorithm] as DigestChallenge['algorithm'],
      ...(qops.length ? { qop: 'auth' as const } : {}),
      ...(p.userhash?.toLowerCase() === 'true' ? { userhash: true } : {}),
    };
  }
  return undefined;
}

const hash = (algorithm: DigestChallenge['algorithm'], text: string) => createHash(algorithm.startsWith('SHA-256') ? 'sha256' : 'md5').update(text, 'utf8').digest('hex');
const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;

/** The Authorization header value that answers `challenge` for one request. `nc` counts requests on this nonce (1 for the first). */
export function digestAuthorization(challenge: DigestChallenge, o: { method: string; uri: string; user: string; password: string; nc?: number; cnonce?: string }): string {
  const { algorithm, realm, nonce, qop } = challenge;
  const nc = (o.nc ?? 1).toString(16).padStart(8, '0');
  const cnonce = o.cnonce ?? randomBytes(16).toString('hex');
  let ha1 = hash(algorithm, `${o.user}:${realm}:${o.password}`);
  if (algorithm.endsWith('-sess')) ha1 = hash(algorithm, `${ha1}:${nonce}:${cnonce}`);
  const ha2 = hash(algorithm, `${o.method.toUpperCase()}:${o.uri}`);
  const response = qop ? hash(algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hash(algorithm, `${ha1}:${nonce}:${ha2}`);
  const username = challenge.userhash ? hash(algorithm, `${o.user}:${realm}`) : o.user;
  const fields = [
    `username=${quote(username)}`, `realm=${quote(realm)}`, `nonce=${quote(nonce)}`, `uri=${quote(o.uri)}`,
    `algorithm=${algorithm}`, ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`] : []),
    `response=${quote(response)}`, ...(challenge.opaque !== undefined ? [`opaque=${quote(challenge.opaque)}`] : []),
    ...(challenge.userhash ? ['userhash=true'] : []),
  ];
  return `Digest ${fields.join(', ')}`;
}
