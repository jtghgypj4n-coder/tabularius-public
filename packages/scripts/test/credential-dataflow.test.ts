import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, emptySchema, parseScriptText, Store } from '@tabularius/store';
import { scriptStepName, scriptText, type Script } from '@tabularius/fmp12';
import { CredentialRedactor, REDACTED, RunProfile, runScript } from '../src/index.ts';

const script = (source: string, schema = emptySchema()): Script => ({ id: 9999, name: 'Dataflow', steps: parseScriptText(source, schema).map((s, i) => ({
  stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled !== false, params: s.params, line: source.split('\n')[i],
})) });
const component = 'component-Q7F93x';
const cases = {
  'URL userinfo with an unknown host suffix': 'Set Variable [ $built ; Value: "https://user:" & $alias & $host ]',
  'URL assembled through prefix variables': 'Set Variable [ $scheme ; Value: "ht" & "tps://" ]\nSet Variable [ $prefix ; Value: $scheme & "user:" ]\nSet Variable [ $built ; Value: $prefix & $alias & "@example.test/" ]',
  'URL assembled by reassignment': 'Set Variable [ $built ; Value: "https://user:" ]\nSet Variable [ $built ; Value: $built & $alias ]\nSet Variable [ $built ; Value: $built & "@example.test/" ]',
  'URL assembled inside a calculation': 'Set Variable [ $built ; Value: Let ( p = "https://user:" ; p & $alias & $host ) ]',
  'username-only URL userinfo': 'Set Variable [ $built ; Value: "https://" & $alias & "@example.test/" ]',
  'Authorization header assembled through variables': 'Set Variable [ $label ; Value: "Author" ]\nSet Variable [ $prefix ; Value: $label & "ization: Basic " ]\nSet Variable [ $built ; Value: $prefix & $alias ]',
  'long cURL user argument': 'Set Variable [ $prefix ; Value: "--us" ]\nSet Variable [ $built ; Value: $prefix & "er user:" & $alias ]',
  'short cURL user argument': 'Set Variable [ $prefix ; Value: "-" ]\nSet Variable [ $built ; Value: $prefix & "u user:" & $alias ]',
  'password parameter': 'Set Variable [ $built ; Value: "prefix-" & $alias ]\nAdd Account [ Account Name: "Unused" ; Password: $built ; Privilege Set: "Missing" ]',
  'T1: URL prefix split across Let bindings': 'Set Variable [ $built ; Value: Let ( [ a = "https://us" ; b = "er:" ] ; a & b & $alias & "@example.test/" ) ]',
  'T2: Authorization header inside Let': 'Set Variable [ $built ; Value: Let ( h = "Author" & "ization: Basic " ; h & $alias ) ]',
  'T3: prefix assigned to a global inside Let': 'Set Variable [ $unused ; Value: Let ( [ a = "https://us" ; b = "er:" ] ; Let ( $$p = a & b ; "" ) ) ]\nSet Variable [ $built ; Value: $$p & $alias & "@example.test/" ]',
  'copy through Set Field By Name with a literal field name': 'Set Field By Name [ "T::Other" ; $alias ]\nSet Variable [ $built ; Value: "https://user:" & T::Other & "@example.test/" ]',
  'T4: URL prefix built by unsupported functions': 'Set Variable [ $prefix ; Value: Substitute ( "https://userX" ; "X" ; Char ( 58 ) ) ]\nSet Variable [ $built ; Value: $prefix & $alias & "@example.test/" ]',
};

for (const [name, build] of Object.entries(cases)) test(`credential inputs are hidden before execution: ${name}`, () => {
  const s = script(`Set Variable [ $input ; Value: "${component}" ]\nSet Variable [ $alias ; Value: $input ]\n${build}`);
  const redactor = new CredentialRedactor();
  redactor.inspect([s]);
  assert.equal(redactor.value(component, '$input'), REDACTED);
  assert.equal(redactor.value(component, '$ALIAS'), REDACTED);
  assert.ok(!JSON.stringify(s.steps.map((step) => redactor.line(step))).includes(component));
  assert.equal(redactor.error(`Could not find ${component}`, script('Go to Layout [ Layout Name: "Missing" ]').steps[0]), 'Credential step failed');
  const roundTrip = script(scriptText(s.steps));
  assert.deepEqual(roundTrip.steps.map((s) => s.params), s.steps.map((s) => s.params));
  const readBack = new CredentialRedactor();
  readBack.inspect([roundTrip]);
  assert.equal(readBack.value(component, '$input'), REDACTED);
});

