// A task of several steps the assistant planned (find, set a field across the records found, make or delete records,
// run a script), for the person to carry out: the steps with what each is for, a Dry run that does them all on a copy
// of the file and shows what would change, then one Run button per step, in order, and one Undo for the whole run.
// Every step runs as the signed-in account, so its privileges apply.

import { h } from './design/dom.ts';
import { httpProblem } from './http-problem.ts';
import { confirmAction, stepNeedsConfirmation } from './assistant-chat.ts';

export interface AgentPlan {
  summary: string;
  layout: string;
  steps: { kind: string; why?: string }[];
}

interface RecordChange { file?: string; table: string; recordId: number; kind: 'create' | 'update' | 'delete'; fields: { field: string; before: string; after: string }[] }
interface StepResult {
  step: number;
  outcome: 'ok' | 'error';
  message?: string;
  found: number;
  created: number;
  changed: number;
  deleted: number;
  records?: { records: RecordChange[]; more: number };
}
interface RunState { layout: string; foundSet: number[] }

/** Cards already drawn, so a redraw of the panel keeps a run's place. */
const drawn = new WeakMap<AgentPlan, HTMLElement>();

const counts = (r: StepResult) => [
  `${r.found} record${r.found === 1 ? '' : 's'} found`,
  r.created ? `${r.created} made` : '',
  r.changed ? `${r.changed} changed` : '',
  r.deleted ? `${r.deleted} deleted` : '',
].filter(Boolean).join(', ');

function changesTable(r: StepResult): HTMLElement | undefined {
  const rows = r.records?.records ?? [];
  if (!rows.length) return undefined;
  return h('details', { class: 'cleanup-section' }, h('summary', {}, 'What changes'),
    h('div', { class: 'dash-scroll' }, h('table', { class: 'dash-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Record'), h('th', {}, 'Field'), h('th', {}, 'Before'), h('th', {}, 'After'))),
      h('tbody', {}, ...rows.flatMap((c) => c.kind === 'update'
        ? c.fields.map((f) => h('tr', {}, h('td', {}, `${c.file ? `${c.file} / ` : ''}${c.table} ${c.recordId}`), h('td', {}, f.field), h('td', {}, f.before || '–'), h('td', {}, f.after || '–')))
        : [h('tr', {}, h('td', {}, `${c.file ? `${c.file} / ` : ''}${c.table} ${c.recordId}`), h('td', { colspan: '3' }, c.kind === 'create' ? 'made' : 'deleted'))])))),
    ...(r.records?.more ? [h('p', { class: 'ai-note' }, `And ${r.records.more} more records.`)] : []));
}

