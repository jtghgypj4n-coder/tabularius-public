// "Leave anytime" export (tier 1 of the way-back-to-FileMaker plan). The
// synthetic test is CI-runnable and pins the FMPXMLRESULT grammar, escaping and
// the no-secrets guard; the fixture test runs the whole bundle over a real
// solution. Grammar checked against Claris's FMPXMLRESULT spec (namespace
// http://www.filemaker.com/fmpxmlresult).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fmpXmlResult, fmExport, fmExportSanitize, importFmp12, Store, parseXml, type XmlElement, type ExportField, type ExportRow } from '../src/index.ts';

const all = (e: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] => {
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
};
const kids = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== 'string');
const root = (xml: string) => kids(parseXml(xml))[0];

test('FMPXMLRESULT: grammar, field types, escaping and empty cells (synthetic)', () => {
  const fields: ExportField[] = [
    { name: 'name', type: 'text' },
    { name: 'qty', type: 'number' },
    { name: 'due', type: 'date' },
    { name: 'photo', type: 'container' },
  ];
  const rows: ExportRow[] = [
    { recordId: 1, modId: 0, cells: [['Ann'], ['3'], ['2026-10-13'], ['containers/T/rec1-photo-p.jpg']] },
    // Hostile text: XML metacharacters and a CDATA terminator must not break or inject.
    { recordId: 2, modId: 5, cells: [['evil"><Injected/>& ]]> end'], ['0'], [''], ['']] },
  ];
  const xml = fmpXmlResult('demo.fmp12', fields, rows);
  const r = root(xml);

  // Envelope + namespace.
  assert.equal(r.name, 'FMPXMLRESULT');
  assert.equal(r.attrs.xmlns, 'http://www.filemaker.com/fmpxmlresult');
  assert.equal(all(r, 'ERRORCODE')[0].children.join(''), '0');

  // DATABASE record count matches the rows; METADATA field order and TYPE mapping.
  assert.equal(all(r, 'DATABASE')[0].attrs.RECORDS, '2');
  const meta = all(r, 'FIELD');
  assert.deepEqual(meta.map((f) => f.attrs.NAME), ['name', 'qty', 'due', 'photo']);
  assert.deepEqual(meta.map((f) => f.attrs.TYPE), ['TEXT', 'NUMBER', 'DATE', 'CONTAINER']);
  assert.equal(meta[0].attrs.EMPTYOK, 'YES');
  assert.equal(meta[0].attrs.MAXREPEAT, '1');

  // RESULTSET / ROW / COL / DATA shape and order.
  assert.equal(all(r, 'RESULTSET')[0].attrs.FOUND, '2');
  const rowEls = all(r, 'ROW');
  assert.deepEqual(rowEls.map((x) => x.attrs.RECORDID), ['1', '2']);
  assert.deepEqual(rowEls.map((x) => x.attrs.MODID), ['0', '5']);
  const cols0 = all(rowEls[0], 'COL');
  assert.equal(cols0.length, 4); // one COL per field, in field order
  assert.equal(all(cols0[0], 'DATA')[0].children.join(''), 'Ann');
  assert.equal(all(cols0[3], 'DATA')[0].children.join(''), 'containers/T/rec1-photo-p.jpg');
  // An empty cell still emits a COL with an empty DATA.
  const cols1 = all(rowEls[1], 'COL');
  assert.equal(all(cols1[2], 'DATA')[0].children.join(''), '');

  // The hostile value is escaped — no element injection — and stays well-formed.
  assert.doesNotMatch(xml, /<Injected/);
  assert.equal(all(cols1[0], 'DATA')[0].children.join(''), 'evil"><Injected/>& ]]> end');

  // Deterministic.
  assert.equal(fmpXmlResult('demo.fmp12', fields, rows), xml);
});

test('FMPXMLRESULT: a repeating field declares MAXREPEAT and emits one DATA per repetition', () => {
  const fields: ExportField[] = [{ name: 'notes', type: 'text', maxRepeat: 3 }];
  const rows: ExportRow[] = [{ recordId: 1, modId: 0, cells: [['one', 'two', 'three']] }];
  const r = root(fmpXmlResult('demo.fmp12', fields, rows));
  assert.equal(all(r, 'FIELD')[0].attrs.MAXREPEAT, '3');
  const datas = all(all(r, 'COL')[0], 'DATA').map((d) => d.children.join(''));
  assert.deepEqual(datas, ['one', 'two', 'three']);
});

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const flicks = join(fixtures, 'Flicks.fmp12');
const skip = existsSync(flicks) ? false : 'fixtures missing: run npm run fixtures';

