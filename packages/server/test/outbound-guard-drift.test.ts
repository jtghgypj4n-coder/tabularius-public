// Every place the server can open a connection to somebody else's address goes through the shared outbound guard
// (packages/scripts/src/net-guard.ts), or is listed here with the reason it need not. A new raw fetch, http(s).request,
// net/tls connect, WebSocket, http2 or datagram socket in any package's src (the web client runs in a browser and is not
// looked at) fails this test until it uses the guard or is added below with a reason. See docs/outbound-requests.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const PACKAGES = ['calc', 'cli', 'fmp12', 'plugins', 'scripts', 'server', 'store'];

/** What counts as opening a connection by hand. */
const RAW: [string, RegExp][] = [
  ['fetch(', /(?<![\w.$])fetch\s*\(/],
  ['globalThis.fetch', /\bglobalThis\.fetch\b/],
  ['fetch used as a value', /(?:\?\?|\|\||[^=!<>]=)\s*fetch\b(?!\s*[:(\w])/],
  ['fetch passed on', /(?:fetch\s*:\s*fetch\b|[(,]\s*fetch\s*[,)]|globalThis\s*\[)/],
  ['net.connect', /\b(?:net|tls)\.(?:connect|createConnection)\b/],
  ['new WebSocket', /\bnew WebSocket\b/],
];

interface Allowed {
  reason: string;
  /** The file must also use this: proof that its own connections are checked by the guard's lookup. */
  guardedBy?: RegExp;
}

const ALLOWED: Record<string, Allowed> = {
  'packages/scripts/src/net-guard.ts': { reason: 'the guard itself: the one place that makes a connection to a checked address' },
  'packages/scripts/src/ftp.ts': { reason: 'BaseElements\' FTP functions: an FTP conversation, not HTTP. The control and data sockets\' lookup is the guard\'s, a host written as an address is checked with hostRefusal, and the data connection goes only to the address the control connection reached', guardedBy: /socketLookup\(/ },
  'packages/server/src/smtp.ts': { reason: 'Send Mail: an SMTP conversation, not HTTP. The server is the administrator\'s; the socket\'s lookup is the guard\'s', guardedBy: /socketLookup\(/ },
  'packages/server/src/ldap.ts': { reason: 'LDAP sign-in: the directory is the administrator\'s; the socket\'s lookup is the guard\'s', guardedBy: /socketLookup\(/ },
  'packages/server/src/fms-sync.ts': { reason: 'sync with a FileMaker Server the administrator named (also checked in sync-console.ts); the request\'s lookup is the guard\'s', guardedBy: /socketLookup\(/ },
  'packages/server/src/fms-migrate.ts': { reason: 'reads a FileMaker Server\'s Admin API at an address the administrator gave; the request\'s lookup is the guard\'s', guardedBy: /socketLookup\(/ },
  'packages/server/src/image-embed.ts': { reason: 'two fixed public HTTPS hosts (api.voyageai.com, api.jina.ai) with no part chosen by a script or a person; the tests replace fetch' },
  'packages/server/src/cluster.ts': { reason: 'proxies to its own workers over a unix socket path: no network address is involved' },
  'packages/cli/src/ask-server.ts': { reason: 'the command line asking the server on this machine for its own folder, at the address in the folder\'s own access file' },
  'packages/cli/src/service.ts': { reason: 'the service installer\'s health check of the server it just installed, on this machine' },
  'packages/cli/src/doctor.ts': { reason: 'the doctor command checking the certificate at the address the administrator typed after --url (or the server on this machine): run from a command line, never by a script or a request' },
  'packages/store/src/javascript.ts': { reason: 'the JavaScript sandbox: this file REPLACES net, tls, dgram, dns and http2 connect functions with a refusal; it makes no connection' },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sources(full);
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [full] : [];
  });
}

/** The code without comments, so a word in a comment is not a call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{(,])\/\/.*$/gm, '$1');
}

/** `fetch(via: string, req: …): PluginResponse;` in an interface declares a method; it does not call one. */
const declaration = (line: string) => /^\s*fetch\s*\(.*\)\s*:\s*[\w<>[\]| .]+;?\s*$/.test(line);

const MODULES = 'https?|net|tls|http2|dgram|undici';
/** Names that only describe a request or make a server: importing them opens no connection. */
const HARMLESS = /^(?:type\s+\w+|[A-Z]\w*|createServer|STATUS_CODES|isIP|isIPv4|isIPv6|BlockList|SocketAddress|TLSSocket|createSecureContext|rootCertificates|getCiphers|checkServerIdentity|constants)$/;

/** Ways of reaching a connecting module: a namespace or default import, a named import of anything but types and servers, require() and import(). */
function connectingImports(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(new RegExp(`import\\s+(?!type\\b)([^;'"]*?)\\s+from\\s+['"\`](?:node:)?(${MODULES})['"\`]`, 'g'))) {
    const clause = m[1].trim();
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (!named) { hits.push(`${m[2]} imported whole`); continue; }
    const bad = named[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean).filter((x) => !HARMLESS.test(x));
    if (bad.length) hits.push(`${m[2]}: ${bad.join(', ')}`);
  }
  for (const m of text.matchAll(new RegExp(`(?:require|import)\\s*\\(\\s*['"\`](?:node:)?(${MODULES})['"\`]\\s*\\)(?!\\s*\\.\\s*[A-Z])`, 'g'))) hits.push(`${m[1]} loaded by call`);
  for (const m of text.matchAll(new RegExp(`import\\s+['"\`](?:node:)?(${MODULES})['"\`]`, 'g'))) hits.push(`${m[1]} imported for effect`);
  return hits;
}

function rawUses(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const pkg of PACKAGES) {
    for (const file of sources(join(root, 'packages', pkg, 'src'))) {
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      const hits: string[] = [];
      const joined = lines.join('\n');
      hits.push(...connectingImports(joined));
      for (const [what, re] of RAW) {
        lines.forEach((line, i) => { if (re.test(line) && !declaration(line)) hits.push(`${what} at line ${i + 1}`); });
      }
      if (hits.length) found.set(relative(root, file), hits);
    }
  }
  return found;
}

test('every raw connection in the server\'s code is the guard, or is listed with a reason', () => {
  const found = rawUses();
  const unlisted = [...found].filter(([file]) => !ALLOWED[file]).map(([file, hits]) => `${file}: ${hits.join(', ')}`);
  assert.deepEqual(unlisted, [], 'Use guardedFetch (or socketLookup for a socket) from packages/scripts/src/net-guard.ts, or add the file to ALLOWED with the reason it need not');
});

test('the list has no stale entries, and each one has a reason and, where it says so, the guard\'s lookup', () => {
  const found = rawUses();
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    assert.ok(found.has(file), `${file} no longer makes a raw connection: take it off the list`);
    assert.ok(allowed.reason.length > 20, `${file}: say why`);
    if (allowed.guardedBy) assert.match(readFileSync(join(root, file), 'utf8'), allowed.guardedBy, `${file} must use the guard's lookup for its connections`);
  }
});

test('the import scan sees every way in, and not a type', () => {
  for (const text of ["import https from 'node:https';", "import * as net from 'net';", 'import { request } from "http";', "const h = require('node:http');", "const m = await import('node:https');", "import { Socket, connect } from 'node:net';", "import 'node:tls';"]) {
    assert.ok(connectingImports(text).length, text);
  }
  for (const text of ["import type { IncomingMessage } from 'node:http';", "import { createServer, type Server } from 'node:http';", "const t = (x as import('node:https').Server);", "import { isIP } from 'node:net';"]) {
    assert.deepEqual(connectingImports(text), [], text);
  }
  assert.ok(RAW.some(([, re]) => re.test('send(fetch, 1)')) && RAW.some(([, re]) => re.test("globalThis['fetch']")));
});

test('a raw fetch is seen: the scan is not blind', () => {
  assert.match(code('const r = await fetch(url);'), /fetch\(/);
  assert.equal(code('// fetch(url)\n/* fetch(a) */ const x = 1;').includes('fetch'), false);
  assert.equal(RAW[0][1].test('await guardedFetch(url)'), false);
  assert.equal(RAW[0][1].test('this.o.fetch(url)'), false);
  assert.equal(RAW[2][1].test('const f = this.o.fetch ?? fetch;'), true);
  assert.equal(RAW[2][1].test('fetch: typeof fetch = webhookFetch;'), false);
  assert.equal(declaration('  fetch(via: string, req: { a: string }): PluginResponse;'), true);
});

test('every place that starts a script from a schedule, hook or automation hands it the administrator\'s network list', () => {
  for (const file of ['schedules.ts', 'inbound-hooks.ts', 'automations.ts']) {
    const text = readFileSync(join(root, 'packages/server/src', file), 'utf8');
    const starts = text.match(/\.\.\.itemNetwork\(opts, /g)?.length ?? 0;
    const passes = text.match(/networkAllow: opts\.networkAllow/g)?.length ?? 0;
    assert.ok(starts > 0, `${file}: expected scripts to be started here`);
    assert.equal(passes, starts, `${file}: ${starts} scripts started with the network switch, ${passes} given --allow-script-network-to`);
  }
});
