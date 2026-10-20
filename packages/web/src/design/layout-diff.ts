// What changed between two versions of a layout design, in words: for the
// layout editor's undo history and for comparing saved versions.
import type { LayoutDesign, LayoutObject } from '../types.ts';

/** Layout-level settings by the name Layout Setup or the inspector gives them. */
const SETTINGS: Record<string, string> = {
  width: 'width', themeId: 'theme', style: 'layout style', parts: 'parts', view: 'view it opens in',
  viewsAllowed: 'views allowed', tableView: 'Table View columns', triggers: 'script triggers', tabOrder: 'tab order',
  menuSetId: 'menu set', saveRecordChanges: 'saving changes', fieldFrames: 'field frames', recordIndicator: 'record indicator',
  tableOccurrenceId: 'table occurrence', printColumns: 'print columns', fixedMargins: 'fixed margins', responsive: 'responsive layout',
};

/** Object properties by what they are in the inspector. */
const PROPERTIES: Record<string, string> = {
  style: 'appearance', text: 'text', field: 'field', display: 'control style', behavior: 'field options', format: 'data format',
  conditions: 'conditional formatting', hide: 'hide condition', tooltip: 'tooltip', placeholder: 'placeholder', action: 'button action',
  triggers: 'script triggers', portal: 'portal setup', chart: 'chart setup', webUrl: 'web address', webOptions: 'web viewer setup',
  anchors: 'autosizing', sliding: 'sliding', locked: 'lock', name: 'name', valueListId: 'value list', iconId: 'icon', imageId: 'picture',
};

function flatten(objs: LayoutObject[], out = new Map<number, LayoutObject>()): Map<number, LayoutObject> {
  for (const o of objs) {
    out.set(o.id, o);
    if (o.children) flatten(o.children, out);
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The changes from `a` to `b`, one line each, most telling first. Several
 * objects changed the same way share a line ("Moved 4 objects").
 */
export function layoutChanges(a: LayoutDesign, b: LayoutDesign, name: (o: LayoutObject) => string): string[] {
  const before = flatten(a.objects ?? []);
  const after = flatten(b.objects ?? []);
  const groups = new Map<string, string[]>();
  const note = (verb: string, what: string) => {
    const list = groups.get(verb) ?? [];
    list.push(what);
    groups.set(verb, list);
  };
  for (const [id, o] of after) if (!before.has(id)) note('Added', name(o));
  for (const [id, o] of before) if (!after.has(id)) note('Removed', name(o));
  for (const [id, x] of before) {
    const y = after.get(id);
    if (!y) continue;
    const bx = x.bounds;
    const by = y.bounds;
    if (!same(bx, by)) {
      const sized = bx.right - bx.left !== by.right - by.left || bx.bottom - bx.top !== by.bottom - by.top;
      note(sized ? 'Resized' : 'Moved', name(y));
    }
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    const props = [...keys].filter((k) => k !== 'bounds' && k !== 'children' && k !== 'id' && !same((x as never)[k], (y as never)[k]));
    // A moved group's children move with it; their own change is only the bounds.
    if (props.length) note(`Changed ${[...new Set(props.map((k) => PROPERTIES[k] ?? k))].slice(0, 3).join(', ')} of`, name(y));
  }
  const lines: string[] = [];
  for (const [verb, whats] of groups) {
    lines.push(whats.length > 3 ? `${verb} ${whats.length} objects` : `${verb} ${whats.join(', ')}`);
  }
  const settings = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = [...settings].filter((k) => k !== 'objects' && k !== 'id' && k !== 'name' && k !== 'generated' && !same((a as never)[k], (b as never)[k]));
  if (changed.length) lines.push(`Changed the layout's ${changed.map((k) => SETTINGS[k] ?? k).join(', ')}`);
  return lines;
}

/** One line for a change: its first line, and how many more there are. */
export function changeSummary(lines: string[]): string {
  if (!lines.length) return 'No changes';
  return lines.length > 1 ? `${lines[0]} (+${lines.length - 1} more)` : lines[0];
}

/**
 * The layout as each save left it, oldest first, from the design history's
 * createLayout and updateLayout changes. A change that gives only some of the
 * design's keys is merged over the version before it, as the server does;
 * changes before the first full design (parts and objects) can't be shown whole,
 * so the list starts there.
 */
export function layoutVersions(history: { seq: number; at: string; account: string | null; op: Record<string, unknown> }[], layoutId: number):
  { seq: number; at: string; account: string | null; design: LayoutDesign }[] {
  const out: { seq: number; at: string; account: string | null; design: LayoutDesign }[] = [];
  let current: LayoutDesign | undefined;
  for (const e of history) {
    const op = e.op;
    if (op.op !== 'createLayout' && op.op !== 'updateLayout') continue;
    if (op.op === 'updateLayout' && op.layout !== layoutId) continue;
    if (op.op === 'createLayout' && op.id !== layoutId) continue;
    const design = op.design as Partial<LayoutDesign> | undefined;
    if (!design) continue;
    if (!current && !(Array.isArray(design.parts) && Array.isArray(design.objects))) continue;
    current = { ...(current ?? {}), ...design } as LayoutDesign;
    out.push({ seq: e.seq, at: e.at, account: e.account, design: structuredClone(current) });
  }
  return out;
}

/**
 * Which objects differ between `a` and `b`, by id, for marking them on a
 * picture of each: added (only in b), removed (only in a), changed (moved,
 * resized or set differently). An object whose only change is inside its
 * children isn't counted; the children are.
 */
export function changedIds(a: LayoutDesign, b: LayoutDesign): { added: number[]; removed: number[]; changed: number[] } {
  const before = flatten(a.objects ?? []);
  const after = flatten(b.objects ?? []);
  const own = (o: LayoutObject) => JSON.stringify({ ...o, children: undefined });
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...before].filter(([id, o]) => after.has(id) && own(o) !== own(after.get(id)!)).map(([id]) => id),
  };
}
