import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host.ts';
import { assertAiDesignChanges, assertAiPolicy } from '../src/ai-policy.ts';
import { evaluate, text } from '../../calc/src/index.ts';
import type { DesignOp, Store } from '../../store/src/index.ts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-policy-functions-'));
  const host = new Host(dir, () => {}, { background: false });
  const store = host.create('Shop');
  t.after(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Name' }, { name: 'Password' }] },
    { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] },
  ]);
  store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true } });
  return { store, host };
}

const custom = (name: string, formula: string, parameters = ['x']): DesignOp =>
  ({ op: 'createCustomFunction', name, parameters, formula });
const calc = (calculation: string): DesignOp =>
  ({ op: 'createField', table: 'Other', name: 'Leak', kind: 'calculation', calculation, options: { unstored: true } });
function refused(store: Store, changes: DesignOp[]) {
  const before = structuredClone(store.schema);
  assert.throws(() => assertAiDesignChanges(store, changes), /AI policy.*secret.*human/i);
  assert.deepEqual(store.schema, before);
}

for (const [label, formula] of [
  ['direct field', 'Items::Password'],
  ['literal field name', 'GetField ( "Items::Password" )'],
  ['literal SQL', 'ExecuteSQL ( "SELECT Password FROM Items" ; "" ; "" )'],
  ['nested custom function', 'Inner ( x )'],
  ['dynamic field name', 'GetField ( x )'],
  ['dynamic SQL', 'ExecuteSQL ( x ; "" ; "" )'],
  ['dynamic evaluation', 'Evaluate ( x )'],
  ['unqualified field', 'Password'],
] as const) {
  test(`AI refuses creating or editing a function with ${label}, even without callers`, (t) => {
    const { store } = fixture(t);
    store.applyDesign([custom('Inner', 'Items::Password'), custom('Peek', '1')]);
    // Even blanket destination exceptions cannot authorize creating new readers.
    store.savePrivilegeSet({ ...store.privileges('Admin').set, aiVisible: { Items: true, Other: true } });
    for (const change of [custom('NewPeek', formula),
      { op: 'updateCustomFunction', customFunction: 'Peek', formula } satisfies DesignOp]) {
      refused(store, [{ op: 'createField', table: 'Other', name: 'Note' }, change]);
    }
  });
}

const unresolved: [string, DesignOp[], string][] = [
  ['malformed body', [custom('Peek', 'Items::Password +')], 'Peek ( 1 )'],
  ['unknown function', [], 'Missing ( 1 )'],
  ['self recursion', [custom('Peek', 'Peek ( x )')], 'Peek ( 1 )'],
  ['mutual recursion', [custom('Peek', 'NextPeek ( x )'), custom('NextPeek', 'Peek ( x )')], 'Peek ( 1 )'],
  ['deep call chain', Array.from({ length: 70 }, (_, i) => custom(`Depth${i}`, i === 69 ? '1' : `Depth${i + 1} ( x )`)), 'Depth0 ( 1 )'],
  ['oversized body', [custom('Peek', `"${'a'.repeat(70_000)}"`)], 'Peek ( 1 )'],
  ['wide body', [custom('Peek', `List ( ${Array(12_000).fill('1').join(' ; ')} )`)], 'Peek ( 1 )'],
  ['expanding call graph', Array.from({ length: 18 }, (_, i) => custom(`Branch${i}`, i === 17 ? '1' : `Branch${i + 1} ( x ) & Branch${i + 1} ( x )`)), 'Branch0 ( 1 )'],
  ['JavaScript body', [{ op: 'createCustomFunction', name: 'Peek', parameters: ['x'], language: 'javascript', formula: 'return x;' }], 'Peek ( 1 )'],
];
for (const [label, setup, calculation] of unresolved) {
  test(`unresolved ${label} taints existing and proposed calculations`, (t) => {
    const { store } = fixture(t);
    if (setup.length) store.applyDesign(setup);
    refused(store, [{ op: 'createField', table: 'Other', name: 'Note' }, calc(calculation)]);
    store.applyDesign([calc(calculation)]);
    assert.throws(() => assertAiPolicy(store, 'Admin', 'read'), /Other.*Leak/);
  });
}

