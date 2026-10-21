import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { evaluate, evaluateText, Env, parse, text } from '../src/index.ts';
import { guardedAll, guardedMatches, guardedReplace, guardedSplit } from '../src/regex-guard.ts';
import { MAX_TEXT_RESULT, substituteText } from '../src/text-budget.ts';

// Generated inputs only. No processes, files, network or external programs.
// The engine's deadline counts the CPU time of the thread that evaluates (see calculationTime in evaluate.ts), so the
// tests measure with that clock too: wall time also counts the moments a busy or shared machine, a three-core CI
// runner running four test files at once for one, has taken the thread off its core, and says nothing about the engine.
const cpuNow = (): number => {
  if (typeof process.threadCpuUsage === 'function') {
    const { user, system } = process.threadCpuUsage();
    return (user + system) / 1000;
  }
  return performance.now();
};
const budget = (run: () => void, runaways = 1) => {
  const start = cpuNow();
  run();
  // Each runaway formula ends at the step cap or the 2,500 ms deadline; anything slower is a regression.
  assert.ok(cpuNow() - start < 2500 * runaways + 1500, 'work budget regression');
};
const context = (values: Record<string, string>) => ({ variable: (name: string) => text(values[name] ?? '') });

test('Substitute refuses exponential expansion before allocating the result', () => budget(() => {
  const pairs = Array.from({ length: 30 }, () => '["a"; "aa"]').join(';');
  assert.throws(() => evaluateText(`Substitute("a"; ${pairs})`), /Too many text matches|too large/);
  assert.throws(() => substituteText('a'.repeat(100_000), 'a', 'b'.repeat(100)), RangeError);
  assert.equal(substituteText('a', 'a', '$&'), '$&');
  assert.equal(substituteText('aaa', 'aa', 'b'), 'ba');
  assert.equal(substituteText('unchanged', '', 'x'), 'unchanged');
  assert.equal(evaluateText('Substitute("ab"; ["a"; "b"]; ["b"; "c"])'), 'cc');
}));

test('regex replacement bounds plain, capture, prefix and suffix expansion', () => budget(() => {
  const input = 'a'.repeat(100_000);
  for (const replacement of ['x'.repeat(10_000), '$`', "$'", '$&'.repeat(1000)]) {
    assert.throws(() => guardedReplace(/a/g, input, replacement), RangeError);
  }
  assert.throws(() => guardedReplace(/(a+)/, input, '$1'.repeat(100)), RangeError);
  assert.equal(guardedReplace(/a/g, input, '$&'), input);
}));

test('bounded replacement retains JavaScript token and empty-match semantics', () => {
  const templates = ['$$', '$&', '$`', "$'", '$0', '$01', '$10', '$12', '$99', '$<x>', '$<missing>', '$<unclosed', '$1$2', 'literal$'];
  for (const pattern of [/(?<x>a)(b)?/g, /(a)(b)?/, /(?:)/gu, /a/y, /a/g]) {
    for (const replacement of templates) {
      const input = 'ab😀ac';
      const expected = input.replace(new RegExp(pattern.source, pattern.flags), replacement);
      assert.equal(guardedReplace(new RegExp(pattern.source, pattern.flags), input, replacement), expected);
    }
  }
});

test('regex split, match lists and capture batches bound allocation counts', () => budget(() => {
  assert.throws(() => guardedSplit(/()/, 'a'.repeat(200_000)), /Too many text matches/);
  assert.throws(() => guardedMatches(/(?:)/g, 'a'.repeat(250_000)), /Too many text matches/);
  const re = new RegExp('()'.repeat(100), 'g');
  assert.throws(() => {
    for (const _ of guardedAll(re, 'a'.repeat(10_000), { notEmpty: false, anchored: false, notEmptyAtStart: false })) { /* consume */ }
  }, /Too many regular expression captures/);
}));

test('MBS expansion rejects oversized captures and cumulative results without changing its reference', () => budget(() => {
  const ctx = context({ $input: 'a'.repeat(100_000), $replacement: '\\1'.repeat(100), $plain: 'x'.repeat(10_000) });
  for (const formula of [
    'MBS("RegEx.Extract"; $input; "(a+)"; $replacement; "greedy")',
    'MBS("RegEx.ReplaceAll"; $input; "a"; $plain)',
  ]) assert.match(evaluateText(formula, ctx), /^\[MBS\] ERROR: .*too large/);
  const scope = {};
  const c = { ...ctx, pluginSession: scope };
  const ref = evaluateText('MBS("RegEx.Compile"; "(a+)"; "greedy")', c);
  assert.match(ref, /^\d+$/);
  assert.equal(evaluateText(`MBS("RegEx.Pattern"; ${ref})`, c), '(a+)');
  const pattern = '('.repeat(100) + 'a+' + ')'.repeat(100);
  const captures = evaluateText(`MBS("RegEx.Compile"; "${pattern}")`, c);
  assert.match(evaluateText(`MBS("RegEx.FindMatches"; ${captures}; $input)`, c), /^\[MBS\] ERROR: .*too large/);
  assert.equal(evaluateText(`MBS("RegEx.Pattern"; ${captures})`, c), pattern);
  assert.equal(evaluateText(`MBS("RegEx.FindMatches"; ${captures}; "a")`, c), 'a\r'.repeat(100));
  assert.equal(evaluateText('MBS("RegEx.ReplaceAll"; "aba"; "a"; "x")', c), 'xbx');
}));

