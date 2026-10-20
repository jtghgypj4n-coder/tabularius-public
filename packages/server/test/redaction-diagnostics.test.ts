import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import { Profiler } from '../src/profiler.ts';
import { RunProfile, ScriptDebugger } from '../../scripts/src/index.ts';
import { CredentialRedactor, REDACTED } from '../../scripts/src/redaction.ts';
import { StoreError } from '../../store/src/index.ts';

const canaries = ['Q7v9z2Lm4N8k6R1x', 'B6n3K8r2V4x9T1m5', 'C8r2N6v4M9x1K3b7', 'D4k8R2v6M9x1N3b7'];

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-diagnostic-redaction-'));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  const store = served.host.create('Local');
  store.setPassword('Admin', 'login', '[Full Access]');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Copy' }, { name: 'Password' }, { name: 'private_key' }, { name: 'Note' }, { name: 'Count', type: 'number' }] }]);
  const login = await fetch(served.url + '/fmi/data/vLatest/databases/Local/sessions', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('Admin:login').toString('base64') }, body: '{}' });
  const token = (await login.json()).response.token;
  assert.ok(token);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(served.url + '/tabularius/debug/v1/databases/Local/' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const close = async () => {
    await new Promise<void>((resolve) => served.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  };
  for (const value of canaries) assert.equal(new CredentialRedactor().value(value), value, 'neutral canary');
  return { store, call, close };
}

for (const [name, formula] of [
  ['$pwd', '"https://user:" & $pwd & "@example.test/"'],
  ['$private_key', '$private_key'],
  ['$input', '"https://user:" & $input & "@example.test/"'],
  ['$input', '"user=bob&password=" & $input'],
  ['$input', '"https://example.test/?api_key=" & $input'],
  ['$input', '"--data {\\"password\\":\\"" & $input & "\\"}"'],
  ['$input', '"-H \\"X-API-Key: " & $input & "\\""'],
]) test(`full access diagnostics hide ${name} in ${formula} across traces, both profilers and debugger variables`, async () => {
  const f = await fixture();
  try {
    f.store.applyDesign([{ op: 'createScript', name: 'Inputs', text: [
      `Set Variable [ ${name} ; Value: "${canaries[0]}" ]`,
      'Set Variable [ $note ; Value: "ordinary" ]',
      `Insert from URL [ $result ; ${formula} ]`,
      'Exit Script [ Text Result: Get ( LastError ) ]',
    ].join('\n') }]);
    const profile = new Profiler();
    const runProfile = new RunProfile();
    const debugger_ = new ScriptDebugger({ pauseAtStart: true });
    const states = [await debugger_.start(f.store, 'Inputs', {
      account: 'Admin', privileges: f.store.privileges('Admin'), trace: true, network: false,
      profile: {
        step(...args) { profile.step(...args); runProfile.step(...args); },
        run: profile.run.bind(profile), enter: runProfile.enter.bind(runProfile), leave: runProfile.leave.bind(runProfile),
      },
    })];
    states.push(await debugger_.resume('into'));
    assert.equal(states.at(-1)!.paused!.variables.locals[name], REDACTED);
    assert.equal(debugger_.evaluate(name).value, REDACTED);
    while (debugger_.running) states.push(await debugger_.resume('into'));
    assert.equal(states.at(-1)!.done!.result, '3');
    const trace = states.at(-1)!.done!.trace!;
    assert.equal(trace[0].line, `Set Variable [ ${REDACTED} ]`);
    assert.ok(trace.some((s) => s.line.includes('"ordinary"')));
    for (const output of [states, profile.report(), runProfile.report(), (await f.call('GET', 'scripts')).body]) {
      assert.ok(!JSON.stringify(output).includes(canaries[0]));
      assert.ok(JSON.stringify(output).includes('ordinary'), 'ordinary diagnostics remain useful');
    }
  } finally { await f.close(); }
});

for (const withRecord of [false, true]) test(`standalone evaluate learns stored secrets across rows and tables ${withRecord ? 'with' : 'without'} recordId`, async () => {
  const f = await fixture();
  try {
    const row = f.store.create('T', { Note: 'ordinary', Count: 42 });
    f.store.create('T', { Password: canaries[0], Note: 'second' });
    f.store.applyDesign([{ op: 'createTable', name: 'Other', fields: [{ name: 'Password' }] }]);
    f.store.create('Other', { Password: canaries[1] });
    const formulas = ['ExecuteSQL ( "SELECT * FROM T" ; "|" ; "¶" )', 'ExecuteSQL ( "SELECT * FROM Other" ; "|" ; "¶" )', 'ExecuteSQL ( "SELECT Note FROM T" ; "|" ; "¶" )'];
    for (const formula of formulas.slice(0, 2)) assert.ok(canaries.some((c) => f.store.evaluate('T', formula).value.includes(c)), 'the calculation really returns a stored secret');
    const response = await f.call('POST', 'evaluate', { layout: 'T', ...(withRecord ? { recordId: Number(row.recordId) } : {}), formulas });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results.map((r: { value: string }) => r.value), [REDACTED, REDACTED, 'ordinary\rsecond']);
  } finally { await f.close(); }
});

