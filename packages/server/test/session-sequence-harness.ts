// Generated stores only. The model deliberately does not use the server's authorization decisions.
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, DataApi } from '../src/index.ts';
import { OAuthServer } from '../src/oauth.ts';
import { sessionPrivileges } from '../src/dataapi.ts';
import { LOCKOUT } from '../../store/src/index.ts';
import { expiryClock, ExpiryClock } from '../../store/src/clock.ts';
import { forgeAssertion, forgeRegistration, makeAuthenticator } from '../../store/test/forge-webauthn.ts';

export type Kind = 'basic' | 'oauth' | 'oauthCode' | 'exchange' | 'passkey' | 'token' | 'refresh' | 'logout' | 'raceLogout'
  | 'expire' | 'password' | 'selfPassword' | 'lock' | 'unlock' | 'disable' | 'enable' | 'revoke' | 'privilege' | 'editSet' | 'clockBack' | 'idlePolicy' | 'rollback' | 'legacyOAuth' | 'legacyCode' | 'surface' | 'selfPasswordToken';
export type Op = { kind: Kind; account: 0 | 1; address: 0 | 1 };
const names = ['alice', 'bob'];
const addresses = ['192.0.2.10', '192.0.2.11']; // Proxy identities; every socket connects to 127.0.0.1.
const REST = '/fmi/data/vLatest/databases/Sequence';
const secret = 'GENERATED_HIDDEN_SECRET';
type Credential = { token: string; account: number; kind: 'rest' | 'token' | 'oauth'; valid: boolean; writer: boolean; until: number; refresh?: string; refreshValid?: boolean; replacement?: Credential; rotatedAt?: number; used?: boolean };
export const op = (kind: Kind, account: 0 | 1 = 0, address: 0 | 1 = 0): Op => ({ kind, account, address });

export function generate(seed: number): Op[] {
  let state = seed >>> 0;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  // Each seed exercises every operation; the suffix varies interleavings, accounts and addresses.
  const prefix: Kind[] = ['basic', 'passkey', 'token', 'oauth', 'refresh', 'lock', 'unlock', 'privilege', 'basic', 'password', 'basic', 'raceLogout', 'token', 'revoke', 'disable', 'enable', 'oauth', 'expire', 'clockBack', 'idlePolicy', 'logout'];
  const kinds: Kind[] = ['basic', 'oauth', 'passkey', 'token', 'refresh', 'password', 'privilege', 'lock', 'unlock', 'disable', 'enable', 'revoke', 'logout', 'raceLogout', 'expire'];
  return [op('basic', 1, 1), ...prefix.map(kind => op(kind)), ...Array.from({ length: 12 }, () => op(kinds[next() % kinds.length], (next() % 2) as 0 | 1, (next() % 2) as 0 | 1))];
}

/** Bounded deletion shrinking. Keep the same invariant failure, not a different setup/transport error. */
export async function shrink(sequence: Op[], fails: (candidate: Op[]) => Promise<boolean>, budget = 12): Promise<Op[]> {
  let best = sequence;
  for (let width = Math.ceil(best.length / 2); width >= 1 && budget > 0; width = Math.floor(width / 2)) {
    for (let at = 0; at < best.length && budget > 0;) {
      const candidate = [...best.slice(0, at), ...best.slice(at + width)];
      if (!candidate.length) { at += width; continue; }
      budget--;
      if (await fails(candidate)) best = candidate;
      else at += width;
    }
  }
  return best;
}

/**
 * `checkEach: false` looks at every credential only after the last operation. Looking between operations ends a credential
 * the moment it is seen invalid, which hides a fix that is meant to keep it ended when nobody looked in between.
 */
