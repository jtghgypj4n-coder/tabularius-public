import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, StoreError, writer, endTransaction, securityEventCategory, securityEventSeverity, describeSecurityEvent, type Transaction } from '../src/index.ts';
import { captureAccessDenial, type AccessDenial, type DenialAudit } from '../src/access-denial.ts';

const audit: DenialAudit = { code: 200, surface: 'web', identifier: 'request', origin: 'direct', capturedAt: '2026-10-14T12:00:00.000Z' };
function setup(t: TestContext, name = 'Owner') {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-denial-audit-'));
  createStore(join(dir, `${name}.sqlite`));
  const s = new Store(join(dir, `${name}.sqlite`), name);
  t.after(() => { s.close(); rmSync(dir, { recursive: true }); });
  s.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'A' }, { name: 'Secret' }] }]);
  const id = s.create('T', { A: 'row-label-sentinel', Secret: 'hidden-row-sentinel' }).recordId;
  s.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: 'Secret = "formula-input-sentinel"', create: false, delete: false }, layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [] });
  s.setPassword('clerk', 'pw', 'Clerk');
  const denial = (account = 'clerk'): AccessDenial => {
    try { s.update('T', id, { A: 'submitted-sentinel' }, undefined, { privileges: s.privileges(account) }); }
    catch (e) { assert.ok(e instanceof StoreError && e.denial); return e.denial; }
    assert.fail('expected denial');
  };
  const events = () => s.securityEvents({ kind: 'privilege-denied', limit: 1000 });
  return { s, id, denial, events };
}

test('explicit metadata projection, category and severity; captured account and set survive later changes', (t) => {
  const { s, denial, events } = setup(t);
  const d = denial();
  s.setPassword('clerk', 'pw', '[Full Access]');
  s.recordPrivilegeDenied(d, audit);
  const [event] = events();
  assert.equal(event.account, 'clerk'); assert.equal(event.target, 'Clerk');
  assert.equal(event.table, ''); assert.equal(event.recordId, undefined); assert.equal(event.security, true);
  assert.equal(event.from, 'web');
  assert.equal(securityEventCategory(event.kind), 'Privilege sets'); assert.equal(securityEventSeverity(event.kind), 'notice');
  assert.match(describeSecurityEvent(event), /Edit refused.*Clerk.*records.edit/);
  const json = JSON.stringify(event);
  for (const value of ['row-label-sentinel', 'hidden-row-sentinel', 'submitted-sentinel', 'formula-input-sentinel', 'Secret =', s.path]) assert.ok(!json.includes(value), value);
  assert.deepEqual(Object.keys(event.changes!).sort(), ['capturedAt', 'code', 'identifier', 'location', 'operation', 'origin', 'outcome', 'permission', 'policyFingerprint', 'privilegeSet', 'ruleKind', 'source', 'surface', 'version'].sort());
});

test('ten minute repeats, independent accounts, surfaces, owners and changed policy fingerprints', (t) => {
  const a = setup(t), b = setup(t, 'Other');
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(performance, 'now', () => now - 1_800_000_000_000);
  const d = a.denial();
  a.s.recordPrivilegeDenied(d, audit); a.s.recordPrivilegeDenied(d, audit);
  a.s.recordPrivilegeDenied(d, { ...audit, surface: 'mcp' });
  a.s.setPassword('other', 'pw', 'Clerk'); a.s.recordPrivilegeDenied(a.denial('other'), audit);
  b.s.recordPrivilegeDenied(b.denial(), audit);
  assert.equal(a.events().length, 3); assert.equal(b.events().length, 1);
  now += 600_000; a.s.recordPrivilegeDenied(d, audit); assert.equal(a.events().length, 4);
  a.s.savePrivilegeSet({ ...a.s.privilegeSet('Clerk')!, records: { view: true, edit: false, create: false, delete: false } });
  a.s.recordPrivilegeDenied(a.denial(), audit); assert.equal(a.events().length, 5);
});