test('standalone evaluate scans stored credentials once while the data stands, and again after any write', async () => {
  const f = await fixture();
  try {
    f.store.create('T', { Password: canaries[0], Note: 'first' });
    const scans = () => {
      let n = 0;
      const prepare = f.store.sql.prepare.bind(f.store.sql);
      f.store.sql.prepare = ((text: string, ...rest: unknown[]) => {
        if (/^SELECT "Password", "private_key" FROM "T"/.test(text)) n++;
        return (prepare as (...a: unknown[]) => unknown)(text, ...rest);
      }) as typeof f.store.sql.prepare;
      return { count: () => n, stop: () => { f.store.sql.prepare = prepare as typeof f.store.sql.prepare; } };
    };
    const all = ['ExecuteSQL ( "SELECT Password FROM T" ; "|" ; "¶" )'];
    const run = async () => (await f.call('POST', 'evaluate', { layout: 'T', formulas: all })).body.results[0].value;
    const spy = scans();
    try {
      assert.equal(await run(), REDACTED);
      assert.equal(await run(), REDACTED);
      assert.equal(spy.count(), 1, 'the second request reuses the first scan');
      // A password written, changed or added after the scan is hidden at once.
      const second = f.store.create('T', { Password: canaries[1], Note: 'second' });
      assert.equal(await run(), REDACTED);
      assert.equal(spy.count(), 2);
      f.store.update('T', Number(second.recordId), { Password: canaries[2] });
      assert.equal(await run(), REDACTED);
      assert.equal(spy.count(), 3);
      for (const canary of canaries.slice(0, 3)) assert.ok(!JSON.stringify((await f.call('POST', 'evaluate', { layout: 'T', formulas: all })).body).includes(canary));
    } finally { spy.stop(); }
  } finally { await f.close(); }
});

test('standalone evaluate hides stored secrets while a transaction is open and after it rolls back', async () => {
  const f = await fixture();
  try {
    const id = Number(f.store.create('T', { Password: canaries[0] }).recordId);
    // Another formula each time: the calculation's own result cache is not what is under test.
    let n = 0;
    const run = async () => (await f.call('POST', 'evaluate', { layout: 'T', formulas: [`ExecuteSQL ( "SELECT * FROM T WHERE ${++n} = ${n}" ; "|" ; "¶" )`] })).body.results[0].value;
    assert.equal(await run(), REDACTED);
    f.store.sql.exec('BEGIN IMMEDIATE');
    try {
      f.store.update('T', id, { Password: canaries[1] });
      // A query through SQL sees the committed file; the scan has to read that too, not only the transaction's own writes.
      assert.equal(await run(), REDACTED);
    } finally { f.store.sql.exec('ROLLBACK'); }
    // The write token is back at an earlier value; a committed change now must not meet a scan kept from inside the transaction.
    f.store.update('T', id, { Password: canaries[2] });
    assert.equal(await run(), REDACTED);
  } finally { await f.close(); }
});

test('standalone evaluate redacts partial dynamically named field reads', async () => {
  const f = await fixture();
  try {
    const row = f.store.create('T', { Password: canaries[0], Note: 'ordinary' });
    const response = await f.call('POST', 'evaluate', { layout: 'T', recordId: Number(row.recordId), formulas: [
      'Left ( GetField ( "Pass" & "word" ) ; 12 )',
      'Middle ( GetField ( "Pa" & "ss" & "word" ) ; 4 ; 4 )',
      'Right ( GetField ( "Pa" & "ss" & "word" ) ; 4 )',
      'T::Note',
    ] });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results.map((r: { value: string }) => r.value), [REDACTED, REDACTED, REDACTED, 'ordinary']);
  } finally { await f.close(); }
});