test('split credentials hide runtime inputs, aliases, watches, profiles and earlier trace lines without changing results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dataflow-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  try {
    for (const [name, build] of Object.entries(cases)) {
      const s = script(`Set Error Capture [ On ]\nSet Variable [ $public ; Value: "ordinary-visible" ]\nSet Variable [ $input ; Value: Get ( ScriptParameter ) ]\nSet Variable [ $alias ; Value: $input ]\n${build}\nSet Variable [ $copy ; Value: $input ]\nGo to Layout [ Layout Name: $copy ]\nExit Script [ Result: $input ]`);
      const profile = new RunProfile();
      const stops: unknown[] = [];
      const result = await runScript(store, s, { parameter: component, trace: true, profile,
        debug: async (point) => { stops.push({ line: point.line, variables: point.variables(), watch: point.evaluate('$input'), previous: point.previousError }); },
      });
      assert.equal(result.result, component, name);
      assert.ok(result.trace!.some((line) => line.error === 105), name);
      const diagnostics = JSON.stringify([result.trace, stops, profile.report()]);
      assert.ok(!diagnostics.includes(component), name);
      assert.ok(!diagnostics.includes('ordinary-visible'), 'a credential from Get(ScriptParameter) taints every referenced input');
    }
    const stops: unknown[] = [];
    await runScript(store, script('Set Variable [ $input ; Value: Get ( ScriptParameter ) ]\nExit Script [ Result: $input ]'), {
      parameter: component, debug: async (point) => { stops.push(point.variables()); },
    });
    assert.ok(JSON.stringify(stops).includes(component), 'taint does not carry into another run');

    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Input', type: 'text' }] }]);
    const row = store.create('T', {});
    const fields: unknown[] = [];
    await runScript(store, script('Set Field [ T::Input ; Get ( ScriptParameter ) ]\nSet Variable [ $$alias ; Value: T::Input ]\nSet Variable [ $built ; Value: "https://user:" & $$alias & "@example.test/" ]', store.schema), {
      layout: 'T', foundSet: [row.recordId], parameter: component,
      debug: async (point) => { fields.push({ pending: point.pending(), variables: point.variables(), watch: point.evaluate('T::Input') }); },
    });
    assert.ok(!JSON.stringify(fields).includes(component), 'field inputs and global copies are hidden too');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('ordinary concatenated URLs and cycles keep public inputs visible', () => {
  const redactor = new CredentialRedactor();
  redactor.inspect([script('Set Variable [ $input ; Value: "ordinary-visible" ]\nSet Variable [ $url ; Value: "https://example.test:8080/path/" & $input ]\nSet Variable [ $counter ; Value: $counter + 1 ]')]);
  assert.equal(redactor.value('ordinary-visible', '$input'), 'ordinary-visible');
});

test('a username-only credential URL also hides decoded fragments quoted by an error', () => {
  const redactor = new CredentialRedactor();
  redactor.inspect([script(`Set Variable [ $url ; Value: "https://${component}%2B@host.test/" ]`)]);
  assert.equal(redactor.value(`Could not find ${component}+`), REDACTED);
});

test('bounded expansion hides ambiguous inputs rather than leaking when there are many alternatives', () => {
  const alternatives = Array.from({ length: 65 }, (_, i) => `Set Variable [ $prefix ; Value: "part-${i}" ]`).join('\n');
  const redactor = new CredentialRedactor();
  redactor.inspect([script(`Set Variable [ $input ; Value: "${component}" ]\n${alternatives}\nSet Variable [ $built ; Value: $prefix & $input ]`)]);
  assert.equal(redactor.value(component, '$input'), REDACTED);
});

for (const position of ['URL', 'header', 'cURL options', 'password']) test(`unsupported calculations fail closed in a ${position} parameter, including field inputs`, () => {
  const formula = 'Substitute ( $alias & T::Input ; "X" ; Char ( 58 ) )';
  const sink: Script['steps'][number] = { stepId: 160, name: 'Insert from URL', enabled: true, params:
    position === 'URL' ? { calculation: formula }
      : position === 'header' ? { slots: { 129: '"--header " & ' + formula } }
        : position === 'cURL options' ? { slots: { 129: formula } }
          : { password: formula },
  };
  const s = script(`Set Variable [ $input ; Value: "${component}" ]\nSet Variable [ $alias ; Value: $input ]`);
  s.steps.push(sink);
  const redactor = new CredentialRedactor();
  redactor.inspect([s]);
  for (const name of ['$input', '$alias', 'Input']) {
    assert.ok(redactor.sensitiveName(name), `${name} is tainted independently of remembered values`);
    assert.equal(redactor.value(component, name), REDACTED, name);
  }
});

for (const target of ['$local', '$$global']) test(`Let assignments to ${target} propagate taint through local bindings outside Set Variable`, () => {
  const s = script(`Set Variable [ $input ; Value: "${component}" ]\nIf [ Let ( copied = $input ; Let ( ${target} = copied ; "" ) ) ]\nEnd If\nAdd Account [ Account Name: "Unused" ; Password: ${target} ; Privilege Set: "Missing" ]`);
  const redactor = new CredentialRedactor();
  redactor.inspect([s]);
  assert.equal(redactor.value(component, '$input'), REDACTED);
  assert.equal(redactor.value(component, target), REDACTED);
});

test('a tainted Let destination hides its assignment even for short literals', () => {
  const s = script('If [ Let ( $$g = "xy" ; "" ) ]\nEnd If\nAdd Account [ Account Name: "Unused" ; Password: $$g ; Privilege Set: "Missing" ]');
  const redactor = new CredentialRedactor();
  redactor.inspect([s]);
  assert.equal(redactor.line(s.steps[0]), `If [ ${REDACTED} ]`);
});

test('Let names stay local and supported public URLs remain visible', () => {
  const redactor = new CredentialRedactor();
  redactor.inspect([script('Set Variable [ $input ; Value: "ordinary-visible" ]\nSet Variable [ $url ; Value: Let ( prefix = "https://example.test/" ; prefix & $input ) ]\nSet Variable [ $built ; Value: Let ( prefix = "https://user:" ; prefix & $secret & "@example.test/" ) ]')]);
  assert.equal(redactor.value('ordinary-visible', '$input'), 'ordinary-visible');
  assert.equal(redactor.value('public-field', 'prefix'), 'public-field', 'a Let name must not taint an unrelated field');
});

const evaluatedURL = `Evaluate ( ${JSON.stringify('"https://user:" & $alias & "@example.test/"')} )`;
const dynamicCases: Record<string, { text: string; curl?: string }> = {
  'Evaluate directly in a URL': { text: `Insert from URL [ $r ; ${evaluatedURL} ]` },
  'Evaluate assigned before a URL': { text: `Set Variable [ $u ; Value: ${evaluatedURL} ]\nInsert from URL [ $r ; $u ]` },
  'Evaluate builds a variable name': { text: 'Set Variable [ $u ; Value: "https://user:" & Evaluate ( "$al" & "ias" ) & "@example.test/" ]\nInsert from URL [ $r ; $u ]' },
  'Evaluate in cURL options': { text: 'Insert from URL [ $r ; "https://example.test/" ]', curl: `Evaluate ( ${JSON.stringify('"--header \\"Authorization: Bearer " & $alias & "\\""')} )` },
  'Evaluate in a password through a copy': { text: 'Set Variable [ $u ; Value: Evaluate ( "$al" & "ias" ) ]\nSet Variable [ $copy ; Value: $u ]\nAdd Account [ Account Name: "Unused" ; Password: $copy ; Privilege Set: "Missing" ]' },
  'GetField builds a field name': { text: 'Insert from URL [ $r ; "https://user:" & GetField ( "T::In" & "put" ) & "@example.test/" ]' },
};

const opaqueCases: Record<string, { main: string; sub?: string; cf?: { name: string; parameters: string[]; formula: string } }> = {
  'P2 Evaluate inside a custom function': { main: 'Insert from URL [ $r ; "https://user:" & Peek ( "$alias" ) & "@example.test/" ]', cf: { name: 'Peek', parameters: ['n'], formula: 'Evaluate ( n )' } },
  'P3 GetField inside a custom function': { main: 'Insert from URL [ $r ; "https://user:" & Peek ( "T::Input" ) & "@example.test/" ]', cf: { name: 'Peek', parameters: ['n'], formula: 'GetField ( n )' } },
  'P4 ExecuteSQL builds a URL credential': { main: 'Insert from URL [ $r ; "https://user:" & ExecuteSQL ( "SELECT Input FROM T" ; "" ; "" ) & "@example.test/" ]' },
  'P5 ExecuteSQL reaches a credential through assignments': { main: 'Set Variable [ $k ; Value: ExecuteSQL ( "SELECT Input FROM T" ; "" ; "" ) ]\nSet Variable [ $hdr ; Value: "Authorization: Bearer " & $k ]' },
  'P6 GetField with a literal name': { main: 'Insert from URL [ $r ; "https://user:" & GetField ( "T::Input" ) & "@example.test/" ]' },
  'P7 a subscript uses its parameter in a URL': { main: 'Perform Script [ "Sub" ; Parameter: $alias ]', sub: 'Insert from URL [ $r ; "https://user:" & Get ( ScriptParameter ) & "@example.test/" ]' },
  'P8 a subscript copies its parameter into a password': { main: 'Perform Script [ "Sub" ; Parameter: $alias ]', sub: 'Set Variable [ $p ; Value: Get ( ScriptParameter ) ]\nAdd Account [ Account Name: "Unused" ; Password: $p ; Privilege Set: "Missing" ]' },
  'a subscript result becomes a URL credential': { main: 'Perform Script [ "Sub" ; Parameter: $alias ]\nInsert from URL [ $r ; "https://user:" & Get ( ScriptResult ) & "@example.test/" ]', sub: 'Exit Script [ Result: Get ( ScriptParameter ) ]' },
  'a custom function without parentheses': { main: 'Insert from URL [ $r ; "https://user:" & Peek & "@example.test/" ]', cf: { name: 'Peek', parameters: [], formula: 'GetField ( "T::Input" )' } },
};

for (const [name, build] of Object.entries(opaqueCases)) test(`opaque credential inputs fail closed: ${name}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-opaque-dataflow-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  try {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Input' }, { name: 'Other' }] }]);
    if (build.cf) store.applyDesign([{ op: 'createCustomFunction', ...build.cf }]);
    if (build.sub) store.applyDesign([{ op: 'createScript', name: 'Sub', text: build.sub }]);
    store.applyDesign([{ op: 'createScript', name: 'Main', text: [
      'Set Error Capture [ On ]',
      'Set Field [ T::Input ; Get ( ScriptParameter ) ]',
      'Set Variable [ $input ; Value: T::Input ]',
      'Set Variable [ $alias ; Value: $input ]',
      'Set Variable [ $$other ; Value: T::Other ]',
      build.main,
      'Go to Layout [ Layout Name: $input ]',
      'Exit Script [ Result: $input ]',
    ].join('\n') }]);
    const row = store.create('T', { Input: component, Other: 'independent-R4v6B9' });
    const main = store.schema.scripts.find((s) => s.name === 'Main')!;
    for (const s of store.schema.scripts) {
      const roundTrip = script(scriptText(s.steps), store.schema);
      assert.equal(scriptText(roundTrip.steps), scriptText(s.steps));
    }
    const redactor = new CredentialRedactor();
    redactor.inspect(store.schema.scripts, store.schema.customFunctions.map((cf) => cf.name));
    for (const ref of ['$input', '$ALIAS', '$$other', 'Input', 'Other']) assert.ok(redactor.sensitiveName(ref), `${ref} is tainted before execution`);
    for (const formula of ['Get ( ScriptParameter )', 'Get ( ScriptResult )']) assert.ok(redactor.sensitiveExpression(formula), `${formula} is tainted before execution`);
    const profile = new RunProfile();
    const stops: unknown[] = [];
    const result = await runScript(store, main, {
      layout: 'T', foundSet: [row.recordId], parameter: component, network: false, trace: true, profile,
      debug: async (point) => { stops.push({ script: point.script, line: point.line, variables: point.variables(), pending: point.pending(), input: point.evaluate('$input'), field: point.evaluate('T::Input'), parameter: point.evaluate('Get ( ScriptParameter )'), result: point.evaluate('Get ( ScriptResult )'), previous: point.previousError }); },
    });
    assert.equal(result.result, component, 'execution retains the actual input');
    assert.ok(result.trace!.some((line) => line.error === 105));
    const diagnostics = JSON.stringify([result.trace, stops, profile.report()]);
    for (const value of [component, 'independent-R4v6B9']) assert.ok(!diagnostics.includes(value), 'opaque credentials taint every referenced input');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

for (const formula of [
  'Peek ( "indirect" )', 'eXeCuTeSqLe ( "SELECT Input FROM T" ; "" ; "" )',
  'BE_FileMakerSQL ( "SELECT Input FROM T" )', 'Get ( ScriptParameter )', 'Get ( ScriptResult )',
  'Get ( ActiveFieldContents )', 'GetLayoutObjectAttribute ( "input" ; "content" )',
  'GetPersistentData ( "entry" )', 'MBS ( "Dictionary.GetValue" ; "entry" )',
  'Self',
]) test(`opaque credential policy covers ${formula}`, () => {
  const s = script(`Set Variable [ $other ; Value: T::Other ]\nSet Variable [ $source ; Value: ${formula} ]\nAdd Account [ Account Name: "Unused" ; Password: $source ; Privilege Set: "Missing" ]`);
  const redactor = new CredentialRedactor();
  redactor.inspect([s]);
  for (const ref of ['$other', 'Other', '$source']) assert.ok(redactor.sensitiveName(ref), ref);
  assert.ok(redactor.sensitiveExpression(formula));
  redactor.inspect([script('Set Variable [ $$later ; Value: T::Later ]')]);
  for (const ref of ['$$later', 'Later']) assert.ok(redactor.sensitiveName(ref), 'newly inspected scripts inherit opaque taint');
});

test('an opaque assignment to a credential-named variable taints the whole run', () => {
  const redactor = new CredentialRedactor();
  redactor.inspect([script('Set Variable [ $other ; Value: T::Other ]\nSet Variable [ $password ; Value: Peek ( "indirect" ) ]')]);
  for (const ref of ['$other', 'Other']) assert.ok(redactor.sensitiveName(ref), ref);
  assert.ok(redactor.sensitiveExpression('Get ( ScriptParameter )'));
});

test('opaque sources outside credential positions keep ordinary diagnostics visible', () => {
  const schema = emptySchema();
  schema.scripts.push({ id: 1, name: 'Sub', steps: [] });
  const redactor = new CredentialRedactor();
  redactor.inspect([script('Set Variable [ $input ; Value: "ordinary-visible" ]\nSet Variable [ $copy ; Value: Peek ( $input ) ]\nSet Variable [ $rows ; Value: ExecuteSQL ( "SELECT Input FROM T" ; "" ; "" ) ]\nPerform Script [ "Sub" ; Parameter: $input ]\nExit Script [ Result: Get ( ScriptResult ) ]', schema)]);
  for (const ref of ['$input', '$copy', '$rows']) assert.equal(redactor.sensitiveName(ref), false);
  for (const formula of ['Peek ( $input )', 'Get ( ScriptParameter )', 'Get ( ScriptResult )']) assert.equal(redactor.sensitiveExpression(formula), false);
  assert.equal(redactor.value('ordinary-visible', '$input'), 'ordinary-visible');
});

test('a tainted Perform Script argument hides the callee parameter before it is read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-parameter-dataflow-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  try {
    store.applyDesign([
      { op: 'createScript', name: 'Sub', text: 'Set Variable [ $note ; Value: "first stop" ]\nExit Script [ Result: "done" ]' },
      { op: 'createScript', name: 'Main', text: 'Perform Script [ "Sub" ; Parameter: $password ]\nPerform Script [ "Sub" ; Parameter: "ordinary-visible" ]\nExit Script [ Result: Get ( ScriptResult ) ]' },
    ]);
    const main = store.schema.scripts.find((s) => s.name === 'Main')!;
    // The caller's expression is already tainted without a Get() in the callee's text.
    const stops: unknown[] = [];
    const result = await runScript(store, main, {
      variables: { $password: component }, debug: async (point) => { if (point.script === 'Sub') stops.push(point.evaluate('Get ( ScriptParameter )')); },
    });
    assert.equal(result.result, 'done');
    assert.ok(stops.length > 0);
    assert.ok(stops.every((value) => (value as { value: string }).value === REDACTED), 'parameter sensitivity propagates even before a callee read');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
// cURL calculations are carried by decoded parameters, not the script-text format.
const withCurl = (s: Script, formula?: string): Script => {
  if (formula !== undefined) {
    const step = s.steps.find((step) => step.stepId === 160)!;
    step.params = { ...step.params, slots: { 129: formula } };
  }
  return s;
};

for (const [name, build] of Object.entries(dynamicCases)) test(`dynamic credential references taint the whole run: ${name}`, () => {
  const s = script(`Set Variable [ $input ; Value: "${component}" ]\nSet Variable [ $alias ; Value: $input ]\n${build.text}`);
  const other = script('Set Variable [ $$other ; Value: T::Input ]\nExit Script [ Result: $$other ]');
  const roundTrip = script(scriptText(s.steps));
  assert.deepEqual(roundTrip.steps.map((step) => step.params), s.steps.map((step) => step.params));
  for (const source of [s, roundTrip]) {
    const redactor = new CredentialRedactor();
    redactor.inspect([withCurl(source, build.curl), other]);
    for (const ref of ['$input', '$ALIAS', '$$other', 'Input']) {
      assert.ok(redactor.sensitiveName(ref), `${ref} is tainted before values are observed`);
      assert.equal(redactor.value(component, ref), REDACTED);
    }
    assert.ok(!JSON.stringify(source.steps.map((step) => redactor.line(step))).includes(component));
  }
});

test('dynamic credential inputs stay hidden in earlier traces, debugger snapshots, fields and profiles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dynamic-dataflow-'));
  createStore(join(dir, 'Local.sqlite'));
  const store = new Store(join(dir, 'Local.sqlite'), 'Local');
  try {
    store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Input', type: 'text' }] }]);
    const row = store.create('T', {});
    for (const [name, build] of Object.entries(dynamicCases)) {
      const s = withCurl(script(`Set Error Capture [ On ]\nSet Field [ T::Input ; Get ( ScriptParameter ) ]\nSet Variable [ $input ; Value: T::Input ]\nSet Variable [ $alias ; Value: $input ]\n${build.text}\nGo to Layout [ Layout Name: $input ]\nExit Script [ Result: $input ]`, store.schema), build.curl);
      const profile = new RunProfile();
      const stops: unknown[] = [];
      const result = await runScript(store, s, {
        layout: 'T', foundSet: [row.recordId], parameter: component, network: false, trace: true, profile,
        debug: async (point) => { stops.push({ line: point.line, variables: point.variables(), pending: point.pending(), watch: point.evaluate('$input'), field: point.evaluate('T::Input'), previous: point.previousError }); },
      });
      assert.equal(result.result, component, name);
      assert.ok(result.trace!.some((line) => line.error === 105), name);
      assert.ok(!JSON.stringify([result.trace, stops, profile.report()]).includes(component), name);
    }
    const stops: unknown[] = [];
    await runScript(store, script('Set Variable [ $input ; Value: Get ( ScriptParameter ) ]\nExit Script [ Result: $input ]'), {
      parameter: component, debug: async (point) => { stops.push(point.variables()); },
    });
    assert.ok(JSON.stringify(stops).includes(component), 'broad dynamic taint does not carry into another run');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Evaluate outside a credential position leaves ordinary inputs visible', () => {
  const redactor = new CredentialRedactor();
  redactor.inspect([script('Set Variable [ $input ; Value: "ordinary-visible" ]\nSet Variable [ $copy ; Value: Evaluate ( "$input" ) ]')]);
  assert.equal(redactor.sensitiveName('$input'), false);
  assert.equal(redactor.value('ordinary-visible', '$input'), 'ordinary-visible');
});

for (const options of ['-X PUT -d x -H "x-amz-acl: public-read"', '-X PUT -H "x-amz-copy-source: /other/data.txt"', '-X POST -d x', '--header "Content-Type: text/plain"']) {
  test(`public cURL options preserve diagnostics: ${options}`, () => {
    for (const formula of [JSON.stringify(options), '$options']) {
      const s = withCurl(script(`Set Variable [ $options ; Value: ${JSON.stringify(options)} ]\nInsert from URL [ $r ; "connection://invoices/scan.png" ]`), formula);
      const redactor = new CredentialRedactor();
      redactor.inspect([s]);
      const step = s.steps[1];
      assert.equal(redactor.line(step), step.line);
      const message = "The requested option isn't passed through a connection";
      assert.equal(redactor.error(message, step), message);
    }
  });
}

for (const header of ['Authorization', 'X-API-Key', 'Proxy-Authorization', 'Cookie', 'X-Session-Token']) {
  test(`credential cURL headers still hide their inputs: ${header}`, () => {
    for (const formula of [JSON.stringify(`-H "${header}: ${component}"`), `${JSON.stringify(`--header "${header}: `)} & $input & ${JSON.stringify('"')}`]) {
      const s = withCurl(script(`Set Variable [ $input ; Value: "${component}" ]\nInsert from URL [ $r ; "https://example.test/" ]`), formula);
      const redactor = new CredentialRedactor();
      redactor.inspect([s]);
      assert.equal(redactor.line(s.steps[1]), `Insert from URL [ ${REDACTED} ]`);
      assert.equal(redactor.value(component, '$input'), REDACTED);
    }
  });
}
