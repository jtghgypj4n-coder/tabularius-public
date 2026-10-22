import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store, StoreError, writer } from '../../store/src/index.ts';
import { scriptText } from '../../fmp12/src/index.ts';
import { embeddedCredential, isCredentialName, isCredentialLabelName, isCredentialParameterName, sqlMayReadSecret } from '../src/credentials.ts';
import { CredentialRedactor, REDACTED, redactCredentialStep, redactDiagnosticText } from '../src/redaction.ts';
import { recordRun } from '../src/recorder.ts';
import { testScripts } from '../src/testrun.ts';
import { runScript, RunProfile, ScriptDebugger } from '../src/index.ts';

const before = 'Q7v9z2Lm4N8k6R1x';
const after = 'B6n3K8r2V4x9T1m5';

for (const hidden of [false, true]) for (const injected of [false, true]) {
  test(`AR-script-engine-02: hidden ${hidden}, message ${injected}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-lock-diagnostics-'));
    createStore(join(dir, 'Data.sqlite'));
    const store = new Store(join(dir, 'Data.sqlite'), 'Data');
    t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
    const marker = 'AR07_CREDENTIAL_MARKER';
    const field = hidden ? 'Note' : 'Password';
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: field }] },
      { op: 'createScript', name: 'Edit', text: `Set Error Capture [ On ]\nSet Field [ T::${field} ; "${marker}" ]` },
    ]);
    const { recordId } = store.create('T', { [field]: 'before' });
    store.locks.acquire('T', recordId, 'other', 'Other');
    if (injected) t.mock.method(store.locks, 'acquire', () => { throw new StoreError(301, marker); });
    store.savePrivilegeSet({ name: 'Editor', records: { view: true, edit: true, create: true, delete: true }, layouts: 'viewOnly', scripts: hidden ? 'viewOnly' : 'modifiable', valueLists: 'viewOnly', extendedPrivileges: [] });
    store.setPassword('Editor', 'pw', 'Editor');
    const opts = { layout: 'T', account: 'Editor', privileges: store.privileges('Editor'), trace: true };
    const result = await writer.run({ owner: 'editor' }, () => runScript(store, 'Edit', opts));
    assert.equal(result.error, 301);
    assert.ok(result.recordInUse);
    assert.equal(result.recordInUse.line, result.trace!.find((line) => line.error === 301)!.line);
    assert.ok(!JSON.stringify(result).includes(marker));
    const recording = await writer.run({ owner: 'editor' }, () => recordRun(store, 'Edit', opts));
    assert.equal(recording.done.error, 301);
    assert.deepEqual(recording.done.recordInUse, result.recordInUse);
    assert.ok(!JSON.stringify(recording).includes(marker));
  });
}

test('prose redaction uses case-insensitive remembered values without hiding surrounding context', () => {
  for (const learn of ['remember', 'rememberSql'] as const) {
    const redaction = new CredentialRedactor();
    redaction[learn](before);
    redaction[learn]('X.*');
    for (const value of [before, before.toLowerCase(), before.toUpperCase()]) {
      assert.equal(redaction.text(`upstream echoed ${value}; literal x.*; ordinary`), `upstream echoed ${REDACTED}; literal ${REDACTED}; ordinary`);
    }
    assert.equal(redaction.text('HTTP error code: 503'), 'HTTP error code: 503');
  }
  const frame = '    at read (packages/scripts/src/credentials.ts:12:3)';
  assert.equal(redactDiagnosticText(`Password=${before}\nupstream echoed ${before.toUpperCase()}\n${frame}`),
    `Password=${REDACTED}\nupstream echoed ${REDACTED}\n${frame}`);
});

test('diagnostic redaction masks values and preserves ordinary context and stack frames', () => {
  for (const text of [`Password=${before}`, `"Password": "${before}"`, `api key='${before}'`, `Authorization: Bearer ${before}`, `--user "user:${before}"`]) {
    const diagnostic = `failed: ${text}\n    at issue (packages/server/src/mcp-tokens.ts:41:5)\n    at check (packages/scripts/src/credentials.ts:12:3)`;
    const safe = redactDiagnosticText(diagnostic);
    assert.ok(!safe.includes(before), text);
    assert.ok(safe.startsWith('failed: '));
    assert.ok(safe.includes('at issue (packages/server/src/mcp-tokens.ts:41:5)'));
    assert.ok(safe.includes('at check (packages/scripts/src/credentials.ts:12:3)'));
    assert.equal(redactDiagnosticText(safe), safe, 'redaction is idempotent');
  }
  const validation = 'Invalid value for field Token: expected number';
  assert.equal(redactDiagnosticText(validation), validation);
  assert.equal(redactDiagnosticText(`${validation}; Token=${before}`), `${validation}; Token=${REDACTED}`);
  const frame = '    at read (packages/scripts/src/credentials-utils.ts:41:5)';
  assert.equal(redactDiagnosticText(frame), frame, 'a filename suffix is not a cURL option');
  assert.equal(redactDiagnosticText(`Authorization: Bearer ${before}`), `Authorization: Bearer ${REDACTED}`);
  assert.equal(redactDiagnosticText('HTTP error code: 503'), 'HTTP error code: 503');
  assert.equal(redactDiagnosticText(`endpoint (https://[::1]/${before}) failed`), 'endpoint (https://[::1]) failed');
  assert.equal(redactDiagnosticText('endpoint (https://[::1]) failed'), 'endpoint (https://[::1]) failed');
});

test('URL authentication detection stays linear on long unmatched text', () => {
  const inputs = ['a'.repeat(1_000_000), `https://user:${'a'.repeat(1_000_000)}`];
  const started = performance.now();
  for (const input of inputs) assert.equal(redactCredentialStep(input), input);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3000, `one million characters per input took ${elapsed.toFixed(1)} ms`);
  assert.equal(redactCredentialStep('Visit https://user:token@example.test'), `Script step [ ${REDACTED} ]`);
});