test('a missing decoded custom-function body is uncertain', (t) => {
  const { store } = fixture(t);
  store.applyDesign([custom('Peek', '1')]);
  delete store.schema.customFunctions[0].formula;
  refused(store, [calc('Peek ( 1 )')]);
  store.applyDesign([calc('Peek ( 1 )')]);
  assert.throws(() => assertAiPolicy(store, 'Admin', 'read'), /Other.*Leak/);
});

test('a function in another file cannot resolve a local call', (t) => {
  const { store, host } = fixture(t);
  const other = host.create('Elsewhere');
  other.applyDesign([custom('ForeignPeek', '1')]);
  store.applyDesign([{ op: 'createDataSource', name: 'Elsewhere', paths: ['file:Elsewhere'] }]);
  refused(store, [calc('ForeignPeek ( 1 )')]);
  store.applyDesign([calc('ForeignPeek ( 1 )')]);
  assert.throws(() => assertAiPolicy(store, 'Admin', 'read'), /Other.*Leak/);
});

for (const access of ['none', 'masked'] as const) test(`uncertainty inherits ${access} fields with ordinary names`, (t) => {
  const { store } = fixture(t);
  store.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Password' }, custom('Peek', 'Missing ( x )')]);
  store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false },
    tables: { Items: { view: true, edit: false, create: false, delete: false, fields: { Name: access } } }, aiVisible: { Items: true },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmmcp'] });
  store.setPassword('Reader', 'synthetic-password');
  store.setAccountPrivilegeSet('Reader', 'Reader');
  assert.throws(() => assertAiDesignChanges(store, [calc('Peek ( 1 )')], store.privileges('Reader')), /secret.*human/i);
  store.applyDesign([calc('Peek ( 1 )')]);
  assert.throws(() => assertAiPolicy(store, 'Reader', 'read'), /Other.*Leak/);
});

test('parameters and Let scopes shadow fields, while actual argument dependencies are preserved', (t) => {
  const { store } = fixture(t);
  const setup = [custom('Identity', 'Password', [' Password ']),
    custom('Spaced', 'Upper ( input value )', ['input value']),
    custom('Wrapped', 'Let ( Password = x ; Identity ( Password ) )'),
    custom('Label', 'Items::Name & Spaced ( x )'),
    custom('Constant', '"safe"', [])];
  assert.doesNotThrow(() => assertAiDesignChanges(store, setup));
  store.applyDesign(setup);
  for (const calculation of ['Identity ( "safe" )', 'Spaced ( "safe" )', 'Wrapped ( "safe" )', 'Label ( "safe" )', 'Constant', 'Constant ( )']) {
    assert.doesNotThrow(() => assertAiDesignChanges(store, [calc(calculation)]), calculation);
  }
  refused(store, [calc('Identity ( Items::Password )')]);
  refused(store, [calc('Wrapped ( Items::Password )')]);
  store.applyDesign([calc('Spaced ( "safe" )')]);
  assert.doesNotThrow(() => assertAiPolicy(store, 'Admin', 'read'));
});

for (const [label, setup, calculation] of unresolved.filter(([label]) => ['deep call chain', 'oversized body', 'wide body'].includes(label))) {
  test(`execution analysis also bounds ${label} with a source exception`, (t) => {
    const { store } = fixture(t);
    store.applyDesign(setup);
    assert.throws(() => assertAiPolicy(store, 'Admin', 'evaluate', { formula: calculation }), /read set cannot be determined statically/);
  });
}

test('unknown dependencies alone do not invent a secret in a file without protected fields', (t) => {
  const { store } = fixture(t);
  store.applyDesign([{ op: 'deleteField', table: 'Items', field: 'Password' }]);
  assert.doesNotThrow(() => assertAiDesignChanges(store, [custom('Peek', 'GetField ( x )'), calc('Peek ( "Name" )')]));
});

