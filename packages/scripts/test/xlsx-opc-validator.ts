// Independent, strict checker for the OPC/SpreadsheetML subset emitted by Save Records as Excel.
// This is test code: it rejects dangling parts, malformed XML, bad relationships and out-of-grid cells.
import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';

type Element = { name: string; attrs: Map<string, string>; children: Element[]; text: string };
const attr = (e: Element, name: string) => { const value = e.attrs.get(name); assert.ok(value !== undefined, `${e.name} lacks ${name}`); return value; };
const children = (e: Element, name: string) => e.children.filter((c) => c.name === name);
const one = (e: Element, name: string) => { const found = children(e, name); assert.equal(found.length, 1, `${e.name}/${name}`); return found[0]; };
const integer = (s: string) => { assert.match(s, /^(0|[1-9]\d*)$/); return Number(s); };

function parseXml(source: string): Element {
  assert.doesNotMatch(source, /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i);
  assert.doesNotMatch(source, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    const value = named[entity.toLowerCase()];
    if (value !== undefined) return value;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    assert.ok(n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff), 'invalid character reference');
    return String.fromCodePoint(n);
  });
  const checked = (s: string) => {
    assert.doesNotMatch(s.replace(/&(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, ''), /&/, 'unresolved XML entity');
    return decode(s);
  };
  const root: Element = { name: '#document', attrs: new Map(), children: [], text: '' };
  const stack = [root];
  let at = 0;
  for (const match of source.matchAll(/<[^>]*>|[^<]+/g)) {
    assert.equal(match.index, at, 'invalid XML token'); at += match[0].length;
    const token = match[0];
    if (token.startsWith('<?xml ')) { assert.equal(stack.length, 1); continue; }
    if (token.startsWith('</')) { assert.equal(stack.pop()?.name, token.slice(2, -1), 'mismatched XML closing tag'); continue; }
    if (token.startsWith('<')) {
      const self = token.endsWith('/>');
      const body = token.slice(1, self ? -2 : -1);
      const name = /^[A-Za-z_][\w.:-]*/.exec(body)?.[0];
      assert.ok(name, 'invalid XML name');
      const attrs = new Map<string, string>();
      let rest = body.slice(name.length);
      while (rest.trim()) {
        const m = /^\s+([A-Za-z_][\w.:-]*)="([^"]*)"/.exec(rest);
        assert.ok(m, `invalid attribute in ${name}`);
        assert.ok(!attrs.has(m[1]), `duplicate attribute ${m[1]}`);
        attrs.set(m[1], checked(m[2])); rest = rest.slice(m[0].length);
      }
      const node = { name, attrs, children: [], text: '' };
      stack.at(-1)!.children.push(node);
      if (!self) stack.push(node);
    } else {
      const value = checked(token);
      if (stack.length === 1) assert.equal(value.trim(), '', 'text outside root');
      else stack.at(-1)!.text += value;
    }
  }
  assert.equal(at, source.length);
  assert.equal(stack.length, 1, 'unclosed XML element');
  assert.equal(root.children.length, 1, 'XML requires one root');
  return root.children[0];
}

function zipParts(data: Uint8Array): Map<string, string> {
  const bytes = Buffer.from(data);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'ZIP end record');
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'ZIP comment');
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count, 'ZIP entry counts');
  const directory = bytes.readUInt32LE(end + 16);
  assert.equal(directory + bytes.readUInt32LE(end + 12), end, 'ZIP directory length');
  const parts = new Map<string, string>();
  let at = directory;
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'ZIP central header');
    const method = bytes.readUInt16LE(at + 10), crc = bytes.readUInt32LE(at + 16);
    const packed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const len = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    const name = bytes.subarray(at + 46, at + 46 + len).toString('utf8');
    assert.match(name, /^(?:\[Content_Types\]\.xml|(?:_rels|xl)(?:\/[A-Za-z0-9_.]+)+)$/);
    assert.ok(!parts.has(name), `duplicate ZIP part ${name}`);
    const local = bytes.readUInt32LE(at + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'ZIP local header');
    assert.equal(bytes.readUInt16LE(local + 8), method, 'ZIP method mismatch');
    assert.equal(bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)).toString('utf8'), name, 'ZIP name mismatch');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.ok(start + packed <= directory, 'ZIP payload bounds');
    assert.ok(method === 0 || method === 8, 'ZIP compression method');
    const payload = bytes.subarray(start, start + packed);
    const inflated = method === 8 ? inflateRawSync(payload) : payload;
    assert.equal(inflated.length, size, `ZIP size ${name}`);
    assert.equal(crc32(inflated), crc, `ZIP CRC ${name}`);
    parts.set(name, inflated.toString('utf8'));
    at += 46 + len + extra + comment;
  }
  assert.equal(at, end, 'ZIP central directory end');
  return parts;
}

const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';

