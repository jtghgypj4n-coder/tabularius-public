import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store, type PrivilegeDefinition } from '@tabularius/store';
import { runScript } from '../src/index.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';
import type { Script, StepParams } from '@tabularius/fmp12';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-step-privileges-'));
  createStore(join(dir, 'Data.sqlite'));
  const store = new Store(join(dir, 'Data.sqlite'), 'Data');
  store.applyDesign([{ op: 'createTable', name: 'Tasks', fields: [
    { name: 'Title', type: 'text' }, { name: 'File', type: 'container' },
    { name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '10', increment: 1 } } } },
  ] }]);
  store.create('Tasks', { Title: 'one' });
  store.create('Tasks', { Title: 'two' });
  const reader: PrivilegeDefinition = { name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', scripts: 'viewOnly', valueLists: 'viewOnly', extendedPrivileges: [] };
  store.savePrivilegeSet(reader);
  store.setPassword('Reader', 'pw', 'Reader');
  const run = (body: string | { stepId: number; name: string; params?: StepParams }, fullAccess = false, opts: Parameters<typeof runScript>[2] = {}) => {
    const steps = typeof body === 'string'
      ? parseScriptText(body, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }))
      : [{ ...body, enabled: true }];
    const script: Script = { id: 9999, name: 'Test', fullAccess, steps: [
      { stepId: 86, name: 'Set Error Capture', enabled: true, params: { on: true } },
      ...steps,
      { stepId: 103, name: 'Exit Script', enabled: true, params: { calculation: 'Get ( LastError )' } },
    ] };
    return runScript(store, script, { layout: 'Tasks', account: 'Reader', privileges: store.privileges('Reader'), documents: dir, ...opts });
  };
  const rows = () => store.query('SELECT * FROM Tasks');
  const serial = () => { const t = store.schema.tables.find((t) => t.name === 'Tasks')!; return store.calc.peekSerial(t, t.fields.find((f) => f.name === 'Serial')!); };
  const close = () => { store.close(); rmSync(dir, { recursive: true }); };
  return { dir, store, reader, run, rows, serial, close };
}

const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'Tasks' }, field: { id: 0, name } });

test('Truncate Table refuses a Reader with error 200 and preserves every row', async () => {
  const s = setup();
  try {
    const before = s.rows();
    assert.equal((await s.run('Truncate Table [ Tasks ]')).result, '200');
    assert.deepEqual(s.rows(), before);
    assert.equal((await s.run('Truncate Table [ Tasks ]', true)).result, '0');
    assert.deepEqual(s.rows(), []);
  } finally { s.close(); }
});

test('Truncate Table requires Full Access even with unconditional delete permission, including an empty table', async () => {
  const s = setup();
  try {
    s.store.savePrivilegeSet({ ...s.reader, records: { view: true, edit: true, create: true, delete: true } });
    const before = s.rows();
    assert.equal((await s.run('Truncate Table [ Tasks ]')).result, '200');
    assert.deepEqual(s.rows(), before);
    s.store.truncate('Tasks');
    assert.equal((await s.run('Truncate Table [ Tasks ]')).result, '200');
  } finally { s.close(); }
});

test('Set Next Serial Value requires design access and full-access scripts can set it', async () => {
  const s = setup();
  try {
    const before = s.serial();
    assert.equal((await s.run('Set Next Serial Value [ Tasks::Serial ; 500 ]')).result, '9');
    assert.equal(s.serial(), before);
    assert.equal((await s.run('Set Next Serial Value [ Tasks::Serial ; 500 ]', true)).result, '0');
    assert.equal(s.serial(), '500');
  } finally { s.close(); }
});

for (const body of ['Replace Field Contents [ Tasks::Title ; "changed" ]', 'Relookup Field Contents [ Tasks::Title ]']) {
  test(`${body.split(' [')[0]} respects record edit permission and full-access elevation`, async () => {
    const s = setup();
    try {
      const before = s.rows();
      assert.equal((await s.run(body)).result, '200');
      assert.deepEqual(s.rows(), before);
      assert.equal((await s.run(body, true)).result, '0');
    } finally { s.close(); }
  });
}