test('parameter values cannot resolve dynamic names, even when every caller passes a literal', (t) => {
  const { store } = fixture(t);
  store.applyDesign([custom('Peek', 'GetField ( x )')]);
  refused(store, [calc('Peek ( "Items::Name" )')]);
});

test('a nested function cannot capture its caller parameter scope', (t) => {
  const { store } = fixture(t);
  store.applyDesign([custom('Inner', 'Password'), custom('Outer', 'Inner ( 1 )', ['Password'])]);
  refused(store, [{ op: 'createField', table: 'Items', name: 'Leak', calculation: 'Outer ( "safe" )' }]);
});

test('custom-function dependencies propagate through derived fields', (t) => {
  const { store } = fixture(t);
  store.applyDesign([{ op: 'createField', table: 'Items', name: 'Derived', calculation: 'Password' }]);
  refused(store, [custom('Peek', 'Items::Derived')]);
  store.applyDesign([custom('Peek', 'Items::Derived'), calc('Peek ( 1 )')]);
  assert.throws(() => assertAiPolicy(store, 'Admin', 'read'), /Other.*Leak/);
});

test('an edit to a callee cannot turn an existing safe caller into a secret reader', (t) => {
  const { store } = fixture(t);
  store.applyDesign([custom('Inner', '1'), custom('Outer', 'Inner ( x )'), calc('Outer ( 1 )')]);
  refused(store, [{ op: 'updateCustomFunction', customFunction: 'Inner', formula: 'Items::Password' }]);
});

test('create then delete a secret-reading function is refused as one batch', (t) => {
  const { store } = fixture(t);
  refused(store, [custom('Peek', 'Items::Password'), { op: 'deleteCustomFunction', customFunction: 'Peek' }]);
});

test('policy OFF preserves custom-function design behavior', (t) => {
  const { store } = fixture(t);
  store.setAiPolicy(false);
  assert.doesNotThrow(() => assertAiDesignChanges(store, [custom('Peek', 'Items::Password'), calc('Peek ( 1 )')]));
});

for (const calculation of ['ShadowReader ( )', 'sHaDoWrEaDeR']) {
  test(`an enabled plug-in owns ${calculation} ahead of a harmless custom body`, (t) => {
    const { store } = fixture(t);
    store.applyDesign([custom('shadowreader', '"safe"', [])]);
    const pluginCall = t.mock.fn(() => text('synthetic-plugin-secret'));
    store.plugin = (name) => name.toLowerCase() === 'shadowreader' ? { min: 0, max: 0, call: pluginCall } : undefined;
    assert.equal(store.evaluate('Other', calculation).value, 'synthetic-plugin-secret');
    pluginCall.mock.resetCalls();
    refused(store, [calc(calculation)]);
    assert.throws(() => assertAiPolicy(store, 'Admin', 'evaluate', { formula: calculation }), /uncertain read set/);
    assert.equal(pluginCall.mock.callCount(), 0, 'analysis must not execute the plug-in');
    store.applyDesign([calc(calculation)]);
    assert.throws(() => assertAiPolicy(store, 'Admin', 'read'), /Other.*Leak/);

    // With the plug-in disabled, the same name genuinely resolves to the custom body.
    store.plugin = () => undefined;
    assert.equal(store.evaluate('Other', calculation).value, 'safe');
    assert.doesNotThrow(() => assertAiPolicy(store, 'Admin', 'evaluate', { formula: calculation }));
  });
}

test('plug-in resolution uses the owning file, including external calculation dependencies', (t) => {
  const { store, host } = fixture(t);
  const other = host.create('Elsewhere');
  other.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Password' }] },
    { op: 'createTable', name: 'Other', fields: [{ name: 'Name' }] },
    custom('ShadowReader', '"safe"', []), calc('ShadowReader ( )'),
  ]);
  other.savePrivilegeSet({ ...other.privileges('Admin').set, aiVisible: { Items: true } });
  const pluginCall = t.mock.fn(() => text('synthetic-plugin-secret'));
  other.plugin = (name) => name.toLowerCase() === 'shadowreader' ? { min: 0, call: pluginCall } : undefined;
  store.applyDesign([{ op: 'createDataSource', name: 'Elsewhere', paths: ['file:Elsewhere'] }]);
  assert.throws(() => assertAiPolicy(store, 'Admin', 'read'), /Elsewhere.*Other.*Leak/);
  assert.equal(pluginCall.mock.callCount(), 0);
});

