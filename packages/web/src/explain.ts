// Explain This Value without the assistant: what the server's trace says about a
// field, drawn as a sheet. A calculation shows its formula, the value of every
// field it read, whether the stored value is still what the formula gives, and
// the calculations behind it; a related field or portal row shows the
// relationship that was followed and why the record is (or isn't) there.

interface Step { expr: string; value?: string; error?: { code: number; message: string }; steps?: Step[] }
interface Dependency { field: string; kind: string; storage: string; formula?: string; dependsOn?: Dependency[] }

export interface FieldTrace {
  table: string;
  field: string;
  type: string;
  kind: string;
  storage: string;
  value: string;
  formula?: string;
  context?: string;
  doNotEvaluateIfEmpty?: boolean;
  references?: { field: string; value?: string; empty?: boolean; missing?: boolean }[];
  notEvaluated?: string;
  result?: string;
  error?: { code: number; message: string };
  matchesStored?: boolean;
  steps?: Step;
  dependencies?: Dependency[];
  warnings?: { code: string; message: string }[];
  notes?: string[];
}

export interface RelatedTrace {
  kind: 'portal' | 'related field';
  from: { occurrence: string; table: string; recordId: number };
  to: { occurrence: string; table: string; file?: string };
  path: { relationship: string; from: string; to: string; match: { match: string; values: unknown[]; moreValues?: number; matches?: number; problem?: string }[]; records: number }[];
  related: number;
  portal?: { name: string; filter?: string; sort?: string[]; shown: number; filteredOut: number };
  field?: { name: string; recordId?: number; value?: string };
  candidate?: { recordId: number; exists: boolean; related: boolean; shown: boolean; checks: { match: string; value: unknown; ok: boolean }[]; reason: string };
  verdict: string;
  notes: string[];
}

export interface ValueExplanation { field?: FieldTrace; related?: RelatedTrace }

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

const shown = (v: unknown): string => (v === null || v === undefined || v === '' ? 'empty' : String(v).replace(/\r|\n/g, '¶'));

const STORAGE: Record<string, string> = {
  stored: 'Stored calculation', unstored: 'Unstored calculation', global: 'Global field', summary: 'Summary field', 'auto-enter': 'Auto-enter calculation', data: 'Data field',
};

/** The sheet's sections for one field's trace. */
function fieldSections(t: FieldTrace): HTMLElement[] {
  const out: HTMLElement[] = [];
  const facts = h('dl', { class: 'explain-facts' },
    h('dt', {}, 'Field'), h('dd', {}, `${t.table}::${t.field}`),
    h('dt', {}, 'Kind'), h('dd', {}, `${STORAGE[t.storage] ?? t.kind}, ${t.type}`),
    h('dt', {}, 'Shows'), h('dd', { class: 'explain-value' }, shown(t.value)));
  if (t.context) facts.append(h('dt', {}, 'Evaluated from'), h('dd', {}, t.context));
  out.push(facts);
  if (t.formula) out.push(h('section', {}, h('h3', {}, 'Formula'), h('pre', { class: 'explain-formula' }, t.formula)));
  // The verdict first: what the formula gives now, and whether that is what the record holds.
  const verdict: string[] = [];
  if (t.notEvaluated) verdict.push(t.notEvaluated);
  if (t.error) verdict.push(`The formula stops with error ${t.error.code}: ${t.error.message}.`);
  else if (t.result !== undefined && t.matchesStored === false) verdict.push(`The stored value is out of date: the formula gives ${shown(t.result)} now. FileMaker updates a stored calculation only when a field it reads on the same record changes.`);
  else if (t.result !== undefined && t.formula) verdict.push(`The formula gives ${shown(t.result)}.`);
  if (!t.formula && t.storage === 'data') verdict.push('No formula sets this field: it holds what was typed, imported, pasted or set by a script.');
  if (t.doNotEvaluateIfEmpty) verdict.push('"Do not evaluate if all referenced fields are empty" is on.');
  if (verdict.length) out.push(h('p', { class: `explain-verdict${t.matchesStored === false || t.error ? ' warn' : ''}` }, verdict.join(' ')));
  if (t.references?.length) {
    out.push(h('section', {}, h('h3', {}, 'Values it read'), h('table', { class: 'explain-table' },
      h('tbody', {}, ...t.references.map((r) => h('tr', {},
        h('th', { scope: 'row' }, r.field),
        h('td', { class: r.missing ? 'warn' : r.empty ? 'muted' : '' }, r.missing ? 'not a field of this file' : shown(r.value))))))));
  }
  if (t.steps?.steps?.length) {
    const step = (s: Step): HTMLElement => h('li', {},
      h('code', {}, s.expr), ' → ', h('span', { class: s.error ? 'warn' : 'explain-value' }, s.error ? `error ${s.error.code}` : shown(s.value)),
      ...(s.steps?.length ? [h('ul', {}, ...s.steps.map(step))] : []));
    out.push(h('details', {}, h('summary', {}, 'Each step'), h('ul', { class: 'explain-steps' }, step(t.steps))));
  }
  if (t.dependencies?.length) {
    const dep = (d: Dependency): HTMLElement => h('li', {}, h('strong', {}, d.field), ` (${STORAGE[d.storage] ?? d.kind})`,
      ...(d.dependsOn?.length ? [h('ul', {}, ...d.dependsOn.map(dep))] : []));
    out.push(h('details', {}, h('summary', {}, 'Calculations behind it'), h('ul', { class: 'explain-steps' }, ...t.dependencies.map(dep))));
  }
  const notes = [...(t.warnings ?? []).map((w) => w.message), ...(t.notes ?? [])];
  if (notes.length) out.push(h('section', {}, h('h3', {}, 'Worth knowing'), h('ul', { class: 'explain-notes' }, ...notes.map((n) => h('li', {}, n)))));
  return out;
}

