import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stepHarness } from './step-behaviour-helpers.ts';

const h = stepHarness('files');
after(h.close);

test('file steps export field contents under documents and report a missing field', async () => {
  const cases = [
    { step: 'Export Field Contents [ People::Name ; "person.txt" ]', filename: 'person.txt', expected: 'Lin' },
    { step: 'Export Field Contents [ People::Age ; "age.txt" ]', filename: 'age.txt', expected: '41' },
  ];
  for (const c of cases) {
    const r = await h.run(`Go to Record/Request/Page [ Last ]\n${c.step}`);
    assert.equal(r.error, 0, c.step);
    assert.equal(readFileSync(join(h.documents, c.filename), 'utf8'), c.expected);
  }
  writeFileSync(join(h.documents, 'source.bin'), Buffer.from('binary field contents'));
  const target = { tableOccurrence: { id: 0, name: 'People' }, field: { id: 0, name: 'Photo' } };
  const inserts = [
    { id: 56, name: 'Insert Picture' },
    { id: 158, name: 'Insert PDF' },
    { id: 159, name: 'Insert Audio/Video' },
  ];
  for (const item of inserts) {
    const r = await h.runDirect([
      { stepId: item.id, name: item.name, enabled: true, params: { field: target, filePaths: ['source.bin'] } },
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError ) & "/" & GetContainerAttribute ( People::Photo ; "filename" )' } },
    ]);
    assert.equal(r.result, '0/source.bin', item.name);
  }
  const badInsert = await h.runDirect([
    { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
    { stepId: 56, name: 'Insert Picture', enabled: true, params: { field: target, filePaths: ['absent.png'] } },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
  ]);
  assert.equal(badInsert.result, '100');
  // Error 102 for exporting without a target or active field is the engine's current behavior.
  const bad = await h.runDirect([
    { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
    { stepId: 132, name: 'Export Field Contents', enabled: true, params: {} },
    { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
  ]);
  assert.equal(bad.result, '102');
});
