// Review changes: design changes staged by a person, the assistant or a script, looked over before they are applied.
// Grouped by the thing they change; each says what it does, shows a calculation or script before and after, what a
// rename or delete would break, who staged it, whether it would apply, and whether someone else has changed the same
// thing since. Apply all or the ticked ones, or discard them; what could not be applied stays, with the reason.

import type { PendingChange, PendingConflict, PendingResult, PendingReview, PendingTextDiff } from './client.ts';
import { h, button, toast } from './dom.ts';
import { diffHunks, diffSummary, lineDiff, type DiffLine } from './line-diff.ts';
import { errorText, type Studio } from './main.ts';

/** A diff longer than this many lines shows its first lines and a button for the rest. */
export const LONG_DIFF = 120;

export interface ChangeGroup {
  key: string;
  label: string;
  name: string;
  changes: PendingChange[];
}

/** The changes grouped by the thing they change, in the order each thing first appears. */
export function groupChanges(changes: PendingChange[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const c of changes) {
    const key = `${c.object.kind}|${c.object.name.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label: c.object.label, name: c.object.name, changes: [] }));
    g.changes.push(c);
  }
  return [...groups.values()];
}

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Who staged a change, and when. */
export function byText(c: PendingChange): string {
  return `Staged by ${c.by ?? 'someone'}, ${when(c.at)}`;
}

/** The conflict in words: who changed the same thing, what they did, and what applying does about it. */
export function conflictText(c: PendingChange): string {
  const first = c.conflicts[0];
  const who = (x: PendingConflict) => x.account ?? 'Someone';
  const others = c.conflicts.length > 1 ? ` and ${c.conflicts.length - 1} more change${c.conflicts.length === 2 ? '' : 's'}` : '';
  return `${who(first)} changed this since it was staged (${first.what.toLowerCase()}, ${when(first.at)})${others}. ` +
    'It is left alone unless you choose to apply it anyway, which puts this change on top of theirs.';
}

/** What an apply did, one sentence per part. */
export function resultLines(r: PendingResult): string[] {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const out: string[] = [];
  out.push(r.applied.length ? `Applied ${n(r.applied.length, 'change')}.` : 'Nothing was applied.');
  for (const a of r.applied) out.push(`Applied: ${a.title}`);
  for (const b of r.blocked) out.push(`Could not apply: ${b.title}. ${b.message}`);
  for (const c of r.conflicts) {
    const first = c.conflicts[0];
    out.push(`Left alone, ${first.account ?? 'someone'} changed it since it was staged: ${c.title}.`);
  }
  if (r.remaining) out.push(`${n(r.remaining, 'change')} still waiting.`);
  return out;
}

/** A before/after of one text: the changed lines with a little around them, and the rest of a long diff on request. */
export function diffView(d: PendingTextDiff): HTMLElement {
  const diff = lineDiff(d.before, d.after);
  const box = h('div', { class: 'rv-diff' });
  const draw = (all: boolean) => {
    let budget = all ? Infinity : LONG_DIFF;
    let hidden = 0;
    const pres: HTMLElement[] = [];
    for (const hunk of diffHunks(diff)) {
      const lines: DiffLine[] = hunk.lines.slice(0, Math.max(0, budget));
      hidden += hunk.lines.length - lines.length;
      budget -= lines.length;
      if (!lines.length) continue;
      pres.push(h('pre', { class: 'se-diff', tabindex: '0', 'aria-label': `${d.label}, from line ${hunk.line}` },
        ...lines.map((l) => h('span', { class: `se-diff-${l.kind}` }, `${l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '} ${l.text}\n`))));
    }
    box.replaceChildren(...pres, ...(hidden ? [button(`Show ${hidden} more line${hidden === 1 ? '' : 's'}`, () => draw(true), { class: 'rv-more' })] : []),
      ...(d.cut ? [h('p', { class: 'd-muted' }, `Only the first ${d.cut.toLocaleString()} characters are shown; the change itself is whole.`)] : []));
  };
  draw(false);
  return h('details', { class: 'rv-text', open: '' }, h('summary', {}, `${d.label}: ${diffSummary(diff)}`), box);
}

