// `tabularius import-tables`: CSV files from Airtable and Notion, a workbook with two sheets, and a folder of Notion pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { xlsx } from '../../scripts/src/xlsx.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-import-tables-cli-'));
  createStore(join(dir, 'Work.openhbam.sqlite'));
  return dir;
}
const rows = (dir: string, sql: string) => {
  const s = new Store(join(dir, 'Work.openhbam.sqlite'), 'Work');
  try { return s.select(sql, [], 1000).rows; } finally { s.close(); }
};
const tables = (dir: string) => {
  const s = new Store(join(dir, 'Work.openhbam.sqlite'), 'Work');
  try { return s.schema.tables.map((t) => t.name); } finally { s.close(); }
};

test('Airtable CSVs: a BOM, quoted newlines, ragged rows, duplicate headers, linked records', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'Clients-Grid view.csv'), '﻿Name,Notes,Name\r\nAcme,"line one\nline two",dup\r\nBeta,short\r\nGamma,"has, comma",x,extra\r\n');
    writeFileSync(join(dir, 'Orders-Grid view.csv'), 'Order,Client,Total\r\n1,Acme,$10.50\r\n2,"Acme, Beta",20\r\n3,Gamma,"1,000"\r\n');
    const preview = cli('import-tables', dir, 'Work', join(dir, 'Clients-Grid view.csv'), join(dir, 'Orders-Grid view.csv'), '--preview');
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Clients -> table "Clients": 3 rows, 2 ragged/);
    assert.match(preview.stdout, /Client\s+link -> Clients/);
    assert.match(preview.stdout, /Total\s+number/);
    assert.deepEqual(tables(dir), [], 'a preview writes nothing');
    const r = cli('import-tables', dir, 'Work', join(dir, 'Clients-Grid view.csv'), join(dir, 'Orders-Grid view.csv'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 tables, .* 1 join table holding 4 links/);
    assert.match(r.stdout, /Formulas are not translated/);
    assert.doesNotMatch(r.stdout, /Acme|line one/, 'the report is counts, not values');
    assert.deepEqual(tables(dir), ['Clients', 'Orders', 'Orders Client']);
    assert.deepEqual(rows(dir, 'SELECT "Name", "Notes", "Name 2" FROM "Clients" ORDER BY "ID"'), [['Acme', 'line one\nline two', 'dup'], ['Beta', 'short', null], ['Gamma', 'has, comma', 'x']]);
    assert.deepEqual(rows(dir, 'SELECT o."Order", o."Total", c."Name" FROM "Orders" o JOIN "Orders Client" j ON j."Orders ID" = o."ID" JOIN "Clients" c ON c."ID" = j."Clients ID" ORDER BY o."ID", c."ID"'),
      [['1', 10.5, 'Acme'], ['2', 20, 'Acme'], ['2', 20, 'Beta'], ['3', 1000, 'Gamma']].map(([a, b, c]) => [Number(a), b, c]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an Excel workbook with two sheets, and a folder of Notion pages', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'Book.xlsx'), xlsx([['Item', 'Qty'], ['bolt', 5], ['nut', 7]], 'Parts'));
    mkdirSync(join(dir, 'Notes 0123456789abcdef0123456789abcdef'));
    writeFileSync(join(dir, 'Notes 0123456789abcdef0123456789abcdef', 'A 0123456789abcdef0123456789abcdef.md'), '# A\n\nStatus: Open\n\nbody a\n');
    writeFileSync(join(dir, 'Notes 0123456789abcdef0123456789abcdef', 'B.md'), '# B\n\nStatus: Done\n\nbody b\n');
    const r = cli('import-tables', dir, 'Work', join(dir, 'Book.xlsx'), join(dir, 'Notes 0123456789abcdef0123456789abcdef'));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(tables(dir), ['Parts', 'Notes']);
    assert.deepEqual(rows(dir, 'SELECT "Item", "Qty" FROM "Parts" ORDER BY "ID"'), [['bolt', 5], ['nut', 7]]);
    assert.deepEqual(rows(dir, 'SELECT "Title", "Status", "Body" FROM "Notes" ORDER BY "ID"'), [['A', 'Open', 'body a'], ['B', 'Done', 'body b']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--set chooses a kind, and a mistake is refused before anything is written', () => {
  const dir = setup();
  try {
    writeFileSync(join(dir, 'Codes.csv'), 'Code,Qty\nA,1\nB,2\n');
    const bad = cli('import-tables', dir, 'Work', join(dir, 'Codes.csv'), '--set', 'Codes.Qty=banana');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not a column kind/);
    assert.equal(cli('import-tables', dir, 'Work', join(dir, 'Codes.csv'), '--set', 'Nope.Qty=text').status, 1);
    assert.deepEqual(tables(dir), []);
    const ok = cli('import-tables', dir, 'Work', join(dir, 'Codes.csv'), '--set', 'Codes.Qty=text');
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(rows(dir, 'SELECT "Qty" FROM "Codes" ORDER BY "ID"'), [['1'], ['2']]);
    // Importing again names a table that now exists: the new one gets a number.
    assert.equal(cli('import-tables', dir, 'Work', join(dir, 'Codes.csv')).status, 0);
    assert.deepEqual(tables(dir), ['Codes', 'Codes 2']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