test('Replace Field Contents cannot advance serial entry options when record edits are denied', async () => {
  const s = setup();
  try {
    const before = s.serial();
    const step = { stepId: 91, name: 'Replace Field Contents', params: { field: field('Serial'), replaceWith: 'serial', serial: { initial: '100', increment: '1', updateEntryOptions: true } } as StepParams };
    const rows = s.rows();
    assert.equal((await s.run(step)).result, '9');
    assert.deepEqual(s.rows(), rows);
    assert.equal(s.serial(), before);
    assert.equal((await s.run(step, true)).result, '0');
    assert.equal(s.serial(), '102');
  } finally { s.close(); }
});

test('AR-script-engine-07: editor and full-access replacement', async () => {
  const s = setup();
  try {
    s.store.savePrivilegeSet({ ...s.reader, records: { ...s.reader.records, edit: true } });
    assert.equal((await s.run('Set Next Serial Value [ Tasks::Serial ; 500 ]')).result, '9');
    const step = { stepId: 91, name: 'Replace Field Contents', params: { field: field('Serial'), replaceWith: 'serial', serial: { initial: '100', increment: '1', updateEntryOptions: true } } as StepParams };
    const before = s.rows();
    const next = s.serial();
    assert.equal((await s.run(step)).result, '9');
    assert.deepEqual(s.rows(), before);
    assert.equal(s.serial(), next);
    assert.equal(s.store.get('Tasks', s.store.create('Tasks', {}).recordId).fieldData.Serial, Number(next));
    assert.equal((await s.run({ ...step, params: { ...step.params, serial: { ...step.params.serial, updateEntryOptions: false } } })).result, '0');
    assert.equal(s.serial(), String(Number(next) + 1));
    assert.deepEqual(s.rows().map((r) => r.Serial), [100, 101, 102]);
    assert.equal((await s.run(step, true)).result, '0');
    assert.equal(s.serial(), '103');
    assert.deepEqual(s.rows().map((r) => r.Serial), [100, 101, 102]);
  } finally { s.close(); }
});

test('AR-script-engine-07: external owner and full-access caller', async () => {
  const s = setup();
  createStore(join(s.dir, 'Other.sqlite'));
  const other = new Store(join(s.dir, 'Other.sqlite'), 'Other');
  try {
    other.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '10', increment: 1 } } } }] }]);
    other.create('Items', {});
    other.savePrivilegeSet({ ...s.reader, records: { ...s.reader.records, edit: true } });
    other.setPassword('Reader', 'pw', 'Reader');
    s.store.resolveFile = (name) => name === 'Other' ? other : undefined;
    s.store.applyDesign([
      { op: 'createDataSource', name: 'Other', paths: ['file:Other'] },
      { op: 'createOccurrence', name: 'External', file: 'Other', externalTable: other.schema.tables[0].id },
      { op: 'createLayout', name: 'External', occurrence: 'External' },
    ]);
    const before = other.query('SELECT * FROM Items');
    for (const initial of [undefined, '100']) {
      const result = await s.run({ stepId: 91, name: 'Replace Field Contents', params: {
        field: { tableOccurrence: { id: 0, name: 'External' }, field: { id: 0, name: 'Serial' } },
        replaceWith: 'serial', serial: { initial, increment: '1', updateEntryOptions: true },
      } }, true, { layout: 'External' });
      assert.equal(result.result, '9');
      assert.deepEqual(other.query('SELECT * FROM Items'), before);
      assert.equal(other.calc.peekSerial(other.schema.tables[0], other.schema.tables[0].fields[0]), '11');
    }
  } finally { other.close(); s.close(); }
});

for (const copyKind of ['copy', 'clone'] as const) {
  test(`Save a Copy ${copyKind} requires full access even when exporting is allowed`, async () => {
    const s = setup();
    try {
      s.store.savePrivilegeSet({ ...s.reader, exporting: true, records: { ...s.reader.records, fields: { Title: 'none' } } });
      const step = { stepId: 37, name: 'Save a Copy as', params: { filePaths: ['backup'], copyKind } as StepParams };
      assert.equal((await s.run(step)).result, '9');
      assert.equal(existsSync(join(s.dir, 'backup.openhbam.sqlite')), false);
      assert.equal((await s.run(step, true)).result, '0');
      assert.equal(existsSync(join(s.dir, 'backup.openhbam.sqlite')), true);
    } finally { s.close(); }
  });
}