test('nested Evaluate and error inspection share a finite formula work budget', () => budget(() => {
  const loop = 'SetRecursion(While([i=0]; i < 1000000000; [i=i+1]; i); 1000000000)';
  for (const formula of [loop, `EvaluationError(${loop})`, `Evaluate($source)`]) {
    // On a loaded machine the clock can stop the loop before the step cap does, and the While message is used then.
    assert.throws(() => evaluate(formula, context({ $source: loop })), /work budget|While ran more than/);
  }
}, 3));

test('repeated MBS calls share the enclosing formula regex deadline', () => {
  const start = performance.now();
  const result = evaluateText('While([i=0]; i<6; [r=MBS("RegEx.Match"; "^(a+)+$"; $input); i=i+1]; i)', context({ $input: 'a'.repeat(45) + '!' }));
  assert.ok(result === '6' || result === '?');
  assert.ok(performance.now() - start < 1800, 'six fresh per-call budgets would take three seconds');
});

test('reused Env resets its budget after failure and custom recursion remains bounded', () => budget(() => {
  const env = new Env({});
  assert.throws(() => env.v(parse('SetRecursion(While([i=0]; 1; [i=i+1]; i); 1000000000)')), /work budget|While ran more than/);
  assert.equal(env.v(parse('1+1')).value, 2);
  assert.equal(evaluateText('Recur(100000)', { customFunction: () => ({ parameters: ['n'], formula: 'If(n=0; 0; Recur(n-1))' }) }), '?');
}));

test('an idle Env starts a fresh work budget when evaluation begins', async () => {
  const env = new Env({});
  await sleep(1500);
  assert.equal(env.v(parse('While([i=0]; i<2; [i=i+1]; i)')).value, 2);
  assert.equal(env.v(parse('While([i=0]; i<2; [i=i+1]; i)')).value, 2);
});

test('generated ordinary text at audit sizes stays within budget', () => {
  for (const n of [10, 1000, 100_000]) budget(() => {
    const input = 'a'.repeat(n);
    const ctx = context({ $input: input });
    assert.equal(evaluateText('PatternCount($input; "a")', ctx), String(n));
    assert.equal(evaluateText('Filter($input; "a")', ctx).length, n);
    assert.equal(evaluateText('Substitute($input; "a"; "b")', ctx).length, n);
  });
  assert.ok(MAX_TEXT_RESULT < 10_000_000);
});

test('regex time is counted only while a regex runs, so other slow work cannot use up the allowance', () => budget(() => {
  const formula = 'Let([b = While([s="ab"]; Length(s) < 4000000; [s = s & s]; s); w = Length(Filter(b;"b")) + Length(Filter(b;"b")) + Length(Filter(b;"b")) + Length(Filter(b;"b")) + Length(Filter(b;"b")) + Length(Filter(b;"b"))]; w & "|" & MBS("RegEx.Match";"a";"a") & "|" & MBS("RegEx.ReplaceAll";"abc";"b";"x"))';
  assert.equal(evaluateText(formula, context({})), '12582912|1|axc');
}));

test('many expensive built-in calls stop at the deadline, not after the next 1,024 steps', () => {
  const start = cpuNow();
  const formula = 'Let(b = While([s="ab"]; Length(s) < 4000000; [s = s & s]; s); ' + Array.from({ length: 150 }, () => 'Length(Filter(b;"b"))').join(' + ') + ')';
  assert.throws(() => evaluateText(formula, context({})), /work budget/);
  // One Filter of the 4 MB text takes about 200 ms, so a clock read only every 1,024 steps lets all 150 run (30 s of CPU).
  assert.ok(cpuNow() - start < 6000, 'the clock is read at every function call');
});

test('substitution that does not grow the text is not refused for its match count or an unmatched large input', () => {
  const big = 'a'.repeat(600_000);
  assert.equal(evaluateText('Length(Substitute($t; "a"; "x"))', context({ $t: big })), '600000');
  assert.equal(evaluateText('Length(Substitute($t; "zzz"; ""))', context({ $t: 'a'.repeat(MAX_TEXT_RESULT + 200_000) })), String(MAX_TEXT_RESULT + 200_000));
});

test('a moderately recursive calculation still runs inside the step budget', () => budget(() => {
  const custom = { customFunction: (name: string) => name === 'Fib' ? { parameters: ['n'], formula: 'If(n < 2; n; Fib(n - 1) + Fib(n - 2))' } : undefined };
  assert.equal(evaluateText('Fib(22)', custom), '17711');
}));
