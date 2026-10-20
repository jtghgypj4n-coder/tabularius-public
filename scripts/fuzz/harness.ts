// Mutation fuzzer for the project's own readers. Each input runs in a child process with a timeout and a
// heap cap, so a hang or an out-of-memory abort is a finding rather than the end of the run. Findings are
// deduplicated by stack signature and minimised before they are reported.
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MAX_INPUT, mutate, random, seeds, type Target } from './generate.ts';
import type { Job, Reply } from './worker.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));
const MAX_CORPUS = 64;

export type Outcome = { kind: 'ok' } | { kind: 'error' | 'hang' | 'crash'; signature: string; detail: string };
export interface Finding { target: Target; kind: 'error' | 'hang' | 'crash'; signature: string; detail: string; input: Buffer; originalLength: number }
export interface FuzzOptions {
  target: Target;
  seed: number;
  /** Stops after this many seconds or iterations, whichever comes first; at least one must be set. */
  seconds?: number;
  iterations?: number;
  timeoutMs?: number;
  memoryMb?: number;
  /** Child process runs allowed for minimising each new finding. */
  minimiseRuns?: number;
  env?: NodeJS.ProcessEnv;
  /** A shared child process, so several targets pay its start-up once; the caller closes it. */
  runner?: Runner;
}
export interface FuzzReport { target: Target; seed: number; iterations: number; findings: Finding[] }

/** Error name plus the first project frames (path:line, no column): stable across messages that embed sizes or offsets. */
export function signature(stack: string): string {
  const [head, ...frames] = stack.split('\n');
  const name = /^([\w$.]*(?:Error|Exception)?(?: \[[A-Z_]+\])?)/.exec(head)?.[1] || 'Error';
  const ours: string[] = [];
  for (const line of frames) {
    const m = /^\s*at (?:(.*?) \()?(?:file:\/\/)?(.*?):(\d+):\d+\)?$/.exec(line);
    if (!m) continue;
    const path = m[2].startsWith(ROOT) ? m[2].slice(ROOT.length) : m[2];
    if (path.startsWith('scripts/fuzz/') || path.startsWith('node:')) continue;
    ours.push(`${m[1] ?? '<anonymous>'}@${path}:${m[3]}`);
    if (ours.length === 3) break;
  }
  return [name, ...ours].join(' | ');
}

/** One child process at a time; restarted after a hang or crash. */
export class Runner {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private stderr = '';
  private readonly opts: { timeoutMs: number; memoryMb: number; env?: NodeJS.ProcessEnv };
  constructor(opts: { timeoutMs: number; memoryMb: number; env?: NodeJS.ProcessEnv }) { this.opts = opts; }

