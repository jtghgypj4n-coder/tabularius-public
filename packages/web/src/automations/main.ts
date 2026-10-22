// Automations: rules that run a script on a record whenever it is created or changed, from any app. Each shows
// what sets it off and its recent runs, and can be turned off or deleted. The assistant drafts new ones from a
// sentence and tries them on a copy of the file first. Needs [Full Access].

import { h, button } from '../design/dom.ts';
import { AssistantPanel, assistantInfo } from '../assistant.ts';
import type { AutomationSpec } from '../automation-view.ts';
import { httpProblem } from '../http-problem.ts';

interface Run { at: string; recordId: number; outcome: 'ok' | 'warning' | 'error' | 'skipped'; error?: number; steps?: number; ms?: number; message?: string }
interface Saved extends AutomationSpec { id: string; trigger: string; runs: Run[]; updated: string }

const app = document.getElementById('app')!;

function session(): { db: string; token: string } | undefined {
  try {
    const saved = sessionStorage.getItem('tabularius.session');
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

async function start(): Promise<void> {
  const s = session();
  if (!s) {
    app.replaceChildren(h('p', { class: 'empty' }, 'Log in to a file first, then open Automations from its toolbar. ', h('a', { href: './' }, 'Log in')));
    return;
  }
  const base = `/tabularius/automations/v1/databases/${encodeURIComponent(s.db)}`;
  const call = async <T>(method: string, path = '', body?: unknown): Promise<T> => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json as T;
  };
  const status = h('span', { class: 'g-status', 'aria-live': 'polite' });
  const list = h('div', { class: 'cleanup-page' });
  const header = h('header', { class: 'g-header' }, h('span', { class: 'g-title' }, 'Automations'), h('span', {}, s.db), h('span', { class: 'g-spacer' }), status,
    button('Refresh', () => void load()));
  const shell = h('div', { class: 'g-shell with-ai dash-shell' }, header, h('main', { class: 'dash-page' }, list));
  app.replaceChildren(shell);
  document.title = `${s.db} · Automations`;
  let panel: AssistantPanel | undefined;
  void assistantInfo(s.db, s.token).then((info) => {
    if (!info.available || !info.canDesign) return;
    panel = new AssistantPanel(s.db, s.token, () => ({ mode: 'browse' }));
    header.insertBefore(button('Ask AI', () => panel!.toggle(), { class: 'g-ai' }), status);
    shell.append(panel.element);
  });

  async function load(): Promise<void> {
    let body: { automations: Saved[]; network: boolean; outbound: boolean };
    try {
      body = await call('GET');
    } catch (e) {
      list.replaceChildren(h('p', { class: 'empty' }, (e as Error).message));
      return;
    }
    const note = h('p', { class: 'dash-note' }, `Scripts run on the server${body.network ? '; Insert from URL may reach the network for automations that allow it' : ", and can't reach the network until an administrator turns on Script network for this file"}. ` +
      (body.outbound ? 'Send Mail goes to the outbox (outbound test mode).' : 'Send Mail sends nothing.') + ' An automation\'s own changes set off no automations.');
    if (!body.automations.length) {
      list.replaceChildren(h('div', { class: 'dash-empty' }, h('h2', {}, 'No automations yet'),
        h('p', {}, 'Describe a rule to the assistant, for example "when an invoice is marked paid, set the paid date and add a note to the customer". It drafts the trigger and script and tries them on a copy of the file before you turn them on.'),
        ...(panel ? [button('Describe a rule', () => void panel!.askAbout('Make an automation: when an invoice is marked paid, set the paid date and add a note to the customer'), { class: 'ai-chip' })] : []), note));
      return;
    }
    list.replaceChildren(note, ...body.automations.map((a) => {
      const toggle = button(a.enabled ? 'Turn off' : 'Turn on', () => void call('PUT', `/${a.id}`, { enabled: !a.enabled }).then(load, (e: Error) => (status.textContent = e.message)));
      const del = button('Delete', () => {
        if (confirm(`Delete the automation "${a.name}"? Its script stays.`)) void call('DELETE', `/${a.id}`).then(load, (e: Error) => (status.textContent = e.message));
      }, { class: 'danger' });
      const runs = a.runs.length
        ? h('table', { class: 'dash-table' }, h('thead', {}, h('tr', {}, ...['When', 'Record', 'Result', 'Steps'].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...a.runs.map((r) => h('tr', {}, h('td', {}, new Date(r.at).toLocaleString()), h('td', {}, String(r.recordId)),
            h('td', { class: r.outcome === 'error' || r.outcome === 'warning' ? 'dash-error' : '' }, r.outcome === 'ok' ? 'OK' : r.outcome === 'warning' ? `Warning: ${r.message ?? 'a step did not finish'}` : r.outcome === 'error' ? `Error ${r.error ?? ''}${r.message ? `: ${r.message}` : ''}` : r.message ?? 'Skipped'),
            h('td', { class: 'num' }, String(r.steps ?? ''))))))
        : h('p', { class: 'dash-note' }, 'Not run yet');
      return h('section', { class: 'dash-widget automation' }, h('div', { class: 'dash-title' }, `${a.name}${a.enabled ? '' : ' (off)'}`),
        ...(a.description ? [h('p', { class: 'dash-note' }, a.description)] : []), h('p', {}, a.trigger), runs, h('div', { class: 'ai-actions' }, toggle, del));
    }));
  }
  await load();
}

void start();
