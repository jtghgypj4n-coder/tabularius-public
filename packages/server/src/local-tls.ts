// HTTPS on a local network without buying a name: Tabularius makes its own small
// certificate authority, kept in <folder>/.openhbam-tls/local, and a server
// certificate from it for this machine's names and addresses (its host name,
// <name>.local, its LAN IP addresses, localhost).
//
//   tabularius serve <folder> --https local --host 0.0.0.0
//
// Each Mac, iPhone, iPad or PC that opens the server trusts the authority once
// (the page at /tabularius/tls/ says how, with a profile for Apple devices);
// from then on the address shows as secure and no password crosses the
// network in the clear. The authority's key never leaves the folder, and it
// can sign for nothing but this server's own names: it is constrained to them.
// The server certificate is renewed on start when it nears its end or the
// machine's names change.
//
//   GET /tabularius/tls/                   how to trust it, per device (no sign-in: it's needed first)
//   GET /tabularius/tls/ca.cer             the authority's certificate (DER)
//   GET /tabularius/tls/tabularius.mobileconfig   the same, as a profile for iPhone, iPad and Mac

import { readTlsPair, writeTlsPair } from './tls-pair.ts';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate, createPrivateKey, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pageCss } from './pages.ts';

const DIR = join('.openhbam-tls', 'local');
/** Apple devices refuse server certificates valid for longer. */
const SERVER_DAYS = 397;
const CA_YEARS = 10;
const RENEW_DAYS = 30;

// --- DER, enough for a certificate ------------------------------------------------

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 0xff]) : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}
function oid(text: string): Buffer {
  const [a, b, ...rest] = text.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const groups = [n & 0x7f];
    for (let v = n >>> 7; v; v >>>= 7) groups.unshift((v & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}
const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);
const utf8 = (s: string) => der(0x0c, Buffer.from(s, 'utf8'));
const bool = (v: boolean) => der(0x01, Buffer.from([v ? 0xff : 0]));
const octets = (b: Buffer) => der(0x04, b);
const bits = (b: Buffer, unused = 0) => der(0x03, Buffer.from([unused]), b);
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'; // YYYYMMDDHHMMSSZ
  return d.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(iso.slice(2))) : der(0x18, Buffer.from(iso));
}
function name(cn: string): Buffer {
  return seq(set(seq(oid('2.5.4.10'), utf8('tabularius'))), set(seq(oid('2.5.4.3'), utf8(cn))));
}
function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
}
/** An IP address as SAN bytes. */
function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return Buffer.from(groups.flatMap((g) => { const v = parseInt(g || '0', 16); return [v >> 8, v & 0xff]; }));
}
function keyId(key: KeyObject): Buffer {
  return createHash('sha1').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest();
}

/** Signs a certificate (DER) for `subjectKey`'s public half with `issuerKey`. */
function certificate(opts: { subject: string; issuer: string; subjectKey: KeyObject; issuerKey: KeyObject; days: number; extensions: Buffer[] }): Buffer {
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) || 1; // positive, and never a leading zero byte (DER integers have no padding: ~1 in 512 serials were refused as "illegal padding")
  const now = Date.now();
  const sigAlg = seq(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    sigAlg,
    name(opts.issuer),
    seq(time(new Date(now - 60 * 60_000)), time(new Date(now + opts.days * 86_400_000))),
    name(opts.subject),
    createPublicKey(opts.subjectKey).export({ type: 'spki', format: 'der' }),
    der(0xa3, seq(...opts.extensions)),
  );
  return seq(tbs, sigAlg, bits(sign('sha256', tbs, opts.issuerKey)));
}

const pem = (label: string, body: Buffer) => `-----BEGIN ${label}-----\n${body.toString('base64').replace(/.{64}/g, '$&\n').replace(/\n?$/, '\n')}-----END ${label}-----\n`;

// --- the authority and the server certificate -------------------------------------

/** A private-network or loopback address (RFC 1918, fc00::/7, 127/8, ::1). */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
  }
  if (isIP(ip) === 6) {
    const first = ipBytes(ip)[0];
    return ip === '::1' || (first & 0xfe) === 0xfc;
  }
  return false;
}

