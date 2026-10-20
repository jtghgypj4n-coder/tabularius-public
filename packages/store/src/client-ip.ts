import { isIP } from 'node:net';

/** Canonical bare IP; zones are interface-local and cannot identify an HTTP client globally. */
export function canonicalIP(value: string): string | undefined {
  if (value.includes('%')) return;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(ip);
  if (!mapped) return ip;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Stable IPv4 address or the first four numeric IPv6 hextets (/64). */
export function addressBucket(from: string): string {
  // A socket's own scope suffix (fe80::1%en0) is interface-local metadata: the same host, one budget. Header zones never get here.
  const ip = canonicalIP(from.split('%')[0]);
  if (!ip) return from.toLowerCase();
  if (isIP(ip) === 4) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  return (ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h).slice(0, 4).join(':');
}
