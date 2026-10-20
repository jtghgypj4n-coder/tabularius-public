import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designSnippet, snippetChanges, Store } from '../src/index.ts';

test('Go to Object keeps repetition formulas in clipboard XML in both directions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-object-repetition-'));
  try {
    const path = join(dir, 'test.sqlite');
    createStore(path);
    const store = new Store(path, 'Test');
    try {
      store.applyDesign([{ op: 'createScript', name: 'Object', steps: [
        { name: 'Go to Object', params: { objectName: '"repeatBox"', repetitionCalculation: '2' } },
        { name: 'Go to Object', params: { objectName: '"repeatBox"', repetitionCalculation: '$rep + 1' } },
        { name: 'Go to Object', params: { objectName: '"repeatBox"' } },
        { name: 'Refresh Object', params: { objectName: '"repeatBox"' } },
      ] }]);
      const script = store.schema.scripts.find((s) => s.name === 'Object')!;
      const xml = designSnippet(store.schema, { scripts: [script.id] }).xml;
      assert.match(xml, /<Step[^>]*name="Go to Object"><ObjectName><Calculation><!\[CDATA\["repeatBox"\]\]><\/Calculation><\/ObjectName><Repetition><Calculation><!\[CDATA\[2\]\]><\/Calculation><\/Repetition><\/Step>/);
      assert.match(xml, /<Repetition><Calculation><!\[CDATA\[\$rep \+ 1\]\]><\/Calculation><\/Repetition>/);
      assert.match(xml, /<Step[^>]*name="Go to Object"><ObjectName><Calculation><!\[CDATA\["repeatBox"\]\]><\/Calculation><\/ObjectName><\/Step>/);
      assert.match(xml, /<Step[^>]*name="Refresh Object"><ObjectName><Calculation><!\[CDATA\["repeatBox"\]\]><\/Calculation><\/ObjectName><\/Step>/);

      for (const [xmlRep, expected] of [['2', '2'], ['$rep + 1', '$rep + 1'], ['Let ( $x = "A & B" ; 2 )', 'Let ( $x = "A & B" ; 2 )']] as const) {
        const input = `<fmxmlsnippet type="FMObjectList"><Step enable="True" id="145" name="Go to Object"><ObjectName><Calculation><![CDATA["repeatBox"]]></Calculation></ObjectName><Repetition><Calculation><![CDATA[${xmlRep}]]></Calculation></Repetition></Step></fmxmlsnippet>`;
        const got = (snippetChanges(input, store.schema).changes[0] as { steps: { params?: Record<string, string> }[] }).steps[0];
        assert.equal(got.params?.repetitionCalculation, expected);
      }
      const omitted = snippetChanges('<fmxmlsnippet type="FMObjectList"><Step enable="True" id="145" name="Go to Object"><ObjectName>"repeatBox"</ObjectName></Step></fmxmlsnippet>', store.schema).changes[0] as { steps: { params?: Record<string, string> }[] };
      assert.equal(omitted.steps[0].params?.repetitionCalculation, undefined);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
