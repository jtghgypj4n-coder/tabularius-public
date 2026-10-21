// Automations on the page: what sets one off, the script it runs, and how its dry run on a copy of the file
// went, with Turn on (the assistant's proposal) or Turn off and Delete (one already saved).

import { h } from './design/dom.ts';
import { httpProblem } from './http-problem.ts';

export interface DryRun {
  recordId?: number;
  setOff?: string[];
  conditionTrue?: boolean;
  outcome: 'ok' | 'error' | 'stalled' | 'skipped';
  error?: number;
  message?: string;
  steps?: number;
  changes: string[];
  outbound: string[];
}

export interface AutomationSpec {
  name: string;
  description?: string;
  enabled: boolean;
  layout: string;
  on: 'create' | 'update' | 'createOrUpdate' | 'delete';
  fields?: string[];
  condition?: string;
  script: string;
  parameter?: string;
  account: string;
  network?: boolean;
}

export interface AutomationOut {
  automation: AutomationSpec;
  script?: { name: string; text: string };
  trigger: string;
  dryRun: DryRun;
}

const enc = encodeURIComponent;

/** Confirm removal of an assistant-saved automation using its visible target name. */
export function confirmAutomationRemoval(name: string, ask: (message: string) => boolean = (message) => confirm(message)): boolean {
  return ask(`Delete the automation "${name}"? Its script stays.`);
}

/** How the dry run went, in a few lines. */
export function dryRunLines(d: DryRun): { text: string; bad?: boolean }[] {
  const out: { text: string; bad?: boolean }[] = [];
  for (const s of d.setOff ?? []) out.push({ text: `Set off by: ${s}` });
  if (d.outcome === 'skipped') out.push({ text: `Not run: ${d.message ?? 'skipped'}`, bad: d.conditionTrue === false });
  else if (d.outcome === 'ok') out.push({ text: `Ran ${d.steps} step${d.steps === 1 ? '' : 's'} with no errors on a copy of the file, offline. The copy was thrown away.` });
  else if (d.outcome === 'stalled') out.push({ text: `Stopped after ${d.steps} steps: a loop that never ends?`, bad: true });
  else out.push({ text: `Ended with error ${d.error}${d.message ? ` (${d.message})` : ''}`, bad: true });
  for (const c of d.changes) out.push({ text: c });
  for (const o of d.outbound) out.push({ text: o });
  return out;
}

/** The assistant's proposal: Turn on saves it (and its script); then Turn off and Delete. */
export function automationCard(a: AutomationOut, db: string, token: string): HTMLElement {
  const base = `/tabularius/automations/v1/databases/${enc(db)}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json;
  };
  const card = h('div', { class: 'ai-proposal automation' },
    h('div', { class: 'ai-proposal-title' }, `Automation: ${a.automation.name}`),
    h('p', {}, a.trigger),
    ...(a.script ? [h('details', {}, h('summary', {}, `Script "${a.script.name}"`), h('pre', {}, a.script.text))] : []),
    h('div', { class: 'ai-note' }, 'Dry run'),
    h('ul', { class: 'ai-preview' }, ...dryRunLines(a.dryRun).map((l) => h('li', { class: l.bad ? 'ai-dry-run-bad' : '' }, l.text))),
    h('div', { class: 'ai-note' }, 'It runs on the server for every matching change, from any app. Mail and web steps do nothing unless this server\'s outbound settings allow them.'));
  const on = h('button', { type: 'button', class: 'primary' }, 'Turn on');
  const off = h('button', { type: 'button', hidden: '' }, 'Turn off');
  const del = h('button', { type: 'button', hidden: '' }, 'Delete');
  const status = h('span', { class: 'ai-note', 'aria-live': 'polite' });
  let id: string | undefined;
  on.addEventListener('click', async () => {
    on.disabled = true;
    try {
      const r = await call('POST', '', { automation: { ...a.automation, enabled: true }, ...(a.script ? { script: a.script } : {}) });
      id = r.automation.id;
      on.hidden = true;
      off.hidden = del.hidden = false;
      status.replaceChildren('On. ', h('a', { href: 'automations.html', target: 'tabularius-automations' }, 'See its runs'));
    } catch (e) {
      status.textContent = (e as Error).message;
      on.disabled = false;
    }
  });
  off.addEventListener('click', async () => {
    if (!id) return;
    try {
      const r = await call('PUT', `/${id}`, { enabled: !(off.textContent === 'Turn off') });
      off.textContent = r.automation.enabled ? 'Turn off' : 'Turn on again';
      status.textContent = r.automation.enabled ? 'On.' : 'Off.';
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  del.addEventListener('click', async () => {
    if (!id || del.disabled || !confirmAutomationRemoval(a.automation.name)) return;
    del.disabled = true;
    try {
      await call('DELETE', `/${id}`);
      off.hidden = del.hidden = true;
      on.hidden = false;
      on.disabled = false;
      status.textContent = 'Deleted (its script stays).';
      id = undefined;
    } catch (e) {
      status.textContent = (e as Error).message;
      del.disabled = false;
    }
  });
  card.append(h('div', { class: 'ai-actions' }, on, off, del, status));
  return card;
}
