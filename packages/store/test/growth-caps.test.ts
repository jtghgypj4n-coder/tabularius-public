// Growth caps (decision r28-03): an account holds at most 1,000 working API tokens, and an approval-gated agent at most
// 500 waiting proposals. Past the cap the call is refused (812) with a message that says the limit and what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, StoreError, PendingApprovalError, MAX_API_TOKENS_PER_ACCOUNT, MAX_PENDING_PER_AGENT } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function fresh(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-growth-caps-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  return { store: new Store(path), dir };
}

const tokenRow = (store: Store, id: string, account: string, expires: string | null, created = new Date().toISOString()) =>
  store.sql.prepare('INSERT INTO _fm_api_tokens (id, account, token_hash, read_only, created, expires, provenance) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(id, account, `hash-${id}`, created, expires, 'service');

test('an account holds at most 1,000 working API tokens; the next one is refused with what to do', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    store.setPassword('other', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    assert.equal(MAX_API_TOKENS_PER_ACCOUNT, 1000);
    for (let i = 0; i < MAX_API_TOKENS_PER_ACCOUNT - 1; i++) tokenRow(store, `t${i}`, i % 2 ? 'clerk' : 'CLERK', null);
    store.createApiToken('clerk', { label: 'the 1,000th' });
    assert.throws(() => store.createApiToken('clerk', { label: 'the 1,001st' }),
      (e) => e instanceof StoreError && e.code === 812 && /1,000/.test(e.message) && /revoke/i.test(e.message));
    assert.throws(() => store.createApiToken('Clerk'), /1,000/, 'the account name is matched as sign-in matches it');
    // Another account has its own allowance.
    store.createApiToken('other');
    // Revoking one frees a place.
    assert.equal(store.revokeApiToken('t0'), true);
    store.createApiToken('clerk', { label: 'room again' });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tokens that no longer work do not count, and long-expired ones are removed', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.setPassword('clerk', 'pw', store.privilegeSets().find((p) => p.id === 1)!.name);
    const day = 86_400_000;
    for (let i = 0; i < MAX_API_TOKENS_PER_ACCOUNT - 1; i++) tokenRow(store, `e${i}`, 'clerk', new Date(Date.now() - (i % 2 ? 40 : 2) * day).toISOString(), new Date(Date.now() - 90 * day).toISOString());
    store.createApiToken('clerk');
    store.createApiToken('clerk');
    const left = store.apiTokens().filter((t) => t.account === 'clerk');
    assert.equal(left.length < MAX_API_TOKENS_PER_ACCOUNT, true);
    assert.equal(left.some((t) => t.id.startsWith('e') && Date.parse(t.expires!) < Date.now() - 30 * day), false, 'expired for over 30 days: removed');
    assert.equal(left.some((t) => t.id === 'e0'), true, 'expired two days ago: still listed');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an approval-gated agent has at most 500 proposals waiting; the 501st is refused', { skip }, () => {
  const { store, dir } = fresh();
  try {
    store.savePrivilegeSet({
      name: 'Bot', records: { view: true, edit: true, create: true, delete: true },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmmcp', 'fmrest'],
    });
    store.setAgentAccount('bot', 'Bot', { needsApproval: true });
    store.setAgentAccount('bot2', 'Bot', { needsApproval: true });
    const p = store.privileges('bot');
    assert.equal(MAX_PENDING_PER_AGENT, 500);
    const insert = store.sql.prepare('INSERT INTO _fm_pending (at, agent, kind, layout, tbl, summary) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < MAX_PENDING_PER_AGENT - 1; i++) insert.run(new Date().toISOString(), i % 2 ? 'bot' : 'BOT', 'create', 'Congress', 'Congress', 'filler');
    assert.throws(() => store.create('Congress', { Name: 'the 500th' }, { privileges: p, account: 'bot' }), (e) => e instanceof PendingApprovalError);
    assert.equal(store.pendingChanges().filter((c) => c.agent.toLowerCase() === 'bot').length, MAX_PENDING_PER_AGENT);
    assert.throws(() => store.create('Congress', { Name: 'the 501st' }, { privileges: p, account: 'bot' }),
      (e) => e instanceof StoreError && !(e instanceof PendingApprovalError) && e.code === 812 && /500/.test(e.message) && /approve or reject/i.test(e.message));
    assert.equal(store.pendingChanges().length, MAX_PENDING_PER_AGENT, 'nothing more was written');
    // Another agent has its own allowance, and deciding one proposal makes room.
    assert.throws(() => store.create('Congress', { Name: 'by bot2' }, { privileges: store.privileges('bot2'), account: 'bot2' }), (e) => e instanceof PendingApprovalError);
    store.rejectPending(store.pendingChanges()[0].id, 'Admin');
    assert.throws(() => store.create('Congress', { Name: 'room again' }, { privileges: p, account: 'bot' }), (e) => e instanceof PendingApprovalError);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
