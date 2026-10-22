// FileMaker's AI script steps on Tabularius's own AI (src/ai.ts), with a stand-in model: refused offline,
// for a file with AI off, and for a capture-only file; the account a script configures never has its
// API key read; Generate Response from Model keeps a conversation; Perform Find by Natural Language shows
// the model field names only; the embedding steps feed Perform Semantic Find by natural language.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptText as renderScriptText, stepLine, type Script, type ScriptStep, type StepParams } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { evaluateText, text } from '@tabularius/calc';
import { runScript, ScriptSession, setCaptureOnlyDefaults, type RunOptions, type ScriptAi } from '../src/index.ts';
import { ScriptEngine } from '../src/engine.ts';

// No file is capture-only by default; this test names the ones it holds back.
setCaptureOnlyDefaults(['Held']);

let dir: string;
let store: Store;
let heldFile: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-ai-steps-'));
  const make = (name: string) => {
    createStore(join(dir, `${name}.sqlite`));
    const s = new Store(join(dir, `${name}.sqlite`), name);
    s.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'id', type: 'number' }, { name: 'Name', type: 'text' }, { name: 'Vec', type: 'text' }, { name: 'Secret', type: 'text' }, { name: 'Masked', type: 'text' }, { name: 'Result', type: 'text' }] }]);
    for (const [i, n] of ['chairs and tables', 'garden hoses', 'office chairs'].entries()) s.create('Customers', { id: String(i + 1), Name: n, Secret: 'private', Masked: 'masked-private' });
    return s;
  };
  store = make('Shop');
  heldFile = make('Held_Sample');
});
after(() => {
  store?.close();
  heldFile?.close();
  rmSync(dir, { recursive: true });
});

const raw = (stepId: number, name: string, params?: StepParams): ScriptStep => ({ stepId, name, enabled: true, params });
const parsed = (s: Store, text: string): ScriptStep[] =>
  parseScriptText(text, s.schema).map((x) => ({ stepId: x.stepId!, name: x.name!, enabled: x.enabled !== false, params: x.params }));
const script = (...steps: ScriptStep[]): Script => ({ id: 9999, name: 'test', steps } as Script);
const field = (name: string) => ({ tableOccurrence: { id: 0, name: 'Customers' }, field: { id: 0, name } });

// Configure AI Account with a key formula that would leave a mark if it were ever evaluated.
const configure = raw(212, 'Configure AI Account', { ai: { accountName: '"acct"', apiKey: 'Let ( $$keyRead = 1 ; "sk-not-a-key" )', endpoint: 'Let ( $$keyRead = 1 ; "https://example.invalid" )' } });

/** A stand-in model that records what it was sent. */
function fake(answer: (system: string | undefined, last: string) => string, opts: { refuse?: string; vectors?: (t: string) => number[] } = {}) {
  const calls: { system?: string; messages: { role: string; content: string }[]; model: string }[] = [];
  const ai: ScriptAi = {
    refusal: () => opts.refuse,
    generate: async (r) => {
      calls.push({ system: r.system, messages: r.messages, model: r.model });
      return answer(r.system, r.messages.at(-1)!.content);
    },
    ...(opts.vectors ? { embed: async (r: { texts: string[] }) => r.texts.map(opts.vectors!) } : {}),
  };
  return { ai, calls };
}

const run = (s: Store, steps: ScriptStep[], opts: RunOptions = {}) => runScript(s, script(...steps), { layout: 'Customers', trace: true, ...opts });
const why = (r: Awaited<ReturnType<typeof run>>) => r.trace?.find((t) => t.message)?.message ?? '';

test('offline (no AI given), Generate Response from Model stops with error 3 and says why', async () => {
  const r = await run(store, [
    configure,
    raw(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: '"hi"' }, variable: '$r' }),
  ]);
  assert.equal(r.error, 3);
  assert.match(why(r), /run offline/);
});

test('Generate Response from Model answers into its variable and keeps previous pairs plus the current pair', async () => {
  const { ai, calls } = fake((_, last) => `echo ${last}`);
  const session = new ScriptSession();
  const ask = (q: string) => raw(220, 'Generate Response from Model', {
    ai: { accountName: '"acct"', model: '"m"', input: `"${q}"`, instructions: '"Be brief"', messagesVariable: '$$History', historyVariable: '$$History', historyCount: '1' },
    variable: '$r',
  });
  const r = await run(store, [configure, ask('one'), ask('two'), ask('three'), ...parsed(store, 'Exit Script [ Text Result: $r & "|" & $$History & "|" & $$keyRead ]')], { ai, session });
  assert.equal(r.error, 0);
  const [answer, history, keyRead] = r.result.split('|');
  assert.equal(answer, 'echo three');
  assert.deepEqual(JSON.parse(history), [
    { role: 'user', content: 'two' }, { role: 'assistant', content: 'echo two' },
    { role: 'user', content: 'three' }, { role: 'assistant', content: 'echo three' },
  ]);
  assert.equal(keyRead, '', 'the API key and endpoint formulas are never evaluated');
  assert.equal(calls[1].system, 'Be brief');
  assert.deepEqual(calls[1].messages.map((m) => m.content), ['one', 'echo one', 'two']);
  assert.deepEqual(calls[2].messages.map((m) => m.content), ['one', 'echo one', 'two', 'echo two', 'three']);
  assert.equal(calls[0].model, 'm');
});