test('authentication wrappers remember only password and token components', () => {
  const cases: [string, string][] = [
    [`https://svc-user:${before}@api.example.com/v1`, before],
    [`https://${before}@api.example.com/v1`, before],
    [`https://api.example.com/v1?api_key=${before}`, before],
    [`Bearer ${before}`, before],
    [`--user svc-user:${before}`, before],
    [`--proxy-user='svc-user:${before}'`, before],
    [`-usvc-user:${before}`, before],
    [`--oauth2-bearer ${before}`, before],
  ];
  for (const [input, secret] of cases) {
    const redaction = new CredentialRedactor();
    redaction.remember(input);
    assert.equal(redaction.value(secret), REDACTED, input);
    for (const ordinary of ['Visit https://www.wikipedia.org', 'api.example.com is down', 'svc-user', 'user', 'Contact: example.com', 'v1']) {
      assert.equal(redaction.value(ordinary), ordinary, `${input}: ${ordinary}`);
    }
  }
});

test('authentication literal scaffolding does not remember a URL host during script inspection', () => {
  const redaction = new CredentialRedactor();
  redaction.inspect([{ id: 1, name: 'URL', steps: [
    { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$input', value: `"${before}"` } },
    { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$address', value: '"https://svc-user:" & $input & "@example.test/"' } },
  ] }]);
  assert.equal(redaction.value(before), REDACTED);
  for (const ordinary of ['svc-user', 'example.test', '@example.test/']) assert.equal(redaction.value(ordinary), ordinary);
});

test('ordinary messages and dictionary-like fragments remain visible', () => {
  const redaction = new CredentialRedactor();
  for (const secret of ['https://svc-user:Zz91qq@api.example.com/v1', 'Bearer abcdEFGH1234', 'password2026', 'Summer2026!', before]) redaction.remember(secret);
  for (const ordinary of ['Visit https://www.wikipedia.org', 'Invoice 1234', 'Fiscal year 2026', 'Summer sale', 'Order 4N8k shipped to https://example.com', 'abcd', 'mmer']) {
    assert.equal(redaction.value(ordinary), ordinary);
  }
  for (const secret of ['1234', '2026', '4N8k', 'abcde', 'copied: Summer2026!']) assert.equal(redaction.value(secret), REDACTED);
});

test('four-character fragments require a secret at least eight characters long', () => {
  for (const secret of ['Q7v9', 'Q7v9z', 'Q7v9z2', 'Q7v9z2L', 'Q7v9z2Lm']) {
    const redaction = new CredentialRedactor();
    redaction.remember(secret);
    assert.equal(redaction.value(secret), REDACTED);
    assert.equal(redaction.value(`copied: ${secret}`), REDACTED);
    const fragment = secret.slice(1, 5);
    assert.equal(redaction.value(fragment), secret.length >= 8 ? REDACTED : fragment);
  }
});

test('remember hashes and retains only the first 4 KiB of a value', () => {
  const redaction = new CredentialRedactor();
  const prefix = 'Q7v9'.repeat(1024);
  redaction.remember(`${prefix}${after.repeat(10_000)}`);
  assert.equal(redaction.value(prefix), REDACTED);
  assert.equal(redaction.value(after), after, 'the suffix is outside the remembered prefix');
  const unicode = new CredentialRedactor();
  unicode.remember(`${'é'.repeat(2048)}${after}`);
  assert.equal(unicode.value(after), after, 'the prefix limit is in bytes');
});

test('remember fails closed at its run budget while credential names remain hidden', () => {
  const redaction = new CredentialRedactor();
  redaction.remember(before);
  for (let i = 0; i < 20_000; i++) redaction.remember(`Z${i.toString(16).padStart(8, '0')}m3`);
  redaction.remember(after);
  assert.equal(redaction.value(before), REDACTED, 'earlier entries survive saturation');
  assert.equal(redaction.value(after), REDACTED, 'unknown values are hidden once the budget is exhausted');
  assert.equal(redaction.text(`upstream echoed ${after}`), REDACTED, 'prose also fails closed when learning is exhausted');
  assert.equal(redaction.value(after, '$password'), REDACTED, 'name redaction does not depend on the budget');
  const nextRun = new CredentialRedactor();
  nextRun.remember(after);
  assert.equal(nextRun.value(after), REDACTED, 'the budget is local to a run');
});

for (const name of ['$db_pwd', '$userPwd', '$pw', '$pass', '$passcode', '$token', '$jwt', '$session_token', '$id_token', '$access_key', '$pass_word', '$pass-phrase', '$smtp-user-name', '$mail user', '$signing_key']) {
  test(`diagnostics redact credential alias ${name}`, () => {
    const redaction = new CredentialRedactor();
    assert.equal(isCredentialName(name), true);
    assert.equal(isCredentialLabelName(name), true);
    assert.equal(isCredentialParameterName(name), true);
    assert.equal(redaction.value(before, name), REDACTED);
    assert.equal(redaction.value(before, '$copy'), REDACTED);
  });
}

test('known secret fragments of at least four characters are redacted', () => {
  const redaction = new CredentialRedactor();
  redaction.remember(before);
  for (const value of [before.slice(0, 12), before.slice(3, 7), before.slice(-4), `copied: ${before}`]) {
    assert.equal(redaction.value(value), REDACTED);
  }
  assert.equal(redaction.value(before.slice(0, 3)), before.slice(0, 3));
  assert.equal(redaction.value('ordinary'), 'ordinary');
});

test('data discovers nested repetitions before aliases while preserving fragment and short-value policies', () => {
  const redaction = new CredentialRedactor();
  const input = { Copy: [before, before.slice(3, 7)], Nested: { Password: [before, 'a'] }, Note: 'ordinary', Count: 42, Blank: null, Enabled: true };
  assert.deepEqual(redaction.data(input), {
    Copy: [REDACTED, REDACTED], Nested: { Password: [REDACTED, REDACTED] }, Note: 'ordinary', Count: 42, Blank: null, Enabled: true,
  });
  assert.equal(input.Nested.Password[0], before, 'redaction does not mutate the source');
  assert.deepEqual(new CredentialRedactor().data([before, null], 'Password'), [REDACTED, null], 'the optional root name still applies to repetitions');
});

for (const [authority, fragment] of [
  ['user:Q7v9?Lm4%2B', 'Q7v9?Lm4+'],
  ['user:Q7v9#Lm4%2B', 'Q7v9#Lm4+'],
  ['user:part:Q7v9%2B', 'Q7v9+'],
  ['Q7v9%2B:part:tail', 'Q7v9+'],
]) test(`URL diagnostics hide decoded fragments of ambiguous userinfo ${authority}`, () => {
  const redaction = new CredentialRedactor();
  const url = `https://${authority}@example.test/`;
  assert.equal(redaction.value(url), REDACTED);
  redaction.remember(url);
  assert.equal(redaction.value(`Could not find ${fragment}`), REDACTED);
  assert.equal(redaction.value('ordinary'), 'ordinary');
});

test('SQL credential column names taint expressions, as do field reads', () => {
  const redaction = new CredentialRedactor();
  assert.equal(redaction.sensitiveExpression('Left ( ExecuteSQL ( "SELECT Password FROM T" ; "" ; "" ) ; 8 )'), true);
  assert.equal(redaction.sensitiveExpression('Left ( Password ; 8 )'), true);
  assert.equal(redaction.sensitiveExpression('Length ( GetField ( "Password" ) )'), true);
  assert.equal(redaction.sensitiveExpression('"password=abc"'), true);
});

test('SQL credential result detection includes stitched query text and SELECT * but excludes COUNT(*)', () => {
  for (const query of ['SELECT Password FROM T', 'SELECT * FROM T']) assert.equal(sqlMayReadSecret(query), true, query);
  for (const query of ['SELECT Note FROM T', 'SELECT COUNT(*) FROM T']) assert.equal(sqlMayReadSecret(query), false, query);
});

test('complete secrets are redacted inside messages while incidental partial overlaps remain visible', () => {
  const redaction = new CredentialRedactor();
  redaction.remember(before);
  for (const delimiter of ['|', ',', ';', '\t', '\n', '\r', '\r\n']) {
    for (const length of [4, 8, before.length]) {
      for (const suffix of ['', `${delimiter}ordinary`, '-tail']) {
        const value = `1${delimiter}0${delimiter}${before.slice(0, length)}${suffix}`;
        assert.equal(redaction.value(value), length === before.length ? REDACTED : value, JSON.stringify(value));
      }
    }
    const short = `1${delimiter}${before.slice(0, 3)}`;
    assert.equal(redaction.value(short), short);
  }
  assert.equal(redaction.value(`${before.slice(0, 4)}-tail`), `${before.slice(0, 4)}-tail`);
  assert.equal(redaction.value('1|0|ordinary'), '1|0|ordinary');
  assert.equal(redaction.value(`ordinary${before.slice(0, 4)}`), `ordinary${before.slice(0, 4)}`);
});

test('whole-value fragments match any position within a secret and ignore case', () => {
  const redaction = new CredentialRedactor();
  redaction.remember(before);
  for (let start = 0; start <= before.length - 4; start++) {
    for (let length = 4; length <= before.length - start; length++) {
      const fragment = before.slice(start, start + length);
      for (const variant of [fragment, fragment.toLowerCase(), fragment.toUpperCase()]) {
        for (const prefix of ['', 'x', ' ', '=', '1~0~', '10', 'ordinary']) {
          for (const suffix of ['', '-tail']) {
            const value = `${prefix}${variant}${suffix}`;
            const hide = (!prefix && !suffix) || fragment === before;
            assert.equal(redaction.value(value), hide ? REDACTED : value, JSON.stringify(value));
          }
        }
      }
    }
  }
  for (const value of ['ordinary', '1~0~ordinary', '10ordinary-tail', `x${before.slice(3, 6)}-tail`]) {
    assert.equal(redaction.value(value), value);
  }
  const later = 'B6n3K8r2V4x9T1m5';
  assert.equal(redaction.value(later.slice(4, 8).toUpperCase()), later.slice(4, 8).toUpperCase());
  redaction.remember(later);
  assert.equal(redaction.value(later.slice(4, 8).toUpperCase()), REDACTED);
});

test('script literal provenance cannot override secret names, full secrets or suppressed sources', () => {
  const redaction = new CredentialRedactor();
  redaction.remember(before);
  for (const value of [before.slice(0, 8), `x${before.slice(4, 8).toUpperCase()}-tail`]) {
    assert.equal(redaction.value(value, '$note', false, true), value);
  }
  for (const value of [before, `copied: ${before}`, before.toUpperCase(), `copied: ${before.toLowerCase()}`]) {
    assert.equal(redaction.value(value, '$note', false, true), REDACTED);
  }
  assert.equal(redaction.value(before.slice(0, 8), '$note', true, true), REDACTED);
  assert.equal(redaction.value(before.slice(0, 8), '$password', false, true), REDACTED);
});

test('short known secrets match whole values without hiding unrelated fragments', () => {
  const redaction = new CredentialRedactor();
  redaction.remember('Q7v');
  assert.equal(redaction.value('q7V'), REDACTED);
  assert.equal(redaction.value('xQ7v-tail'), 'xQ7v-tail');
  assert.equal(redaction.value('ordinary'), 'ordinary');
});

test('many known secrets and long ordinary values use a bounded scan', () => {
  const redaction = new CredentialRedactor();
  const started = Date.now();
  for (let i = 0; i < 1_000; i++) redaction.remember(`${before}${i.toString(16).padStart(8, '0')}`);
  const ordinary = 'ordinary '.repeat(100_000);
  assert.equal(redaction.value(ordinary), ordinary);
  assert.equal(redaction.value(`${ordinary}x${before.toUpperCase()}00000000-tail`), REDACTED);
  assert.equal(redaction.value(ordinary, undefined, false, true), ordinary);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test('prefix hash collisions keep unrelated text visible and both complete secrets hidden', () => {
  const redaction = new CredentialRedactor();
  // These distinct four-character strings have the same base-257 rolling hash.
  redaction.remember('abcy');
  assert.equal(redaction.value('xabbź-tail'), 'xabbź-tail');
  assert.equal(redaction.value('xABCY-tail'), REDACTED);
  redaction.remember('abbź');
  assert.equal(redaction.value('xABBŹ-tail'), REDACTED);
  assert.equal(redaction.value('xABCY-tail'), REDACTED);
});

test('decoded authentication inputs contribute case-insensitive fragments', () => {
  const redaction = new CredentialRedactor();
  const encoded = [...before].map((c) => `%${c.charCodeAt(0).toString(16)}`).join('');
  redaction.remember(`https://user:${encoded}@example.test/`);
  assert.equal(redaction.value(before.slice(4, 8).toUpperCase()), REDACTED);
  assert.equal(redaction.value('ordinary'), 'ordinary');
});

test('literal classification survives script-text round trips with local, global and calculated repetition parameters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-literal-roundtrip-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  try {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Note' }] }]);
    const redaction = new CredentialRedactor();
    for (const variable of ['$note', '$$note', '$note[1 + 1]']) {
      for (const formula of ['"Temporary"', '( "Temporary" )', '/* ordinary */ "Temporary"', '"Tempor\\"ary"']) {
        const parsed = parseScriptText(`Set Variable [ ${variable} ; Value: ${formula} ]`, store.schema);
        const printed = scriptText(parsed.map((s) => ({ ...s, stepId: s.stepId!, name: 'Set Variable', enabled: s.enabled ?? true })));
        const roundTrip = parseScriptText(printed, store.schema);
        assert.deepEqual(roundTrip, parsed);
        assert.equal(redaction.literalExpression(roundTrip[0].params!.value!), true, printed);
      }
    }
    for (const formula of ['T::Note', '$note', 'Get ( ScriptParameter )', 'Left ( "Temporary" ; 9 )', 'ExecuteSQL ( "SELECT Note FROM T" ; "" ; "" )', '"password=abc"', '"unterminated']) {
      assert.equal(redaction.literalExpression(formula), false, formula);
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const name of ['$authorization_status', '$bearerCount']) test(`embedded credential detection allows ${name} and test runs execute it`, async () => {
  assert.equal(embeddedCredential({ steps: [{ stepId: 141, name: 'Set Variable', enabled: true, params: { variable: name, value: '"ready"' } }] }), undefined);
  assert.equal(new CredentialRedactor().value('ready', name), REDACTED, 'diagnostics keep the broader policy');
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-credential-names-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  try {
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Note' }] },
      { op: 'createScript', name: 'Status', text: `Set Variable [ ${name} ; Value: "ready" ]\nExit Script [ Text Result: "done" ]` },
    ]);
    const [run] = await testScripts(store, { scripts: ['Status'] });
    assert.equal(run.outcome, 'ok');
    assert.equal(run.steps, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnostics share all credential aliases with the embedded credential detector', () => {
  for (const name of ['pwd', 'private_key', 'PrivateKey', 'SenderUserName', 'smtp_user', 'api-key', 'refresh_token', 'authorization', 'pass_word', 'pass-phrase', 'smtp-user-name', 'mail user', 'signing_key']) {
    const redaction = new CredentialRedactor();
    assert.equal(redaction.value(before), before, 'the canary cannot trigger the value detector');
    assert.equal(isCredentialName(name), true, name);
    assert.ok(embeddedCredential({ steps: [{ stepId: 141, name: 'Set Variable', enabled: true, params: { variable: `$${name}`, value: `"${before}"` } }] }), name);
    assert.equal(redaction.value(before, `$${name}`), REDACTED, name);
  }
  assert.equal(new CredentialRedactor().value('ordinary', '$count'), 'ordinary');
});

