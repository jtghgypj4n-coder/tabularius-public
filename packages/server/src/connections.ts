// Connections: the outside services a solution talks to (S3-compatible storage first), set up once in the admin
// console with their credentials kept encrypted on the server. A script, a plug-in or an AI tool uses a connection
// by its name; none of them ever receives the credentials, which are decrypted only inside the server, for the one
// request being signed.
//
//   <folder>/.openhbam-connections.json         each connection: name, type, settings (never a secret)
//   <folder>/.openhbam-connection-secrets.json  the secrets, each sealed with AES-256-GCM
//   <folder>/.openhbam-connections.key          the key, when TABULARIUS_SECRETS_KEY (or TABULARIUS_ENCRYPTION_KEY) isn't set
//
// With a passphrase in the environment the key never touches the folder, and a copy of the folder holds nothing
// readable. Without one the server makes a random key file (readable by its user alone) beside the secrets: that
// keeps secrets out of logs, backups of single files and a pasted settings file, but not from someone who can read
// the whole folder as the server's user.
//
// A connection made by the AI (a draft) can't be used until a person has put its secrets in at the console and
// approved it there; the AI is never given a place to put a secret, and refuses a settings value that looks like
// one. Only the console's API sets secrets, approves, or changes a connection that is in use.
//
//   GET    /tabularius/admin/v1/connections                       types, and connections with which secrets are set (never their values)
//   POST   /tabularius/admin/v1/connections                       {name, type, config, files?, note?}
//   PATCH  /tabularius/admin/v1/connections/{id}                  {name?, config?, files?, note?, enabled?}
//   PUT    /tabularius/admin/v1/connections/{id}/secrets/{field}  {value}; DELETE clears it
//   POST   /tabularius/admin/v1/connections/{id}/approve          a draft becomes usable once its required secrets are set
//   POST   /tabularius/admin/v1/connections/{id}/test             asks the service something harmless (lists one object)
//   DELETE /tabularius/admin/v1/connections/{id}

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { readJsonStateSync, updateJsonStateSync, withStateLock } from '../../store/src/durable.ts';
import { captureOnly, type ConnectionRequest, type ScriptConnections } from '../../scripts/src/index.ts';
import { OutboundRefused, guardedFetch as guardedRequest, isInternalHost, mappedIPv4 } from '../../scripts/src/net-guard.ts';
import { S3 } from './s3.ts';
import { checkLogin, MAIL_RECIPIENT_LIMIT, type SmtpConfig } from './smtp.ts';

export const CONNECTIONS_FILE = '.openhbam-connections.json';
const SECRETS_FILE = '.openhbam-connection-secrets.json';
const KEY_FILE = '.openhbam-connections.key';

export class ConnectionError extends Error {}

export type ConnectionStatus = 'draft' | 'active' | 'disabled';

export interface ConnectionTest {
  at: string;
  ok: boolean;
  message: string;
}

export interface Connection {
  id: string;
  /** What scripts and tools call it by. */
  name: string;
  type: string;
  /** A draft (made by the AI) can't be used until approved at the console; a disabled connection isn't used. */
  status: ConnectionStatus;
  config: Record<string, string>;
  /** Hosted files that may use it; none listed means every file that isn't capture-only. */
  files?: string[];
  note?: string;
  created: string;
  createdBy: 'console' | 'ai';
  approved?: string;
  lastTest?: ConnectionTest;
}

export interface FieldDef {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** The values a setting can take (the console shows a list); the first is the default. */
  choices?: string[];
}

/** A well-known service a connection type can be pointed at: its settings, and what a person does to get the secrets. */
export interface ConnectionService {
  id: string;
  label: string;
  /** Where the secrets come from, and what to switch on, in a sentence or two. */
  help: string;
  config: Record<string, string>;
}

export interface ConnectionType {
  id: string;
  label: string;
  description: string;
  config: FieldDef[];
  secrets: FieldDef[];
  /** The secrets these settings need, when that depends on them (a REST connection's sign-in kind); every secret otherwise. */
  secretsFor?(config: Record<string, string>): FieldDef[];
  /** Well-known services of this type: the settings that point it at one, for the console and the AI to start from. Never a secret. */
  services?: ConnectionService[];
  /** Settings an AI draft always starts with, whatever it asked for: what only a person should switch on. */
  forAi?: Record<string, string>;
  /** Where the secrets go: when this changes the sealed secrets are cleared, so they are never sent to a place a person didn't type them for. */
  target?(config: Record<string, string>): string;
  /** Fills defaults in and refuses settings that can't work. */
  normalize(config: Record<string, string>): Record<string, string>;
  /** Asks the service something harmless with the connection's credentials. */
  test(c: Connection, secrets: Record<string, string>, io: ConnectionIo): Promise<string>;
  /** The host a request through the connection reaches. */
  host(c: Connection): string;
  /** Every place the connection's secrets can be sent (with the scheme and port), for a person to check before typing them. */
  reach(c: Connection): string[];
  /**
   * A script's request, made with the connection's credentials and kept inside what the connection allows (for S3: its
   * bucket and folder, a few methods and headers). Answers like a web response; throws a ConnectionError that
   * never contains a credential.
   */
  send(c: Connection, secrets: Record<string, string>, io: ConnectionIo, req: ConnectionRequest): Promise<Response>;
}

/** What a connection reaches the network with: swappable for tests. */
export interface ConnectionIo {
  fetch: typeof fetch;
}

/** Settings values that are credentials, wherever someone put them. */
const CREDENTIAL_LOOKING: [RegExp, string][] = [
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/, 'a bearer token'],
  [/\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{20,}/, 'an API key'],
  [/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9/+]{40}$/, 'a secret key'],
  [/\/\/[^\s/:@]+:[^\s/@]+@/, 'a user name and password in an address'],
];

/** What kind of credential a settings value looks like, if any: never the value. */
export function looksLikeCredential(value: string): string | undefined {
  for (const [re, what] of CREDENTIAL_LOOKING) if (re.test(value)) return what;
  return undefined;
}

/**
 * The real network for a connection: no redirect is ever followed (a redirect would carry the signed headers, session
 * token included, to another host), and a name that resolves to a link-local address (a cloud's metadata service) is
 * refused. The connection goes through the shared outbound guard (scripts/src/net-guard.ts); an endpoint on the
 * machine's own network (MinIO on localhost, a mail relay) is a destination the administrator typed in, so it is allowed.
 */
export async function guardedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  try {
    return await guardedRequest(input, { ...init, redirect: 'manual' }, { policy: { private: true } });
  } catch (e) {
    if (e instanceof OutboundRefused) throw new ConnectionError(e.message);
    throw e;
  }
}

// --- types --------------------------------------------------------------------------------------------------

/** Whether a host is plainly a machine of your own: loopback, a private range, a one-word name or a .local/.lan/.internal one. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const v4 = isIP(h) === 6 ? mappedIPv4(h) : isIP(h) === 4 ? h : undefined;
  if (v4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  if (isIP(h) === 6) return h === '::1' || /^f[cd]/.test(h); // loopback and fc00::/7
  if (isIP(h) === 4) return false;
  return h === 'localhost' || !h.includes('.') || /\.(?:local|lan|internal|localhost)$/.test(h);
}

/** A web address a connection reaches, as its origin and path: http only for a machine on your own network, never the cloud metadata range, no credentials in it. */
function webAddress(raw: string | undefined, what: string): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConnectionError(`The ${what} is not a web address (like https://api.example.com)`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ConnectionError(`The ${what} is an http or https address`);
  if (u.username || u.password) throw new ConnectionError(`Put no credentials in the ${what}: keys, tokens and passwords go in their own secret boxes`);
  if (u.search || u.hash) throw new ConnectionError(`The ${what} is just the server's address and path, with no query or #`);
  if (isInternalHost(u.hostname)) throw new ConnectionError(`That ${what} is on the link-local range, where cloud instances keep their credentials (169.254.169.254)`);
  // http only for a machine of your own: loopback, the private ranges, or a name that is plainly local.
  if (u.protocol === 'http:' && !isPrivateHost(u.hostname)) {
    throw new ConnectionError('Use https for a service on the internet; plain http is for a machine on your own network (MinIO on localhost, say)');
  }
  return u.origin + u.pathname.replace(/\/+$/, '');
}
const endpointOf = (raw: string | undefined) => webAddress(raw, 'endpoint');

