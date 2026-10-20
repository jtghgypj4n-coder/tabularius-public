import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, stepLine, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-insert-current-'));
  createStore(join(dir, 'Insert.sqlite'));
  store = new Store(join(dir, 'Insert.sqlite'), 'Insert');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [
    { name: 'Text', type: 'text' }, { name: 'Other', type: 'text' },
    { name: 'Date', type: 'date' }, { name: 'Time', type: 'time' },
  ] }]);
  store.create('Notes', { Text: 'abcdef', Other: 'untouched' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

const run = (source: string) => runScript(store, {
  id: 9999, name: 'test',
  steps: parseScriptText(source.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })),
} as Script, { layout: 'Notes', foundSet: store.findIds('Notes'), account: 'Writer', now: () => new Date(2026, 9, 13, 14, 25, 36) });

for (const [name, value, parameter, field, stored] of [
  ['Insert Current Date', '10/13/2026', 'CurrentDate', 'Date', '2026-10-13'],
  ['Insert Current Time', '14:25:36', 'CurrentTime', 'Time', '14:25:36'],
  ['Insert Current User Name', 'Writer', 'AccountName', 'Other', 'Writer'],
] as const) {
  for (const [selection, expected, start] of [
    ['', `abcdef${value}`, 6],
    ['Set Selection [ Start Position: 3 ; End Position: 1 ]', `ab${value}cdef`, 2],
    ['Set Selection [ Start Position: 2 ; End Position: 4 ]', `a${value}ef`, 1],
    ['Select All', value, 0],
    ['Set Selection [ Start Position: 99 ; End Position: 100 ]', `abcdef${value}`, 6],
  ] as const) {
    test(`${name} without a target uses the active field: ${selection || 'default insertion point'}`, async () => {
      const trial = store.trial();
      try {
        const r = await run(`
          Go to Field [ Notes::Text ]
          ${selection}
          ${name}
          Exit Script [ Result: Get ( ActiveFieldContents ) ]
        `);
        assert.equal(r.error, 0);
        assert.equal(r.result, expected);
        assert.deepEqual(r.active?.selection, [start + value.length, start + value.length]);
        assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData.Text, expected);
        assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData.Other, 'untouched');
      } finally {
        trial.undo();
      }
    });
  }

  test(`${name} without a target: Select replaces the whole active field`, async () => {
    const trial = store.trial();
    try {
      const r = await run(`Go to Field [ Notes::Text ]\nSet Selection [ Start Position: 3 ; End Position: 1 ]\n${name} [ Select ]\nExit Script [ Result: Get ( ActiveFieldContents ) ]`);
      assert.equal(r.error, 0);
      assert.equal(r.result, value);
      const [s] = parseScriptText(`${name} [ Select ]`, store.schema);
      assert.equal(stepLine(name, s.params), `${name} [ Select ]`);
    } finally {
      trial.undo();
    }
  });

  test(`${name} without an active field reports 102, including after a commit`, async () => {
    for (const prefix of ['', 'Go to Field [ Notes::Text ]\nCommit Records/Requests [ With dialog: Off ]\n']) {
      const r = await run(`Set Error Capture [ On ]\n${prefix}${name}\nExit Script [ Result: Get ( LastError ) ]`);
      assert.equal(r.result, '102');
      assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData.Text, 'abcdef');
    }
  });

  test(`${name} writes to an explicit text field without changing the active field`, async () => {
    const trial = store.trial();
    try {
      const r = await run(`Go to Field [ Notes::Text ]\nSet Selection [ Start Position: 2 ; End Position: 4 ]\n${name} [ Notes::Other ]\nExit Script [ Result: Notes::Other & "|" & Get ( ActiveFieldContents ) ]`);
      assert.equal(r.error, 0);
      assert.equal(r.result, `${value}|abcdef`);
      assert.deepEqual(r.active?.selection, [1, 4]);
      assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData.Other, value);
    } finally {
      trial.undo();
    }
  });

  test(`${name} stores the same value as Get in an explicit ${field} field`, async () => {
    const trial = store.trial();
    try {
      const r = await run(`${name} [ Notes::${field} ]\nExit Script [ Result: Notes::${field} & "|" & ( Notes::${field} = Get ( ${parameter} ) ) ]`);
      assert.equal(r.error, 0);
      assert.equal(r.result, `${value}|1`);
      assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData[field], value);
      assert.equal(store.get('Notes', store.findIds('Notes')[0], 'iso').fieldData[field], stored);
    } finally {
      trial.undo();
    }
  });

  test(`${name} writes to a variable target`, async () => {
    const r = await run(`Set Variable [ $value ; "unchanged" ]\n${name} [ $value ]\nExit Script [ Result: $value & "|" & ( GetAsNumber ( $value ) = GetAsNumber ( Get ( ${parameter} ) ) ) ]`);
    assert.equal(r.error, 0);
    assert.equal(r.result, `${value}|1`);
    assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData.Text, 'abcdef');
    assert.equal(store.get('Notes', store.findIds('Notes')[0]).fieldData.Other, 'untouched');
  });
}

test('consecutive no-target inserts use the insertion point left by the previous insert', async () => {
  const trial = store.trial();
  try {
    const r = await run(`Go to Field [ Notes::Text ]\nSet Selection [ Start Position: 3 ; End Position: 1 ]\nInsert Current User Name\nInsert Current User Name\nExit Script [ Result: Get ( ActiveFieldContents ) ]`);
    assert.equal(r.error, 0);
    assert.equal(r.result, 'abWriterWritercdef');
    assert.deepEqual(r.active?.selection, [14, 14]);
  } finally {
    trial.undo();
  }
});