export async function runSequence(t: TestContext, sequence: Op[], options: { checkEach?: boolean } = {}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'session-sequence-'));
  const bin = join(dir, 'bin'), marker = join(dir, 'forbidden-command');
  mkdirSync(bin);
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, command), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$SESSION_SEQUENCE_MARKER"\nexit 99\n', { mode: 0o755 });
  }
  const oldPath = process.env.PATH, oldMarker = process.env.SESSION_SEQUENCE_MARKER, oldBudget = process.env.TABULARIUS_REQUEST_BUDGET_MS;
  process.env.PATH = bin;
  process.env.SESSION_SEQUENCE_MARKER = marker;
  // Advancing the injected clock by an hour is not an hour of CPU starvation.
  // Network requests still have real 5-second deadlines and the test has a real runner deadline.
  process.env.TABULARIUS_REQUEST_BUDGET_MS = '0';
  let now = Date.now(), wall = now, mono = performance.now();
  const clock = new ExpiryClock(() => wall, () => mono, () => {});
  const clockMock = t.mock.method(expiryClock, 'now', () => clock.now());
  const monoMock = t.mock.method(performance, 'now', () => mono);
  const wallMock = t.mock.method(Date, 'now', () => wall);
  let api: DataApi | undefined;
  const originalHandle = DataApi.prototype.handle;
  const handleMock = t.mock.method(DataApi.prototype, 'handle', function (this: DataApi, ...args: Parameters<DataApi['handle']>) {
    api = this;
    return originalHandle.apply(this, args);
  });
  let served: Awaited<ReturnType<typeof serve>> | undefined;
  let sequenceIndex = -1;
  try {
    served = await serve({ dir, port: 0, watch: false, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'] });
    const { host, url } = served;
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const store = host.create('Sequence');
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Owner' }, { name: 'Value' }, { name: 'Secret' }] }]);
    for (const name of names) store.create('Items', { Owner: name, Value: `${name}-PRIVATE-DATA`, Secret: secret });
    for (const writer of [false, true]) store.savePrivilegeSet({ name: writer ? 'Writer' : 'Reader', aiVisible: { Items: ['Secret'] },
      records: { view: 'Owner = Get ( AccountName )', edit: writer ? 'Owner = Get ( AccountName )' : false, create: false, delete: false, fields: { Secret: 'none' } },
      layouts: 'viewOnly', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmrest', 'fmmcp'] });
    const accounts = names.map((name) => ({ name, password: `${name}-generated-password-0`, version: 0, active: true, writer: false, failures: [0, 0], blocked: [0, 0] }));
    const authenticators = names.map(() => makeAuthenticator('127.0.0.1', url));
    const counts = [0, 0];
    for (const [i, a] of accounts.entries()) {
      store.setPassword(a.name, a.password, 'Reader');
      const challenge = store.issueWebauthnChallenge('register', a.name);
      store.registerPasskey(a.name, forgeRegistration(authenticators[i], challenge), { rpId: '127.0.0.1', origin: url, challenge });
    }
    const credentials: Credential[] = [];
    const codes: { account: number; body: Record<string, string>; valid: boolean; until: number }[] = [];
    const secrets = new Set([secret, ...accounts.map(a => a.password)]);
    const addressFailures = [0, 0];
    const addressBlocked = [0, 0];
    const countAddressFailure = (address: number) => {
      if (addressBlocked[address] > mono) return;
      if (++addressFailures[address] >= LOCKOUT.addressAttempts) addressBlocked[address] = mono + LOCKOUT.lockMs;
    };
    const failure = (account: number, address: number) => {
      const a = accounts[account];
      if (a.blocked[address] <= mono && ++a.failures[address] >= LOCKOUT.attempts) a.blocked[address] = mono + LOCKOUT.lockMs;
      countAddressFailure(address);
    };
    const blocked = (account: number, address: number) => accounts[account].blocked[address] > mono || addressBlocked[address] > mono;
    let idleMinutes = 15;
    const request = async (path: string, method = 'GET', body?: unknown, authorization?: string, address = 0, form = false) => {
      const response = await fetch(url + path, { method, redirect: 'manual', signal: AbortSignal.timeout(5000),
        headers: { 'x-forwarded-for': addresses[address], 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...(authorization ? { authorization } : {}), ...(path === '/mcp' ? { accept: 'application/json, text/event-stream' } : {}) },
        ...(body === undefined ? {} : { body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) }) });
      const text = await response.text();
      const headers = JSON.stringify([...response.headers]);
      for (const value of secrets) assert.ok(!text.includes(value) && !headers.includes(value), 'secret leaked');
      let data: any;
      try { data = JSON.parse(text); } catch { data = undefined; }
      return { status: response.status, text, data, headers: response.headers };
    };
    const registered = await request('/oauth/register', 'POST', { client_name: 'Sequence', redirect_uris: [`${url}/callback`] });
    assert.equal(registered.status, 201);
    const client = registered.data.client_id;
    const bearer = (c: Credential) => { c.used = true; return `Bearer ${c.token}`; };
    const basic = (account: number, password = accounts[account].password) => `Basic ${Buffer.from(`${names[account]}:${password}`).toString('base64')}`;
    const add = (token: string, account: number, kind: Credential['kind'], refresh?: string) => {
      secrets.add(token);
      if (refresh) secrets.add(refresh);
      const credential: Credential = { token, account, kind, valid: true, writer: accounts[account].writer, until: kind === 'rest' ? mono + idleMinutes * 60_000 : now + (kind === 'oauth' ? 3600_000 : 120_000), refresh, refreshValid: !!refresh };
      credentials.push(credential);
      return credential;
    };
    const mcp = (c: Credential, id: number, address: number) => request('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: 'Sequence', layout: 'Items', recordId: id } } }, bearer(c), address);
    const invalidate = (account: number, includeService: boolean) => {
      for (const c of credentials) if (c.account === account && (includeService || c.kind !== 'token')) { c.valid = false; c.refreshValid = false; }
      for (const code of codes) if (code.account === account) code.valid = false;
    };
    const accountActive = (account: number) => accounts[account].active;
    const check = async () => {
      let active = 0;
      for (const c of credentials) {
        if ((c.kind === 'rest' ? mono > c.until : now >= c.until)) c.valid = false;
        for (let address = 0; address < 2; address++) {
          const reply = c.kind === 'oauth' ? await mcp(c, c.account + 1, address) : await request(REST + '/layouts/Items/records', 'GET', undefined, bearer(c), address);
          assert.ok(!reply.text.includes(`${names[1 - c.account]}-PRIVATE-DATA`), 'another account leaked');
          if (!c.valid) assert.equal(reply.status, 401, 'invalid credential accepted');
          else {
            assert.equal(reply.status, 200, `live credential refused: ${reply.status === 200 ? '' : reply.text}`);
            assert.ok(reply.text.includes(`${names[c.account]}-PRIVATE-DATA`), `own record missing: ${reply.text}`);
            if (c.kind === 'rest') c.until = mono + idleMinutes * 60_000;
            if (c.kind !== 'oauth') {
              const edit = await request(REST + `/layouts/Items/records/${c.account + 1}`, 'PATCH', { fieldData: { Value: `${names[c.account]}-PRIVATE-DATA` } }, bearer(c), address);
              if (c.writer) assert.equal(edit.data?.messages?.[0]?.code, '0', 'reauthenticated writer refused');
              else assert.notEqual(edit.data?.messages?.[0]?.code, '0', 'session gained write privilege');
            }
            const other = c.kind === 'oauth' ? await mcp(c, 2 - c.account, address) : await request(REST + `/layouts/Items/records/${2 - c.account}`, 'GET', undefined, bearer(c), address);
            assert.ok(!other.text.includes(`${names[1 - c.account]}-PRIVATE-DATA`), 'another account leaked');
          }
        }
        if (c.refresh && !c.refreshValid) {
          // A retired refresh token. Inside the 45-second window, and while neither replacement token has been used, it gets the
          // same replacement pair back; otherwise it is a replay: refused, and the whole family is revoked.
          const next = c.replacement;
          const retry = !!next && next.refreshValid === true && next.valid && !next.used && accountActive(next.account) && now - (c.rotatedAt ?? 0) < 45_000;
          if (retry) { secrets.delete(next!.token); secrets.delete(next!.refresh!); }
          const replay = await request('/oauth/token', 'POST', { grant_type: 'refresh_token', refresh_token: c.refresh, client_id: client }, undefined, 1, true);
          if (retry) {
            secrets.add(next!.token); secrets.add(next!.refresh!);
            assert.equal(replay.status, 200, 'the retry inside the window was refused');
            assert.equal(replay.data.access_token, next!.token, 'the retry returned another access token');
            assert.equal(replay.data.refresh_token, next!.refresh, 'the retry returned another refresh token');
          } else {
            assert.equal(replay.status, 400, 'invalid refresh replay accepted');
            for (let family = next; family; family = family.replacement) { family.valid = false; family.refreshValid = false; }
          }
        }
        if (c.kind !== 'oauth') {
          const lockId = 100 + credentials.indexOf(c);
          if (c.valid) {
            active++;
            store.locks.acquire('Items', lockId, c.token, names[c.account]);
            store.locks.view('Items', lockId, c.token, names[c.account]);
          } else {
            assert.equal(store.locks.holder('Items', lockId), undefined, 'invalid session retained a lock');
            assert.ok(!store.locks.viewers().some(v => v.owner === c.token), 'invalid session retained presence');
          }
        }
      }
      if (api) {
        assert.equal(api.sessionCount, active, 'active session counter drift');
        assert.equal(api.list().length, active, 'active session list drift');
      }
      for (const a of accounts) for (let address = 0; address < 2; address++) {
        const i = names.indexOf(a.name);
        assert.equal(!!store.lockedOut(a.name, addresses[address]), blocked(i, address), 'lockout counter drift');
        // Inspect counters, never use them to decide the oracle's next state.
        const failures = (store as unknown as { failures: Map<string, { count: number }> }).failures;
        assert.equal(failures.get(`${a.name}\0${addresses[address]}`)?.count ?? 0, a.failures[address], 'account failure count drift');
        assert.equal(failures.get(`\0address\0${addresses[address]}`)?.count ?? 0, addressFailures[address], 'address failure count drift');
      }
      assert.equal(existsSync(marker), false, 'forbidden child command invoked');
    };
    for (const action of sequence) {
      sequenceIndex++;
      const { kind, account, address } = action;
      const a = accounts[account];
      const last = (predicate: (c: Credential) => boolean) => credentials.findLast(c => c.account === account && predicate(c));
      switch (kind) {
        case 'basic': {
          const r = await request(REST + '/sessions', 'POST', {}, basic(account), address);
          const allowed = a.active && !blocked(account, address);
          assert.equal(r.status, allowed ? 200 : 401, 'Basic sign-in eligibility');
          if (allowed) { a.failures[address] = 0; add(r.data.response.token, account, 'rest'); }
          else failure(account, address);
          break;
        }
        case 'passkey': {
          const start = await request(REST + '/sessions/passkey', 'POST', { account: a.name }, undefined, address);
          const challenge = start.data.response.challenge;
          const body = { response: { ...forgeAssertion(authenticators[account], challenge, ++counts[account]), challenge } };
          const r = await request(REST + '/sessions/passkey', 'POST', body, undefined, address);
          const allowed = a.active && addressBlocked[address] <= mono;
          assert.equal(r.status, allowed ? 200 : 401, 'passkey sign-in eligibility');
          if (allowed) add(r.data.response.token, account, 'rest');
          else countAddressFailure(address);
          const replay = await request(REST + '/sessions/passkey', 'POST', body, undefined, address);
          assert.equal(replay.status, 401, 'passkey assertion replay');
          countAddressFailure(address);
          break;
        }
        case 'token':
          if (a.active) add(store.createApiToken(a.name, { surfaces: ['fmrest'], expires: new Date(now + 120_000) }), account, 'token');
          break;
        case 'oauth': case 'oauthCode': {
          const verifier = 'sequence-verifier-'.repeat(4);
          const signed = await request('/oauth/authorize', 'POST', { client_id: client, redirect_uri: `${url}/callback`, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${url}/mcp`, database: 'Sequence', account: a.name, password: a.password }, undefined, address, true);
          if (a.active && !blocked(account, address)) {
            assert.equal(signed.status, 302, `OAuth sign-in eligibility: ${/<p class="error"[^>]*>(.*?)<\/p>/.exec(signed.text)?.[1] ?? 'no error text'}`);
            a.failures[address] = 0;
            const code = new URL(signed.headers.get('location')!).searchParams.get('code')!;
            secrets.add(code);
            const body = { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client, redirect_uri: `${url}/callback` };
            if (kind === 'oauthCode') { codes.push({ account, body, valid: true, until: now + 60_000 }); break; }
            const r = await request('/oauth/token', 'POST', body, undefined, address, true);
            assert.equal(r.status, 200);
            add(r.data.access_token, account, 'oauth', r.data.refresh_token);
            assert.equal((await request('/oauth/token', 'POST', body, undefined, address, true)).status, 400, 'OAuth code replay');
          } else { assert.notEqual(signed.status, 302, 'OAuth ineligible account'); failure(account, address); }
          break;
        }
        case 'exchange': {
          const code = codes.findLast(c => c.account === account);
          if (!code) break;
          const r = await request('/oauth/token', 'POST', code.body, undefined, address, true);
          assert.equal(r.status, code.valid && code.until > now ? 200 : 400, 'authorization code eligibility');
          code.valid = false;
          if (r.status === 200) add(r.data.access_token, account, 'oauth', r.data.refresh_token);
          break;
        }
        case 'refresh': {
          const c = last(c => !!c.refresh);
          if (!c) break;
          const r = await request('/oauth/token', 'POST', { grant_type: 'refresh_token', refresh_token: c.refresh!, client_id: client }, undefined, address, true);
          assert.equal(r.status, c.refreshValid ? 200 : 400, 'refresh eligibility');
          c.valid = false; c.refreshValid = false;
          if (r.status === 200) { c.replacement = add(r.data.access_token, account, 'oauth', r.data.refresh_token); c.rotatedAt = now; }
          break;
        }
        case 'logout': case 'raceLogout': {
          const c = last(c => c.kind === 'rest');
          if (!c) break;
          let ended = 0;
          const onEnd = (token: string) => { if (token === c.token) ended++; };
          api!.endListeners.add(onEnd);
          const replies = await Promise.all(Array.from({ length: kind === 'raceLogout' ? 2 : 1 }, (_, i) => request(REST + `/sessions/${c.token}`, 'DELETE', undefined, undefined, (address + i) % 2)));
          for (const r of replies) assert.equal(r.status, 200);
          assert.equal(ended, c.valid ? 1 : 0, 'logout cleanup must run once');
          api!.endListeners.delete(onEnd);
          c.valid = false;
          break;
        }
        case 'password': case 'selfPassword': case 'selfPasswordToken': {
          // A service token may change its account's password through the Data API too; it stays valid either way.
          const current = last(c => c.kind === (kind === 'selfPasswordToken' ? 'token' : 'rest') && c.valid);
          if (kind !== 'password' && (!current || !a.active || blocked(account, address))) break;
          const old = a.password;
          a.password = `${a.name}-generated-password-${++a.version}`; secrets.add(a.password);
          if (kind !== 'password') {
            assert.equal((await request(REST + '/sessions', 'PATCH', { oldPassword: old, newPassword: a.password }, bearer(current!), address)).status, 200, 'own password repair');
          } else store.setPassword(a.name, a.password);
          a.failures = [0, 0]; a.blocked = [0, 0];
          invalidate(account, false); // Service tokens are independent credentials; OAuth grants are password-derived.
          if (kind !== 'password') current!.valid = true; // The request just reauthenticated with the old secret.
          for (let from = 0; from < 2; from++) {
            assert.equal((await request(REST + '/sessions', 'POST', {}, basic(account, old), from)).status, 401, 'old password accepted');
            failure(account, from);
          }
          break;
        }
        case 'lock':
          for (let i = a.failures[address]; i < LOCKOUT.attempts && !blocked(account, address); i++) {
            assert.equal((await request(REST + '/sessions', 'POST', {}, basic(account, 'wrong-generated-password'), address)).status, 401);
            failure(account, address);
          }
          break;
        case 'unlock':
          store.unlock(a.name); a.failures = [0, 0]; a.blocked = [0, 0]; break;
        case 'disable':
          store.setAccountActive(a.name, false); a.active = false; invalidate(account, true); break;
        case 'enable':
          store.setAccountActive(a.name, true); a.active = true; break;
        case 'privilege':
          a.writer = !a.writer; store.setAccountPrivilegeSet(a.name, a.writer ? 'Writer' : 'Reader'); invalidate(account, true); break;
        case 'editSet': {
          const set = store.privilegeSet(a.writer ? 'Writer' : 'Reader')!;
          store.savePrivilegeSet({ ...set, exporting: set.exporting === false });
          for (const [i, other] of accounts.entries()) if (other.writer === a.writer) invalidate(i, true);
          break;
        }
        case 'rollback': {
          const mark = store.securityToken();
          assert.throws(() => store.applySecurity([
            { op: 'setAccount', name: a.name, password: 'generated-rollback-password', privilegeSet: a.writer ? 'Reader' : 'Writer' },
            { op: 'setAccount', name: 'nonexistent-account', privilegeSet: 'Reader' },
          ]));
          assert.equal(store.securityToken(), mark, 'failed security change committed an audit event');
          break;
        }
        case 'surface': {
          const set = store.privilegeSet(a.writer ? 'Writer' : 'Reader')!;
          store.savePrivilegeSet({ ...set, extendedPrivileges: [...set.extendedPrivileges, 'fmxdbc'] });
          for (const c of credentials) if (accounts[c.account].writer === a.writer) {
            if (c.kind !== 'rest') { c.valid = false; c.refreshValid = false; }
            else if (c.valid) {
              const request = { headers: { authorization: bearer(c) } } as IncomingMessage;
              assert.equal(sessionPrivileges(store, api!.authorize(request, 'Sequence')).has('fmxdbc'), false, 'open session gained an extended privilege');
            }
          }
          const fresh = await request(REST + '/sessions', 'POST', {}, basic(account), address);
          assert.equal(fresh.status, 200);
          a.failures[address] = 0;
          add(fresh.data.response.token, account, 'rest');
          const req = { headers: { authorization: `Bearer ${fresh.data.response.token}` } } as IncomingMessage;
          assert.equal(sessionPrivileges(store, api!.authorize(req, 'Sequence')).has('fmxdbc'), true, 'reauthentication did not acquire the new extended privilege');
          break;
        }
        case 'legacyOAuth': {
          const c = last(c => c.kind === 'oauth' && c.valid && !!c.refresh && !!c.refreshValid);
          if (!c) break;
          // A grant as an older version stored it: labelled service, its refresh row bound to the password only.
          const id = c.token.split('.')[0].slice(5);
          store.sql.prepare("UPDATE _fm_api_tokens SET provenance = 'service' WHERE id = ?").run(id);
          const row = store.sql.prepare('SELECT rowid AS id, password_hash FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(names[c.account]) as { id: number; password_hash: string | null };
          const sha = (v: string) => createHash('sha256').update(v).digest('hex');
          const oauthDb = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
          oauthDb.prepare('UPDATE refresh SET password = ? WHERE hash = ?').run(sha(`${row.id}:${row.password_hash ?? ''}`), sha(c.refresh!));
          oauthDb.close();
          // The startup migration keeps the grant connected and makes it end with a password reset, like any other.
          new OAuthServer(host, dir).close();
          assert.equal((store.sql.prepare('SELECT provenance FROM _fm_api_tokens WHERE id = ?').get(id) as { provenance: string }).provenance, 'delegated');
          break;
        }
        case 'legacyCode': {
          // A code as an older version stored it: bound to the account row and its password hash only, with no authority in the mark.
          const code = codes.findLast(c => c.account === account && c.valid);
          if (!code) break;
          const row = store.sql.prepare('SELECT rowid AS id, password_hash FROM _fm_accounts WHERE name = ? COLLATE NOCASE').get(a.name) as { id: number; password_hash: string | null };
          const sha = (v: string) => createHash('sha256').update(v).digest('hex');
          const oauthDb = new DatabaseSync(join(dir, '.openhbam-oauth.sqlite'));
          oauthDb.prepare('UPDATE codes SET mark = ? WHERE hash = ?').run(sha(`${row.id}:${row.password_hash ?? ''}`), sha(code.body.code));
          oauthDb.close();
          code.valid = false;
          break;
        }
        case 'revoke': {
          const c = last(c => c.kind !== 'rest');
          if (c) { store.revokeApiToken(c.token.split('.')[0].slice(5)); c.valid = false; c.refreshValid = false; }
          break;
        }
        case 'expire':
          now += 3600_001; wall += 3600_001; mono += 3600_001;
          for (const a of accounts) { a.failures = [0, 0]; a.blocked = [0, 0]; }
          addressFailures.fill(0); addressBlocked.fill(0); break;
        case 'clockBack':
          // Elapsed time remains forward; absolute deadlines must not resurrect a captured credential.
          wall -= 86_400_000; break;
        case 'idlePolicy':
          for (const c of credentials) if (c.valid && c.kind === 'rest') c.until += ((idleMinutes === 15 ? 1 : 15) - idleMinutes) * 60_000;
          idleMinutes = idleMinutes === 15 ? 1 : 15;
          host.config.setSessionIdleMinutes(idleMinutes);
          now += 120_001; wall += 120_001; mono += 120_001;
          break;
      }
      if (options.checkEach !== false || action === sequence[sequence.length - 1]) await check();
    }
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { sequenceIndex });
    throw error;
  } finally {
    if (served) await new Promise<void>(resolve => { served!.server.close(() => resolve()); served!.server.closeAllConnections(); });
    handleMock.mock.restore(); clockMock.mock.restore(); monoMock.mock.restore(); wallMock.mock.restore();
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldMarker === undefined) delete process.env.SESSION_SEQUENCE_MARKER; else process.env.SESSION_SEQUENCE_MARKER = oldMarker;
    if (oldBudget === undefined) delete process.env.TABULARIUS_REQUEST_BUDGET_MS; else process.env.TABULARIUS_REQUEST_BUDGET_MS = oldBudget;
    const invoked = existsSync(marker);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(invoked, false, 'forbidden child command invoked');
  }
}