/** A prefix inside a bucket, as a path of plain parts: no leading or trailing slash, no "..". */
export function cleanPrefix(raw: string | undefined): string {
  const parts = (raw ?? '').split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '.' || p === '..' || /[\\\0]/.test(p))) throw new ConnectionError('The folder in the bucket can\'t contain "..", "." or backslashes');
  return parts.join('/');
}

/** The object key for a path a script gave, kept inside the connection's prefix. */
export function scopedKey(prefix: string, path: string): string {
  const parts = path.split('/').filter((p) => p !== '');
  if (!parts.length) throw new ConnectionError('Name an object, like connection://name/folder/file.pdf');
  if (parts.some((p) => p === '.' || p === '..' || /[\\\0]/.test(p))) throw new ConnectionError('An object path can\'t contain "..", "." or backslashes');
  return [prefix, ...parts].filter(Boolean).join('/');
}

const s3Type: ConnectionType = {
  id: 's3',
  label: 'S3-compatible storage',
  description: 'Amazon S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi or anything that speaks the S3 protocol: store and fetch files and container contents, list a folder.',
  config: [
    { name: 'bucket', label: 'Bucket', required: true, placeholder: 'my-company-files' },
    { name: 'region', label: 'Region', placeholder: 'us-east-1', help: 'Cloudflare R2 takes "auto".' },
    { name: 'endpoint', label: 'Endpoint', placeholder: 'https://<account>.r2.cloudflarestorage.com', help: 'Leave empty for Amazon S3.' },
    { name: 'prefix', label: 'Folder in the bucket', placeholder: 'tabularius/invoices', help: 'Everything this connection reads or writes stays inside this folder.' },
  ],
  secrets: [
    { name: 'accessKey', label: 'Access key ID', required: true },
    { name: 'secretKey', label: 'Secret access key', required: true },
    { name: 'sessionToken', label: 'Session token', help: 'Only for temporary credentials.' },
  ],
  target: (config) => config.endpoint ?? '',
  normalize(config) {
    const bucket = (config.bucket ?? '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/.test(bucket)) throw new ConnectionError('The bucket name is 3 to 63 letters, digits, dots, dashes or underscores');
    const region = (config.region ?? '').trim() || 'us-east-1';
    if (!/^[a-z0-9-]{2,30}$/.test(region)) throw new ConnectionError('The region looks like us-east-1 (or "auto" for Cloudflare R2)');
    const out: Record<string, string> = { bucket, region };
    const endpoint = endpointOf(config.endpoint?.trim());
    if (endpoint) out.endpoint = endpoint;
    const prefix = cleanPrefix(config.prefix);
    if (prefix) out.prefix = prefix;
    return out;
  },
  host(c) {
    return new URL(c.config.endpoint ?? `https://s3.${c.config.region ?? 'us-east-1'}.amazonaws.com`).hostname;
  },
  reach: (c) => [new URL(c.config.endpoint ?? `https://s3.${c.config.region ?? 'us-east-1'}.amazonaws.com`).origin],
  send: sendS3,
  async test(c, secrets, io) {
    const s3 = s3For(c, secrets, io);
    const found = await s3.list(c.config.prefix ? c.config.prefix + '/' : '', 1);
    return `Reached bucket ${c.config.bucket}${c.config.prefix ? ` under ${c.config.prefix}/` : ''}; ${found.length ? 'it has objects there' : 'it is empty there'}.`;
  },
};

/** The S3 client for a connection. Server code only: it holds the secrets. */
export function s3For(c: Connection, secrets: Record<string, string>, io: ConnectionIo): S3 {
  return new S3({
    url: `s3://${c.config.bucket}/${c.config.prefix ?? ''}`,
    accessKey: secrets.accessKey, secretKey: secrets.secretKey,
    ...(secrets.sessionToken ? { sessionToken: secrets.sessionToken } : {}),
    ...(c.config.endpoint ? { endpoint: c.config.endpoint } : {}),
    region: c.config.region ?? 'us-east-1', fetch: io.fetch,
  });
}


// --- a script's requests through an S3 connection -----------------------------------------------------------

/** Request headers a script may add: what describes the object, and conditions on reading it. Never ACLs or copy sources (which reach other buckets). */
const S3_HEADERS = /^(?:content-type|content-disposition|content-encoding|content-language|cache-control|expires|range|if-match|if-none-match|if-modified-since|if-unmodified-since|x-amz-meta-[a-z0-9_.-]+)$/;
/** What a script may ask when listing a folder. */
const S3_LIST_PARAMS = new Set(['list-type', 'prefix', 'delimiter', 'max-keys', 'continuation-token', 'start-after', 'encoding-type']);
/** The most one request sends: S3 takes 5 GB in one PUT, and the body is held in memory. */
const MAX_BODY = 512 * 1024 * 1024;

const xmlEscape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** A listing's keys as the script knows them: without the connection's folder in front. */
function relativeListing(xml: string, prefix: string): string {
  const cut = xmlEscape(prefix + '/');
  return xml.replace(/<(Key|Prefix|StartAfter)>([^<]*)<\/\1>/g, (m, tag: string, v: string) => (v.startsWith(cut) ? `<${tag}>${v.slice(cut.length)}</${tag}>` : m));
}

/**
 * The service's answer as the script sees it. A success is passed on as it is (minus the address that names the bucket
 * and a length that no longer fits). Anything else is rebuilt from its code and message alone: S3's error pages for a
 * bad signature carry the access key ID, the string that was signed and the signed headers, session token included.
 */
async function plain(res: Response, body: BodyInit | null = res.body, hide: readonly string[] = [], s3 = false): Promise<Response> {
  if (!res.ok && !s3) {
    // Any other service: its error as it is, minus the secrets it may echo back.
    let text = await res.text().catch(() => '');
    for (const h of hide) if (h.length >= 6) text = text.split(h).join('***');
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(res.status === 204 || res.status === 304 ? null : text, { status: res.status, statusText: res.statusText, headers });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const grab = (tag: string) => {
      let v = new RegExp(`<${tag}>([^<]{0,300})</${tag}>`).exec(text)?.[1] ?? '';
      for (const h of hide) if (h) v = v.split(h).join('***');
      return v;
    };
    const code = grab('Code');
    const message = grab('Message');
    const headers = new Headers({ 'content-type': 'application/xml' });
    const xml = code || message ? `<Error>${code ? `<Code>${code}</Code>` : ''}${message ? `<Message>${message}</Message>` : ''}</Error>` : '';
    return new Response(res.status === 204 || res.status === 304 ? null : xml, { status: res.status, statusText: res.statusText, headers });
  }
  const headers = new Headers(res.headers);
  if (typeof body === 'string') {
    headers.delete('content-length');
    headers.delete('content-encoding');
  }
  return new Response(res.status === 204 || res.status === 304 ? null : body, { status: res.status, statusText: res.statusText, headers });
}

async function sendS3(c: Connection, secrets: Record<string, string>, io: ConnectionIo, req: ConnectionRequest): Promise<Response> {
  const method = req.method.toUpperCase();
  if (!['GET', 'HEAD', 'PUT', 'DELETE'].includes(method)) throw new ConnectionError(`An S3 connection takes GET, HEAD, PUT and DELETE, not ${method}`);
  if (req.body && req.body.length > MAX_BODY) throw new ConnectionError(`A request through a connection sends at most ${MAX_BODY / 1024 / 1024} MB`);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const name = k.toLowerCase();
    if (!S3_HEADERS.test(name)) throw new ConnectionError(`The header ${name} isn't passed through a connection (content type, cache, range and x-amz-meta-… headers are)`);
    if (!/^[\t\x20-\x7e]*$/.test(v)) throw new ConnectionError(`The value of ${name} is plain printable text: no accents, control characters or line breaks`);
    headers[name] = v;
  }
  const prefix = c.config.prefix ?? '';
  const s3 = s3For(c, secrets, io);
  const hide = [secrets.accessKey, secrets.secretKey, secrets.sessionToken].filter((x): x is string => !!x);
  const query = [...new URLSearchParams(req.query).entries()];
  const segments = (req.path || '/').split('/').filter((x) => x !== '');
  if (!segments.length) {
    // The folder itself: listing it is all there is to do.
    if (method !== 'GET') throw new ConnectionError('Name an object, like connection://name/folder/file.pdf');
    const params = new Map<string, string>();
    for (const [k, v] of query) {
      if (!S3_LIST_PARAMS.has(k)) throw new ConnectionError(`${k} isn't a listing option (prefix, delimiter, max-keys, start-after, or the continuation marker)`);
      params.set(k, v);
    }
    params.set('list-type', '2');
    const inside = (v: string) => [prefix, ...cleanPrefix(v).split('/')].filter(Boolean).join('/') + (v.endsWith('/') || (!v && prefix) ? '/' : '');
    params.set('prefix', inside(params.get('prefix') ?? ''));
    if (params.has('start-after')) params.set('start-after', inside(params.get('start-after')!).replace(/\/$/, ''));
    const res = await s3.raw('GET', undefined, { query: [...params], ...(req.signal ? { signal: req.signal } : {}) });
    if (!prefix || !res.ok) return plain(res, res.body, hide, true);
    return plain(res, relativeListing(await res.text(), prefix));
  }
  for (const [k] of query) if (k !== 'versionId' || (method !== 'GET' && method !== 'HEAD')) throw new ConnectionError(`${k} isn't an option for ${method} on an object`);
  let key: string;
  try {
    key = scopedKey(prefix, segments.map((x) => decodeURIComponent(x)).join('/'));
  } catch (e) {
    throw e instanceof ConnectionError ? e : new ConnectionError('The object path isn\'t valid');
  }
  return plain(await s3.raw(method, key, { query, ...(req.body ? { body: req.body } : {}), headers, ...(req.signal ? { signal: req.signal } : {}) }), undefined, hide, true);
}