test('key churn has a separate rate budget and bounded deterministic eviction', (t) => {
  const { s, denial, events } = setup(t);
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(performance, 'now', () => now - 1_800_000_000_000);
  const d = denial();
  // Distinct captured accounts exercise recorder bounds without password hashing.
  for (let i = 0; i < 560; i++) {
    if (i && i % 60 === 0) now += 60_001;
    const account = `account-${i}`;
    s.recordPrivilegeDenied(captureAccessDenial({ ...d }, s, account), audit);
  }
  assert.equal(events().length, 560); assert.equal(s.privilegeDeniedStats().keys, 500);
  for (let i = 0; i < 80; i++) s.recordPrivilegeDenied(d, { ...audit, surface: i % 2 ? 'mcp' : 'data-api' });
  assert.ok(s.privilegeDeniedStats().keys <= 500);
  // A new file has only sixty accepted keys in any minute.
  const b = setup(t, 'Budget');
  for (let i = 0; i < 65; i++) {
    b.s.recordPrivilegeDenied(captureAccessDenial({ ...d }, b.s, `u${i}`), audit);
  }
  assert.equal(b.events().length, 60); assert.equal(b.s.privilegeDeniedStats().drops, 5);
});

test('unrelated transaction cannot absorb the deferred event, repeats reserve its key, rollback releases it', async (t) => {
  const { s, id, denial, events } = setup(t);
  const d = denial(); const tx: Transaction = { files: new Map() };
  writer.run({ transaction: { open: tx } }, () => s.update('T', id, { A: 'rolled-back-sentinel' }));
  s.recordPrivilegeDenied(d, audit); s.recordPrivilegeDenied(d, audit);
  assert.equal(events().length, 0); assert.equal(s.privilegeDeniedStats().pending, 1);
  endTransaction(tx, false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events().length, 1); assert.equal(s.get('T', id).fieldData.A, 'row-label-sentinel');
});

test('expired pending events drop, trials are suppressed, and append failures retry without claiming persistence', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_800_000_000_000);
  const { s, id, denial, events } = setup(t);
  const d = denial(); const trial = s.trial(); s.recordPrivilegeDenied(denial(), audit); trial.undo();
  assert.equal(events().length, 0);
  const tx: Transaction = { files: new Map() };
  writer.run({ transaction: { open: tx } }, () => s.update('T', id, { A: 'rolled-back' }));
  s.recordPrivilegeDenied(d, audit); t.mock.timers.tick(600_000);
  assert.equal(s.privilegeDeniedStats().pending, 0); assert.equal(s.privilegeDeniedStats().drops, 1);
  endTransaction(tx, false);
  const logger = s as unknown as { logSecurity: (...args: unknown[]) => void };
  const original = logger.logSecurity.bind(s);
  logger.logSecurity = () => { throw new Error('logger-exception-sentinel'); };
  s.recordPrivilegeDenied(d, audit); t.mock.timers.tick(1000); t.mock.timers.tick(1000);
  assert.equal(s.privilegeDeniedStats().failures, 3); assert.equal(s.privilegeDeniedStats().keys, 0);
  logger.logSecurity = original;
  s.recordPrivilegeDenied(d, audit); assert.equal(events().length, 1);
  assert.ok(!JSON.stringify(s.privilegeDeniedStats()).includes('sentinel'));
});

test('event projection rejects extra diagnostics and unrecognized extended privileges', (t) => {
  const { s, denial, events } = setup(t);
  const d = captureAccessDenial({ ...denial(), outcome: 'evaluation-failure', requiredPrivileges: ['fmmcp', 'credential-sentinel'],
    formula: 'formula-text-sentinel', value: 'evaluated-input-sentinel', exception: 'evaluator-exception-sentinel', recordId: 987654321,
  } as AccessDenial, s, 'clerk');
  s.recordPrivilegeDenied(d, audit);
  const [event] = events();
  assert.deepEqual(event.changes?.requiredPrivileges, ['fmmcp']); assert.match(event.description, /could not be evaluated/);
  for (const value of ['credential-sentinel', 'formula-text-sentinel', 'evaluated-input-sentinel', 'evaluator-exception-sentinel', '987654321']) assert.ok(!JSON.stringify(event).includes(value));
});

test('transaction release drains at most sixty append attempts per minute, sharing slots with immediate writes', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_800_000_000_000);
  const { s, id, denial, events } = setup(t);
  const d = denial(); const tx: Transaction = { files: new Map() };
  writer.run({ transaction: { open: tx } }, () => s.update('T', id, { A: 'rollback' }));
  for (let batch = 0; batch < 3; batch++) {
    if (batch) t.mock.timers.tick(60_000);
    for (let i = 0; i < 60; i++) s.recordPrivilegeDenied(captureAccessDenial({ ...d }, s, `${batch}-${i}`), audit);
  }
  assert.equal(s.privilegeDeniedStats().pending, 180); assert.equal(events().length, 0);
  endTransaction(tx, false); t.mock.timers.tick(1);
  assert.equal(events().length, 60); assert.equal(s.privilegeDeniedStats().pending, 120);
  t.mock.timers.tick(59_999);
  // Admission has capacity, but the deferred batch still owns all persistence slots.
  s.recordPrivilegeDenied(captureAccessDenial({ ...d }, s, 'immediate'), audit);
  assert.equal(events().length, 60); assert.equal(s.privilegeDeniedStats().pending, 121);
  t.mock.timers.tick(1); assert.equal(events().length, 120);
  t.mock.timers.tick(60_000); assert.equal(events().length, 180);
  t.mock.timers.tick(60_000); assert.equal(events().length, 181); assert.equal(s.privilegeDeniedStats().pending, 0);
  const times = events().map((e) => Date.parse(e.at));
  for (const at of times) assert.ok(times.filter((t) => t > at - 60_000 && t <= at).length <= 60);
  assert.equal(s.get('T', id).fieldData.A, 'row-label-sentinel');
});

