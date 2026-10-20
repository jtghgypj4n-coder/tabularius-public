import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePayload, pathValue, pathInt, decodeScsu, decodeText, decodeFieldKey, parseDate, parseTime, parseTimestamp, typedValue, inferDateOrder, inferDatePadding, pathList, exportFields } from '../src/index.ts';
import { encodePathInt } from '../src/file.ts';
import { readPortalSort, readLayoutView, readActiveSegment } from '../src/layouts.ts';

const xor = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'), (b) => b ^ 0x5a);

test('pathValue: prefix-length varint', () => {
  assert.equal(pathValue(Uint8Array.of(0x7f)), 127);
  assert.equal(pathValue(Uint8Array.of(0x80, 0x00)), 128);
  assert.equal(pathValue(Uint8Array.of(0xbf, 0xff)), 16511);
  assert.equal(pathValue(Uint8Array.of(0xc0, 0x00, 0x00)), 16512);
  assert.equal(pathValue(Uint8Array.of(0xc0, 0x07, 0x01)), 18305);
  // 0xD0 in a general segment is an occurrence reference; as a record id it is the varint.
  assert.equal(pathValue(Uint8Array.of(0xd0, 0x30, 0x7d)), 12541);
  assert.equal(pathInt(Uint8Array.of(0xd0, 0x30, 0x7d)), 1077501);
  assert.deepEqual(encodePathInt(1077501), Uint8Array.of(0xd0, 0x30, 0x7d));
});

test('decodePayload: push, key-value, long key-value, pop-after-chunk', () => {
  const name = xor('id');
  const payload = Uint8Array.of(
    0x20, 0x03, // push 3
    0x28, 0x80, 0x01, // push 129 (two-byte path int)
    0x06, 0x10, name.length, ...name, // key 16 = "id"
    0x1e, 0x02, 0xaa, 0xbb, 0x01, 0xcc, // long key 0xaabb -> 0xcc
    0xc1, 0x05, 0x01, // key 5 -> 0x01, then pop
    0x40, // pop
    0x00, 0x00, // end of payload
  );
  const { chunks, error } = decodePayload(payload);
  assert.equal(error, undefined);
  assert.deepEqual(chunks.map((c) => c.type), ['push', 'push', 'kv', 'kvlong', 'kv', 'pop', 'pop']);
  const kv = chunks[2];
  assert.ok(kv.type === 'kv');
  assert.equal(kv.key, 16);
  assert.equal(decodeText(kv.data), 'id');
});

test('decodePayload reports an unknown opcode without throwing', () => {
  const { chunks, error } = decodePayload(Uint8Array.of(0x20, 0x01, 0x3f));
  assert.equal(chunks.length, 1);
  assert.match(error!.message, /unrecognized opcode 0x3f/);
});

test('SCSU: ASCII, Latin-1 window, Unicode mode, and FileMaker line breaks', () => {
  assert.equal(decodeScsu(Buffer.from('Hello')), 'Hello');
  assert.equal(decodeScsu(Uint8Array.of(0xe9)), 'é'); // default window 0 = U+0080
  assert.equal(decodeScsu(Uint8Array.of(0x0f, 0x65, 0xe5, 0x67, 0x2c)), '日本'); // SCU then UTF-16BE
  assert.equal(decodeScsu(Uint8Array.of(0x1b, 0x68, 0x82)), ''); // SD3 window 0x68 -> U+E000
  assert.equal(decodeText(xor('a\rb')), 'a\nb');
});

test('decodeFieldKey: plain ids and repetitions', () => {
  const ids = new Set([1, 2, 200]);
  assert.deepEqual(decodeFieldKey(2, false, ids), [2, 1]);
  assert.deepEqual(decodeFieldKey(200, true, ids), [200, 1]);
  assert.deepEqual(decodeFieldKey(0x80 + (1 << 8) + 3, true, ids), [1, 3]);
  assert.equal(decodeFieldKey(9, false, ids), undefined);
});

