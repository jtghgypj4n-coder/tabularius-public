// A summary field's Minimum and Maximum of a date, time or timestamp field are a date, time or timestamp
// (Claris, Defining summary fields: "the lowest number, or earliest date, time, or timestamp").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../src/index.ts';

test('summary minimum and maximum of date, time and timestamp fields are dates, times and timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-sum-dates-'));
  const path = join(dir, 'Dates.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Dates');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'D', type: 'date' }, { name: 'Tm', type: 'time' }, { name: 'Ts', type: 'timestamp' }, { name: 'N', type: 'number' }] },
      { op: 'createField', table: 'T', name: 'dMin', kind: 'summary', summary: { type: 'minimum', field: 'D' } },
      { op: 'createField', table: 'T', name: 'dMax', kind: 'summary', summary: { type: 'maximum', field: 'D' } },
      { op: 'createField', table: 'T', name: 'tMin', kind: 'summary', summary: { type: 'minimum', field: 'Tm' } },
      { op: 'createField', table: 'T', name: 'tsMax', kind: 'summary', summary: { type: 'maximum', field: 'Ts' } },
      { op: 'createField', table: 'T', name: 'nMax', kind: 'summary', summary: { type: 'maximum', field: 'N' } },
      { op: 'createField', table: 'T', name: 'dCount', kind: 'summary', summary: { type: 'count', field: 'D' } },
      { op: 'createField', table: 'T', name: 'Span', type: 'text', kind: 'calculation', calculation: 'Year ( dMax ) & "/" & Year ( dMin ) & "/" & GetAsText ( tMin )', options: { unstored: true } },
    ] as never);
    store.create('T', { D: '3/4/2020', Tm: '10:30:00', Ts: '3/4/2020 10:30:00', N: '5' });
    store.create('T', { D: '1/2/2019', Tm: '09:15:00', Ts: '1/2/2019 09:15:00', N: '12' });
    store.create('T', { D: '12/31/2021', Tm: '23:59:59', Ts: '12/31/2021 23:59:59', N: '7' });
    const r = store.find('T', { query: [{}], limit: 1 } as never).records[0].fieldData;
    assert.equal(r.dMin, '01/02/2019');
    assert.equal(r.dMax, '12/31/2021');
    assert.equal(r.tMin, '09:15:00');
    assert.equal(r.tsMax, '12/31/2021 23:59:59');
    assert.equal(r.nMax, 12, 'a number field is still a number');
    assert.equal(r.dCount, 3);
    assert.equal(r.Span, '2021/2019/9:15:00', 'a calculation sees a date, so Year() works');

    // A found set: the summary follows it.
    const some = store.find('T', { query: [{ D: '>=1/1/2020' }], limit: 1 } as never).records[0].fieldData;
    assert.equal(some.dMin, '03/04/2020');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