test('logger recovery shares the append budget with retries and never releases a queued burst', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_800_000_000_000);
  const { s, id, denial, events } = setup(t);
  const d = denial(); const tx: Transaction = { files: new Map() };
  writer.run({ transaction: { open: tx } }, () => s.update('T', id, { A: 'rollback' }));
  for (let batch = 0; batch < 2; batch++) {
    if (batch) t.mock.timers.tick(60_000);
    for (let i = 0; i < 60; i++) s.recordPrivilegeDenied(captureAccessDenial({ ...d }, s, `${batch}-${i}`), audit);
  }
  const logger = s as unknown as { logSecurity: (...args: unknown[]) => void };
  const original = logger.logSecurity.bind(s);
  let failing = true;
  const attempts: number[] = [];
  t.mock.method(logger, 'logSecurity', (...args: unknown[]) => {
    attempts.push(Date.now());
    if (failing) throw new Error('logger-recovery-exception-sentinel');
    original(...args);
  });
  endTransaction(tx, false); t.mock.timers.tick(1);
  assert.equal(attempts.length, 60); assert.equal(s.privilegeDeniedStats().failures, 60); assert.equal(events().length, 0);
  failing = false; t.mock.timers.tick(1000); assert.equal(attempts.length, 60);
  t.mock.timers.tick(59_000); assert.equal(events().length, 60);
  t.mock.timers.tick(60_000); assert.equal(events().length, 120); assert.equal(s.privilegeDeniedStats().pending, 0);
  for (const at of attempts) assert.ok(attempts.filter((t) => t > at - 60_000 && t <= at).length <= 60);
  const times = events().map((e) => Date.parse(e.at));
  for (const at of times) assert.ok(times.filter((t) => t > at - 60_000 && t <= at).length <= 60);
  assert.equal(s.privilegeDeniedStats().drops, 0);
});

test('an unrelated trial holds queued production denials until rollback without dropping them', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_800_000_000_000);
  const { s, id, denial, events } = setup(t);
  const d = denial(); const tx: Transaction = { files: new Map() };
  writer.run({ transaction: { open: tx } }, () => s.update('T', id, { A: 'rollback' }));
  s.recordPrivilegeDenied(d, audit); endTransaction(tx, false);
  const trial = s.trial();
  t.mock.timers.tick(1);
  assert.equal(events().length, 0); assert.equal(s.privilegeDeniedStats().pending, 1); assert.equal(s.privilegeDeniedStats().drops, 0);
  const diagnostic = denial();
  s.recordPrivilegeDenied(diagnostic, { ...audit, surface: 'mcp' });
  assert.equal(s.privilegeDeniedStats().pending, 1);
  trial.undo(); t.mock.timers.tick(1);
  assert.equal(events().length, 1); assert.equal(s.privilegeDeniedStats().pending, 0); assert.equal(s.privilegeDeniedStats().drops, 0);
  // A diagnostic observed after its trial ends remains suppressed by its capture-time provenance.
  s.recordPrivilegeDenied(diagnostic, { ...audit, surface: 'mcp' });
  assert.equal(events().length, 1);
});

test('a production denial submitted during an unrelated trial is deferred rather than reclassified as a diagnostic', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
  t.mock.method(performance, 'now', () => Date.now() - 1_800_000_000_000);
  const { s, denial, events } = setup(t);
  const d = denial(); const trial = s.trial();
  s.recordPrivilegeDenied(d, audit);
  assert.equal(s.privilegeDeniedStats().pending, 1); assert.equal(events().length, 0);
  trial.undo(); t.mock.timers.tick(1);
  assert.equal(events().length, 1); assert.equal(s.privilegeDeniedStats().drops, 0);
});