test('typed values follow FileMaker text formats', () => {
  assert.equal(parseDate('5/14/2007'), '2007-05-14');
  assert.equal(parseDate('14.5.2007', 'DMY'), '2007-05-14');
  assert.equal(parseTime('1:02 PM'), '13:02:00');
  assert.equal(parseTimestamp('1/2/2007 12:30:15 AM'), '2007-01-02T00:30:15');
  // Year-first text in a month-first file keeps its four-digit year.
  assert.equal(parseTimestamp('2026-07-03 7:59:27 PM'), '2026-07-03T19:59:27');
  assert.equal(parseDate('3/4/26'), '2026-03-04');
  assert.equal(typedValue('1,234.5', 'number'), 1234.5);
  assert.equal(typedValue('n/a', 'number'), 'n/a');
  assert.equal(typedValue('', 'text'), null);
  assert.equal(inferDateOrder(['3/4/2001', '25/4/2001']), 'DMY');
});

test('inferDatePadding: most dates with a leading zero', () => {
  assert.equal(inferDatePadding(['09/25/2026', '08/30/2018 3:05:13 PM', '9/9/2023 9:24:42 AM', '11/16/2018']), true);
  assert.equal(inferDatePadding(['7/18/2026', '1/30/2025 5:36:44 PM', '12/12/2025']), false);
  assert.equal(inferDatePadding(['2009-12-01']), false);
});

test('file path lists: kind, folder (U+E000 separators) and file name', () => {
  const x = (s: string) => [...xor(s)];
  const sep = 0x80 ^ 0x5a;
  // "filemac:/Disk/a/b.csv": the folder is SCSU text whose separators sit in a window at U+E000.
  const mac = [7, ...x('filemac'), 8, 0x1b ^ 0x5a, 0x68 ^ 0x5a, sep, ...x('Disk'), sep, ...x('a'), sep, 5, ...x('b.csv')];
  const variable = [0, 0, 5, ...x('$path')];
  assert.deepEqual(pathList(Uint8Array.from([0, 0, 0, 2, ...mac, ...variable])), ['filemac:/Disk/a/b.csv', '$path']);
  assert.deepEqual(pathList(Uint8Array.from([0, 0, 0, 1, 4, ...x('file'), 0, 11, ...x('Other.fmp12')])), ['file:Other.fmp12']);
});

test('Export Records field order (key 133), as a private sample stores it', () => {
  const hex = (s: string) => Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));
  const b = hex('0002' + '0403d00126020109' + '00010201000201000001' + '0403d001260302800f' + '00010201000201000001');
  const ctx = { tableOccurrenceName: (id: number) => (id === 422 ? 'Receipts' : undefined), fieldName: (to: number, f: number) => `f${f}` } as never;
  assert.deepEqual(exportFields(b, ctx).map((f) => `${f.tableOccurrence.name}::${f.field.name}`), ['Receipts::f9', 'Receipts::f143']);
  assert.deepEqual(exportFields(undefined, ctx), []);
});

test('portal sort order: fields, descending and custom order by value list', () => {
  const hex = (s: string) => Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));
  // Two fields of occurrence 164 (ascending, then descending), laid out as a private sample stores them.
  const two = hex('00000002' + '0403d00024020138' + '000102010002010000' + '0100' + '0100000000' + '0403d0002402014c' + '000102010002010000' + '0101' + '0100000000');
  assert.deepEqual(readPortalSort({}, two).map((s) => [s.field.tableOccurrenceId, s.field.fieldId, !!s.descending]), [[164, 56, false], [164, 76, true]]);
  // Custom order by value list 1.
  const custom = hex('000000010403d0001e02010e' + '000102010002010000' + '0102' + '01010000000000');
  assert.deepEqual(readPortalSort({}, custom), [{ field: { tableOccurrenceId: 158, fieldId: 14 }, valueListId: 1 }]);
  assert.deepEqual(readPortalSort({}, undefined), []);
});

