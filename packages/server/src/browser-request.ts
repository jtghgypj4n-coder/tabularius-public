import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/** Whether the request says it comes from a browser: any Fetch Metadata header, an Origin or a Referer. Native clients (curl, server to server, ODBC-style drivers) send none of them. */
export function browserSignal(req: IncomingMessage): boolean {
  return req.headers.origin !== undefined || req.headers.referer !== undefined || Object.keys(req.headers).some((name) => name.startsWith('sec-fetch-'));
}

/**
 * The host name a request was addressed to when it is a DNS name this server was not told about (no --public-url, not
 * localhost, not an IP address, not one of the --https domains), else undefined. Comparing Origin with an arbitrary Host
 * alone would admit DNS rebinding, so a browser's request to such a name is refused; the answer names this fix.
 */
export function unconfiguredHostName(req: IncomingMessage, publicUrl?: string, configuredOrigins: readonly string[] = []): string | undefined {
  if (publicUrl) return undefined;
  const authority = req.headers.host ?? '';
  if (!authority || /[\s/@\\?#]/.test(authority)) return undefined;
  try {
    const url = new URL(`${(req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${authority}`);
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(hostname.replace(/^\[|\]$/g, ''))) return undefined;
    return configuredOrigins.some((value) => { try { return new URL(value).origin === url.origin; } catch { return false; } }) ? undefined : hostname;
  } catch { return undefined; }
}

/** Ambient credentials (cookies, cached Basic auth, or local authority) are same-origin only.
 * Native file Basic clients may omit browser headers; ambiguous console credentials need
 * an explicit console header. A DNS name needs operator configuration (--public-url or --https)
 * before a browser's request to it is accepted: comparing Origin with an arbitrary Host alone
 * would admit DNS rebinding. A request with no browser signal and no cookie is a native client
 * and is not held to the host name; one with either is.
 * Forwarded headers never nominate a trusted origin.
 */
export function sameOriginRequest(req: IncomingMessage, publicUrl?: string, configuredOrigins: readonly string[] = [], consoleCredentials = false): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  let own: string | undefined;
  try {
    if (publicUrl) own = new URL(publicUrl).origin;
    else {
      const authority = req.headers.host ?? '';
      if (!authority || /[\s/@\\?#]/.test(authority)) return false;
      const url = new URL(`${(req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${authority}`);
      // A DNS name nobody configured is refused to a browser, or to anything carrying a cookie. A request with no browser
      // signal at all (a native client) is not a rebinding page and is judged as before: it has no Origin or Referer to compare.
      if (unconfiguredHostName(req, undefined, configuredOrigins) !== undefined) {
        if (browserSignal(req) || req.headers.cookie !== undefined) return false;
      } else own = url.origin;
    }
  } catch { return false; }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    // An Origin is a serialized origin, never an opaque value, list, URL path or userinfo.
    if (!/^https?:\/\/[^/\\?#@\s]+$/i.test(origin)) return false;
    try { return own !== undefined && new URL(origin).origin === own; } catch { return false; }
  }
  const referer = req.headers.referer;
  if (referer !== undefined) {
    try {
      const url = new URL(referer);
      return !url.username && !url.password && own !== undefined && url.origin === own;
    } catch { return false; }
  }
  // Plain HTTP browsers may omit Fetch Metadata, and a hostile page can suppress Referer.
  // Console cookies and cached Basic credentials must not turn that ambiguity into authority.
  // Some console GETs generate/cache reports; they need this check as much as mutations do.
  if (site === undefined && (/(?:^|;\s*)(?:tabularius|openhbam)_admin=/.test(req.headers.cookie ?? '') ||
      (consoleCredentials && /^Basic\s/i.test(req.headers.authorization ?? '')))) {
    return req.headers['x-tabularius-console'] === '1' || req.headers['x-tabularius-admin'] === '1';
  }
  return true;
}

/** These dispatch families can use ambient authority; other APIs require explicit capabilities.
 * An explicit bearer bypass is safe only outside the console, whose cookie/local fallback
 * must never be enabled by adding a bogus Authorization header.
 */
export function needsSameOriginCheck(req: IncomingMessage, pathname: string): boolean {
  if (pathname.startsWith('/tabularius/admin/')) return true;
  if (pathname === '/oauth/authorize') return req.method === 'POST';
  if (pathname === '/mcp') return req.headers.origin === undefined && !/^Bearer\s+\S+$/i.test(req.headers.authorization ?? '');
  // Session creation consumes Basic credentials/assertions, not an unrelated header token.
  // Match DataApi.handleOperation: discard empty segments, then decode each segment.
  // Its passkey/recovery handlers also accept segments after the action name.
  if (req.method === 'POST') {
    const dataPath = /^\/fmi\/data\/(vLatest|v1|v2)(\/.*)?$/.exec(pathname);
    if (dataPath) {
      try {
        const parts = (dataPath[2] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
        if (parts[0] === 'databases' && parts[2] === 'sessions') return true;
      } catch { /* Malformed escapes cannot reach a Data API session handler. */ }
    }
  }
  const ambient = ['/fmi/data/', '/fmi/odata/', '/fmi/xml/', '/tabularius/sql/'].some((prefix) => pathname.startsWith(prefix));
  return ambient && !/^Bearer\s+\S+$/i.test(req.headers.authorization ?? '') && !req.headers['x-fm-data-access-token'];
}