  private start(): Promise<void> {
    this.stderr = '';
    const child = this.child = fork(WORKER, [], {
      execPath: process.execPath,
      execArgv: ['--no-warnings', `--max-old-space-size=${this.opts.memoryMb}`],
      env: this.opts.env ?? process.env,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    // The head holds the fatal error line; V8's native stack trace follows it.
    child.stderr!.on('data', (d: Buffer) => { if (this.stderr.length < 4096) this.stderr = (this.stderr + d.toString()).slice(0, 4096); });
    child.once('exit', () => { if (this.child === child) this.child = undefined; });
    return this.ready = new Promise((resolve, reject) => {
      child.once('message', m => m === 'ready' ? resolve() : reject(new Error(`fuzz worker sent ${String(m)} before ready`)));
      child.once('exit', code => reject(new Error(`fuzz worker exited (${code}) before ready: ${this.stderr.trim()}`)));
    });
  }

  /** Starts the child if needed; module loading takes seconds, so callers time their budget from here. */
  async ensure(): Promise<void> {
    if (!this.child) await this.start(); else await this.ready;
  }

  async run(target: Target, data: Buffer): Promise<Outcome> {
    await this.ensure();
    const child = this.child!;
    return new Promise(resolve => {
      const done = (outcome: Outcome) => {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('close', onClose);
        resolve(outcome);
      };
      const onMessage = (reply: Reply) => done(reply.ok ? { kind: 'ok' } : { kind: 'error', signature: signature(reply.stack), detail: reply.stack });
      const onClose = (code: number | null, signal: string | null) => {
        this.child = undefined;
        const fatal = /FATAL ERROR: .*|Error: .*/.exec(this.stderr)?.[0] ?? '';
        done({ kind: 'crash', signature: `crash: ${signal ?? `exit ${code}`}${fatal ? ` | ${fatal.replace(/\d+/g, 'N')}` : ''}`, detail: this.stderr.trim() });
      };
      const timer = setTimeout(() => {
        child.off('close', onClose);
        child.kill('SIGKILL');
        this.child = undefined;
        done({ kind: 'hang', signature: 'hang', detail: `no result within ${this.opts.timeoutMs} ms` });
      }, this.opts.timeoutMs);
      child.on('message', onMessage);
      child.once('close', onClose);
      child.send({ target, data: data.toString('base64') } satisfies Job);
    });
  }

  close(): void {
    this.child?.kill('SIGKILL');
    this.child = undefined;
  }
}

/** Delta debugging over bytes: drop ever smaller chunks while the same signature still reproduces. */
export async function minimise(runner: Runner, target: Target, input: Buffer, wanted: string, maxRuns: number): Promise<Buffer> {
  let current = input, parts = 2, runs = 0;
  while (current.length > 1 && runs < maxRuns) {
    const size = Math.ceil(current.length / parts);
    let reduced = false;
    for (let at = 0; at < current.length && runs < maxRuns; at += size) {
      const candidate = Buffer.concat([current.subarray(0, at), current.subarray(at + size)]);
      runs++;
      const outcome = await runner.run(target, candidate);
      if (outcome.kind !== 'ok' && outcome.signature === wanted) {
        current = candidate;
        parts = Math.max(parts - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (size === 1) break;
      parts = Math.min(current.length, parts * 2);
    }
  }
  return current;
}

export async function fuzz(opts: FuzzOptions): Promise<FuzzReport> {
  if (opts.seconds === undefined && opts.iterations === undefined) throw new Error('fuzz needs seconds or iterations');
  const runner = opts.runner ?? new Runner({ timeoutMs: opts.timeoutMs ?? 2000, memoryMb: opts.memoryMb ?? 256, env: opts.env });
  const r = random(opts.seed);
  const corpus = seeds(opts.target);
  const seedCount = corpus.length;
  const seen = new Set<string>();
  const findings: Finding[] = [];
  let iterations = 0;
  try {
    await runner.ensure();
    const deadline = opts.seconds === undefined ? Infinity : Date.now() + opts.seconds * 1000;
    // Seeds run unmutated first: a seed that already fails is the first thing to know.
    const queue = [...corpus];
    while (iterations < (opts.iterations ?? Infinity) && Date.now() < deadline) {
      let input = queue.shift();
      if (!input) {
        input = corpus[r(corpus.length)];
        for (let n = 1 + r(3); n > 0; n--) input = mutate(opts.target, input, r);
      }
      iterations++;
      const outcome = await runner.run(opts.target, input);
      if (outcome.kind === 'ok') {
        // No coverage feedback: keep a sample of inputs the readers got through, so mutations compound.
        if (r(4) === 0 && input.length <= MAX_INPUT) {
          if (corpus.length < MAX_CORPUS) corpus.push(input); else corpus[seedCount + r(MAX_CORPUS - seedCount)] = input;
        }
        continue;
      }
      if (seen.has(outcome.signature)) continue;
      seen.add(outcome.signature);
      const small = await minimise(runner, opts.target, input, outcome.signature, opts.minimiseRuns ?? (outcome.kind === 'hang' ? 20 : 400));
      findings.push({ target: opts.target, kind: outcome.kind, signature: outcome.signature, detail: outcome.detail, input: small, originalLength: input.length });
    }
  } finally {
    if (!opts.runner) runner.close();
  }
  return { target: opts.target, seed: opts.seed, iterations, findings };
}

/** File name for a finding: target plus a short hash of its signature. */
export function findingName(f: Finding): string {
  return `${f.target}-${createHash('sha256').update(f.signature).digest('hex').slice(0, 10)}`;
}
