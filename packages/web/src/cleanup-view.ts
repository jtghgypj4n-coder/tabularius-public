// Data problems found on a layout (likely duplicates, values off their value list, bad phones and emails), as a
// list to tick: Apply makes the ticked fixes and merges all at once, as the signed-in account, and Undo takes the
// whole batch back. Nothing changes until Apply. Used by the assistant panel and the cleanup page.

import { h } from './design/dom.ts';
import { httpProblem } from './http-problem.ts';

type Value = string | number | null;

export interface ValueFix {
  check: 'valueLists' | 'consistency' | 'phones' | 'emails';
  field: string;
  from: string;
  to?: string;
  reason: string;
  count: number;
  recordIds: number[];
}

export interface DuplicateGroup {
  reason: string;
  score: number;
  records: { recordId: number; values: Record<string, Value> }[];
  keep: number;
  fill: Record<string, Value>;
  related: { table: string; via: string; records: number }[];
}

export interface CleanupScan {
  layout: string;
  table: string;
  scanned: number;
  compared: string[];
  duplicates: DuplicateGroup[];
  fixes: ValueFix[];
  notScanned?: number;
}

const CHECK_NAMES: Record<ValueFix['check'], string> = { valueLists: 'Value list', consistency: 'Written differently', phones: 'Phone', emails: 'Email' };
const show = (v: Value | undefined) => (v === null || v === undefined || v === '' ? '–' : String(v));

