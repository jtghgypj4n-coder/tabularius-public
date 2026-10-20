import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, designSnippet, snippetChanges, Store } from '../src/index.ts';

test('New Window style survives clipboard XML along with geometry and layout options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-window-style-'));
  const path = join(dir, 'Style.sqlite');
  createStore(path);
  const store = new Store(path, 'Style');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Main', fields: [] }, { op: 'createScript', name: 'source', steps: [{ stepId: 122, enabled: true, params: { slots: { 128: '"Panel"', 129: '400', 130: '600', 131: '20', 132: '30' }, windowStyle: 'card', layout: { id: store.schema.layouts[0]?.id ?? 0, name: 'Main' } } }] as never }]);
    // Build a real script from clipboard XML, then exercise the public writer and reader.
    for (const [xmlStyle, modelStyle] of [['Document', 'document'], ['Floating', 'floating'], ['Dialog', 'dialog'], ['Card', 'card']] as const) {
      const xml = `<fmxmlsnippet type="FMObjectList"><Step id="122" name="New Window"><Name><Calculation><![CDATA["Panel"]]></Calculation></Name><Height><Calculation>400</Calculation></Height><Width><Calculation>600</Calculation></Width><DistanceFromTop><Calculation>20</Calculation></DistanceFromTop><DistanceFromLeft><Calculation>30</Calculation></DistanceFromLeft><NewWndStyles Style="${xmlStyle}"/><LayoutDestination value="SelectedLayout"/><Layout id="1" name="Main"/></Step></fmxmlsnippet>`;
      const parsed = snippetChanges(xml, store.schema);
      const step = (parsed.changes[0] as { steps: { params?: Record<string, unknown> }[] }).steps[0];
      assert.equal(step.params?.windowStyle, modelStyle);
    }

    const source = store.schema.scripts.find((s) => s.name === 'source');
    assert.ok(source);
    const exported = designSnippet(store.schema, { steps: { script: source.id, indexes: [0] } }).xml;
    assert.match(exported, /<NewWndStyles Style="Card"\/>/);
    const roundTrip = snippetChanges(exported, store.schema);
    const step = (roundTrip.changes[0] as { steps: { params?: Record<string, unknown> }[] }).steps[0];
    assert.equal(step.params?.windowStyle, 'card');
    assert.deepEqual(step.params?.slots, { 128: '"Panel"', 129: '400', 130: '600', 131: '20', 132: '30' });
    assert.equal((step.params?.layout as { name?: string } | undefined)?.name, 'Main');

    const omitted = snippetChanges('<fmxmlsnippet type="FMObjectList"><Step id="122" name="New Window"/></fmxmlsnippet>', store.schema);
    assert.equal((omitted.changes[0] as { steps: { params?: Record<string, unknown> }[] }).steps[0].params?.windowStyle, undefined);
    const unknown = snippetChanges('<fmxmlsnippet type="FMObjectList"><Step id="122" name="New Window"><NewWndStyles Style="Workspace"/></Step></fmxmlsnippet>', store.schema);
    assert.ok(unknown.notes.some((n) => n.includes('window style "Workspace" isn\'t kept')));
    for (const inherited of ['constructor', '__proto__']) {
      const parsed = snippetChanges(`<fmxmlsnippet type="FMObjectList"><Step id="122" name="New Window"><NewWndStyles Style="${inherited}"/></Step></fmxmlsnippet>`, store.schema);
      const step = (parsed.changes[0] as { steps: { params?: Record<string, unknown> }[] }).steps[0];
      assert.equal(step.params?.windowStyle, undefined);
      assert.ok(parsed.notes.some((n) => n.includes(`window style "${inherited}" isn't kept`)));
    }
    const dropped = snippetChanges('<fmxmlsnippet type="FMObjectList"><Step id="122" name="New Window"><NewWndStyles Style="Card" Close="No" Minimize="No" Maximize="No" Resize="No" MenuBar="No" DimParentWindow="Yes" Styles="3" Toolbars="Yes"/></Step></fmxmlsnippet>', store.schema);
    assert.ok(dropped.notes.some((n) => n.includes('Close, Minimize, Maximize, Resize, MenuBar, DimParentWindow, Styles, Toolbars')));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
