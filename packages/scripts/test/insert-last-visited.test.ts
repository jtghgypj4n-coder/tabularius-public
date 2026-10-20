// Insert from Last Visited: the target field takes its value from the record
// the window was on before the current one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, type RunOptions } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-last-visited-'));
  createStore(join(dir, 'Visit.sqlite'));
  store = new Store(join(dir, 'Visit.sqlite'), 'Visit');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Text', type: 'text' }, { name: 'Amount', type: 'number' }] }]);
  store.create('Notes', { Text: 'first', Amount: '1' });
  store.create('Notes', { Text: 'second', Amount: '2' });
  store.create('Notes', { Text: 'third', Amount: '3' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const run = (source: string, opts: RunOptions = {}) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(source.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })),
} as Script, { layout: 'Notes', foundSet: store.findIds('Notes'), ...opts });

const text = (i: number) => store.get('Notes', store.findIds('Notes')[i]).fieldData.Text;

test('copies the field from the record visited before', async () => {
  const trial = store.trial();
  try {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Go to Record/Request/Page [ Next ]
      Insert from Last Visited [ Select ; Notes::Text ]
      Commit Records/Requests [ With dialog: Off ]
      Exit Script [ Result: Notes::Text ]
    `);
    assert.equal(r.error, 0);
    assert.equal(r.result, 'first');
    assert.equal(text(1), 'first');
    assert.equal(text(0), 'first');
  } finally {
    trial.undo();
  }
});

test('follows each move, so a loop copies down the found set', async () => {
  const trial = store.trial();
  try {
    const r = await run(`
      Go to Record/Request/Page [ First ]
      Loop
        Go to Record/Request/Page [ Next ; Exit after last: On ]
        Insert from Last Visited [ Select ; Notes::Amount ]
      End Loop
      Exit Script [ Result: Notes::Amount ]
    `);
    assert.equal(r.error, 0);
    assert.equal(r.result, '1');
    assert.deepEqual(store.findIds('Notes').map((id) => store.get('Notes', id).fieldData.Amount), [1, 1, 1]);
  } finally {
    trial.undo();
  }
});

test('error 101 when no other record was visited in this run', async () => {
  const r = await run(`
    Insert from Last Visited [ Select ; Notes::Text ]
    Exit Script [ Result: Get ( LastError ) ]
  `);
  assert.equal(r.result, '101');
  assert.equal(text(0), 'first');
});

test('the active field is the target when none is given', async () => {
  const trial = store.trial();
  try {
    const r = await run(`
      Go to Record/Request/Page [ Last ]
      Go to Record/Request/Page [ First ]
      Go to Field [ Notes::Text ]
      Insert from Last Visited [ Select ]
      Exit Script [ Result: Get ( LastError ) & "/" & Notes::Text ]
    `);
    assert.equal(r.result, '0/third');
  } finally {
    trial.undo();
  }
});

test('the record the person showed before the script started counts as visited', async () => {
  const trial = store.trial();
  try {
    const ids = store.findIds('Notes');
    const r = await run(`
      Insert from Last Visited [ Select ; Notes::Text ]
      Exit Script [ Result: Get ( LastError ) & "/" & Notes::Text ]
    `, { recordId: ids[1], lastVisited: { layout: 'Notes', recordId: ids[2] } });
    assert.equal(r.result, '0/third');
  } finally {
    trial.undo();
  }
});

test("a record last visited on a layout that's gone, or in another table, isn't this table's", async () => {
  const ids = store.findIds('Notes');
  store.applyDesign([{ op: 'createTable', name: 'Other', fields: [{ name: 'Text', type: 'text' }] }]);
  const other = store.create('Other', { Text: 'elsewhere' }).recordId;
  for (const layout of ['No Such Layout', 'Other']) {
    const r = await run(`
      Insert from Last Visited [ Select ; Notes::Text ]
      Exit Script [ Result: Get ( LastError ) & "/" & Notes::Text ]
    `, { recordId: ids[1], lastVisited: { layout, recordId: Number(other) } });
    assert.equal(r.result, '101/second', layout);
  }
});

test('a record id the client sent is read through the account\'s privileges, containers included', async () => {
  const trial = store.trial();
  try {
    store.applyDesign([{ op: 'createField', table: 'Notes', name: 'Pic', type: 'container' }, { op: 'createField', table: 'Notes', name: 'Pub', type: 'text' }]);
    const [a, , secret] = store.findIds('Notes');
    store.update('Notes', a, { Pub: 'yes' });
    store.setContainer('Notes', secret, 'Pic', 1, { filename: 'secret.txt', mime: 'text/plain', data: new TextEncoder().encode('SECRET-BYTES') });
    store.savePrivilegeSet({ name: 'Lim', records: { view: false, edit: false, create: false, delete: false },
      tables: { Notes: { view: 'Pub = "yes"', edit: true, create: true, delete: false } },
      layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [] } as never);
    store.setPassword('lim', 'pw', 'Lim');
    for (const field of ['Notes::Pic', 'Notes::Text']) {
      const r = await run(`
        Set Error Capture [ On ]
        Insert from Last Visited [ Select ; ${field} ]
        Set Variable [ $e ; Value: Get ( LastError ) & "|" & GetAsText ( ${field} ) & "|" & Base64Encode ( ${field} ) ]
        Revert Record/Request [ With dialog: Off ]
        Exit Script [ Result: $e ]
      `, { foundSet: [a], recordId: a, lastVisited: { layout: 'Notes', recordId: secret }, account: 'lim', privileges: store.privileges('lim') });
      assert.match(String(r.result), /^101\|/, field);
      assert.doesNotMatch(String(r.result), /secret|U0VDUkVU|TOPSECRET|third/i, field);
    }
    assert.equal(store.containerId('Notes', a, 'Pic'), undefined);
  } finally {
    trial.undo();
  }
});
