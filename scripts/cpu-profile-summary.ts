// Where a process spent its time, from the .cpuprofile files `node --cpu-prof`
// writes: the functions that took the most time themselves, the most time
// with what they called, and the call chains of Tabularius's own code under the
// busiest of them. Prints code locations only (function, file, line), never
// data, so the output is safe to share from a run over a private file.
//
//   node --cpu-prof --cpu-prof-dir /tmp/prof <what to profile>
//   node scripts/cpu-profile-summary.ts /tmp/prof [--top 30] [--chains 15]
//
// For a hosted server, set NODE_OPTIONS="--cpu-prof --cpu-prof-dir /tmp/prof"
// so each worker writes its own profile when it exits; the files are summed.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

interface Node {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}
interface Profile { nodes: Node[]; startTime: number; endTime: number; samples?: number[]; timeDeltas?: number[] }

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const top = option('--top', 30);
const chainCount = option('--chains', 15);
const target = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!target) {
  console.error('usage: node scripts/cpu-profile-summary.ts <file.cpuprofile | folder> [--top 30] [--chains 15]');
  process.exit(2);
}
const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith('.cpuprofile')).map((f) => join(target, f))
  : [target];

const where = (n: Node) => {
  const f = n.callFrame;
  const file = f.url ? basename(f.url.replace(/^file:\/\//, '')) : '';
  return `${f.functionName || '(anonymous)'} ${file ? `${file}:${f.lineNumber + 1}` : ''}`.trim();
};
const ours = (n: Node) => /\/packages\/[^/]+\/src\//.test(n.callFrame.url);

const self = new Map<string, number>();
const total = new Map<string, number>();
const chains = new Map<string, number>();
let all = 0;
for (const file of files) {
  const p = JSON.parse(readFileSync(file, 'utf8')) as Profile;
  // Time a node took itself, from the samples (each sample's delta is the time until the next).
  const ms = new Map<number, number>();
  const samples = p.samples ?? [];
  const deltas = p.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) ms.set(samples[i], (ms.get(samples[i]) ?? 0) + (deltas[i + 1] ?? 0) / 1000);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  for (const n of p.nodes) {
    const t = ms.get(n.id) ?? 0;
    if (!t) continue;
    all += t;
    const name = where(n);
    self.set(name, (self.get(name) ?? 0) + t);
    // Inclusive time: once per distinct function on the stack, so recursion isn't counted twice.
    const seen = new Set<string>();
    const chain: string[] = [];
    for (let at: number | undefined = n.id; at !== undefined; at = parent.get(at)) {
      const node = byId.get(at)!;
      const label = where(node);
      if (!seen.has(label)) {
        seen.add(label);
        total.set(label, (total.get(label) ?? 0) + t);
      }
      if (ours(node) && chain.length < 8 && chain.at(-1) !== label) chain.push(label);
    }
    if (chain.length) {
      const key = `${n.callFrame.url && !ours(n) ? `${name} < ` : ''}${chain.join(' < ')}`;
      chains.set(key, (chains.get(key) ?? 0) + t);
    }
  }
}

const show = (title: string, m: Map<string, number>, n: number) => {
  console.log(`\n${title}`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, n)) {
    console.log(`${v.toFixed(0).padStart(8)} ms ${((100 * v) / (all || 1)).toFixed(1).padStart(5)}%  ${k}`);
  }
};
console.log(`${files.length} profile(s), ${all.toFixed(0)} ms sampled`);
show('Self time (the function itself)', self, top);
show("Total time (with what it called), Tabularius's code", new Map([...total].filter(([k]) => /\.ts:/.test(k))), top);
show("Busiest call chains through Tabularius's code (innermost first)", chains, chainCount);
