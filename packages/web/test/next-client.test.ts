// The alternative client's guesses and search parsing (packages/web/next), without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collections, humanize, isKey, listColumns, pages, pickTitle, type Column } from '../next/model.ts';
import { parse, requests, unparse } from '../next/query.ts';
import { score } from '../next/palette.ts';
import { show, fromInputDate, toInputDate, initials } from '../next/values.ts';
import type { FieldMeta, LayoutMeta } from '../src/types.ts';

const col = (name: string, type = 'text'): Column => ({ name, label: humanize(name), type, key: isKey(name), calculated: false, readOnly: false });

test('field names read as words', () => {
  assert.equal(humanize('first_name'), 'First name');
  assert.equal(humanize('DateCreated'), 'Date created');
  assert.equal(humanize('INVOICE LINES'), 'Invoice lines');
  assert.equal(humanize('URL'), 'URL');
  assert.equal(humanize('Customers::Name'), 'Name');
  assert.equal(humanize('_kp_ID'), 'Kp ID');
});

test('keys are told apart from data', () => {
  for (const k of ['id', 'ID', '_kp_id', 'kf_customer', 'customer_id', 'id_foreign', 'uuid', 'PrimaryKey_pk', 'zzCreated']) assert.ok(isKey(k), k);
  for (const k of ['Name', 'Paid', 'Video', 'Identity', 'Kind', 'Description']) assert.ok(!isKey(k), k);
});

test('a record is named by its name or title field, else its first text field', () => {
  assert.equal(pickTitle([col('id'), col('City'), col('Name')]), 'Name');
  assert.equal(pickTitle([col('Amount', 'number'), col('Product Name')]), 'Product Name');
  assert.equal(pickTitle([col('id'), col('Notes')]), 'Notes');
  assert.equal(pickTitle([col('id'), col('Total', 'number')]), undefined);
});

function meta(name: string, table: string, fields: FieldMeta[], portals: LayoutMeta['portals'] = [], related: Record<string, FieldMeta[]> = {}): LayoutMeta {
  return { layout: { name, id: 1, occurrence: table, table }, fields: { [table]: fields, ...related }, portals } as unknown as LayoutMeta;
}
const f = (name: string, type = 'text', more: Partial<FieldMeta> = {}): FieldMeta => ({ name, type, calculated: false, summary: false, global: false, ...more });

test('each table becomes one collection, read through the layout that shows most of it', () => {
  const people = [f('id'), f('Name'), f('City'), f('Photo', 'container'), f('g_search', 'text', { global: true })];
  const out = collections([
    { meta: meta('People list', 'People', people), hidden: false, placed: ['Name'] },
    { meta: meta('People detail', 'People', people, [{ name: 'Orders', occurrenceId: 2, occurrence: 'People.Orders', fields: ['People.Orders::Total', 'People.Orders::id'] }], { 'People.Orders': [f('id'), f('Total', 'number')] }), hidden: false, placed: ['id', 'Name', 'City', 'Photo', 'g_search'] },
    { meta: meta('zz_Dev', 'Settings', [f('Theme')]), hidden: true },
  ]);
  assert.deepEqual(out.map((c) => [c.label, c.layout, c.quiet]), [['People', 'People detail', false], ['Settings', 'zz_Dev', true]]);
  const p = out[0];
  assert.deepEqual(p.columns.map((c) => c.name), ['id', 'Name', 'City', 'Photo'], 'globals are left out');
  assert.equal(p.title, 'Name');
  assert.equal(p.image, 'Photo');
  assert.deepEqual(p.related.map((r) => [r.label, r.columns.map((c) => c.name)]), [['Orders', ['People.Orders::Total']]]);
  assert.deepEqual(listColumns(p).map((c) => c.name), ['Name', 'City'], 'no keys or pictures as columns');
});

test('a search splits into words and field filters, and becomes find requests', () => {
  const cols = [col('Name'), col('City'), col('First Name'), col('Total', 'number')];
  assert.deepEqual(parse('ada city: Leeds', cols), { words: 'ada', filters: [{ field: 'City', label: 'City', value: 'Leeds' }] });
  assert.deepEqual(parse('first name: "Ada Mae"', cols).filters, [{ field: 'First Name', label: 'First name', value: 'Ada Mae' }]);
  assert.deepEqual(parse('total:>500', cols).filters, [{ field: 'Total', label: 'Total', value: '>500' }]);
  assert.deepEqual(parse('note: hi', cols), { words: 'note:hi', filters: [] }, 'an unknown field stays as words');
  const s = parse('ada total: >5', cols);
  assert.deepEqual(requests(s, [cols[0], cols[1]]), [{ Total: '>5', Name: 'ada' }, { Total: '>5', City: 'ada' }]);
  assert.deepEqual(requests(parse('city: York', cols), cols), [{ City: 'York' }]);
  assert.deepEqual(requests(parse('', cols), cols), []);
  assert.equal(unparse(parse('ada first name: "Ada Mae"', cols)), 'first name: "Ada Mae" ada');
});

test('the command bar ranks prefixes, then word starts, then scattered letters', () => {
  assert.ok(score('cust', 'Customers') > score('cust', 'New customer'));
  assert.ok(score('nc', 'New customer') > 0);
  assert.equal(score('xyz', 'Customers'), 0);
});

test('values read as words; dates go to and from the date picker', () => {
  assert.equal(show(''), '');
  assert.equal(show('hello', { type: 'text' }), 'hello');
  assert.equal(toInputDate('3/7/2026'), '2026-03-07');
  assert.equal(fromInputDate('2026-03-07'), '3/7/2026');
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('Grace'), 'GR');
});

test('a layout that is one web viewer is a page; one with fields or a portal beside it is not', () => {
  const viewer = (id: number, jsBridge = true) => ({ id, kind: 'web-viewer', webUrl: '"https://example.com"', webOptions: { jsBridge } });
  const withDesign = (name: string, objects: unknown[]) => ({ ...meta(name, 'Sales', [f('Total', 'number')]), design: { objects } }) as unknown as LayoutMeta;
  const out = pages([
    { meta: withDesign('Dashboard', [viewer(1), { id: 2, kind: 'text' }]), hidden: false },
    { meta: withDesign('Map', [viewer(1, false)]), hidden: false },
    { meta: withDesign('Form', [viewer(1), { id: 2, kind: 'field', field: { field: 'Total' } }]), hidden: false },
    { meta: withDesign('Two', [viewer(1), viewer(2)]), hidden: false },
    { meta: withDesign('Hidden', [viewer(1)]), hidden: true },
  ]);
  assert.deepEqual(out, [
    { layout: 'Dashboard', table: 'Sales', viewer: 1, bridge: true },
    { layout: 'Map', table: 'Sales', viewer: 1, bridge: false },
  ]);
});
