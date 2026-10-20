// MBS ( "Dictionary.…" ) and ( "Variable.…" ) against the examples on MBS's own function pages (mbsplugins.eu).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { evaluateText, type CalcContext } from '../src/index.ts';
import { MBS_DICT } from '../src/mbs-dict.ts';
import { MbsError } from '../src/mbs-text.ts';
import { num, text, type Value } from '../src/values.ts';

const session = () => {
  const scope = {};
  return (name: string, ...args: (string | number | Value)[]) => {
    const values = args.map((a) => (typeof a === 'number' ? num(a) : typeof a === 'string' ? text(a) : a));
    const r = MBS_DICT[name.toLowerCase()]({ values, texts: values.map((v) => String(v.value)) }, scope);
    return r.type === 'text' ? r.value : r.type === 'number' ? r.value : r;
  };
};

test('AR-calc-extensions-08 dictionary bulk capacity failure keeps the original keys', () => {
  const source = `
    import { MBS_DICT } from ${JSON.stringify(new URL('../src/mbs-dict.ts', import.meta.url).href)};
    import { num, text } from ${JSON.stringify(new URL('../src/values.ts', import.meta.url).href)};
    const scope = {};
    const call = (name, values) => MBS_DICT[name]({ values, texts: values.map(v => String(v.value)) }, scope);
    const ref = String(call('dictionary.create', []).value);
    for (let i = 0; i < 999999; i++) call('dictionary.setvalueforkey', [text(ref), text(String(i)), num(i)]);
    const before = call('dictionary.count', [text(ref)]).value;
    try { call('dictionary.setlist', [text(ref), text('last\\t1\\rtoo-many\\t2')]); }
    catch (error) {
      process.stdout.write(JSON.stringify({ before, after: call('dictionary.count', [text(ref)]).value,
        added: call('dictionary.haskey', [text(ref), text('last')]).value, error: String(error) }));
    }
  `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=512', '--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { before: 999999, after: 999999, added: 0,
    error: 'Error: A dictionary holds at most 1000000 keys' });
});

test('MBS Dictionary: keys, values and their types', () => {
  const x = session();
  const d = x('Dictionary.Create', 'FirstName', 'Ann', 'Age', 38, 'Born', { type: 'date', value: 738000 }) as number;
  assert.equal(x('Dictionary.Count', d), 3);
  assert.equal(x('Dictionary.ValueForKey', d, 'Age'), 38);
  assert.deepEqual(x('Dictionary.ValueForKey', d, 'Born'), { type: 'date', value: 738000 });
  assert.equal(x('Dictionary.ValueTypeForKey', d, 'Born'), 'Date');
  assert.equal(x('Dictionary.ValueTypeForKey', d, 'FirstName'), 'Text');
  assert.equal(x('Dictionary.ValueTypeForKey', d, 'none'), 'Invalid');
  assert.equal(x('Dictionary.HasKey', d, 'Age'), 1);
  assert.equal(x('Dictionary.HasKey', d, 'age'), 0);
  assert.throws(() => x('Dictionary.ValueForKey', d, 'none'), MbsError);
  assert.equal(x('Dictionary.Lookup', d, 'none', 'fallback'), 'fallback');
  assert.equal(x('Dictionary.Lookup', d, 'none'), '');
  assert.equal(x('Dictionary.HasKeys', x('Dictionary.Create', 'Hello', 1, 'World', 2, 'More', 3), 'World\rOther\rMore'), 'World\rMore');
  assert.equal(x('Dictionary.SetValueForKey', d, 'Age', 39), 'OK');
  assert.equal(x('Dictionary.RemoveKey', d, 'Born'), 'OK');
  assert.equal(x('Dictionary.Keys', d), 'FirstName\rAge');
  assert.equal(x('Dictionary.Values', d), 'Ann\r39');
  assert.equal(x('Dictionary.KeyAtIndex', d, 1), 'Age');
  assert.throws(() => x('Dictionary.KeyAtIndex', d, 2), MbsError);
  assert.equal(x('Dictionary.ToText', d), 'FirstName\tAnn\rAge\t39');
  assert.throws(() => x('Dictionary.Create', 'odd'), /pairs/);
});

test('MBS Dictionary: prefix and postfix keys, as the page lists them', () => {
  const x = session();
  const dic = x('Dictionary.Create');
  x('Dictionary.SetValueForKey', dic, 'person.123.firstname', 'John');
  x('Dictionary.SetValueForKey', dic, 'person.123.lastname', 'Miller');
  x('Dictionary.SetValueForKey', dic, 'person.456.firstname', 'Tom');
  x('Dictionary.SetValueForKey', dic, 'person.456.lastname', 'Smith');
  assert.equal(x('Dictionary.KeysWithPrefix', dic, 'person.123.'), 'person.123.lastname\rperson.123.firstname');
  assert.equal(x('Dictionary.KeysWithPostfix', dic, '.lastname'), 'person.456.lastname\rperson.123.lastname');
});

