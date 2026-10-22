/** Zero-dependency, deliberately conservative TypeScript mutation runner.
 * One mutant at a time; production files are never overwritten. See docs/audit-mutation.md.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { tmpdir, getPriority } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export interface Mutation { id: string; line: number; kind: string; start: number; end: number; before: string; after: string }
interface Token { text: string; start: number; end: number }

// Templates can contain nested templates inside ${...}. Treat the entire value as opaque.
function templateEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '`') return i + 1;
    if (source.slice(i, i + 2) !== '${') { i++; continue; }
    i += 2;
    let depth = 1;
    while (i < source.length && depth) {
      const c = source[i];
      if (c === '`') { i = templateEnd(source, i); continue; }
      if (c === '"' || c === "'") {
        const quote = c; i++;
        while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
        i++; continue;
      }
      if (source.slice(i, i + 2) === '//') { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
      if (source.slice(i, i + 2) === '/*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      i++;
    }
  }
  return source.length;
}

// Preserve offsets. Strings (including whole templates), comments and regexp literals are opaque.
// This is not a complete JS parser: unsupported syntax is excluded or reported invalid, never counted killed.
export function tokens(source: string): Token[] {
  const out: Token[] = [];
  const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|>>>=|>>=|<<=|>>>|>>|<<|===|!==|==|!=|<=|>=|&&|\|\||\?\?|=>|\+\+|--|\?\.|\S/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const text = match[0], start = match.index;
    if (/^\s|^\/\/|^\/\*/.test(text)) continue;
    if (text.startsWith('`')) {
      pattern.lastIndex = templateEnd(source, start);
      out.push({ text: source.slice(start, pattern.lastIndex), start, end: pattern.lastIndex }); continue;
    }
    // A slash in expression-start position introduces a regexp, not an operator.
    if (text === '/' && (!out.length || /^(?:\(|\[|\{|=|:|,|;|!|&&|\|\||\?\?|return|=>)$/.test(out.at(-1)!.text))) {
      const regex = /^\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+\/[a-z]*/.exec(source.slice(start));
      if (regex) { pattern.lastIndex = start + regex[0].length; out.push({ text: regex[0], start, end: pattern.lastIndex }); continue; }
    }
    out.push({ text, start, end: pattern.lastIndex });
  }
  return out;
}

export function mutations(source: string, rawTemplates: string[] = []): Mutation[] {
  const stripped = stripTypeScriptTypes(source);
  if (stripped.length !== source.length) throw new Error('Type stripping changed source offsets');
  const ts = tokens(stripped), out: Mutation[] = [];
  const flip: Record<string, string> = { '===': '!==', '!==': '===', '==': '!=', '!=': '==', '<': '>=', '>': '<=', '<=': '>', '>=': '<', '&&': '||', '||': '&&' };
  const add = (kind: string, start: number, end: number, after: string) => {
    const line = source.slice(0, start).split('\n').length;
    out.push({ id: `${line}:${kind}:${start}`, line, kind, start, end, before: source.slice(start, end), after });
  };
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (Object.hasOwn(flip, t.text)) add('operator', t.start, t.end, flip[t.text]);
    if (t.text === '!' && ts[i - 1]?.text !== '.') add('boolean', t.start, t.end, '');
    if (t.text === 'if' && ts[i + 1]?.text === '(') {
      let depth = 1, j = i + 2;
      for (; j < ts.length && depth; j++) { if (ts[j].text === '(') depth++; if (ts[j].text === ')') depth--; }
      if (!depth) add('branch', ts[i + 1].end, ts[j - 1].start, 'false');
    }
    if ((t.text === 'return' || t.text === 'throw') && ts[i + 1] && !/[\r\n]/.test(stripped.slice(t.end, ts[i + 1].start))) {
      const stack: string[] = [];
      let j = i + 1;
      for (; j < ts.length; j++) {
        const v = ts[j].text;
        if (!stack.length && j > i + 1 && /[\r\n]/.test(stripped.slice(ts[j - 1].end, ts[j].start))) break;
        if (!stack.length && (v === ';' || v === '}')) break;
        if ('([{'.includes(v) && v.length === 1) stack.push(v);
        if (')]}'.includes(v) && v.length === 1) { if (!stack.length) break; stack.pop(); }
      }
      // Explicitly terminated statements only; avoid swallowing ASI-separated code.
      if (ts[j]?.text === ';' && j > i + 1) {
        if (t.text === 'throw') add('throw', t.start, ts[j].end, ';');
        else add('return', ts[i + 1].start, ts[j].start, stripped.slice(ts[i + 1].start, ts[j].start) === 'undefined' ? 'false' : 'undefined');
      }
    }
  }
  for (const name of rawTemplates) {
    const raw = rawTemplate(source, name);
    for (const m of mutations(raw.source)) add(`raw-${name}-${m.kind}`, raw.start + m.start, raw.start + m.end, m.after);
  }
  return out;
}

