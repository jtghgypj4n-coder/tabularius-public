// Dashboards: charts, summary tables and numbers saved with the file, worked out from the data each time they
// are shown and every few seconds while the page is open, so they stay live. Ask the assistant for one in plain
// English ("revenue by month for my top 10 customers this year"), or change what each widget finds and how it
// groups here. Numbers are worked out as the signed-in account: records it can't view are left out.

import { h, button } from '../design/dom.ts';
import { AssistantPanel, assistantInfo } from '../assistant.ts';
import { renderWidget, tidyWidget, widgetEditor, type Widget, type WidgetData } from '../dashboard-view.ts';
import { digestPanel } from './digest.ts';
import { httpProblem } from '../http-problem.ts';

interface Summary { id: string; name: string; description?: string; widgets: number; account?: string; updated: string; canChange: boolean }
interface Dashboard { id: string; name: string; description?: string; widgets: Widget[]; account?: string; updated: string }

/** How often a dashboard is worked out again while the page is open and in view. */
const REFRESH_MS = 15_000;

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
    app.replaceChildren(h('p', { class: 'empty' }, 'Log in to a file first, then open Dashboards from its toolbar. ', h('a', { href: './' }, 'Log in')));
    return;
  }
  const base = `/tabularius/dashboards/v1/databases/${encodeURIComponent(s.db)}`;
  const call = async <T>(method: string, path = '', body?: unknown): Promise<T> => {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json as T;
  };

  let list: Summary[] = [];
  let current: { dashboard: Dashboard; canChange: boolean; data: WidgetData[] } | undefined;
  let openRequest = 0;
  /** The widgets being edited (a copy), while editing. */
  let editing: Widget[] | undefined;
  let editData: WidgetData[] | undefined;
  /** The name typed while editing, kept when a widget removed or duplicated draws the page again. */
  let editName = '';
  /** The digest section of the dashboard shown, kept across refreshes so a form being filled in stays. */
  let digest: { id: string; el: HTMLElement } | undefined;

  const picker = h('select', { 'aria-label': 'Dashboard' }) as HTMLSelectElement;
  // Refreshed every few seconds, so not live (that would talk over the page); a failure is an alert.
  const updated = h('span', { class: 'g-status' });
  const editBtn = button('Edit', () => startEditing());
  const deleteBtn = button('Delete', () => void remove(), { class: 'danger' });
  const refreshBtn = button('Refresh', () => void open(current?.dashboard.id), { title: 'Work it out again now' });
  const header = h('header', { class: 'g-header' }, h('span', { class: 'g-title' }, 'Dashboards'), h('span', {}, s.db), picker, h('span', { class: 'g-spacer' }), updated, editBtn, deleteBtn, refreshBtn);
  const body = h('main', { class: 'dash-page' });
  const shell = h('div', { class: 'g-shell with-ai dash-shell' }, header, body);
  app.replaceChildren(shell);
  document.title = `${s.db} · Dashboards`;

  let panel: AssistantPanel | undefined;
  const ask = (q: string) => void panel?.askAbout(q);
  void assistantInfo(s.db, s.token).then((info) => {
    if (!info.available) return;
    panel = new AssistantPanel(s.db, s.token, () => ({ mode: 'browse' }));
    // A dashboard the assistant proposes and the person saves shows up here straight away.
    panel.onDashboardSaved = (id) => void loadList().then(() => open(id));
    header.insertBefore(button('Ask AI', () => panel!.toggle(), { class: 'g-ai' }), updated);
    shell.append(panel.element);
    if (!list.length) render();
  });

  picker.addEventListener('change', () => {
    if (editing) { picker.value = current?.dashboard.id ?? ''; return; }
    void open(picker.value);
  });

  async function loadList(): Promise<void> {
    list = (await call<{ dashboards: Summary[] }>('GET')).dashboards;
    picker.replaceChildren(...list.map((d) => h('option', { value: d.id }, d.name)));
    picker.hidden = !list.length;
  }

  async function open(id: string | undefined): Promise<void> {
    const request = ++openRequest;
    if (editing && id !== current?.dashboard.id) {
      picker.value = current?.dashboard.id ?? '';
      return;
    }
    if (!id) {
      current = undefined;
      render();
      return;
    }
    try {
      const next = await call<{ dashboard: Dashboard; canChange: boolean; data: WidgetData[] }>('GET', `/${id}`);
      if (request !== openRequest || (editing && id !== current?.dashboard.id)) {
        picker.value = current?.dashboard.id ?? '';
        return;
      }
      current = next;
      picker.value = id;
      const url = new URL(location.href);
      url.searchParams.set('id', id);
      history.replaceState(null, '', url);
      updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      updated.removeAttribute('role');
    } catch (e) {
      if (request !== openRequest || editing) return;
      updated.textContent = `Couldn't update: ${(e as Error).message}`;
      updated.setAttribute('role', 'alert');
    }
    if (!editing) render();
  }

  function render(): void {
    picker.disabled = !!editing;
    editBtn.hidden = deleteBtn.hidden = !current?.canChange || !!editing;
    refreshBtn.hidden = !current || !!editing;
    if (!current) {
      const examples = ['Revenue by month for my top 10 customers this year', 'Open invoices by customer, with their total', 'New records per week over the last 3 months'];
      body.replaceChildren(h('div', { class: 'dash-empty' },
        h('h2', {}, list.length ? 'Pick a dashboard' : 'No dashboards yet'),
        h('p', {}, panel ? 'Describe one in your own words and the assistant builds it from your data, with the finds it uses shown and editable:' : 'Turn on the assistant on the server (tabularius serve --ai) to make dashboards from a description.'),
        ...(panel ? [h('div', { class: 'ai-chips' }, ...examples.map((q) => button(q, () => ask(`Make a dashboard: ${q.toLowerCase()}`), { class: 'ai-chip' })))] : [])));
      return;
    }
    const d = current.dashboard;
    const data = editing ? editData ?? current.data : current.data;
    const grid = h('div', { class: 'dash-grid' });
    data.forEach((w, i) => {
      const cell = h('div', { class: 'dash-cell' }, renderWidget(w));
      if (editing) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        cell.append(widgetEditor(editing[i], () => {
          clearTimeout(timer);
          timer = setTimeout(() => void preview(), 600);
        }), h('div', { class: 'ai-actions' },
          button('Remove', () => {
            editing!.splice(i, 1);
            editData?.splice(i, 1);
            render();
          }),
          button('Duplicate', () => {
            editing!.splice(i + 1, 0, structuredClone(editing![i]));
            void preview();
          })));
      }
      grid.append(cell);
    });
    const top = h('div', { class: 'dash-head' }, h('h1', {}, d.name), d.description ? h('p', { class: 'dash-note' }, d.description) : '',
      d.account ? h('p', { class: 'dash-note' }, `Made by ${d.account} · changed ${new Date(d.updated).toLocaleString()}`) : '');
    if (editing) {
      const name = h('input', { type: 'text', 'aria-label': 'Dashboard name' }) as HTMLInputElement;
      name.value = editName;
      name.addEventListener('input', () => (editName = name.value));
      const save = button('Save', () => void (async () => {
        save.disabled = true;
        try {
          const widgets = editing!.map(tidyWidget);
          current = await call('PUT', `/${d.id}`, { name: name.value, widgets });
          editing = editData = undefined;
          await loadList();
          picker.value = d.id;
          render();
        } catch (e) {
          updated.textContent = (e as Error).message;
          save.disabled = false;
        }
      })(), { class: 'primary' });
      top.replaceChildren(name, h('div', { class: 'ai-actions' }, save, button('Cancel', () => {
        editing = editData = undefined;
        render();
      })));
    }
    if (digest?.id !== d.id) digest = { id: d.id, el: digestPanel(s!.db, s!.token, d, current.canChange) };
    body.replaceChildren(top, grid, ...(editing ? [] : [digest.el]));
  }

  function startEditing(): void {
    if (!current) return;
    editing = structuredClone(current.dashboard.widgets);
    editName = current.dashboard.name;
    // A copy: removing a widget while editing must not take it off the dashboard shown if the edit is cancelled.
    editData = [...current.data];
    render();
  }

  /** Works the edited widgets out without saving them. */
  async function preview(): Promise<void> {
    if (!editing || !current) return;
    // The answer may come after Save or Cancel ended this edit (a slow server): then there is nothing to draw it in.
    const session = editing;
    try {
      const r = await call<{ data: WidgetData[] }>('POST', '?preview=1', { name: current.dashboard.name, widgets: session.map(tidyWidget) });
      // A widget removed while this was in flight leaves the answer one entry too long for what is drawn: ask again for what is on the page.
      if (editing === session && r.data.length !== session.length) return void preview();
      if (editing === session) editData = r.data;
      updated.textContent = '';
    } catch (e) {
      updated.textContent = (e as Error).message;
    }
    if (!editing || editing !== session) return;
    // Typing goes on in the editors; only the widgets are drawn again.
    const cells = body.querySelectorAll('.dash-cell');
    if (cells.length !== editing.length) return render();
    editData?.forEach((w, i) => cells[i].querySelector('.dash-widget')?.replaceWith(renderWidget(w)));
  }

  async function remove(): Promise<void> {
    if (!current || !confirm(`Delete the dashboard "${current.dashboard.name}"? The data it shows isn't touched.`)) return;
    await call('DELETE', `/${current.dashboard.id}`);
    await loadList();
    await open(list[0]?.id);
  }

  try {
    await loadList();
  } catch (e) {
    body.replaceChildren(h('p', { class: 'empty' }, (e as Error).message));
    return;
  }
  const wanted = new URL(location.href).searchParams.get('id');
  await open(list.find((d) => d.id === wanted)?.id ?? list[0]?.id);

  // Live: worked out again every few seconds while the page is in view and not being edited.
  setInterval(() => {
    // Nor while the keyboard is inside a widget: redrawing it would drop focus and close what is open (WCAG 2.4.3).
    if (current && !editing && document.visibilityState === 'visible' && !body.contains(document.activeElement)) void open(current.dashboard.id);
  }, REFRESH_MS);
}

void start();