test('Generate Response from Model counts complete previous pairs and leaves instructions separate', async () => {
  const prior = [
    { role: 'system', content: 'old instructions' },
    { role: 'assistant', content: 'orphan answer' },
    { role: 'user', content: 'one' }, { role: 'assistant', content: 'echo one' },
    { role: 'user', content: 'two' }, { role: 'assistant', content: 'echo two' },
    { role: 'user', content: 'three' }, { role: 'assistant', content: 'echo three' },
    { role: 'user', content: 'unfinished' },
  ];
  for (const [count, kept] of [['1 + 1.9', 2], ['20', 3], ['0', 0], ['-1', 0], [undefined, undefined]] as const) {
    const { ai, calls } = fake((_, last) => `echo ${last}`);
    const session = new ScriptSession();
    session.variables.set('$$history', [text(JSON.stringify(prior))]);
    const r = await run(store, [configure,
      raw(220, 'Generate Response from Model', {
        ai: { accountName: '"acct"', model: '"m"', input: '"now"', instructions: '"Be brief"', messagesVariable: '$$History', historyVariable: '$$History', ...(count !== undefined ? { historyCount: count } : {}) },
        variable: '$r',
      }),
      ...parsed(store, 'Exit Script [ Text Result: $$History ]'),
    ], { ai, session });
    assert.equal(r.error, 0, why(r));
    const current = [{ role: 'user', content: 'now' }, { role: 'assistant', content: 'echo now' }];
    const history = kept === undefined ? prior.slice(1) : kept > 0 ? prior.slice(8 - kept * 2, 8) : [];
    assert.deepEqual(JSON.parse(r.result), [...history, ...current], `count ${count}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].system, 'Be brief');
    assert.deepEqual(calls[0].messages, [...prior.slice(1), current[0]], 'the count only limits saved history');
  }
});

test('an AI step needs Configure AI Account first', async () => {
  const { ai, calls } = fake(() => 'x');
  const r = await run(store, [raw(220, 'Generate Response from Model', { ai: { accountName: '"other"', model: '"m"', input: '"hi"' }, variable: '$r' })], { ai, session: new ScriptSession() });
  assert.equal(r.error, 877); // AI account not found
  assert.match(why(r), /Configure AI Account first/);
  assert.equal(calls.length, 0);
});

test('a file with AI off is refused, and nothing reaches the model', async () => {
  const { ai, calls } = fake(() => 'x', { refuse: 'AI is turned off for Shop' });
  const r = await run(store, [configure, raw(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: '"hi"' }, variable: '$r' })], { ai });
  assert.equal(r.error, 3);
  assert.match(why(r), /AI is turned off for Shop/);
  assert.equal(calls.length, 0);
});

test('a capture-only file never reaches the model, whatever the server allows', async () => {
  const { ai, calls } = fake(() => 'x', { vectors: () => [1, 0] });
  const r = await run(heldFile, [configure, raw(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: '"hi"' }, variable: '$r' })], { ai });
  assert.equal(r.error, 3);
  assert.match(why(r), /capture-only/);
  const e = await run(heldFile, [configure, raw(215, 'Insert Embedding', { ai: { accountName: '"acct"', model: '"m"', input: '"hi"' }, variable: '$v' })], { ai });
  assert.equal(e.error, 3);
  assert.equal(calls.length, 0);
});

test('Perform Find by Natural Language defaults to Found Set and shows only field names', async () => {
  const { ai, calls } = fake(() => 'Here you go: {"requests":[{"criteria":{"name":"*chairs*","Nope":"x"}},{"criteria":{"Name":"office*"},"omit":true}]}');
  const session = new ScriptSession();
  session.variables.set('$$untouched', [text('leave me')]);
  const r = await run(store, [
    configure,
    ...parsed(store, 'Show All Records'),
    raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"chairs, but not office ones"' }, variable: '$$untouched' }),
    ...parsed(store, 'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Customers::Name & "|" & $$untouched ]'),
  ], { ai, session });
  assert.equal(r.error, 0);
  const [count, name, target] = r.result.split('|');
  assert.equal(count, '1');
  assert.equal(name, 'chairs and tables');
  assert.equal(target, 'leave me', 'Found Set does not write its response target');
  assert.match(calls[0].system!, /- Name \(text\)/);
  assert.doesNotMatch(calls[0].system!, /garden|office chairs/, 'no record data goes to the model');
});

test('Perform Find by Natural Language Get modes return JSON without changing the found set and respect field privileges', async () => {
  store.savePrivilegeSet({
    name: 'NoSecret', records: { view: 'id = 1', edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: [],
    tables: { Customers: { view: 'id = 1', edit: false, create: false, delete: false, fields: { Secret: 'none', Masked: 'masked' }, masks: { Masked: { kind: 'placeholder', text: 'Hidden' } } } },
  });
  store.setPassword('reader', 'reader-password', 'NoSecret');
  const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"*chairs*"}}],"sort":[{"fieldName":"Name","sortOrder":"descend"},{"fieldName":"NoSuchField","sortOrder":"descend"},{"fieldName":"Name","sortOrder":"sideways"}]}');
  for (const mode of ['Find Request as JSON', 'Found Set as JSON'] as const) {
    const session = new ScriptSession();
    const r = await run(store, [configure,
      raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"chairs"', findGet: mode.toLowerCase() as 'find request as json' | 'found set as json' }, variable: '$q' }),
      ...parsed(store, 'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Get ( RecordID ) & "|" & $q ]'),
    ], { ai, session, account: 'reader', privileges: store.privileges('reader'), foundSet: [3, 1, 2], recordId: 1 });
    assert.equal(r.error, 0, why(r));
    const [count, recordId, result] = r.result.split('|');
    assert.equal(count, '3', `${mode} preserves the found count`);
    assert.equal(recordId, '1', `${mode} preserves the current record`);
    assert.deepEqual(r.foundSet, [3, 1, 2], `${mode} preserves found-set ids and order`);
    assert.equal(r.recordId, 1);
    const json = JSON.parse(result);
    assert.doesNotMatch(result, /Secret|private|masked-private/, 'hidden values and names stay out of JSON');
    if (mode === 'Find Request as JSON') {
      assert.deepEqual(json, { layouts: 'Customers', query: [{ 'Customers::Name': '*chairs*' }], sort: [{ fieldName: 'Customers::Name', sortOrder: 'descend' }] });
    } else {
      assert.deepEqual(json.messages, [{ code: '0', message: 'OK' }]);
      assert.equal(json.response.dataInfo.foundCount, 1, 'records denied by the view rule are omitted');
      assert.equal(json.response.dataInfo.returnedCount, 1);
      assert.equal(json.response.data[0].fieldData.Name, 'chairs and tables');
      assert.equal(json.response.data[0].fieldData.Masked, 'Hidden', 'masked fields return their configured placeholder');
    }
  }
});

test('Perform Find by Natural Language text modes parse and render', () => {
  const source = 'Perform Find by Natural Language [ Account Name: "acct" ; Model: "m" ; Prompt: "chairs" ; Get: Find Request as JSON ; Response Target: $$out ]';
  const step = parsed(store, source)[0];
  assert.equal(step.params?.ai?.findGet, 'find request as json');
  assert.equal(step.params?.variable, '$$out');
  const named = { ...step, name: 'Perform Find by Natural Language' };
  const rendered = renderScriptText([{ ...named, line: stepLine(named.name, named.params) }]);
  const reparsed = parsed(store, rendered)[0];
  assert.equal(reparsed.params?.ai?.findGet, 'find request as json');
  assert.equal(reparsed.params?.variable, '$$out');
  const unknown = parsed(store, 'Perform Find by Natural Language [ Prompt: "chairs" ; Some Later Option: On ]')[0];
  assert.match(stepLine('Perform Find by Natural Language', unknown.params), /Some Later Option: On/, 'an option the parser does not know prints back unchanged');
});

test('Found Set as JSON reads bounded pages to completion', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => store.create('Customers', { id: String(i + 10), Name: `batch-${i}` }).recordId);
  const proto = ScriptEngine.prototype as unknown as {
    late: (this: unknown, frame: unknown) => void;
    overMemory: (this: unknown, script: string) => void;
  };
  const originalLate = proto.late;
  const originalOverMemory = proto.overMemory;
  const originalFindListener = store.findListener;
  let lateChecks = 0;
  let memoryChecks = 0;
  const checksAtReads: [number, number][] = [];
  proto.late = function (this: unknown, frame: unknown) { lateChecks++; originalLate.call(this, frame); };
  proto.overMemory = function (this: unknown, script: string) { memoryChecks++; originalOverMemory.call(this, script); };
  store.findListener = () => checksAtReads.push([lateChecks, memoryChecks]);
  try {
    const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"*"}}]}');
    const r = await run(store, [configure,
      raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"all"', findGet: 'found set as json' }, variable: '$q' }),
      ...parsed(store, 'Exit Script [ Text Result: $q ]'),
    ], { ai });
    assert.equal(r.error, 0, why(r));
    const json = JSON.parse(r.result);
    assert.equal(json.response.dataInfo.foundCount, 104);
    assert.equal(json.response.dataInfo.returnedCount, 104);
    assert.equal(json.response.data.length, 104);
    assert.equal(checksAtReads.length, 2, 'two 100-row pages, read back to back');
    assert.ok(checksAtReads.every(([late, memory], i) => late > i && memory > i), 'time and memory guards run before every page');
  } finally {
    proto.late = originalLate;
    proto.overMemory = originalOverMemory;
    store.findListener = originalFindListener;
    for (const id of ids) store.delete('Customers', id);
  }
});

test('Found Set as JSON preserves dollar replacement sequences in field values', async () => {
  const value = 'money $& $$ $` $\'';
  const { recordId } = store.create('Customers', { id: 'dollars', Name: value });
  try {
    const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"money*"}}]}');
    const r = await run(store, [configure,
      raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"money"', findGet: 'found set as json' }, variable: '$q' }),
      ...parsed(store, 'Exit Script [ Text Result: $q ]'),
    ], { ai });
    assert.equal(r.error, 0, why(r));
    assert.equal(JSON.parse(r.result).response.data[0].fieldData.Name, value);
  } finally {
    store.delete('Customers', recordId);
  }
});