test('a Reader cannot save hidden data and read the SQLite copy through data-file steps', async () => {
  const s = setup();
  try {
    s.store.update('Tasks', 1, { Title: 'TOPSECRET' });
    s.store.savePrivilegeSet({ ...s.reader, exporting: true, records: { ...s.reader.records, fields: { Title: 'none' } } });
    const r = await s.run(`Save a Copy as [ "backup" ]
Set Variable [ $saved ; Value: Get ( LastError ) ]
Open Data File [ "backup.openhbam.sqlite" ; Target: $file ]
Read from Data File [ File ID: $file ; Target: $bytes ; Read as: Bytes ]
Exit Script [ Text Result: $saved & "|" & Length ( Base64Encode ( $bytes ) ) ]`);
    assert.equal(r.result, '9|0');
    assert.equal(existsSync(join(s.dir, 'backup.openhbam.sqlite')), false);
  } finally { s.close(); }
});

test('a Reader cannot save hidden data and send the SQLite copy as a mail attachment', async () => {
  const s = setup();
  try {
    s.store.update('Tasks', 1, { Title: 'TOPSECRET' });
    s.store.savePrivilegeSet({ ...s.reader, exporting: true, records: { ...s.reader.records, fields: { Title: 'none' } } });
    let sent = 0;
    const body = `Save a Copy as [ "backup" ]
Send Mail [ Send via SMTP Server ; To: "recipient@example.invalid" ; Subject: "copy" ; Message: "copy" ; Attachment: backup.openhbam.sqlite ]`;
    const opts: Parameters<typeof runScript>[2] = { mail: async (message) => {
      sent++;
      assert.ok(Buffer.from(message.attachments[0].data).includes(Buffer.from('TOPSECRET')));
    } };
    const r = await s.run(body, false, opts);
    assert.equal(sent, 0);
    assert.notEqual(r.result, '0');
    assert.equal(existsSync(join(s.dir, 'backup.openhbam.sqlite')), false);
    assert.equal((await s.run(body, true, opts)).result, '0');
    assert.equal(sent, 1, 'an explicitly elevated backup can still be mailed');
  } finally { s.close(); }
});

test('Import Records checks create privileges and allows full-access scripts', async () => {
  const s = setup();
  try {
    writeFileSync(join(s.dir, 'input.csv'), 'imported\n');
    const step = { stepId: 35, name: 'Import Records', params: { filePaths: ['input.csv'], importAction: 'add', fieldMapping: [{ field: field('Title'), import: true }] } as StepParams };
    const before = s.rows();
    assert.equal((await s.run(step)).result, '200');
    assert.deepEqual(s.rows(), before);
    assert.equal((await s.run(step, true)).result, '0');
    assert.equal(s.rows().length, 3);
  } finally { s.close(); }
});

for (const [stepId, name] of [[131, 'Insert File'], [56, 'Insert Picture'], [158, 'Insert PDF'], [159, 'Insert Audio/Video']] as const) {
  test(`${name} checks container access before asking for bytes`, async () => {
    const s = setup();
    try {
      let reads = 0;
      const opts = { insertFile: async () => { reads++; return { filename: 'file.txt', data: new TextEncoder().encode('contents') }; } };
      const step = { stepId, name, params: { field: field('File') } };
      assert.equal((await s.run(step, false, opts)).result, '200');
      assert.equal(reads, 0);
      assert.equal((await s.run(step, true, opts)).result, '0');
      assert.equal(reads, 1);
      assert.ok(s.store.containerId(s.store.layout('Tasks'), 1, 'File', 1));
    } finally { s.close(); }
  });
}

