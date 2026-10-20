import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { scriptStepName, scriptText, type Script } from '@tabularius/fmp12';
import { importFmp12, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';
import { appendPdf, pdf } from '../src/pdf.ts';

// DEMO_drawers: the RECORD layout shows text fields and a container.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'DEMO_drawers.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let docs: string;
let store: Store;

before(() => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-'));
  docs = join(dir, 'Documents');
  importFmp12(fixture, join(dir, 'Drawers.sqlite'));
  store = new Store(join(dir, 'Drawers.sqlite'));
});
after(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true });
});

/** A script from the text FileMaker's script workspace shows. */
function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}
const run = (text: string) => runScript(store, script(text), { layout: 'RECORD', documents: docs });

test('data files: create, write, read, position, close, rename and delete in the documents folder', { skip }, async () => {
  const r = await run(`
    Set Error Capture [ On ]
    Set Variable [ $path ; Value: Get ( DocumentsPath ) & "logs/change.log" ]
    Create Data File [ “$path” ; Create folders: On ]
    Open Data File [ “$path” ; Target: $id ]
    Set Variable [ $line ; Value: "héllo" ]
    Write to Data File [ File ID: $id ; Data source: $line ; Write as: UTF-8 ; Append line feed ]
    Write to Data File [ File ID: $id ; Data source: $line ; Write as: UTF-8 ]
    Get Data File Position [ File ID: $id ; Target: $end ]
    Set Data File Position [ File ID: $id ; New position: 0 ]
    Read from Data File [ File ID: $id ; Amount (bytes): 3 ; Target: $first ; Read as: UTF-8 ]
    Read from Data File [ File ID: $id ; Target: $rest ; Read as: UTF-8 ]
    Read from Data File [ File ID: $id ; Target: $more ; Read as: UTF-8 ]
    Set Variable [ $eof ; Value: Get ( LastError ) ]
    Open Data File [ “$path” ; Target: $again ]
    Set Variable [ $inUse ; Value: Get ( LastError ) ]
    Close Data File [ File ID: $id ]
    Get File Size [ “$path” ; Target: $size ]
    Rename File [ Source file: “$path” ; New name: "old.log" ]
    Get File Exists [ “$path” ; Target: $before ]
    Get File Exists [ “file:old.log” ; Target: $flat ]
    Set Variable [ $old ; Value: Get ( DocumentsPath ) & "logs/old.log" ]
    Get File Exists [ “$old” ; Target: $renamed ]
    Delete File [ Target file: “$old” ]
    Get File Exists [ “$old” ; Target: $after ]
    Exit Script [ Result: List ( $end ; $first ; $rest ; $eof ; $inUse ; $size ; $before ; $flat ; $renamed ; $after ) ]
  `);
  // "héllo" is 6 bytes in UTF-8; the first 3 bytes are "hé".
  assert.equal(r.result, ['13', 'hé', 'llo\nhéllo', '10', '300', '13', '0', '0', '1', '0'].join('\r'));
  assert.deepEqual(readdirSync(join(docs, 'logs')), []);
});

test('data files: UTF-16 by default, bytes into a container, and nothing outside the documents folder', { skip }, async () => {
  const r = await run(`
    Set Error Capture [ On ]
    Create Data File [ “../escape.txt” ]
    Set Variable [ $outside ; Value: Get ( LastError ) ]
    Create Data File [ “file:/etc/notes.txt” ]
    Open Data File [ “filemac:/Macintosh HD/Users/someone/notes.txt” ; Target: $id ]
    Set Variable [ $text ; Value: "ab" ]
    Write to Data File [ File ID: $id ; Data source: $text ]
    Get Data File Position [ File ID: $id ; Target: $pos ]
    Set Data File Position [ File ID: $id ; New position: 0 ]
    Read from Data File [ File ID: $id ; Target: $back ]
    Set Data File Position [ File ID: $id ; New position: 0 ]
    Read from Data File [ File ID: $id ; Target: $bytes ; Read as: Bytes ]
    Close Data File [ File ID: $id ]
    Close Data File [ File ID: $id ]
    Set Variable [ $closed ; Value: Get ( LastError ) ]
    Get File Size [ “missing.txt” ; Target: $none ]
    Set Variable [ $missing ; Value: Get ( LastError ) ]
    Exit Script [ Result: List ( $outside ; $pos ; $back ; $bytes ; Length ( Base64Encode ( $bytes ) ) ; $closed ; $missing ) ]
  `);
  // "../escape.txt" counts by its file name, so it lands in the documents folder too.
  assert.equal(r.result, ['0', '4', 'ab', 'notes.txt', '8', '100', '100'].join('\r'));
  assert.ok(existsSync(join(docs, 'escape.txt')));
  assert.ok(!existsSync(join(dir, 'escape.txt')));
  assert.deepEqual([...readFileSync(join(docs, 'notes.txt'))], [0x61, 0, 0x62, 0]);
});