test('fmExport: bundles data per table, the structure spec, manifest and README (Flicks)', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-fmexport-'));
  try {
    importFmp12(flicks, join(dir, 'Flicks.sqlite'));
    const store = new Store(join(dir, 'Flicks.sqlite'));
    const { files } = fmExport(store, { fileName: 'Flicks.fmp12' });
    const byPath = new Map(files.map((f) => [f.path, f]));

    // A data file per base table, each a well-formed FMPXMLRESULT whose RECORDS
    // matches the store's own count.
    for (const t of store.schema.tables) {
      const f = byPath.get(`data/${fmExportSanitize(t.name)}.xml`);
      assert.ok(f?.text, `data file for ${t.name}`);
      const r = root(f!.text!);
      assert.equal(r.name, 'FMPXMLRESULT');
      assert.equal(Number(all(r, 'DATABASE')[0].attrs.RECORDS), store.recordCount(t.name));
      assert.equal(all(r, 'ROW').length, store.recordCount(t.name));
    }

    // No stored-encoding artefacts leak into DATA across every data file:
    // a repeating field's JSON-array encoding must have been unwrapped (no
    // DATA that is a bare `[...]` list), and timestamps must carry a space
    // separator, never the stored ISO `T` (`2026-01-02T03:04:05`).
    let sawRepeating = false;
    let sawTimestamp = false;
    for (const t of store.schema.tables) {
      const r = root(byPath.get(`data/${fmExportSanitize(t.name)}.xml`)!.text!);
      const types = all(r, 'FIELD').map((fld) => fld.attrs.TYPE);
      if (all(r, 'FIELD').some((fld) => Number(fld.attrs.MAXREPEAT) > 1)) sawRepeating = true;
      for (const rowEl of all(r, 'ROW')) {
        const cols = all(rowEl, 'COL');
        cols.forEach((col, i) => {
          for (const d of all(col, 'DATA')) {
            const text = d.children.join('');
            assert.doesNotMatch(text, /^\[.*\]$/, `JSON-array encoding leaked into DATA in ${t.name}`);
            if (types[i] === 'TIMESTAMP' && text) {
              sawTimestamp = true;
              assert.doesNotMatch(text, /\dT\d/, `timestamp kept its ISO T separator in ${t.name}`);
              assert.match(text, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, `timestamp not in FMPXMLRESULT form in ${t.name}`);
            }
          }
        });
      }
    }
    // Flicks genuinely exercises both paths, so the guards above weren't vacuous.
    assert.ok(sawRepeating, 'expected at least one repeating field in Flicks');
    assert.ok(sawTimestamp, 'expected at least one timestamp value in Flicks');

    // The structural spec is present and labelled reference-only in the manifest.
    const manifest = JSON.parse(byPath.get('manifest.json')!.text!);
    assert.ok(byPath.get(manifest.structureFile)?.text?.includes('<FMSaveAsXML'));
    assert.match(manifest.structureNote, /cannot re-import|reference/i);
    assert.equal(manifest.file, 'Flicks.fmp12');
    assert.equal(manifest.tables.length, store.schema.tables.length);

    // README exists and is honest about the structure/container gaps.
    const readme = byPath.get('README-leaving.md')!.text!;
    assert.match(readme, /does NOT carry over/i);
    assert.match(readme, /container/i);

    // SECRETS GUARD: no credential *material* anywhere in the bundle's text —
    // not in the data files and not in the structure spec.
    //  (a) Concrete: the stored PBKDF2 password verifier of every account in
    //      the schema (a hex blob that carries none of the markers below) must
    //      not appear anywhere in the bundle — this is the real leak vector.
    //  (b) Markers: verifier/PBKDF text and a password <Context> token must
    //      never appear; and the structural spec's <Login>/<Authentication>
    //      blocks must carry no password content — the only password token
    //      allowed is the empty self-closing
    //      <INSECURE_PASSWORD><INSECURE_TEXT/></INSECURE_PASSWORD> that
    //      FileMaker's own format always emits.
    const verifiers = store.schema.accounts.map((a) => a.passwordVerifier).filter((v): v is string => !!v);
    for (const f of files) {
      if (f.text === undefined) continue;
      for (const v of verifiers) assert.ok(!f.text.toLowerCase().includes(v.toLowerCase()), `password verifier leaked into ${f.path}`);
      assert.doesNotMatch(f.text, /verifier|PBKDF|<Context>/i, `credential marker in ${f.path}`);
      assert.doesNotMatch(f.text, /<INSECURE_PASSWORD>(?!<INSECURE_TEXT\s*\/>)/i, `password content in ${f.path}`);
    }
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