for (const [stepId, name, params] of [
  [36, 'Export Records', { exportFormat: 'COMS', exportFields: [field('Title')] }],
  [132, 'Export Field Contents', { field: field('Title') }],
  [143, 'Save Records as Excel', {}],
  [225, 'Save Records as JSONL', {}],
  [152, 'Save Records as Snapshot Link', {}],
  [37, 'Save a Copy as', {}],
] as const) {
  test(`${name} checks export permission before producing output`, async () => {
    const s = setup();
    try {
      s.store.savePrivilegeSet({ ...s.reader, exporting: false });
      const r = await s.run({ stepId, name, params: { ...params, filePaths: ['output.csv'] } as StepParams });
      assert.equal(r.result, '9');
      assert.equal(existsSync(join(s.dir, 'output.csv')), false);
      assert.equal(existsSync(join(s.dir, 'output.csv.openhbam.sqlite')), false);
      assert.deepEqual(r.actions, []);
    } finally { s.close(); }
  });
}

test('Execute SQL refuses unsupported ODBC execution even with full access', async () => {
  const s = setup();
  try {
    for (const full of [false, true]) assert.equal((await s.run({ stepId: 117, name: 'Execute SQL', params: { calculation: '"DELETE FROM Tasks"' } }, full)).result, '3');
    assert.equal(s.rows().length, 2);
  } finally { s.close(); }
});

test('Insert from URL may use an operator-enabled network but cannot write a Reader container', async () => {
  const s = setup();
  try {
    let requests = 0;
    const network: typeof fetch = async () => { requests++; return new Response('body'); };
    const step = { stepId: 160, name: 'Insert from URL', params: { field: field('File'), calculation: '"https://example.invalid/file.txt"' } };
    assert.equal((await s.run(step, false, { network, [TEST_ONLY_CUSTOM_FETCH]: true })).result, '200');
    assert.equal(s.store.containerId(s.store.layout('Tasks'), 1, 'File', 1), undefined);
    assert.equal((await s.run(step, true, { network, [TEST_ONLY_CUSTOM_FETCH]: true })).result, '0');
    assert.equal(requests, 2);
    assert.equal((await s.run({ ...step, params: { variable: '$response', calculation: step.params.calculation } }, false, { network, [TEST_ONLY_CUSTOM_FETCH]: true })).result, '0');
  } finally { s.close(); }
});

test('Send Mail has an operator capability gate, independent of record-write permission', async () => {
  const s = setup();
  try {
    let sent = 0;
    const step = { stepId: 63, name: 'Send Mail', params: { mail: { smtp: true, to: '"recipient@example.invalid"', subject: '"test"', message: '"body"' } } as StepParams };
    assert.equal((await s.run(step)).result, '3');
    assert.equal((await s.run(step, false, { mail: async () => { sent++; } })).result, '0');
    assert.equal(sent, 1);
  } finally { s.close(); }
});

for (const [stepId, name] of [[132, 'Export Field Contents'], [47, 'Copy'], [46, 'Cut']] as const) {
  test(`${name} cannot read container bytes from an inaccessible record ID`, async () => {
    const s = setup();
    try {
      s.store.setContainer('Tasks', 1, 'File', 1, { filename: 'secret.txt', mime: 'text/plain', data: new TextEncoder().encode('secret bytes') });
      s.store.savePrivilegeSet({ ...s.reader, records: { ...s.reader.records, view: 'Title = "two"' } });
      const r = await s.run({ stepId, name, params: { field: field('File'), filePaths: ['leak.txt'] } }, false, { foundSet: [1] });
      assert.equal(r.result, '200');
      assert.equal(existsSync(join(s.dir, 'leak.txt')), false);
      assert.deepEqual(r.actions, []);
    } finally { s.close(); }
  });
}

test('Write to Data File cannot copy a container from an inaccessible record ID', async () => {
  const s = setup();
  try {
    s.store.setContainer('Tasks', 1, 'File', 1, { filename: 'secret.txt', mime: 'text/plain', data: new TextEncoder().encode('secret bytes') });
    s.store.savePrivilegeSet({ ...s.reader, records: { ...s.reader.records, view: 'Title = "two"' } });
    writeFileSync(join(s.dir, 'output.txt'), '');
    const result = await s.run('Open Data File [ "output.txt" ; Target: $file ]\nWrite to Data File [ File ID: $file ; Data source: Tasks::File ; Write as: Bytes ]', false, { foundSet: [1] });
    assert.equal(result.result, '200');
    assert.equal(readFileSync(join(s.dir, 'output.txt'), 'utf8'), '');
  } finally { s.close(); }
});

