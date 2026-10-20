// The paste-by-hand write-back kit: an imported file with no edits needs
// nothing, and each kind of edit turns into either a paste step (whose XML
// Tabularius's own paste reader accepts against the original file) or a
// by-hand instruction. Gated on the Charts fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importFmp12, snippetChanges, Store, writeBackKit } from '../src/index.ts';
import { FmpDatabase } from '../../fmp12/src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('write-back kit: no edits, nothing to do; edits become paste steps and by-hand changes', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-writeback-'));
  try {
    const path = join(dir, 'Charts.sqlite');
    importFmp12(fixture, path);
    const original = FmpDatabase.open(fixture).schema;
    const store = new Store(path, 'Charts');
    assert.deepEqual(writeBackKit(original, store.schema), { paste: [], byHand: [] });

    const script = store.schema.scripts.find((s) => s.steps.length > 0)!;
    store.applyDesign([
      { op: 'createCustomFunction', name: 'Twice', parameters: ['n'], formula: 'n * 2' },
      { op: 'createTable', name: 'Notes', fields: [{ name: 'Text', type: 'text' }] },
      { op: 'createField', table: 'Congress', name: 'Label', kind: 'calculation', calculation: 'Name & "!"' },
      { op: 'updateField', table: 'Congress', field: 'Party', name: 'Party Code' },
      { op: 'createValueList', name: 'Colours', values: ['Red', 'Blue'] },
      { op: 'createScript', name: 'Hello', text: 'Beep' },
      { op: 'updateScript', script: script.name, text: 'Beep' },
    ]);
    const kit = writeBackKit(original, store.schema);

    assert.deepEqual(kit.paste.map((p) => p.names), [['Twice'], ['Notes'], ['Label'], ['Colours'], ['Hello'], [script.name]]);
    assert.match(kit.paste[2].where, /Fields tab, choose table "Congress"/);
    assert.ok(kit.paste[5].where.includes(`open script "${script.name}", select all its steps`), kit.paste[5].where);
    // Each paste is clipboard XML that a paste into the original file reads.
    for (const p of kit.paste) {
      assert.match(p.xml, /^<\?xml[^>]*>\n<fmxmlsnippet type="FMObjectList">/);
      assert.ok(snippetChanges(p.xml, original, p.into).summary.length, p.where);
    }

    assert.ok(kit.byHand.includes('Rename field "Congress::Party" to "Party Code".'), kit.byHand.join('\n'));
    // A table made here comes with an occurrence and a layout, both made by hand.
    assert.ok(kit.byHand.some((s) => /^Add table occurrence "Notes" of table "Notes"/.test(s)), kit.byHand.join('\n'));
    assert.ok(kit.byHand.some((s) => /^Make layout "Notes" in FileMaker/.test(s)), kit.byHand.join('\n'));
    // A calculation that names the renamed field follows it, as in FileMaker: no edit listed for it.
    assert.equal(kit.byHand.filter((s) => s.startsWith('Edit field')).length, 0, kit.byHand.join('\n'));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