/**
 * The connections as scripts use them (Insert from URL with connection://name/path). Server code only: it is the one
 * place that opens a connection's secrets for a request, and it hands back only the service's answer. Every file the
 * script run involves must be one the connection allows, and none may be capture-only.
 */
export function scriptConnections(c: Connections, opts: { captureOnly?: () => readonly string[] } = {}): ScriptConnections {
  const type = (id: string) => CONNECTION_TYPES.find((t) => t.id === id)!;
  return {
    host(name) {
      try {
        const x = c.get(name);
        return x.status === 'active' ? type(x.type).host(x) : undefined;
      } catch {
        return undefined;
      }
    },
    async request(name, req, files) {
      const held = files.find((f) => captureOnly(f, opts.captureOnly?.() ?? []));
      if (held !== undefined) throw new ConnectionError(`"${held}" is capture-only: its scripts never get a connection`);
      const { connection, secrets, io } = c.use(name, files);
      return type(connection.type).send(connection, secrets, io, req);
    },
  };
}

// --- REST: any web API, with the sign-in kept on the server --------------------------------------------------

const REST_AUTH = ['none', 'bearer', 'basic', 'header', 'oauth2', 'oauth2-refresh'];
/** The OAuth 2 kinds: a token address, an optional scope, tokens fetched on the server. */
const isOauth = (auth: string | undefined) => auth === 'oauth2' || auth === 'oauth2-refresh';
/** Headers a script may not set on a REST request: the connection signs in itself, and the rest are the transport's. */
const REST_BLOCKED_HEADERS = /^(?:authorization|proxy-authorization|cookie|host|content-length|transfer-encoding|connection|upgrade|te|trailer|x-forwarded-.*|forwarded|x-real-ip|x-(?:tabularius|openhbam)-.*|x-http-method(?:-override)?|x-method-override|x-original-url|x-rewrite-url)$/;
const REST_SECRETS: Record<string, FieldDef[]> = {
  none: [],
  bearer: [{ name: 'token', label: 'Token', required: true }],
  basic: [{ name: 'username', label: 'User name', required: true }, { name: 'password', label: 'Password', required: true }],
  header: [{ name: 'apiKey', label: 'API key', required: true }],
  oauth2: [{ name: 'clientId', label: 'Client ID', required: true }, { name: 'clientSecret', label: 'Client secret', required: true }],
  'oauth2-refresh': [
    { name: 'clientId', label: 'Client ID', required: true },
    { name: 'clientSecret', label: 'Client secret', required: true },
    { name: 'refreshToken', label: 'Refresh token', required: true },
  ],
};

