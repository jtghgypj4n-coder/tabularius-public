// Clean Up Data: look for likely duplicates, values off their value list, and malformed phone numbers and email
// addresses on a layout, then tick what to fix or merge. Applied all at once as the signed-in account (its
// privileges apply and the audit log records every change), and each batch can be undone here.

import { h, button } from '../design/dom.ts';
import { cleanupCard, type CleanupScan } from '../cleanup-view.ts';
import { httpProblem } from '../http-problem.ts';

interface Batch { id: string; at: string; account?: string; layout: string; summary: string; changes: number; undone?: string }

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
    app.replaceChildren(h('p', { class: 'empty' }, 'Log in to a file first, then open Clean Up Data from its toolbar. ', h('a', { href: './' }, 'Log in')));
    return;
  }
  const auth = { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' };
  const base = `/tabularius/cleanup/v1/databases/${encodeURIComponent(s.db)}`;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(base + path, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error?.message ?? httpProblem(r.status));
    return json as T;
  };

  const layouts = h('select', { 'aria-label': 'Layout' }) as HTMLSelectElement;
  const checks = (['duplicates', 'valueLists', 'consistency', 'phones', 'emails'] as const).map((c) => {
    const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = true;
    return { c, input, el: h('label', { class: 'd-check' }, input, { duplicates: 'Duplicates', valueLists: 'Value lists', consistency: 'Written differently', phones: 'Phones', emails: 'Emails' }[c]) };
  });
  const scanBtn = button('Look for problems', () => void scan(), { class: 'primary' });
  const status = h('span', { class: 'g-status', 'aria-live': 'polite' });
  const results = h('div', {});
  const history = h('div', {});
  const header = h('header', { class: 'g-header' }, h('span', { class: 'g-title' }, 'Clean Up Data'), h('span', {}, s.db), layouts, ...checks.map((x) => x.el), scanBtn, h('span', { class: 'g-spacer' }), status);
  app.replaceChildren(h('div', { class: 'g-shell dash-shell' }, header, h('main', { class: 'dash-page' }, h('div', { class: 'cleanup-page' }, results, history))));
  document.title = `${s.db} · Clean Up Data`;

  try {
    const r = await fetch(`/fmi/data/vLatest/databases/${encodeURIComponent(s.db)}/layouts`, { headers: auth });
    const body = await r.json();
    const flat = (list: { name: string; isFolder?: boolean; folderLayoutNames?: unknown[] }[]): string[] =>
      list.flatMap((l) => (l.isFolder ? flat((l.folderLayoutNames ?? []) as typeof list) : [l.name]));
    const names = flat(body.response?.layouts ?? []);
    layouts.replaceChildren(...names.map((n) => h('option', { value: n }, n)));
    const last = (() => {
      try {
        return sessionStorage.getItem(`tabularius.layout.${s.db}`);
      } catch {
        return null;
      }
    })();
    if (last && names.includes(last)) layouts.value = last;
  } catch {
    status.textContent = 'Couldn\'t list the layouts';
  }

  async function scan(): Promise<void> {
    scanBtn.disabled = true;
    status.textContent = 'Looking…';
    try {
      const found = await call<CleanupScan>('POST', '/scan', { layout: layouts.value, checks: checks.filter((x) => x.input.checked).map((x) => x.c) });
      results.replaceChildren(cleanupCard(found, s!.db, s!.token));
      status.textContent = '';
    } catch (e) {
      status.textContent = (e as Error).message;
    }
    scanBtn.disabled = false;
  }

  async function showHistory(): Promise<void> {
    const { history: list } = await call<{ history: Batch[] }>('GET', '/history');
    if (!list.length) return void history.replaceChildren();
    history.replaceChildren(h('h3', {}, 'Applied'), ...list.map((b) => {
      const row = h('div', { class: 'cleanup-item' }, h('span', { class: 'ai-note' }, new Date(b.at).toLocaleString()),
        h('div', {}, `${b.summary} on ${b.layout}${b.account ? ` by ${b.account}` : ''}${b.undone ? ' (undone)' : ''} `));
      if (!b.undone) {
        row.lastElementChild!.append(button('Undo', () => void call<{ undone: number; skipped: string[] }>('POST', `/history/${b.id}/undo`).then((r) => {
          status.textContent = `Undone${r.skipped.length ? `; left alone because they changed since: ${r.skipped.join(', ')}` : ''}`;
          void showHistory();
        }, (e: Error) => (status.textContent = e.message))));
      }
      return row;
    }));
  }
  void showHistory();
}

void start();