/** The sheet's sections for a relationship trace. */
function relatedSections(t: RelatedTrace): HTMLElement[] {
  const out: HTMLElement[] = [h('p', { class: 'explain-verdict' }, t.verdict)];
  const hops = t.path.map((hop) => h('li', {},
    h('div', {}, h('strong', {}, `${hop.from} → ${hop.to}`), h('span', { class: 'muted' }, ` finds ${hop.records} record${hop.records === 1 ? '' : 's'}`)),
    h('ul', {}, ...hop.match.map((m) => h('li', {}, h('code', {}, m.match), ' with ', shown(m.values.length ? m.values.map(shown).join(', ') : ''),
      ...(m.moreValues ? [` and ${m.moreValues} more`] : []), ...(m.problem ? [h('span', { class: 'warn' }, ` (${m.problem})`)] : []))))));
  out.push(h('section', {}, h('h3', {}, 'Relationship followed'), h('ol', { class: 'explain-steps' }, ...hops)));
  if (t.portal) {
    const lines = [`Shows ${t.portal.shown} of ${t.related} related record${t.related === 1 ? '' : 's'}.`];
    if (t.portal.filter) lines.push(`Filtered by ${t.portal.filter} (${t.portal.filteredOut} left out).`);
    if (t.portal.sort?.length) lines.push(`Sorted by ${t.portal.sort.join(', ')}.`);
    out.push(h('section', {}, h('h3', {}, `Portal ${t.portal.name}`), h('p', {}, lines.join(' '))));
  }
  if (t.candidate) {
    out.push(h('section', {}, h('h3', {}, 'This row'),
      h('p', {}, t.candidate.reason),
      h('table', { class: 'explain-table' }, h('tbody', {}, ...t.candidate.checks.map((c) => h('tr', {},
        h('th', { scope: 'row' }, c.match), h('td', { class: c.ok ? '' : 'warn' }, `${shown(c.value)} ${c.ok ? '✓' : '✗'}`)))))));
  }
  if (t.notes.length) out.push(h('section', {}, h('h3', {}, 'Worth knowing'), h('ul', { class: 'explain-notes' }, ...t.notes.map((n) => h('li', {}, n)))));
  return out;
}

/** Shows the trace in a modal sheet; closes on Done, Escape or a click outside. */
export function showExplanation(title: string, e: ValueExplanation): HTMLDialogElement {
  const body = h('div', { class: 'explain-body' });
  if (e.field) body.append(...fieldSections(e.field));
  if (e.related) {
    if (e.field) body.append(h('h3', { class: 'explain-part' }, 'How this row is related'));
    body.append(...relatedSections(e.related));
  }
  const done = h('button', { type: 'button', class: 'primary' }, 'Done');
  const dialog = h('dialog', { class: 'explain-sheet', 'aria-labelledby': 'explain-title' },
    h('h2', { id: 'explain-title' }, title), body, h('div', { class: 'actions' }, done)) as HTMLDialogElement;
  done.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  done.focus();
  return dialog;
}