test('readLayoutView: kv 241 byte 6', () => {
  const kv = (b6: number) => Uint8Array.of(0, 0, 0, 0, 0x10, 0xf3, b6, 0x0d);
  assert.equal(readLayoutView(kv(0x08)), 'form');
  assert.equal(readLayoutView(kv(0x0a)), 'list');
  assert.equal(readLayoutView(kv(0x4a)), 'table');
  assert.equal(readLayoutView(undefined), undefined);
});

test('readRules: italic, underline and strikethrough', async () => {
  const { readRules } = await import('../src/styles.ts');
  const { Pb } = await import('../src/proto.ts');
  const varint = (n: number): number[] => n < 128 ? [n] : [(n & 0x7f) | 0x80, ...varint(n >> 7)];
  const num = (field: number, v: number) => [...varint(field << 3), ...varint(v)];
  const msg = (field: number, body: number[]) => [...varint((field << 3) | 2), ...varint(body.length), ...body];
  const prop = (id: number, v: number) => msg(1, [...num(1, id), ...num(3, v)]);
  const rules = (...props: number[][]) => readRules(Pb.parse(Uint8Array.from(msg(1, [...num(1, 1), ...num(2, 1), ...msg(3, props.flat())]))));
  assert.deepEqual(rules(prop(67, 2), prop(504, 0), prop(505, 1))[0].css, { 'font-style': 'italic', 'text-decoration-line': 'underline' });
  assert.deepEqual(rules(prop(67, 1), prop(504, 1), prop(505, 1))[0].css, { 'font-style': 'normal', 'text-decoration-line': 'line-through underline' });
  assert.deepEqual(rules(prop(504, 0), prop(505, 0))[0].css, { 'text-decoration-line': 'none' });
});

test('readRules: line spacing in lines is the font line height, not CSS line-height', async () => {
  const { readRules } = await import('../src/styles.ts');
  const { Pb } = await import('../src/proto.ts');
  const varint = (n: number): number[] => n < 128 ? [n] : [(n & 0x7f) | 0x80, ...varint(n >> 7)];
  const num = (field: number, v: number) => [...varint(field << 3), ...varint(v)];
  const dbl = (field: number, v: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...varint((field << 3) | 1), ...b]; };
  const msg = (field: number, body: number[]) => [...varint((field << 3) | 2), ...varint(body.length), ...body];
  const spacing = (v: number, unit: number) => msg(1, [...num(1, 72), ...msg(6, [...dbl(1, v), ...num(2, unit)])]);
  const css = (p: number[]) => readRules(Pb.parse(Uint8Array.from(msg(1, [...num(1, 1), ...num(2, 1), ...msg(3, p)]))))[0].css;
  assert.deepEqual(css(spacing(1, 9)), { 'line-height': '1.2' });
  assert.deepEqual(css(spacing(0.8, 9)), { 'line-height': '0.96' });
  assert.deepEqual(css(spacing(14, 6)), { 'line-height': '14px' });
});

test('value lists using field values', async () => {
  const { valueListField } = await import('../src/schema.ts');
  const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
  // A value list of one field showing a second: Account::id, also showing Account::name.
  assert.deepEqual(valueListField(hex('0100060403d0001802010100010403d000180201030001020100020100020100017a')), { occurrenceId: 152, fieldId: 1, secondFieldId: 3 });
  // A value list of one field.
  assert.deepEqual(valueListField(hex('0100000403d0001102010500010201000201000001020100020100020100017a')), { occurrenceId: 145, fieldId: 5 });
  // A value list of only the values related from occurrence 131 (selector).
  assert.deepEqual(valueListField(hex('0100070403d000d602010600010403d000d602011400010403d0000302010002010001017a')), { occurrenceId: 342, fieldId: 6, secondFieldId: 20, relatedFromId: 131 });
  // A value list from another file is not a field list.
  assert.equal(valueListField(hex('02000602010002010000010201000201000001020100020106020111017a')), undefined);
  // A value list from another file (data source 6), list 17.
  const { valueListExternal } = await import('../src/schema.ts');
  assert.deepEqual(valueListExternal(hex('02000602010002010000010201000201000001020100020106020111017a')), { dataSourceId: 6, valueListId: 17 });
  assert.equal(valueListExternal(hex('0100060403d0001802010100010403d000180201030001020100020100020100017a')), undefined);
});

