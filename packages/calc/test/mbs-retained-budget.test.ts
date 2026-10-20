import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MBS_DICT } from '../src/mbs-dict.ts';
import { MBS_QUICKLIST } from '../src/mbs-quicklist.ts';
import { MBS_REGEX } from '../src/mbs-regex.ts';
import { ENTRY_BYTES, LIST_SLOT_BYTES, MAX_PLUGIN_VARIABLES, retainedBudget } from '../src/retained-budget.ts';
import { num, text, type Value } from '../src/values.ts';

function session(limit = 4096) {
  const scope = {};
  const budget = retainedBudget(scope, limit);
  const dict = (name: string, ...args: (string | number | Value)[]) => {
    const values = args.map(a => typeof a === 'string' ? text(a) : typeof a === 'number' ? num(a) : a);
    return MBS_DICT[name.toLowerCase()]({ values, texts: values.map(v => String(v.value)) }, scope).value;
  };
  const list = (name: string, ...args: (string | number)[]) => MBS_QUICKLIST[name.toLowerCase()](args.map(String), scope);
  const regex = (name: string, ...args: (string | number)[]) => MBS_REGEX[name.toLowerCase()](args.map(String), scope);
  return { scope, budget, dict, list, regex };
}

test('AR-calc-extensions-06: variable replace and clear refund bytes', () => {
  const { budget, dict } = session(512);
  dict('Variable.Set', 'a', 'x'.repeat(100));
  const used = budget.used;
  assert.throws(() => dict('Variable.Set', 'b', 'y'.repeat(100)), /memory limit/);
  assert.equal(budget.used, used);
  assert.equal(dict('Variable.Exists', 'b'), 0);
  assert.throws(() => dict('Variable.Set', 'a', 'y'.repeat(200)), /memory limit/);
  assert.equal(dict('Variable.Get', 'a'), 'x'.repeat(100));
  dict('Variable.Set', 'a', 'small');
  assert.equal(budget.used, used - 190);
  dict('Variable.Set', 'b', 'y'.repeat(100));
  dict('Variable.Clear', 'a');
  dict('Variable.Clear', 'missing');
  assert.equal(budget.used, used);
  dict('Variable.ClearAll');
  assert.equal(budget.used, 0);
  dict('Variable.Add', 'n', 1);
  dict('Variable.Reset');
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: every variable writer observes the count ceiling', () => {
  const { dict, budget } = session(8_000_000);
  for (let i = 0; i < MAX_PLUGIN_VARIABLES; i++) dict('Variable.Set', String(i), '');
  const used = budget.used;
  for (const [name, value] of [['Set', 'x'], ['Add', 1], ['Append', 'x'], ['AppendValue', 'x'], ['AppendJSON', '1']] as const) {
    assert.throws(() => dict(`Variable.${name}`, 'extra', value), /Too many plug-in variables/);
    assert.equal(budget.used, used);
    assert.equal(dict('Variable.Exists', 'extra'), 0);
  }
  dict('Variable.Set', '0', 'replace');
  dict('Variable.Clear', '1');
  dict('Variable.Set', 'extra', 'ok');
  dict('Variable.Reset');
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: variable append and pop account for final value', () => {
  const { dict, budget } = session();
  dict('Variable.Set', 'v', 'a');
  const base = budget.used;
  dict('Variable.Append', 'v', 'b');
  assert.equal(budget.used, base + 2);
  dict('Variable.AppendValue', 'v', 'cd');
  assert.equal(budget.used, base + 8);
  assert.equal(dict('Variable.PopValue', 'v'), 'cd');
  assert.equal(budget.used, base + 2);
  dict('Variable.Set', 'v', '[]');
  const empty = budget.used;
  dict('Variable.AppendJSON', 'v', '"a"');
  assert.equal(dict('Variable.PopJSON', 'v'), 'a');
  assert.equal(budget.used, empty);
  dict('Variable.ClearAll');
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: lists account for replacement, removal, and release', () => {
  const { list, budget } = session();
  const ref = list('QuickList.New');
  const empty = budget.used;
  list('QuickList.Push', ref, 'ab');
  assert.equal(budget.used, empty + LIST_SLOT_BYTES + 4);
  list('QuickList.SetValue', ref, 0, 'x');
  assert.equal(budget.used, empty + LIST_SLOT_BYTES + 2);
  list('QuickList.AddMultiValue', ref, 'a\rbb', 2);
  assert.equal(budget.used, empty + 5 * LIST_SLOT_BYTES + 14);
  list('QuickList.InsertValue', ref, 1, 'xx');
  list('QuickList.Remove', ref, 1);
  list('QuickList.RemoveValue', ref, 'bb');
  list('QuickList.Pop', ref);
  list('QuickList.PopFirst', ref);
  assert.equal(budget.used, empty + 2 * LIST_SLOT_BYTES + 4);
  list('QuickList.Clear', ref);
  assert.equal(budget.used, empty);
  list('QuickList.Release', ref);
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: named list replacement and moves are atomic', () => {
  const { list, budget } = session(512);
  const ref = list('QuickList.New', 'a\rbb', '', 'named');
  const used = budget.used;
  for (const [operation, args] of [
    ['QuickList.New', ['x'.repeat(300), '', 'named']],
    ['QuickList.SetValue', [ref, 0, 'x'.repeat(300)]],
    ['QuickList.AddMultiValue', [ref, 'x', 100]],
    ['QuickList.AddPrefix', [ref, 'x'.repeat(110)]],
  ] as const) {
    assert.throws(() => list(operation, ...args), /memory limit/);
    assert.equal(budget.used, used);
    assert.equal(list('QuickList.GetList', ref, 1), 'a\rbb');
  }
  const moved = list('QuickList.MatchesPrefix', ref, 'a', 2);
  assert.equal(list('QuickList.GetList', ref, 1), 'bb');
  assert.equal(list('QuickList.GetList', moved, 1), 'a');
  list('QuickList.Release', moved);
  list('QuickList.New', 'z', '', 'named');
  assert.equal(budget.used, used - LIST_SLOT_BYTES - 4);
  list('QuickList.Release', ref);
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: failed move and clone preserve lists', () => {
  const { list, budget } = session(100);
  const ref = list('QuickList.New', 'a');
  const used = budget.used;
  assert.throws(() => list('QuickList.MatchesPrefix', ref, 'a', 2), /memory limit/);
  assert.throws(() => list('QuickList.Clone', ref), /memory limit/);
  assert.equal(list('QuickList.GetValue', ref, 0), 'a');
  assert.equal(list('QuickList.List'), String(ref));
  assert.equal(budget.used, used);
});

