// Every security-relevant setting, its default, and how that default is observed on a server started with no flags.
// docs/security-defaults.md is made from this table (npm run docs:security-defaults); defaults.test.ts starts a server and
// holds each row's `observe` to its `expect`. Changing a default means changing the row, and the row changes the page.
//
// "Checked by" says how a row is observed: "probed" is a request to the running server (or a file it made), "read from
// code" is a constant or a line of source that the test reads, because nothing on a running server shows it from this side.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKOUT, PASSWORD_POLICY } from '../../store/src/index.ts';

export interface Ctx {
  base: string;
  dir: string;
  port: number;
  /** Everything the server printed so far. */
  log(): string;
  request(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Headers; text: string }>;
  /** A Data API token for the file's Admin account. */
  token(): Promise<string>;
  status(): Promise<any>;
  /** Starts another server in a new folder with these options, and returns what it printed once it was serving. */
  other(args: string[]): Promise<string>;
  /** Starts another server with these options that is expected to refuse to start; returns what it printed before it stopped. */
  refused(args: string[]): Promise<string>;
  /** The source of a file in the repository. */
  source(path: string): string;
  /** The file's password policy, as JSON ('{}' when none was set). */
  passwordPolicy(): string;
  /** What `tabularius passwd` and `admin-password` say to a 3-character and a 12-character password, run as the command line is. */
  passwordRules(): string;
  /** What a token made with no options looks like. */
  apiTokenShape(): string;
  /** A setting a file made now starts with. */
  newStoreSetting(key: 'aiPolicy'): string;
  /** Whether the folder's settings turn on scripts installing plug-ins. */
  scriptPluginInstall(): boolean;
  /** How the file's audit trail is set. */
  auditShape(): string;
  /** The first bytes of a file in the folder, as text. */
  fileHeader(name: string): string;
}

export type Section = 'Network and transport' | 'Sign-in and accounts' | 'What can reach outside' | 'Limits' | 'Data at rest';

export interface Row {
  id: string;
  section: Section;
  setting: string;
  /** What the page says the default is. */
  default: string;
  /** What changes it. */
  changedBy: string;
  /** What goes wrong if it is changed. */
  risk: string;
  how: 'probed' | 'read from code';
  /** A short word for what the running server shows; the test fails unless observe() returns it. */
  expect: string;
  observe(ctx: Ctx): Promise<string | undefined>;
}

const NOT_ON_THIS_SYSTEM = undefined;

/** Whether the server's port is listening on the loopback address only (Linux: /proc/net/tcp). */
function listeningOn(port: number): string | undefined {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const found: string[] = [];
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    // A kernel without IPv6 has no tcp6 file; one without either cannot be observed this way.
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[3] === '0A' && cols[1]?.endsWith(':' + hex)) found.push(cols[1].split(':')[0]);
    }
  }
  if (!found.length) return NOT_ON_THIS_SYSTEM;
  return found.every((a) => a === '0100007F' || a === '00000000000000000000000001000000') ? 'loopback only' : `listening on ${found.join(', ')}`;
}

const grep = (text: string, re: RegExp): string | undefined => re.exec(text)?.[1];