test('readActiveSegment: a segment, None, or a calculation', async () => {
  const { Pb } = await import('../src/proto.ts');
  const varint = (n: number): number[] => n < 128 ? [n] : [(n & 0x7f) | 0x80, ...varint(n >> 7)];
  const active = (...fields: [number, number][]) => Pb.parse(Uint8Array.from(fields.flatMap(([f, v]) => [f << 3, ...varint(v)])));
  // A private sample's button bar: the Templates segment (150) of 148-152.
  assert.equal(readActiveSegment(active([1, 0], [2, 150]), [148, 149, 150, 151, 152]), 150);
  assert.equal(readActiveSegment(active([1, 0], [2, 99]), [148, 149]), undefined);
  assert.equal(readActiveSegment(active([1, 0]), [148]), undefined);
  assert.equal(readActiveSegment(active([1, 1]), [148]), undefined);
  assert.equal(readActiveSegment(active([1, 2]), [148]), 'formula');
  assert.equal(readActiveSegment(undefined, [148]), undefined);
});

test('readFileOptions: open and close scripts, and the layout to open on', async () => {
  const { readFileOptions } = await import('../src/schema.ts');
  const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
  const scripts = [{ id: 2053, name: 'Trigger: OnFirstWindowOpen' }, { id: 2054, name: 'Trigger: OnCloseLastWindow' }];
  // One private sample's key 24, then another's (no trigger scripts).
  assert.deepEqual(readFileOptions(hex('00000483 0201 03028785 03028786 030282c8 0001'), scripts, [{ id: 840, name: 'Splash' }]), {
    onFirstWindowOpen: { scriptId: 2053, script: 'Trigger: OnFirstWindowOpen' },
    onLastWindowClose: { scriptId: 2054, script: 'Trigger: OnCloseLastWindow' },
    openLayoutId: 840, openLayout: 'Splash',
  });
  assert.deepEqual(readFileOptions(hex('00008403 0101 00 00 020102 0001'), [], []), { openLayoutId: 2 });
});

test('field options: prohibit modification and strict data type', async () => {
  const { readOptions } = await import('../src/schema.ts');
  const { Node } = await import('../src/tree.ts');
  const def = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
  // A private sample's CreationTimestamp, as FileMaker adds it to a new table.
  const stamp = def('0105000200000015000001010000200c00000001000000000001');
  assert.deepEqual(readOptions(new Node(), stamp), {
    global: false, unstored: false, repetitions: 1, indexLanguage: 'English',
    autoEnter: { value: 'creationTimestamp', prohibitModification: true },
    validation: { strict: true, notEmpty: true, type: 'date4' },
  });
  // Byte 8: bit 7 the value index, bit 5 the word index, 0x40 automatic indexing off; byte 7 the language.
  const indexed = (b7: number, b8: number) => {
    const d = Uint8Array.from(stamp);
    d[7] = b7;
    d[8] = b8;
    const o = readOptions(new Node(), d)!;
    return [o.index, o.noAutoIndex, o.indexLanguage, o.indexLanguageId];
  };
  assert.deepEqual(indexed(0x15, 0xa0), [{ value: true, word: true }, undefined, 'English', undefined]);
  assert.deepEqual(indexed(0x15, 0x40 | 0x80), [{ value: true }, true, 'English', undefined]);
  assert.deepEqual(indexed(0x30, 0), [undefined, undefined, undefined, 0x30]);
  // A private sample's numeric-only lookup.
  const flag = readOptions(new Node(), def('0102000000000000000000080000144400000001000000000001'));
  assert.equal(flag?.validation?.type, 'number');
  assert.equal(flag?.autoEnter?.prohibitModification, undefined);
});

