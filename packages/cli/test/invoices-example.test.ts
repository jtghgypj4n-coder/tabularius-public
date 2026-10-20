// examples/invoices: four related tables, calculations that follow the relationships, a value list, a custom function and two
// scripts. Built from an empty database with `tabularius design-apply`, then used the way the example's README says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'invoices');

test('the invoices example totals its lines, rolls up to the customer and runs its scripts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-invoices-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    let r = run('new', dir, 'Invoices');
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'Invoices', example, '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Invoices: \d+ changes made/);
    r = run('design-apply', dir, 'Invoices', example);
    assert.match(r.stdout, /Invoices: nothing to change \(\d+ files already match\)/);

    const s = new Store(join(dir, 'Invoices.openhbam.sqlite'), 'Invoices');
    try {
      assert.deepEqual(s.schema.tables.map((t) => t.name).sort(), ['Customers', 'Invoices', 'Lines', 'Products']);
      assert.equal(s.schema.relationships.length, 3);
      assert.deepEqual(s.schema.valueLists.find((v) => v.name === 'Invoice status')?.values, ['Draft', 'Sent', 'Paid', 'Void']);

      s.create('Customers', { Name: 'Acme', Email: 'accounts@acme.example' });
      s.create('Products', { Name: 'Widget', Price: '12.5' });
      s.create('Products', { Name: 'Gadget', Price: '4' });
      const invoice = s.create('Invoices', { 'Customer ID': '1' }).recordId;
      const read = (layout: string, id: number) => s.get(layout, id).fieldData;

      // An empty invoice is not sent.
      let result = await runScript(s, 'Send invoice', { layout: 'Invoices', recordId: invoice });
      assert.equal(result.result, 'empty');
      assert.equal(read('Invoices', invoice).Status, 'Draft');

      s.create('Lines', { 'Invoice ID': '1', 'Product ID': '1', Quantity: '2', 'Unit Price': '12.5' });
      s.create('Lines', { 'Invoice ID': '1', 'Product ID': '2', 'Unit Price': '4' });
      assert.equal(read('Lines', 1)['Line Total'], 25);
      assert.equal(read('Lines', 1).Description, 'Widget');
      assert.equal(read('Lines', 2).Quantity, 1);
      assert.equal(read('Invoices', invoice).Total, 29);
      assert.equal(read('Invoices', invoice)['Customer Name'], 'Acme');
      assert.deepEqual([read('Customers', 1)['Invoice Count'], read('Customers', 1)['Total Billed']], [1, 29]);

      await runScript(s, 'Send invoice', { layout: 'Invoices', recordId: invoice });
      assert.equal(read('Invoices', invoice).Status, 'Sent');
      assert.equal(read('Invoices', invoice).Overdue, 0);
      await runScript(s, 'Mark as paid', { layout: 'Invoices', recordId: invoice });
      assert.equal(read('Invoices', invoice).Status, 'Paid');
      result = await runScript(s, 'Mark as paid', { layout: 'Invoices', recordId: invoice });
      assert.equal(result.result, 'no change');
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
