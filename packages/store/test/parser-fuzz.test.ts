// Deterministic, dependency-free parser fuzzing. Run with Node >=22.20:
// node --test packages/store/test/parser-fuzz.test.ts
// Workers enforce deadlines even when a synchronous parser never yields. A failure
// includes its seed/index and escaped input (large stress cases have a recipe).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Node as CalcNode } from '../../calc/src/parser.ts';
import type { Schema } from '../../fmp12/src/schema.ts';
import type { StepSpec } from '../src/design.ts';

type Target = 'calc' | 'script' | 'sql';
type Case = { id: string; input: string; tree?: CalcNode | StepSpec[]; sql?: string; unchanged?: boolean };
type Result = { error?: string; domain?: boolean; ms: number; heap: number };
const SEEDS = [1, 0x12345678, 0xdeadbeef, 0xc0ffee];
const LIMIT_MS = 2_000;
const HEAP_MB = 128;
// The main thread's V8 stack (~1 MB), not the worker default of 4 MB, so recursion depth matches production.
const STACK_MB = 1;

// Known, unfixed findings (see the audit report). A matching case is expected to fail with
// `error`; if it starts passing, the test fails so this list is pruned when a fix lands.
// `optional` marks a broad cluster where only some members fail.
const KNOWN: { finding: string; id: RegExp; input?: RegExp; error: RegExp; optional?: true }[] = [
  { finding: 'F2 Exit Script empty result cosmetic round-trip', id: /^(step\/|edge\/)/, input: /^Exit Script \[ (Select )?; \]$/, error: /script printer fixpoint/ },
  { finding: 'F8 script lossy parse of option-only brackets', id: /^step\//, error: /script print\/parse tree/, optional: true },
  { finding: 'F9 calc nodeText printer is lossy', id: /./, error: /calc nodeText print\/parse tree|"=" expected/, optional: true },
];
const known = (c: Case) => KNOWN.filter((k) => k.id.test(c.id) && (!k.input || k.input.test(c.input)));

// Mulberry32: unsigned 32-bit state, no global randomness or dependencies.
function random(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    let x = state = (state + 0x6d2b79f5) >>> 0;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return Math.floor(((x ^ (x >>> 14)) >>> 0) / 0x100000000 * n);
  };
}
// No diff rendering: deepEqual's diff of large trees costs seconds, and the case id carries the input.
const same = (actual: unknown, expected: unknown, message: string) => assert.ok(isDeepStrictEqual(actual, expected), message);
const quote = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '¶') + '"';

// A fully parenthesized test printer: the parser's own oracle, covering the whole AST including
// Let/While bindings. The shipped printer (explain.ts nodeText) is checked separately below.
function printCalc(n: CalcNode): string {
  const bindings = (b: Extract<CalcNode, { k: 'let' }>['binds']) =>
    '[' + b.map(([name, value, rep]) => `${name}${rep ? `[${printCalc(rep)}]` : ''} = ${printCalc(value)}`).join(';') + ']';
  switch (n.k) {
    // SetPrecision needs the original decimal spelling, which can differ from the double.
    case 'num': return n.raw ?? (n.exact !== undefined ? String(n.exact) : Number.isFinite(n.value) ? String(n.value) : '1e999');
    case 'str': return quote(n.value);
    case 'field': return `${n.occurrence === undefined ? '' : n.occurrence + '::'}${n.name}${n.rep ? `[${printCalc(n.rep)}]` : ''}`;
    case 'var': return n.name + (n.rep ? `[${printCalc(n.rep)}]` : '');
    case 'get': return `Get(${n.param})`;
    case 'unary': return `(${n.op} ${printCalc(n.a)})`;
    case 'bin': return `(${printCalc(n.a)} ${n.op} ${printCalc(n.b)})`;
    case 'let': return `Let(${bindings(n.binds)};${printCalc(n.body)})`;
    case 'call':
      if (n.name === '[]') return '[' + n.args.map(printCalc).join(';') + ']';
      if (n.name === 'While' && n.args[0]?.k === 'let' && n.args[1]?.k === 'let') {
        return `While(${bindings(n.args[0].binds)};${printCalc(n.args[0].body)};${bindings(n.args[1].binds)};${printCalc(n.args[1].body)})`;
      }
      return n.name + '(' + n.args.map(printCalc).join(';') + ')';
    default: throw new Error('Parser returned a value outside the CalcNode union');
  }
}

function expression(r: (n: number) => number, depth = 0): CalcNode {
  if (depth === 4 || r(3) === 0) {
    return r(2) ? { k: 'num', value: r(10000) } : { k: 'str', value: ['a;[]', '"\\', '\ud800', '\udfff', '\0', '\r', 'é'][r(7)] };
  }
  if (r(4) === 0) return { k: 'unary', op: ['-', '+', 'not'][r(3)], a: expression(r, depth + 1) };
  return { k: 'bin', op: ['+', '-', '*', '/', '^', '&', '=', '<', 'and', 'or'][r(10)], a: expression(r, depth + 1), b: expression(r, depth + 1) };
}