function changeView(c: PendingChange, picked: Set<number>, force: Set<number>, onChange: () => void): HTMLElement {
  const conflicted = c.conflicts.length > 0;
  const status = c.status === 'blocked' ? 'blocked' : conflicted ? 'conflict' : 'ready';
  const label = { ready: 'Ready', blocked: 'Cannot apply', conflict: 'Conflict' }[status];
  const box = h('input', { type: 'checkbox', id: `rv-pick-${c.id}` });
  box.checked = picked.has(c.id);
  box.addEventListener('change', () => {
    if (box.checked) picked.add(c.id);
    else picked.delete(c.id);
    onChange();
  });
  const body: (HTMLElement | undefined)[] = [
    h('div', { class: 'rv-head' },
      h('label', { class: 'rv-title', for: box.id }, c.title),
      h('span', { class: `rv-status rv-${status}` }, label)),
    h('div', { class: 'rv-meta d-muted' }, byText(c)),
  ];
  if (c.lines.length) body.push(h('ul', { class: 'rv-lines' }, ...c.lines.map((l) => h('li', {}, l))));
  if (c.status === 'blocked') body.push(h('p', { class: 'rv-why', role: 'note' }, `Cannot apply: ${c.message ?? 'the design would refuse it'}`));
  for (const d of c.diffs) body.push(diffView(d));
  if (c.impact) {
    const note = c.impact.breaking
      ? `${c.impact.breaking} use${c.impact.breaking === 1 ? '' : 's'} would break`
      : c.impact.useCount ? 'Nothing breaks' : 'Not used anywhere';
    body.push(h('details', { class: 'rv-impact', ...(c.impact.breaking ? { open: '' } : {}) },
      h('summary', {}, `${c.impact.change === 'delete' ? 'Delete' : 'Rename'}: ${note}`),
      ...c.impact.summary.map((line) => h('p', {}, line))));
  }
  if (conflicted) {
    const again = h('input', { type: 'checkbox', id: `rv-force-${c.id}` });
    again.checked = force.has(c.id);
    again.addEventListener('change', () => {
      if (again.checked) force.add(c.id);
      else force.delete(c.id);
    });
    body.push(h('div', { class: 'rv-conflict-note', role: 'note' },
      h('p', {}, conflictText(c)),
      ...c.conflicts.slice(0, 5).map((x) => h('p', { class: 'd-muted' }, `${x.account ?? 'Someone'}, ${when(x.at)}: ${x.what}`)),
      h('label', { class: 'd-check', for: again.id }, again, 'Apply it anyway when I apply')));
  }
  return h('article', { class: `rv-change rv-${status}`, 'aria-labelledby': `rv-pick-${c.id}` }, box, h('div', { class: 'rv-body' }, ...body));
}