test('AR-calc-extensions-06: dictionary values and tags refund independently', () => {
  const { dict, budget } = session();
  const ref = dict('Dictionary.CreateNamed', 'd');
  const empty = budget.used;
  dict('Dictionary.SetValueForKey', ref, 'k', 'abcd');
  const withKey = budget.used;
  dict('Dictionary.SetValueForKey', ref, 'k', 'a');
  assert.equal(budget.used, withKey - 6);
  dict('Dictionary.SetTag', ref, 'tag');
  assert.equal(budget.used, withKey);
  dict('Dictionary.Clear', ref);
  assert.equal(budget.used, empty + 6);
  dict('Dictionary.SetTag', ref, '');
  assert.equal(budget.used, empty);
  dict('Dictionary.SetValueForKey', ref, 'k', 'abcd');
  dict('Dictionary.RemoveKey', ref, 'k');
  assert.equal(budget.used, empty);
  dict('Dictionary.Release', ref);
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: dictionary bulk writes and named replacement are atomic', () => {
  const { dict, list, budget } = session(1024);
  const ref = dict('Dictionary.CreateNamed', 'd', 'old', 'value');
  const other = dict('Dictionary.Create', 'one', '1', 'two', '2');
  const q = list('QuickList.New', 'one=1\rtwo=2');
  const used = budget.used;
  for (const [name, args] of [
    ['Dictionary.AddDictionary', [ref, other]],
    ['Dictionary.SetList', [ref, 'one=1\rtwo=2', '=']],
    ['Dictionary.SetQuickList', [ref, q, '=']],
    ['Dictionary.SetTag', [ref, 'x'.repeat(512)]],
    ['Dictionary.CreateNamed', ['d', 'key', 'x'.repeat(512)]],
    ['Dictionary.Clone', [ref]],
  ] as const) {
    assert.throws(() => dict(name, ...args), /memory limit/);
    assert.equal(dict('Dictionary.Keys', ref), 'old');
    assert.equal(dict('Dictionary.GetTag', ref), '');
    assert.equal(budget.used, used);
  }
  dict('Dictionary.ReleaseAll');
  list('QuickList.Release', q);
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: families share one session budget and isolate sessions', () => {
  const { scope, dict, list, regex, budget } = session(1024);
  dict('Variable.Set', 'v', 'a');
  const vBytes = budget.used;
  const q = list('QuickList.New', 'b');
  const d = dict('Dictionary.Create', 'k', 'c');
  dict('Dictionary.SetTag', d, 'tag');
  const r = regex('Regex.Compile', '(a+)');
  regex('Regex.Execute', r, 'aa');
  const used = budget.used;
  assert.throws(() => dict('Variable.Append', 'v', 'x'.repeat(200)), /memory limit/);
  assert.equal(budget.used, used);
  assert.equal(retainedBudget(scope), budget);
  const separate = session(1024);
  separate.dict('Variable.Set', 'v', 'x'.repeat(200));
  assert.equal(budget.used, used);
  dict('Dictionary.ReleaseAll');
  list('QuickList.Release', q);
  regex('Regex.ReleaseAll');
  assert.equal(budget.used, vBytes);
  dict('Variable.Reset');
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: binary backing buffers and styled values are charged', () => {
  const { dict, budget } = session(512);
  assert.throws(() => dict('Variable.Set', 'v', { type: 'container', value: 'file', data: new Uint8Array(1024).subarray(0, 1) }), /memory limit/);
  assert.equal(budget.used, 0);
  const styled: Value = { type: 'text', value: 'a', runs: [{ start: 0, end: 1, font: 'font', color: '#fff' }] };
  dict('Variable.Set', 'v', styled);
  assert.equal(budget.used, 3 * ENTRY_BYTES + 2 + 2 + 16);
  dict('Variable.ClearAll');
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-07: captures refund on replacement, no match, and release', () => {
  const { regex, budget } = session(1024);
  const a = regex('Regex.Compile', '(?<word>a+)');
  const b = regex('Regex.Compile', '(a+)');
  const compiled = budget.used;
  regex('Regex.Execute', a, 'a');
  const first = budget.used;
  regex('Regex.Execute', a, 'aa');
  assert.equal(budget.used, first + 6);
  regex('Regex.Execute', b, 'a');
  const used = budget.used;
  assert.throws(() => regex('Regex.Execute', a, 'a'.repeat(200)), /memory limit/);
  assert.equal(regex('Regex.NamedSubstring', a, 'word'), 'aa');
  assert.equal(budget.used, used);
  assert.throws(() => regex('Regex.Release', `${a}\r99999`), /Invalid/);
  assert.equal(budget.used, used);
  regex('Regex.Execute', a, 'b');
  regex('Regex.Execute', b, 'b');
  assert.equal(budget.used, compiled);
  regex('Regex.Release', a);
  regex('Regex.Free', b);
  assert.equal(budget.used, 0);
});