test('field options: looked-up value and existing value', async () => {
  const { readOptions, readLookup } = await import('../src/schema.ts');
  const { Node } = await import('../src/tree.ts');
  const hex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
  // A private sample's InvoiceItem::unitPrice: copies Invoice_InvoiceItem_Item::unitPrice, starting from another occurrence.
  const settings = hex('03010403d000090002011600d00000010403d000087f');
  assert.deepEqual(readLookup(settings), { occurrenceId: 137, fieldId: 22, fromId: 136 });
  // A private sample's shape: no 03 01 lead, and a field id past 127 as a two-byte ref (03 02 80 1c).
  assert.deepEqual(readLookup(hex('00000403d0004a7f0302801c000000010403d0004f00')), { occurrenceId: 202, fieldId: 156, fromId: 207 });
  assert.equal(readLookup(hex('000002010000010002010000d00000010403d000f760')), undefined);
  assert.equal(readLookup(hex('0301')), undefined);
  const node = new Node();
  node.kv.set(8, settings);
  // There the field has since become an auto-enter calculation, so the settings are stale.
  const calc = readOptions(node, hex('0102000000000000000000880000140000000001000000000001'));
  assert.equal(calc?.autoEnter?.lookup, undefined);
  assert.equal(calc?.autoEnter?.calculation, true);
  const lookup = readOptions(node, hex('0102000000000000000000100000000000000001000000000001'));
  assert.deepEqual(lookup?.autoEnter, { lookup: { occurrenceId: 137, fieldId: 22, fromId: 136 } });
  const existing = readOptions(new Node(), hex('0102000000000000000000000000002000000001000000000001'));
  assert.deepEqual(existing?.validation, { existing: true });
});

test('window and account step options from the step record', async () => {
  const { decodeStepParams, stepLine } = await import('../src/script-params.ts');
  const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: () => undefined, fieldName: () => undefined, dataSourceName: () => undefined };
  // 28-byte records: step id at 20-21, choice at 22-23, flags at 24-27 (as in private samples).
  const rec = (id: number, choice: number, flags = '00000002') => new Uint8Array(Buffer.from('0'.repeat(40) + id.toString(16).padStart(4, '0') + choice.toString(16).padStart(4, '0') + flags, 'hex'));
  const line = (name: string, id: number, choice: number, flags?: string) => stepLine(name, decodeStepParams(id, rec(id, choice, flags), undefined, ctx));
  assert.equal(line('Enable Account', 137, 1), 'Enable Account [ Activate ]');
  assert.equal(line('Enable Account', 137, 0), 'Enable Account [ Deactivate ]');
  assert.equal(line('Adjust Window', 31, 5), 'Adjust Window [ Hide ]');
  assert.equal(line('Adjust Window', 31, 1), 'Adjust Window [ Resize to Fit ]');
  // Scroll Window's choices as its dialog lists them (inferred: no sample file has the step).
  assert.equal(line('Scroll Window', 81, 1), 'Scroll Window [ Home ]');
  assert.equal(line('Scroll Window', 81, 4), 'Scroll Window [ Page Down ]');
  assert.equal(line('Scroll Window', 81, 5), 'Scroll Window [ To Selection ]');
  assert.equal(line('Show/Hide Toolbars', 29, 2, '00080102'), 'Show/Hide Toolbars [ Lock ; Hide ]');
  assert.equal(line('Show/Hide Menubar', 166, 1), 'Show/Hide Menubar [ Show ]');
  assert.equal(line('Select Window', 123, 0, '80000002'), 'Select Window [ Current Window ]');
  // A private sample toggles a flag with xor (token 21, between or and True).
  const { decodeCalc } = await import('../src/calc.ts');
  const sp = '0c13017a00';
  assert.equal(decodeCalc(new Uint8Array(Buffer.from(`22${sp}21${sp}23`, 'hex'))).text, 'True xor False');
});