test('Found Set as JSON returns a controlled capacity error above the byte budget', async () => {
  const { recordId } = store.create('Customers', { id: 'large', Name: 'x'.repeat(8 * 1024 * 1024 + 1) });
  try {
    const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"x*"}}]}');
    const r = await run(store, [configure,
      raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"large"', findGet: 'found set as json' }, variable: '$q' }),
      ...parsed(store, 'Exit Script [ Text Result: Get ( LastError ) ]'),
    ], { ai });
    assert.equal(r.error, 812, why(r));
    assert.equal(r.result, '812');
  } finally {
    store.delete('Customers', recordId);
  }
});

test('JSON modes preserve no-match 401; Found Set as JSON puts the response in a field target', async () => {
  const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"missing"}}]}');
  const noMatch = await run(store, [configure,
    raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"missing"', findGet: 'found set as json' }, variable: '$q' }),
    ...parsed(store, 'Exit Script [ Text Result: Get ( LastError ) & "|" & $q ]'),
  ], { ai });
  assert.equal(noMatch.error, 401);
  assert.equal(noMatch.result.split('|')[0], '401');
  assert.deepEqual(JSON.parse(noMatch.result.slice(noMatch.result.indexOf('|') + 1)).messages, [{ code: '401', message: 'No records match the request' }]);

  const { ai: fieldAi } = fake(() => '{"requests":[{"criteria":{"Name":"*chairs*"}}]}');
  const fieldResult = await run(store, [configure,
    raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"chairs"', findGet: 'found set as json' }, field: field('Result') }),
    ...parsed(store, 'Exit Script [ Text Result: Get ( RecordID ) ]'),
  ], { ai: fieldAi, foundSet: [1], recordId: 1 });
  assert.equal(fieldResult.error, 0, why(fieldResult));
  const [result] = store.query('SELECT Result FROM Customers WHERE _fm_record_id = 1') as { Result: string }[];
  assert.equal(JSON.parse(result.Result).response.dataInfo.foundCount, 2);
});

test('Found Set applies generated sorting to records and normal window state', async () => {
  const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"*chairs*"}}],"sort":[{"fieldName":"Name","sortOrder":"descend"}]}');
  for (const mode of ['found set', 'found set as json'] as const) {
    const r = await run(store, [configure,
      raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"chairs"', ...(mode === 'found set as json' ? { findGet: mode } : {}) }, variable: '$q' }),
      ...parsed(store, 'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Customers::Name & "|" & $q ]'),
    ], { ai });
    assert.equal(r.error, 0, why(r));
    const [count, name, jsonText] = r.result.split('|');
    if (mode === 'found set') {
      assert.equal(count, '2');
      assert.equal(name, 'office chairs');
      assert.deepEqual(r.sort, [{ fieldName: 'Name', sortOrder: 'descend' }]);
    } else {
      assert.equal(count, '3', 'the JSON-only mode preserves the existing found set');
      assert.equal(name, 'chairs and tables');
      const json = JSON.parse(jsonText);
      assert.deepEqual(json.response.data.map((record: { fieldData: { Name: string } }) => record.fieldData.Name), ['office chairs', 'chairs and tables']);
    }
  }
});