test('standalone evaluate matches whole-value SQL and stored-calc fragments without incidental overlap', async () => {
  const f = await fixture();
  try {
    f.store.applyDesign([
      { op: 'createTable', name: 'Rows', fields: [{ name: 'Password' }] },
      { op: 'createField', table: 'Rows', name: 'Hint', kind: 'calculation', type: 'text', calculation: 'Left ( Password ; 8 )' },
    ]);
    const row = f.store.create('Rows', { Password: canaries[0] });
    const formulas = [
      'Left ( ExecuteSQL ( "SELECT _fm_record_id, _fm_mod_id, Password FROM Rows" ; "|" ; "" ) ; 8 )',
      'Left ( ExecuteSQL ( "SELECT Pa" & "ssword FROM Rows" ; "" ; "" ) ; 8 )',
      'Hint',
    ];
    assert.deepEqual(formulas.map((formula) => f.store.evaluate('Rows', formula, Number(row.recordId)).value), ['1|0|Q7v9', canaries[0].slice(0, 8), canaries[0].slice(0, 8)]);
    const response = await f.call('POST', 'evaluate', { layout: 'Rows', recordId: Number(row.recordId), formulas });
    assert.equal(response.status, 200);
    // The explicit internal ids keep the SQL result stable; naming Password in its
    // formula now hides even a partial result under the credential-name rule.
    assert.deepEqual(response.body.results.map((r: { value: string }) => r.value), [REDACTED, REDACTED, REDACTED]);
  } finally { await f.close(); }
});

test('standalone evaluate hides whole-value fragments across case changes and preserves partial overlaps', async () => {
  const f = await fixture();
  try {
    f.store.applyDesign([
      { op: 'createTable', name: 'Rows', fields: [{ name: 'Password' }, { name: 'Note' }] },
      { op: 'createField', table: 'Rows', name: 'Hint15', kind: 'calculation', type: 'text', calculation: 'Left ( Password ; 15 )' },
    ]);
    const row = f.store.create('Rows', { Password: canaries[0], Note: 'ordinary' });
    const fragment = canaries[0].slice(0, 15);
    const cases = [
      ...['~', ' ', '¶'].map((delimiter) => [
        `Left ( ExecuteSQL ( "SELECT _fm_record_id, _fm_mod_id, Password FROM Rows" ; "${delimiter}" ; "" ) ; 19 )`, `1${delimiter}0${delimiter}${fragment}`.replaceAll('¶', '\r'),
      ]),
      ['Substitute ( Left ( ExecuteSQL ( "SELECT _fm_record_id, _fm_mod_id, Password FROM Rows" ; "|" ; "" ) ; 19 ) ; "|" ; "" )', `10${fragment}`],
      ...['x', ' ', '='].map((prefix) => [`"${prefix}" & Hint15`, `${prefix}${fragment}`]),
      ['Upper ( Hint15 )', fragment.toUpperCase()],
      ['Lower ( Hint15 )', fragment.toLowerCase()],
      ['"x" & Upper ( Middle ( Hint15 ; 4 ; 4 ) ) & "-tail"', `x${fragment.slice(3, 7).toUpperCase()}-tail`],
    ];
    for (const [formula, expected] of cases) assert.equal(f.store.evaluate('Rows', formula, Number(row.recordId)).value, expected, formula);
    const ordinary = ['Note', '"x" & Note', 'Upper ( Note )', 'ExecuteSQL ( "SELECT Note FROM Rows" ; "~" ; "" )'];
    const response = await f.call('POST', 'evaluate', { layout: 'Rows', recordId: Number(row.recordId), formulas: [...cases.map(([formula]) => formula), ...ordinary] });
    assert.equal(response.status, 200);
    // SQL formulas explicitly select the internal ids and Password. The name rule
    // hides those results even where the displayed prefix is only part of a secret.
    assert.deepEqual(response.body.results.map((r: { value: string }) => r.value), [
      REDACTED, REDACTED, REDACTED, REDACTED,
      cases[4]![1], REDACTED, cases[6]![1], REDACTED, REDACTED, cases[9]![1],
      'ordinary', 'xordinary', 'ORDINARY', 'ordinary',
    ]);
  } finally { await f.close(); }
});

test('Full Access current and evaluate preserve ordinary messages after learning credential values', async () => {
  const f = await fixture();
  try {
    for (const [password, note] of [
      ['https://svc-user:Zz91qq@api.example.com/v1', 'Visit https://www.wikipedia.org'],
      ['Bearer abcdEFGH1234', 'Invoice 1234'],
      ['password2026', 'Fiscal year 2026'],
      ['Summer2026!', 'Summer sale'],
      [canaries[0], 'Order 4N8k shipped to https://example.com'],
    ]) {
      const row = f.store.create('T', { Password: password, Note: note });
      const recordId = Number(row.recordId);
      const current = await f.call('GET', `current?layout=T&recordId=${recordId}`);
      assert.equal(current.status, 200);
      assert.equal(current.body.fields.Password, REDACTED);
      assert.equal(current.body.fields.Note, note);
      const evaluated = await f.call('POST', 'evaluate', { layout: 'T', recordId, formulas: ['Note'] });
      assert.equal(evaluated.status, 200);
      assert.equal(evaluated.body.results[0].value, note);
    }
  } finally { await f.close(); }
});

