// Child process for the fuzz harness: runs one reader target per message and reports how it ended.
// The parent owns the timeout and memory cap; a hang or an out-of-memory abort kills only this process.
import { TARGETS, type Target } from './generate.ts';
import { exercise } from './targets.ts';

export interface Job { target: Target; data: string }
export type Reply = { ok: true } | { ok: false; name: string; message: string; stack: string };

// Proves the detector end to end: TABULARIUS_FUZZ_SELFTEST=error|hang|exit|oom makes every input fail that way.
const selftest = process.env.TABULARIUS_FUZZ_SELFTEST;
const held: number[][] = [];

async function run(job: Job): Promise<Reply> {
  if (!TARGETS.includes(job.target)) throw new Error(`unknown fuzz target ${job.target}`);
  try {
    if (selftest === 'error') throw new TypeError('fuzz self-test');
    if (selftest === 'hang') for (;;) { /* spin until the parent kills this process */ }
    if (selftest === 'exit') process.exit(70);
    if (selftest === 'oom') for (;;) held.push(new Array(1 << 20).fill(held.length));
    await exercise(job.target, Buffer.from(job.data, 'base64'));
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { ok: false, name: err.name, message: err.message.slice(0, 500), stack: err.stack ?? `${err.name}: ${err.message}` };
  }
}

process.on('message', (job: Job) => { void run(job).then(reply => process.send!(reply)); });
process.send!('ready');
