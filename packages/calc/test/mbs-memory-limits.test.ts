import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function isolated(body: string): void {
  const run = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { evaluateText } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)};
    const ctx = { pluginSession: {} };
    const call = (name, ...args) => {
      ctx.field = ({ field }) => ({ type: 'text', value: String(args[Number(field.slice(1))]) });
      return evaluateText('MBS ( "' + name + '"' + args.map((_, i) => ' ; p' + i).join('') + ' )', ctx);
    };
    ${body}
  `], { timeout: 15_000, encoding: 'utf8', maxBuffer: 32_000 });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 0, run.stderr);
}

test('AR-calc-extensions-06: replacement limit', () => isolated(`
  assert.match(call('Text.ReplaceAll', 'a'.repeat(1000), 'a', 'b'.repeat(8100)), /too large/);
  assert.equal(call('IsError'), '1');
`));

test('AR-calc-extensions-06: QuickList growth preserves state', () => isolated(`
  const ref = call('QuickList.New', 'a');
  let refused = false;
  for (let i = 0; i < 24; i++) {
    const old = call('QuickList.GetValue', ref, 0);
    const result = call('QuickList.AddPrefix', ref, old);
    if (result !== 'OK') {
      assert.match(result, /too large|memory limit/);
      assert.equal(call('QuickList.GetValue', ref, 0), old);
      refused = true;
      break;
    }
  }
  assert.equal(refused, true);
`));

test('AR-calc-extensions-06: cross product limit', () => isolated(`
  assert.match(call('List.CrossProduct', 'a'.repeat(4000000), 'b\\rc'), /too large/);
`));

test('AR-calc-extensions-07: captures preserve previous result', () => isolated(`
  const ref = call('Regex.Compile', '('.repeat(64) + 'a+' + ')'.repeat(64));
  assert.equal(call('Regex.Execute', ref, 'a'), '65');
  assert.match(call('Regex.Execute', ref, 'a'.repeat(130000)), /too large/);
  assert.equal(call('Regex.SubstringList', ref), Array(65).fill('a').join('\\r'));
`));

test('AR-calc-extensions-06: replacement boundaries and literal semantics', () => isolated(`
  const input = 'a'.repeat(8000000);
  assert.equal(call('Text.ReplaceAll', input, 'b', 'c').length, 8000000);
  assert.equal(call('Text.ReplaceAll', input, '', 'c').length, 8000000);
  assert.equal(call('Text.ReplaceAll', input + 'a', 'aa', 'b').length, 4000001);
  assert.match(call('Text.ReplaceAll', input + 'a', 'b', 'c'), /too large/);
  assert.match(call('Text.ReplaceAll', input + 'a', '', 'c'), /too large/);
  assert.equal(call('Text.ReplaceAll', 'a', 'a', '$&'), '$&');
`));

test('AR-calc-extensions-06: retained text boundaries', () => isolated(`
  const ref = call('Dictionary.Create');
  const input = 'a'.repeat(8000000);
  assert.equal(call('Dictionary.SetValueForKey', ref, 'key', input), 'OK');
  assert.match(call('Dictionary.SetValueForKey', ref, 'key', input + 'a'), /too large/);
  assert.equal(call('Dictionary.ValueForKey', ref, 'key').length, 8000000);
  assert.equal(call('Dictionary.SetTag', ref, 'old'), 'OK');
  assert.match(call('Dictionary.SetTag', ref, input + 'a'), /too large/);
  assert.equal(call('Dictionary.GetTag', ref), 'old');
  assert.equal(call('Variable.Set', 'v', 'old'), 'OK');
  assert.match(call('Variable.Set', 'v', input + 'a'), /too large/);
  assert.equal(call('Variable.Get', 'v'), 'old');
  const list = call('QuickList.New', input);
  assert.match(call('QuickList.AddValue', list, 'a'), /too large/);
  assert.equal(call('QuickList.Count', list), '1');
  assert.equal(call('QuickList.GetList', list, 1).length, 8000000);
  assert.match(call('QuickList.GetList', list), /too large/);
  assert.match(call('QuickList.JSONArray', list), /too large/);
  assert.match(call('QuickList.Serialize', list), /too large/);
`));

test('AR-calc-extensions-06: diagonal products and expanded list formatting', () => isolated(`
  assert.match(call('List.CrossProduct', 'a\\rb', 'c\\rd', 'x'.repeat(4000000), '', '', 2), /too large/);
  const a = call('QuickList.New', 'a\\rb');
  const b = call('QuickList.New', 'c\\rd');
  assert.match(call('QuickList.CrossProduct', a, b, 'x'.repeat(4000000), '', '', 2), /too large/);
  assert.equal(call('QuickList.GetList', a, 1), 'a\\rb');
  const quoted = call('QuickList.New', '\\u0000'.repeat(1400000));
  assert.match(call('QuickList.JSONArray', quoted), /too large/);
  assert.match(call('QuickList.GetList', a, 0, 'x'.repeat(4000000)), /too large/);
`));

test('AR-calc-extensions-07: named aliases count toward aggregate captures', () => isolated(`
  const pattern = Array.from({ length: 32 }, (_, i) => '(?<g' + i + '>').join('') + 'a+' + ')'.repeat(32);
  const ref = call('Regex.Compile', pattern);
  assert.equal(call('Regex.Execute', ref, 'a'), '33');
  assert.match(call('Regex.Execute', ref, 'a'.repeat(130000)), /too large/);
  assert.equal(call('Regex.NamedSubstring', ref, 'g0'), 'a');
`));

test('AR-calc-extensions-07: capture-list delimiters fit the result budget', () => isolated(`
  const ref = call('Regex.Compile', '('.repeat(64) + 'a+' + ')'.repeat(64));
  assert.equal(call('Regex.Execute', ref, 'a'.repeat(123075)), '65');
  assert.equal(call('Regex.SubstringList', ref).length, 7999939);
  assert.match(call('Regex.Execute', ref, 'a'.repeat(123076)), /too large/);
  assert.equal(call('Regex.SubstringList', ref).length, 7999939);
`));

test('AR-calc-extensions-07: shared regex capture guards', () => isolated(`
  const { guardedExec, guardedAll } = await import(${JSON.stringify(new URL('../src/regex-guard.ts', import.meta.url).href)});
  const pattern = new RegExp('('.repeat(64) + 'a+' + ')'.repeat(64), 'g');
  assert.throws(() => guardedExec(pattern, 'a'.repeat(130000)), /too large/);
  const options = { notEmpty: false, anchored: false, notEmptyAtStart: false };
  assert.throws(() => [...guardedAll(pattern, 'a'.repeat(1000) + 'b' + 'a'.repeat(123000), options)], /too large/);
`));

test('AR-calc-extensions-06: repeated list edits retain accurate accounting', () => isolated(`
  const { MBS_QUICKLIST } = await import(${JSON.stringify(new URL('../src/mbs-quicklist.ts', import.meta.url).href)});
  const { retainedBudget } = await import(${JSON.stringify(new URL('../src/retained-budget.ts', import.meta.url).href)});
  const scope = {};
  const ref = String(MBS_QUICKLIST['quicklist.new']([], scope));
  for (let i = 0; i < 100000; i++) MBS_QUICKLIST['quicklist.push']([ref, 'ab'], scope);
  assert.equal(MBS_QUICKLIST['quicklist.count']([ref], scope), 100000);
  for (let i = 0; i < 100000; i++) assert.equal(MBS_QUICKLIST['quicklist.pop']([ref], scope), 'ab');
  MBS_QUICKLIST['quicklist.release']([ref], scope);
  assert.equal(retainedBudget(scope).used, 0);
`));
