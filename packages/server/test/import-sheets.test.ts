import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { ImportSheetsError, MAX_ZIP_PAGES, MAX_ZIP_SHEETS, MAX_ZIP_UNPACKED_BYTES, sheetsFromFile, zipAllowance } from '../src/import-sheets.ts';

/** `n` bytes that deflate cannot shrink to under a 1000th: a random block longer than the 32 KiB window, repeated. */
function filler(n: number): Buffer {
  const block = randomBytes(40_000);
  return Buffer.concat(Array.from({ length: Math.ceil(n / block.length) }, () => block)).subarray(0, n);
}

/** A ZIP of the files; a Buffer value is stored deflated, so a large one of repeating bytes stays small. */
function zip(files: Record<string, string | Buffer>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = Buffer.from(name), raw = Buffer.from(value), deflated = typeof value !== 'string';
    const data = deflated ? deflateRawSync(raw) : raw, method = deflated ? 8 : 0;
    const local = Buffer.alloc(30 + n.length + data.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26); n.copy(local, 30); data.copy(local, 30 + n.length);
    locals.push(local);
    const entry = Buffer.alloc(46 + n.length);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(n.length, 28); entry.writeUInt32LE(offset, 42); n.copy(entry, 46);
    central.push(entry); offset += local.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('a Notion Markdown and CSV ZIP produces CSV tables and one page table in archive order', () => {
  const input = zip({
    'Workspace/Projects.csv': 'Name,Active\nAlpha,true\nBeta,false\n',
    'Workspace/Notes/first 0123456789abcdef0123456789abcdef.md': '# First\n\nStatus: Open\n\nPage text',
    'Workspace/Notes/second.md': '# Second\n\nStatus: Done\n',
    'Workspace/Notes/image.png': 'ignored asset',
  });
  const sheets = sheetsFromFile('Workspace.zip', input);
  assert.deepEqual(sheets, [
    { name: 'Projects', rows: [['Name', 'Active'], ['Alpha', 'true'], ['Beta', 'false']] },
    { name: 'Workspace', rows: [['Title', 'Status', 'Body'], ['First', 'Open', 'Page text'], ['Second', 'Done', '']] },
  ]);
});

test('a ZIP without supported exports and an invalid ZIP are refused', () => {
  assert.throws(() => sheetsFromFile('Empty.zip', zip({ 'notes.txt': 'text' })), /no CSV or Markdown exports/);
  assert.throws(() => sheetsFromFile('Bad.zip', Buffer.from('not zip')), /not a zip file/);
});

test('a ZIP that is not usable is an ImportSheetsError, so the route answers 400 and not 500', () => {
  assert.throws(() => sheetsFromFile('Bad.zip', Buffer.from('not zip')), ImportSheetsError);
  assert.throws(() => sheetsFromFile('Empty.zip', zip({ 'notes.txt': 'text' })), ImportSheetsError);
});

test('folders in entry names, with / or \\, are dropped and macOS resource forks are ignored', () => {
  const sheets = sheetsFromFile('Export.zip', zip({
    'Export/Deep\\Er/Projects abcdef0123456789abcdef0123456789.csv': 'Name\nAlpha\n',
    '__MACOSX/Export/._Projects.csv': 'binary',
    '__MACOSX/Export/.DS_Store.csv': 'binary',
    'Export/._Other.csv': 'binary',
    '../../outside.csv': 'Name\nBeta\n',
  }));
  assert.deepEqual(sheets.map((s) => s.name), ['Projects', 'outside']);
});

test('two CSVs of one name in different folders become two tables', () => {
  const sheets = sheetsFromFile('Export.zip', zip({ 'one/A.csv': 'x\n1\n', 'two/A.csv': 'x\n2\n', 'three/a.csv': 'x\n3\n' }));
  assert.deepEqual(sheets.map((s) => [s.name, s.rows[1][0]]), [['A', '1'], ['A 2', '2'], ['a 3', '3']]);
});

test('the page table does not take the name of a CSV in the ZIP', () => {
  const sheets = sheetsFromFile('Projects.zip', zip({ 'Projects.csv': 'Name\nAlpha\n', 'Projects/page.md': '# Page\n' }));
  assert.deepEqual(sheets.map((s) => s.name), ['Projects', 'Projects 2']);
});

test('a ZIP may hold exactly the CSV files and Markdown pages a request may, and no more', () => {
  const csvs: Record<string, string> = {};
  for (let i = 0; i < MAX_ZIP_SHEETS; i++) csvs[`t${i}.csv`] = 'x\n1\n';
  assert.equal(sheetsFromFile('Many.zip', zip(csvs)).length, MAX_ZIP_SHEETS);
  assert.throws(() => sheetsFromFile('Many.zip', zip({ ...csvs, 'one more.csv': 'x\n1\n' })), new RegExp(`more than ${MAX_ZIP_SHEETS} CSV`));
  // The page allowance is checked with a small one: a ZIP itself may hold at most 4096 entries.
  const pages: Record<string, string> = {};
  for (let i = 0; i < 10; i++) pages[`p${i}.md`] = '# P\n';
  const ten = () => ({ ...zipAllowance(), pages: 10 });
  assert.equal(sheetsFromFile('Many.zip', zip(pages), ten())[0].rows.length, 11);
  assert.throws(() => sheetsFromFile('Many.zip', zip({ ...pages, 'one more.md': '# P\n' }), ten()), new RegExp(`more than ${MAX_ZIP_PAGES} Markdown`));
});

test('a ZIP of more than 4096 entries, or with an entry that unpacks to over 1000 times its size, is refused', () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 4097; i++) many[`p${i}.md`] = '# P\n';
  assert.throws(() => sheetsFromFile('Many.zip', zip(many)), (e: Error) => e instanceof ImportSheetsError && /the archive holds 4097 entries; more than 4096 are not read/.test(e.message));
  assert.throws(() => sheetsFromFile('Bomb.zip', zip({ 'Projects.csv': 'Name\nAlpha\n', 'cover.png': Buffer.alloc(4 * 1024 * 1024) })),
    (e: Error) => e instanceof ImportSheetsError && /cover\.png unpacks to 4194304 bytes from \d+, more than 1000 times its size/.test(e.message));
});

