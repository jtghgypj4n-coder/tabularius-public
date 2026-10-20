// A dashboard's digest on the dashboards page: "every Monday at 8, summarise new and overdue invoices". Set it up
// here; the server works the dashboard out at that time, has the assistant summarise it, and keeps the run, shown
// below the dashboard (and as a notice in the web client when it is new). Nothing is emailed.

import { h, button } from '../design/dom.ts';
import { httpProblem } from '../http-problem.ts';

export interface DigestRun {
  id: string;
  at: string;
  outcome: 'ok' | 'error';
  summary?: string;
  summaryNote?: string;
  highlights: string[];
  webhook?: { sent: boolean; error?: string };
  error?: string;
}
export interface Digest {
  id: string;
  name: string;
  dashboard: string;
  dashboardName?: string;
  days: number[];
  at: string;
  prompt?: string;
  webhook?: string;
  enabled: boolean;
  account: string;
  schedule: string;
  next?: string;
  canChange: boolean;
  last?: DigestRun;
}
export interface DigestList {
  digests: Digest[];
  /** The admin console's webhooks for this file, for [Full Access]. */
  webhooks?: { id: string; url: string; enabled: boolean }[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function digestApi(db: string, token: string) {
  const base = `/tabularius/digests/v1/databases/${encodeURIComponent(db)}`;
  return async <T>(method: string, path = '', body?: unknown): Promise<T> => {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json as T;
  };
}

/** A run: the summary, the dashboard's numbers in a few lines, and how delivery went. */
export function runView(run: DigestRun): HTMLElement {
  return h('div', { class: 'digest-run' },
    h('p', { class: 'dash-note' }, new Date(run.at).toLocaleString()),
    run.outcome === 'error' ? h('p', { class: 'dash-error' }, run.error ?? 'It failed') : '',
    run.summary ? h('div', { class: 'digest-summary' }, run.summary) : '',
    run.summaryNote ? h('p', { class: 'dash-note' }, run.summaryNote) : '',
    run.highlights.length ? h('details', { class: 'dash-how' }, h('summary', {}, 'The numbers'), h('ul', {}, ...run.highlights.map((l) => h('li', {}, l)))) : '',
    run.webhook ? h('p', { class: run.webhook.sent ? 'dash-note' : 'dash-error' }, run.webhook.sent ? 'Posted to the webhook' : run.webhook.error ?? 'Not posted') : '');
}

/** The digest section under a dashboard: its schedule and latest run, or a way to set one up. */
export function digestPanel(db: string, token: string, dashboard: { id: string; name: string }, canChange: boolean): HTMLElement {
  const call = digestApi(db, token);
  const el = h('section', { class: 'digest', 'aria-label': 'Digest' });
  let list: DigestList = { digests: [] };

  async function load(): Promise<void> {
    try {
      list = await call<DigestList>('GET');
    } catch (e) {
      el.replaceChildren(h('p', { class: 'dash-error' }, (e as Error).message));
      return;
    }
    show();
  }

  function show(): void {
    const mine = list.digests.filter((d) => d.dashboard === dashboard.id);
    const items = mine.map((d) => {
      const status = h('span', { class: 'g-status', 'aria-live': 'polite' });
      const act = (label: string, run: () => Promise<unknown>, opts: Record<string, string> = {}) => button(label, () => void (async () => {
        status.textContent = '';
        try {
          await run();
          await load();
        } catch (e) {
          status.textContent = (e as Error).message;
        }
      })(), opts);
      return h('div', { class: 'digest-item' },
        h('div', { class: 'digest-head' },
          h('strong', {}, d.name),
          h('span', { class: 'dash-note' }, `${d.schedule}${d.enabled ? (d.next ? ` · next ${new Date(d.next).toLocaleString()}` : '') : ' · off'} · runs as ${d.account}`),
          h('span', { class: 'g-spacer' }), status,
          ...(d.canChange ? [
            act('Run now', async () => {
              status.textContent = 'Running…';
              await call('POST', `/${d.id}/run`);
            }),
            button('Change', () => el.replaceChildren(form(d))),
            act(d.enabled ? 'Turn off' : 'Turn on', () => call('PUT', `/${d.id}`, { enabled: !d.enabled })),
            act('Delete', async () => {
              if (confirm(`Delete the digest "${d.name}" and its runs? The dashboard stays.`)) await call('DELETE', `/${d.id}`);
            }, { class: 'danger' }),
          ] : [])),
        d.prompt ? h('p', { class: 'dash-note' }, `Summarises: ${d.prompt}`) : '',
        d.last ? runView(d.last) : d.canChange ? h('p', { class: 'dash-note' }, 'No runs yet.') : '');
    });
    el.replaceChildren(h('h2', {}, 'Digest'), ...items,
      ...(canChange ? [button(mine.length ? 'Add another digest' : 'Send a digest of this dashboard on a schedule', () => el.replaceChildren(form()))] : []),
      ...(!mine.length && !canChange ? [h('p', { class: 'dash-note' }, 'No digest of this dashboard.')] : []));
  }

  function form(d?: Digest): HTMLElement {
    const name = h('input', { type: 'text', value: d?.name ?? `${dashboard.name} digest`, 'aria-label': 'Name' }) as HTMLInputElement;
    const days = DAYS.map((label, i) => {
      const box = h('input', { type: 'checkbox', value: String(i) }) as HTMLInputElement;
      box.checked = d ? d.days.includes(i) : i === 1;
      return { box, label: h('label', { class: 'digest-day' }, box, label) };
    });
    const at = h('input', { type: 'time', value: d?.at ?? '08:00', 'aria-label': 'Time' }) as HTMLInputElement;
    const prompt = h('textarea', { rows: '2', placeholder: 'What to summarise, e.g. new and overdue invoices, and anything unusual', 'aria-label': 'What to summarise' }) as HTMLTextAreaElement;
    prompt.value = d?.prompt ?? '';
    const hooks = list.webhooks ?? [];
    const webhook = h('select', { 'aria-label': 'Webhook' },
      h('option', { value: '' }, 'Only in the app'), ...hooks.map((w) => h('option', { value: w.id }, `Also post to ${w.url}${w.enabled ? '' : ' (off)'}`))) as HTMLSelectElement;
    webhook.value = d?.webhook ?? '';
    const status = h('span', { class: 'g-status', 'aria-live': 'polite' });
    const save = button(d ? 'Save' : 'Set it up', () => void (async () => {
      const body = { name: name.value, days: days.filter((x) => x.box.checked).map((x) => Number(x.box.value)), at: at.value, prompt: prompt.value, ...(hooks.length ? { webhook: webhook.value } : {}) };
      save.disabled = true;
      try {
        if (d) await call('PUT', `/${d.id}`, body);
        else await call('POST', '', { ...body, dashboard: dashboard.id });
        await load();
      } catch (e) {
        status.textContent = (e as Error).message;
        save.disabled = false;
      }
    })(), { class: 'primary' });
    return h('div', { class: 'digest-form' },
      h('h2', {}, d ? 'Change the digest' : 'New digest'),
      h('label', {}, 'Name ', name),
      h('div', { class: 'digest-days', role: 'group', 'aria-label': 'Days' }, ...days.map((x) => x.label), h('label', {}, 'at ', at)),
      h('label', {}, 'What to summarise ', prompt),
      hooks.length ? h('label', {}, 'Where ', webhook) : '',
      h('p', { class: 'dash-note' }, 'It runs as you, on the server, and the assistant summarises the dashboard\'s numbers. Runs are shown here and in the admin console; nothing is emailed.'),
      h('div', { class: 'ai-actions' }, save, button('Cancel', () => show()), status));
  }

  void load();
  return el;
}