/** The scan as a list to tick, with Apply (and then Undo). */
export function cleanupCard(scan: CleanupScan, db: string, token: string, title?: string): HTMLElement {
  const base = `/tabularius/cleanup/v1/databases/${encodeURIComponent(db)}`;
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json;
  };
  const card = h('div', { class: 'ai-proposal cleanup' },
    h('div', { class: 'ai-proposal-title' }, title || `Data problems on ${scan.layout}`),
    h('div', { class: 'ai-note' }, `${scan.scanned} records scanned${scan.notScanned ? ` (${scan.notScanned} more not scanned)` : ''}. Nothing changes until you apply what you tick.`));
  const picks: { checked: () => boolean; merge?: { keep: number; remove: number[]; fill: Record<string, Value> }; fix?: () => { field: string; from: string; to: string } }[] = [];

  if (scan.duplicates.length) {
    const list = h('details', { class: 'cleanup-section', open: '' }, h('summary', {}, `${scan.duplicates.length} likely duplicate${scan.duplicates.length === 1 ? '' : 's'}`));
    for (const g of scan.duplicates) {
      // Each box names its records, so a screen reader can tell the groups apart.
      const others = g.records.map((r) => r.recordId).filter((id) => id !== g.keep);
      const box = h('input', { type: 'checkbox', 'aria-label': `Merge record${others.length === 1 ? '' : 's'} ${others.join(', ')} into record ${g.keep}` }) as HTMLInputElement;
      box.checked = g.score >= 90;
      const fields = Object.keys(g.records[0]?.values ?? {});
      const table = h('table', { class: 'dash-table cleanup-records' },
        h('thead', {}, h('tr', {}, h('th', {}, h('span', { class: 'sr-only' }, 'Keep or merge')), h('th', {}, 'Record'), ...fields.map((f) => h('th', {}, f)))),
        h('tbody', {}, ...g.records.map((r) => h('tr', { class: r.recordId === g.keep ? 'cleanup-keep' : '' },
          h('td', {}, r.recordId === g.keep ? 'Keep' : 'Merge in'), h('td', {}, String(r.recordId)), ...fields.map((f) => h('td', {}, show(r.values[f])))))));
      const notes = [
        `${g.reason} · ${g.score}% alike`,
        ...(Object.keys(g.fill).length ? [`Fills in the kept record's ${Object.entries(g.fill).map(([k, v]) => `${k} (${show(v)})`).join(', ')}`] : []),
        ...g.related.map((r) => `Moves ${r.records} ${r.table} record${r.records === 1 ? '' : 's'} to the kept record`),
      ];
      list.append(h('div', { class: 'cleanup-item' }, h('label', { class: 'cleanup-pick' }, box, h('span', {}, 'Merge')), h('div', {}, ...notes.map((n) => h('div', { class: 'ai-note' }, n)), h('div', { class: 'dash-scroll' }, table))));
      picks.push({ checked: () => box.checked, merge: { keep: g.keep, remove: others, fill: g.fill } });
    }
    card.append(list);
  }
  if (scan.fixes.length) {
    const list = h('details', { class: 'cleanup-section', open: '' }, h('summary', {}, `${scan.fixes.length} value${scan.fixes.length === 1 ? '' : 's'} to fix`));
    for (const f of scan.fixes) {
      const box = h('input', { type: 'checkbox', 'aria-label': `Fix ${f.field}` }) as HTMLInputElement;
      const to = h('input', { type: 'text', 'aria-label': 'Change to', placeholder: 'change to…' }) as HTMLInputElement;
      to.value = f.to ?? '';
      box.checked = f.to !== undefined;
      to.addEventListener('input', () => (box.checked = to.value !== ''));
      list.append(h('div', { class: 'cleanup-item' }, h('label', { class: 'cleanup-pick' }, box, h('span', {}, CHECK_NAMES[f.check])),
        h('div', {}, h('div', { class: 'cleanup-fix' }, h('span', { class: 'cleanup-field' }, f.field), h('code', {}, JSON.stringify(f.from)), h('span', {}, '→'), to),
          h('div', { class: 'ai-note' }, `${f.reason} · ${f.count} record${f.count === 1 ? '' : 's'}`))));
      picks.push({ checked: () => box.checked && to.value !== '', fix: () => ({ field: f.field, from: f.from, to: to.value }) });
    }
    card.append(list);
  }
  if (!picks.length) {
    card.append(h('p', { class: 'ai-note' }, 'Nothing looks wrong.'));
    return card;
  }
  const apply = h('button', { type: 'button', class: 'primary' }, 'Apply ticked');
  const dry = h('button', { type: 'button', title: 'See every change applying would make, without changing anything' }, 'Dry run');
  const preview = h('div', { class: 'cleanup-preview', hidden: '' });
  const undo = h('button', { type: 'button', hidden: '' }, 'Undo');
  const status = h('span', { class: 'ai-note', 'aria-live': 'polite' });
  let batch: string | undefined;
  const ticked = () => {
    const chosen = picks.filter((p) => p.checked());
    if (!chosen.length) status.textContent = 'Tick something to apply first.';
    return chosen.length ? { layout: scan.layout, fixes: chosen.filter((p) => p.fix).map((p) => p.fix!()), merges: chosen.filter((p) => p.merge).map((p) => p.merge) } : undefined;
  };
  dry.addEventListener('click', async () => {
    const request = ticked();
    if (!request) return;
    dry.disabled = true;
    try {
      const r = await call('/apply', { ...request, dryRun: true }) as { summary: string; total: number; changes: { table: string; recordId: number; field?: string; from?: Value; to?: Value; delete?: boolean }[] };
      status.textContent = `Dry run: ${r.summary}, ${r.total} change${r.total === 1 ? '' : 's'} in all. Nothing was changed.`;
      preview.replaceChildren(h('table', { class: 'dash-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Record'), h('th', {}, 'Field'), h('th', {}, 'Now'), h('th', {}, 'Would be'))),
        h('tbody', {}, ...r.changes.map((c) => h('tr', {}, h('td', {}, `${c.table} ${c.recordId}`),
          ...(c.delete ? [h('td', { colspan: '3' }, 'deleted (merged into the kept record)')] : [h('td', {}, c.field ?? ''), h('td', {}, show(c.from)), h('td', {}, show(c.to))]))))),
        ...(r.total > r.changes.length ? [h('p', { class: 'ai-note' }, `And ${r.total - r.changes.length} more.`)] : []));
      preview.hidden = false;
    } catch (e) {
      status.textContent = (e as Error).message;
    }
    dry.disabled = false;
  });
  apply.addEventListener('click', async () => {
    const request = ticked();
    if (!request) return;
    apply.disabled = true;
    preview.hidden = true;
    try {
      const r = await call('/apply', request);
      batch = r.id;
      apply.textContent = 'Applied';
      status.textContent = `${r.summary}. Every change is in the audit log.`;
      undo.hidden = false;
    } catch (e) {
      status.textContent = (e as Error).message;
      apply.disabled = false;
    }
  });
  undo.addEventListener('click', async () => {
    if (!batch) return;
    undo.disabled = true;
    try {
      const r = await call(`/history/${batch}/undo`);
      status.textContent = `Undone (${r.undone} change${r.undone === 1 ? '' : 's'})${r.skipped?.length ? `; left alone because they changed since: ${r.skipped.join(', ')}` : ''}.`;
      undo.hidden = true;
      apply.textContent = 'Apply ticked';
      apply.disabled = false;
      batch = undefined;
    } catch (e) {
      status.textContent = (e as Error).message;
    }
    undo.disabled = false;
  });
  card.append(h('div', { class: 'ai-actions' }, dry, apply, undo, status), preview);
  return card;
}
