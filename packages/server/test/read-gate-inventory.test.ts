import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectReadSites, inventoryMarkdown, unclassified, type AllowedReader } from '../../../scripts/read-gate-inventory.ts';

const root = resolve(import.meta.dirname, '../../..');
const allow = JSON.parse(readFileSync(resolve(root, 'notes/audits/read-gate-allowlist.json'), 'utf8')) as AllowedReader[];
const report = readFileSync(resolve(root, 'notes/audits/audit-read-gate-inventory.md'), 'utf8');
const sites = collectReadSites(root);

test('every enumerated store, calculation and raw SQL read is explicitly classified', () => {
  assert.deepEqual(unclassified(sites, allow), []);
  assert.equal(new Set(allow.map((a) => `${a.file}\0${a.fn}`)).size, allow.length, 'one entry per function');
  for (const reader of allow) {
    assert.ok(report.includes(`| ${reader.gate} |`), `documented gate: ${reader.gate}`);
    assert.ok(reader.sites.length > 0);
  }
  assert.ok(report.includes(inventoryMarkdown(sites, allow)), 'generated function/line inventory is current');
});

test('the allow-list rejects duplicate and changed read sites', () => {
  assert.equal(unclassified([...sites, sites[0]], allow).length, 1);
  assert.equal(unclassified(sites.map((s, i) => i ? s : { ...s, hash: 'changed-arguments' }), allow).length, 2);
});

test('unlisted aliases, bracket readers and raw SQL transfers are discovered from code', () => {
  const file = 'packages/server/src/calendar.ts';
  const source = readFileSync(resolve(root, file), 'utf8');
  const added = `\nfunction readGateProbe(store: Store) {
    store['find']('Synthetic');
    const alias = store;
    alias.find('Synthetic');
    const { sql } = store;
    sql.prepare('SELECT 1').get();
    const read = store.get;
    return read('Synthetic', 1);
  }\n`;
  const changed = collectReadSites(root, new Map([[file, source + added]]));
  const found = changed.filter((s) => s.fn === 'readGateProbe');
  assert.ok(found.filter((s) => s.api === 'Store.find').length >= 2);
  assert.ok(found.some((s) => s.api === 'Store.sql'));
  assert.ok(found.some((s) => s.api === 'SQLite.get'));
  assert.ok(found.some((s) => s.api === 'Store.get'));
  assert.ok(unclassified(changed, allow).length >= 5);
});

test('a read API reached through an untyped receiver is discovered by its name', () => {
  const file = 'packages/server/src/calendar.ts';
  const source = readFileSync(resolve(root, file), 'utf8');
  const added = `\nfunction untypedProbe(store: Store, anything: any) {
    (store as any).recordAsOf('Synthetic', 1);
    const loose = store as any;
    loose.foundSetRows('Synthetic');
    Object.getPrototypeOf(anything).executeSQL.call(anything, 'SELECT 1', []);
  }\n`;
  const found = collectReadSites(root, new Map([[file, source + added]])).filter((s) => s.fn === 'untypedProbe').map((s) => s.api).sort();
  assert.deepEqual(found, ['Untyped.executeSQL', 'Untyped.foundSetRows', 'Untyped.recordAsOf']);
});
