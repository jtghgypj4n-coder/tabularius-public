// What every response tells the browser about the connection and its features, and which name the console's cookie
// gets. Set beside Referrer-Policy in the request handler (index.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromThisComputer, hasTrustedClientAddress } from './client-address.ts';

/**
 * The browser features this server's own pages never use, denied for the page and anything it frames. The web client
 * keeps the camera (Insert from Device) and the location (Get Current Location) for its own origin only. Not named, so
 * left at the browser's default: the clipboard, passkeys (publickey-credentials-*), full screen and sharing, which the
 * web client and the console use, and autoplay (a muted camera preview).
 */
export const PERMISSIONS_POLICY = [
  'camera=(self)', 'geolocation=(self)', 'microphone=()', 'payment=()', 'usb=()', 'serial=()', 'hid=()', 'bluetooth=()', 'midi=()',
  'display-capture=()', 'accelerometer=()', 'gyroscope=()', 'magnetometer=()', 'xr-spatial-tracking=()', 'idle-detection=()', 'browsing-topics=()',
].join(', ');

/** One year, for this host only: no includeSubDomains (other names are not ours to decide) and no preload (that cannot be taken back). */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000';

const first = (v: string | string[] | undefined) => String((Array.isArray(v) ? v[0] : v) ?? '').split(',')[0].trim().toLowerCase();

/**
 * Whether this request reached the server over HTTPS: TLS ended here, or a proxy this server believes said so. A proxy
 * is believed on this computer, or at an address named in --trusted-proxies with a working --proxy-header; the visitor
 * writes X-Forwarded-Proto themselves otherwise, and a server that said "only HTTPS" over plain HTTP would be lying.
 */
export function secureConnection(req: IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  return first(req.headers['x-forwarded-proto']) === 'https' && (fromThisComputer(req) || hasTrustedClientAddress(req));
}

/** On every response, however it is made. */
export function setExposureHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('permissions-policy', PERMISSIONS_POLICY);
  // Browsers ignore this over plain HTTP; it is not sent there so a plain-HTTP answer never claims otherwise.
  if (secureConnection(req)) res.setHeader('strict-transport-security', STRICT_TRANSPORT_SECURITY);
}
