// Layout mode guides beyond lining up edges: equal spacing between neighbours.
import type { LayoutObject } from '../types.ts';

/** A spacing marker: the gap from `from` to `to` along a row (across) or column, drawn at `at`. */
export type Gap = { across: boolean; from: number; to: number; at: number };

/**
 * Equal spacing: where `box` would sit the same distance from a neighbour as two
 * other neighbours in its row (across) or column are from each other, within
 * `limit`. The move it needs and the gaps to mark.
 */
export function equalSpacing(box: LayoutObject['bounds'], others: LayoutObject['bounds'][], across: boolean, limit: number): { d: number; gaps: Gap[] } | undefined {
  const [lo, hi, plo, phi] = across ? (['left', 'right', 'top', 'bottom'] as const) : (['top', 'bottom', 'left', 'right'] as const);
  // Neighbours beside the box: overlapping it the other way.
  const row = others.filter((b) => b[plo] < box[phi] && b[phi] > box[plo]).sort((a, b) => a[lo] - b[lo]);
  const mid = (a: LayoutObject['bounds'], b: LayoutObject['bounds']) => Math.round((Math.max(a[plo], b[plo]) + Math.min(a[phi], b[phi])) / 2);
  const pairs: { g: number; a: LayoutObject['bounds']; b: LayoutObject['bounds'] }[] = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const g = row[i + 1][lo] - row[i][hi];
    if (g > 0) pairs.push({ g, a: row[i], b: row[i + 1] });
  }
  let best: { d: number; gaps: Gap[] } | undefined;
  for (const n of row) {
    for (const { g, a, b } of pairs) {
      // After the neighbour, or before it.
      for (const after of [true, false]) {
        const d = after ? n[hi] + g - box[lo] : n[lo] - g - box[hi];
        if (Math.abs(d) > limit || (best && Math.abs(d) >= Math.abs(best.d))) continue;
        const moved = { ...box, [lo]: box[lo] + d, [hi]: box[hi] + d };
        if (row.some((o) => o[lo] < moved[hi] && o[hi] > moved[lo])) continue;
        const mine = after ? { across, from: n[hi], to: moved[lo], at: mid(n, moved) } : { across, from: moved[hi], to: n[lo], at: mid(n, moved) };
        best = { d, gaps: [{ across, from: a[hi], to: b[lo], at: mid(a, b) }, mine] };
      }
    }
  }
  return best;
}
