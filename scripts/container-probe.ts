// Read-only structure probe of container blobs and container field values.
// Prints no file contents: stream sizes, key numbers, the first bytes of short
// metadata, and text with every letter and digit masked as x.
// Usage: node --no-warnings container-probe.ts <file.fmp12> <tableId>[:<fieldId>,<fieldId>]...
// With field ids it also tallies the shapes of those fields' stored values.
import { FmpFile, fileSource, pathValue, readRecords, segmentOf, type Chunk } from '../packages/fmp12/src/index.ts';

const [src, ...tables] = process.argv.slice(2);
const file = new FmpFile(fileSource(src));
const mask = (s: string) => s.replace(/[\p{L}\p{N}]/gu, 'x');
const xor = (b: Uint8Array) => Buffer.from(b.map((c) => c ^ 0x5a)).toString('latin1');
const hex = (b: Uint8Array, n = 12) => Buffer.from(b.subarray(0, n)).toString('hex');

for (const arg of tables) {
  const [t, fieldList] = [Number(arg.split(':')[0]), arg.split(':')[1]];
  const structures = new Map<string, number>();
  const examples = new Map<string, string[]>();
  let blobs = 0;
  let cur: number | undefined;
  let lines: string[] = [];
  const segBytes = new Map<string, number>();
  const flush = () => {
    if (cur === undefined) return;
    for (const [at, n] of segBytes) lines.push(`${at} segments: ${n} bytes`);
    const shape = lines.map((l) => l.replace(/\d+ bytes/g, 'n bytes').replace(/ (head|text)=.*/, '')).join(' | ');
    structures.set(shape, (structures.get(shape) ?? 0) + 1);
    if (!examples.has(shape)) examples.set(shape, [`blob ${cur}`, ...lines]);
    lines = [];
    segBytes.clear();
  };
  for (const { path, chunk } of file.chunks(undefined, [t, 31, 5])) {
    const blob = path.length >= 4 ? pathValue(path[3]) : undefined;
    if (blob === undefined) continue;
    if (blob !== cur) {
      flush();
      cur = blob;
      blobs++;
    }
    const at = path.slice(4).map((p) => {
      const s = String(segmentOf(p));
      return /^0x[0-9a-f]{8}$/.test(s) ? JSON.stringify(Buffer.from(s.slice(2), 'hex').toString('latin1')) : s;
    }).join('.') || '.';
    const c = chunk as Chunk;
    if (c.type === 'segment') {
      segBytes.set(at, (segBytes.get(at) ?? 0) + c.data.length);
      continue;
    }
    if (c.type !== 'kv' && c.type !== 'kvlong' && c.type !== 'data') continue;
    const key = c.type === 'kv' ? `k${c.key}` : c.type === 'kvlong' ? (c.key.length === 4 ? JSON.stringify(Buffer.from(c.key).toString('latin1')) : 'K' + hex(c.key)) : 'data';
    const short = c.data.length <= 400;
    // Raw bytes only for binary keys: text keys (names, accounts) would read back from hex.
    const binary = c.type === 'kv' ? c.key < 100 : ['"SIZE"', '"DPI_"'].includes(key);
    lines.push(`${at} ${key} ${c.data.length} bytes${short ? `${binary ? ` head=${hex(c.data)}` : ''} text=${JSON.stringify(mask(xor(c.data)))}` : ''}`);
  }
  flush();
  console.log(`== table ${t}: ${blobs} blobs, ${structures.size} distinct structures`);
  for (const [shape, n] of [...structures].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`-- ${n} blobs like:`);
    for (const l of examples.get(shape)!) console.log('   ' + l);
  }
  if (fieldList) {
    const ids = new Set(fieldList.split(',').map(Number));
    const shapes = new Map<string, number>();
    let records = 0;
    for (const r of readRecords(file, t, ids)) {
      records++;
      for (const [f, reps] of r.values) for (const v of reps) {
        if (!v) continue;
        const shape = `field ${f}: ` + JSON.stringify([...v].map((c) => /[0-9a-fA-F]/.test(c) ? 'h' : /[\p{L}\p{N}]/u.test(c) ? 'x' : c).join('')) + ` (${v.length} chars)`;
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      }
    }
    console.log(`== table ${t}: ${records} records; value shapes of fields ${fieldList}:`);
    for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   ${n}× ${shape}`);
  }
}
