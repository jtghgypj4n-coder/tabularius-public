// examples/inventory: stock movements, a status that follows them, and a reorder script that mails suppliers.
// Built from an empty database with `tabularius design-apply`; the mail is written to the outbox in test mode and
// goes nowhere (no network, no SMTP).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'inventory');

test('the inventory example keeps stock from movements, refuses to oversell and writes one reorder mail per low product', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-inventory-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    let r = run('new', dir, 'Stock');
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'Stock', example, '--apply');
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'Stock', example);
    assert.match(r.stdout, /Stock: nothing to change \(\d+ files already match\)/);

    const s = new Store(join(dir, 'Stock.openhbam.sqlite'), 'Stock');
    try {
      assert.deepEqual(s.schema.tables.map((t) => t.name).sort(), ['Movements', 'Products']);
      s.create('Products', { SKU: 'CH-1', Name: 'Chair', 'Supplier Email': 'orders@chairs.example', 'Reorder Level': '5' });
      s.create('Products', { SKU: 'TB-1', Name: 'Table', 'Supplier Email': 'orders@tables.example', 'Reorder Level': '2' });
      s.create('Products', { SKU: 'LP-1', Name: 'Lamp', 'Reorder Level': '10' });
      const receive = (p: string) => runScript(s, 'Receive stock', { layout: 'Movements', parameter: p });
      const sell = (p: string) => runScript(s, 'Sell stock', { layout: 'Movements', parameter: p });

      assert.equal((await receive('1|8|Delivery 7')).result, 'received');
      await receive('2|10');
      await receive('3|4');
      assert.equal((await receive('1|0')).result, 'need a product and a quantity above 0');
      assert.equal((await sell('1|3')).result, 'sold');
      assert.equal((await sell('1|9')).result, 'only 5 on hand');
      assert.equal((await sell('1|-2')).result, 'need a product and a quantity above 0');

      const product = (id: number) => s.get('Products', id).fieldData;
      assert.deepEqual([product(1)['On Hand'], product(1).Status], [5, 'Reorder']);
      assert.deepEqual([product(2)['On Hand'], product(2).Status], [10, 'OK']);
      assert.deepEqual([product(3)['On Hand'], product(3).Status], [4, 'Reorder']);

      // Chair is low and has a supplier; Lamp is low but has no supplier email; Table is fine.
      const outbox: { kind?: string; to?: unknown; subject?: unknown }[] = [];
      const out = await runScript(s, 'Reorder alerts', { layout: 'Products', outbound: { allowHosts: [], record: (e) => outbox.push(e as never) } });
      assert.equal(out.error, 0);
      assert.equal(out.result, '1 reorder mails');
      assert.equal(outbox.length, 1);
      assert.match(JSON.stringify(outbox[0]), /orders@chairs\.example/);
      assert.match(JSON.stringify(outbox[0]), /Reorder: Chair/);
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
