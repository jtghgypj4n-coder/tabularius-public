// Line-by-line differences between two texts, for reviewing a drafted script against the one in the editor
// before it goes in. Longest common subsequence of lines; big texts fall back to trimming the common start and end.

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/** Past this many line pairs the full comparison is skipped (it is quadratic). */
const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  // The common start and end need no comparing.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const head = a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = a.slice(a.length - end).map((text): DiffLine => ({ kind: 'same', text }));
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  if (x.length * y.length > MAX_CELLS) {
    return [...head, ...x.map((text): DiffLine => ({ kind: 'del', text })), ...y.map((text): DiffLine => ({ kind: 'add', text })), ...tail];
  }
  // lcs[i][j]: the longest common run of x[i..] and y[j..].
  const w = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      mid.push({ kind: 'same', text: x[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      mid.push({ kind: 'del', text: x[i++] });
    } else {
      mid.push({ kind: 'add', text: y[j++] });
    }
  }
  while (i < x.length) mid.push({ kind: 'del', text: x[i++] });
  while (j < y.length) mid.push({ kind: 'add', text: y[j++] });
  return [...head, ...mid, ...tail];
}

/** "3 lines added, 1 removed", or "No changes". */
export function diffSummary(diff: DiffLine[]): string {
  const added = diff.filter((d) => d.kind === 'add').length;
  const removed = diff.filter((d) => d.kind === 'del').length;
  if (!added && !removed) return 'No changes';
  const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;
  if (!removed) return `${lines(added)} added`;
  if (!added) return `${lines(removed)} removed`;
  return `${lines(added)} added, ${removed} removed`;
}

/**
 * The changed lines with a few unchanged ones around each change, as runs; the long unchanged stretches between
 * are left out (each run says where it starts in the new text).
 */
export function diffHunks(diff: DiffLine[], context = 2): { line: number; lines: DiffLine[] }[] {
  const keep = new Array<boolean>(diff.length).fill(false);
  diff.forEach((d, k) => {
    if (d.kind === 'same') return;
    for (let n = Math.max(0, k - context); n <= Math.min(diff.length - 1, k + context); n++) keep[n] = true;
  });
  const out: { line: number; lines: DiffLine[] }[] = [];
  let newLine = 1;
  diff.forEach((d, k) => {
    if (keep[k]) {
      if (!keep[k - 1] || !out.length) out.push({ line: newLine, lines: [] });
      out[out.length - 1].lines.push(d);
    }
    if (d.kind !== 'del') newLine++;
  });
  return out;
}
