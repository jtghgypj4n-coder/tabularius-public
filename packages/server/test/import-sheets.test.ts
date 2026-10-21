import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetsFromFile } from '../src/import-sheets.ts';

function zip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(value);
    const local = Buffer.alloc(30 + n.length + data.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26); n.copy(local, 30); data.copy(local, 30 + n.length);
    locals.push(local);
    const entry = Buffer.alloc(46 + n.length);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
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
