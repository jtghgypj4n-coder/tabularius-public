import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lines, pairs, requestLines, requests } from '../src/design/script-test-input.ts';

test('globals and expected values are "name = value" lines', () => {
  assert.deepEqual(pairs('$$user = Ann\n\nInvoices::gYear = 2026\nno equals here\nTotal = a=b'), { $$user: 'Ann', 'Invoices::gYear': '2026', Total: 'a=b' });
  assert.equal(pairs('  \n'), undefined);
  assert.equal(lines({ $$a: '1', 'T::f': 'x' }), '$$a = 1\nT::f = x');
});

test('find requests are one per line, "Field: criterion" parts joined by " ; ", Table::Field names kept whole', () => {
  const r = requests('Status: open ; Amount: >100\nInvoices::Due: 1/1/2026...12/31/2026\n\n');
  assert.deepEqual(r, [{ Status: 'open', Amount: '>100' }, { 'Invoices::Due': '1/1/2026...12/31/2026' }]);
  assert.equal(requestLines(r), 'Status: open ; Amount: >100\nInvoices::Due: 1/1/2026...12/31/2026');
  assert.equal(requests(''), undefined);
});