test('a safe built-in owns its name ahead of plug-ins and secret-reading custom functions', (t) => {
  const { store } = fixture(t);
  store.applyDesign([custom('aBs', 'Items::Password'), custom('rAnDoM', 'Items::Password', [])]);
  t.mock.method(Math, 'random', () => 0.25);
  const pluginLookup = t.mock.fn(() => ({ min: 0, call: () => text('synthetic-plugin-secret') }));
  store.plugin = pluginLookup;
  for (const formula of ['ABS ( -2 )', 'Random ( )', 'rAnDoM']) {
    assert.doesNotThrow(() => assertAiDesignChanges(store, [calc(formula)]));
    assert.doesNotThrow(() => assertAiPolicy(store, 'Admin', 'evaluate', { formula }));
    assert.equal(Number(store.evaluate('Other', formula).value), formula.startsWith('ABS') ? 2 : 0.25);
  }
  assert.equal(pluginLookup.mock.callCount(), 0, 'built-ins must resolve without looking up a plug-in');
});

test('an unreviewed bare built-in cannot borrow a harmless custom body', (t) => {
  const { store } = fixture(t);
  store.applyDesign([custom('sElF', '"safe"', [])]);
  for (const calculation of ['Self', 'SELF ( )']) {
    refused(store, [calc(calculation)]);
    assert.throws(() => assertAiPolicy(store, 'Admin', 'evaluate', { formula: calculation }), /uncertain read set/);
  }
  // Local bindings and parameters still take precedence over a bare function name.
  store.applyDesign([custom('Identity', 'Self', ['Self'])]);
  for (const calculation of ['Let ( Self = 1 ; Self )', 'Identity ( 1 )', 'While ( [ Self = 1 ] ; Self < 1 ; [ Self = Self + 1 ] ; Self )']) {
    assert.doesNotThrow(() => assertAiDesignChanges(store, [calc(calculation)]));
    assert.doesNotThrow(() => assertAiPolicy(store, 'Admin', 'evaluate', { formula: calculation }));
    assert.equal(store.evaluate('Other', calculation).value, '1');
  }
});

test('the pure allowlist cannot override a custom body when no built-in is registered', (t) => {
  const { store } = fixture(t);
  // The engine parses bare Pi as a constant; Pi() resolves as an ordinary function call.
  store.applyDesign([custom('Pi', 'Items::Password', [])]);
  const row = store.create('Items', { Password: 'synthetic-custom-secret' });
  assert.equal(store.evaluate('Items', 'pI ( )', row.recordId).value, 'synthetic-custom-secret');
  refused(store, [calc('pI ( )')]);
});

test('resolution does not fall through on built-in disablement or argument-count mismatch', () => {
  const unexpected = () => { throw new Error('must not resolve a lower-priority function'); };
  for (const formula of ['Random', 'RANDOM ( )']) {
    assert.equal(evaluate(formula, { builtinOff: () => true, plugin: unexpected, customFunction: unexpected }).value, '?');
  }
  for (const formula of ['Abs', 'Abs ( )']) {
    assert.throws(() => evaluate(formula, { plugin: unexpected, customFunction: unexpected }), /cannot be found|Too few parameters/);
  }
  for (const formula of ['ShadowReader', 'ShadowReader ( )']) {
    assert.throws(() => evaluate(formula, {
      plugin: () => ({ min: 1, call: unexpected }), customFunction: unexpected,
    }), /cannot be found|Too few parameters/);
  }
  for (const formula of ['Random', 'ShadowReader']) {
    assert.equal(evaluate(formula, {
      field: () => text('field wins'), plugin: () => ({ min: 0, call: unexpected }), customFunction: unexpected,
    }).value, 'field wins');
  }
});
