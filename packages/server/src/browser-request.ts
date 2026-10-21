import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/** Ambient credentials (cookies, cached Basic auth, or local authority) are same-origin only.
 * Native file Basic clients may omit browser headers; ambiguous console credentials need
 * an explicit console header. DNS names need operator configuration: comparing Origin with
 * an arbitrary Host alone would admit DNS rebinding.
 * Forwarded headers never nominate a trusted origin.
 */
export function sameOriginRequest(req: IncomingMessage, publicUrl?: string, configuredOrigins: readonly string[] = [], consoleCredentials = false): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  let own: string;
  try {
    if (publicUrl) own = new URL(publicUrl).origin;
    else {
      const authority = req.headers.host ?? '';
      if (!authority || /[\s/@\\?#]/.test(authority)) return false;
      const url = new URL(`${(req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${authority}`);
      const hostname = url.hostname;
      const address = hostname.replace(/^\[|\]$/g, '');
      const configured = configuredOrigins.some((value) => {
        try { return new URL(value).origin === url.origin; } catch { return false; }
      });
      if (hostname !== 'localhost' && !hostname.endsWith('.localhost') && !isIP(address) && !configured) return false;
      own = url.origin;
    }
  } catch { return false; }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    // An Origin is a serialized origin, never an opaque value, list, URL path or userinfo.
    if (!/^https?:\/\/[^/\\?#@\s]+$/i.test(origin)) return false;
    try { return new URL(origin).origin === own; } catch { return false; }
  }
  const referer = req.headers.referer;
  if (referer !== undefined) {
    try {
      const url = new URL(referer);
      return !url.username && !url.password && url.origin === own;
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