test('localized credential names share runtime and embedded credential detection', () => {
  for (const name of ['contraseña', 'contrasena', 'senha', "parola d'ordine", 'parola d’ordine', 'parola_d_ordine', 'parola-d-ordine', 'mot de passe', 'mot_de_passe', 'mot-de-passe', 'passwort', 'kennwort']) {
    for (const variant of [name, name.toUpperCase()]) {
      const redaction = new CredentialRedactor();
      assert.equal(isCredentialName(variant), true, variant);
      assert.equal(isCredentialLabelName(variant), true, variant);
      assert.equal(isCredentialParameterName(variant), true, variant);
      assert.ok(embeddedCredential({ steps: [{ stepId: 141, name: 'Set Variable', enabled: true, params: { variable: `$${variant}`, value: `"${before}"` } }] }), variant);
      assert.equal(redaction.value(before, `T::${variant}`), REDACTED, variant);
      assert.equal(redaction.value(before, '$copy'), REDACTED, variant);
    }
  }
  assert.equal(isCredentialName('customer_name'), false);
});

test('constructed authentication inputs propagate sensitivity before diagnostics are emitted', () => {
  const redaction = new CredentialRedactor();
  const steps = [
    { stepId: 141, name: 'Set Variable', enabled: true, line: `Set Variable [ $input ; Value: "${before}" ]`, params: { variable: '$input', value: `"${before}"` } },
    { stepId: 141, name: 'Set Variable', enabled: true, params: { variable: '$address', value: '"https://user:" & $input & "@example.test/"' } },
    { stepId: 160, name: 'Insert from URL', enabled: true, params: { calculation: '$address' } },
  ];
  assert.equal(redaction.value(before), before);
  redaction.inspect([{ id: 1, name: 'Constructed', steps }]);
  assert.equal(redaction.sensitiveName('$input'), true);
  assert.equal(redaction.sensitiveName('$address'), true);
  assert.equal(redaction.line(steps[0]), `Set Variable [ ${REDACTED} ]`);
});

