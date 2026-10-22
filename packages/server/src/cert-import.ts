// A certificate from a certificate authority, put in place through FileMaker
// Server's Admin API as fmcsadmin does it:
//
//   fmcsadmin certificate create "/CN=files.example.com/O=Example"   PATCH /server/certificate/csr
//   (send the request to the authority, get the certificate back)
//   fmcsadmin certificate import cert.crt --intermediateCA chain.pem   PATCH /server/certificate/import
//   fmcsadmin certificate delete                                     DELETE /server/certificate/delete
//
// Creating a request makes a new RSA key, kept in <folder>/.openhbam-tls/imported
// encrypted with the password given, and answers the request (PEM). Importing
// checks that the certificate goes with the key (the one sent, or the one the
// request made), hasn't expired, and that each intermediate certificate signed
// the one before; then the chain and the key (decrypted, readable by the
// server's own user only) are saved there and the folder's settings point
// `tabularius serve` at them. Deleting removes them again.

import { updateJsonStateSync } from '../../store/src/durable.ts';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { isIP } from 'node:net';
import { readSettings, SETTINGS_FILE } from './fms-migrate.ts';

const DIR = join('.openhbam-tls', 'imported');
const REQUEST_KEY = 'request-key.pem';
const REQUEST = 'request.csr';
/** What the folder's settings named before the first import, put back by delete. */
const PREVIOUS = 'previous.json';

/**
 * Why certificates can't be put in place through the Admin API, when the server gets its certificate another way
 * (--https, or --tls-cert files the folder's settings don't name), which would replace one at the next start.
 */
export function certificateManaged(opts: { dir: string; acme?: unknown; tlsCert?: string }): string | undefined {
  if (opts.acme) return 'the server gets its certificate automatically (--https with a name)';
  if (!opts.tlsCert) return undefined;
  let settingsCert: string | undefined;
  try {
    settingsCert = readSettings(opts.dir).tlsCert;
  } catch {
    // A settings file that isn't JSON names nothing.
  }
  return settingsCert && resolve(opts.tlsCert) === resolve(settingsCert) ? undefined : 'the server was started with --tls-cert or --https local; replace those files instead';
}

export class CertificateError extends Error {
  /** The Admin API code: 1712 when a request key is already there, else 960 (a parameter is invalid). */
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// --- DER, enough for a certificate request ----------------------------------------

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

/** Subject attributes FileMaker Server's request takes, by their short names. */
const ATTRIBUTES: Record<string, { oid: string; printable?: true }> = {
  CN: { oid: '2.5.4.3' },
  C: { oid: '2.5.4.6', printable: true },
  L: { oid: '2.5.4.7' },
  ST: { oid: '2.5.4.8' },
  O: { oid: '2.5.4.10' },
  OU: { oid: '2.5.4.11' },
  EMAILADDRESS: { oid: '1.2.840.113549.1.9.1' },
};

/** "/CN=files.example.com/O=Example Ltd" → its parts, in order; the common name is required. */
export function parseSubject(subject: string): [string, string][] {
  const parts = subject.split('/').filter((p) => p.trim()).map((p) => {
    const at = p.indexOf('=');
    const key = (at > 0 ? p.slice(0, at) : '').trim().toUpperCase();
    const value = at > 0 ? p.slice(at + 1).trim() : '';
    if (!ATTRIBUTES[key] || !value || value.length > 64) throw new CertificateError(960, `Parameter is invalid: subject (${p.trim() || 'empty part'}); use /CN=name/O=organization/C=US and the like`);
    if (key === 'C' && !/^[A-Za-z]{2}$/.test(value)) throw new CertificateError(960, 'Parameter is invalid: subject (C is a two-letter country code)');
    if (key === 'EMAILADDRESS' && !/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(value)) throw new CertificateError(960, 'Parameter is invalid: subject (emailAddress)');
    return [key, value] as [string, string];
  });
  const cn = parts.filter(([k]) => k === 'CN');
  if (cn.length !== 1) throw new CertificateError(960, 'Parameter is invalid: subject needs one /CN=, the server\'s name');
  return parts;
}

/** A PKCS#10 request (DER) for the subject, its common name also as the DNS name, signed with an RSA key. */
function certificateRequest(key: KeyObject, subject: [string, string][]): Buffer {
  const name = seq(...subject.map(([k, v]) => set(seq(oid(ATTRIBUTES[k].oid), der(k === 'EMAILADDRESS' ? 0x16 : ATTRIBUTES[k].printable ? 0x13 : 0x0c, Buffer.from(v))))));
  // The common name as the DNS name (or address) too, when it is one: authorities go by that.
  const san = sanFor(subject.find(([k]) => k === 'CN')![1]);
  const attributes = san ? der(0xa0, seq(oid('1.2.840.113549.1.9.14'), set(seq(seq(oid('2.5.29.17'), der(0x04, seq(san))))))) : der(0xa0);
  const info = seq(der(0x02, Buffer.from([0])), name, createPublicKey(key).export({ type: 'spki', format: 'der' }), attributes);
  const sha256WithRsa = seq(oid('1.2.840.113549.1.1.11'), der(0x05));
  return seq(info, sha256WithRsa, der(0x03, Buffer.from([0]), sign('sha256', info, key)));
}

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

const pem = (label: string, body: Buffer) => `-----BEGIN ${label}-----\n${body.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END ${label}-----\n`;

function write(file: string, text: string): void {
  writeFileSync(file + '.tmp', text, { mode: 0o600 });
  renameSync(file + '.tmp', file);
}

/** The folder settings file's values, as written (paths relative to the folder). */
function rawSettings(dir: string): Record<string, unknown> {
  const f = join(dir, SETTINGS_FILE);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    // Not the parser's or the file system's own message: it quotes the file's text or names its folder.
    throw new CertificateError(960, `${SETTINGS_FILE} could not be read: check that it is valid JSON and that the server may read it`);
  }
}