test('AR-calc-extensions-06: product refusals preserve refs and accounting', () => {
  const { list, budget } = session(256);
  const a = list('QuickList.New', 'a\rbb');
  const b = list('QuickList.New', 'c\rdd');
  const used = budget.used;
  for (const flags of [0, 1, 2, 3]) {
    assert.throws(() => list('QuickList.CrossProduct', a, b, 'x'.repeat(100), '', '', flags), /memory limit/);
    assert.equal(list('QuickList.GetList', a, 1), 'a\rbb');
    assert.equal(list('QuickList.GetList', b, 1), 'c\rdd');
    assert.equal(budget.used, used);
  }
  list('QuickList.Release', b);
  assert.equal(list('QuickList.New'), Number(b) + 1);
});

test('AR-calc-extensions-06: clone, named replacement, and sorting keep exact totals', () => {
  const { list, dict, budget } = session();
  const a = list('QuickList.New', 'bb\ra');
  const used = budget.used;
  const b = list('QuickList.Clone', a);
  assert.equal(budget.used, used * 2);
  list('QuickList.SortWith', a, 0, b);
  assert.equal(budget.used, used * 2);
  list('QuickList.Release', a);
  list('QuickList.Release', b);
  assert.equal(budget.used, 0);
  dict('Dictionary.CreateNamed', 'd', 'key', 'value');
  dict('Dictionary.SetTag', 'd', 'tag');
  const dBytes = budget.used;
  const clone = dict('Dictionary.Clone', 'd');
  assert.equal(budget.used, dBytes * 2 + (String(clone).length - 1) * 2);
  dict('Dictionary.Release', clone);
  dict('Dictionary.CreateNamed', 'd');
  const empty = budget.used;
  dict('Dictionary.SetValueForKey', 'd', 'key', 'value');
  dict('Dictionary.Clear', 'd');
  assert.equal(budget.used, empty);
  dict('Dictionary.ReleaseAll');
  assert.equal(budget.used, 0);
});
