import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { CredentialRedactor, REDACTED, hasUrlAuth } from '../src/redaction.ts';
import { emptySchema, parseScriptText } from '@tabularius/store';
import { scriptStepName } from '@tabularius/fmp12';
import { RunProfile, runScript } from '../src/index.ts';

test('round2: encoded Unicode wrapper secrets stay hidden while URL hosts stay public', () => {
  for (const value of ['Élan-42🦊Z', 'Жук-94🐟Q', 'q7:ab?cd#ef']) {
    const redactor = new CredentialRedactor();
    redactor.remember(`https://svc:${encodeURIComponent(value)}@example.test/resource`);
    assert.equal(redactor.value(`failure: ${value}`), REDACTED);
    assert.equal(redactor.value(value.toUpperCase()), REDACTED);
    assert.equal(redactor.value('example.test'), 'example.test');
    assert.equal(redactor.value('ordinary diagnostic'), 'ordinary diagnostic');
  }
});

test('round2: taint crosses repetitions and Let bindings into logs, traces, profiles and error text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-review-taint-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  const secret = 'Élan-47🦊Qx';
  try {
    store.applyDesign([{ op: 'createScript', name: 'Review', text: [
      'Set Error Capture [ On ]',
      'Set Error Logging [ On ]',
      'Set Variable [ $entrée[2] ; Value: Get ( ScriptParameter ) ]',
      'Set Variable [ $$alias ; Value: Let ( [ local = $entrée[2] ; nested = local ] ; nested ) ]',
      'Set Variable [ $address ; Value: "https://svc:" & $$alias & "@example.test/" ]',
      'Go to Layout [ Layout Name: $$alias ]',
      'Exit Script [ Result: $$alias ]',
    ].join('\n') }]);
    const profile = new RunProfile();
    const debug: unknown[] = [];
    const result = await runScript(store, 'Review', { parameter: secret, trace: true, profile, documents: dir,
      debug: async (point) => { debug.push({ vars: point.variables(), watch: point.evaluate('$entrée[2]'), previous: point.previousError }); },
    });
    assert.equal(result.result, secret);
    assert.ok(result.trace!.some((step) => step.error === 105));
    const diagnostics = JSON.stringify([debug, result.trace, profile.report(), readFileSync(join(dir, 'ScriptErrors.log'), 'utf8')]);
    assert.ok(!diagnostics.includes(secret));
    assert.ok(!diagnostics.includes(encodeURIComponent(secret)));
    assert.equal(new CredentialRedactor().value(secret), secret, 'one run cannot taint another');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('round2: independent SQL and field budgets fail closed for subsequent Unicode diagnostics', () => {
  for (const method of ['remember', 'rememberSql'] as const) {
    const redactor = new CredentialRedactor();
    for (let i = 0; i < 2500; i++) redactor[method](`sample-${i}-` + '🦊'.repeat(100));
    assert.equal(redactor.value('unseen-Жук-Q49'), REDACTED);
  }
});

test('round2: URL scan handles mixed invalid schemes and Unicode separators at scale', () => {
  const prefix = '123://:🦊\u2028'.repeat(20_000);
  const start = performance.now();
  assert.equal(hasUrlAuth(prefix), false);
  assert.equal(hasUrlAuth(prefix + 'https://u:p@host.test'), true);
  assert.equal(hasUrlAuth(prefix + 'https://u@host.test', true), true);
  assert.ok(performance.now() - start < 3000, 'generous bound for the generated scan');
});

test('round2: MBS AWS credential arguments propagate through Unicode Let aliases', () => {
  const source = 'Set Variable [ $entrée ; Value: "Élan-47🦊Qx" ]\nSet Variable [ $h ; Value: MBS ( "CURL.SetupAWS" ; 1 ; Let ( k = $entrée ; k ) ; $entrée ) ]';
  const redactor = new CredentialRedactor();
  redactor.inspect([{ id: 1, name: 'Synthetic', steps: parseScriptText(source, emptySchema()).map((step) => ({ stepId: step.stepId!, name: scriptStepName(step.stepId!), enabled: true, params: step.params })) }]);
  assert.equal(redactor.sensitiveName('$entrée'), true);
  assert.equal(redactor.value('Élan-47🦊Qx', '$entrée'), REDACTED);
});
