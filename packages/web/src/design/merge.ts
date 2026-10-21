// Two people editing one layout: when someone else saves it while you have
// unsaved changes, their save and yours are merged object by object, the way a
// three-way merge does with lines; scripts merge line by line. Nobody is
// locked out of a layout or a script.
import type { LayoutDesign, LayoutObject } from '../types.ts';
import { lineDiff } from './line-diff.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function maxId(objs: LayoutObject[]): number {
  let max = 0;
  const walk = (list: LayoutObject[]) => {
    for (const o of list) {
      max = Math.max(max, o.id);
      if (o.children) walk(o.children);
    }
  };
  walk(objs);
  return max;
}

function ids(objs: LayoutObject[], out = new Set<number>()): Set<number> {
  for (const o of objs) {
    out.add(o.id);
    if (o.children) ids(o.children, out);
  }
  return out;
}

/**
 * Merges `mine` (unsaved edits made from `base`) with `theirs` (what someone
 * else saved since `base`). Layout settings merge setting by setting and
 * objects (with what's inside them) object by object: whichever side changed
 * something wins, and where both changed the same thing, mine is kept and
 * listed in `clashes` with both versions, so I can take theirs instead.
 * Objects I added keep their place on top, renumbered if their ids were taken
 * by objects they added.
 */
export function mergeDesign(base: LayoutDesign, mine: LayoutDesign, theirs: LayoutDesign): { design: LayoutDesign; conflicts: number; clashes: Clash[] } {
  const clashes: Clash[] = [];
  const pick = <T>(b: T, m: T, t: T, at: Pick<Clash, 'what' | 'id'>): T => {
    if (same(m, b)) return t;
    if (same(t, b) || same(m, t)) return m;
    clashes.push({ ...at, mine: m, theirs: t });
    return m;
  };
  const out = {} as Record<string, unknown>;
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    if (k === 'objects') continue;
    const v = pick((base as never)[k], (mine as never)[k], (theirs as never)[k], { what: 'setting', id: k });
    if (v !== undefined) out[k] = v;
  }
  const byId = (list: LayoutObject[]) => new Map(list.map((o) => [o.id, o]));
  const b = byId(base.objects);
  const m = byId(mine.objects);
  const baseIds = ids(base.objects);
  const mineIds = ids(mine.objects);
  const theirsIds = ids(theirs.objects);
  const objects: LayoutObject[] = [];
  for (const t of theirs.objects) {
    const was = b.get(t.id);
    const now = m.get(t.id);
    if (!was) objects.push(t); // they added it
    else if (now) objects.push(pick(was, now, t, { what: 'object', id: t.id }));
    else if (!same(t, was)) {
      objects.push(t); // I deleted what they changed: theirs stays
      clashes.push({ what: 'object', id: t.id, mine: undefined, theirs: t, kept: 'theirs' });
    }
  }
  for (const [id, now] of m) {
    const was = b.get(id);
    if (was && theirs.objects.some((t) => t.id === id)) continue; // merged above
    if (was && same(now, was)) continue; // they deleted it and I didn't touch it
    if (was) clashes.push({ what: 'object', id, mine: now, theirs: undefined }); // they deleted what I changed: mine stays
    objects.push(now);
  }
  // Objects both sides added can share an id: mine move to fresh ones.
  const collisions = [...mineIds].filter((id) => !baseIds.has(id) && theirsIds.has(id));
  const remap = new Map<number, number>();
  let next = Math.max(maxId(objects), maxId(theirs.objects)) + 1;
  for (const id of collisions) remap.set(id, next++);
  const mineObjects = new Set<LayoutObject>();
  const rememberMine = (list: LayoutObject[]) => list.forEach((o) => { mineObjects.add(o); if (o.children) rememberMine(o.children); });
  rememberMine(mine.objects);
  const remapMine = (o: LayoutObject): LayoutObject => {
    if (!mineObjects.has(o)) return o;
    const id = remap.get(o.id) ?? o.id;
    return {
      ...o, id,
      ...(o.target !== undefined && remap.has(o.target) ? { target: remap.get(o.target)! } : {}),
      ...(o.activeSegment !== undefined && remap.has(o.activeSegment) ? { activeSegment: remap.get(o.activeSegment)! } : {}),
      ...(o.children ? { children: o.children.map(remapMine) } : {}),
    };
  };
  const result = objects.map(remapMine);

  // Preserve a one-sided top-level reorder. New objects from the other side
  // are appended in their merged order; incompatible reorders keep mine and
  // are reported as one order clash.
  const baseOrder = base.objects.map((o) => o.id);
  const mineOrder = mine.objects.map((o) => o.id);
  const theirsOrder = theirs.objects.map((o) => o.id);
  const common = new Set(baseOrder.filter((id) => mineOrder.includes(id) && theirsOrder.includes(id)));
  const sequence = (xs: number[]) => xs.filter((id) => common.has(id));
  const bOrder = sequence(baseOrder), mOrder = sequence(mineOrder), tOrder = sequence(theirsOrder);
  const mineReordered = !same(mOrder, bOrder), theirsReordered = !same(tOrder, bOrder);
  let chosenOrder = theirsOrder;
  if (mineReordered) {
    chosenOrder = mineOrder.map((id) => remap.get(id) ?? id);
    if (theirsReordered && !same(mOrder, tOrder)) clashes.push({ what: 'order', id: 'objects', mine: mineOrder, theirs: theirsOrder });
  }
  const position = new Map(chosenOrder.map((id, i) => [id, i]));
  result.sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const orderRemap = remap;
  if (Array.isArray(out.tabOrder) && same(out.tabOrder, mine.tabOrder) && !same(mine.tabOrder, base.tabOrder)) {
    out.tabOrder = (out.tabOrder as number[]).map((id) => orderRemap.get(id) ?? id);
  }
  return { design: { ...(out as unknown as LayoutDesign), objects: result }, conflicts: clashes.length, clashes };
}