test('recordRun redacts committed credential changes and copies before clipping, preserving ordinary changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-record-redaction-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  try {
    const long = 'Z2m8N4v6R1k9T3x7'.repeat(180);
    assert.equal(new CredentialRedactor().value(long), long);
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Copy' }, { name: 'Password' }, { name: 'private_key' }, { name: 'Note' }] },
      { op: 'createScript', name: 'Update', text: [
        'Set Field [ T::Copy ; T::Password ]',
        `Set Field [ T::Password ; "${after}" ]`,
        'Set Field [ T::private_key ; "D4k8R2v6M9x1N3b7" ]',
        'Set Field [ T::Note ; "updated" ]',
        'Commit Records/Requests [ With dialog: Off ]',
        'Set Field [ T::Password ; "F5m2V8n6R4x9K1b3" ]',
        'Commit Records/Requests [ With dialog: Off ]',
      ].join('\n') },
    ]);
    const row = store.create('T', { Password: before, private_key: long, Note: 'original' });
    const recording = await recordRun(store, 'Update', { layout: 'T', recordId: Number(row.recordId), account: 'Admin', privileges: store.privileges('Admin') });
    assert.equal(recording.done.error, 0);
    const fields = recording.steps.flatMap((s) => s.changes ?? []).flatMap((c) => c.fields);
    assert.equal(fields.filter((f) => f.field === 'Password').length, 2, 'both commits remain visible');
    for (const field of fields.filter((f) => ['Password', 'private_key'].includes(f.field))) {
      assert.equal(field.before, REDACTED);
      assert.equal(field.after, REDACTED);
    }
    assert.equal(fields.find((f) => f.field === 'Copy')!.after, REDACTED);
    assert.deepEqual(fields.find((f) => f.field === 'Note'), { field: 'Note', before: 'original', after: 'updated' });
    assert.ok(recording.steps.flatMap((s) => s.edits ?? []).some((e) => e.field === 'Password' && e.value === REDACTED));
    for (const canary of [before, after, long.slice(0, 40), 'D4k8R2v6M9x1N3b7', 'F5m2V8n6R4x9K1b3']) assert.ok(!JSON.stringify(recording).includes(canary));
    assert.equal(store.get('T', Number(row.recordId)).fieldData.Password, 'F5m2V8n6R4x9K1b3', 'execution uses the actual values');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordRun revisits variable snapshots with secrets learned from the audit before clipping', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-record-snapshots-'));
  const path = join(dir, 'Local.sqlite');
  createStore(path);
  const store = new Store(path, 'Local');
  const long = 'Z2m8N4v6R1k9T3x7'.repeat(40);
  try {
    store.applyDesign([
      { op: 'createTable', name: 'T', fields: [{ name: 'Copy' }, { name: 'Password' }, { name: 'LongCopy' }, { name: 'private_key' }] },
      { op: 'createScript', name: 'Snapshot', text: [
        'Set Variable [ $x ; Value: T::Copy ]',
        'Set Variable [ $$y ; Value: T::LongCopy ]',
        'Set Variable [ $note ; Value: "ordinary" ]',
        `Set Field [ T::Password ; "${after}" ]`,
        'Set Field [ T::private_key ; "D4k8R2v6M9x1N3b7" ]',
        'Commit Records/Requests [ With dialog: Off ]',
      ].join('\n') },
    ]);
    const row = store.create('T', { Copy: before, Password: before, LongCopy: long, private_key: long });
    const recording = await recordRun(store, 'Snapshot', { layout: 'T', recordId: Number(row.recordId) });
    assert.equal(recording.done.error, 0);
    const snapshots = recording.steps.flatMap((s) => s.variables ? [s.variables] : []);
    assert.ok(snapshots.some((v) => v.locals.$x === REDACTED));
    assert.ok(snapshots.some((v) => v.globals.$$y === REDACTED));
    assert.ok(snapshots.some((v) => v.locals.$note === 'ordinary'));
    for (const canary of [before, long.slice(0, 40)]) assert.ok(!JSON.stringify(recording).includes(canary));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a long run of white space in a diagnostic value is checked in linear time', () => {
  const redaction = new CredentialRedactor();
  // The name check used to try every split of the white space around an optional quote: 200,000 spaces took about 40 seconds.
  const value = `a${' '.repeat(200_000)}z`;
  const started = Date.now();
  assert.equal(redaction.value(value, '$note'), value);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

const cases = {
  'T1: URL prefix split across Let bindings': 'Let ( [ a = "https://us" ; b = "er:" ] ; a & b & $alias & "@example.test/" )',
  'T2: Authorization header inside Let': 'Let ( h = "Author" & "ization: Basic " ; h & $alias )',
  'T3: prefix assigned to a global inside Let': '$$p & $alias & "@example.test/"',
  'T4: URL prefix built by unsupported functions': 'Substitute ( "https://userX" ; "X" ; Char ( 58 ) ) & $alias & "@example.test/"',
};

for (const [name, formula] of Object.entries(cases)) test(`${name} hides inputs in traces and debugger variables before use`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openhbam-credential-diagnostics-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  const debugger_ = new ScriptDebugger({ pauseAtStart: true });
  const component = 'component-Q7F93x';
  try {
    store.applyDesign([{ op: 'createScript', name: 'Credentials', text: [
      'Set Variable [ $public ; Value: "ordinary-visible" ]',
      `Set Variable [ $input ; Value: "${component}" ]`,
      'Set Variable [ $alias ; Value: $input ]',
      ...(name.startsWith('T3:') ? ['Set Variable [ $unused ; Value: Let ( [ a = "https://us" ; b = "er:" ] ; Let ( $$p = a & b ; "" ) ) ]'] : []),
      `Set Variable [ $built ; Value: ${formula} ]`,
      'Exit Script [ Result: $built ]',
    ].join('\n') }]);
    const profile = new RunProfile();
    const states = [await debugger_.start(store, 'Credentials', { trace: true, profile })];
    while (debugger_.running) states.push(await debugger_.resume('into'));
    const done = states.at(-1)!.done!;
    assert.equal(done.error, 0);
    assert.equal(done.result, name.startsWith('T2:') ? `Authorization: Basic ${component}` : `https://user:${component}@example.test/`);
    for (const variable of ['$input', '$alias']) {
      const visible = states.flatMap((s) => s.paused && Object.hasOwn(s.paused.variables.locals, variable) ? [s.paused.variables.locals[variable]] : []);
      assert.ok(visible.length > 0, `${variable} was inspected`);
      assert.ok(visible.every((value) => value === REDACTED), `${variable} is hidden at every stop, including before credential construction`);
    }
    const diagnostics = JSON.stringify([states.map((s) => s.paused), done.trace, profile.report()]);
    assert.ok(!diagnostics.includes(component), 'no earlier trace line or debugger snapshot leaks the input');
    assert.ok(diagnostics.includes('ordinary-visible'), 'unrelated values remain visible');
  } finally {
    if (debugger_.state().paused) await debugger_.resume('halt');
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a secret that sits in a URL path or a bare flag is kept whole', () => {
  for (const input of ['https://hooks.example.test/services/T000/B000/XXXXXXXXXXXX', 'p@ss://word1', 'tool -u only-a-name']) {
    for (const learn of ['remember', 'rememberSql'] as const) {
      const redaction = new CredentialRedactor();
      redaction[learn](input);
      assert.equal(redaction.value(input), REDACTED, `${learn}: ${input}`);
    }
  }
});

test('credential names need the whole word for short ones such as ssn, iban, cvv and otp', () => {
  for (const name of ['$businessName', '$classNames', '$footprint', '$hotpot', 'Potpourri']) assert.equal(isCredentialName(name), false, name);
  for (const name of ['$ssn', 'IBAN_Number', '$userIban', 'cvv', 'otp_code']) assert.equal(isCredentialName(name), true, name);
});

test('SQL results learn into their own budget and a full budget hides every later value', () => {
  const cells = Array.from({ length: 400 }, (_, i) => `cell-${i}-${'x'.repeat(40)}`);
  const sql = new CredentialRedactor();
  for (const cell of cells) sql.rememberSql(cell);
  assert.equal(sql.value('an ordinary later value'), REDACTED);
  assert.equal(sql.text(`upstream echoed ${after}`), REDACTED, 'SQL saturation also closes prose output');
  const fields = new CredentialRedactor();
  for (const cell of cells) fields.remember(cell);
  assert.equal(fields.value('an ordinary later value'), 'an ordinary later value');
  assert.equal(fields.value(cells[0]!), REDACTED);
});

test('environment-style names and cookie headers are masked', () => {
  for (const text of [`PGPASSWORD=${before}`, `adminpassword=${before}`, `MYSQL_PWD=${before}`, `Cookie: sid=${before}; theme=dark`, `Set-Cookie: sid=${before}; Path=/; HttpOnly`]) {
    const safe = redactDiagnosticText(`failed: ${text}`);
    assert.ok(!safe.includes(before), text);
    assert.ok(safe.startsWith('failed: '), text);
  }
  assert.equal(redactDiagnosticText('compass=north secretary=Ann'), 'compass=north secretary=Ann', 'a name that only contains a short credential word is not one');
  assert.equal(isCredentialLabelName('PGPASSWORD'), true);
  assert.equal(isCredentialLabelName('adminpassword'), true);
});
