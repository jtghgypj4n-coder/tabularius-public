// AWS Signature Version 4 for Insert from URL's --aws-sigv4 (provider1[:provider2[:region[:service]]]), written from
// AWS's published signing steps and checked against its published test vectors (test/sigv4.test.ts).
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
/** RFC 3986 encoding: everything but letters, digits and - _ . ~ */
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** Canonicalize escaped bytes without requiring them to form valid UTF-8. */
function encodeEscaped(s: string): string {
  return s.split(/(%[0-9a-f]{2})/i).map((part) => {
    if (!/^%[0-9a-f]{2}$/i.test(part)) return encode(part);
    const byte = String.fromCharCode(parseInt(part.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(byte) ? byte : part.toUpperCase();
  }).join('');
}

export interface SigV4Option {
  /** The --aws-sigv4 argument. */
  spec: string;
  /** The --user argument: access key ID, a colon, the secret key. */
  user: string;
}

export interface SigV4Request {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

/** Splits the option; the region and service come from an amazonaws.com host name (service.region.amazonaws.com, also behind a bucket name) when not given. */
export function parseSigV4(option: SigV4Option, host: string): { provider1: string; provider2: string; region: string; service: string; key: string; secret: string } {
  const [provider1, second, region, service] = option.spec.split(':');
  const provider2 = second || provider1;
  const colon = option.user.indexOf(':');
  if (!provider1 || colon <= 0 || colon === option.user.length - 1) throw new Error('--aws-sigv4 needs --user with the access key ID and the secret key (id:secret)');
  const named = /(?:^|\.)([a-z0-9-]+)\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/i.exec(host);
  // s3-fips and dualstack hosts are still s3; the script can name the service itself for anything else.
  const found = { region: region || named?.[2], service: service || (named?.[1] === 'dualstack' || named?.[1] === 's3-fips' ? 's3' : named?.[1]) };
  if (!found.region || !found.service) throw new Error('--aws-sigv4 needs a region and a service (aws:amz:region:service) when the host name does not give them');
  return { provider1: provider1.toLowerCase(), provider2: provider2.toLowerCase(), region: found.region, service: found.service, key: option.user.slice(0, colon), secret: option.user.slice(colon + 1) };
}

/**
 * The request's headers plus the date header, the payload hash for s3 and the Authorization header. `now` is the
 * signing time. Headers signed: host, the date header, and explicit request headers except transport-managed headers.
 */
export function signSigV4(request: SigV4Request, option: SigV4Option, now: Date): Record<string, string> {
  const url = new URL(request.url);
  const { provider1, provider2, region, service, key, secret } = parseSigV4(option, url.hostname);
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(request.headers)) {
    const name = k.toLowerCase();
    if (name === 'authorization' || name === 'host') continue;
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n\0]/.test(v)) throw new Error('Invalid signing header');
    const value = String(v).replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+/g, ' ');
    headers[name] = headers[name] === undefined ? value : headers[name] + ',' + value;
  }
  const lower = (name: string) => Object.keys(headers).find((k) => k.toLowerCase() === name);
  const dateHeader = `x-${provider2}-date`;
  for (const k of Object.keys(headers)) if (k.toLowerCase() === dateHeader) delete headers[k];
  headers[dateHeader] = stamp;
  const payload = sha256(request.body ?? '');
  const hashHeader = `x-${provider2}-content-sha256`;
  if (service === 's3' && !lower(hashHeader)) headers[hashHeader] = payload;
  const signed: Record<string, string> = { host: url.host };
  const transportHeaders = new Set(['connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'user-agent', 'expect', 'x-amzn-trace-id',
    ...(headers.connection ?? '').split(',').map((name) => name.trim().toLowerCase())]);
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase();
    if (!transportHeaders.has(name) && !name.startsWith('proxy-')) signed[name] = String(v).replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+/g, ' ');
  }
  const names = Object.keys(signed).sort();
  // Use the same parsed URL as the query and fetch: pathname has escaped raw Unicode/spaces.
  // General SigV4 escapes existing percent signs too; S3 preserves object-key escapes and slashes.
  const raw = url.pathname;
  let segments = raw.split('/');
  if (service !== 's3') {
    const normalized: string[] = [];
    for (const segment of segments) {
      if (segment === '..') normalized.pop();
      else if (segment && segment !== '.') normalized.push(segment);
    }
    segments = ['', ...normalized];
    if (normalized.length && /(?:\/|\/\.|\/\.\.)$/.test(raw)) segments.push('');
  }
  const path = segments.map((segment) => service === 's3' ? encodeEscaped(segment) : encode(segment)).join('/') || '/';
  // Query strings use URI encoding, not form encoding: a literal '+' is not a space.
  const query = (url.search ? url.search.slice(1).split('&').filter(Boolean).map((part) => {
    const at = part.indexOf('=');
    return [encodeEscaped(at < 0 ? part : part.slice(0, at)), encodeEscaped(at < 0 ? '' : part.slice(at + 1))];
  }) : []).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [request.method.toUpperCase(), path, query, names.map((n) => `${n}:${signed[n]}`).join('\n') + '\n', names.join(';'), signed[hashHeader] ?? headers[hashHeader] ?? payload].join('\n');
  const scope = `${day}/${region}/${service}/${provider1}4_request`;
  const algorithm = `${provider1.toUpperCase()}4-HMAC-SHA256`;
  const toSign = [algorithm, stamp, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`${provider1.toUpperCase()}4${secret}`, day), region), service), `${provider1}4_request`);
  headers.Authorization = `${algorithm} Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256', signingKey).update(toSign).digest('hex')}`;
  return headers;
}