test('the limits are shared by the ZIPs of one request', () => {
  const half = filler(MAX_ZIP_UNPACKED_BYTES * 0.6);
  const allowance = zipAllowance();
  assert.equal(sheetsFromFile('One.zip', zip({ 'A.csv': half }), allowance).length, 1);
  assert.throws(() => sheetsFromFile('Two.zip', zip({ 'B.csv': half }), allowance), (e: Error) => e instanceof ImportSheetsError && /expands to more than/.test(e.message));
  const counted = zipAllowance();
  const sixty: Record<string, string> = {};
  for (let i = 0; i < 60; i++) sixty[`t${i}.csv`] = 'x\n1\n';
  sheetsFromFile('One.zip', zip(sixty), counted);
  assert.throws(() => sheetsFromFile('Two.zip', zip(sixty), counted), new RegExp(`more than ${MAX_ZIP_SHEETS} CSV`));
});

test('pictures beside the exports are not unpacked, but a CSV that unpacks past the limit is refused', () => {
  const big = filler(MAX_ZIP_UNPACKED_BYTES + 1024 * 1024);
  const withImage = zip({ 'Projects.csv': 'Name\nAlpha\n', 'cover.png': big });
  assert.deepEqual(sheetsFromFile('Export.zip', withImage).map((s) => s.name), ['Projects']);
  assert.throws(() => sheetsFromFile('Export.zip', zip({ 'Huge.csv': big })), (e: Error) => e instanceof ImportSheetsError && /expands to more than 50 MB/.test(e.message));
});

test('a request with several ZIPs shares one limit between them', async () => {
  const { readImportTablesRequest } = await import('../src/import-tables-route.ts');
  const half = filler(MAX_ZIP_UNPACKED_BYTES * 0.6);
  const part = (file: string, data: Uint8Array) => Buffer.concat([
    Buffer.from(`--b\r\ncontent-disposition: form-data; name="file"; filename="${file}"\r\ncontent-type: application/zip\r\n\r\n`), data, Buffer.from('\r\n')]);
  const body = (...zips: [string, Uint8Array][]) => Buffer.concat([...zips.map(([f, d]) => part(f, d)), Buffer.from('--b--\r\n')]);
  const type = 'multipart/form-data; boundary=b';
  assert.equal(readImportTablesRequest(type, body(['One.zip', zip({ 'A.csv': half })])).sheets.length, 1);
  assert.throws(() => readImportTablesRequest(type, body(['One.zip', zip({ 'A.csv': half })], ['Two.zip', zip({ 'B.csv': half })])), /Two\.zip: .*expands to more than/);
});

test('web-b-9: import overrides keep a sheet named __proto__ as an own key', async () => {
  const { readImportTablesRequest } = await import('../src/import-tables-route.ts');
  const overrides = JSON.stringify({ ['__proto__']: { Name: 'skip' } });
  const body = Buffer.from(`--b\r\ncontent-disposition: form-data; name="file"; filename="__proto__.csv"\r\ncontent-type: text/csv\r\n\r\nName\r\nOne\r\n--b\r\ncontent-disposition: form-data; name="overrides"\r\n\r\n${overrides}\r\n--b--\r\n`);
  const parsed = readImportTablesRequest('multipart/form-data; boundary=b', body);
  assert.deepEqual(parsed.sheets.map((s) => s.name), ['__proto__']);
  assert.equal(Object.hasOwn(parsed.overrides, '__proto__'), true);
  assert.equal(parsed.overrides['__proto__'].Name, 'skip');
  assert.equal(({} as Record<string, unknown>).Name, undefined);
});
