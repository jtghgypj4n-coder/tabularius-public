import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scriptStepName, stepLine, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Privileges, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-insert-index-'));
  createStore(join(dir, 'Index.sqlite'));
  store = new Store(join(dir, 'Index.sqlite'), 'Index');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Text', type: 'text' }, { name: 'City', type: 'text' }] }]);
  store.create('Notes', { Text: 'abcdef', City: 'Paris' });
  store.create('Notes', { Text: 'x', City: 'Oslo' });
  store.create('Notes', { Text: 'y', City: 'Paris' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

type Ask = { script: string; field: string; values: string[] };
const run = (source: string, indexDialog?: (r: Ask) => Promise<string | undefined>, privileges?: Privileges) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(source.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })),
} as Script, { layout: 'Notes', foundSet: store.findIds('Notes'), ...(indexDialog ? { indexDialog } : {}), ...(privileges ? { privileges } : {}) });

const first = () => store.get('Notes', store.findIds('Notes')[0]).fieldData;

test('Insert from Index with no one to ask is error 3, as on FileMaker Server', async () => {
  const r = await run('Set Error Capture [ On ]\nInsert from Index [ Notes::City ]\nExit Script [ Result: Get ( LastError ) ]');
  assert.equal(r.result, '3');
  assert.equal(first().City, 'Paris');
});

test('Insert from Index offers the field index and sets an explicit target to the value picked', async () => {
  const trial = store.trial();
  try {
    const asked: Ask[] = [];
    const r = await run('Go to Field [ Notes::Text ]\nInsert from Index [ Notes::City ]\nExit Script [ Result: Notes::City & "|" & Get ( ActiveFieldName ) ]', async (q) => {
      asked.push(q);
      return 'Oslo';
    });
    assert.equal(r.error, 0);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].field, 'Notes::City');
    assert.deepEqual(asked[0].values, ['Oslo', 'Paris']);
    assert.equal(r.result, 'Oslo|Text');
    assert.equal(first().City, 'Oslo');
  } finally {
    trial.undo();
  }
});

test('Insert from Index without a target inserts at the active field\'s insertion point, or over it all with Select', async () => {
  for (const [source, expected] of [
    ['Go to Field [ Notes::Text ]\nSet Selection [ Start Position: 3 ; End Position: 4 ]\nInsert from Index', 'abxef'],
    ['Go to Field [ Notes::Text ]\nInsert from Index [ Select ]', 'x'],
  ] as const) {
    const trial = store.trial();
    try {
      const r = await run(`${source}\nExit Script [ Result: Get ( ActiveFieldContents ) ]`, async (q) => {
        assert.deepEqual(q.values, ['abcdef', 'x', 'y']);
        return 'x';
      });
      assert.equal(r.error, 0);
      assert.equal(r.result, expected);
    } finally {
      trial.undo();
    }
  }
  const [s] = parseScriptText('Insert from Index [ Select ; Notes::City ]', store.schema);
  assert.equal(stepLine('Insert from Index', s.params), 'Insert from Index [ Select ; Notes::City ]');
});

test('Insert from Index: Cancel, or a value the index does not hold, is error 1 and changes nothing', async () => {
  for (const answer of [undefined, 'Berlin']) {
    const r = await run('Set Error Capture [ On ]\nInsert from Index [ Notes::City ]\nExit Script [ Result: Get ( LastError ) & "|" & Notes::City ]', async () => answer);
    assert.equal(r.result, '1|Paris');
  }
});

test('Insert from Index without a field to put the value in is 102, and asks no one', async () => {
  let asked = false;
  const r = await run('Set Error Capture [ On ]\nInsert from Index\nExit Script [ Result: Get ( LastError ) ]', async () => {
    asked = true;
    return 'Oslo';
  });
  assert.equal(r.result, '102');
  assert.equal(asked, false);
});

test('Insert from Index offers dates as the file writes them, and the day picked is the day stored', async () => {
  const path = join(dir, 'Days.sqlite');
  createStore(path);
  const db = new DatabaseSync(path);
  db.prepare("UPDATE _fm_meta SET json = ? WHERE key = 'dateOrder'").run(JSON.stringify('DMY'));
  db.close();
  const days = new Store(path, 'Days');
  try {
    days.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Day', type: 'date' }] }]);
    days.create('Events', { Day: '2024-03-04' });
    days.create('Events', { Day: '2024-12-31' });
    const id = days.create('Events', {}).recordId;
    let offered: string[] = [];
    const r = await runScript(days, {
      id: 9999, name: 'test',
      steps: parseScriptText('Insert from Index [ Select ; Events::Day ]', days.schema)
        .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })),
    } as Script, { layout: 'Events', foundSet: [id], indexDialog: async (q) => {
      offered = q.values;
      return q.values[0];
    } });
    assert.equal(r.error, 0);
    assert.deepEqual(offered, ['4/3/2024', '31/12/2024']);
    assert.equal(days.get('Events', id, 'iso').fieldData.Day, '2024-03-04');
  } finally {
    days.close();
  }
});