function mutate(input: string, r: (n: number) => number): string {
  const at = r(input.length + 1);
  const fragments = ['"', "'", '(', ')', '[', ']', '/*', '*/', '//', '\0', '\ud800', '\udfff', ';', '\n', '9'.repeat(500), 'x'.repeat(2048)];
  switch (r(4)) {
    case 0: return input.slice(0, at) + input.slice(at + 1);
    case 1: return input.slice(0, at);
    case 2: return input.slice(0, at) + fragments[r(fragments.length)] + input.slice(at);
    default: return fragments[r(fragments.length)] + input + fragments[r(fragments.length)];
  }
}

function corpus(target: Target, stepNames: readonly string[] = []): Case[] {
  const out: Case[] = [];
  const add = (id: string, input: string, extra: Partial<Case> = {}) => out.push({ id, input, ...extra });
  const basics: Record<Target, string[]> = {
    calc: ['', '1', '1e999', '12345678901234567890', 'Pi()', '9'.repeat(401), 'constructor', '__proto__', 'toString', 'Let([x=1;y=2];x+y)', 'While([x=0];x<2;[x=x+1];x)', 'Get(FoundCount)', 'T::Field[2]', 'Substitute("a";["a";"b"])', '1+2*3', '2^3^2', 'not 1=0', '/* /* x */ y */ 1', '"', '/*', '\0', '\ud800', ':'],
    script: ['', '# a', 'Set Variable [ $x ; Value: 1 ]', 'Set Field [ Select ]', 'Insert Text [ Select ]', 'Replace Field Contents [ With dialog: Off ]', 'If [ 1 ]\nElse\nEnd If', 'Loop\nExit Loop If [ 1 ]\nEnd Loop', 'Exit Script [ Text Result: "a;[]" ]', 'Go to Record/Request/Page [ Next ; Exit after last ]', 'Refresh Window [ Flush cached join results ]', 'Set Variable [ $x ; Value: "', '/*', '\0', '\ud800'],
    sql: ['', 'SELECT 1', "SELECT DATE '2024-2-3'", "SELECT POSITION('a' IN 'cat')", "SELECT 'ROWMODID'", "SELECT 'POSITION(a IN b)'", "SELECT 'EXTRACT(YEAR FROM x)'", "SELECT DATE '2024-1-1' + INTERVAL 1 DAY", "SELECT 'CURRENT_DATE'", '/*', "SELECT '", '\0', '\ud800'],
  };
  basics[target].forEach((input, i) => add(`edge/${i}`, input));
  // Every step name with empty and option-only brackets: missing targets and parameters.
  if (target === 'script') {
    for (const name of stepNames) {
      for (const tail of ['', ' [ ]', ' [ Select ]', ' [ ; ]', ' [ Select ; ]', ' [ Create folders: On ]', ' [ With dialog: Off ]', ' [ "', ' [ $ ]', ' [ :: ]']) add(`step/${name}${tail}`, name + tail);
    }
  }
  for (const seed of SEEDS) {
    const r = random(seed);
    for (let i = 0; i < 64; i++) {
      const id = `seed=${seed}/case=${i}`;
      let input: string;
      if (target === 'calc') {
        const tree = expression(r);
        input = printCalc(tree);
        add(id + '/generated', input, { tree });
        add(id + '/whitespace', ` /* fuzz */ ${input} // end`, { tree });
      } else if (target === 'script') {
        const value = printCalc(expression(r));
        const name = `$v${r(1000)}`;
        const enabled = !!r(2);
        input = `${enabled ? '' : '// '}Set Variable [ ${name} ; Value: ${value} ]`;
        add(id + '/generated', input, { tree: [{ stepId: 141, enabled, params: { variable: name, value } }] });
        add(id + '/crlf', `If [ 1 ]\r\n${input}\r\nEnd If`);
      } else {
        const year = 2000 + r(30), month = 1 + r(12), day = 1 + r(28);
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const literal = `${year}-${month}-${day}`;
        input = `SELECT ${r(2) ? `{d '${literal}'}` : `DATE '${literal}'`}`;
        add(id + '/generated', input, { sql: `SELECT '${iso}'` });
        const text = ['ROWMODID', 'POSITION(a IN b)', 'EXTRACT(YEAR FROM x)', 'CURRENT_DATE', "a'b", '\ud800', '\0'][r(7)];
        const quoted = "'" + text.replace(/'/g, "''") + "'";
        add(id + '/quoted', `SELECT ${quoted}`, { unchanged: true });
        const count = r(20);
        add(id + '/position', `SELECT POSITION('a' IN '${'b'.repeat(count)}a')`, { sql: `SELECT ${count + 1}` });
      }
      add(id + '/mutated', mutate(input, r));
      const alphabet = 'a0 ()[];"\'/*+-:\n\0\ud800\udfff';
      add(id + '/random', Array.from({ length: r(100) }, () => alphabet[r(alphabet.length)]).join(''));
    }
  }
  // Bounded input sizes; stress cases carry compact, deterministic reproducer recipes.
  add('stress/identifier: "x".repeat(65536)', 'x'.repeat(65536));
  add('stress/number: "9".repeat(65536)', '9'.repeat(65536));
  add('stress/comment: "/*" + "x".repeat(65536)', '/*' + 'x'.repeat(65536));
  if (target === 'calc') {
    add('stress/nesting: "(".repeat(12000) + "0" + ")".repeat(12000)', '('.repeat(12000) + '0' + ')'.repeat(12000));
    add('stress/unary: "-".repeat(12000) + "0"', '-'.repeat(12000) + '0');
    add('stress/calls: "Abs(".repeat(3000) + "0" + ")".repeat(3000)', 'Abs('.repeat(3000) + '0' + ')'.repeat(3000));
    add('stress/lists: "[".repeat(4000) + "0" + "]".repeat(4000)', '['.repeat(4000) + '0' + ']'.repeat(4000));
  }
  if (target === 'script') {
    add('stress/multiline: "If [\\n" + "0\\n".repeat(30000) + "]"', 'If [\n' + '0\n'.repeat(30000) + ']');
    add('stress/unterminated-quote: \'Set Variable [ $x ; Value: "\\n\' + "] ;\\n".repeat(30000)', 'Set Variable [ $x ; Value: "\n' + '] ;\n'.repeat(30000));
  }
  if (target === 'sql') {
    add('stress/nesting: "POSITION(".repeat(12000)', 'POSITION('.repeat(12000));
    add('stress/interval: "SELECT " + "\'x\' ".repeat(3000) + " + INTERVAL 1 DAY".repeat(3000)', 'SELECT ' + "'x' ".repeat(3000) + ' + INTERVAL 1 DAY'.repeat(3000));
  }
  return out;
}

async function checker(target: Target): Promise<(c: Case) => boolean> {
  if (target === 'calc') {
    const { parse } = await import('../../calc/src/parser.ts');
    const { CalcError } = await import('../../calc/src/values.ts');
    const { nodeText } = await import('../../calc/src/explain.ts');
    return (c) => {
      let tree: CalcNode;
      try { tree = parse(c.input); } catch (e) {
        if (e instanceof CalcError && c.tree === undefined) return true;
        throw e;
      }
      if (c.tree !== undefined) same(tree, c.tree, 'generated AST oracle');
      same(parse(printCalc(tree)), tree, 'calc print/parse tree');
      same(parse(nodeText(tree)), tree, 'calc nodeText print/parse tree');
      return false;
    };
  }
  if (target === 'script') {
    const { parseScriptText } = await import('../src/script-text.ts');
    const { DesignError } = await import('../src/design.ts');
    const { scriptText } = await import('../../fmp12/src/script-params.ts');
    const { scriptStepName } = await import('../../fmp12/src/script-steps.ts');
    // No files, store, server, fixtures or execution engine are needed.
    const schema = { tables: [], tableOccurrences: [], relationships: [], layouts: [], layoutOrder: [], scripts: [], scriptOrder: [], valueLists: [], customFunctions: [], accounts: [], privilegeSets: [], extendedPrivileges: [], dataSources: [], themes: [], fonts: [], customMenus: [], customMenuSets: [] } as unknown as Schema;
    return (c) => {
      let tree: StepSpec[];
      try { tree = parseScriptText(c.input, schema); } catch (e) {
        if (e instanceof DesignError && c.tree === undefined) return true;
        throw e;
      }
      if (c.tree !== undefined) same(tree, c.tree, 'generated script oracle');
      const print = (t: StepSpec[]) => scriptText(t.map((s) => ({ ...s, stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: s.enabled ?? true })));
      const printed = print(tree), again = parseScriptText(printed, schema);
      same(print(again), printed, 'script printer fixpoint');
      same(again, tree, 'script print/parse tree');
      return false;
    };
  }
  const { fileMakerSqlSyntax } = await import('../src/sql-dates.ts');
  const { CalcError, ERR } = await import('../../calc/src/values.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return (c) => {
    let output: string;
    try { output = fileMakerSqlSyntax(c.input); } catch (e) {
      // The shared SQL tokenizer now refuses malformed lexical boundaries.
      // Generated valid SQL and quoted-preservation oracles must still succeed;
      // only malformed fuzz inputs may receive these specific domain errors.
      if (c.sql === undefined && !c.unchanged && e instanceof CalcError && e.code === ERR.calculation
        && /^(?:SQL text contains a NUL byte|Unterminated SQL (?:quote|comment))$/.test(e.message)) return true;
      throw e;
    }
    same(fileMakerSqlSyntax(output), output, 'SQL rewrite idempotence');
    if (c.unchanged) same(output, c.input, 'quoted SQL must be preserved');
    if (c.sql !== undefined) same(db.prepare(output).all().map(Object.values), db.prepare(c.sql).all().map(Object.values), 'SQLite differential result');
    return false;
  };
}

if (!isMainThread) {
  const check = await checker(workerData as Target);
  parentPort!.on('message', (c: Case) => {
    const start = performance.now();
    let result: Result;
    try { result = { domain: check(c), ms: 0, heap: 0 }; } catch (e) {
      result = { error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 1200)}\n${e.stack?.split('\n').slice(1, 6).join('\n')}` : `Non-Error thrown: ${String(e)}`, ms: 0, heap: 0 };
    }
    result.ms = performance.now() - start;
    result.heap = process.memoryUsage().heapUsed;
    parentPort!.postMessage(result);
  });
  parentPort!.postMessage('ready');
} else {
  // Stress cases get their own worker so known 2 s deadlines run alongside the corpus.
  describe('fixed-seed parser fuzzing', { concurrency: 6 }, () => {
    for (const [target, stress] of (['calc', 'script', 'sql'] as const).flatMap((x) => [[x, false], [x, true]] as const)) {
      const label = stress ? `${target} stress` : target;
      test(label, { timeout: 120_000 }, async (t) => {
        const started = performance.now();
        let worker: Worker | undefined;
        let passed = 0, rejected = 0, peakHeap = 0, total = 0, knownFailed = 0;
        const failures: string[] = [], expected = new Set<string>();
        const { SCRIPT_STEP_NAMES } = await import('../../fmp12/src/script-steps.ts');
        const startWorker = async () => {
          worker = new Worker(new URL(import.meta.url), { workerData: target, resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 16, stackSizeMb: STACK_MB } });
          await request(undefined, 5_000);
        };
        // Parent timers can interrupt both synchronous loops and native regex work.
        const request = (c: Case | undefined, ms: number): Promise<Result> => new Promise((resolve, reject) => {
          const w = worker!;
          const done = (error?: Error, result?: Result) => {
            clearTimeout(timer);
            w.off('message', message); w.off('error', errorEvent); w.off('exit', exitEvent);
            if (error) reject(error); else resolve(result!);
          };
          const message = (result: Result) => done(undefined, result);
          const errorEvent = (error: Error) => done(error);
          const exitEvent = (code: number) => done(new Error(`Worker exited (${code})`));
          const timer = setTimeout(() => done(new Error(`Deadline exceeded (${ms} ms)`)), ms);
          w.once('message', message); w.once('error', errorEvent); w.once('exit', exitEvent);
          if (c) w.postMessage(c);
        });
        try {
          await startWorker();
          for (const c of corpus(target, SCRIPT_STEP_NAMES).filter((x) => x.id.startsWith('stress/') === stress)) {
            const ks = known(c);
            total++;
            try {
              const result = await request(c, LIMIT_MS);
              peakHeap = Math.max(peakHeap, result.heap);
              if (result.error) throw new Error(result.error);
              assert.ok(result.ms <= LIMIT_MS, `Parser exceeded ${LIMIT_MS} ms`);
              assert.ok(result.heap <= (HEAP_MB + 16) * 1024 * 1024, 'Worker heap budget exceeded');
              passed++;
              if (result.domain) rejected++;
              for (const k of ks) if (!k.optional) failures.push(`${c.id}: listed as known (${k.finding}) but passed; remove it from KNOWN`);
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e);
              const k = ks.find((x) => x.error.test(error));
              if (k) expected.add(k.finding), knownFailed++;
              else failures.push(`${c.id}; length=${c.input.length}; input=${JSON.stringify(c.input.length <= 300 ? c.input : c.input.slice(0, 150) + '…')}\n${error}`);
              if (/Deadline exceeded|Worker exited|memory limit/i.test(error)) {
                await worker!.terminate();
                await startWorker();
              }
            }
          }
        } finally {
          await worker?.terminate();
        }
        t.diagnostic(`${label}: ${total} cases: ${passed} pass / ${failures.length} fail / ${knownFailed} known-failing; known: ${[...expected].join(', ') || 'none'}; ${rejected} domain rejections; ${(performance.now() - started).toFixed(0)} ms; peak sampled heap ${(peakHeap / 1024 / 1024).toFixed(1)} MiB`);
        assert.equal(failures.length, 0, failures.join('\n\n'));
      });
    }
  });
}
