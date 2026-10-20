// Least-privilege suggestions: write grants a privilege set holds but no account
// on it has exercised in the window. Built only from record-write audit entries,
// so it covers write access only and is recomputed each time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFmp12, Store, writer } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-leastpriv-'));
  importFmp12(fixture, join(dir, 'Charts.sqlite'));
  const store = new Store(join(dir, 'Charts.sqlite'));
  try { fn(store); } finally { store.close(); rmSync(dir, { recursive: true }); }
}

test('flags a write grant the set has never used, and spares the table it wrote to', { skip }, () => {
  withStore((store) => {
    // Sales may write every table; bind an account and have it write ONE table.
    store.savePrivilegeSet({
      name: 'Sales', records: { view: true, edit: true, create: true, delete: true },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.setPassword('seller', 'seller-pw-123', 'Sales');
    store.create('Congress', { Name: 'A real edit by seller' }, { account: 'seller' });

    const { unusedDays, findings } = store.leastPrivilege({ unusedDays: 30 });
    assert.equal(unusedDays, 30);
    const sales = findings.filter((f) => f.set === 'Sales');
    // Congress was written, so it is NOT a finding…
    assert.ok(!sales.some((f) => f.table === 'Congress'), 'the table it actually wrote to is spared');
    // …but another writable, unused table is flagged, for the seller account, with its grants.
    const other = sales.find((f) => f.table === 'US Population');
    assert.ok(other, 'an unused writable table is flagged');
    assert.deepEqual(other!.grants, ['edit', 'create', 'delete']);
    assert.deepEqual(other!.accounts, ['seller']);
    assert.match(other!.description, /no account using it has changed a record there in 30 days/);
  });
});

test('a Truncate Table clear counts as a write, sparing the cleared table', { skip }, () => {
  withStore((store) => {
    // Sales may write every table. Its account exercises the DELETE grant on
    // one table by clearing it with Truncate Table — not a per-record delete.
    store.savePrivilegeSet({
      name: 'Sales', records: { view: true, edit: true, create: true, delete: true },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.setPassword('seller', 'seller-pw-123', 'Sales');
    // truncate() takes its acting account from the writer context, not an opts arg.
    writer.run({ account: 'seller' }, () => store.truncate('Congress'));

    const sales = store.leastPrivilege({ unusedDays: 30 }).findings.filter((f) => f.set === 'Sales');
    // The truncated table is in active use via its delete grant, so it must NOT
    // be reported as droppable — the false-"unused" bug this regression guards.
    assert.ok(!sales.some((f) => f.table === 'Congress'), 'a truncated table is counted as used');
    // A different writable table it never touched is still flagged.
    assert.ok(sales.some((f) => f.table === 'US Population'), 'an untouched writable table is still flagged');
  });
});

test('a huge unusedDays is clamped instead of crashing', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({
      name: 'Sales', records: { view: true, edit: true, create: true, delete: true },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.setPassword('seller', 'seller-pw-123', 'Sales');
    // ~1e300 is finite and >0 but overflows Date arithmetic to -Infinity; the
    // clamp keeps new Date(...).toISOString() from throwing a RangeError.
    const { unusedDays, findings } = store.leastPrivilege({ unusedDays: 1e300 });
    assert.equal(unusedDays, 36_500);
    assert.ok(Array.isArray(findings));
  });
});

test('never flags a full-access set, a view-only grant, or a set with no accounts', { skip }, () => {
  withStore((store) => {
    // A view-only set with an account: no write grants, so nothing to trim.
    store.savePrivilegeSet({
      name: 'Readers', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.setPassword('reader', 'reader-pw-123', 'Readers');
    // A write-granting set with NO account bound to it.
    store.savePrivilegeSet({
      name: 'Orphan', records: { view: true, edit: true, create: true, delete: true },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });

    const { findings } = store.leastPrivilege({ unusedDays: 30 });
    assert.ok(!findings.some((f) => f.set === 'Readers'), 'a view-only set has no write grants to flag');
    assert.ok(!findings.some((f) => f.set === 'Orphan'), 'a set with no accounts is not flagged');
    assert.ok(!findings.some((f) => f.set === '[Full Access]'), 'full access is never flagged');
  });
});

test('a write by a since-deleted account keeps the table out of the suggestions', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({
      name: 'Sales', records: { view: true, edit: true, create: true, delete: true },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.setPassword('seller', 'seller-pw-123', 'Sales');
    store.setPassword('other', 'other-pw-123', 'Sales');
    store.create('Congress', { Name: 'written by someone later removed' }, { account: 'seller' });
    store.deleteAccount('seller');
    const sales = store.leastPrivilege({ unusedDays: 30 }).findings.filter((f) => f.set === 'Sales');
    // The write can't be credited to a set; Sales might be the one using its grant, so no "safe to downgrade" for Congress.
    assert.ok(!sales.some((f) => f.table === 'Congress'), 'the table is not reported unused');
    assert.ok(sales.some((f) => f.table === 'US Population'), 'tables nobody wrote to are still reported');
  });
});

test('a set that cannot view a table has no write grant on it to drop', { skip }, () => {
  withStore((store) => {
    store.savePrivilegeSet({
      name: 'Odd', records: { view: true, edit: false, create: false, delete: false },
      tables: { Congress: { view: false, edit: true, create: true, delete: true } },
      layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: [],
    });
    store.setPassword('odd', 'odd-pw-12345', 'Odd');
    const odd = store.leastPrivilege({ unusedDays: 30 }).findings.filter((f) => f.set === 'Odd');
    assert.ok(!odd.some((f) => f.table === 'Congress'), 'edit/delete without view grants nothing, so there is nothing to downgrade');
  });
});

// Ways in: an extended privilege a set holds that no account on it used, from the usage counts.
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
/** Usage rows as if counted over past days, with counting the current way since `countingSince` days ago. */
function seedUsage(store: Store, countingSince: number, rows: [ago: number, account: string, surface: string][]): void {
  store.recordUsage('nobody', 'web'); // makes the table
  store.flushUsage();
  store.sql.exec('DELETE FROM _fm_usage');
  store.sql.prepare(`UPDATE _fm_meta SET json = ? WHERE key = 'usageCounting'`).run(JSON.stringify({ version: 2, since: day(countingSince) }));
  const add = store.sql.prepare('INSERT INTO _fm_usage VALUES (?, ?, ?, 1)');
  for (const [ago, account, surface] of rows) add.run(day(ago), account, surface);
}
function apiSet(store: Store): void {
  store.savePrivilegeSet({
    name: 'Api', records: { view: true, edit: false, create: false, delete: false },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest', 'fmapp', 'fmodata', 'fmmcp', 'fmxml'],
  });
  store.setPassword('robot', 'robot-pw-123', 'Api');
}
const unused = (store: Store, unusedDays = 30) => store.leastPrivilege({ unusedDays }).access.filter((f) => f.set === 'Api').map((f) => f.privilege).sort();

test('ways in: one the set\'s accounts used is spared, the others are flagged, and an older use doesn\'t count', { skip }, () => {
  withStore((store) => {
    apiSet(store);
    seedUsage(store, 45, [[3, 'robot', 'rest'], [40, 'robot', 'odata']]);
    const { access, notYetCounted } = store.leastPrivilege({ unusedDays: 30 });
    const api = access.filter((f) => f.set === 'Api');
    // fmrest was used; fmodata only before the window; fmapp and fmmcp never; fmxml opens nothing here, so it isn't judged.
    assert.deepEqual(api.map((f) => f.privilege).sort(), ['fmapp', 'fmmcp', 'fmodata']);
    assert.deepEqual(notYetCounted, []);
    assert.deepEqual(api[0].accounts, ['robot']);
    assert.match(api.find((f) => f.privilege === 'fmodata')!.description, /"Api" lets its accounts in through OData \(fmodata\), but none of them has used it in 30 days/);
    assert.ok(!access.some((f) => f.set === '[Full Access]'), 'Full Access sets are never trimmed here');
  });
});

test('ways in: nothing is said for a surface until its use has been counted for the whole window', { skip }, () => {
  withStore((store) => {
    apiSet(store);
    const none = store.leastPrivilege({ unusedDays: 30 });
    assert.deepEqual(none.access, [], 'no usage counted at all');
    assert.deepEqual(none.notYetCounted, ['fmapp', 'fmmcp', 'fmodata', 'fmrest']);
    // The Data API and web client were counted for months; OData, SQL and every MCP use only since 2 days ago (an upgrade).
    seedUsage(store, 2, [[60, 'someone', 'rest'], [3, 'robot', 'rest']]);
    const r = store.leastPrivilege({ unusedDays: 30 });
    assert.deepEqual(r.access.filter((f) => f.set === 'Api').map((f) => f.privilege), ['fmapp'], 'only the web client, counted all along');
    assert.deepEqual(r.notYetCounted, ['fmmcp', 'fmodata']);
    // Counting must begin before the window's first day, so none of that day is missed.
    seedUsage(store, 5, [[3, 'robot', 'rest']]);
    assert.deepEqual(unused(store, 6), [], 'counted since the first day of a 6-day window: part of it may be missed');
    assert.deepEqual(unused(store, 5), ['fmapp', 'fmmcp', 'fmodata'], 'counted since before a 5-day window');
  });
});

test('ways in: AI in the web client counts for fmmcp, and a use by an account no set can be found for spares that way in', { skip }, () => {
  withStore((store) => {
    apiSet(store);
    seedUsage(store, 45, [[2, 'robot', 'web']]);
    assert.deepEqual(unused(store), ['fmodata', 'fmrest'], 'the web client used: fmapp and fmmcp (the assistant) spared');
    // An identity-provider sign-in recorded under an email, or an account deleted since.
    seedUsage(store, 45, [[2, 'someone@example.com', 'odata']]);
    assert.deepEqual(unused(store), ['fmapp', 'fmmcp', 'fmrest']);
  });
});

test('usage counting the current way is marked from the first counts written', { skip }, () => {
  withStore((store) => {
    store.recordUsage('robot', 'odata');
    store.flushUsage();
    const marker = store.sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'usageCounting'`).get() as { json: string };
    assert.deepEqual(JSON.parse(marker.json), { version: 2, since: day(0) });
  });
});