export function agentPlanCard(plan: AgentPlan, lines: string[], db: string, token: string): HTMLElement {
  const old = drawn.get(plan);
  if (old) return old;
  const base = `/tabularius/agent/v1/databases/${encodeURIComponent(db)}`;
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json;
  };
  const card = h('div', { class: 'ai-proposal agent-plan' },
    h('div', { class: 'ai-proposal-title' }, plan.summary),
    h('div', { class: 'ai-note' }, `Starts on ${plan.layout}. Nothing runs until you run it; each step runs as you, and Undo takes the whole run back.`));
  const status = h('span', { class: 'ai-note', 'aria-live': 'polite' });
  const runs: HTMLButtonElement[] = [];
  const outs: HTMLElement[] = [];
  const list = h('ol', { class: 'agent-steps' });
  plan.steps.forEach((s, i) => {
    const run = h('button', { type: 'button', disabled: '', title: 'Dry run the plan first' }, 'Run') as HTMLButtonElement;
    const out = h('div', { class: 'agent-step-result' });
    runs.push(run);
    outs.push(out);
    list.append(h('li', { class: 'agent-step' },
      h('div', { class: 'agent-step-head' }, h('span', {}, lines[i] ?? s.kind), run),
      ...(s.why ? [h('div', { class: 'ai-note' }, s.why)] : []), out));
  });
  card.append(list);

  const dry = h('button', { type: 'button', class: 'primary', title: 'Do every step on a copy of the file and show what would change' }, 'Dry run') as HTMLButtonElement;
  const undo = h('button', { type: 'button', hidden: '' }, 'Undo the whole run') as HTMLButtonElement;
  let state: RunState | undefined;
  let runId: string | undefined;
  let next = 0;
  const ready = () => runs.forEach((b, i) => {
    b.disabled = i !== next;
    b.title = i < next ? 'Done' : i === next ? 'Run this step for real' : 'Run the steps before it first';
    if (i < next) b.textContent = 'Done';
  });

  dry.addEventListener('click', async () => {
    dry.disabled = true;
    status.textContent = 'Trying every step on a copy…';
    try {
      const r = await call('/dry-run', { plan }) as { results: StepResult[]; skipped?: string };
      if (r.skipped) status.textContent = `No dry run: ${r.skipped}. You can still run the steps one at a time.`;
      else {
        r.results.forEach((x) => outs[x.step]?.replaceChildren(h('div', { class: x.outcome === 'ok' ? 'ai-note' : 'ai-note agent-error' }, `Dry run: ${x.outcome === 'ok' ? counts(x) : x.message ?? 'failed'}`), ...[changesTable(x)].filter((e): e is HTMLElement => !!e)));
        const failed = r.results.find((x) => x.outcome === 'error');
        status.textContent = failed ? `The dry run stopped at step ${failed.step + 1}. Nothing was changed.` : 'Dry run done on a copy. Nothing was changed. Run the steps in order when it looks right.';
      }
      if (!runId) ready();
    } catch (e) {
      status.textContent = (e as Error).message;
    }
    dry.disabled = false;
  });

  runs.forEach((b, i) => b.addEventListener('click', async () => {
    if (i !== next) return;
    // A step that deletes, changes records or runs a script is asked about first, in words, by the page itself.
    const risk = stepNeedsConfirmation(plan.steps[i].kind, lines[i] ?? plan.steps[i].kind);
    if (risk && !(await confirmAction({ title: `Run step ${i + 1} for real?`, lines: [risk, 'It runs as you, on this file. Undo takes the whole run back.'], confirm: 'Run this step' }))) return;
    runs.forEach((x) => (x.disabled = true));
    status.textContent = `Running step ${i + 1}…`;
    try {
      const r = await call('/step', { plan, step: i, ...(state ? { state } : {}), ...(runId ? { run: runId } : {}) }) as { result: StepResult; state: RunState; run?: string };
      state = r.state;
      if (r.run) runId = r.run;
      outs[i].replaceChildren(h('div', { class: r.result.outcome === 'ok' ? 'ai-note' : 'ai-note agent-error' }, r.result.outcome === 'ok' ? `Done: ${counts(r.result)}` : r.result.message ?? 'Failed'),
        ...[changesTable(r.result)].filter((e): e is HTMLElement => !!e));
      if (r.result.outcome === 'ok') next = i + 1;
      status.textContent = r.result.outcome !== 'ok' ? `Step ${i + 1} stopped. Fix what it says and run it again, or undo the run.` : next === plan.steps.length ? 'All steps done.' : `Step ${i + 1} done.`;
      undo.hidden = !runId;
      dry.disabled = true;
      dry.title = 'The run has started';
    } catch (e) {
      status.textContent = (e as Error).message;
    }
    ready();
  }));

  undo.addEventListener('click', async () => {
    if (!runId) return;
    undo.disabled = true;
    try {
      const r = await call(`/runs/${runId}/undo`) as { undone: number; skipped: string[] };
      status.textContent = `Undone: ${r.undone} change${r.undone === 1 ? '' : 's'} taken back.${r.skipped.length ? ` Left alone because they changed since: ${r.skipped.slice(0, 5).join('; ')}${r.skipped.length > 5 ? '…' : ''}.` : ''}`;
      undo.hidden = true;
      runs.forEach((x) => (x.disabled = true));
    } catch (e) {
      status.textContent = (e as Error).message;
      undo.disabled = false;
    }
  });

  card.append(h('div', { class: 'ai-actions' }, dry, undo, status));
  drawn.set(plan, card);
  return card;
}