test('a stored find request the reader cannot read says so by shape, never by value', async () => {
  const { decodeStepParams, stepLine } = await import('../src/script-params.ts');
  const { Node } = await import('../src/tree.ts');
  const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: (id: number) => (id === 385 ? 'Issues' : undefined),
    fieldName: (_to: number, f: number) => (f === 5 ? 'pkIssueID' : undefined), dataSourceName: () => undefined };
  const rec = new Uint8Array(Buffer.from('0'.repeat(40) + '007e' + '0000' + '00008000', 'hex')); // Constrain Found Set, Restore
  const p = new Node();
  const request = (fill: (r: InstanceType<typeof Node>) => void) => {
    const r = new Node();
    fill(r);
    return r;
  };
  const requests = new Node();
  // One request read as usual: key 00, then [len][TO][len][field].
  requests.children.set(1, request((r) => r.kvLong.push({ key: new Uint8Array([0, 2, 0x81, 0x01, 1, 5]), data: new TextEncoder().encode('==1').map((b) => b ^ 0x5a) })));
  // One whose criteria sit somewhere this reader doesn't look (a made-up key 07 and a nested node).
  requests.children.set(2, request((r) => {
    r.kvLong.push({ key: new Uint8Array([7, 2, 0x81, 0x01, 1, 5]), data: new TextEncoder().encode('secret value') });
    r.children.set(3, new Node());
  }));
  const six = new Node();
  six.children.set(6, requests);
  p.children.set(6, six);
  const line = stepLine('Constrain Found Set', decodeStepParams(126, rec, p, ctx));
  assert.equal(line, 'Constrain Found Set [ Restore; Find: Issues::pkIssueID: “==1”; Find:  /* not read: key 070281010105 (12 bytes), node 3 (0 values, 0 nodes) */ ]');
  assert.ok(!line.includes('secret value'));
});

test('Layout Setup views allowed from kv 241 byte 6 (0x08 form, 0x02 list, 0x40 table)', async () => {
  const { readViewsAllowed, readLayoutView } = await import('../src/layouts.ts');
  const kv = (b6: number) => { const a = new Uint8Array(8); a[6] = b6; return a; };
  // Sample bytes seen in the fixtures: 08 form-only, 0a form+list, 4a all three, 02 list-only.
  assert.deepEqual(readViewsAllowed(kv(0x08)), ['form']); // form only is a real restriction
  assert.deepEqual(readViewsAllowed(kv(0x0a)), ['form', 'list']);
  assert.equal(readViewsAllowed(kv(0x4a)), undefined); // all three -> the default, left off
  assert.deepEqual(readViewsAllowed(kv(0x02)), ['list']);
  assert.deepEqual(readViewsAllowed(kv(0x40 | 0x08)), ['form', 'table']);
  assert.equal(readViewsAllowed(undefined), undefined);
  // The default-view decode is unchanged.
  assert.equal(readLayoutView(kv(0x02)), 'list');
  assert.equal(readLayoutView(kv(0x4a)), 'table');
});

test('stored find criteria kept as a node under the field key are read', async () => {
  const { decodeStepParams, stepLine } = await import('../src/script-params.ts');
  const { Node, segmentOf } = await import('../src/tree.ts');
  const ctx = { formula: () => undefined, layoutName: () => undefined, scriptName: () => undefined, tableOccurrenceName: (id: number) => (id === 385 ? 'Invoices' : undefined),
    fieldName: (_to: number, f: number) => (f === 7 ? 'InvoiceDate' : undefined), dataSourceName: () => undefined };
  const rec = new Uint8Array(Buffer.from('0'.repeat(40) + '007e' + '0000' + '00008000', 'hex')); // Constrain Found Set, Restore
  const enc = (t: string) => new TextEncoder().encode(t).map((b) => b ^ 0x5a);
  const criteria = new Node();
  criteria.kv.set(0, new Uint8Array(8));
  criteria.kv.set(1, enc('>=$from'));
  const r = new Node();
  r.children.set(segmentOf(new Uint8Array([0, 2, 0x81, 0x01, 1, 7])), criteria);
  const requests = new Node();
  requests.children.set(1, r);
  const six = new Node();
  six.children.set(6, requests);
  const p = new Node();
  p.children.set(6, six);
  assert.equal(stepLine('Constrain Found Set', decodeStepParams(126, rec, p, ctx)), 'Constrain Found Set [ Restore; Find: Invoices::InvoiceDate: “>=$from” ]');
});
