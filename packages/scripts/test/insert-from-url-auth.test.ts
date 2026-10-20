// Insert from URL with cURL's --digest, --anyauth and --basic. A stand-in server checks Digest responses with its own
// hashing (not the engine's), so a wrong response is refused as a real server would. No network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, parseCurl, type RunOptions } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

let dir: string;
let store: Store;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-url-auth-'));
  createStore(join(dir, 'A.sqlite'));
  store = new Store(join(dir, 'A.sqlite'), 'A');
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

// The first Insert from URL step takes these cURL options (a calculation, as in the step's dialog).
const run = (text: string, opts: RunOptions = {}, curl?: string) => {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  if (curl !== undefined) {
    const step = steps.find((s) => s.stepId === 160)!;
    step.params = { ...step.params, slots: { 129: JSON.stringify(curl) } } as never;
  }
  return runScript(store, { id: 9999, name: 'test', steps } as Script, { ...opts, [TEST_ONLY_CUSTOM_FETCH]: true });
};

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface Seen { method: string; auth: string | null; body: string }
/** A server that wants user "ann" with password "secret"; `offer` is its WWW-Authenticate value. */
function server(offer: string[], seen: Seen[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization');
    seen.push({ method: init?.method ?? 'GET', auth, body: typeof init?.body === 'string' ? init.body : '' });
    const challenge = () => {
      const h = new Headers();
      for (const o of offer) h.append('www-authenticate', o);
      return new Response('denied', { status: 401, headers: h });
    };
    if (!auth) return challenge();
    if (auth.startsWith('Basic ')) return Buffer.from(auth.slice(6), 'base64').toString() === 'ann:secret' ? new Response('welcome (basic)') : challenge();
    if (!auth.startsWith('Digest ')) return challenge();
    const f = Object.fromEntries([...auth.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map((m) => [m[1], m[2] ?? m[3]]));
    const hash = f.algorithm === 'SHA-256' ? sha256 : md5;
    const at = new URL(String(url));
    if (f.username !== 'ann' || f.uri !== at.pathname + at.search || f.nonce !== 'abc123') return challenge();
    const ha1 = hash(`ann:${f.realm}:secret`);
    const ha2 = hash(`${init?.method ?? 'GET'}:${f.uri}`);
    const expect = f.qop ? hash(`${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:${f.qop}:${ha2}`) : hash(`${ha1}:${f.nonce}:${ha2}`);
    return f.response === expect ? new Response('welcome (digest)') : challenge();
  }) as typeof fetch;
}

const DIGEST = 'Digest realm="files", nonce="abc123", qop="auth", algorithm=MD5';
const BASIC = 'Basic realm="files"';
const runGet = ([text, curl]: readonly [string, string], opts: RunOptions) => run(text, opts, curl);
const URL1 = 'https://example.com/dir/page?x=1';
const get = (opts: string, user = 'ann:secret') => [`Insert from URL [ $r ; "${URL1}" ]\nExit Script [ Text Result: $r ]`, `${opts} -u ${user}`] as const;

test('--digest asks without credentials, then answers the Digest challenge once', async () => {
  const seen: Seen[] = [];
  const r = await runGet(get('--digest'), { network: server([DIGEST], seen) });
  assert.equal(r.error, 0);
  assert.equal(r.result, 'welcome (digest)');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].auth, null, 'the first request carries no credentials');
  assert.match(seen[1].auth!, /^Digest username="ann", realm="files"/);
});

test('--digest with SHA-256, and a POST body sent again on the second request', async () => {
  const seen: Seen[] = [];
  const r = await run(`Insert from URL [ $r ; "${URL1}" ]
    Exit Script [ Text Result: $r ]`, { network: server(['Digest realm="files", nonce="abc123", qop="auth", algorithm=SHA-256'], seen) }, '--digest -u ann:secret -d a=1');
  assert.equal(r.result, 'welcome (digest)');
  assert.deepEqual(seen.map((s) => [s.method, s.body]), [['POST', 'a=1'], ['POST', 'a=1']]);
});

test('a wrong password is tried once, and the 401 is what comes back', async () => {
  const seen: Seen[] = [];
  const r = await runGet(get('--digest', 'ann:wrong'), { network: server([DIGEST], seen) });
  assert.equal(r.error, 0);
  assert.equal(r.result, 'denied');
  assert.equal(seen.length, 2, 'one retry, not a loop');
});

test('--digest does not fall back to Basic, and a server that offers only Basic is not answered', async () => {
  const seen: Seen[] = [];
  const r = await runGet(get('--digest'), { network: server([BASIC], seen) });
  assert.equal(r.result, 'denied');
  assert.equal(seen.length, 1);
});

test('--anyauth takes Digest when it is offered, Basic when that is all there is, and nothing otherwise', async () => {
  let seen: Seen[] = [];
  assert.equal((await runGet(get('--anyauth'), { network: server([BASIC, DIGEST], seen) })).result, 'welcome (digest)');
  assert.match(seen[1].auth!, /^Digest /, 'Digest preferred even though Basic came first');
  seen = [];
  assert.equal((await runGet(get('--anyauth'), { network: server([BASIC], seen) })).result, 'welcome (basic)');
  assert.match(seen[1].auth!, /^Basic /);
  seen = [];
  assert.equal((await runGet(get('--anyauth'), { network: server(['Bearer realm="files"'], seen) })).result, 'denied');
  assert.equal(seen.length, 1);
});

test('-u alone, and --basic, send Basic with the first request; the last of --basic, --digest and --anyauth wins', async () => {
  let seen: Seen[] = [];
  assert.equal((await runGet(get('', 'ann:wrong'), { network: server([DIGEST], seen) })).result, 'denied');
  assert.match(seen[0].auth!, /^Basic /);
  assert.equal(seen.length, 1, 'no second try without --digest or --anyauth');
  seen = [];
  assert.equal((await runGet(get('--digest --basic'), { network: server([BASIC], seen) })).result, 'welcome (basic)');
  assert.equal(seen.length, 1);
  assert.match(seen[0].auth!, /^Basic /);
  assert.deepEqual(parseCurl('--basic --digest -u a:b', () => undefined).authMode, 'digest');
  assert.equal(parseCurl('--digest --basic -u a:b', () => undefined).authMode, undefined);
  assert.equal(parseCurl('-u a:b --digest', () => undefined).user, 'a:b', 'the order of the options does not matter');
});

test('in outbound test mode the Digest retry stays on the allowed host and the outbox keeps no credentials', async () => {
  const seen: Seen[] = [];
  const entries: unknown[] = [];
  const r = await runGet(get('--digest'), { outbound: { allowHosts: ['example.com'], record: (e) => entries.push(e), fetch: server([DIGEST], seen) } });
  assert.equal(r.result, 'welcome (digest)');
  assert.equal(seen.length, 2);
  assert.equal(entries.length, 1);
  assert.equal((entries[0] as { status: number }).status, 200);
  assert.doesNotMatch(JSON.stringify(entries), /secret|Digest|nonce/);
});
