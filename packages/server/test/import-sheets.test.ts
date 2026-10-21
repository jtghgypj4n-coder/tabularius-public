import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { ImportSheetsError, MAX_ZIP_PAGES, MAX_ZIP_SHEETS, MAX_ZIP_UNPACKED_BYTES, sheetsFromFile } from '../src/import-sheets.ts';

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

test('a ZIP holds at most the CSV files and Markdown pages a request may', () => {
  const csvs: Record<string, string> = {};
  for (let i = 0; i <= MAX_ZIP_SHEETS; i++) csvs[`t${i}.csv`] = 'x\n1\n';
  assert.throws(() => sheetsFromFile('Many.zip', zip(csvs)), new RegExp(`more than ${MAX_ZIP_SHEETS} CSV`));
  const pages: Record<string, string> = {};
  for (let i = 0; i <= MAX_ZIP_PAGES; i++) pages[`p${i}.md`] = '# P\n';
  assert.throws(() => sheetsFromFile('Many.zip', zip(pages)), new RegExp(`more than ${MAX_ZIP_PAGES} Markdown`));
});

test('pictures beside the exports are not unpacked, but a CSV that unpacks past the limit is refused', () => {
  const big = Buffer.alloc(MAX_ZIP_UNPACKED_BYTES + 1024 * 1024, 'a');
  const withImage = zip({ 'Projects.csv': 'Name\nAlpha\n', 'cover.png': big });
  assert.deepEqual(sheetsFromFile('Export.zip', withImage).map((s) => s.name), ['Projects']);
  assert.throws(() => sheetsFromFile('Export.zip', zip({ 'Huge.csv': big })), (e: Error) => e instanceof ImportSheetsError && /expands to more than 50 MB/.test(e.message));
});