test('MBS Dictionary: references, names, copies, JSON and Serialize', () => {
  const x = session();
  assert.equal(x('Dictionary.CreateNamed', 'test', 'a', 1), 'test');
  assert.equal(x('Dictionary.SetValueForKey', 'test', 'Greet', 'hi'), 'OK');
  const c = x('Dictionary.Clone', 'test');
  x('Dictionary.SetValueForKey', 'test', 'a', 2);
  assert.equal(x('Dictionary.ValueForKey', c, 'a'), 1);
  assert.equal(x('Dictionary.AddDictionary', c, 'test'), 'OK');
  assert.equal(x('Dictionary.ValueForKey', c, 'a'), 2);
  assert.equal(x('Dictionary.SetTag', c, 42), 'OK');
  assert.equal(x('Dictionary.GetTag', c), 42);
  const j = x('Dictionary.FromJSON', '{"Hello": "World", "num": 123, "value": 123.456, "object": {"Hello": "World"}, "empty": null, "yes": true, "array": [1,2,3]}');
  assert.equal(x('Dictionary.ValueForKey', j, 'object'), '{"Hello":"World"}');
  assert.equal(x('Dictionary.ValueForKey', j, 'array'), '[1,2,3]');
  assert.equal(x('Dictionary.ValueForKey', j, 'yes'), 1);
  assert.equal(x('Dictionary.ValueForKey', j, 'empty'), '');
  assert.equal(x('Dictionary.ToJSON', x('Dictionary.Create', 'n', 1.5, 't', 'x')), '{\n\t"t": "x",\n\t"n": 1.5\n}');
  const s = x('Dictionary.Serialize', x('Dictionary.Create', 'Hello', 'World', '1234', 'Just a test!', 'when', { type: 'time', value: 3600 }));
  const back = x('Dictionary.Deserialize', s);
  assert.equal(x('Dictionary.Keys', back), 'when\rHello\r1234');
  assert.deepEqual(x('Dictionary.ValueForKey', back, 'when'), { type: 'time', value: 3600 });
  assert.throws(() => x('Dictionary.Deserialize', 'bm9wZQ=='), /Dictionary.Serialize/);
  const list = x('Dictionary.Create');
  assert.equal(x('Dictionary.SetList', list, 'Hello=World\rOther=Value=2', '='), 'OK');
  assert.equal(x('Dictionary.ValueForKey', list, 'Other'), 'Value=2');
  assert.match(String(x('Dictionary.List')), /test/);
  assert.equal(x('Dictionary.Release', 'test'), 'OK');
  assert.throws(() => x('Dictionary.Count', 'test'), /not a dictionary reference/);
  assert.equal(x('Dictionary.ReleaseAll'), 'OK');
  assert.equal(x('Dictionary.List'), '');
});

test('MBS Variable: the page examples', () => {
  const x = session();
  assert.equal(`Set: ${x('Variable.Set', 'test', 'test')}\rLookup test: ${x('Variable.Lookup', 'test', 'not found?')}\rLookup test2: ${x('Variable.Lookup', 'test2', 'not found?')}`,
    'Set: OK\rLookup test: test\rLookup test2: not found?');
  assert.equal(`${x('Variable.Exists', 'testing')}${(x('Variable.Set', 'testing', 'Hello'), x('Variable.Exists', 'testing'))}`, '01');
  x('Variable.Clear', 'ID');
  assert.equal(`${x('Variable.Add', 'ID', 1)}${x('Variable.Add', 'ID', 1)}${x('Variable.Add', 'ID', 1)} ${x('Variable.Get', 'ID')}`, '123 3');
  ['Line 1\r', 'Line 2\r', 'Line 3\r'].forEach((l) => x('Variable.Append', 'hello', l));
  assert.equal(x('Variable.Get', 'hello'), 'Line 1\rLine 2\rLine 3\r');
  x('Variable.Clear', 'hello');
  ['a', 'b', 'c'].forEach((l) => x('Variable.AppendValue', 'hello', l));
  assert.equal(x('Variable.Get', 'hello'), 'a\rb\rc');
  assert.equal(x('Variable.PopValue', 'hello'), 'c');
  assert.equal(x('Variable.ValueCount', 'hello'), 2);
  assert.equal(x('Variable.AppendJSON', 'list', '{"test":123}'), '[\n\t{\n\t\t"test": 123\n\t}\n]');
  assert.equal(x('Variable.PopJSON', 'list'), '{\n\t"test": 123\n}');
  assert.equal(x('Variable.ClearAll'), 'OK');
  assert.throws(() => x('Variable.Get', 'test'), /Variable not found/);
  x('Variable.Set', 'Hello', 'World');
  x('Variable.Set', 'other', 'value');
  assert.equal(x('Variable.List'), 'other\tvalue\rHello\tWorld');
  assert.equal(x('Variable.Names'), 'other\rHello');
});

