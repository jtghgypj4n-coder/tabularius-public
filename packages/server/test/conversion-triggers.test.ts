import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, emptySchema, Store } from '../../store/src/index.ts';
import type { LayoutDesigns, Schema } from '../../fmp12/src/index.ts';
import { conversionReport } from '../src/conversion.ts';
import { conversionGuide } from '../src/conversion-guide.ts';

test('unnamed layout and object triggers are counted by event and layout', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-conversion-triggers-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'Synthetic.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Synthetic');
  t.after(() => store.close());

  const schema: Schema = {
    ...emptySchema(),
    layouts: [
      { id: 1, name: 'Orders', labels: [] },
      { id: 2, name: 'Details', labels: [] },
      { id: 3, name: 'Known', labels: [] },
    ],
    scripts: [{ id: 1, name: 'Do work', steps: [] }],
  };
  Object.defineProperty(store, 'schema', { value: schema, configurable: true });
  const designs: LayoutDesigns = { themes: [], layouts: [
    { id: 1, name: 'Orders', style: {}, parts: [], objects: [
      { id: 10, kind: 'group', type: 0, bounds: { left: 0, top: 0, right: 1, bottom: 1 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
        children: [{ id: 11, kind: 'text', type: 0, bounds: { left: 0, top: 0, right: 1, bottom: 1 }, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, triggers: [{ event: 'Event108', scriptId: 1 }] }] },
    ], triggers: [{ event: 'Event108', scriptId: 1 }] },
    { id: 2, name: 'Details', style: {}, parts: [], objects: [], triggers: [{ event: 'Event108', scriptId: 1 }] },
    { id: 3, name: 'Known', style: {}, parts: [], objects: [], triggers: [{ event: 'OnLayoutEnter', scriptId: 1 }] },
  ] };
  store.designs = () => designs;

  const report = conversionReport(store);
  assert.deepEqual(report.triggers, { undecoded: [{ name: 'Event108', count: 3, where: ['Layout "Orders"', 'Layout "Details"'] }], layouts: 2 });
  assert.match(report.summary, /Script triggers the reader cannot name yet.*3 triggers on 2 layouts.*Event108 \(3\)/);

  const guide = conversionGuide(store, [], report);
  const warning = guide.breaks.find((item) => item.title === 'Script triggers the reader cannot name yet');
  assert.ok(warning);
  assert.equal(warning.severity, 'medium');
  assert.equal(warning.count, 3);
  assert.deepEqual(warning.where, ['Layout "Orders"', 'Layout "Details"']);
  assert.match(warning.what, /3 triggers on 2 layouts have an event this build cannot name and will not run; open the layout in FileMaker to see which they are, then set them again in design mode/);
  assert.ok(guide.todo.includes('If the original file used OnWindowOpen or OnWindowClose triggers, set them again in File options (design mode); they are not read from the file.'));
  assert.match(guide.text, /Script triggers the reader cannot name yet/);

  designs.layouts[0].triggers!.push({ event: 'Event109', scriptId: 1 });
  assert.deepEqual(conversionReport(store).triggers.undecoded.map((item) => [item.name, item.count]), [['Event108', 3], ['Event109', 1]]);
  designs.layouts[0].triggers!.pop();

  schema.fileOptions = { onWindowOpen: { scriptId: 1 } };
  assert.ok(!conversionGuide(store, [], report).todo.some((item) => item.includes('OnWindowOpen or OnWindowClose')));

  // Locations are bounded, while the total layout count still includes all affected layouts.
  for (let id = 4; id <= 7; id++) {
    const name = `Extra ${id}`;
    schema.layouts.push({ id, name, labels: [] });
    designs.layouts.push({ id, name, style: {}, parts: [], objects: [], triggers: [{ event: 'Event108', scriptId: 1 }] });
  }
  const many = conversionReport(store);
  assert.equal(many.triggers.undecoded[0].count, 7);
  assert.equal(many.triggers.undecoded[0].where.length, 5);
  assert.equal(many.triggers.layouts, 6);
  assert.match(many.summary, /7 triggers on 6 layouts/);
  assert.match(conversionGuide(store, [], many).breaks.find((item) => item.title === 'Script triggers the reader cannot name yet')?.what ?? '', /7 triggers on 6 layouts/);
});

test('an empty file gets no speculative window-trigger todo', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-conversion-empty-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'Empty.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Empty');
  t.after(() => store.close());
  const schema: Schema = emptySchema();
  Object.defineProperty(store, 'schema', { value: schema, configurable: true });
  assert.ok(!conversionGuide(store).todo.some((item) => item.includes('OnWindowOpen or OnWindowClose')));
});
