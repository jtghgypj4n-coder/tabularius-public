import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designSnippet, snippetChanges, Store } from '../src/index.ts';

function blank(t: TestContext): Store {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-window-target-'));
  const path = join(dir, 'Windows.sqlite');
  createStore(path);
  const store = new Store(path, 'Windows');
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

for (const [step, id] of [['Close Window', 121], ['Select Window', 123]] as const) {
  test(`${step} keeps named targets in clipboard XML`, (t) => {
    const store = blank(t);
    const target = blank(t);
    const xml = `<fmxmlsnippet type="FMObjectList"><Script id="1" name="${step}"><Step enable="True" id="${id}" name="${step}"><Window value="ByName"/><Name><Calculation><![CDATA[Get ( WindowName ) & " & <Target>]]></Calculation></Name></Step></Script></fmxmlsnippet>`;
    const imported = snippetChanges(xml, store.schema);
    assert.deepEqual(imported.notes, []);
    const change = imported.changes[0] as { steps: { params?: Record<string, unknown> }[] };
    assert.deepEqual(change.steps[0].params, { calculation: 'Get ( WindowName ) & " & <Target>' });
    store.applyDesign(imported.changes);
    const script = store.schema.scripts.find((s) => s.name === step)!;
    const exported = designSnippet(store.schema, { scripts: [script.id] });
    assert.deepEqual(exported.notes, []);
    assert.match(exported.xml, /<Window value="ByName"\/><Name><Calculation><!\[CDATA\[Get \( WindowName \) & " & <Target>\]\]><\/Calculation><\/Name>/);
    const pasted = snippetChanges(exported.xml, target.schema);
    assert.deepEqual(pasted.notes, []);
    assert.deepEqual((pasted.changes[0] as typeof change).steps[0].params, change.steps[0].params);
  });

  test(`${step} exports the window selector before its name calculation`, (t) => {
    const store = blank(t);
    const target = blank(t);
    const cases = [
      { params: { calculation: '"Target"' }, formula: '"Target"', xml: '"Target"' },
      { params: { slots: { 128: '"Other"' } }, formula: '"Other"', xml: '"Other"' },
      { params: { calculation: '"Target"', slots: { 128: '"Other"' } }, formula: '"Target"', xml: '"Target"' },
      { params: { calculation: '', slots: { 128: '"Other"' } }, formula: '', xml: '' },
      { params: { slots: { 128: '' } }, formula: '', xml: '' },
      { params: { calculation: '"A & <B> ]]> C"' }, formula: '"A & <B> ]]> C"', xml: '"A & <B> ]]]]><![CDATA[> C"' },
    ];
    for (const [i, { params, formula, xml }] of cases.entries()) {
      const name = `Target ${i}`;
      store.applyDesign([{ op: 'createScript', name, steps: [{ name: step, params }] }]);
      const script = store.schema.scripts.find((s) => s.name === name)!;
      const exported = designSnippet(store.schema, { scripts: [script.id] });
      assert.deepEqual(exported.notes, []);
      assert.ok(exported.xml.includes(`<Step enable="True" id="${id}" name="${step}"><Window value="ByName"/><Name><Calculation><![CDATA[${xml}]]></Calculation></Name></Step>`), name);
      const pasted = snippetChanges(exported.xml, target.schema);
      assert.deepEqual(pasted.notes, []);
      const change = pasted.changes[0] as { steps: { params?: Record<string, unknown> }[] };
      assert.deepEqual(change.steps[0].params, { calculation: formula }, name);
    }
  });

  test(`${step} treats Current and an absent selector as the current window`, (t) => {
    const store = blank(t);
    const target = blank(t);
    for (const selector of ['<Window value="Current"/>', '']) {
      for (const name of ['', '<Name><Calculation><![CDATA["Ignored"]]></Calculation></Name>']) {
        const current = snippetChanges(`<fmxmlsnippet type="FMObjectList"><Step enable="True" id="${id}" name="${step}">${selector}${name}</Step></fmxmlsnippet>`, store.schema);
        assert.deepEqual(current.notes, []);
        const change = current.changes[0] as { steps: { params?: Record<string, unknown> }[] };
        assert.equal(change.steps[0].params, undefined);
      }
    }
    store.applyDesign([{ op: 'createScript', name: `Current ${step}`, steps: [{ name: step }] }]);
    const script = store.schema.scripts.find((s) => s.name === `Current ${step}`)!;
    const exported = designSnippet(store.schema, { scripts: [script.id] });
    assert.deepEqual(exported.notes, []);
    assert.ok(exported.xml.includes(`<Step enable="True" id="${id}" name="${step}"><Window value="Current"/></Step>`));
    assert.doesNotMatch(exported.xml, /<Name>/);
    const pasted = snippetChanges(exported.xml, target.schema);
    assert.deepEqual(pasted.notes, []);
    const change = pasted.changes[0] as { steps: { params?: Record<string, unknown> }[] };
    assert.equal(change.steps[0].params, undefined);
  });
}
