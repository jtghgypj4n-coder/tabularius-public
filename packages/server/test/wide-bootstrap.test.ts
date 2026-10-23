import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { Host } from '../src/host.ts';
import { DataApi, type Session } from '../src/dataapi.ts';
import { WebClient } from '../src/webclient.ts';

test('lazy and eager design loading produce identical web layout payloads, including themes and visibility', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-wide-bootstrap-'));
  createStore(join(dir, 'Wide.openhbam.sqlite'));
  const host = new Host(dir);
  const web = new WebClient(host, new DataApi(host));
  try {
    const store = host.get('Wide')!;
    store.applyDesign([
      { op: 'createTable', name: 'Items', fields: [{ name: 'Label' }, { name: 'Amount', type: 'number' }] },
      { op: 'createLayout', name: 'Other', occurrence: 'Items' },
      { op: 'createTheme', name: 'Synthetic' },
      { op: 'updateLayout', layout: 'Items', design: { themeId: 1 } },
      { op: 'createValueList', name: 'States', values: ['Open', 'Closed'] },
    ]);
    for (const readOnly of [false, true]) {
      store.resetCaches();
      const privileges = store.privileges('Admin');
      const session = { readOnly } as Session;
      const lazy = web['layout'](store, 'Items', privileges, session);
      assert.equal(store['designCache'].value, undefined, 'bootstrap must leave unrelated layouts unparsed');
      assert.ok(lazy.theme);
      assert.equal(lazy.canSeeDesign, readOnly ? undefined : true);
      store.designs();
      const eager = web['layout'](store, 'Items', privileges, session);
      assert.deepEqual(lazy, eager);
      assert.equal(JSON.stringify(lazy), JSON.stringify(eager));
    }
  } finally {
    web.stop();
    host.notifier.stop();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