test('Install Plug-In File requires full access before reading or installing the package', async () => {
  const s = setup();
  try {
    let installs = 0;
    const installPlugin = () => { installs++; return { id: 'test', version: '1', signer: 'test' }; };
    const step = { stepId: 157, name: 'Install Plug-In File', params: { filePaths: ['package.ohplugin'] } };
    assert.equal((await s.run(step, false, { installPlugin })).result, '9');
    assert.equal(installs, 0);
    writeFileSync(join(s.dir, 'package.ohplugin'), 'test bytes');
    assert.equal((await s.run(step, true, { installPlugin })).result, '0');
    assert.equal(installs, 1);
  } finally { s.close(); }
});

test('Perform Script on Server checks script access and starts with the account privileges', async () => {
  const s = setup();
  try {
    s.store.applyDesign([{ op: 'createScript', name: 'Worker', text: 'Set Error Capture [ On ]\nTruncate Table [ Tasks ]\nExit Script [ Text Result: Get ( LastError ) ]' }]);
    const worker = s.store.schema.scripts.find((s) => s.name === 'Worker')!;
    const step = { stepId: 164, name: 'Perform Script on Server', params: { script: { id: worker.id, name: worker.name }, wait: true } };
    s.store.savePrivilegeSet({ ...s.reader, scriptAccess: { Worker: 'none' } });
    assert.equal((await s.run(step)).result, '9');
    s.store.savePrivilegeSet(s.reader);
    const caller = 'Perform Script on Server [ “Worker” ; Wait for completion: On ]\nExit Script [ Text Result: Get ( ScriptResult ) ]';
    assert.equal((await s.run(caller, true)).result, '200', 'caller elevation is not inherited by the server worker');
    assert.equal(s.rows().length, 2);
  } finally { s.close(); }
});

test('Save Records as PDF cannot print a container from an inaccessible record ID', async () => {
  const s = setup();
  try {
    s.store.setContainer('Tasks', 1, 'File', 1, { filename: 'secret.txt', mime: 'text/plain', data: new TextEncoder().encode('secret bytes') });
    const layout = s.store.designs().layouts.find((l) => l.name === 'Tasks')!;
    s.store.applyDesign([{ op: 'updateLayout', layout: layout.id, design: { objects: layout.objects.filter((o) => o.field?.field === 'File') } }]);
    s.store.savePrivilegeSet({ ...s.reader, records: { ...s.reader.records, view: 'Title = "two"' } });
    assert.equal((await s.run({ stepId: 144, name: 'Save Records as PDF', params: { filePaths: ['leak.pdf'] } }, false, { foundSet: [1] })).result, '200');
    assert.equal(existsSync(join(s.dir, 'leak.pdf')), false);
  } finally { s.close(); }
});

test('Save a Copy checks the file it backs up after selecting another file window', async () => {
  const s = setup();
  createStore(join(s.dir, 'Other.sqlite'));
  const other = new Store(join(s.dir, 'Other.sqlite'), 'Other');
  try {
    other.applyDesign([{ op: 'createTable', name: 'OtherTasks', fields: [{ name: 'Title' }] }]);
    other.setPassword('Reader', 'pw', '[Full Access]');
    s.store.savePrivilegeSet({ ...s.reader, exporting: false });
    s.store.applyDesign([{ op: 'createDataSource', name: 'Other', paths: ['file:Other'] }]);
    s.store.resolveFile = (name) => name === 'Other' ? other : undefined;
    const body = 'Open File [ “Other” ]\nSelect Window [ Name: "Other" ]\nSave a Copy as [ "backup" ]';
    assert.equal((await s.run(body)).result, '9');
    assert.equal(existsSync(join(s.dir, 'backup.openhbam.sqlite')), false);
    assert.equal((await s.run(body, true)).result, '0');
    assert.equal(existsSync(join(s.dir, 'backup.openhbam.sqlite')), true);
  } finally { other.close(); s.close(); }
});