test('standalone current and evaluate redact fields, globals, aliases, results and errors', async () => {
  const f = await fixture();
  try {
    const row = f.store.create('T', { Copy: canaries[0], Password: canaries[0], private_key: canaries[1], Note: 'ordinary', Count: 42 });
    const recordId = Number(row.recordId);
    let response = await f.call('POST', 'evaluate', { layout: 'T', recordId, formulas: [
      `Let ( $$pwd = "${canaries[2]}" ; $$pwd )`,
      `Let ( $$copy = $$pwd ; $$copy )`,
      `Let ( $$Password = "${canaries[3]}" ; $$Password )`,
      'Let ( $$note = "ordinary" ; $$note )',
    ] });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results.map((r: { value: string }) => r.value), [REDACTED, REDACTED, REDACTED, 'ordinary']);
    response = await f.call('GET', `current?layout=T&recordId=${recordId}`);
    assert.equal(response.status, 200);
    for (const name of ['Copy', 'Password', 'private_key']) assert.equal(response.body.fields[name], REDACTED);
    for (const name of ['$$pwd', '$$copy', '$$password']) assert.equal(response.body.variables[name], REDACTED);
    assert.equal(response.body.fields.Count, 42);
    assert.equal(response.body.fields.Note, 'ordinary');
    assert.equal(response.body.variables.$$note, 'ordinary');
    response = await f.call('POST', 'evaluate', { layout: 'T', recordId, formulas: ['$$Password', '$$pwd', '$$copy', 'T::Password', 'T::private_key', 'GetField ( "Password" )', 'T::Copy', 'T::Note', 'T::Count', 'Nonsense ( 1 )'] });
    assert.deepEqual(response.body.results.slice(0, 7).map((r: { value: string }) => r.value), Array(7).fill(REDACTED));
    assert.deepEqual(response.body.results.slice(7, 9).map((r: { value: string }) => r.value), ['ordinary', '42']);
    assert.ok(response.body.results[9].error > 0);
    for (const canary of canaries) assert.ok(!JSON.stringify(response).includes(canary));
    const evaluate = f.store.evaluate;
    try {
      for (const error of [new StoreError(1200, `Invalid expression ${canaries[0]}`), new Error(`Failed ${canaries[2]}`)]) {
        f.store.evaluate = () => { throw error; };
        response = await f.call('POST', 'evaluate', { layout: 'T', recordId, formulas: ['1'] });
        assert.equal(response.status, error instanceof StoreError ? 200 : 500);
        assert.equal(error instanceof StoreError ? response.body.results[0].message : response.body.error.message, 'Credential step failed');
        for (const canary of canaries) assert.ok(!JSON.stringify(response).includes(canary));
      }
    } finally { f.store.evaluate = evaluate; }
  } finally { await f.close(); }
});

test('recordings endpoint hides pending and committed credentials while preserving scratch execution and ordinary changes', async () => {
  const f = await fixture();
  try {
    f.store.applyDesign([{ op: 'createScript', name: 'Update', text: [
      `Set Field [ T::Password ; "${canaries[1]}" ]`,
      `Set Field [ T::private_key ; "${canaries[2]}" ]`,
      'Set Field [ T::Note ; "updated" ]',
      'Commit Records/Requests [ With dialog: Off ]',
    ].join('\n') }]);
    const row = f.store.create('T', { Password: canaries[0], private_key: canaries[3], Note: 'original' });
    const recordId = Number(row.recordId);
    const response = await f.call('POST', 'recordings', { script: 'Update', layout: 'T', recordId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.done.error, 0);
    const changes = response.body.steps.flatMap((s: { changes?: { fields: { field: string; before: string; after: string }[] }[] }) => s.changes ?? []).flatMap((c: { fields: { field: string; before: string; after: string }[] }) => c.fields);
    for (const name of ['Password', 'private_key']) assert.deepEqual(changes.find((c: { field: string }) => c.field === name), { field: name, before: REDACTED, after: REDACTED });
    assert.deepEqual(changes.find((c: { field: string }) => c.field === 'Note'), { field: 'Note', before: 'original', after: 'updated' });
    for (const canary of canaries) assert.ok(!JSON.stringify(response.body).includes(canary));
    assert.equal(f.store.get('T', recordId).fieldData.Password, canaries[0]);
    assert.equal(f.store.get('T', recordId).fieldData.Note, 'original');
  } finally { await f.close(); }
});