test('MBS Dictionary and Variable through MBS ( … ): values keep their type, sessions keep their own', () => {
  const c: CalcContext = {};
  assert.equal(evaluateText('Let ( d = MBS ( "Dictionary.Create" ; "when" ; Date ( 1 ; 2 ; 2024 ) ) ; GetAsText ( MBS ( "Dictionary.ValueForKey" ; d ; "when" ) + 1 ) )', c), '1/3/2024');
  assert.equal(evaluateText('Let ( d = MBS ( "Dictionary.Create" ; "when" ; Date ( 1 ; 2 ; 2024 ) ) ; MBS ( "Dictionary.Values" ; d ) )', c), '1/2/2024');
  assert.equal(evaluateText('MBS ( "Variable.Set" ; "v" ; 5 ) & MBS ( "Variable.Get" ; "v" ) * 2', c), 'OK10');
  assert.match(evaluateText('MBS ( "Variable.Get" ; "v" )', {}), /^\[MBS\] ERROR: Variable not found/);
  assert.match(evaluateText('MBS ( "Dictionary.ToXML" ; 1 )', c), /not available/);
});

test('MBS Dictionary: Deserialize checks types and values, references never collide, KeyAtIndex is cached', () => {
  const x = session();
  const crafted = (e: unknown[]) => Buffer.from(JSON.stringify(['openhbam-dictionary-1', [e]])).toString('base64');
  for (const e of [['k', 'toString', 5], ['k', 'constructor', 5], ['k', '__proto__', 5], ['d', 'date', 1e300], ['d', 'date', 0.5], ['n', 'number', null], ['t', 'time', 1e20]])
    assert.throws(() => x('Dictionary.Deserialize', crafted(e)), /Dictionary.Serialize/);
  assert.deepEqual(x('Dictionary.ValueForKey', x('Dictionary.Deserialize', crafted(['d', 'date', 738000])), 'd'), { type: 'date', value: 738000 });
  const a = x('Dictionary.Create', 'k', 'first') as number;
  x('Dictionary.CreateNamed', String(a + 1), 'k', 'mine');
  const b = x('Dictionary.Create') as number;
  assert.notEqual(b, a + 1);
  assert.equal(x('Dictionary.ValueForKey', String(a + 1), 'k'), 'mine');
  const d = x('Dictionary.Create', 'b', 1, 'a', 2);
  assert.equal(x('Dictionary.KeyAtIndex', d, 0), 'b');
  x('Dictionary.SetValueForKey', d, 'c', 3);
  assert.equal(x('Dictionary.KeyAtIndex', d, 0), 'c');
  x('Dictionary.RemoveKey', d, 'c');
  assert.equal(x('Dictionary.KeyAtIndex', d, 0), 'b');
  x('Dictionary.Clear', d);
  assert.throws(() => x('Dictionary.KeyAtIndex', d, 0), MbsError);
});

test('MBS Dictionary: the open dictionaries share one budget, and named ones count toward the open limit', () => {
  const x = session();
  const json = (n: number, p: string) => `{${Array.from({ length: n }, (_, i) => `"${p}${i}":1`).join(',')}}`;
  const big = x('Dictionary.FromJSON', json(1_000_000, 'k'));
  x('Dictionary.Clone', big);
  assert.throws(() => x('Dictionary.Clone', big), /together/);
  assert.throws(() => x('Dictionary.Create', 'a', 1), /together/);
  const empty = x('Dictionary.Create');
  assert.throws(() => x('Dictionary.SetValueForKey', empty, 'new', 1), /together/);
  x('Dictionary.RemoveKey', big, 'k0');
  assert.equal(x('Dictionary.SetValueForKey', empty, 'new', 1), 'OK');
  x('Dictionary.Clear', big);
  assert.equal(x('Dictionary.Count', x('Dictionary.Clone', x('Dictionary.Create', 'a', 1))), 1);
  x('Dictionary.ReleaseAll');
  for (let i = 0; i < 10_000; i++) x('Dictionary.CreateNamed', `n${i}`);
  assert.throws(() => x('Dictionary.CreateNamed', 'one more'), /Too many/);
  assert.equal(x('Dictionary.CreateNamed', 'n5', 'a', 1), 'n5');
});