test('Found Set as JSON reads from a selected other-file window with that file’s privileges', async () => {
  heldFile.savePrivilegeSet({ name: 'RemoteReader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: [], tables: { Customers: { view: true, edit: false, create: false, delete: false, fields: { Secret: 'none', Masked: 'masked' }, masks: { Masked: { kind: 'placeholder', text: 'Hidden' } } } } });
  heldFile.setPassword('remote-reader', 'remote-password', 'RemoteReader');
  store.savePrivilegeSet({ name: 'RemoteReader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'modifiable', extendedPrivileges: [], tables: { Customers: { view: true, edit: false, create: false, delete: false } } });
  store.setPassword('remote-reader', 'remote-password', 'RemoteReader');
  store.applyDesign([{ op: 'createDataSource', name: 'RemoteWindowFixture', paths: [`file:${heldFile.name}`] }]);
  store.resolveFile = (name) => (name.toLowerCase() === heldFile.name.toLowerCase() ? heldFile : undefined);
  const source = store.schema.dataSources.find((x) => x.name === 'RemoteWindowFixture')!;
  const { ai } = fake(() => '{"requests":[{"criteria":{"Name":"*chairs*"}}]}');
  const r = await run(store, [configure,
    raw(33, 'Open File', { dataSource: { id: source.id, name: source.name } }),
    raw(123, 'Select Window', { calculation: `"${heldFile.name}"` }),
    raw(221, 'Perform Find by Natural Language', { ai: { accountName: '"acct"', model: '"m"', prompt: '"chairs"', findGet: 'found set as json' }, variable: '$q' }),
    ...parsed(store, 'Exit Script [ Text Result: $q ]'),
  ], { ai, account: 'remote-reader', privileges: store.privileges('remote-reader') });
  assert.equal(r.error, 0, why(r));
  const json = JSON.parse(r.result);
  assert.equal(json.response.dataInfo.database, heldFile.name);
  assert.equal(json.response.dataInfo.layout, 'Customers');
  assert.equal(json.response.dataInfo.foundCount, 2);
  assert.doesNotMatch(r.result, /Secret|masked-private/);
  assert.match(r.result, /"Masked":"Hidden"/);
});

test('Insert Embedding in Found Set, then Perform Semantic Find by natural language', async () => {
  // A toy embedding: how much each text is about chairs, and about gardens.
  const vectors = (t: string) => [/chair/i.test(t) ? 1 : 0.05, /garden/i.test(t) ? 1 : 0.05];
  const { ai } = fake(() => '', { vectors });
  const r = await run(store, [
    configure,
    ...parsed(store, 'Show All Records'),
    raw(216, 'Insert Embedding in Found Set', { ai: { accountName: '"acct"', model: '"embed"', sourceField: field('Name') }, field: field('Vec') }),
    raw(218, 'Perform Semantic Find', {
      field: field('Vec'), ai: { queryBy: 'natural language', accountName: '"acct"', model: '"embed"', input: '"somewhere to sit"', recordSet: 'all records' },
    }),
    ...parsed(store, 'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Customers::Name ]'),
  ], { ai });
  assert.equal(r.error, 0, why(r));
  // "somewhere to sit" embeds as [0.05, 0.05]: every record is similar, the closest first.
  assert.equal(r.result.split('|')[0], '3');
  const [vec] = store.query('SELECT Vec FROM Customers WHERE id = 2') as { Vec: string }[];
  assert.deepEqual(JSON.parse(vec.Vec), [0.05, 1]);
});

test('Insert Embedding in Found Set: Replace target contents off, MaxRecPerCall and Continue on error', async () => {
  const sent: string[][] = [];
  let fail = false;
  const ai: ScriptAi = {
    refusal: () => undefined,
    generate: async () => '',
    embed: async (r) => {
      sent.push(r.texts);
      if (fail) throw new Error('the model is busy');
      return r.texts.map(() => [1, 2]);
    },
  };
  const setVecs = (...v: string[]) => parsed(store, ['Show All Records', ...v.flatMap((x, i) => [`Go to Record/Request/Page [ ${i ? 'Next' : 'First'} ]`, `Set Field [ Customers::Vec ; "${x}" ]`]), 'Commit Records/Requests [ With dialog: Off ]'].join('\n'));
  const step = (opts: string) => parsed(store, `Insert Embedding in Found Set [ Account Name: "acct" ; Model: "embed" ; Source Field: Customers::Name ; Target Field: Customers::Vec${opts} ]`);
  const vecs = () => (store.query('SELECT Vec FROM Customers ORDER BY id') as { Vec: string }[]).map((r) => r.Vec ?? '');

  // Off: the record that has a vector keeps it; one call per record with MaxRecPerCall 1.
  let r = await run(store, [configure, ...setVecs('kept', '', ''), ...step(' ; Parameters: "{\\"MaxRecPerCall\\":1}"')], { ai });
  assert.equal(r.error, 0, why(r));
  assert.deepEqual(vecs(), ['kept', '[1,2]', '[1,2]']);
  assert.deepEqual(sent, [['garden hoses'], ['office chairs']]);

  // On, with the default batch: every record, in one call.
  sent.length = 0;
  r = await run(store, [configure, ...setVecs('kept', '', ''), ...step(' ; Replace target contents')], { ai });
  assert.equal(r.error, 0, why(r));
  assert.deepEqual(vecs(), ['[1,2]', '[1,2]', '[1,2]']);
  assert.equal(sent.length, 1);

  // A model error stops the step, unless Continue on error is on.
  fail = true;
  r = await run(store, [configure, ...setVecs('', '', ''), ...step(' ; Replace target contents')], { ai });
  assert.equal(r.error, 3);
  assert.match(why(r), /the model is busy/);
  r = await run(store, [configure, ...setVecs('', '', ''), ...step(' ; Replace target contents ; Continue on error'), ...parsed(store, 'Exit Script [ Text Result: "on" ]')], { ai });
  assert.equal(r.error, 0, why(r));
  assert.equal(r.result, 'on');
  assert.deepEqual(vecs(), ['', '', '']);
  // Offline still stops it.
  r = await run(store, [configure, ...step(' ; Continue on error')]);
  assert.equal(r.error, 3);
});

test('without an embedding model, Insert Embedding says so', async () => {
  const { ai } = fake(() => '');
  const r = await run(store, [configure, raw(215, 'Insert Embedding', { ai: { accountName: '"acct"', model: '"m"', input: '"hi"' }, variable: '$v' })], { ai });
  assert.equal(r.error, 3);
  assert.match(why(r), /embedding model/);
});

test('a script on the server, started from a file kept from AI, can\'t send that file\'s data to the model', async () => {
  // Perform Script on Server starts a new run in another file: the caller's files still count.
  for (const [caller, offFile] of [[heldFile, undefined], [store, 'Shop']] as const) {
    const sent: string[] = [];
    const ai: ScriptAi = {
      refusal: (file) => (offFile && file === offFile ? 'AI is turned off for Shop' : undefined),
      generate: async (r) => {
        sent.push(r.messages.at(-1)!.content);
        return 'ok';
      },
    };
    const target = caller === heldFile ? store : heldFile;
    target.resolveFile = () => undefined;
    caller.resolveFile = (n) => (n.toLowerCase() === target.name.toLowerCase() ? target : undefined);
    caller.applyDesign([{ op: 'createDataSource', name: target.name, paths: [`file:${target.name}`] } as never]);
    const ds = caller.schema.dataSources.find((d) => d.name === target.name)!;
    target.schema.scripts.push({ id: 7001, name: 'ask', steps: [configure,
      raw(220, 'Generate Response from Model', { ai: { accountName: '"acct"', model: '"m"', input: 'Get ( ScriptParameter )' }, variable: '$r' })] } as Script);
    const r = await run(caller, [raw(164, 'Perform Script on Server', {
      script: { id: 7001, name: 'ask', file: { id: ds.id, name: target.name } }, parameter: 'Customers::Name',
    } as StepParams)], { ai });
    target.schema.scripts.pop();
    assert.equal(r.error, 3, `${caller.name}: ${why(r)}`);
    assert.deepEqual(sent, [], `${caller.name}'s data reached the model`);
  }
});

test('GetEmbedding in a formula embeds through the same checks; the step\'s variables aren\'t set twice', async () => {
  const texts: string[] = [];
  const ai: ScriptAi = { refusal: () => undefined, generate: async () => '', embed: async (r) => (texts.push(...r.texts), r.texts.map((t) => [t.length, 1])) };
  const body = parsed(store, [
    'Set Variable [ $a ; Value: Let ( $$n = $$n + 1 ; CosineSimilarity ( GetEmbedding ( "acct" ; "m" ; "chairs" ) ; GetEmbedding ( "acct" ; "m" ; "tables" ) ) ) ]',
    'Set Variable [ $b ; Value: CosineSimilarity ( GetEmbedding ( "acct" ; "m" ; "chairs" ) ; GetEmbedding ( "acct" ; "m" ; "hoses" ) ) ]',
    'Exit Script [ Text Result: Round ( $a ; 3 ) & "|" & Round ( $b ; 3 ) & "|" & $$n ]',
  ].join('\n'));
  const r = await run(store, [configure, ...body], { ai });
  assert.equal(r.error, 0, why(r));
  const [a, b, n] = r.result.split('|');
  assert.equal(a, '1');
  assert.ok(Number(b) < 1);
  // The Let ran once, though the step ran three times; "chairs" was embedded once.
  assert.equal(n, '1');
  assert.deepEqual(texts, ['chairs', 'tables', 'hoses']);

  // No account set up, offline, or the file kept from AI: an error, and nothing reaches the model.
  const asked = parsed(store, 'Set Variable [ $x ; Value: GetEmbedding ( "acct" ; "m" ; "chairs" ) ]');
  assert.match(why(await run(store, asked, { ai })), /Configure AI Account/);
  assert.equal((await run(store, [configure, ...asked])).error, 3);
  assert.equal((await run(heldFile, [configure, ...asked], { ai })).error, 3);
  assert.equal(texts.length, 3);
  // In a field calculation (no script) it is an error.
  assert.equal(evaluateText('GetEmbedding ( "acct" ; "m" ; "x" )'), '?');
});

test('Replace Field Contents with GetEmbedding embeds every record\'s text first and writes each record once', async () => {
  const texts: string[] = [];
  const ai: ScriptAi = { refusal: () => undefined, generate: async () => '', embed: async (r) => (texts.push(...r.texts), r.texts.map((t) => [t.length, 1])) };
  const before = store.query('SELECT _fm_record_id AS id, _fm_mod_id AS m FROM Customers ORDER BY _fm_record_id') as { id: number; m: number }[];
  const body = parsed(store, [
    'Show All Records',
    'Replace Field Contents [ With dialog: Off ; Customers::Vec ; Length ( GetEmbeddingAsText ( GetEmbedding ( "acct" ; "m" ; Customers::Name ) ) ) ]',
  ].join('\n'));
  const r = await run(store, [configure, ...body], { ai });
  assert.equal(r.error, 0, why(r));
  // One call for all three records.
  assert.deepEqual(texts.sort(), ['chairs and tables', 'garden hoses', 'office chairs']);
  const after = store.query('SELECT _fm_record_id AS id, _fm_mod_id AS m, Vec FROM Customers ORDER BY _fm_record_id') as { id: number; m: number; Vec: string }[];
  assert.ok(after.every((x) => Number(x.Vec) > 0), JSON.stringify(after));
  after.forEach((x, i) => assert.equal(x.m, before[i].m + 1, `record ${x.id} written once`));
});

test('GetEmbedding inside ExecuteSQL or Evaluate still embeds; nothing turns it into "?"', async () => {
  const ai: ScriptAi = { refusal: () => undefined, generate: async () => '', embed: async (r) => r.texts.map((t) => [t.length, 1]) };
  const body = parsed(store, [
    'Set Variable [ $sql ; Value: ExecuteSQL ( "SELECT COUNT(*) FROM Customers WHERE Name <> ?" ; "" ; "" ; GetEmbeddingAsText ( GetEmbedding ( "acct" ; "m" ; "zz" ) ) ) ]',
    'Set Variable [ $e ; Value: Let ( $$runs = $$runs + 1 ; Evaluate ( "Get" & "Embedding ( \\"acct\\" ; \\"m\\" ; \\"yy\\" )" ) ) ]',
    'Exit Script [ Text Result: $sql & "|" & $$runs & "|" & IsEmpty ( $e ) ]',
  ].join('\n'));
  const r = await run(store, [configure, ...body], { ai });
  assert.equal(r.error, 0, why(r));
  assert.equal(r.result, '3|1|0');
});

test('offline, an AI step is error 3 before any account is looked for; with a model, a missing account is 877', async () => {
  const embed = raw(215, 'Insert Embedding', { ai: { accountName: '"nobody"', model: '"m"', input: '"hi"' }, variable: '$v' });
  assert.equal((await run(store, [embed], { session: new ScriptSession() })).error, 3);
  const { ai } = fake(() => 'x', { vectors: () => [1] });
  assert.equal((await run(store, [embed], { ai, session: new ScriptSession() })).error, 877);
});

// --- Perform RAG Action: spaces kept by the server (a stand-in here), searched by cosine similarity ---

/** A stand-in space store with the same contract as the server's. */
function fakeRag() {
  const docs: { id: string; file: string; space: string; name?: string; chunks: string[]; vectors: number[][]; model?: string }[] = [];
  let n = 0;
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
  const rag: NonNullable<ScriptAi['rag']> = {
    add: (r) => { const id = `doc-${++n}`; docs.push({ id, ...r }); return id; },
    search: (r) => docs.filter((d) => d.file === r.file && d.space === r.space)
      .flatMap((d) => d.chunks.map((t, i) => ({ text: t, score: cos(d.vectors[i], r.vector), document: d.id })))
      .filter((c) => c.score >= r.threshold).sort((a, b) => b.score - a.score).slice(0, r.top),
    spaces: (r) => [...new Set(docs.filter((d) => d.file === r.file).map((d) => d.space))].map((space) => ({ space, model: 'stand-in' })),
    info: (r) => {
      const mine = docs.filter((d) => d.file === r.file && d.space === r.space);
      return mine.length ? { model: 'stand-in', entries: mine.map((d) => d.name ? { id: d.id, filename: d.name } : { id: d.id, text: d.chunks.join(' ') }) } : undefined;
    },
    remove: (r) => { const before = docs.length; for (let i = docs.length - 1; i >= 0; i--) if (docs[i].file === r.file && docs[i].space === r.space && (!r.ids || r.ids.includes(docs[i].id))) docs.splice(i, 1); return before - docs.length; },
  };
  return { rag, docs };
}
const ragConfigure = raw(227, 'Configure RAG Account', { ai: { ragAccountName: '"rag"' } });
const chairs = (t: string) => [/chair/i.test(t) ? 1 : 0.05, /garden/i.test(t) ? 1 : 0.05];

test('Perform RAG Action: Send Prompt passes keyword_weight (0 to 1) with the question, and nothing when it is 0 or absent', async () => {
  const { rag } = fakeRag();
  const asked: { query?: string; keywordWeight?: number }[] = [];
  const search = rag.search;
  rag.search = (r) => { asked.push({ query: r.query, keywordWeight: r.keywordWeight }); return search(r); };
  const { ai } = fake(() => 'ok', { vectors: chairs });
  const send = (parameters: string) => run(store, [
    configure, ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"shop"', ragAction: 'send prompt', prompt: '"Where is PART-0042?"', accountName: '"acct"', model: '"m"', parameters } }),
  ], { ai: { ...ai, rag } });
  for (const parameters of ['"{\\"keyword_weight\\": 0.4}"', '"{\\"keyword_weight\\": 7}"', '"{\\"keyword_weight\\": 0}"', '"{}"']) assert.equal((await send(parameters)).error, 0);
  assert.deepEqual(asked, [{ query: 'Where is PART-0042?', keywordWeight: 0.4 }, { query: 'Where is PART-0042?', keywordWeight: 1 }, { query: undefined, keywordWeight: undefined }, { query: undefined, keywordWeight: undefined }]);
});

test('Perform RAG Action: Send Prompt clamps each numeric bound and defaults invalid values', async () => {
  const { rag } = fakeRag();
  const asked: { top: number; threshold: number }[] = [];
  const search = rag.search;
  rag.search = (r) => { asked.push({ top: r.top, threshold: r.threshold }); return search(r); };
  const { ai } = fake(() => 'ok', { vectors: chairs });
  const send = (parameters: string) => run(store, [
    configure, ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"shop"', ragAction: 'send prompt', prompt: '"q"', accountName: '"acct"', model: '"m"', parameters } }),
  ], { ai: { ...ai, rag } });

  for (const parameters of [
    ...[
      { num_top_ranked_results: 0, similarity_threshold: -1 },
      { num_top_ranked_results: 100, similarity_threshold: 1 },
      { num_top_ranked_results: 1, similarity_threshold: -0.999 },
      { num_top_ranked_results: 99, similarity_threshold: 0.999 },
      { num_top_ranked_results: -1, similarity_threshold: -2 },
      { num_top_ranked_results: 101, similarity_threshold: 2 },
      { num_top_ranked_results: -1e300, similarity_threshold: -1e300 },
      { num_top_ranked_results: 1e300, similarity_threshold: 1e300 },
    ].map((p) => `"${JSON.stringify(p).replaceAll('"', '\\"')}"`),
    `"${JSON.stringify({ num_top_ranked_results: 'nope', similarity_threshold: 'nope' }).replaceAll('"', '\\"')}"`,
    `"${JSON.stringify({ num_top_ranked_results: null, similarity_threshold: null }).replaceAll('"', '\\"')}"`,
  ]) assert.equal((await send(parameters)).error, 0);
  assert.deepEqual(asked, [
    { top: 100, threshold: 1 },
    { top: 1, threshold: -0.999 }, { top: 99, threshold: 0.999 },
    { top: 100, threshold: 1 }, { top: 100, threshold: 1 },
    { top: 5, threshold: 0 }, { top: 5, threshold: 0 },
  ]);
});

test('Perform RAG Action: a missing space and model keep the current pass-through behavior', async () => {
  const { rag } = fakeRag();
  const { ai, calls } = fake(() => 'ok', { vectors: chairs });
  const r = await run(store, [
    configure, ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"missing"', ragAction: 'send prompt', prompt: '"q"', accountName: '"acct"', model: '""' } }),
  ], { ai: { ...ai, rag } });
  assert.equal(r.error, 0, why(r));
  assert.equal(calls[0].model, '');
  assert.match(calls[0].system!, /nothing found/);
});

test('Perform RAG Action: Tokens per Text Chunk accepts 75 and 512, and rejects 513 with 887', async () => {
  const { rag, docs } = fakeRag();
  const { ai } = fake(() => 'ok', { vectors: chairs });
  const add = (tokensPerChunk: string) => run(store, [
    ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"chunks"', ragAction: 'add data', dataSource: 'from text', input: '"some text"', tokensPerChunk } }),
  ], { ai: { ...ai, rag } });

  assert.equal((await add('75')).error, 0);
  assert.equal((await add('512')).error, 0);
  const invalid = await add('513');
  assert.equal(invalid.error, 887, why(invalid));
  assert.equal(docs.length, 2);
});

test('Perform RAG Action: Add Data from text, Send Prompt answers with the closest chunks, Remove Data empties the space', async () => {
  const { rag, docs } = fakeRag();
  const { ai, calls } = fake(() => 'Chairs are in aisle 4.', { vectors: chairs });
  const r = await run(store, [
    configure, ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"shop"', ragAction: 'add data', dataSource: 'from text', input: '"Office chairs are in aisle 4"', responseVariable: '$added' } }),
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"shop"', ragAction: 'add data', dataSource: 'from text', input: '"Garden hoses are outside"' } }),
    raw(219, 'Perform RAG Action', {
      ai: { ragAccountName: '"rag"', spaceId: '"shop"', ragAction: 'send prompt', prompt: '"Where are the chairs?"', accountName: '"acct"', model: '"m"', parameters: '"{\\"num_top_ranked_results\\": 1}"' },
      variable: '$answer',
    }),
    raw(103, 'Exit Script', { calculation: '$answer & "|" & JSONGetElement ( $added ; "result" )' }),
  ], { ai: { ...ai, rag } });
  assert.equal(r.error, 0, why(r));
  assert.equal(r.result, 'Chairs are in aisle 4.|success');
  assert.equal(docs.length, 2);
  // Only the closest chunk went to the model, as context, with the question.
  assert.match(calls[0].system!, /Office chairs are in aisle 4/);
  assert.doesNotMatch(calls[0].system!, /Garden hoses/);
  const removed = await run(store, [
    ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"shop"', ragAction: 'remove data', responseVariable: '$r' } }),
    raw(103, 'Exit Script', { calculation: 'JSONGetElement ( $r ; "removed" )' }),
  ], { ai: { ...ai, rag } });
  assert.equal(removed.result, '2');
  assert.equal(docs.length, 0);
});

test('Perform RAG Action: spaces belong to a file, the account must be configured, and there are limits on chunk size', async () => {
  const { rag } = fakeRag();
  const { ai } = fake(() => 'x', { vectors: chairs });
  const add = (extra: object = {}, file = store) => run(file, [
    ragConfigure,
    raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"shared"', ragAction: 'add data', dataSource: 'from text', input: '"secret chairs"', ...extra } }),
  ], { ai: { ...ai, rag } });
  const first = await add();
  assert.equal(first.error, 0, why(first));
  // Another file using the same Space ID finds nothing of it.
  assert.equal(rag.search({ file: 'Shop', space: 'shared', vector: [1, 0], top: 5, threshold: -1 }).length, 1);
  assert.equal(rag.search({ file: 'Other', space: 'shared', vector: [1, 0], top: 5, threshold: -1 }).length, 0);
  // No Configure RAG Account first: 877. A token count out of 75 to 512: 887.
  const unconfigured = await run(store, [raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"s"', ragAction: 'remove data' } })], { ai: { ...ai, rag } });
  assert.equal(unconfigured.error, 877);
  assert.equal((await add({ tokensPerChunk: '40' })).error, 887);
  // Without a space store (no embedding model on the server), the step says so.
  const none = await run(store, [ragConfigure, raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: '"s"', ragAction: 'remove data' } })], { ai });
  assert.equal(none.error, 3);
  assert.match(why(none), /RAG spaces/);
});

test('Perform RAG Action reads and prints like FileMaker, and a file\'s step keeps working', () => {
  const lines = [
    'Configure RAG Account [ RAG Account Name: "rag" ; Endpoint: "https://x/" ; API key: $key ]',
    'Perform RAG Action [ RAG Account Name: "rag" ; Space ID: "s" ; Action: Send prompt ; Account Name: "acct" ; Model: "m" ; Prompt: "q" ; Response Target: $a ]',
    'Perform RAG Action [ RAG Account Name: "rag" ; Space ID: "s" ; Action: Add data ; RAG Data: From text ; Text: "hello" ; Tokens per text chunk: 100 ]',
  ];
  const steps = parsed(store, lines.join('\n'));
  assert.deepEqual(steps.map((x, i) => stepLine(lines[i].replace(/ \[.*$/, ''), x.params)), lines);
});

test('Perform RAG Action: Add Data from a file reads text and PDFs from the documents folder only', async () => {
  const docs = join(dir, 'RagDocs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'aisle.txt'), 'Office chairs are in aisle 4. Garden hoses are outside.');
  writeFileSync(join(docs, 'scan.pdf'), '%PDF-1.4 not really a pdf');
  writeFileSync(join(docs, 'image.bin'), Buffer.from([1, 2, 0, 3]));
  const { rag, docs: added } = fakeRag();
  const { ai } = fake(() => 'x', { vectors: chairs });
  const add = (path: string, extra: NonNullable<StepParams['ai']> = {}) => run(store, [
    ragConfigure,
    raw(219, 'Perform RAG Action', { filePaths: [path], ai: { ragAccountName: '"rag"', spaceId: '"files"', ragAction: 'add data', dataSource: 'from file', responseVariable: '$r', ...extra } }),
    raw(103, 'Exit Script', { calculation: 'JSONGetElement ( $r ; "file" )' }),
  ], { ai: { ...ai, rag }, documents: docs });
  const ok = await add('aisle.txt');
  assert.equal(ok.error, 0, why(ok));
  assert.equal(ok.result, 'aisle.txt');
  assert.equal(added[0].name, 'aisle.txt');
  assert.match(added[0].chunks.join(' '), /Office chairs are in aisle 4/);
  // The async variant reads the same way; a path outside the folder, a missing file, a PDF with no text and binary data all stop.
  assert.equal((await add('aisle.txt', { dataSource: 'from file (async)' })).error, 0);
  assert.equal((await add('../outside.txt')).error, 100);
  assert.equal((await add('missing.txt')).error, 100);
  assert.equal((await add('scan.pdf')).error, 3);
  assert.equal((await add('image.bin')).error, 3);
  // The step reads and prints as FileMaker's does.
  const line = 'Perform RAG Action [ RAG Account Name: "rag" ; Space ID: "s" ; Action: Add data ; RAG Data: From file ; Input File: "aisle.txt" ]';
  const printed = stepLine('Perform RAG Action', parsed(store, line)[0].params);
  assert.equal(printed, line.replace('"aisle.txt"', '“aisle.txt”'));
  assert.deepEqual(parsed(store, printed)[0].params?.filePaths, ['aisle.txt']);
});

test('GetRAGSpaceInfo lists the file\'s spaces, then one space\'s documents; a missing space and an unknown account are told apart', async () => {
  const { rag } = fakeRag();
  const { ai } = fake(() => 'x', { vectors: chairs });
  const add = (space: string, input: string) => raw(219, 'Perform RAG Action', { ai: { ragAccountName: '"rag"', spaceId: JSON.stringify(space), ragAction: 'add data', dataSource: 'from text', input: JSON.stringify(input) } });
  const r = await run(store, [
    configure, ragConfigure, add('shop', 'Office chairs'), add('yard', 'Garden hoses'),
    raw(103, 'Exit Script', { calculation: 'GetRAGSpaceInfo ( "rag" ) & "|" & GetRAGSpaceInfo ( "rag" ; "shop" ) & "|" & GetRAGSpaceInfo ( "rag" ; "nope" ) & "|" & GetRAGSpaceInfo ( "other" )' }),
  ], { ai: { ...ai, rag } });
  assert.equal(r.error, 0, why(r));
  const [list, one, missing, unknown] = r.result!.split('|');
  assert.deepEqual(JSON.parse(list), { rag_space_list: [{ space_id: 'shop', model: 'stand-in' }, { space_id: 'yard', model: 'stand-in' }] });
  const detail = JSON.parse(one);
  assert.equal(detail.rag_space_id, 'shop');
  assert.equal(detail.entries, 1);
  assert.deepEqual(detail.values.map((v: { text: string }) => v.text), ['Office chairs']);
  assert.equal(missing, '[RAG Space] error. Reason: RAG space nope not found');
  assert.equal(unknown, '?');
  // Offline, or before Configure RAG Account, it is "?".
  const before = await run(store, [raw(103, 'Exit Script', { calculation: 'GetRAGSpaceInfo ( "rag" )' })], { ai: { ...ai, rag } });
  assert.equal(before.result, '?');
});

test('GetRAGSpaceInfo stays with the running script\'s file: a selected other-file window shows none of its spaces', async () => {
  const { rag } = fakeRag();
  const { ai } = fake(() => 'x', { vectors: chairs });
  rag.add({ file: heldFile.name, space: 'private', chunks: ['secret'], vectors: [[1, 0]], model: 'm' });
  store.applyDesign([{ op: 'createDataSource', name: 'RemoteWindowFixture2', paths: [`file:${heldFile.name}`] }]);
  store.resolveFile = (name) => (name.toLowerCase() === heldFile.name.toLowerCase() ? heldFile : undefined);
  const source = store.schema.dataSources.find((x) => x.name === 'RemoteWindowFixture2')!;
  const r = await run(store, [configure, ragConfigure,
    raw(33, 'Open File', { dataSource: { id: source.id, name: source.name } }),
    raw(123, 'Select Window', { calculation: `"${heldFile.name}"` }),
    raw(103, 'Exit Script', { calculation: 'GetRAGSpaceInfo ( "rag" ) & "|" & GetRAGSpaceInfo ( "rag" ; "private" )' }),
  ], { ai: { ...ai, rag } });
  assert.equal(r.error, 0, why(r));
  assert.doesNotMatch(r.result!, /secret/);
  assert.equal(r.result, '{"rag_space_list":[]}|[RAG Space] error. Reason: RAG space private not found');
});

test('GetRAGSpaceInfo is "?" when the space store fails, and for a capture-only file', async () => {
  const { rag } = fakeRag();
  const { ai } = fake(() => 'x', { vectors: chairs });
  const ask = raw(103, 'Exit Script', { calculation: 'GetRAGSpaceInfo ( "rag" ) & "|" & GetRAGSpaceInfo ( "rag" ; "s" )' });
  const broken = { ...rag, spaces: () => { throw new Error('disk gone'); }, info: () => { throw new Error('disk gone'); } };
  const r = await run(store, [configure, ragConfigure, ask], { ai: { ...ai, rag: broken } });
  assert.equal(r.result, '?|?');
  try {
    setCaptureOnlyDefaults([store.name]);
    const held = await run(store, [configure, ragConfigure, ask], { ai: { ...ai, rag } });
    assert.equal(held.result, '?|?');
  } finally {
    setCaptureOnlyDefaults([], true);
  }
});