export function rawTemplate(source: string, name: string): { start: number; source: string } {
  const ts = tokens(source);
  const index = ts.findIndex((t, i) => t.text.startsWith('`') && ts[i - 1]?.text === 'raw' && ts[i - 2]?.text === '.' && ts[i - 3]?.text === 'String' && ts[i - 4]?.text === '=' && ts[i - 5]?.text === name);
  if (index < 0) throw new Error(`Missing String.raw template ${name}`);
  const raw = ts[index];
  if (raw.text.includes('${')) throw new Error(`Interpolated raw template ${name} is unsupported`);
  return { start: raw.start + 1, source: raw.text.slice(1, -1) };
}

export function syntaxSource(source: string, rawTemplates: string[] = []): string {
  for (const name of rawTemplates) new Script(rawTemplate(source, name).source);
  return stripTypeScriptTypes(source);
}

export function applyMutation(source: string, m: Mutation): string { return source.slice(0, m.start) + m.after + source.slice(m.end); }

export function imports(source: string): string[] {
  // Static imports/re-exports, side-effect imports, literal import() and require(). Type-only
  // edges may overselect a test; no test outside the dependency graph is selected.
  const ts = tokens(source), found: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i].text;
    if (t === 'from' || t === 'import' || t === 'require') {
      const next = ts[i + 1]?.text === '(' ? ts[i + 2] : ts[i + 1];
      if (next && /^['"]/.test(next.text)) found.push(next.text.slice(1, -1));
    }
  }
  return found;
}

export function importingTests(root: string, file: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => { for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && !['node_modules', '.git', 'fixtures', '.github', '.impeccable'].includes(ent.name)) walk(join(dir, ent.name));
    else if (ent.isFile() && ent.name.endsWith('.ts')) files.push(join(dir, ent.name));
  } };
  walk(join(root, 'packages'));
  const known = new Set(files), reverse = new Map<string, string[]>();
  for (const f of files) for (const spec of imports(readFileSync(f, 'utf8'))) {
    let dep: string;
    if (spec.startsWith('.')) dep = resolve(dirname(f), spec).replace(/\.js$/, '.ts');
    else if (/^@(?:tabularius|openhbam)\/[\w-]+$/.test(spec)) dep = join(root, 'packages', spec.split('/')[1], 'src/index.ts');
    else continue;
    if (known.has(dep)) reverse.set(dep, [...(reverse.get(dep) ?? []), f]);
  }
  const reached = new Set([resolve(file)]), pending = [...reached];
  while (pending.length) for (const parent of reverse.get(pending.pop()!) ?? []) if (!reached.has(parent)) { reached.add(parent); pending.push(parent); }
  return [...reached].filter((f) => f.endsWith('.test.ts')).sort();
}

