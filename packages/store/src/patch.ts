// What a design change did, as a patch that can be undone later: used to
// restore a deleted table or field together with every reference the delete
// rewrote (formulas showing <Field Missing>, relationships, occurrences).
//
// Array elements with an id are addressed by id, so the patch still applies
// after later changes reorder or add to the lists. Undoing only puts back a
// value where it is still what the change left: anything changed since is
// left alone.

export type Seg = string | number | { id: number };

export interface DesignPatch {
  /** Values the change replaced. */
  leaves: { path: Seg[]; before?: unknown; after?: unknown }[];
  /** List elements the change removed (with an id), and where they were. */
  removed: { path: Seg[]; index?: number; value: { id: number; name?: string } & Record<string, unknown> }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const keyed = (list: unknown[]): list is ({ id: number } & Obj)[] =>
  list.every((x) => isObj(x) && typeof x.id === 'number') && new Set(list.map((x) => (x as { id: number }).id)).size === list.length;

export function diffDesign(before: unknown, after: unknown): DesignPatch {
  const out: DesignPatch = { leaves: [], removed: [] };
  const walk = (a: unknown, b: unknown, path: Seg[]) => {
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length && keyed(a) && keyed(b)) {
        const now = new Map(b.map((x) => [x.id, x]));
        for (const [index, x] of a.entries()) {
          const y = now.get(x.id);
          if (y === undefined) out.removed.push({ path, index, value: x });
          else walk(x, y, [...path, { id: x.id }]);
        }
        return;
      }
      if (a.length === b.length) {
        a.forEach((x, i) => walk(x, b[i], [...path, i]));
        return;
      }
    } else if (isObj(a) && isObj(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], [...path, k]);
      return;
    }
    if (!same(a, b)) out.leaves.push({ path, ...(a !== undefined ? { before: a } : {}), ...(b !== undefined ? { after: b } : {}) });
  };
  walk(before, after, []);
  return out;
}

function step(cur: unknown, seg: Seg): unknown {
  if (typeof seg === 'object') return Array.isArray(cur) ? cur.find((x) => isObj(x) && x.id === seg.id) : undefined;
  return cur === null || typeof cur !== 'object' ? undefined : (cur as Obj)[seg as string];
}

export function atPath(root: unknown, path: Seg[]): unknown {
  let cur = root;
  for (const seg of path) cur = step(cur, seg);
  return cur;
}

/** Undo a patch on `root`, in place: removed elements come back first (outermost first), then replaced values. */
export function undoPatch(root: unknown, patch: DesignPatch): void {
  for (const r of [...patch.removed].sort((a, b) => a.path.length - b.path.length)) {
    const list = atPath(root, r.path);
    if (Array.isArray(list) && !list.some((x) => isObj(x) && x.id === r.value.id)) list.splice(Math.min(r.index ?? list.length, list.length), 0, structuredClone(r.value));
  }
  for (const l of patch.leaves) {
    const parent = atPath(root, l.path.slice(0, -1));
    const seg = l.path[l.path.length - 1];
    if (parent === null || typeof parent !== 'object' || !same(step(parent, seg), l.after)) continue;
    if (typeof seg === 'object') {
      const list = parent as unknown[];
      const i = list.findIndex((x) => isObj(x) && x.id === seg.id);
      if (i >= 0) list[i] = structuredClone(l.before);
    } else if (l.before === undefined) delete (parent as Obj)[seg as string];
    else (parent as Obj)[seg as string] = structuredClone(l.before);
  }
}