/** Sets or removes the folder settings' tlsCert and tlsKey, keeping the rest of the file. */
function pointSettings(dir: string, files: { tlsCert?: unknown; tlsKey?: unknown }): void {
  updateJsonStateSync<Record<string, unknown>>(join(dir, SETTINGS_FILE), {}, (current) => {
    const next = { ...current, tlsCert: files.tlsCert, tlsKey: files.tlsKey };
    if (typeof files.tlsCert !== 'string' || typeof files.tlsKey !== 'string') {
      delete next.tlsCert;
      delete next.tlsKey;
    }
    return next;
  }, { mode: 0o600 });
}

/** A DNS name a certificate can carry, or an IP address. */
function sanFor(cn: string): Buffer | undefined {
  if (isIP(cn) === 4) return der(0x87, Buffer.from(cn.split('.').map(Number)));
  if (/^(?:\*\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(cn) && cn.length <= 253) return der(0x82, Buffer.from(cn));
  return undefined;
}

export class ImportedCertificates {
  private readonly dir: string;
  private readonly folder: string;

  constructor(dir: string) {
    this.dir = dir;
    this.folder = join(dir, DIR);
  }

  /** Whether the folder's settings point at a certificate imported here. */
  imported(): boolean {
    let cert: string | undefined;
    try {
      cert = readSettings(this.dir).tlsCert;
    } catch {
      return false;
    }
    return !!cert && resolve(cert).startsWith(resolve(this.folder) + sep);
  }

  /** Makes a key and a request for the subject; the key is kept, encrypted with the password. Answers the request (PEM). */
  createRequest(subject: string, password: string): string {
    const parts = parseSubject(subject);
    if (password.length < 4 || password.length > 1023) throw new CertificateError(960, 'Parameter is invalid: password (4 to 1023 characters) encrypts the new key');
    if (existsSync(join(this.folder, REQUEST_KEY))) throw new CertificateError(1712, 'Private key file already exists: import the certificate for it, or delete the certificate first');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const request = pem('CERTIFICATE REQUEST', certificateRequest(privateKey, parts));
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    write(join(this.folder, REQUEST_KEY), privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password }) as string);
    write(join(this.folder, REQUEST), request);
    return request;
  }

  /**
   * Checks and saves a certificate with its key (sent, or the one createRequest made, opened with the password) and
   * intermediate certificates, and points the folder's settings at them. Answers the chain and the key (PEM) to serve.
   */
  import(input: { certificate: string; privateKey?: string; intermediateCertificates?: string; password?: string }): { cert: string; key: string; expires: string; subject: string } {
    // A full chain sent as the certificate (fullchain.pem): the first is the certificate, the rest intermediates.
    const blocks = input.certificate.match(PEM_CERT) ?? [];
    let leaf: X509Certificate;
    try {
      leaf = new X509Certificate(blocks[0] ?? input.certificate);
    } catch {
      throw new CertificateError(960, 'Parameter is invalid: certificate is not a PEM certificate');
    }
    const keyText = input.privateKey?.trim() ? input.privateKey : existsSync(join(this.folder, REQUEST_KEY)) ? readFileSync(join(this.folder, REQUEST_KEY), 'utf8') : undefined;
    if (!keyText) throw new CertificateError(960, 'Parameter is invalid: privateKey is needed (no request was created here to use the key of)');
    let key: KeyObject;
    try {
      key = createPrivateKey({ key: keyText, ...(input.password ? { passphrase: input.password } : {}) });
    } catch {
      throw new CertificateError(960, `Parameter is invalid: ${input.password ? 'the private key doesn\'t open with that password' : 'privateKey is not a PEM private key (an encrypted one needs its password)'}`);
    }
    if (!leaf.checkPrivateKey(key)) throw new CertificateError(960, 'Parameter is invalid: the certificate doesn\'t go with the private key');
    if (new Date(leaf.validTo).getTime() <= Date.now()) throw new CertificateError(960, `Parameter is invalid: the certificate expired on ${new Date(leaf.validTo).toISOString().slice(0, 10)}`);
    if (new Date(leaf.validFrom).getTime() > Date.now()) throw new CertificateError(960, 'Parameter is invalid: the certificate isn\'t valid yet');
    const chain: X509Certificate[] = [];
    for (const block of [...blocks.slice(1), ...(input.intermediateCertificates ?? '').match(PEM_CERT) ?? []]) {
      try {
        chain.push(new X509Certificate(block));
      } catch {
        throw new CertificateError(960, 'Parameter is invalid: intermediateCertificates holds something that isn\'t a certificate');
      }
    }
    if (input.intermediateCertificates?.trim() && !chain.length) throw new CertificateError(960, 'Parameter is invalid: intermediateCertificates holds no PEM certificate');
    let below = leaf;
    for (const ca of chain) {
      if (!below.checkIssued(ca) || !below.verify(ca.publicKey)) throw new CertificateError(960, `Parameter is invalid: ${ca.subject.replace(/\n/g, ', ')} did not sign ${below.subject.replace(/\n/g, ', ')} (give the intermediate certificates in order)`);
      if (new Date(ca.validTo).getTime() <= Date.now()) throw new CertificateError(960, `Parameter is invalid: the intermediate certificate ${ca.subject.replace(/\n/g, ', ')} has expired`);
      below = ca;
    }
    const cert = [leaf, ...chain].map((c) => c.toString().trim() + '\n').join('');
    const keyPem = key.export({ type: 'pkcs8', format: 'pem' }) as string;
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    // What the settings named before (migrate-fms's certificate, say), for delete to put back.
    const before = rawSettings(this.dir);
    const wasImported = this.imported();
    if (!wasImported) write(join(this.folder, PREVIOUS), JSON.stringify({ tlsCert: before.tlsCert, tlsKey: before.tlsKey }) + '\n');
    // New names each time, and the settings switched last: a failure part way leaves the working pair named.
    const stamp = Date.now().toString(36);
    const files = { tlsCert: `${DIR.split(sep).join('/')}/cert-${stamp}.pem`, tlsKey: `${DIR.split(sep).join('/')}/key-${stamp}.pem` };
    write(join(this.dir, files.tlsKey), keyPem);
    write(join(this.dir, files.tlsCert), cert);
    pointSettings(this.dir, files);
    for (const old of wasImported ? [before.tlsCert, before.tlsKey] : []) {
      if (typeof old === 'string' && resolve(this.dir, old) !== resolve(this.dir, files.tlsCert) && resolve(this.dir, old) !== resolve(this.dir, files.tlsKey)) rmSync(resolve(this.dir, old), { force: true });
    }
    // The request's key is now the certificate's: a new request may be made.
    rmSync(join(this.folder, REQUEST_KEY), { force: true });
    rmSync(join(this.folder, REQUEST), { force: true });
    return { cert, key: keyPem, expires: new Date(leaf.validTo).toISOString(), subject: leaf.subject.replace(/\n/g, ', ') };
  }

  /** Removes an imported certificate (and any pending request); false when there was none. */
  delete(): boolean {
    const had = this.imported() || existsSync(join(this.folder, REQUEST_KEY));
    if (this.imported()) {
      // Back to what the settings named before the first import (none, or migrate-fms's certificate).
      let previous: Record<string, unknown> = {};
      try {
        previous = JSON.parse(readFileSync(join(this.folder, PREVIOUS), 'utf8'));
      } catch {
        // None kept: the settings name no certificate.
      }
      pointSettings(this.dir, previous);
    }
    rmSync(this.folder, { recursive: true, force: true });
    return had;
  }
}
