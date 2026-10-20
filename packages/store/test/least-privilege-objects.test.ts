// Least privilege for layouts and scripts: each layout an account opens and script it runs is counted (only names and
// counts), and a set's layouts and scripts that none of its accounts opened or ran in the window are suggested for
// taking away, once they have been counted for the whole window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type PrivilegeDefinition } from '../src/index.ts';

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-leastpriv-objects-'));
  createStore(join(dir, 'L.sqlite'));
  const store = new Store(join(dir, 'L.sqlite'), 'L');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Item' }] },
      { op: 'createLayout', name: 'Order List', occurrence: 'Orders' },
      { op: 'createLayout', name: 'Order Admin', occurrence: 'Orders' },
      { op: 'createScript', name: 'Ship', text: 'Exit Script [ Text Result: 1 ]' },
      { op: 'createScript', name: 'Purge', text: 'Exit Script [ Text Result: 1 ]' },
    ] as never);
    store.savePrivilegeSet({
      name: 'Sales', records: { view: true, edit: true, create: true, delete: false },
      layouts: 'viewOnly', layoutAccess: { 'Order Admin': { layout: 'none', records: 'none' } }, valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
    } as PrivilegeDefinition);
    store.setPassword('seller', 'seller-pw-123', 'Sales');
    fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Counting as begun `ago` days back. */
const countedSince = (store: Store, ago: number) => {
  store.flushUsage();
  store.sql.prepare(`INSERT INTO _fm_meta VALUES ('objectUseSince', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`).run(JSON.stringify(day(ago)));
};

test('layouts opened and scripts run are spared; the rest the set allows are suggested', () => {
  withStore((store) => {
    const p = store.privileges('seller');
    store.find('Order List', { privileges: p }); // opens the layout
    p.checkScript('Ship'); // as every way a script starts checks it
    countedSince(store, 60);
    const r = store.leastPrivilege({ unusedDays: 30 });
    assert.equal(r.objectsJudged, true);
    const layouts = r.objects.find((f) => f.set === 'Sales' && f.kind === 'layout');
    const scripts = r.objects.find((f) => f.set === 'Sales' && f.kind === 'script');
    assert.ok(!layouts?.names.includes('Order List'), 'the layout it opened is spared');
    assert.ok(!layouts?.names.includes('Order Admin'), 'a layout the set can\'t see has nothing to take away');
    assert.ok(layouts?.names.includes('Orders'), 'the layout nobody opened is suggested');
    assert.deepEqual(scripts?.names, ['Purge']);
    assert.deepEqual(scripts?.accounts, ['seller']);
    assert.match(scripts!.description, /"Sales" can run 1 script that none of its accounts has run in 30 days: "Purge"/);
  });
});

test('nothing is judged until layouts and scripts have been counted for the whole window', () => {
  withStore((store) => {
    store.recordObjectUse('seller', 'Sales', 'layout', 'Order List');
    const fresh = store.leastPrivilege({ unusedDays: 30 });
    assert.equal(fresh.objectsJudged, false, 'counting began today');
    assert.deepEqual(fresh.objects, []);
    const marker = store.sql.prepare(`SELECT json FROM _fm_meta WHERE key = 'objectUseSince'`).get() as { json: string };
    assert.equal(JSON.parse(marker.json), day(0), 'marked from the first counts written');
  });
});

test('a use older than the window doesn\'t count, and nobody viewing a set as it counts as using it', () => {
  withStore((store) => {
    store.flushUsage();
    store.recordObjectUse('seller', 'Sales', 'script', 'Ship');
    store.flushUsage();
    store.sql.prepare(`UPDATE _fm_object_usage SET day = ?`).run(day(45));
    countedSince(store, 60);
    store.privilegesForSet('Sales').checkScript('Purge'); // the admin console's "view as"
    const r = store.leastPrivilege({ unusedDays: 30 });
    assert.deepEqual(r.objects.find((f) => f.kind === 'script')?.names, ['Ship', 'Purge'], 'in the file\'s order');
  });
});

test('full access counts nothing and is never suggested', () => {
  withStore((store) => {
    store.setPassword('boss', 'boss-pw-12345', '[Full Access]');
    store.privileges('boss').checkScript('Ship');
    store.flushUsage();
    const n = (store.sql.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = '_fm_object_usage'`).get() as { n: number }).n;
    const rows = n ? (store.sql.prepare('SELECT count(*) AS n FROM _fm_object_usage').get() as { n: number }).n : 0;
    assert.equal(rows, 0);
    countedSince(store, 60);
    assert.ok(!store.leastPrivilege().objects.some((f) => f.set === '[Full Access]'));
  });
});

test('use is credited to the set it was made under, as through an external group, not the account\'s own', () => {
  withStore((store) => {
    store.savePrivilegeSet({
      name: 'Ops', records: { view: true, edit: false, create: false, delete: false },
      layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
    } as PrivilegeDefinition);
    store.setPassword('ops group', 'ops-group-pw-1', 'Ops');
    // seller's own set is Sales; signed in through "ops group" it has Ops.
    store.privileges('seller', 'ops group').checkScript('Ship');
    countedSince(store, 60);
    const r = store.leastPrivilege({ unusedDays: 30 });
    const scripts = (set: string) => r.objects.find((f) => f.set === set && f.kind === 'script')?.names;
    assert.deepEqual(scripts('Ops'), ['Purge'], 'Ops ran Ship');
    assert.deepEqual(scripts('Sales'), ['Ship', 'Purge'], 'Sales never did');
  });
});