/** Services that sign in with an OAuth 2 refresh token. A person gets the token once from the service and types it in the console. */
const REST_SERVICES: ConnectionService[] = [
  {
    id: 'google-drive',
    label: 'Google Drive (files and folders)',
    help: 'Make an OAuth client in Google Cloud (APIs & Services > Credentials), then get a refresh token for the Drive scope below once (for example with the OAuth 2.0 Playground, using your own client). Ask for that one scope only: the connection is limited to the Drive address, but the refresh token decides what Google lets it do. Type the client ID, client secret and refresh token here. Deleting needs Allowed: write. Uploading goes through Google Drive (upload).',
    config: { baseUrl: 'https://www.googleapis.com/drive/v3', auth: 'oauth2-refresh', tokenUrl: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', testPath: '/about?fields=user' },
  },
  {
    id: 'google-drive-upload',
    label: 'Google Drive (upload)',
    help: 'The same Google client, refresh token and scope as Google Drive (files and folders), for uploading file contents. It needs its own connection because Google serves uploads from another path. Allowed has to be write.',
    config: { baseUrl: 'https://www.googleapis.com/upload/drive/v3', auth: 'oauth2-refresh', tokenUrl: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', access: 'write' },
  },
  {
    id: 'dropbox',
    label: 'Dropbox (folders, search, sharing)',
    help: 'Make an app in the Dropbox App Console, authorize it once with token_access_type=offline to get a refresh token, and type the app key (client ID), app secret and refresh token here. Dropbox answers every call with POST, so Allowed has to be write. File contents go through the Dropbox (file contents) service.',
    config: { baseUrl: 'https://api.dropboxapi.com/2', auth: 'oauth2-refresh', tokenUrl: 'https://api.dropboxapi.com/oauth2/token', access: 'write' },
  },
  {
    id: 'dropbox-files',
    label: 'Dropbox (file contents)',
    help: 'The same Dropbox app and keys as Dropbox (folders, search, sharing), for uploading and downloading file contents. Needs its own connection because Dropbox serves contents from another address. Allowed has to be write.',
    config: { baseUrl: 'https://content.dropboxapi.com/2', auth: 'oauth2-refresh', tokenUrl: 'https://api.dropboxapi.com/oauth2/token', access: 'write' },
  },
  {
    id: 'microsoft-onedrive',
    label: 'Microsoft OneDrive (Microsoft Graph)',
    help: 'Register an app in Microsoft Entra (Azure), authorize it once with the offline_access scope to get a refresh token, and type the application (client) ID, client secret and refresh token here. Replace "common" in the token address with your tenant ID for a work or school account. Upload and delete need Allowed: write.',
    config: { baseUrl: 'https://graph.microsoft.com/v1.0', auth: 'oauth2-refresh', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'Files.ReadWrite offline_access', testPath: '/me/drive' },
  },
];

const restType: ConnectionType = {
  id: 'rest',
  label: 'Web service (REST API)',
  description: 'Any web API: a base address and how to sign in (a token, a user name and password, an API key header, OAuth 2 client credentials, or an OAuth 2 refresh token as Google Drive, Dropbox and OneDrive use). Scripts call it with Insert from URL; the credentials are added on the server.',
  config: [
    { name: 'baseUrl', label: 'Base address', required: true, placeholder: 'https://api.example.com/v1', help: 'Every call goes below this address.' },
    { name: 'auth', label: 'Sign-in', choices: REST_AUTH, help: 'none, bearer (a token), basic (user name and password), header (an API key in a header), oauth2 (client credentials) or oauth2-refresh (a refresh token a person got once from the service: how Google Drive, Dropbox and OneDrive sign in).' },
    { name: 'headerName', label: 'API key header', placeholder: 'X-API-Key', help: 'For sign-in "header".' },
    { name: 'tokenUrl', label: 'OAuth token address', placeholder: 'https://auth.example.com/oauth/token', help: 'For sign-in "oauth2" and "oauth2-refresh".' },
    { name: 'scope', label: 'OAuth scope', help: 'For sign-in "oauth2" and "oauth2-refresh", when the service wants one.' },
    { name: 'access', label: 'Allowed', choices: ['read', 'write'], help: 'read: GET and HEAD only. write: also POST, PUT, PATCH and DELETE.' },
    { name: 'testPath', label: 'Path to test', placeholder: '/me', help: 'A harmless GET that needs the sign-in, so Test can check it.' },
  ],
  services: REST_SERVICES,
  secrets: Object.values(REST_SECRETS).flat().filter((f, i, all) => all.findIndex((x) => x.name === f.name) === i),
  secretsFor: (config) => REST_SECRETS[config.auth ?? 'none'] ?? [],
  normalize(config) {
    const out: Record<string, string> = {};
    const base = webAddress(config.baseUrl?.trim(), 'base address');
    if (!base) throw new ConnectionError('Give the base address, like https://api.example.com/v1');
    out.baseUrl = base;
    const auth = (config.auth ?? '').trim() || 'none';
    if (!REST_AUTH.includes(auth)) throw new ConnectionError(`Sign-in is one of ${REST_AUTH.join(', ')}`);
    out.auth = auth;
    if (auth === 'header') {
      const name = (config.headerName ?? '').trim() || 'X-API-Key';
      if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || /^(?:host|content-length|transfer-encoding|connection|cookie|upgrade)$/i.test(name)) throw new ConnectionError('The API key header is a header name like X-API-Key');
      out.headerName = name;
    } else if (config.headerName?.trim()) throw new ConnectionError('The API key header is only for sign-in "header"');
    if (isOauth(auth)) {
      const tokenUrl = webAddress(config.tokenUrl?.trim(), 'token address');
      if (!tokenUrl) throw new ConnectionError('OAuth 2 needs the token address, like https://auth.example.com/oauth/token');
      out.tokenUrl = tokenUrl;
      const scope = (config.scope ?? '').trim();
      if (scope) {
        if (!/^[A-Za-z0-9:._/ -]{1,200}$/.test(scope)) throw new ConnectionError('The OAuth scope is words like "read write" or "orders:read"');
        out.scope = scope;
      }
    } else if (config.tokenUrl?.trim() || config.scope?.trim()) throw new ConnectionError('The token address and scope are only for sign-in "oauth2" and "oauth2-refresh"');
    const access = (config.access ?? '').trim() || 'read';
    if (access !== 'read' && access !== 'write') throw new ConnectionError('Allowed is read or write');
    out.access = access;
    const testPath = (config.testPath ?? '').trim();
    if (testPath) {
      if (!testPath.startsWith('/') || /[\s#\\]/.test(testPath) || testPath.split('?')[0].split('/').some((x) => x === '..')) throw new ConnectionError('The path to test starts with / and has no spaces, #, backslashes or ".."');
      out.testPath = testPath;
    }
    return out;
  },
  target: (config) => JSON.stringify([config.baseUrl, config.auth ?? '', config.tokenUrl ?? '']),
  host: (c) => new URL(c.config.baseUrl).hostname,
  // The token address too: OAuth 2 sends the client id and secret there, which can be another host than the API.
  reach: (c) => [...new Set([new URL(c.config.baseUrl).origin, ...(isOauth(c.config.auth) && c.config.tokenUrl ? [new URL(c.config.tokenUrl).origin] : [])])],
  // What only a person should switch on: an AI draft can read, never write.
  forAi: { access: 'read' },
  send: sendRest,
  async test(c, secrets, io) {
    const host = new URL(c.config.baseUrl).hostname;
    const res = await sendRest(c, secrets, io, { method: 'GET', path: '', query: '', headers: {} }, c.config.testPath);
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 && !c.config.testPath) return `Reached ${host}, which answered 404 for its base address. Set a path to test to check the sign-in`;
    if (res.status >= 400) throw new ConnectionError(`${host} answered ${res.status}${res.status === 401 || res.status === 403 ? ': it refused the sign-in' : ''}`);
    return `Reached ${host}${c.config.testPath ?? ''}: it answered ${res.status}${c.config.auth === 'none' ? '' : ' with the sign-in'}.`;
  },
};

/** OAuth 2 tokens (client credentials, or a refresh token's), kept until shortly before they expire; per connection and credentials, never written anywhere. */
const oauthTokens = new Map<string, { token: string; until: number }>();

async function oauthToken(c: Connection, secrets: Record<string, string>, io: ConnectionIo): Promise<string> {
  const key = `${c.id}|${createHash('sha256').update([c.config.auth, c.config.tokenUrl, c.config.scope, secrets.clientId, secrets.clientSecret, secrets.refreshToken ?? ''].join('\0')).digest('hex')}`;
  const have = oauthTokens.get(key);
  if (have && have.until > performance.now()) return have.token;
  const body = new URLSearchParams({
    ...(c.config.auth === 'oauth2-refresh' ? { grant_type: 'refresh_token', refresh_token: secrets.refreshToken } : { grant_type: 'client_credentials' }),
    ...(c.config.scope ? { scope: c.config.scope } : {}),
  });
  let res: Response;
  try {
    res = await io.fetch(c.config.tokenUrl, {
      method: 'POST', redirect: 'manual', body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(secrets.clientId)}:${encodeURIComponent(secrets.clientSecret)}`).toString('base64'), accept: 'application/json' },
    });
  } catch (e) {
    throw new ConnectionError(`The token service couldn't be reached: ${(e as Error).message}`);
  }
  let doc: { access_token?: unknown; expires_in?: unknown; error?: unknown } = {};
  try {
    const text = await res.text();
    if (text.length <= 64 * 1024) doc = JSON.parse(text);
  } catch {
    // not JSON, or too long to be a token answer
  }
  if (!res.ok || typeof doc.access_token !== 'string' || !doc.access_token || doc.access_token.length > 8192) {
    // The service's error code, never its description (which can echo what was sent).
    const code = typeof doc.error === 'string' && /^[a-z_]{1,40}$/.test(doc.error) ? ` (${doc.error})` : '';
    throw new ConnectionError(`The token service answered ${res.status}${code} and gave no token`);
  }
  const seconds = Number(doc.expires_in);
  oauthTokens.set(key, { token: doc.access_token, until: performance.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 300) * 1000 - 30_000 });
  if (oauthTokens.size > 500) oauthTokens.delete(oauthTokens.keys().next().value!);
  return doc.access_token;
}

async function sendRest(c: Connection, secrets: Record<string, string>, io: ConnectionIo, req: ConnectionRequest, fixedPath?: string): Promise<Response> {
  const method = req.method.toUpperCase();
  const allowed = c.config.access === 'write' ? ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] : ['GET', 'HEAD'];
  if (!allowed.includes(method)) {
    throw new ConnectionError(`${c.name} allows ${allowed.join(', ')}${c.config.access === 'write' ? '' : ' (a person can set it to write in the console)'}, not ${method}`);
  }
  if (req.body && req.body.length > MAX_BODY) throw new ConnectionError(`A request through a connection sends at most ${MAX_BODY / 1024 / 1024} MB`);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const name = k.toLowerCase();
    if (REST_BLOCKED_HEADERS.test(name) || name === (c.config.headerName ?? '').toLowerCase()) throw new ConnectionError(`The header ${name} is set by the connection, not by a script`);
    if (!/^[a-z0-9-]{1,64}$/.test(name) || /[\r\n\0]/.test(v)) throw new ConnectionError(`${k} isn't a header a connection can send`);
    headers[name] = v;
  }
  const base = new URL(c.config.baseUrl);
  const path = fixedPath ?? req.path;
  // A path is plain characters, already encoded: a tab or line break inside a "." part would be dropped by the URL parser.
  if (/[\x00-\x20\x7f]/.test(path.split('?')[0])) throw new ConnectionError('The path can\'t contain spaces or control characters (encode them, like %20)');
  const segments = path.split('?')[0].split('/').filter((x) => x !== '');
  for (const seg of segments) {
    let plain: string;
    try {
      plain = decodeURIComponent(seg);
    } catch {
      throw new ConnectionError('The path isn\'t valid');
    }
    // ("..;" is a parent folder to some servers, which drop what follows the semicolon.)
    const bare = plain.split(';')[0];
    if (bare === '.' || bare === '..' || /[\\/\0]/.test(plain)) throw new ConnectionError('A path can\'t contain "..", "." or slashes inside a part');
    // And as the URL parser will read it: still one ordinary part.
    const parsed = new URL('http://h/' + seg).pathname;
    if (parsed.split('/').length !== 2 || parsed === '/' || parsed === '/.' || parsed === '/..') throw new ConnectionError('The path isn\'t valid');
  }
  const query = fixedPath?.includes('?') ? fixedPath.slice(fixedPath.indexOf('?')) : req.query;
  if (/[#\x00-\x1f\x7f]/.test(query)) throw new ConnectionError('The query isn\'t valid');
  const url = `${base.origin}${base.pathname.replace(/\/$/, '')}${segments.length ? '/' + segments.join('/') : ''}${path.endsWith('/') && segments.length ? '/' : ''}${query}`;
  // Whatever the parser made of it, it is still this service's address, below its base path.
  const target = new URL(url);
  const basePath = base.pathname.replace(/\/$/, '');
  if (target.origin !== base.origin || (target.pathname !== basePath && !target.pathname.startsWith(basePath + '/'))) throw new ConnectionError('The path isn\'t valid');
  // What a service may echo back and a script must not see: the secrets, and an access token made from them.
  const hide: string[] = [...Object.values(secrets), ...(c.config.auth === 'basic' ? [Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64')] : [])];
  switch (c.config.auth) {
    case 'bearer': headers.authorization = `Bearer ${secrets.token}`; break;
    case 'basic': headers.authorization = 'Basic ' + Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64'); break;
    case 'header': headers[(c.config.headerName ?? 'X-API-Key').toLowerCase()] = secrets.apiKey; break;
    case 'oauth2':
    case 'oauth2-refresh': {
      const token = await oauthToken(c, secrets, io);
      headers.authorization = `Bearer ${token}`;
      hide.push(token);
      break;
    }
    default: break;
  }
  // Redirects are not followed: the sign-in would go wherever a service pointed it. The script sees the 3xx.
  return plain(await io.fetch(url, { method, headers, redirect: 'manual', ...(req.body ? { body: new Uint8Array(req.body) } : {}), ...(req.signal ? { signal: req.signal } : {}) }), undefined, hide);
}

// --- mail (SMTP) ----------------------------------------------------------------------------------------------

/** One plain address: no display name, list or anything a header could be split on. */
const MAIL_ADDRESS = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+$/;

/** Most recipients one message through an email connection may name when its settings say nothing. */
export const MAIL_RECIPIENTS_DEFAULT = 20;

const smtpType: ConnectionType = {
  id: 'smtp',
  label: 'Email (SMTP)',
  description: 'An outgoing mail account. Send Mail via SMTP steps can use it, from the address set here, when it is marked for them; the user name and password stay on the server.',
  config: [
    { name: 'host', label: 'Mail server', required: true, placeholder: 'smtp.example.com' },
    { name: 'security', label: 'Connection', choices: ['starttls', 'tls'], help: 'starttls: port 587, encrypted after hello. tls: port 465, encrypted from the start. A server on this machine may use neither.' },
    { name: 'port', label: 'Port', placeholder: '587', help: 'Leave empty for the usual port of the connection kind.' },
    { name: 'from', label: 'Send mail from', required: true, placeholder: 'invoices@example.com', help: 'The one address mail goes out as. Scripts choose the recipients and the name shown, never this address.' },
    { name: 'recipients', label: 'Most recipients in one message', placeholder: '20', help: `To, CC and BCC together; a message naming more is not sent. 20 when empty, at most ${MAIL_RECIPIENT_LIMIT}. A script looping a found set into one message stops here.` },
    { name: 'mail', label: 'Send Mail steps use it', choices: ['no', 'yes'], help: 'yes: Send Mail via SMTP steps in scripts send through this account (the oldest one marked yes that the file may use). A connection the AI drafts always starts at no. Test mode, when the server runs in it, still keeps mail in its outbox.' },
  ],
  secrets: [
    { name: 'username', label: 'User name', required: true },
    { name: 'password', label: 'Password', required: true },
  ],
  normalize(config) {
    // The host as the URL parser reads it, so every spelling of an address (2852039166, 0xa9fea9fe, 0:0:0:0:0:ffff:a9fe:a9fe) is judged as the address it is.
    const typed = (config.host ?? '').trim().toLowerCase().replace(/\.$/, '');
    let host = '';
    try {
      if (/^[a-z0-9.:\-]+$/.test(typed)) host = new URL(`http://${typed.includes(':') ? `[${typed}]` : typed}`).hostname.replace(/^\[|\]$/g, '');
    } catch {
      host = '';
    }
    if (!host || (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host) && isIP(host) === 0) || (/^[0-9.]+$/.test(host) && isIP(host) !== 4)) throw new ConnectionError('The mail server is a name like smtp.example.com');
    if (isInternalHost(host)) throw new ConnectionError('That mail server is on the link-local range, where cloud instances keep their credentials (169.254.169.254)');
    const security = (config.security ?? '').trim() || 'starttls';
    if (security !== 'starttls' && security !== 'tls') throw new ConnectionError('Connection is starttls or tls');
    const port = (config.port ?? '').trim();
    if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new ConnectionError('The port is a number from 1 to 65535');
    // A mail server on the internet listens where mail servers do; any port is for a machine of your own.
    if (port && !isPrivateHost(host) && !['25', '465', '587', '2525'].includes(port)) throw new ConnectionError('A mail server on the internet uses port 25, 465, 587 or 2525');
    const from = (config.from ?? '').trim();
    if (!MAIL_ADDRESS.test(from)) throw new ConnectionError('Send mail from is one email address, like invoices@example.com');
    const mail = (config.mail ?? '').trim() || 'no';
    if (mail !== 'yes' && mail !== 'no') throw new ConnectionError('Send Mail steps use it is yes or no');
    const recipients = (config.recipients ?? '').trim();
    if (recipients && (!/^\d{1,3}$/.test(recipients) || Number(recipients) < 1 || Number(recipients) > MAIL_RECIPIENT_LIMIT)) throw new ConnectionError(`Most recipients in one message is a number from 1 to ${MAIL_RECIPIENT_LIMIT}`);
    return { host, security, ...(port ? { port } : {}), from, ...(recipients ? { recipients: String(Number(recipients)) } : {}), mail };
  },
  target: (config) => JSON.stringify([config.host, config.port ?? '', config.security]),
  forAi: { mail: 'no', recipients: String(MAIL_RECIPIENTS_DEFAULT) },
  host: (c) => c.config.host,
  reach: (c) => [`${c.config.host}:${c.config.port ?? (c.config.security === 'tls' ? '465' : '587')} (${c.config.security})`],
  async send() {
    throw new ConnectionError('An email connection is used by Send Mail steps, not by Insert from URL');
  },
  async test(c, secrets) {
    try {
      await checkLogin(smtpAccount(c, secrets));
    } catch (e) {
      throw new ConnectionError(`${c.config.host} refused the sign-in or could not be reached: ${maskSecrets((e as Error).message, Object.values(secrets))}`);
    }
    return `Signed in to ${c.config.host} as the account for ${c.config.from}. Nothing was sent.`;
  },
};

/** The recipient cap of an email connection: its setting, else the default. */
export function mailRecipientLimit(c: Connection): number {
  const n = Number(c.config.recipients);
  return Number.isInteger(n) && n >= 1 && n <= MAIL_RECIPIENT_LIMIT ? n : MAIL_RECIPIENTS_DEFAULT;
}

/** The SMTP account of a mail connection, for the mail transport. Server code only: it holds the password. */
export function smtpAccount(c: Connection, secrets: Record<string, string>): SmtpConfig {
  if (!secrets.username || !secrets.password) throw new ConnectionError(`The connection ${c.name} has no user name or password set`);
  const secure = c.config.security === 'tls';
  const host = c.config.host.includes(':') ? `[${c.config.host}]` : c.config.host;
  return { url: `${secure ? 'smtps' : 'smtp'}://${encodeURIComponent(secrets.username)}:${encodeURIComponent(secrets.password)}@${host}:${c.config.port || (secure ? 465 : 587)}` };
}

/** Text with every secret in it (as typed, in any case, and as base64 or URL-encoded) replaced by ***: for a service that echoes what it was sent. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const v of secrets) {
    if (!v) continue;
    for (const form of new Set([v, encodeURIComponent(v), Buffer.from(v).toString('base64')])) {
      out = out.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
    }
  }
  return out;
}

/** What a script (and so the person running it) is told about a mail failure: the server's answer when it is plainly about the message, never what it might echo of the sign-in. */
export function mailFailure(message: string, secrets: readonly string[]): string {
  const code = /^SMTP: (\d{3})\b/.exec(message)?.[1];
  if (code && ['530', '534', '535', '538'].includes(code)) return `the mail server refused the sign-in (${code})`;
  if (code) return maskSecrets(message, secrets).slice(0, 300);
  if (/^(?:"[^"]*" is not an email address|the message has no recipients|the message names \d+ recipients)/.test(message)) return message;
  if (/^the SMTP server (offers no STARTTLS|took too long|sent too much|closed|stopped answering)/.test(message)) return message;
  return 'the mail server could not be reached';
}

export const CONNECTION_TYPES: ConnectionType[] = [s3Type, restType, smtpType];

// --- the vault ----------------------------------------------------------------------------------------------

/** Secrets sealed on disk. A name like "<connection id>/<field>" is also what is bound into each seal. */
class Vault {
  private readonly file: string;
  private readonly keyFile: string;
  private key?: Buffer;
  private items: Record<string, string> = {};
  private salt?: string;
  private seen?: { mtimeMs: number; size: number };
  /** Why the secrets can't be read (a wrong or missing passphrase); the server stays up without them. */
  problem?: string;

  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, SECRETS_FILE);
    this.keyFile = join(dir, KEY_FILE);
  }

  private passphrase(): string | undefined {
    return process.env.TABULARIUS_SECRETS_KEY || process.env.TABULARIUS_ENCRYPTION_KEY || undefined;
  }

  private seal(ref: string, value: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key!, iv);
    c.setAAD(Buffer.from(ref));
    const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
  }

  private open(ref: string, sealed: string): string {
    const raw = Buffer.from(sealed, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key!, raw.subarray(0, 12));
    d.setAAD(Buffer.from(ref));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }

  /** Reads the file again if it changed (another process of a cluster may have written it), and makes the key. */
  private load(): void {
    let st;
    try {
      st = statSync(this.file);
    } catch {
      st = undefined;
    }
    if (this.key && (st ? this.seen?.mtimeMs === st.mtimeMs && this.seen.size === st.size : !this.seen)) return;
    this.problem = undefined;
    this.items = {};
    this.seen = st ? { mtimeMs: st.mtimeMs, size: st.size } : undefined;
    let doc: { salt?: string; items?: Record<string, string>; check?: string } = {};
    if (st) {
      try {
        doc = readJsonStateSync(this.file);
      } catch {
        this.key = undefined;
        this.problem = `${SECRETS_FILE} can't be read (it isn't JSON); restore it from a backup`;
        return;
      }
    }
    const pass = this.passphrase();
    if (doc.salt && !pass) {
      this.key = undefined;
      this.problem = 'The connections\' secrets were sealed with a passphrase: start the server with TABULARIUS_SECRETS_KEY set to it';
      return;
    }
    if (pass) {
      this.salt = doc.salt ?? randomBytes(16).toString('base64');
      this.key = scryptSync(pass, Buffer.from(this.salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
    } else {
      this.salt = undefined;
      if (existsSync(this.keyFile)) {
        if (process.platform !== 'win32' && statSync(this.keyFile).mode & 0o077) {
          this.key = undefined;
          this.problem = `${KEY_FILE} can be read by other users (chmod 600)`;
          return;
        }
        this.key = Buffer.from(readFileSync(this.keyFile, 'utf8').trim(), 'hex');
        if (this.key.length !== 32) {
          this.key = undefined;
          this.problem = `${KEY_FILE} is damaged`;
          return;
        }
      } else if (!st) {
        // Nothing sealed yet: make the key on first use, in write().
        this.key = undefined;
        return;
      } else {
        this.key = undefined;
        this.problem = `${KEY_FILE} is missing, so the secrets in ${SECRETS_FILE} can't be opened`;
        return;
      }
    }
    if (doc.check) {
      try {
        if (this.open('check', doc.check) !== 'openhbam-connections') throw new Error();
      } catch {
        this.key = undefined;
        this.problem = 'The key doesn\'t open the connections\' secrets (a different passphrase or key file than they were sealed with)';
        return;
      }
    }
    this.items = doc.items ?? {};
  }

  private ready(forWrite: boolean): void {
    this.load();
    if (this.problem) throw new ConnectionError(this.problem);
    if (!this.key && forWrite) {
      // First secret ever, with no passphrase: a random key file beside it.
      const pass = this.passphrase();
      if (pass) {
        this.salt = randomBytes(16).toString('base64');
        this.key = scryptSync(pass, Buffer.from(this.salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
      } else {
        const key = randomBytes(32);
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.keyFile, key.toString('hex') + '\n', { mode: 0o600 });
        chmodSync(this.keyFile, 0o600);
        this.key = key;
      }
    }
  }

  has(ref: string): boolean {
    try {
      this.load();
    } catch {
      return false;
    }
    return ref in this.items;
  }

  /** Server code only. */
  get(ref: string): string | undefined {
    this.ready(false);
    const sealed = this.items[ref];
    if (sealed === undefined) return undefined;
    if (!this.key) throw new ConnectionError('The connections\' secrets can\'t be opened');
    try {
      return this.open(ref, sealed);
    } catch {
      throw new ConnectionError(`The secret ${ref.split('/')[1]} can't be opened: the secrets file was changed or sealed with another key`);
    }
  }

  set(ref: string, value: string | undefined): void {
    withStateLock(this.file, () => {
      this.ready(true);
      const items = { ...this.items };
      if (value === undefined) delete items[ref];
      else items[ref] = this.seal(ref, value);
      this.write(items, (latest) => {
        const merged = { ...latest };
        if (value === undefined) delete merged[ref];
        else merged[ref] = items[ref];
        return merged;
      });
    });
  }

  /** Drops every secret whose reference starts with this (a removed connection's). */
  dropPrefix(prefix: string): void {
    withStateLock(this.file, () => {
      this.load();
      if (!Object.keys(this.items).some((r) => r.startsWith(prefix))) return;
      this.ready(true);
      this.write(this.items, (latest) => Object.fromEntries(Object.entries(latest).filter(([r]) => !r.startsWith(prefix))));
    });
  }

  private write(items: Record<string, string>, merge: (latest: Record<string, string>) => Record<string, string>): void {
    const doc = { version: 1, ...(this.salt ? { salt: this.salt } : {}), check: this.seal('check', 'openhbam-connections'), items };
    const saved = updateJsonStateSync(this.file, doc, (current) => ({ ...current, items: merge(current.items ?? {}) }), { mode: 0o600 });
    this.items = saved.items;
    const st = statSync(this.file);
    this.seen = { mtimeMs: st.mtimeMs, size: st.size };
  }
}

// --- the store ----------------------------------------------------------------------------------------------

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export class Connections {
  private readonly file: string;
  private readonly vault: Vault;
  private list_: Connection[] = [];
  private seen?: { mtimeMs: number; size: number };
  private readonly log: (m: string) => void;
  /** Swappable for tests. */
  io: ConnectionIo = { fetch: guardedFetch };

  readonly dir: string;

  constructor(dir: string, log: (m: string) => void = () => {}) {
    this.dir = dir;
    this.file = join(dir, CONNECTIONS_FILE);
    this.vault = new Vault(dir);
    this.log = log;
    this.reload();
  }

  private reload(): void {
    let st;
    try {
      st = statSync(this.file);
    } catch {
      this.list_ = [];
      this.seen = undefined;
      return;
    }
    if (this.seen?.mtimeMs === st.mtimeMs && this.seen.size === st.size) return;
    this.seen = { mtimeMs: st.mtimeMs, size: st.size };
    try {
      const v = (readJsonStateSync<{ connections?: Connection[] }>(this.file)).connections;
      this.list_ = Array.isArray(v) ? v : [];
    } catch (e) {
      this.log(`connections: can't read ${CONNECTIONS_FILE}: ${(e as Error).message}`);
      this.list_ = [];
    }
  }

  private save(changed?: Connection, removedId?: string, create = false, testOnly = false): void {
    const saved = updateJsonStateSync<{ connections: Connection[] }>(this.file, { connections: [] }, (current) => {
      const connections = current.connections ?? [];
      if (removedId) return { connections: connections.filter((c) => c.id !== removedId) };
      if (!changed) return { connections };
      const exists = connections.some((c) => c.id === changed.id);
      if (!exists) return { connections: create ? [...connections, changed] : connections };
      return { connections: connections.map((c) => {
        if (c.id !== changed.id) return c;
        if (!testOnly) return changed;
        if (c.type !== changed.type || JSON.stringify(c.config) !== JSON.stringify(changed.config)) return c;
        return { ...c, lastTest: changed.lastTest };
      }) };
    }, { mode: 0o600 });
    this.list_ = saved.connections;
    const st = statSync(this.file);
    this.seen = { mtimeMs: st.mtimeMs, size: st.size };
  }

  private type(id: string): ConnectionType {
    const t = CONNECTION_TYPES.find((x) => x.id === id);
    if (!t) throw new ConnectionError(`There is no connection type "${id}" (${CONNECTION_TYPES.map((x) => x.id).join(', ')})`);
    return t;
  }

  private find(idOrName: string): Connection {
    this.reload();
    const c = this.list_.find((x) => x.id === idOrName) ?? this.list_.find((x) => x.name.toLowerCase() === idOrName.toLowerCase());
    if (!c) throw new ConnectionError(`There is no connection "${idOrName}"`);
    return c;
  }

  private ref = (c: Connection, field: string) => `${c.id}/${field}`;

  /** The secrets a connection needs now (some types need different ones for different settings). */
  private secretFields(c: Connection): FieldDef[] {
    const t = this.type(c.type);
    return t.secretsFor ? t.secretsFor(c.config) : t.secrets;
  }

  /** The connection types, for the console's form. */
  types(): { id: string; label: string; description: string; config: FieldDef[]; secrets: FieldDef[]; services: ConnectionService[] }[] {
    return CONNECTION_TYPES.map(({ id, label, description, config, secrets, services }) => ({ id, label, description, config, secrets, services: services ?? [] }));
  }

  /** Connections for display: which secrets are set, never what they are. */
  list(): (Connection & { secrets: { name: string; label: string; required: boolean; set: boolean }[]; ready: boolean })[] {
    this.reload();
    return this.list_.map((c) => this.shown(c));
  }

  get(idOrName: string): ReturnType<Connections['shown']> {
    return this.shown(this.find(idOrName));
  }

  /** Every place a connection's secrets can go (scheme, host and port), for a person to check before typing keys for it. */
  reaches(idOrName: string): string[] {
    const c = this.find(idOrName);
    try {
      return this.type(c.type).reach(c);
    } catch {
      return [];
    }
  }

  private shown(c: Connection) {
    const secrets = this.secretFields(c).map((f) => ({ name: f.name, label: f.label, required: f.required === true, set: this.vault.has(this.ref(c, f.name)) }));
    return { ...c, secrets, ready: secrets.every((s) => s.set || !s.required) };
  }

  /** Why the secrets can't be used, if they can't (a missing passphrase). */
  get problem(): string | undefined {
    this.vault.has('x');
    return this.vault.problem;
  }

  create(input: { name?: unknown; type?: unknown; config?: unknown; files?: unknown; note?: unknown }, by: 'console' | 'ai' = 'console'): Connection {
    this.reload();
    const name = String(input.name ?? '').trim();
    if (!NAME.test(name)) throw new ConnectionError('Name it with letters, digits, dashes or underscores, starting with a letter (like invoices-bucket)');
    if (this.list_.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new ConnectionError(`There is already a connection named ${name}`);
    const t = this.type(String(input.type ?? ''));
    const config = { ...this.settings(t, input.config), ...(by === 'ai' ? t.forAi ?? {} : {}) };
    const c: Connection = {
      id: randomBytes(6).toString('hex'), name, type: t.id, status: 'draft', config,
      ...(this.fileList(input.files) ? { files: this.fileList(input.files) } : {}),
      ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
      created: new Date().toISOString(), createdBy: by,
    };
    this.list_.push(c);
    this.save(c, undefined, true);
    this.log(`connection ${name} (${t.id}) created${by === 'ai' ? ' as a draft by the AI' : ' from the console'}`);
    return c;
  }

  private settings(t: ConnectionType, raw: unknown): Record<string, string> {
    if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConnectionError('config is an object of the connection\'s settings');
    const given: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!t.config.some((f) => f.name === k)) {
        if (t.secrets.some((f) => f.name === k)) throw new ConnectionError(`${k} is a secret: it is typed into the console, not given here`);
        throw new ConnectionError(`${t.label} has no setting called ${k}`);
      }
      if (typeof v !== 'string') throw new ConnectionError(`${k} is text`);
      const what = looksLikeCredential(v);
      if (what) throw new ConnectionError(`The ${k} setting looks like ${what}. Secrets are typed into the console's secret boxes, never given as a setting`);
      given[k] = v;
    }
    return t.normalize(given);
  }

  private fileList(raw: unknown): string[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) throw new ConnectionError('files is a list of hosted file names');
    return raw.length ? (raw as string[]).map((x) => x.trim()).filter(Boolean) : undefined;
  }

  update(idOrName: string, patch: { name?: unknown; config?: unknown; files?: unknown; note?: unknown; enabled?: unknown }): Connection {
    const c = this.find(idOrName);
    const t = this.type(c.type);
    // Everything is checked on a copy; the connection itself changes only when all of it is fine.
    const next: Connection = { ...c };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!NAME.test(name)) throw new ConnectionError('Name it with letters, digits, dashes or underscores, starting with a letter');
      if (this.list_.some((x) => x !== c && x.name.toLowerCase() === name.toLowerCase())) throw new ConnectionError(`There is already a connection named ${name}`);
      next.name = name;
    }
    if (patch.config !== undefined) next.config = this.settings(t, patch.config);
    if (patch.files !== undefined) {
      const files = this.fileList(patch.files);
      if (files) next.files = files;
      else delete next.files;
    }
    if (patch.note !== undefined) {
      const note = String(patch.note).trim().slice(0, 500);
      if (note) next.note = note;
      else delete next.note;
    }
    if (patch.enabled !== undefined) {
      if (c.status === 'draft') throw new ConnectionError('Approve a draft before turning it on or off');
      next.status = patch.enabled === true ? 'active' : 'disabled';
    }
    // Secrets typed for one place are not sent to another: moving the connection means typing them again, and approving.
    const moved = patch.config !== undefined && t.target && t.target(c.config) !== t.target(next.config);
    if (moved) {
      for (const f of t.secrets) this.vault.set(this.ref(c, f.name), undefined);
      if (next.status === 'active') next.status = 'draft';
      delete next.approved;
    }
    Object.keys(c).forEach((k) => delete (c as unknown as Record<string, unknown>)[k]);
    Object.assign(c, next);
    this.save(c);
    this.log(`connection ${c.name} changed from the console`);
    return c;
  }

  setSecret(idOrName: string, field: string, value: string | undefined, from = 'the console'): void {
    const c = this.find(idOrName);
    if (!this.type(c.type).secrets.some((f) => f.name === field)) throw new ConnectionError(`${this.type(c.type).label} has no secret called ${field}`);
    if (value !== undefined && !this.secretFields(c).some((f) => f.name === field)) throw new ConnectionError(`${c.name} doesn't use ${field} with its current settings`);
    if (value !== undefined) {
      value = value.trim();
      if (!value) throw new ConnectionError('Give the secret as {"value": "..."}');
      if (value.length > 4096 || /[\r\n\0]/.test(value)) throw new ConnectionError('A secret is one line of at most 4096 characters');
    }
    this.vault.set(this.ref(c, field), value);
    // The value is never logged.
    this.log(`connection ${c.name}: secret ${field} ${value === undefined ? 'cleared' : 'set'} from ${from}`);
  }

  /** A person's go-ahead: the draft becomes usable. */
  approve(idOrName: string, from = 'the console'): Connection {
    const c = this.find(idOrName);
    const shown = this.shown(c);
    if (c.status !== 'draft') throw new ConnectionError(`${c.name} is already approved`);
    const missing = shown.secrets.filter((s) => s.required && !s.set).map((s) => s.label);
    if (missing.length) throw new ConnectionError(`Set ${missing.join(' and ')} first`);
    c.status = 'active';
    c.approved = new Date().toISOString();
    this.save(c);
    this.log(`connection ${c.name} approved from ${from}`);
    return c;
  }

  remove(idOrName: string): boolean {
    this.reload();
    const c = this.list_.find((x) => x.id === idOrName || x.name.toLowerCase() === idOrName.toLowerCase());
    if (!c) return false;
    this.list_ = this.list_.filter((x) => x !== c);
    this.save(undefined, c.id);
    try {
      this.vault.dropPrefix(c.id + '/');
    } catch (e) {
      this.log(`connection ${c.name}: its secrets could not be deleted (${(e as Error).message})`);
    }
    this.log(`connection ${c.name} removed from the console`);
    return true;
  }

  /** Asks the service something harmless. Allowed for a draft too, so the person can check what they pasted before approving. */
  async test(idOrName: string): Promise<ConnectionTest> {
    const c = structuredClone(this.find(idOrName));
    const t = this.type(c.type);
    const started = Date.now();
    let result: ConnectionTest;
    try {
      const secrets = this.secretsOf(c);
      const missing = this.secretFields(c).filter((f) => f.required && !secrets[f.name]).map((f) => f.label);
      if (missing.length) throw new ConnectionError(`Set ${missing.join(' and ')} first`);
      result = { at: new Date().toISOString(), ok: true, message: `${await t.test(c, secrets, this.io)} (${Date.now() - started} ms)` };
    } catch (e) {
      // What the service echoed never includes a secret: the result is kept and shown to the AI's tools too.
      result = { at: new Date().toISOString(), ok: false, message: maskSecrets((e as Error).message, Object.values(this.secretsOf(c))) };
    }
    this.save({ ...c, lastTest: result }, undefined, false, true);
    return result;
  }

  private secretsOf(c: Connection): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.type(c.type).secrets) {
      const v = this.vault.get(this.ref(c, f.name));
      if (v !== undefined) out[f.name] = v;
    }
    return out;
  }

  /**
   * For the server's own code (never an API route): an active connection, if the file may use it, with its secrets.
   * `files` are the hosted files the use involves (a script's call stack); a capture-only file is refused by the caller.
   */
  /**
   * The connection Send Mail steps use: the oldest one that is turned on, complete and marked for them, and (when the
   * files a message involves are given) that those files may use.
   */
  mailAccount(files?: readonly string[]): Connection | undefined {
    this.reload();
    return this.list_.find((x) => x.type === 'smtp' && x.status === 'active' && x.config.mail === 'yes' && this.shown(x).ready
      && (!files || !x.files?.length || (files.length > 0 && files.every((f) => x.files!.some((y) => y.toLowerCase() === f.toLowerCase())))));
  }

  use(idOrName: string, files: readonly string[] = []): { connection: Connection; secrets: Record<string, string>; io: ConnectionIo } {
    const c = this.find(idOrName);
    if (c.status !== 'active') throw new ConnectionError(c.status === 'draft' ? `The connection ${c.name} has not been approved at the console yet` : `The connection ${c.name} is turned off`);
    if (c.files?.length) {
      const refused = files.find((f) => !c.files!.some((x) => x.toLowerCase() === f.toLowerCase()));
      if (refused !== undefined || !files.length) throw new ConnectionError(`The connection ${c.name} is not set up for ${refused ?? 'this file'}`);
    }
    const secrets = this.secretsOf(c);
    const missing = this.secretFields(c).filter((f) => f.required && !secrets[f.name]);
    if (missing.length) throw new ConnectionError(`The connection ${c.name} is missing ${missing.map((f) => f.label).join(', ')}: type it at the console`);
    return { connection: c, secrets, io: this.io };
  }
}