/**
 * Something both people changed: a layout setting (by name) or a top-level
 * object (by id), with each side's version (undefined: that side deleted it).
 * `kept` says which the merge used: mine, except an object I deleted that they changed.
 */
export interface Clash {
  what: 'setting' | 'object' | 'order';
  id: string | number;
  mine: unknown;
  theirs: unknown;
  kept?: 'theirs';
}

/**
 * The design with one clash settled: `side`'s version put in place. Picking
 * the side the merge already kept changes nothing (edits made since stay). An
 * object since moved into a group (or a group since ungrouped) is left as it
 * is: putting the other version back would give two objects one id.
 */
export function settleClash(design: LayoutDesign, clash: Clash, side: 'mine' | 'theirs'): LayoutDesign {
  if (side === (clash.kept ?? 'mine')) return design;
  const value = clash[side];
  if (clash.what === 'order') {
    const order = value as number[];
    const position = new Map(order.map((id, i) => [id, i]));
    return { ...design, objects: [...design.objects].sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)) };
  }
  if (clash.what === 'setting') {
    const out = { ...design } as Record<string, unknown>;
    if (value === undefined) delete out[clash.id as string];
    else out[clash.id as string] = value;
    return out as unknown as LayoutDesign;
  }
  const at = design.objects.findIndex((o) => o.id === clash.id);
  const back = value as LayoutObject | undefined;
  const taken = ids(design.objects.filter((o) => o.id !== clash.id));
  if (at < 0 ? taken.has(clash.id as number) : false) return design;
  if (back && [...ids(back.children ?? [])].some((id) => taken.has(id))) return design;
  const objects = [...design.objects];
  if (value === undefined) {
    if (at >= 0) objects.splice(at, 1);
  } else if (at >= 0) objects[at] = value as LayoutObject;
  else objects.push(value as LayoutObject);
  return { ...design, objects };
}

/** A run of base lines [start, end) one side replaced with `lines` (start === end: lines inserted there). */
interface Hunk { start: number; end: number; lines: string[] }

function hunks(base: string, other: string): Hunk[] {
  const out: Hunk[] = [];
  let at = 0;
  let open: Hunk | undefined;
  for (const d of lineDiff(base, other)) {
    if (d.kind === 'same') {
      open = undefined;
      at++;
      continue;
    }
    if (!open) out.push(open = { start: at, end: at, lines: [] });
    if (d.kind === 'del') open.end = ++at;
    else open.lines.push(d.text);
  }
  return out;
}

/**
 * Merges script text the same way, line by line: `mine` (unsaved edits made
 * from `base`) with `theirs` (saved by someone else since). Lines only one side
 * changed take that side's change; where both changed the same lines
 * differently, mine is kept and counted in `conflicts`.
 */
export function mergeText(base: string, mine: string, theirs: string): { text: string; conflicts: number } {
  if (mine === base || mine === theirs) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: mine, conflicts: 0 };
  const b = base === '' ? [] : base.split('\n');
  const all = [...hunks(base, mine).map((h) => ({ ...h, mine: true })), ...hunks(base, theirs).map((h) => ({ ...h, mine: false }))]
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const out: string[] = [];
  let conflicts = 0;
  let at = 0;
  for (let i = 0; i < all.length;) {
    // Hunks that overlap (or insert at the same place) are one region to settle together.
    const group = [all[i]];
    let end = all[i].end;
    for (i++; i < all.length && (all[i].start < end || (all[i].start === end && all[i].start === group[0].start)); i++) {
      group.push(all[i]);
      end = Math.max(end, all[i].end);
    }
    const start = group[0].start;
    out.push(...b.slice(at, start));
    const side = (isMine: boolean) => {
      // The region as this side has it: base with its hunks applied.
      const lines: string[] = [];
      let p = start;
      for (const h of group.filter((g) => g.mine === isMine)) {
        lines.push(...b.slice(p, h.start), ...h.lines);
        p = h.end;
      }
      return [...lines, ...b.slice(p, end)];
    };
    const both = group.some((g) => g.mine) && group.some((g) => !g.mine);
    const m = side(true);
    const t = side(false);
    if (both && m.join('\n') !== t.join('\n')) conflicts++;
    out.push(...(group.some((g) => g.mine) ? m : t));
    at = end;
  }
  out.push(...b.slice(at));
  return { text: out.join('\n'), conflicts };
}
