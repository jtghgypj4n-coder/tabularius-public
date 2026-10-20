// The security event log: every event kind belongs to exactly one group, each
// reads as a plain-English sentence with a severity, and Store.securityEvents
// returns only the security/authentication entries (never record changes),
// filterable by group, account and date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importFmp12, Store,
  SECURITY_EVENT_KINDS, SECURITY_EVENT_CATEGORIES,
  securityEventCategory, categoryKinds, securityEventSeverity, describeSecurityEvent,
  type AuditEntry,
} from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function fresh(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-security-events-'));
  const path = join(dir, 'Charts.sqlite');
  importFmp12(fixture, path);
  return { store: new Store(path), dir };
}

const entry = (kind: string, over: Partial<AuditEntry> = {}): AuditEntry =>
  ({ seq: 1, at: '2026-10-12T12:00:00.000Z', account: 'admin', kind: kind as AuditEntry['kind'], table: '', security: true, ...over });

test('every event kind belongs to exactly one category', () => {
  const seen = new Map<string, string>();
  for (const [cat, kinds] of Object.entries(SECURITY_EVENT_CATEGORIES)) {
    for (const k of kinds) {
      assert.ok(SECURITY_EVENT_KINDS.includes(k), `${k} (in ${cat}) is not a known event kind`);
      assert.ok(!seen.has(k), `${k} is in two categories: ${seen.get(k)} and ${cat}`);
      seen.set(k, cat);
    }
  }
  for (const k of SECURITY_EVENT_KINDS) assert.ok(seen.has(k), `${k} is in no category`);
  assert.equal(seen.size, SECURITY_EVENT_KINDS.length);
});

test('categoryKinds and securityEventCategory agree with the map', () => {
  assert.deepEqual(categoryKinds('Sign-in'), SECURITY_EVENT_CATEGORIES['Sign-in']);
  assert.deepEqual(categoryKinds('nope'), []);
  assert.equal(securityEventCategory('locked-out'), 'Sign-in');
  assert.equal(securityEventCategory('agent-added'), 'AI agents');
  assert.equal(securityEventCategory('create'), undefined); // a record-change kind
});

test('severity: failures alert, weakening changes notice, the rest info', () => {
  assert.equal(securityEventSeverity('sign-in-failed'), 'alert');
  assert.equal(securityEventSeverity('locked-out'), 'alert');
  assert.equal(securityEventSeverity('two-factor-disabled'), 'notice');
  assert.equal(securityEventSeverity('privilege-set-deleted'), 'notice');
  assert.equal(securityEventSeverity('sign-in'), 'info');
  assert.equal(securityEventSeverity('passkey-registered'), 'info');
});

test('describeSecurityEvent reads as a sentence per kind', () => {
  assert.equal(describeSecurityEvent(entry('sign-in')), 'Signed in');
  assert.equal(describeSecurityEvent(entry('sign-in', { changes: { factor: 'two-factor' } })), 'Signed in with a second factor');
  assert.equal(describeSecurityEvent(entry('locked-out')), 'Locked out after too many failed sign-ins');
  assert.equal(describeSecurityEvent(entry('account-added', { target: 'clerk' })), 'Account clerk added');
  assert.equal(describeSecurityEvent(entry('account-local-only-set', { target: 'clerk' })), 'clerk limited to this computer');
  assert.equal(describeSecurityEvent(entry('privilege-set-assigned', { target: 'clerk', changes: { privilegeSet: 'Data Entry' } })), 'clerk assigned the Data Entry privilege set');
  assert.equal(describeSecurityEvent(entry('api-token-issued', { target: 'bot', changes: { readOnly: true, layouts: ['Congress'], label: 'reader' } })), 'API token issued to bot "reader" (read-only; layouts: Congress)');
  assert.equal(describeSecurityEvent(entry('agent-added', { target: 'bot', changes: { needsApproval: true } })), 'AI agent bot added (its changes need approval)');
  assert.equal(describeSecurityEvent(entry('agent-change-proposed', { target: 'bot', changes: { kind: 'create', recordId: 7 } })), 'AI agent bot proposed a record create (#7)');
  assert.equal(describeSecurityEvent(entry('schema-changed', { changes: { ops: { addField: 2, renameTable: 1 } } })), 'Schema changed (Add field ×2, Rename table ×1)');
  // An unknown kind falls back to a readable title, never throws.
  assert.equal(describeSecurityEvent(entry('some-future-kind')), 'Some future kind');
});

test('Store.securityEvents returns only security entries, described and grouped', { skip }, () => {
  const { store, dir } = fresh();
  try {
    const full = store.privilegeSets().find((p) => p.id === 1)!.name;
    store.setPassword('Admin', 'pw', full);
    store.auditSignIn('Admin', '192.168.1.5', true);
    store.auditSignIn('mallory', '10.0.0.9', false);
    store.setAgentAccount('bot', saveBot(store), {});
    // A record change, which must NOT appear in the security log.
    store.create('Congress', { Name: 'a record' }, { account: 'Admin' });

    const events = store.securityEvents({ limit: 1000 });
    assert.ok(events.length >= 3);
    assert.ok(events.every((e) => e.security === true), 'only security entries');
    assert.ok(events.every((e) => typeof e.description === 'string' && e.description.length > 0));
    assert.ok(events.every((e) => e.category && e.severity));
    assert.ok(!events.some((e) => e.kind === 'create'), 'no record-change entries');

    // Category filter.
    const signins = store.securityEvents({ category: 'Sign-in', limit: 1000 });
    assert.ok(signins.length >= 2);
    assert.ok(signins.every((e) => e.category === 'Sign-in'));
    const failed = signins.find((e) => e.kind === 'sign-in-failed');
    assert.ok(failed && failed.severity === 'alert' && failed.from === '10.0.0.9');

    // Account filter (the actor).
    const byMallory = store.securityEvents({ account: 'mallory', limit: 1000 });
    assert.ok(byMallory.length === 1 && byMallory[0].kind === 'sign-in-failed');

    // Target filter (the object acted on) — the agent account just added.
    const aboutBot = store.securityEvents({ target: 'bot', limit: 1000 });
    assert.ok(aboutBot.some((e) => e.kind === 'agent-added'));

    // A date window in the future returns nothing.
    assert.equal(store.securityEvents({ since: '2099-01-01', limit: 1000 }).length, 0);

    // An unknown category means "none", never "all".
    assert.equal(store.securityEvents({ category: 'Nope', limit: 1000 }).length, 0);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

function saveBot(store: Store): string {
  store.savePrivilegeSet({
    name: 'Bot', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'],
  });
  return 'Bot';
}
