// `tabularius new --starter`: five ready-to-use apps built through the design operations. Each is built into a fresh
// database, checked for consistency (every layout object points at something that exists, every button runs a
// script that exists, every field has a label), and then used the way its docs page describes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Store, STARTER_NAMES, applyStarter, createStore } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

function withStarter(name: string, fn: (s: Store) => Promise<void> | void, opts: { sample?: boolean } = {}) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-starter-'));
    const file = join(dir, 'App.openhbam.sqlite');
    createStore(file);
    const s = new Store(file, 'App');
    try {
      applyStarter(s, name, opts);
      await fn(s);
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

for (const name of STARTER_NAMES) {
  test(`the ${name} starter is consistent: layouts, buttons, labels, privilege sets`, withStarter(name, (s) => {
    const schema = s.schema;
    const names = schema.layouts.map((l) => l.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, 'layout names are unique');
    for (const layout of s.designs().layouts) {
      const fieldObjects = layout.objects.filter((o) => o.kind === 'field');
      const labels = layout.objects.filter((o) => o.kind === 'text' && o.text?.trim());
      for (const o of layout.objects) {
        if (o.kind === 'field') {
          const to = schema.tableOccurrences.find((t) => t.id === o.field!.tableOccurrenceId);
          assert.ok(to, `${layout.name}: ${o.field!.field} has a table occurrence`);
          assert.ok(schema.tables.find((t) => t.id === to.baseTableId)!.fields.some((f) => f.id === o.field!.fieldId), `${layout.name}: ${o.field!.field} exists`);
        }
        if (o.kind === 'button') {
          assert.ok(o.text?.trim(), `${layout.name}: a button has a caption`);
          assert.ok(schema.scripts.some((x) => x.id === o.action?.scriptId && x.name === o.action.script), `${layout.name}: ${o.text} runs a script that exists`);
        }
      }
      // A label for every field in the body (portal columns are labelled by the portal's header; summary-part fields by their group).
      const body = layout.parts.find((p) => p.kind === 'body')!;
      const own = fieldObjects.filter((o) => o.bounds.top >= body.top && o.bounds.top < body.top + body.height);
      assert.ok(labels.length >= own.length, `${layout.name}: ${own.length} fields, ${labels.length} labels`);
    }
    // One list and one form for each table, and the reports on top.
    assert.ok(schema.layouts.length >= schema.tables.length * 2 + 1);
    const sets = s.privilegeSets().map((p) => p.name);
    assert.ok(sets.includes('Staff') && sets.includes('Read only'));
    assert.deepEqual(s.privilegeSet('Staff')!.records, { view: true, create: true, edit: true, delete: false });
    assert.deepEqual(s.privilegeSet('Read only')!.records, { view: true, create: false, edit: false, delete: false });
    const health = s.securityHealth();
    assert.deepEqual(health.oversharingSets, []);
    assert.deepEqual(health.orphanedAccessKeys, []);
    // Sample records are labelled as such.
    const first = schema.tables[0].name;
    const rows = s.find(`${first} list`, {}).records;
    assert.ok(rows.length > 0);
    assert.throws(() => applyStarter(s, name), /already has tables/);
  }));

  test(`the ${name} starter passes check-solution`, withStarter(name, (s) => {
    const folder = dirname(s.path);
    const r = spawnSync(process.execPath, ['--no-warnings', main, 'check-solution', folder, 'App', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const result = JSON.parse(r.stdout) as { counts: { error: number; warning: number }; findings: { severity: string; where: string; message: string }[] };
    assert.deepEqual(result.findings.filter((f) => f.severity !== 'info'), []);
    assert.deepEqual([result.counts.error, result.counts.warning], [0, 0]);
  }));

  test(`the ${name} starter without sample data is empty`, withStarter(name, (s) => {
    for (const t of s.schema.tables) assert.equal(s.find(`${t.name} list`, {}).foundCount, 0, t.name);
  }, { sample: false }));
}

test('the crm starter closes and duplicates deals, and totals follow the deals', withStarter('crm', async (s) => {
  const company = (id: number) => s.get('Companies', id).fieldData;
  assert.deepEqual([company(2)['Contacts Count'], company(2)['Open Pipeline'], company(2)['Won Total']], [2, 10700, 0]);
  assert.deepEqual([company(1)['Open Pipeline'], company(1)['Won Total']], [0, 1800]);
  const close = (id: number, parameter: string) => runScript(s, 'Close deal', { layout: 'Deals', foundSet: [id], recordId: id, parameter });
  assert.equal((await close(2, 'Maybe')).result, 'say Won or Lost');
  assert.equal((await close(2, 'Won')).result, 'closed');
  assert.equal((await close(2, 'Lost')).result, 'already closed');
  assert.deepEqual([company(2)['Open Pipeline'], company(2)['Won Total']], [1200, 9500]);
  const duplicated = await runScript(s, 'Duplicate deal', { layout: 'Deals', foundSet: [2], recordId: 2 });
  assert.equal(duplicated.result, 'duplicated');
  const all = s.find('Deals list', {}).records.map((r) => r.fieldData);
  assert.equal(all.length, 6);
  const copy = all.find((r) => r.ID === 6)!;
  assert.deepEqual([copy.Title, copy.Stage, copy.Closed], ['Studio refit', 'Lead', '']);
}));

test('the inventory starter works out what is on hand, receives and sells', withStarter('inventory', async (s) => {
  const product = (id: number) => s.get('Products', id).fieldData;
  assert.deepEqual([product(1)['On Hand'], product(1).Status, product(1)['Stock Value']], [7, 'Reorder', 31.5]);
  assert.deepEqual([product(2)['On Hand'], product(2).Status], [60, 'OK']);
  const run = (name: string, parameter: string) => runScript(s, name, { layout: 'Products', parameter });
  assert.equal((await run('Receive stock', '1|24|Delivery 7')).result, 'received');
  assert.equal(product(1)['On Hand'], 31);
  assert.equal(product(1).Status, 'OK');
  assert.equal((await run('Sell stock', '1|100|Too many')).result, 'only 31 on hand');
  assert.equal((await run('Sell stock', '1|1|Market')).result, 'sold');
  assert.equal((await run('Sell stock', '99|1|x')).result, 'no such product');
  assert.equal((await run('Receive stock', '1|0|x')).result, 'need a product and a quantity above 0');
  assert.equal(product(1)['On Hand'], 30);
}));

test('the invoicing starter totals lines, sends drafts and marks invoices paid', withStarter('invoicing', async (s) => {
  const invoice = (id: number) => s.get('Invoices', id).fieldData;
  assert.deepEqual([invoice(2).Total, invoice(2).Unpaid, invoice(3).Total], [360, 360, 170]);
  assert.equal(invoice(1).Unpaid, 0);
  assert.equal(s.get('Customers', 1).fieldData.Owing, 360);
  const run = (name: string, id: number, parameter?: string) => runScript(s, name, { layout: 'Invoices', foundSet: [id], recordId: id, ...(parameter ? { parameter } : {}) });
  assert.equal((await run('Send invoice', 2)).result, 'not a draft');
  assert.equal((await run('Send invoice', 3)).result, 'sent');
  assert.equal(invoice(3).Status, 'Sent');
  assert.equal((await run('Mark as paid', 1)).result, 'no change');
  assert.equal((await run('Mark as paid', 2)).result, 'paid');
  assert.equal(s.get('Customers', 1).fieldData.Owing, 0);
  assert.equal((await runScript(s, 'New invoice', { layout: 'Invoices', parameter: '' })).result, 'give a customer id');
  assert.equal((await runScript(s, 'New invoice', { layout: 'Invoices', parameter: '2' })).result, 'started');
  const made = invoice(4);
  assert.deepEqual([made['Customer Name'], made.Status, Number(made.Total || 0)], ['Quill Print Shop', 'Draft', 0]);
  s.create('Invoices', { 'Customer ID': 1 });
  assert.equal((await run('Send invoice', 5)).result, 'empty');
}));

test('the tasks starter marks done, reopens, duplicates and counts progress', withStarter('tasks', async (s) => {
  const task = (id: number) => s.get('Tasks', id).fieldData;
  const project = (id: number) => s.get('Projects', id).fieldData;
  assert.deepEqual([project(1)['Task Count'], project(1)['Done Count'], project(1)['Percent Done']], [3, 1, 33]);
  assert.equal(task(2).Overdue, 1);
  assert.equal(task(1).Overdue, 0);
  const run = (name: string, id: number) => runScript(s, name, { layout: 'Tasks', foundSet: [id], recordId: id });
  assert.equal((await run('Mark done', 1)).result, 'already done');
  assert.equal((await run('Mark done', 2)).result, 'done');
  assert.deepEqual([task(2).Status, task(2).Overdue], ['Done', 0]);
  assert.ok(task(2)['Done On']);
  assert.equal(project(1)['Percent Done'], 67);
  assert.equal((await run('Reopen', 3)).result, 'not done');
  assert.equal((await run('Reopen', 2)).result, 'reopened');
  assert.deepEqual([task(2).Status, task(2)['Done On']], ['To do', '']);
  assert.equal((await run('Duplicate task', 1)).result, 'duplicated');
  const copy = task(6);
  assert.deepEqual([copy.Title, copy.Status, copy['Done On']], ['Order timber', 'To do', '']);
}));

test('the booking starter refuses double bookings and lets a cancelled slot go again', withStarter('booking', async (s) => {
  const book = async (parameter: string) => (await runScript(s, 'Book', { layout: 'Bookings', parameter })).result;
  assert.equal(s.get('Bookings', 1).fieldData.Hours, 2);
  assert.equal(s.get('Bookings', 2).fieldData.Hours, 1.5);
  assert.equal(await book('1|Dan Fox|2026-11-02|10:00:00|12:00:00'), 'that time is already booked');
  assert.equal(await book('1|Dan Fox|2026-11-02|08:00:00|09:00:01'), 'that time is already booked');
  assert.equal(await book('1|Dan Fox|2026-11-02|11:00:00|12:00:00'), 'booked');
  assert.equal(await book('1|Dan Fox|2026-11-02|11:30:00|12:30:00'), 'that time is already booked');
  assert.equal(await book('2|Eve Park|2026-11-03|10:00:00|12:00:00'), 'booked');
  assert.equal(await book('1|Eve Park|2026-11-02|12:00:00|11:00:00'), 'the end must be after the start');
  assert.equal(await book('1||2026-11-02|15:00:00|16:00:00'), 'need resource, customer, day, start and end');
  const one = (id: number, name: string) => runScript(s, name, { layout: 'Bookings', foundSet: [id], recordId: id });
  assert.equal((await one(2, 'Confirm booking')).result, 'confirmed');
  assert.equal((await one(3, 'Confirm booking')).result, 'cancelled');
  assert.equal((await one(2, 'Cancel booking')).result, 'cancelled');
  assert.equal((await one(2, 'Cancel booking')).result, 'already cancelled');
  assert.equal(await book('1|Fay Lin|2026-11-02|13:00:00|14:00:00'), 'booked');
}));

test('tabularius new --starter builds the app, refuses a bad name and leaves nothing behind on a failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-starter-cli-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    let r = run('new', dir, 'Shop', '--starter', 'invoicing');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /created Shop from the invoicing starter: 4 tables, 9 layouts, 3 scripts, 2 privilege sets \(Staff, Read only\)/);
    assert.match(r.stdout, /11 sample records were added/);
    r = run('new', dir, 'Bare', '--starter', 'crm', '--no-sample');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /sample records/);
    r = run('new', dir, 'Native', '--native', '--starter', 'tasks');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /created Native from the tasks starter: 2 tables/);
    r = run('new', dir, 'Nope', '--starter', 'nope');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--starter takes one of crm, inventory, invoicing, tasks, booking \(not "nope"\)/);
    assert.equal(existsSync(join(dir, 'Nope.openhbam.sqlite')), false);
    r = run('new', dir, 'Odd', '--no-sample');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--no-sample goes with --starter/);
    assert.equal(existsSync(join(dir, 'Odd.openhbam.sqlite')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