/** Validate every part and all cross-part references. Returns the first worksheet's cells. */
export function validateSavedExcel(data: Uint8Array): Map<string, string> {
  const parts = zipParts(data);
  const roots = new Map([...parts].map(([name, body]) => [name, parseXml(body)]));
  const root = (name: string, element: string, ns: string) => {
    const r = roots.get(name); assert.ok(r, `missing part ${name}`);
    assert.equal(r.name, element, name); assert.equal(attr(r, 'xmlns'), ns, name);
    return r;
  };
  const types = root('[Content_Types].xml', 'Types', CT);
  const defaults = new Map(children(types, 'Default').map((x) => [attr(x, 'Extension'), attr(x, 'ContentType')]));
  assert.equal(defaults.get('rels'), 'application/vnd.openxmlformats-package.relationships+xml');
  assert.equal(defaults.get('xml'), 'application/xml');
  const overrides = new Map(children(types, 'Override').map((x) => [attr(x, 'PartName'), attr(x, 'ContentType')]));
  assert.equal(overrides.size, children(types, 'Override').length, 'duplicate content type override');
  for (const name of parts.keys()) if (name.endsWith('.xml') && name !== '[Content_Types].xml') assert.ok(overrides.has(`/${name}`) || defaults.has('xml'), `no content type for ${name}`);
  const rels = (name: string, base: string) => {
    const r = root(name, 'Relationships', PKG);
    const ids = new Set<string>();
    return children(r, 'Relationship').map((x) => {
      const id = attr(x, 'Id'), type = attr(x, 'Type'), target = attr(x, 'Target');
      assert.ok(!ids.has(id), `duplicate relationship ${id}`); ids.add(id);
      assert.ok(!x.attrs.has('TargetMode'), 'external relationship');
      const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(base, target));
      assert.ok(!path.startsWith('../') && parts.has(path), `dangling relationship ${target}`);
      return { id, type, path };
    });
  };
  const packageRels = rels('_rels/.rels', '');
  assert.deepEqual(packageRels.map((x) => x.type), [`${OFFICE}officeDocument`]);
  assert.equal(packageRels[0].path, 'xl/workbook.xml');
  const book = root('xl/workbook.xml', 'workbook', MAIN);
  assert.equal(overrides.get('/xl/workbook.xml'), `${MIME}sheet.main+xml`);
  const bookRels = rels('xl/_rels/workbook.xml.rels', 'xl');
  const stylesRel = bookRels.find((x) => x.type === `${OFFICE}styles`);
  assert.equal(stylesRel?.path, 'xl/styles.xml');
  const sheets = children(one(book, 'sheets'), 'sheet');
  assert.equal(sheets.length, 1);
  const sheetName = attr(sheets[0], 'name');
  assert.ok(sheetName.length >= 1 && sheetName.length <= 31 && !/[\[\]:*?/\\]/.test(sheetName) && !/^'|'$/.test(sheetName), 'Excel sheet name');
  assert.equal(integer(attr(sheets[0], 'sheetId')), 1);
  const relation = bookRels.find((x) => x.id === attr(sheets[0], 'r:id'));
  assert.equal(relation?.type, `${OFFICE}worksheet`);
  const sheetPath = relation!.path;
  assert.equal(overrides.get(`/${sheetPath}`), `${MIME}worksheet+xml`);
  const styles = root('xl/styles.xml', 'styleSheet', MAIN);
  assert.equal(overrides.get('/xl/styles.xml'), `${MIME}styles+xml`);
  for (const key of ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles']) {
    const parent = one(styles, key);
    assert.equal(integer(attr(parent, 'count')), parent.children.length, `${key} count`);
  }
  const xfCount = children(one(styles, 'cellXfs'), 'xf').length;
  const sharedPath = bookRels.find((x) => x.type === `${OFFICE}sharedStrings`)?.path;
  if (sharedPath) assert.equal(overrides.get(`/${sharedPath}`), `${MIME}sharedStrings+xml`);
  const sharedRoot = sharedPath ? root(sharedPath, 'sst', MAIN) : undefined;
  const shared = sharedRoot ? children(sharedRoot, 'si').map((si) => {
    const direct = children(si, 't').map((t) => t.text);
    const rich = children(si, 'r').map((r) => one(r, 't').text);
    return [...direct, ...rich].join('');
  }) : [];
  if (sharedRoot) {
    assert.equal(integer(attr(sharedRoot, 'uniqueCount')), shared.length, 'shared string count');
    assert.ok(integer(attr(sharedRoot, 'count')) >= shared.length, 'shared string total');
    for (const s of shared) assert.ok(s.length <= 32_767, 'shared string length');
  }
  const worksheet = root(sheetPath, 'worksheet', MAIN);
  const cells = new Map<string, string>();
  let lastRow = 0;
  for (const row of children(one(worksheet, 'sheetData'), 'row')) {
    const r = integer(attr(row, 'r')); assert.ok(r > lastRow && r <= 1_048_576, 'row limit/order'); lastRow = r;
    let lastCol = 0;
    for (const c of children(row, 'c')) {
      const ref = attr(c, 'r'); const m = /^([A-Z]+)([1-9]\d*)$/.exec(ref); assert.ok(m, `cell reference ${ref}`);
      const col = [...m[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
      assert.ok(col > lastCol && col <= 16_384 && Number(m[2]) === r, 'column limit/order'); lastCol = col;
      if (c.attrs.has('s')) assert.ok(integer(attr(c, 's')) < xfCount, `style index ${ref}`);
      const type = c.attrs.get('t'); let value: string;
      if (type === 'inlineStr') value = one(one(c, 'is'), 't').text;
      else if (type === 's') value = shared[integer(one(c, 'v').text)] ?? assert.fail('shared string index');
      else { assert.ok(type === undefined || type === 'n' || type === 'b'); value = one(c, 'v').text; assert.ok(Number.isFinite(Number(value))); }
      assert.ok(value.length <= 32_767, `cell string length ${ref}`);
      cells.set(ref, value);
    }
  }
  return cells;
}