test('data files: open files close when the script ends; temporary files go', { skip }, async () => {
  const r = await run(`
    Set Variable [ $tmp ; Value: Get ( TemporaryPath ) & "scratch.txt" ]
    Create Data File [ “$tmp” ]
    Open Data File [ “$tmp” ; Target: $id ]
    Exit Script [ Result: Get ( TemporaryPath ) & "|" & $id ]
  `);
  assert.equal(r.result, '/Temporary/|1');
  assert.ok(!existsSync(join(docs, 'scratch.txt')));
});

test('Export Records writes the found set as comma- or tab-separated values or a merge file', { skip }, async () => {
  const ids = store.findIds('RECORD');
  const fields = store.layout('RECORD').fields.filter((f) => !f.calculated && !f.summary).slice(0, 2).map((f) => f.name);
  const r = await runScript(store, script(`
    Export Records [ With dialog: Off ; “out.csv” ; Unicode (UTF-8) ; Fields: RECORD::${fields[0]}, RECORD::${fields[1]} ]
    Export Records [ With dialog: Off ; “file:out.mer” ; Fields: RECORD::${fields[0]} ]
    Export Records [ With dialog: Off ; “out.tab” ; Fields: RECORD::${fields[0]} ]
    Set Error Capture [ On ]
    Export Records [ With dialog: Off ; “out.dbf” ]
    Exit Script [ Result: Get ( LastError ) ]
  `), { layout: 'RECORD', foundSet: ids.slice(0, 2), documents: docs });
  assert.equal(r.result, '3');
  const csv = readFileSync(join(docs, 'out.csv'), 'utf8').split('\r\n');
  assert.equal(csv.length, 3);
  assert.match(csv[0], /^".*",".*"$/);
  const mer = readFileSync(join(docs, 'out.mer'), 'utf8').split('\r\n');
  assert.equal(mer[0], `"${fields[0]}"`);
  assert.equal(mer.length, 4);
  const tab = readFileSync(join(docs, 'out.tab'), 'utf8').split('\r\n');
  assert.equal(tab[0], csv[0].split('","')[0].slice(1).replace(/"$/, ''));
});

test('with downloads, exported files go to the person as actions and not to the documents folder', { skip }, async () => {
  const ids = store.findIds('RECORD');
  const field = store.layout('RECORD').fields.find((f) => !f.calculated && !f.summary)!.name;
  const r = await runScript(store, script(`
    Set Variable [ $name ; Value: "folder/sent.csv" ]
    Export Records [ With dialog: Off ; “$name” ; Unicode (UTF-8) ; Fields: RECORD::${field} ]
    Save Records as Excel [ With dialog: Off ; “” ; Records being browsed ]
  `), { layout: 'RECORD', foundSet: ids.slice(0, 2), documents: docs, downloads: true });
  assert.equal(r.error, 0);
  const files = r.actions.filter((a) => typeof a.download === 'string');
  assert.deepEqual(files.map((a) => a.download), ['sent.csv', 'Untitled.xlsx']);
  assert.equal(Buffer.from(String(files[0].base64), 'base64').toString('utf8').split('\r\n').length, 3);
  assert.equal(Buffer.from(String(files[1].base64), 'base64').subarray(0, 2).toString(), 'PK');
  assert.ok(!existsSync(join(docs, 'sent.csv')));
});

/** The files in a zip, by name (enough for the workbooks Export Records writes). */
function unzip(b: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  for (let at = 0; b.readUInt32LE(at) === 0x04034b50;) {
    const size = b.readUInt32LE(at + 18);
    const nameLength = b.readUInt16LE(at + 26);
    const name = b.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + b.readUInt16LE(at + 28);
    out.set(name, inflateRawSync(b.subarray(start, start + size)).toString('utf8'));
    at = start + size;
  }
  return out;
}

test('Export Records writes an Excel workbook', { skip }, async () => {
  const ids = store.findIds('RECORD').slice(0, 3);
  const onLayout = new Set(store.layout('RECORD').fields.map((f) => f.name));
  const text = store.schema.tables.find((t) => t.name === 'RECORD')!.fields
    .find((f) => onLayout.has(f.name) && f.kind === 'normal' && f.type === 'text' && !f.options?.autoEnter && !f.options?.global)!.name;
  const r = await runScript(store, script(`
    Set Variable [ $n ; Value: 0 ]
    Loop
      Set Variable [ $n ; Value: $n + 1 ]
      Set Field [ RECORD::${text} ; "a <b> & \\"c\\"" & $n ]
      Go to Record/Request/Page [ Next ; Exit after last: On ]
    End Loop
    Export Records [ With dialog: Off ; “Get(DocumentsPath)/ignored/out.xlsx” ; Fields: RECORD::${text} ]
    Exit Script [ Result: Get ( LastError ) ]
  `), { layout: 'RECORD', foundSet: ids, documents: docs });
  assert.equal(r.result, '0');
  const parts = unzip(readFileSync(join(docs, 'out.xlsx')));
  assert.deepEqual([...parts.keys()], ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  const sheet = parts.get('xl/worksheets/sheet1.xml')!;
  assert.equal([...sheet.matchAll(/<row /g)].length, 3);
  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">a &lt;b&gt; &amp; &quot;c&quot;1<\/t><\/is><\/c>/);
});

/** Page count and shown text of a PDF Save Records as PDF wrote; checks its cross-reference table too. */
function readPdf(b: Buffer): { pages: number; text: string } {
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  const offsets = s.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  offsets.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1} at ${o}`));
  const text = [...s.matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) => m[1]).join('\n');
  return { pages: Number(/\/Count (\d+)/.exec(s)![1]), text };
}

/**
 * The page count of a PDF that may have been added to (incremental updates):
 * follows the newest trailer and each /Prev, checking every object the
 * cross-references name is where they say, then counts the newest page tree.
 */
function pdfPageCount(b: Buffer): number {
  const s = b.toString('latin1');
  const where = new Map<number, number>();
  let at: number | undefined = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
  let root: number | undefined;
  while (at !== undefined) {
    assert.ok(s.startsWith('xref\n', at));
    const t = s.indexOf('trailer', at);
    const lines = s.slice(at + 5, t).trim().split('\n');
    for (let i = 0; i < lines.length;) {
      const [from, count] = lines[i].split(' ').map(Number);
      for (let k = 0; k < count; k++) {
        const line = lines[i + 1 + k];
        if (/ n\s*$/.test(line) && !where.has(from + k)) {
          const o = Number(line.slice(0, 10));
          assert.ok(s.startsWith(`${from + k} 0 obj`, o), `object ${from + k} at ${o}`);
          where.set(from + k, o);
        }
      }
      i += 1 + count;
    }
    const trailer = s.slice(t, s.indexOf('startxref', t));
    root ??= Number(/\/Root (\d+) 0 R/.exec(trailer)![1]);
    const prev = /\/Prev (\d+)/.exec(trailer);
    at = prev ? Number(prev[1]) : undefined;
  }
  const body = (n: number) => s.slice(where.get(n)!, s.indexOf('endobj', where.get(n)!));
  const tree = Number(/\/Pages (\d+) 0 R/.exec(body(root!))![1]);
  const kids = [...body(tree).match(/\/Kids \[([^\]]*)\]/)![1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  for (const k of kids) assert.match(body(k), new RegExp(`/Type /Page /Parent ${tree} 0 R`));
  const count = Number(/\/Count (\d+)/.exec(body(tree))![1]);
  assert.equal(kids.length, count);
  return count;
}

test('Save Records as PDF draws the found set or one record on the layout', { skip }, async () => {
  const ids = store.findIds('RECORD').slice(0, 3);
  const text = 'field_text_01'; // drawn in the RECORD layout's body
  const r = await runScript(store, script(`
    Set Variable [ $n ; Value: 0 ]
    Loop
      Set Variable [ $n ; Value: $n + 1 ]
      Set Field [ RECORD::${text} ; "Drawer (" & $n & ")" ]
      Go to Record/Request/Page [ Next ; Exit after last: On ]
    End Loop
    Save Records as PDF [ With dialog: Off ; “all.pdf” ; Records being browsed ; Create folders: Off ]
    Go to Record/Request/Page [ First ]
    Save Records as PDF [ With dialog: Off ; “file:pdf/one.pdf” ; Current record ; Create folders: On ]
    Save Records as PDF [ With dialog: Off ; “blank.pdf” ; Blank record ; Create folders: Off ]
    Exit Script [ Result: Get ( LastError ) ]
  `), { layout: 'RECORD', foundSet: ids, documents: docs });
  assert.equal(r.result, '0');
  const all = readPdf(readFileSync(join(docs, 'all.pdf')));
  for (const n of [1, 2, 3]) assert.ok(all.text.includes(`Drawer \\(${n}\\)`), all.text);
  const one = readPdf(readFileSync(join(docs, 'one.pdf')));
  assert.ok(one.text.includes('Drawer \\(1\\)'));
  assert.ok(!one.text.includes('Drawer \\(2\\)'));
  assert.ok(!readPdf(readFileSync(join(docs, 'blank.pdf'))).text.includes('Drawer'));
});

test('Save Records as PDF with Append adds the pages after those already in the file', { skip }, async () => {
  const ids = store.findIds('RECORD').slice(0, 2);
  const save = (name: string, append: boolean) => `Save Records as PDF [ With dialog: Off ;${append ? ' Append ;' : ''} “${name}” ; Records being browsed ; Create folders: Off ]`;
  const r = await runScript(store, script(`
    Set Error Capture [ On ]
    ${save('grow.pdf', false)}
    Set Variable [ $first ; Get ( LastError ) ]
    ${save('grow.pdf', true)}
    Set Variable [ $second ; Get ( LastError ) ]
    Go to Record/Request/Page [ First ]
    ${save('grow.pdf', true)}
    ${save('fresh.pdf', true)}
    Exit Script [ Result: $first & $second & Get ( LastError ) ]
  `), { layout: 'RECORD', foundSet: ids, documents: docs });
  assert.equal(r.result, '000');
  const once = pdfPageCount(pdf([{ width: 1, height: 1, ops: [] }]));
  assert.equal(once, 1);
  const fresh = pdfPageCount(readFileSync(join(docs, 'fresh.pdf'))); // Append with no file yet: a new one
  const grown = readFileSync(join(docs, 'grow.pdf'));
  // The first save's bytes are untouched at the front; two updates follow.
  assert.equal(grown.toString('latin1').match(/%%EOF/g)!.length, 3);
  assert.equal(pdfPageCount(grown), fresh * 3);
  const info = spawnSync('pdfinfo', [join(docs, 'grow.pdf')], { encoding: 'utf8' });
  if (!info.error) {
    assert.equal(info.status, 0, info.stderr);
    assert.match(info.stdout, new RegExp(`Pages:\\s+${fresh * 3}\\n`));
  }
});

test('appendPdf keeps a trailer /ID holding "]", and added pages don\'t take the old tree\'s rotation', () => {
  // Another writer's PDF: the tree rotates its pages, has a comment, and the trailer's /ID holds a "]".
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 90 % a comment ]>> (\n>>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
  ];
  let base = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = base.length;
    base += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = base.length;
  base += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  base += `trailer\n<< /Size 4 /Root 1 0 R /ID [(ab]c) <0A0B>] >>\nstartxref\n${xref}\n%%EOF\n`;
  const before = Buffer.from(base, 'latin1');
  const grown = Buffer.concat([before, appendPdf(before, [{ width: 200, height: 200, ops: [] }])]);
  const s = grown.toString('latin1');
  assert.match(s.slice(s.lastIndexOf('trailer')), /\/ID \[\(ab\]c\) <0A0B>\] \/Prev \d+ >>/);
  assert.equal(grown.subarray(0, before.length).compare(before), 0);
  assert.equal(pdfPageCount(grown), 2);
  assert.match(s.slice(before.length), /\/MediaBox \[0 0 200 200\] \/CropBox \[0 0 200 200\] \/Rotate 0 /);
  assert.match(s.slice(before.length), /\/Rotate 90 % a comment/); // the tree keeps what it had
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-id-pdf-'));
  try {
    const tmp = join(folder, 'id.pdf');
    writeFileSync(tmp, grown);
    const info = spawnSync('pdfinfo', [tmp], { encoding: 'utf8' });
    if (!info.error) {
      assert.equal(info.status, 0, info.stderr);
      assert.equal(info.stderr, '');
    }
  } finally { rmSync(folder, { recursive: true }); }
});

test('Save Records as PDF with Append refuses a file it cannot add to (800), leaving it as it was', { skip }, async () => {
  for (const [name, bytes] of [
    ['notpdf.pdf', Buffer.from('just text')],
    ['compressed.pdf', Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /XRef /Size 1 >>\nstream\nendstream\nendobj\nstartxref\n9\n%%EOF\n')],
    ['locked.pdf', Buffer.from(pdf([{ width: 1, height: 1, ops: [] }]).toString('latin1').replace('/Info 3 0 R', '/Info 3 0 R /Encrypt 3 0 R'), 'latin1')],
  ] as const) {
    writeFileSync(join(docs, name), bytes);
    const r = await runScript(store, script(`Set Error Capture [ On ]\nSave Records as PDF [ With dialog: Off ; Append ; “${name}” ; Current record ; Create folders: Off ]\nExit Script [ Result: Get ( LastError ) ]`),
      { layout: 'RECORD', foundSet: store.findIds('RECORD').slice(0, 1), documents: docs });
    assert.equal(r.result, '800', name);
    assert.deepEqual(readFileSync(join(docs, name)), bytes, name);
  }
});

test('Save Records as PDF over a big found set stops at the memory limit', { skip }, async () => {
  // The same records over and over stand in for a big found set; the step reads fields for every one.
  const ids = Array.from({ length: 3000 }, () => store.findIds('RECORD')).flat().slice(0, 3000);
  const r = await runScript(store, script('Save Records as PDF [ With dialog: Off ; “big.pdf” ; Records being browsed ; Create folders: Off ]'),
    { layout: 'RECORD', foundSet: ids, documents: docs, memoryLimit: 1 });
  assert.ok(r.actions.some((a) => a.step === 'Halt Script' && /memory limit reached/.test(String((a as { reason?: string }).reason))));
  assert.ok(!existsSync(join(docs, 'big.pdf')));
});

test('file steps read back from their script text', { skip }, () => {
  const text = [
    'Get File Exists [ “$path” ; Target: $exists ]',
    'Create Data File [ “$path” ; Create folders: On ]',
    'Write to Data File [ File ID: $id ; Data source: $data ; Write as: UTF-8 ; Append line feed ]',
    'Read from Data File [ File ID: $id ; Amount (bytes): 10 ; Target: $data ; Read as: Bytes ]',
    'Set Data File Position [ File ID: $id ; New position: 0 ]',
    'Rename File [ Source file: “$path” ; New name: "b.txt" ]',
    'Delete File [ Target file: “$path” ]',
    'Export Records [ With dialog: Off ; “out.csv” ; Unicode (UTF-8) ]',
    'Save Records as PDF [ With dialog: Off ; “out.pdf” ; Current record ; Create folders: On ]',
  ].join('\n');
  const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name ?? scriptStepName(s.stepId!), enabled: true, params: s.params }));
  assert.equal(scriptText(steps), text);
});