export async function waitForLoad(read: () => number = () => {
  const raw = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' });
  const load = Number(/\{\s*([\d.]+)/.exec(raw)?.[1]);
  if (!Number.isFinite(load)) throw new Error('Cannot read load1; refusing to run tests');
  return load;
}, sleep: (ms: number) => Promise<unknown> = delay, now: () => number = () => performance.now(), log: (message: string) => void = console.error): Promise<void> {
  const began = now();
  while (read() > 90) {
    if (now() - began >= 20 * 60_000) throw new Error('Load1 stayed above 90 for 20 minutes; stopped');
    log('Load1 above 90; waiting 30 seconds');
    await sleep(30_000);
  }
}

export async function command(args: string[], timeout: number): Promise<{ status: 'passed' | 'failed' | 'timeout'; output: string }> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const capture = (s: Buffer) => { output = (output + s.toString()).slice(-16000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const kill = () => {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid!, 'SIGKILL');
      } catch { /* already exited */ }
    };
    let interrupted = false;
    const stop = () => { interrupted = true; kill(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    child.on('error', (e) => { clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); fail(e); });
    child.on('close', (code) => { clearTimeout(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); if (interrupted) fail(new Error('Interrupted')); else ok({ status: timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed', output }); });
  });
}

async function main() {
  const args = process.argv.slice(2), fileArg = args.shift();
  if (!fileArg) throw new Error('Usage: npm run mutate -- <file> [--tests=a.test.ts,b.test.ts] [--lines=10:30] [--raw=CHILD,WORKER] [--ids=id,id] [--test-name=regexp] [--timeout=60000] [--report=report.json] [--list]');
  const options = new Map(args.map((a) => { const [k, ...v] = a.split('='); return [k, v.join('=')]; }));
  for (const key of options.keys()) if (!['--tests', '--lines', '--raw', '--ids', '--test-name', '--timeout', '--report', '--list'].includes(key)) throw new Error(`Unknown option ${key}`);
  const root = fileURLToPath(new URL('..', import.meta.url)), file = resolve(fileArg), label = relative(root, file);
  if (!/^packages\/[^/]+\/src\/.*\.ts$/.test(label)) throw new Error('Target must be a repository packages/*/src/*.ts file');
  const source = readFileSync(file, 'utf8');
  const rawTemplates = options.get('--raw')?.split(',') ?? [];
  let candidates = mutations(source, rawTemplates);
  if (options.has('--lines')) {
    const range = /^(\d+):(\d+)$/.exec(options.get('--lines')!);
    if (!range || +range[1] < 1 || +range[2] < +range[1]) throw new Error('Invalid --lines=start:end');
    candidates = candidates.filter((m) => m.line >= +range[1] && m.line <= +range[2]);
  }
  if (options.has('--ids')) {
    const ids = options.get('--ids')!.split(',');
    if (ids.some((id) => !candidates.some((m) => m.id === id))) throw new Error('Unknown mutant ID');
    candidates = candidates.filter((m) => ids.includes(m.id));
  }
  if (!candidates.length) throw new Error('No mutation candidates selected');
  let tests = importingTests(root, file);
  if (options.has('--tests')) {
    const selected = options.get('--tests')!.split(',').map((p) => resolve(p));
    if (selected.some((p) => !tests.includes(p))) throw new Error('--tests must import the target directly or transitively');
    tests = selected;
  }
  if (!tests.length) throw new Error('No importing tests found; add tests before running mutants');
  const timeout = Number(options.get('--timeout') ?? 60000);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('--timeout must be 1..120000 ms');
  const report: { file: string; sourceHash: string; testName?: string; tests: string[]; candidates: number; results: (Mutation & { status: string; output?: string })[]; baseline?: string; stopped?: string } = { file: label, sourceHash: createHash('sha256').update(source).digest('hex'), ...(options.has('--test-name') ? { testName: options.get('--test-name') } : {}), tests: tests.map((t) => relative(root, t)), candidates: candidates.length, results: [] };
  if (options.has('--list')) { console.log(JSON.stringify({ ...report, mutations: candidates }, null, 2)); return; }
  if (getPriority() < 19) throw new Error('Run under nice -n 19 (npm run mutate does this automatically)');
  const reportPath = resolve(options.get('--report') ?? 'mutation-report.json');
  if (reportPath === file || !reportPath.endsWith('.json') || /(?:^|\/)(?:fixtures|\.github|\.impeccable)(?:\/|$)/.test(reportPath)) throw new Error('Report must be a JSON file outside protected directories and the target');
  const scratch = mkdtempSync(join(tmpdir(), 'openhbam-mutate-'));
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const testArgs = ['--test', '--test-concurrency=2', '--test-reporter=tap', ...(options.has('--test-name') ? [`--test-name-pattern=${options.get('--test-name')}`] : []), ...tests];
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const load = async () => {
    abort.signal.throwIfAborted();
    await waitForLoad(undefined, (ms) => delay(ms, undefined, { signal: abort.signal }));
    abort.signal.throwIfAborted();
  };
  try {
    await load();
    const baseline = await command(testArgs, timeout);
    report.baseline = baseline.status; save();
    if (baseline.status !== 'passed' || !/^# pass [1-9]\d*$/m.test(baseline.output)) throw new Error(`Baseline failed, timed out, or ran no passing tests: ${baseline.output}`);
    for (const m of candidates) {
      await load();
      if (readFileSync(file, 'utf8') !== source) throw new Error('Target changed during campaign; stopping');
      const mutated = applyMutation(source, m), check = join(scratch, 'check.mjs'), hook = join(scratch, 'hook.mjs');
      try {
        writeFileSync(check, syntaxSource(mutated, rawTemplates));
      }
      catch (e) { report.results.push({ ...m, status: 'invalid', output: (e as Error).message }); save(); continue; }
      const syntax = await command(['--check', check], timeout);
      if (syntax.status !== 'passed') {
        report.results.push({ ...m, status: syntax.status === 'timeout' ? 'timeout' : 'invalid', output: syntax.output }); save(); continue;
      }
      writeFileSync(hook, `import { registerHooks } from 'node:module';\nregisterHooks({ load(url, context, nextLoad) { if (url === ${JSON.stringify(pathToFileURL(file).href)}) return { format: 'module-typescript', source: ${JSON.stringify(mutated)}, shortCircuit: true }; return nextLoad(url, context); } });\n`);
      const result = await command(['--import', pathToFileURL(hook).href, ...testArgs], timeout);
      const status = result.status === 'passed' ? 'survived' : result.status === 'timeout' ? 'timeout' : 'killed';
      report.results.push({ ...m, status, ...(status === 'killed' || status === 'timeout' ? { output: result.output } : {}) }); save();
      console.log(`${report.results.length}/${candidates.length} ${label}:${m.id} ${status}`);
    }
  } catch (e) { report.stopped = (e as Error).message; save(); throw e; }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); rmSync(scratch, { recursive: true, force: true }); }
  console.log(JSON.stringify(report.results.reduce<Record<string, number>>((counts, m) => { counts[m.status] = (counts[m.status] ?? 0) + 1; return counts; }, {})));
  if (report.results.some((m) => m.status === 'survived' || m.status === 'timeout')) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
