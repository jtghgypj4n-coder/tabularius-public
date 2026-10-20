// A field the file requires a value for is marked required in the modern pages, and the rejection the store gives
// names the field in the words the page looks for to show the error beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store, type DesignOp } from '../../store/src/index.ts';
import { modernPage } from '../../web/src/page-source.ts';
import { modernizeChange } from '../src/modernize.ts';

test('modernize: a required field is marked in the page, and a rejected save names the field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-modernize-required-'));
  try {
    createStore(join(dir, 'f.sqlite'));
    const store = new Store(join(dir, 'f.sqlite'), 'Shop');
    try {
      store.applyDesign([
        { op: 'createTable', name: 'Customers', fields: [{ name: 'Name', options: { validation: { notEmpty: true } } }, { name: 'City' }] },
      ] as DesignOp[], { account: 'Admin' });
      const r = modernizeChange(store, { styles: ['modern-detail'] });
      const create = r.changes.filter((c) => c.op === 'createLayout') as unknown as { name: string; design: { objects: never[] } }[];
      const page = modernPage(create.find((c) => c.name === 'Customers - Modern detail')!.design.objects)!.html;
      assert.match(page, /\{"name":"Name","label":"Name","control":"text","required":true\}/);
      assert.match(page, /\{"name":"City","label":"City","control":"text"\}/);
      // The page finds the field in the store's own words.
      const layout = store.schema.layouts.find((l) => l.name === 'Customers')!.name;
      assert.throws(() => store.create(layout, { City: 'Oslo' }), (e: Error) => e.message.includes('"Name"') && /requires a value/.test(e.message));
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