/** This machine's names and addresses, as a LAN client would reach it. */
export function localNames(): string[] {
  const host = osHostname().toLowerCase();
  const short = host.replace(/\.local$/, '');
  const names = new Set([short, `${short}.local`, 'localhost']);
  // Private addresses only: the authority can't vouch for public ones (see its name constraints).
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (!a.internal && privateAddress(a.address)) names.add(a.address);
  }
  names.add('127.0.0.1');
  names.add('::1');
  return [...names];
}

export interface LocalTls {
  /** PEM files to serve with: the server certificate (with the authority after it) and its key. */
  cert: string;
  key: string;
  /** The authority's certificate, for devices to trust. */
  ca: string;
  /** SHA-256 fingerprint of the authority, to check against what a device shows. */
  fingerprint: string;
  names: string[];
  renewed: boolean;
}

/** Makes (or reuses) the folder's authority and a current server certificate for `names`. */
export function localCertificate(folder: string, names = localNames()): LocalTls {
  const dir = join(folder, DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caKeyPath = join(dir, 'ca.key');
  const caPath = join(dir, 'ca.crt');
  const pairPath = join(dir, 'server');
  const permittedPath = join(dir, 'ca-names.json');
  let dns = names.filter((n) => !isIP(n));
  const ips = names.filter((n) => isIP(n) && privateAddress(n));

  let caKey: KeyObject;
  let caDer: Buffer;
  if (existsSync(caKeyPath) && existsSync(caPath)) {
    caKey = createPrivateKey(readFileSync(caKeyPath));
    const keptCa = new X509Certificate(readFileSync(caPath));
    if (!keptCa.checkPrivateKey(caKey)) throw new Error('Local TLS authority key does not match its certificate');
    caDer = keptCa.raw;
  } else {
    caKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const cn = `Tabularius on ${osHostname().replace(/\.local$/, '')}`;
    // Name constraints: this authority can only vouch for the names and addresses it was made for
    // and the private ranges, so a copy of its key can't be used to impersonate other sites.
    // permittedSubtrees [0] IMPLICIT: the subtrees directly, each a SEQUENCE holding a GeneralName.
    const permitted = [
      ...new Set(['local', 'localhost', ...dns.filter((d) => !d.endsWith('.local'))]),
    ].map((d) => seq(der(0x82, Buffer.from(d)))).concat(
      [['10.0.0.0', '255.0.0.0'], ['172.16.0.0', '255.240.0.0'], ['192.168.0.0', '255.255.0.0'], ['127.0.0.0', '255.0.0.0']]
        .map(([net, mask]) => seq(der(0x87, Buffer.concat([ipBytes(net), ipBytes(mask)])))),
      seq(der(0x87, Buffer.concat([ipBytes('::1'), Buffer.alloc(16, 0xff)]))),
      seq(der(0x87, Buffer.concat([ipBytes('fc00::'), ipBytes('fe00::')]))),
    );
    caDer = certificate({
      subject: cn, issuer: cn, subjectKey: caKey, issuerKey: caKey, days: CA_YEARS * 365,
      extensions: [
        extension('2.5.29.19', true, seq(bool(true), der(0x02, Buffer.from([0])))), // CA, no intermediates
        extension('2.5.29.15', true, bits(Buffer.from([0x86]), 1)), // digitalSignature, keyCertSign, cRLSign
        extension('2.5.29.14', false, octets(keyId(caKey))),
        extension('2.5.29.30', true, seq(der(0xa0, ...permitted))),
      ],
    });
    writeFileSync(caKeyPath, caKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(caPath, pem('CERTIFICATE', caDer));
    writeFileSync(permittedPath, JSON.stringify(dns));
  }
  // Names the authority can vouch for: .local ones, localhost, and the names it was made with.
  const permitted = new Set<string>((() => {
    try {
      return JSON.parse(readFileSync(permittedPath, 'utf8')) as string[];
    } catch {
      return [];
    }
  })());
  dns = dns.filter((d) => d === 'localhost' || d.endsWith('.local') || permitted.has(d));
  const ca = new X509Certificate(caDer);

  // The server certificate: kept while it has a month left and the names are the same.
  let renewed = false;
  let pair = readTlsPair(pairPath);
  let current: X509Certificate | undefined;
  try {
    current = pair ? new X509Certificate(pair.cert) : undefined;
  } catch {
    current = undefined;
  }
  const fresh = current && pair && current.verify(ca.publicKey)
    && Date.parse(current.validFrom) <= Date.now()
    && Date.parse(current.validTo) - Date.now() > RENEW_DAYS * 86_400_000
    && (current.subjectAltName ?? '').split(/,\s*/).length === dns.length + ips.length
    && dns.every((name) => current!.checkHost(name)) && ips.every((ip) => current!.checkIP(ip));
  if (!fresh) {
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const san = seq(...dns.map((d) => der(0x82, Buffer.from(d))), ...ips.map((ip) => der(0x87, ipBytes(ip))));
    const leaf = certificate({
      subject: dns[0] ?? ips[0] ?? 'localhost', issuer: ca.subject.split('\n').find((l) => l.startsWith('CN='))!.slice(3), subjectKey: key, issuerKey: caKey, days: SERVER_DAYS,
      extensions: [
        extension('2.5.29.19', true, seq()),
        extension('2.5.29.15', true, bits(Buffer.from([0x80]), 7)), // digitalSignature
        extension('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))), // serverAuth
        extension('2.5.29.17', false, san),
        extension('2.5.29.35', false, seq(der(0x80, keyId(caKey)))),
      ],
    });
    pair = { key: key.export({ type: 'pkcs8', format: 'pem' }) as string, cert: pem('CERTIFICATE', leaf) };
    writeTlsPair(pairPath, pair);
    renewed = true;
  }
  return {
    cert: pair!.cert + readFileSync(caPath, 'utf8'),
    key: pair!.key,
    ca: readFileSync(caPath, 'utf8'),
    fingerprint: ca.fingerprint256,
    names: [...dns, ...ips],
    renewed,
  };
}

/** The folder's authority, if it has one: its name and fingerprint. */
export function localAuthority(folder: string): { name: string; fingerprint: string } | undefined {
  try {
    const ca = new X509Certificate(readFileSync(join(folder, DIR, 'ca.crt')));
    return { name: ca.subject.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? 'tabularius', fingerprint: ca.fingerprint256 };
  } catch {
    return undefined;
  }
}

/** Where the files are, for a server started with --tls-cert/--tls-key. */
export function localCertificateFiles(folder: string, names?: string[]): { certPath: string; keyPath: string; tls: LocalTls } {
  const tls = localCertificate(folder, names);
  const dir = join(folder, DIR);
  const path = writeTlsPair(join(dir, 'chain'), tls);
  return { certPath: path, keyPath: path, tls };
}

// --- helping devices trust it --------------------------------------------------------

/** An Apple configuration profile that installs the authority (iPhone, iPad, Mac). */
export function mobileconfig(caPem: string, label: string): string {
  const der = new X509Certificate(caPem).raw;
  const uuid = (seed: string) => {
    const h = createHash('sha256').update(seed).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
  };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key><string>tabularius-ca.cer</string>
      <key>PayloadContent</key><data>${der.toString('base64')}</data>
      <key>PayloadDisplayName</key><string>${esc(label)}</string>
      <key>PayloadIdentifier</key><string>org.openhbam.ca.${uuid(caPem).slice(0, 8)}.cert</string>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadUUID</key><string>${uuid(caPem + 'cert')}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key><string>Lets this device open the Tabularius server over HTTPS without warnings.</string>
  <key>PayloadDisplayName</key><string>${esc(label)}</string>
  <key>PayloadIdentifier</key><string>org.openhbam.ca.${uuid(caPem).slice(0, 8)}</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid(caPem + 'profile')}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}

/** The trust page and downloads. Returns false when the request isn't for them. */
export function handleTrust(folder: string, req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (!path.startsWith('/tabularius/tls/') && path !== '/tabularius/tls') return false;
  let ca: string;
  try {
    ca = readFileSync(join(folder, DIR, 'ca.crt'), 'utf8');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('This server does not use its own certificate authority (start it with --https local).');
    return true;
  }
  const cert = new X509Certificate(ca);
  const label = cert.subject.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? 'tabularius';
  if (path === '/tabularius/tls/ca.cer') {
    res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="tabularius-ca.cer"' }).end(cert.raw);
  } else if (path === '/tabularius/tls/tabularius.mobileconfig') {
    res.writeHead(200, { 'content-type': 'application/x-apple-aspen-config', 'content-disposition': 'attachment; filename="tabularius.mobileconfig"' }).end(mobileconfig(ca, label));
  } else if (path === '/tabularius/tls' || path === '/tabularius/tls/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'" }).end(trustPage(label, cert.fingerprint256, req));
  } else {
    res.writeHead(404).end();
  }
  return true;
}

function trustPage(label: string, fingerprint: string, req: IncomingMessage): string {
  const host = String(req.headers.host ?? '');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trust this server</title>
<style>${pageCss()}
  main { width: min(680px, 100%); }
  h1 { margin-top: 0; } h2 { margin: 0 0 6px; font-size: var(--t-lg); }
  section { margin: var(--s4) 0 0; padding: var(--s4) var(--s5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sunken); }
  p, li { color: var(--text); } .meta { color: var(--muted); }
  a.button { display: inline-flex; align-items: center; min-height: 30px; padding: 0 12px; border-radius: var(--radius-sm); background: var(--brand); color: var(--brand-text); font-weight: 500; text-decoration: none; }
  a.button:hover { background: var(--brand-hover); } a.button:focus-visible { outline: none; box-shadow: var(--focus); }
  ol { padding-left: 20px; margin: 0; } li { margin: 4px 0; }
</style></head><body><main>
<h1>Trust this server</h1>
<p>${esc(host)} uses its own certificate, made by <strong>${esc(label)}</strong>. Trust it once on each device, and the server opens over HTTPS with no warnings and nothing sent in the clear.</p>
<p class="meta">Before trusting it, check the fingerprint your device shows matches this one, read from the server's admin console:<br><code>${fingerprint}</code></p>
<section><h2>iPhone and iPad</h2>
<ol><li>Open this page in Safari and tap <a class="button" href="/tabularius/tls/tabularius.mobileconfig">Download the profile</a>, then Allow.</li>
<li>Open <strong>Settings</strong>, tap <strong>Profile Downloaded</strong> near the top, then <strong>Install</strong> (it asks for the device passcode).</li>
<li>Go to <strong>Settings &gt; General &gt; About &gt; Certificate Trust Settings</strong> and turn on <strong>${esc(label)}</strong>.</li></ol></section>
<section><h2>Mac</h2>
<ol><li><a class="button" href="/tabularius/tls/tabularius.mobileconfig">Download the profile</a></li>
<li>Open <strong>System Settings</strong>, click <strong>Profile Downloaded</strong> in the sidebar (or <strong>General &gt; Device Management</strong>), double-click it and click <strong>Install</strong>.</li>
<li>Quit and reopen the browser. Safari and Chrome use it straight away; Firefox needs <code>security.enterprise_roots.enabled</code> set to true in <code>about:config</code>.</li></ol>
<p class="meta">Or in Terminal: <code>curl -sk https://${esc(host)}/tabularius/tls/ca.cer -o /tmp/tabularius-ca.cer &amp;&amp; sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/tabularius-ca.cer</code></p></section>
<section><h2>Windows</h2>
<ol><li><a class="button" href="/tabularius/tls/ca.cer">Download the certificate</a> and open it.</li>
<li>Click <strong>Install Certificate</strong>, choose <strong>Local Machine</strong>, then <strong>Place all certificates in the following store</strong> &gt; <strong>Trusted Root Certification Authorities</strong>.</li></ol></section>
<section><h2>Android</h2>
<ol><li><a class="button" href="/tabularius/tls/ca.cer">Download the certificate</a>.</li>
<li>Open <strong>Settings &gt; Security &gt; More security settings &gt; Encryption &amp; credentials &gt; Install a certificate &gt; CA certificate</strong> and pick it.</li></ol></section>
<p class="meta">This authority can only vouch for this server's own names and private network addresses, so trusting it doesn't let it stand in for other websites.</p>
</main></body></html>`;
}
