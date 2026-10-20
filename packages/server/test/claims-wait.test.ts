// A process that claimed one result and waits for another process's claim on
// a second keeps its own claim alive meanwhile, so a third process doesn't
// take it over and read every record a second time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { ResultCache } from '../../store/src/results.ts';

test('a claim is renewed while its holder waits on another', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-claims-wait-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  const claim = ResultCache.prototype.claim;
  const renew = ResultCache.prototype.renew;
  const claimed = ResultCache.prototype.claimed;
  try {
    createStore(path);
    const s = new Store(path, 'Shop');
    s.applyDesign([
      { op: 'createTable', name: 'Orders', fields: [{ name: 'Total', type: 'number' }] },
      { op: 'createCustomFunction', name: 'Twice', parameters: ['x'], formula: 'x * 2' },
      { op: 'createField', table: 'Orders', name: 'A', type: 'number', kind: 'calculation', calculation: 'Twice ( Total )', options: { unstored: true } },
      { op: 'createField', table: 'Orders', name: 'sA', kind: 'summary', summary: { type: 'total', field: 'A' } },
      { op: 'createField', table: 'Orders', name: 'sB', kind: 'summary', summary: { type: 'count', field: 'A' } },
    ] as never);
    for (let i = 1; i <= 20; i++) s.create('Orders', { Total: String(i) });
    s.shareResults();
    // The second summary is someone else's, for six seconds; the first is this process's.
    const calls: string[] = [];
    let theirs: string | undefined;
    const until = Date.now() + 6_000;
    ResultCache.prototype.claim = function (key: string, ms: number) {
      calls.push(key);
      if (key === theirs || (!theirs && calls.length === 2)) {
        theirs = key;
        return false;
      }
      return claim.call(this, key, ms);
    };
    ResultCache.prototype.renew = function (key: string, ms: number) {
      calls.push(key);
      return renew.call(this, key, ms);
    };
    ResultCache.prototype.claimed = function (key: string) {
      return key === theirs ? Date.now() < until : claimed.call(this, key);
    };
    const rec = s.find('Orders', { limit: 1, layoutOnly: true }).records[0];
    assert.equal(Number(rec.fieldData.sA), 420);
    const mine = calls[0];
    assert.ok(calls.filter((k) => k === mine).length >= 2, 'its own claim renewed while it waited');
    s.close();
  } finally {
    ResultCache.prototype.claim = claim;
    ResultCache.prototype.renew = renew;
    ResultCache.prototype.claimed = claimed;
    rmSync(dir, { recursive: true, force: true });
  }
});