export const ROWS: Row[] = [
  {
    id: 'listen', section: 'Network and transport', setting: 'Listen address',
    default: 'This computer only (127.0.0.1)',
    changedBy: '`--host 0.0.0.0` (or an address), `TABULARIUS_HOST`, which also needs HTTPS or `--allow-plain-http` (next rows); `--https <domain>` listens on every address unless `--host` says otherwise. `tabularius service install` listens on this computer only too unless its `-- --https <domain>` option is given (every address then), and applies the same rule to `--host`. The PostgreSQL-protocol port (`--sql-port`) listens on the same address',
    risk: 'Anyone who can reach the machine can reach the sign-in pages. Set an admin password and use HTTPS before listening on the network',
    how: 'probed', expect: 'loopback only',
    observe: async (c) => listeningOn(c.port),
  },
  {
    id: 'tls', section: 'Network and transport', setting: 'HTTPS',
    default: 'Off: plain HTTP',
    changedBy: '`--https <domain>` (certificate from Let\'s Encrypt), `--https local` (the folder\'s own authority), `--tls-cert` with `--tls-key`, or a proxy that does HTTPS',
    risk: 'Without it, passwords and session tokens cross the network in the clear. On this computer alone that does not matter',
    how: 'probed', expect: 'plain HTTP',
    observe: async (c) => {
      const r = await c.request('/app/');
      return /Web client: http:\/\//.test(c.log()) && !r.headers.has('strict-transport-security') ? 'plain HTTP' : 'https';
    },
  },
  {
    id: 'exposed-refusal', section: 'Network and transport', setting: 'Listening beyond this computer without HTTPS',
    default: 'Refused: the server does not start, and says how to fix it',
    changedBy: 'HTTPS (`--https`, `--https local`, `--tls-cert` with `--tls-key`) lifts it. `--allow-plain-http` (or `TABULARIUS_ALLOW_PLAIN_HTTP`) allows plain HTTP for a proxy or network you control; the server then warns in the log unless `--public-url` starts with `https://`. The Docker image sets it, because the port you publish decides who can connect',
    risk: 'Allowing it sends passwords and session tokens across the network in the clear to anyone who can see the traffic',
    how: 'probed', expect: 'refuses',
    observe: async (c) => {
      const exposed = await c.refused(['--host', '0.0.0.0']);
      const proxied = await c.refused(['--host', '0.0.0.0', '--public-url', 'https://files.example.com']);
      const allowed = await c.other(['--host', '0.0.0.0', '--allow-plain-http']);
      const secure = await c.other(['--host', '0.0.0.0', '--https', 'local']);
      const here = c.log();
      const says = /would listen on 0\.0\.0\.0 over plain HTTP/;
      return says.test(exposed) && says.test(proxied) && /Warning: this server listens on 0\.0\.0\.0 over plain HTTP/.test(allowed) && !/over plain HTTP/.test(secure) && !/over plain HTTP/.test(here) ? 'refuses' : `exposed: ${exposed.slice(0, 80)}`;
    },
  },
  {
    id: 'headers', section: 'Network and transport', setting: 'Page security headers',
    default: 'On: no sniffing, no framing, no referrer, a content security policy (checked on the web client; the admin console\'s policy allows its own inline scripts), and a Permissions-Policy on every response that denies the microphone, payment, USB, serial, HID, Bluetooth, MIDI, screen capture, motion and orientation sensors, WebXR, idle detection and ad-topics APIs. The camera and location stay available to the web client\'s own pages only (Insert from Device, Get Current Location)',
    changedBy: 'Not switchable',
    risk: 'None to change; they stop other sites framing the pages and the browser guessing types, and keep a page that gets script into it from asking for a device the product never uses',
    how: 'probed', expect: 'nosniff, no framing, no referrer, CSP, Permissions-Policy',
    observe: async (c) => {
      const h = (await c.request('/app/')).headers;
      const ok = h.get('x-content-type-options') === 'nosniff' && h.get('x-frame-options') === 'DENY' && h.get('referrer-policy') === 'no-referrer' && /frame-ancestors 'none'/.test(h.get('content-security-policy') ?? '') &&
        /(^|, )microphone=\(\)/.test(h.get('permissions-policy') ?? '') && /(^|, )camera=\(self\)/.test(h.get('permissions-policy') ?? '');
      return ok ? 'nosniff, no framing, no referrer, CSP, Permissions-Policy' : JSON.stringify([...h.entries()]).slice(0, 200);
    },
  },
  {
    id: 'hsts', section: 'Network and transport', setting: 'Strict-Transport-Security (HSTS)',
    default: 'Sent for one year on every response served over HTTPS (directly, or through a proxy on this computer or in `--trusted-proxies` that says `X-Forwarded-Proto: https`); never over plain HTTP. No `includeSubDomains`, no `preload`',
    changedBy: 'Not switchable. It follows how the request arrived',
    risk: 'After a browser has seen it, it will not open this name over plain HTTP for a year, and a certificate error cannot be clicked through. Keep the certificate renewing before you serve a name over HTTPS',
    how: 'probed', expect: 'none over plain HTTP',
    observe: async (c) => {
      const h = (await c.request('/app/')).headers;
      return h.get('strict-transport-security') === null ? 'none over plain HTTP' : `sent over plain HTTP: ${h.get('strict-transport-security')}`;
    },
  },
  {
    id: 'cors', section: 'Network and transport', setting: 'Cross-origin access from other websites',
    default: 'None for the Data API and the console, and `/mcp` refuses a browser origin. The OAuth endpoints (`/oauth/*`, where AI apps register and sign in) answer any origin',
    changedBy: '`--mcp-origin` (repeatable) or `TABULARIUS_MCP_ORIGINS` for `/mcp`; the Data API has no switch (a page on another site cannot call it)',
    risk: 'Allowing an origin lets a page from that site act with the signed-in person\'s rights',
    how: 'probed', expect: 'none, except /oauth/*',
    observe: async (c) => {
      const data = await c.request('/fmi/data/vLatest/databases/Shop/layouts', { headers: { origin: 'https://evil.example' } });
      const pre = await c.request('/fmi/data/vLatest/databases/Shop/sessions', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
      const mcp = await c.request('/mcp', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' });
      const oauth = await c.request('/oauth/register', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
      const none = !data.headers.has('access-control-allow-origin') && !pre.headers.has('access-control-allow-origin') && mcp.status === 403;
      return none && oauth.headers.get('access-control-allow-origin') === '*' ? 'none, except /oauth/*' : `data ${data.status}, preflight ${pre.status}, mcp ${mcp.status}, oauth ${oauth.status}`;
    },
  },
  {
    id: 'proxy', section: 'Network and transport', setting: 'Client address headers from a proxy (X-Forwarded-For and the like)',
    default: 'Not believed: the address that connected is the client, and a request that carries a forwarding header is not taken for one from this computer (the console refuses it)',
    changedBy: '`--trusted-proxies <addresses>` with `--proxy-header <name>`',
    risk: 'Trust only proxies that overwrite or append the address they actually observed. An overly broad trust list lets clients forge audit, allow-list and rate-limit identities. See Client address attribution below',
    how: 'probed', expect: 'not believed',
    observe: async (c) => {
      const plain = await c.request('/tabularius/admin/v1/status');
      const claimed = await c.request('/tabularius/admin/v1/status', { headers: { 'x-forwarded-for': '203.0.113.9' } });
      return plain.status === 200 && claimed.status === 403 ? 'not believed' : `plain ${plain.status}, with a forwarding header ${claimed.status}`;
    },
  },
  {
    id: 'admin-password', section: 'Sign-in and accounts', setting: 'Admin console password',
    default: 'None set: the console opens from this computer only, and refuses a request addressed to any other name',
    changedBy: '`tabularius admin-password <folder>`; the console\'s own Settings',
    risk: 'With a password set the console is open to whoever can reach the port and knows it; turn on HTTPS first. A sign-in lasts 12 hours (cookie `HttpOnly`, `SameSite=Strict`; over HTTPS it is named `__Host-tabularius_admin` and is `Secure`)',
    how: 'probed', expect: 'none; this computer only',
    observe: async (c) => {
      const s = await c.status();
      const other = await c.request('/tabularius/admin/v1/status', { headers: { host: 'example.com' } });
      const cookie = grep(c.source('packages/server/src/admin.ts'), /SIGN_IN_MS = (12 \* 60 \* 60_000);/);
      const src = c.source('packages/server/src/admin.ts');
      const flags = src.includes("const COOKIE_FLAGS = 'Path=/; HttpOnly; SameSite=Strict';") && src.includes('`${SECURE_COOKIE}=${id}; ${COOKIE_FLAGS}; Max-Age=${maxAge}; Secure`') &&
        src.includes("${COOKIE}=${id}; ${COOKIE_FLAGS}; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`");
      return s.setup.passwordSet === false && other.status === 403 && cookie && flags ? 'none; this computer only' : `passwordSet ${s.setup.passwordSet}, other host ${other.status}, cookie ${cookie} ${flags}`;
    },
  },
  {
    id: 'blank-passwords', section: 'Sign-in and accounts', setting: 'File accounts with no password (FileMaker\'s default Admin)',
    default: 'Work from this computer only; refused from the network',
    changedBy: '`--allow-blank-passwords`; a file\'s own allowance for private-network addresses (`allowBlankPasswordFromLan`, in the console); `tabularius passwd <folder> <database> <account>` gives one a password',
    risk: 'Allowing them means anyone who can reach the server can sign in as that account, with its privileges',
    how: 'read from code', expect: 'refused from the network',
    // The constant the server starts with: a started server holds no other copy of it to ask.
    observe: async () => (PASSWORD_POLICY.blankFromNetwork === false ? 'refused from the network' : 'allowed'),
  },
  {
    id: 'anonymous', section: 'Sign-in and accounts', setting: 'Anonymous access',
    default: 'None: every Data API, web client and SQL route needs an account. A file converted by this version keeps its built-in [Guest] account switched off, even if the FileMaker file had it on (the conversion report says so); switched on, it still signs nobody in until it is given a password',
    changedBy: 'Nothing needed. [Guest] can be switched on in Manage Security, and the privilege review then lists it; giving it a password makes it a shared account. Accounts with no password are the other way in (above)',
    risk: 'A shared account is only as private as its password. A file that grants a privilege set to a blank-password account is open to this computer\'s users',
    how: 'probed', expect: 'none',
    observe: async (c) => {
      const layouts = await c.request('/fmi/data/vLatest/databases/Shop/layouts');
      const noAuth = await c.request('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const wrong = await c.request('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Nobody:nothing'), 'content-type': 'application/json' }, body: '{}' });
      return layouts.status === 401 && noAuth.status === 401 && wrong.status === 401 ? 'none' : `${layouts.status}/${noAuth.status}/${wrong.status}`;
    },
  },
  {
    id: 'file-list', section: 'Sign-in and accounts', setting: 'List of hosted files for people who have not signed in',
    default: 'Off: the list answers only a caller who signs in, with the files that account can open',
    changedBy: '`--list-files-publicly`, `TABULARIUS_LIST_FILES_PUBLICLY`',
    risk: 'File names are visible to anyone who can reach the server',
    how: 'probed', expect: 'off',
    observe: async (c) => {
      const r = await c.request('/fmi/data/vLatest/databases');
      return r.status === 404 && /list of files is turned off/.test(r.text) ? 'off' : `status ${r.status}`;
    },
  },
  {
    id: 'lockout', section: 'Sign-in and accounts', setting: 'Lockout after wrong passwords',
    default: '5 wrong passwords in 15 minutes lock that account for 15 minutes; 30 failures from one address lock the address',
    changedBy: 'Fixed values (`LOCKOUT` in `packages/store/src/sign-in-failures.ts`); an administrator can lift a lock in the console. This computer\'s own address has no address budget',
    risk: 'Lower numbers lock people out more easily; higher ones let a stranger guess more',
    how: 'probed', expect: '5 / 15 min / 15 min / 30',
    observe: async (c) => {
      const code = LOCKOUT.attempts === 5 && LOCKOUT.windowMs === 15 * 60_000 && LOCKOUT.lockMs === 15 * 60_000 && LOCKOUT.addressAttempts === 30;
      const attempt = (pw: string) => c.request('/fmi/data/vLatest/databases/Shop/sessions', { method: 'POST', headers: { authorization: 'Basic ' + btoa('Locky:' + pw), 'content-type': 'application/json' }, body: '{}' });
      // The fifth wrong password is the one that locks, so it may say so; the first four may not.
      for (let i = 0; i < 5; i++) { const r = await attempt('wrong ' + i); if (i < 4) assertNotLocked(r, i); }
      const sixth = await attempt('Locky correct password 1');
      return code && sixth.status !== 200 && /Too many failed/.test(sixth.text) ? '5 / 15 min / 15 min / 30' : `after five wrong passwords the right one gave ${sixth.status}: ${sixth.text.slice(0, 80)}`;
    },
  },
  {
    id: 'idle', section: 'Sign-in and accounts', setting: 'Session idle time',
    default: '15 minutes for Data API and web client sessions; 15 minutes for Admin API tokens',
    changedBy: 'Admin console Settings, or `POST /tabularius/admin/v1/session-timeout` (1 to 1440 minutes), for Data API and web client sessions only; Admin API tokens stay at 15 minutes; the web client can have its own',
    risk: 'Longer sessions leave a signed-in browser or script usable for longer if it is left or taken',
    how: 'probed', expect: '15 / 15 / 15',
    observe: async (c) => {
      const s = (await c.status()).server;
      const admin = grep(c.source('packages/server/src/adminapi.ts'), /const TOKEN_IDLE_MS = (15) \* 60_000;/);
      return s.sessionIdleMinutes === 15 && s.webSessionIdleMinutes === 15 && admin ? '15 / 15 / 15' : `${s.sessionIdleMinutes} / ${s.webSessionIdleMinutes} / ${admin}`;
    },
  },
  {
    id: 'password-strength', section: 'Sign-in and accounts', setting: 'Password rules for file accounts and the admin console',
    default: 'A new password needs at least 12 characters, for a file account (unless the file\'s own policy says otherwise) and for the admin console. Nothing expires. The lockout above is the other brake on guessing',
    changedBy: '`tabularius privileges <folder> <database> policy [minLength [maxAgeDays]]` for one file (0 for no minimum, a number of days to make passwords expire); `TABULARIUS_MIN_PASSWORD_LENGTH` for the default (0 for none), which also sets the admin console\'s minimum',
    risk: 'Lowering it accepts short passwords that a guesser, or a stolen password hash, gives up fast. Accounts that already have a shorter password keep it until it is changed; while any minimum is in force a blank password is refused as well (the empty password a converted file\'s account keeps still works from this computer only)',
    how: 'probed', expect: 'refuses 3 characters, takes 12',
    observe: async (c) => c.passwordRules(),
  },
  {
    id: 'api-tokens', section: 'Sign-in and accounts', setting: 'API tokens (`ohbt_`) made for an account',
    default: 'Expire after 90 days (a calendar feed address, 365), and can write, unless made read-only or given another lifetime',
    changedBy: 'Chosen when the token is made (`--expires-days` or `expiresDays`, 0 for none; `readOnly`, surfaces, layouts), or for every new one except calendar feeds with `TABULARIUS_TOKEN_DEFAULT_DAYS` (0 for none); the console lists and revokes them',
    risk: 'A token that leaks works until it expires or someone revokes it. Asking for 0 days makes one that never expires, and the security health page lists those. Tokens made before this default keep the lifetime they had',
    how: 'probed', expect: 'expires in 90 days, read-write',
    observe: async (c) => c.apiTokenShape(),
  },
  {
    id: 'two-factor', section: 'Sign-in and accounts', setting: 'Two-factor sign-in for [Full Access] accounts',
    default: 'Not required (available)',
    changedBy: 'Per file, in the console or Manage Security (`requireTotpForFullAccess`)',
    risk: 'Without it a stolen Full Access password is enough',
    how: 'probed', expect: 'not required',
    observe: async (c) => ((await c.status()).databases[0].requireTotpForFullAccess === false ? 'not required' : 'required'),
  },
  {
    id: 'sso', section: 'Sign-in and accounts', setting: 'Single sign-on (OpenID Connect, LDAP) and SCIM provisioning',
    default: 'Off: no provider is configured, and SCIM answers 401 without a per-file provisioning token',
    changedBy: '`--oidc-issuer` with `--oidc-client-id` (or `--oidc-config`), `--ldap-url`; the console makes a SCIM token',
    risk: 'A provider that signs in anyone with an email address needs `--oidc-trust-email` thought through; a SCIM token can create accounts',
    how: 'probed', expect: 'off',
    observe: async (c) => {
      const s = (await c.status()).server;
      const scim = await c.request('/tabularius/scim/v2/databases/Shop/Users');
      return s.oidc.on === false && scim.status === 401 && !/ldap|oidc/i.test(c.log()) ? 'off' : `oidc ${s.oidc.on}, scim ${scim.status}`;
    },
  },
  {
    id: 'mcp-local', section: 'Sign-in and accounts', setting: 'AI connector (`/mcp`)',
    default: 'Needs a credential from everyone, this computer included. A request addressed to a host name the server was not told (no `--public-url` or `--https` for it) is refused with 403 before the token is checked; a request without a token to this computer\'s own address or `localhost` gets 401. The server makes an administrator token on first start and keeps it in `.openhbam-mcp-token` in the hosted folder, readable only by the account that runs the server (`tabularius mcp-token <folder>` prints it)',
    changedBy: '`--mcp-token` (or `TABULARIUS_MCP_TOKEN`) sets the administrator token instead; an account (HTTP Basic), an API token from the admin console or Manage Security, or the OAuth sign-in limit a caller to one account\'s privilege set. Deleting `.openhbam-mcp-token` and restarting makes a new one. Give a cluster or a standby pair the same `--mcp-token`, so every process and a server that takes over accept the same one; the admin console is a separate door and trusts this computer until it has a password',
    risk: 'Whoever holds the administrator token can read and change every hosted file: keep the file and the token out of repositories and chats. On Windows the file has no owner-only mode, so keep the hosted folder\'s own permissions tight',
    how: 'probed', expect: 'no token 401, other host name 403, open with the folder\'s token',
    observe: async (c) => {
      const call = (headers: Record<string, string>) => c.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
      const bare = await call({});
      const other = await call({ host: 'example.com' });
      const token = readFileSync(join(c.dir, '.openhbam-mcp-token'), 'utf8').trim();
      const own = await call({ authorization: `Bearer ${token}` });
      return bare.status === 401 && other.status === 403 && own.status === 200 ? 'no token 401, other host name 403, open with the folder\'s token' : `${bare.status}, other host ${other.status}, with the token ${own.status}`;
    },
  },
  {
    id: 'ai', section: 'What can reach outside', setting: 'AI assistant',
    default: 'Off: it needs `--ai` and a key. A key in the environment (`ANTHROPIC_API_KEY`) does nothing on its own',
    changedBy: '`--ai` with a key (`ANTHROPIC_API_KEY`, `~/.openhbam/anthropic-key` or `--ai-key-file`); per file, `tabularius ai <folder> <database> off`; `--ai-exclude`',
    risk: 'With it on, questions and what the assistant reads go to the provider. A file switched off with `tabularius ai <folder> <database> off`, or named by `--ai-exclude`, is never sent. The AI-visible policy (next row) is a different thing: turning it off removes the refusal to read secret-named fields',
    how: 'probed', expect: 'off',
    observe: async (c) => ((await c.status()).server.ai.state === 'no-key' && !/AI assistant on/.test(c.log()) ? 'off' : 'on'),
  },
  {
    id: 'ai-policy', section: 'What can reach outside', setting: 'Per-file AI-visible policy',
    default: 'On for files made by Tabularius; off for converted and existing files',
    changedBy: '`tabularius ai-policy <folder> <name> on|off`; the console',
    risk: 'Off lets an AI operation read secret-named fields',
    how: 'probed', expect: 'on for new files',
    observe: async (c) => (c.newStoreSetting('aiPolicy') === 'true' ? 'on for new files' : 'off'),
  },
  {
    id: 'mail', section: 'What can reach outside', setting: 'Outbound mail',
    default: 'Off: Send Mail never sends',
    changedBy: '`--send-mail` with `--mail-from` and an SMTP account (`TABULARIUS_SMTP`); `--test-outbound` captures mail instead of sending it',
    risk: 'Scripts can send mail as the server',
    how: 'probed', expect: 'off',
    observe: async (c) => ((await c.status()).server.mail === null ? 'off' : 'on'),
  },
  {
    id: 'script-network', section: 'What can reach outside', setting: 'Network access for scripts (Insert from URL, plug-in requests)',
    default: 'Off for every file, including a new or converted one and the demo, until an administrator turns it on. When on, loopback and the machine\'s own network are still refused unless listed; metadata and link-local addresses are always refused',
    changedBy: 'The admin console\'s Script network switch for one file (Hosted files); `--allow-script-network` for every file; `--allow-script-network-to <hosts or ranges>`',
    risk: 'A script can reach whatever the server can: mail, SMS and payment services, other machines on the network',
    how: 'probed', expect: 'off',
    observe: async (c) => {
      const s = (await c.status()).server;
      return s.scriptNetwork === false && s.outbound.on === false ? 'off' : 'on';
    },
  },
  {
    id: 'web-viewer-hosts', section: 'What can reach outside', setting: 'Web hosts a web viewer may load',
    default: 'None for every file, including a new or converted one and the demo: a web viewer shows only its own content (HTML a solution builds), and an address on the web shows as text. A listed host loads over https only, in a frame with no access to the app',
    changedBy: 'The admin console\'s Web viewers may load list for one file (Hosted files)',
    risk: 'A host on the list sees the address of whoever opens the page, and can show them anything, including a page that looks like the app\'s own',
    how: 'probed', expect: 'none',
    observe: async (c) => ((await c.status()).databases.every((d: { webViewerHosts?: string[] }) => !d.webViewerHosts?.length) ? 'none' : 'some'),
  },
  {
    id: 'script-install', section: 'What can reach outside', setting: 'Scripts installing plug-ins (Install Plug-In File)',
    default: 'Off',
    changedBy: '`tabularius plugins <folder> script-install on|off` (stored as `scriptPluginInstall` in the folder\'s settings file)',
    risk: 'A script (and so whoever can run it) could add code that runs in the server',
    how: 'read from code', expect: 'off',
    observe: async (c) => (c.scriptPluginInstall() === false && grep(c.source('packages/server/src/server-config.ts'), /(values\(\)\.scriptPluginInstall === true)/) ? 'off' : 'on'),
  },
  {
    id: 'plugins', section: 'What can reach outside', setting: 'Plug-ins',
    default: 'None installed; the bundled BaseElements-compatible set is built in and runs in the sandbox',
    changedBy: '`tabularius plugins`; the console\'s Plug-ins page (administrators only)',
    risk: 'A plug-in the administrator installs runs with the permissions its manifest asks for; see docs/writing-a-plugin.md',
    how: 'probed', expect: 'none installed',
    observe: async (c) => {
      const r = await c.request('/tabularius/admin/v1/plugins');
      const body = JSON.parse(r.text) as { plugins: unknown[] };
      return r.status === 200 && body.plugins.length === 0 ? 'none installed' : `${body.plugins.length} installed`;
    },
  },
  {
    id: 'hooks', section: 'What can reach outside', setting: 'Webhooks and inbound hooks',
    default: 'Off: set up in the console, they do nothing until the server is started to allow them',
    changedBy: '`--allow-webhooks`, `--allow-inbound-hooks` (app connections have `--allow-app-connections` and are not probed here)',
    risk: 'Webhooks send record changes to the address an administrator typed; inbound hooks answer calls from outside',
    how: 'probed', expect: 'off',
    observe: async (c) => {
      const w = JSON.parse((await c.request('/tabularius/admin/v1/webhooks')).text) as { allowed: boolean };
      const i = JSON.parse((await c.request('/tabularius/admin/v1/inbound-hooks')).text) as { allowed: boolean };
      return w.allowed === false && i.allowed === false ? 'off' : 'on';
    },
  },
  {
    id: 'sql-port', section: 'What can reach outside', setting: 'PostgreSQL-protocol SQL port for BI tools',
    default: 'Off',
    changedBy: '`--sql-port`',
    risk: 'Another listening port to protect; read-only unless `--sql-writes` is also given, signs in with file accounts',
    how: 'probed', expect: 'off',
    observe: async (c) => (/PostgreSQL clients/.test(c.log()) ? 'on' : 'off'),
  },
  {
    id: 'sql-writes', section: 'What can reach outside', setting: 'SQL writes over the PostgreSQL-protocol port',
    default: 'Off: INSERT, UPDATE and DELETE are refused (SQLSTATE 25006)',
    changedBy: '`--sql-writes` with `--sql-port`',
    risk: 'A reporting or ETL account can change records, within its record and field privileges and the audit log; a connection inside BEGIN holds the file until it ends, goes idle for 30 seconds or reaches 5 minutes',
    how: 'read from code', expect: 'off',
    observe: async (c) => (grep(c.source('packages/server/src/index.ts'), /(writes: opts\.sqlWrites === true)/) && grep(c.source('packages/server/src/pgwire.ts'), /(return this\.opts\.writes === true;)/) ? 'off' : 'on'),
  },
  {
    id: 'standby', section: 'What can reach outside', setting: 'Standby servers following this one (replication)',
    default: 'Off: the replication routes answer 404',
    changedBy: '`--replication-token` (at least 16 characters)',
    risk: 'The token lets a holder copy every hosted file',
    how: 'probed', expect: 'off',
    observe: async (c) => ((await c.request('/tabularius/replication/v1/files')).status === 404 ? 'off' : 'on'),
  },
  {
    id: 'update-check', section: 'What can reach outside', setting: 'Telemetry and update checks',
    default: 'None: nothing is sent to the project or anyone else on its own',
    changedBy: 'Nothing to change; `tabularius upgrade` fetches only when run',
    risk: 'This row only checks that the start-up log mentions no telemetry; the full list of outbound connections is the no-phone-home work (r21-06), not this table',
    how: 'probed', expect: 'none',
    observe: async (c) => (/telemetry|analytics|phone.?home/i.test(c.log()) ? 'something' : 'none'),
  },
  {
    id: 'json-cap', section: 'Limits', setting: 'Size of one Data API request',
    default: '10 MiB of JSON; larger answers 413 (error 960)',
    changedBy: 'Not switchable',
    risk: 'Larger bodies hold memory while they are read',
    how: 'probed', expect: '10 MiB',
    observe: async (c) => {
      const token = await c.token();
      const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      // A real layout: the size check has to be what answers, not "layout is missing".
      const layouts = JSON.parse((await c.request('/fmi/data/vLatest/databases/Shop/layouts', { headers: auth })).text) as { response: { layouts: { name: string; folderLayoutNames?: unknown }[] } };
      const layout = layouts.response.layouts.find((l) => !l.folderLayoutNames)!.name;
      const big = await c.request(`/fmi/data/vLatest/databases/Shop/layouts/${encodeURIComponent(layout)}/records`, { method: 'POST', headers: auth, body: JSON.stringify({ fieldData: { A: 'x'.repeat(10 * 1024 * 1024 + 1) } }) });
      return big.status === 413 && /960/.test(big.text) ? '10 MiB' : `status ${big.status} ${big.text.slice(0, 160)}`;
    },
  },
  {
    id: 'import-cap', section: 'Limits', setting: 'Size of a file import in the web client',
    default: '50 MiB plus 256 KiB for the request around the file',
    changedBy: 'Not switchable',
    risk: 'Larger uploads hold memory while they are read',
    how: 'read from code', expect: '50 MiB',
    observe: async (c) => (grep(c.source('packages/server/src/import-tables-route.ts'), /const MAX_BODY = (50 \* 1024 \* 1024) \+ 256 \* 1024;/) ? '50 MiB' : 'changed'),
  },
  {
    id: 'thumbnail-converters', section: 'Limits', setting: 'Picture thumbnails: passthrough size and limits on the converter programs',
    default: 'A picture is sent as it is only up to 128 KiB (and no bigger than the thumbnail asked for); the converter (pdftoppm, or sips on macOS) gets 20 seconds and, on Linux only, is run with prlimit (or ulimit in sh) at 512 MiB of address space, 20 seconds of CPU and 16 MiB for a file it writes',
    changedBy: 'Not switchable; `TABULARIUS_THUMBNAILS=builtin` turns the converter programs off',
    risk: 'On macOS and Windows the converter has no address-space, CPU or file-size limit beyond the 20-second timeout, the 16 MiB input cap and two converters at a time',
    how: 'read from code', expect: '128 KiB; prlimit 512 MiB, 20 s, 16 MiB',
    observe: async (c) => (grep(c.source('packages/server/src/containers.ts'), /(THUMBNAIL_PASSTHROUGH_BYTES = 128 \* 1024;)/) && /--as=\$\{TOOL_ADDRESS_SPACE\}/.test(c.source('packages/server/src/containers.ts')) && grep(c.source('packages/server/src/containers.ts'), /(TOOL_ADDRESS_SPACE = 512 \* 1024 \* 1024;)/) ? '128 KiB; prlimit 512 MiB, 20 s, 16 MiB' : 'changed'),
  },
  {
    id: 'calendar-import-limits', section: 'Limits', setting: 'Calendar (.ics) import size',
    default: 'At most 8 MiB and 5000 events (each occurrence of a repeating event counts); a file over a limit, or cut off inside an event, is refused whole and nothing is imported',
    changedBy: 'Not switchable',
    risk: 'A partial import that looks complete is worse than a refusal',
    how: 'read from code', expect: '5000 events, refused whole',
    observe: async (c) => (grep(c.source('packages/store/src/calendar.ts'), /(READ_LIMITS = \{ events: 5000,)/) && /class CalendarReadError/.test(c.source('packages/store/src/calendar.ts')) ? '5000 events, refused whole' : 'changed'),
  },
  {
    id: 'request-time', section: 'Limits', setting: 'Time one request may hold the server',
    default: 'A minute; then it is stopped (error 812)',
    changedBy: '`TABULARIUS_REQUEST_BUDGET_MS` (0 for none)',
    risk: 'Without a limit one slow request can stall everyone else',
    how: 'read from code', expect: '60 s',
    observe: async (c) => (/budget === undefined \|\| budget === '' \? 60_000 : Number\(budget\)/.test(c.source('packages/server/src/index.ts')) ? '60 s' : 'changed'),
  },
  {
    id: 'audit', section: 'Data at rest', setting: 'Audit trail',
    default: 'On: every record created, changed, deleted or duplicated is logged; reads are not logged; kept without limit',
    changedBy: '`logReads`, `redactSensitive`, `excludeFields` and `retentionDays` in the file\'s audit settings (console)',
    risk: 'Logging reads grows the log fast; a retention limit deletes history; there is no switch to turn record logging off',
    how: 'probed', expect: 'writes logged, reads not, kept forever',
    observe: async (c) => c.auditShape(),
  },
  {
    id: 'backups', section: 'Data at rest', setting: 'Backups',
    default: 'On: every day, the last 7 kept, in `Backups` beside the files, not encrypted (the console reports each one\'s check; this row probes the schedule, count and encryption only)',
    changedBy: '`--backup-every`, `--keep`, `--backup-dir`, `--no-backups`; `TABULARIUS_BACKUP_KEY` encrypts; `--backup-s3` copies off-site',
    risk: 'A backup folder on the same disk is lost with it; an unencrypted one holds every record and every password hash',
    how: 'probed', expect: 'daily, keep 7, unencrypted',
    observe: async (c) => {
      const b = (await c.status()).backups;
      return b.every === 86_400_000 && b.keep === 7 && b.encrypted === false ? 'daily, keep 7, unencrypted' : JSON.stringify(b).slice(0, 100);
    },
  },
  {
    id: 'encryption', section: 'Data at rest', setting: 'Encryption at rest for the hosted files',
    default: 'Off: files are ordinary SQLite files',
    changedBy: '`tabularius encrypt <folder>` with `TABULARIUS_ENCRYPTION_KEY`',
    risk: 'Anyone who can read the folder can read the data; passwords are stored as scrypt hashes either way',
    how: 'probed', expect: 'off',
    observe: async (c) => (c.fileHeader('Shop.openhbam.sqlite').startsWith('SQLite format 3') ? 'off' : 'on'),
  },
];

function assertNotLocked(r: { status: number; text: string }, i: number): void {
  if (/Too many failed/.test(r.text)) throw new Error(`locked after only ${i} wrong passwords`);
}

export const OWNER_DECISIONS: { title: string; text: string }[] = [
  {
    title: 'Admin console is open to this computer until a password is set',
    text: 'On a shared computer any local user can open the console, and from it make `/mcp` tokens and act as the administrator, so a console password is what keeps the others out. Recommended: ask for the password on first visit even from this computer when the folder is not under the user\'s home directory. Not done: it would stop `tabularius` (no arguments) opening the welcome page straight away.',
  },
];

/** Kept in the generated security defaults page alongside the executable default table. */
export const CLIENT_ADDRESS_POLICY = `## Client address attribution

Tabularius uses the canonical socket address unless both \`--proxy-header\` (\`TABULARIUS_PROXY_HEADER\`) and \`--trusted-proxies\` (\`TABULARIUS_TRUSTED_PROXIES\`) authorize forwarding. Loopback is **not implicitly trusted**. Existing installations using only \`--proxy-header\` must add their proxy IPs/CIDRs, including loopback where appropriate. No fixed hop-count setting is needed: traversal starts at the socket, then walks the selected header **from right to left**, continuing only while the current hop is trusted. The first untrusted hop is the client. This follows the trusted-list method in [MDN: X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#selecting_an_ip_address), “first non-matching address”.

For a three-proxy chain, configure all three proxies. The last proxy is the socket peer; the two preceding proxies are the rightmost header entries. Earlier client-supplied entries cannot override the first untrusted address. Every trusted proxy must overwrite its header or append the peer it actually observed; network controls must prevent bypassing that proxy. Trust only the specific addresses/subnets you administer, not a whole client network.

| Input / use | Expected Tabularius result | Public basis |
| --- | --- | --- |
| No selected header or an untrusted socket peer | Canonical socket address; never a caller-selected address | [RFC 7239 §8.1](https://www.rfc-editor.org/rfc/rfc7239#section-8.1), “cannot be relied upon to be correct” |
| X-Forwarded-For / Forwarded lists and repeated fields | Preserve wire order, validate the entire list, then walk trusted hops from the right | [RFC 7239 §§4,7.1](https://www.rfc-editor.org/rfc/rfc7239#section-7.1); [MDN X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#parsing) |
| Forwarded parameters | Parse tokens and quoted strings, including quoted separators/escapes; require one IP-valued for parameter per element; reject duplicate names case-insensitively | [RFC 7239 §4](https://www.rfc-editor.org/rfc/rfc7239#section-4), “MUST NOT occur more than once” |
| Ports and brackets | IPv4:port or [IPv6]:port; decimal ports 1–65535; bare IPv6 has no inferred port. Forwarded requires quoting colon-containing values | [RFC 7239 §6](https://www.rfc-editor.org/rfc/rfc7239#section-6); the numeric port range is a Tabularius restriction | <!-- known-difference-ok: "inferred" here means no port is assumed for a bare IPv6 address; it is not a FileMaker comparison -->
| Unknown/obfuscated nodes, zones, empty elements, invalid ports or malformed syntax anywhere in the list | Socket fallback for attribution and edge accounting. Empty-list/parameter and zone rejection are deliberately stricter application policy | [RFC 7239 §§6–7](https://www.rfc-editor.org/rfc/rfc7239#section-6) defines node forms; it does not require these Tabularius acceptance policies |
| X-Real-IP | Exactly one address; reject lists/repeated values | [nginx ngx_http_realip_module](https://nginx.org/en/docs/http/ngx_http_realip_module.html#real_ip_header) describes the address header; single-value rejection is Tabularius policy |
| IPv6 and IPv4-mapped IPv6 | Normalize case, compression and padding; both dotted and hex mapped IPv4 become dotted IPv4 | [RFC 5952 §§4–5](https://www.rfc-editor.org/rfc/rfc5952#section-4); [RFC 4291 §2.5.5.2](https://www.rfc-editor.org/rfc/rfc4291#section-2.5.5.2), “IPv4-Mapped IPv6 Address” |
| Limits and lockouts | One key per IPv4 address or IPv6 **/64** (first four normalized hextets); rotating interface identifiers cannot create another bucket. OAuth registration, account-import IP limits, edge admission, account lockouts and shared address-limit consumers use the same function | Tabularius policy, using [RFC 4291 §2.3](https://www.rfc-editor.org/rfc/rfc4291#section-2.3) prefix notation; /64 is not an RFC-mandated abuse limit |
| Audit and allow-list attribution | Keep the full canonical address; do not replace it with the /64 bucket. Capture once per request, including delayed finish callbacks | Tabularius policy based on [RFC 5952 §3.2](https://www.rfc-editor.org/rfc/rfc5952#section-3.2) matching concerns |

**Fallback is not permission to authenticate as the proxy.** A configured proxy with a missing or invalid selected header receives HTTP 400 before application authentication, retaining its socket identity for edge accounting. A forwarded client that resolves to loopback is rejected the same way. Forwarding headers on a loopback connection nobody configured as a proxy (a reverse proxy on this computer that was never named in \`--trusted-proxies\`) are not believed: that visitor is unknown, never this computer, and authentication answers it (the console refuses, \`/mcp\` answers 401). The refusals prevent malformed attacker-controlled prefixes retained by a proxy from acquiring local-only or blank-password privileges or the local address-budget exemption. Direct local callers sharing a configured proxy address must use a separate listener/configuration; the proxy-facing listener requires a valid header. The 400 says what to check and is logged (at most once a minute); it is Tabularius policy, not RFC or Claris requirements.

The cluster front resolves attribution once, overwrites \`x-tabularius-peer\` and \`x-tabularius-forwarded\`, and sends them over its private worker transport. Workers preserve the canonical address and trusted-forwarding provenance rather than parsing the external chain again. Address keys are identical across routes and workers; existing in-memory counters keep their existing process scope. Edge connection counts remain at the front, OAuth registration routes to the leader, and account authentication retains existing worker routing.

### KNOWN

| Unknown / limitation | Status |
| --- | --- |
| Claris forwarding-header trust, malformed-header behavior, and IPv6 grouping | **Unverified**; no Claris behavior is claimed documented or equivalent | <!-- known-difference: Server operation ;; Whether Claris Server trusts forwarding headers, how it treats malformed ones and how it groups IPv6 addresses is unverified; Tabularius applies its own strict profile ;; Address attribution, limits and lockouts behind a proxy may differ from FileMaker Server ;; A Claris Server run behind a proxy with valid, malformed and IPv6 forwarding headers -->
| Whether an operator's proxies overwrite/append correctly, or alternate ingress paths bypass them | Deployment-specific; synthetic tests do not establish this |
| Distributed aggregation of every application counter across workers/servers | Not added; this change makes identity keys consistent, not all counters global |
| Compatibility with optional empty Forwarded elements, obfuscated identifiers, zone IDs or port zero | Intentionally rejected by this strict Tabularius profile |
`;