/** The Review tab. */
export async function reviewTab(studio: Studio): Promise<HTMLElement> {
  let review: PendingReview;
  try {
    review = await studio.client.pending();
  } catch (e) {
    return h('p', { class: 'd-muted' }, errorText(e));
  }
  const picked = new Set<number>();
  const force = new Set<number>();
  const root = h('section', { class: 'd-main rv' }, h('h2', {}, 'Review changes'));
  const result = h('div', { class: 'rv-result', role: 'status', 'aria-live': 'polite', tabindex: '-1', hidden: '' });
  const list = h('div', { class: 'rv-groups' });
  const bar = h('div', { class: 'd-actions rv-bar' });
  let busy = false;

  const show = (r: PendingReview) => {
    review = r;
    for (const id of [...picked]) if (!r.changes.some((c) => c.id === id)) picked.delete(id);
    for (const id of [...force]) if (!r.changes.some((c) => c.id === id)) force.delete(id);
    draw();
  };
  const run = async (what: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    drawBar();
    try {
      await what();
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
      drawBar();
    }
  };
  const tell = (lines: string[]) => {
    result.replaceChildren(h('strong', {}, lines[0]), ...(lines.length > 1 ? [h('ul', {}, ...lines.slice(1).map((l) => h('li', {}, l)))] : []));
    result.hidden = false;
    result.focus();
  };
  const apply = (ids?: number[]) => run(async () => {
    const r = await studio.client.applyPending(ids, [...force].filter((id) => !ids || ids.includes(id)));
    studio.design = r.design;
    show(r);
    tell(resultLines(r.result));
  });
  const discard = (ids?: number[]) => {
    const n = ids ? ids.length : review.changes.length;
    if (!confirm(`Discard ${n} staged change${n === 1 ? '' : 's'}? They are not applied.`)) return Promise.resolve();
    return run(async () => {
      const r = await studio.client.discardPending(ids);
      show(r);
      tell([`Discarded ${r.discarded} change${r.discarded === 1 ? '' : 's'}.`]);
    });
  };

  // The bar is built once and updated, so a ticked box or a pressed button keeps the keyboard focus.
  const all = h('input', { type: 'checkbox', id: 'rv-all' });
  const count = h('span', { class: 'd-muted' });
  const applySelected = button('Apply selected (0)', () => void apply(chosen()), { class: 'primary' });
  const applyAll = button('Apply all', () => void apply(), { title: 'Applies every staged change that can be applied; those in conflict wait unless you chose to apply them anyway' });
  const discardSelected = button('Discard selected', () => void discard(chosen()), { class: 'danger' });
  const refresh = button('Refresh', () => void run(async () => show(await studio.client.pending())));
  const allLabel = h('label', { class: 'd-check', for: 'rv-all' }, all, 'Select all');
  bar.append(allLabel, applySelected, applyAll, discardSelected, refresh, count);
  all.addEventListener('change', () => {
    picked.clear();
    if (all.checked) for (const c of review.changes) picked.add(c.id);
    for (const box of list.querySelectorAll<HTMLInputElement>('input[id^="rv-pick-"]')) box.checked = all.checked;
    drawBar();
  });
  const chosen = () => review.changes.filter((c) => picked.has(c.id)).map((c) => c.id);

  const drawBar = () => {
    const changes = review.changes;
    const n = chosen().length;
    const ready = changes.filter((c) => c.status === 'ready' && !c.conflicts.length).length;
    const blocked = changes.filter((c) => c.status === 'blocked').length;
    const conflicted = changes.filter((c) => c.conflicts.length).length;
    allLabel.hidden = !changes.length;
    all.checked = changes.length > 0 && n === changes.length;
    all.indeterminate = n > 0 && n < changes.length;
    applySelected.textContent = `Apply selected (${n})`;
    applySelected.disabled = busy || !n;
    applyAll.disabled = busy || !changes.length;
    discardSelected.disabled = busy || !n;
    refresh.disabled = busy;
    count.textContent = changes.length
      ? `${changes.length} staged: ${ready} ready${blocked ? `, ${blocked} cannot apply` : ''}${conflicted ? `, ${conflicted} in conflict` : ''}`
      : 'Nothing is waiting for review';
  };

  const draw = () => {
    drawBar();
    const changes = review.changes;
    if (!changes.length) {
      list.replaceChildren(h('p', { class: 'd-muted' }, 'Stage changes below, or have the assistant or a script stage them, to look them over before they are applied.'));
      return;
    }
    list.replaceChildren(...groupChanges(changes).map((g) => h('section', { class: 'rv-group', 'aria-label': `${g.label} ${g.name}` },
      h('h3', {}, h('span', { class: 'd-muted' }, `${g.label[0].toUpperCase()}${g.label.slice(1)} `), g.name, h('span', { class: 'd-count' }, `${g.changes.length}`)),
      ...g.changes.map((c) => changeView(c, picked, force, drawBar)))));
  };

  const text = h('textarea', { id: 'rv-json', rows: '5', spellcheck: 'false', placeholder: '[{"op": "updateScript", "script": "Tidy", "text": "Beep"}]' });
  const stage = h('details', { class: 'rv-stage' },
    h('summary', {}, 'Stage changes'),
    h('p', { class: 'd-muted' }, 'A list of design changes as JSON, the form the assistant and the design API use. Nothing is changed until you apply it here.'),
    h('label', { class: 'd-field', for: 'rv-json' }, h('span', { class: 'd-label' }, 'Changes (JSON)'), text),
    h('div', { class: 'd-actions' }, button('Stage', () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.value);
      } catch {
        toast('That is not valid JSON: send a list of changes, like [{"op": "createTable", "name": "Orders"}]');
        return;
      }
      const ops = Array.isArray(parsed) ? parsed : [parsed];
      void run(async () => {
        const r = await studio.client.stage(ops as never);
        text.value = '';
        show(r);
        tell([`Staged ${r.staged.length} change${r.staged.length === 1 ? '' : 's'} for review.`]);
      });
    }, { class: 'primary' })));

  root.append(bar, result, list, stage);
  draw();
  return root;
}
