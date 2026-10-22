// The address clients reached the server at, for links it puts in answers (OData's @odata.context and nextLink) and
// for the host a passkey is signed over. The visitor writes X-Forwarded-Host and X-Forwarded-Proto themselves unless a
// proxy overwrote them, so they count only when the connection comes from this computer (a reverse proxy here), as
// with the visitor's address in client-address.ts. --public-url, when given, is the answer and no header changes it.

import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { fromThisComputer, hasForwardedHeaders } from './client-address.ts';

const first = (v: string | string[] | undefined) => String((Array.isArray(v) ? v[0] : v) ?? '').split(',')[0].trim();

/** A single HTTP origin, without credentials, a path or opaque values such as "null". */
function httpOrigin(value: string): string | undefined {
  if (!/^https?:\/\/[^/\\?#@\s]+$/i.test(value)) return undefined;
  try { return new URL(value).origin; } catch { return undefined; }
}

/** The https origins of the domains `--https` gets a certificate for (the operator named them): they may call /mcp from the admin console. */
export function acmeOrigins(domains: readonly string[], port: number): string[] {
  return domains.map((d) => `https://${d}${port === 443 ? '' : `:${port}`}`);
}

/** The host name a request was addressed to: the Host header without its port. */
export function requestHostName(req: { headers: { host?: string | string[] } }): string {
  return String(req.headers.host ?? '').replace(/:\d+$/, '');
}

/** A hostname in a URL authority needs brackets around an IPv6 literal. */
export function urlHostname(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Check configured public URLs before startup; a single trailing slash is allowed. */
export function validatePublicUrl(value: string | undefined): void {
  if (value !== undefined && (value !== value.trim() || !httpOrigin(value.replace(/\/$/, '')))) {
    throw new Error('--public-url / TABULARIUS_PUBLIC_URL: give a full address such as https://files.example.com, with no credentials, path, query or fragment');
  }
}

/**
 * Whether a browser Origin may call /mcp (DNS-rebinding protection). Allowed: no Origin at all (non-browser
 * clients); an origin in the allowlist or the public URL's origin; and a same-origin request (Origin equals
 * scheme://Host) whose Host is a loopback name or an IP literal, since a rebound page keeps its own DNS name in
 * Host and Origin. After the allowlist and public-origin checks, that same-origin fallback requires either no
 * public URL, or a public URL with none of x-forwarded-for, forwarded or x-real-ip present (even empty).
 * A proxy or cluster front process that supplies none of those three headers is not distinguished from a direct
 * connection by this check. Forwarded host and protocol values never add an origin.
 */
export function mcpOriginAllowed(req: IncomingMessage, publicUrl?: string, allowedOrigins: readonly string[] = []): boolean {
  if (req.headers.origin === undefined) return true;
  const origin = httpOrigin(req.headers.origin);
  if (!origin) return false;
  if (allowedOrigins.some((value) => httpOrigin(value) === origin)) return true;
  if (publicUrl !== undefined) {
    if (new URL(publicUrl).origin === origin) return true;
    // With a public URL and an Origin not already accepted, the localhost/IP same-origin fallback is blocked by
    // the presence of x-forwarded-for, forwarded or x-real-ip (even empty). A proxy or cluster front process supplying
    // none of those headers is not detected by this check.
    if (hasForwardedHeaders(req)) return false;
  }
  const encrypted = !!(req.socket as { encrypted?: boolean }).encrypted;
  const own = httpOrigin(`${encrypted ? 'https' : 'http'}://${req.headers.host ?? ''}`);
  if (!own || own !== origin) return false;
  const hostname = new URL(own).hostname;
  // IP literals cannot be DNS-rebound; other DNS names require explicit configuration.
  const address = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(address) !== 0;
}

let warn: ((message: string) => void) | undefined;
let warned = false;
/** Where to say, once, that forwarded headers are believed with no --public-url (the server's log). */
export function onForwardedWithoutPublicUrl(fn: ((message: string) => void) | undefined): void {
  warn = fn;
  warned = false;
}

/** The scheme and host (with any port) clients use: from the public URL when set, else the request, with proxy headers only from this computer. */
export function requestOrigin(req: IncomingMessage, publicUrl?: string): { proto: 'http' | 'https'; host: string } {
  if (publicUrl !== undefined) {
    const u = new URL(publicUrl);
    return { proto: u.protocol === 'https:' ? 'https' : 'http', host: u.host };
  }
  const proxied = fromThisComputer(req);
  if (proxied && !warned && (req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto'])) {
    // A reverse proxy on this computer that does not overwrite these headers (nginx does not by default) lets any visitor choose the host in links and passkeys.
    warned = true;
    warn?.('Forwarded host or protocol headers are being believed from a proxy on this computer, and no --public-url is set. If the proxy passes the visitor\'s own X-Forwarded-Host through, a visitor can choose the host in links and passkeys. Start the server with --public-url https://your.address to fix it.');
  }
  const encrypted = !!(req.socket as { encrypted?: boolean }).encrypted;
  const proto = (proxied && first(req.headers['x-forwarded-proto'])) || (encrypted ? 'https' : 'http');
  const host = (proxied && first(req.headers['x-forwarded-host'])) || first(req.headers.host) || 'localhost';
  return { proto: proto === 'https' ? 'https' : 'http', host };
}