test('Truncate Table and Set Next Serial Value cannot elevate access to an external table', async () => {
  const s = setup();
  createStore(join(s.dir, 'Other.sqlite'));
  const other = new Store(join(s.dir, 'Other.sqlite'), 'Other');
  try {
    other.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Serial', type: 'number', options: { autoEnter: { serial: { next: '10', increment: 1 } } } }] }]);
    other.create('Items', {});
    other.savePrivilegeSet(s.reader);
    other.setPassword('Reader', 'pw', 'Reader');
    s.store.applyDesign([{ op: 'createDataSource', name: 'Other', paths: ['file:Other'] }]);
    s.store.resolveFile = (name) => name === 'Other' ? other : undefined;
    s.store.applyDesign([{ op: 'createOccurrence', name: 'External', file: 'Other', externalTable: other.schema.tables[0].id }]);
    assert.equal((await s.run('Truncate Table [ External ]', true)).result, '200');
    assert.equal(other.findIds('Items').length, 1);
    assert.equal((await s.run('Set Next Serial Value [ External::Serial ; 500 ]', true)).result, '9');
    assert.equal(other.calc.peekSerial(other.schema.tables[0], other.schema.tables[0].fields[0]), '11');
  } finally { other.close(); s.close(); }
});

test('Store.truncate enforces privileges when called directly and checks before locks', () => {
  const s = setup();
  try {
    const before = s.rows();
    s.store.locks.acquire('Tasks', 1, 'other-session', 'Other');
    assert.throws(() => s.store.truncate('Tasks', { privileges: s.store.privileges('Reader') }), { code: 200 });
    assert.deepEqual(s.rows(), before);
    assert.throws(() => s.store.truncate('Tasks'), { code: 301 });
    assert.deepEqual(s.rows(), before);
  } finally { s.close(); }
});

test('Export Field Contents cannot bypass the current file export restriction through an external field', async () => {
  const s = setup();
  createStore(join(s.dir, 'Other.sqlite'));
  const other = new Store(join(s.dir, 'Other.sqlite'), 'Other');
  try {
    other.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
    other.create('Items', { Title: 'external contents' });
    other.setPassword('Reader', 'pw', '[Full Access]');
    s.store.savePrivilegeSet({ ...s.reader, exporting: false });
    s.store.applyDesign([{ op: 'createDataSource', name: 'Other', paths: ['file:Other'] }]);
    s.store.resolveFile = (name) => name === 'Other' ? other : undefined;
    s.store.applyDesign([
      { op: 'createOccurrence', name: 'External', file: 'Other', externalTable: other.schema.tables[0].id },
      { op: 'createLayout', name: 'ExternalLayout', occurrence: 'External' },
    ]);
    const step = { stepId: 132, name: 'Export Field Contents', params: { field: { tableOccurrence: { id: 0, name: 'External' }, field: { id: 0, name: 'Title' } }, filePaths: ['leak.txt'] } };
    assert.equal((await s.run(step, false, { layout: 'ExternalLayout' })).result, '9');
    assert.equal(existsSync(join(s.dir, 'leak.txt')), false);
    assert.equal((await s.run(step, true, { layout: 'ExternalLayout' })).result, '0');
    assert.equal(readFileSync(join(s.dir, 'leak.txt'), 'utf8'), 'external contents');
  } finally { other.close(); s.close(); }
});

test('Get ( RecordModificationCount ) cannot read metadata from an inaccessible record ID', async () => {
  const s = setup();
  try {
    s.store.update('Tasks', 1, { Title: 'hidden' });
    s.store.savePrivilegeSet({ ...s.reader, records: { ...s.reader.records, view: 'Title = "two"' } });
    assert.equal((await s.run('Set Variable [ $count ; Value: Get ( RecordModificationCount ) ]', false, { foundSet: [1] })).result, '200');
    assert.equal((await s.run('Set Variable [ $count ; Value: Get ( RecordModificationCount ) ]', true, { foundSet: [1] })).result, '0');
  } finally { s.close(); }
});
