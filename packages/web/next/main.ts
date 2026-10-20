// The alternative client (/next/): a calm, data-first way to work in a hosted file. Instead of drawing the
// file's layouts, it shows each table as a collection (a list, and a record beside it) worked out from the
// layouts the account can open, and puts every command behind one bar (⌘K). It reads and writes through the
// same Data API and privileges as the classic client at /app/, and shares its sign-in.

import { Api, ApiError, listDatabases } from '../src/api.ts';
import type { DataRecord, LayoutMeta, ScriptsMenuEntry, SortSpec, Value } from '../src/types.ts';
import { h, icon, mod, MOD_LABEL, typing } from './dom.ts';
import { collections, listColumns, menuLayouts, pages, type Collection, type Column, type Page, type Related } from './model.ts';
import { answerPageCalls, tellPages, webViewer } from '../src/layout.ts';
import { editPage, newPage } from './pages.ts';
import { parse, requests, unparse, type Search } from './query.ts';
import { fileName, fromInputDate, initials, isImage, show, toInputDate } from './values.ts';
import { Palette, type Command } from './palette.ts';
import { assistantAvailable, Conversation, type FoundSet } from './ask.ts';
import type { FindRequest } from '../src/types.ts';

const SESSION = 'tabularius.session';
const PAGE = 60;
const app = document.getElementById('app')!;

function stored(key: string, area: 'session' | 'local' = 'session'): string | null {
  try { return (area === 'session' ? sessionStorage : localStorage).getItem(key); } catch { return null; }
}
function store(key: string, value: string | undefined, area: 'session' | 'local' = 'session'): void {
  try {
    const s = area === 'session' ? sessionStorage : localStorage;
    if (value === undefined) s.removeItem(key); else s.setItem(key, value);
  } catch { /* private window */ }
}

// ---------------------------------------------------------------------------------------------- sign in

async function boot(): Promise<void> {
  const saved = stored(SESSION);
  if (saved) {
    try {
      const { db, token } = JSON.parse(saved) as { db: string; token: string };
      const api = new Api(db, token);
      await api.menu();
      return void open(api);
    } catch {
      store(SESSION, undefined);
    }
  }
  signIn();
}

async function signIn(message?: string): Promise<void> {
  const files = await listDatabases().catch(() => [] as string[]);
  const last = stored('openhbam.db', 'local');
  const db = h('select', { name: 'db', 'aria-label': 'File' }, ...files.map((f) => h('option', { value: f, selected: f === last }, f)));
  const account = h('input', { name: 'account', autocomplete: 'username', required: true, value: stored('openhbam.account', 'local') ?? 'Admin', 'aria-label': 'Account name' });
  const password = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', 'aria-label': 'Password', placeholder: 'Password' });
  const error = h('p', { class: 'signin-error', role: 'alert' }, message ?? '');
  const go = h('button', { class: 'primary', type: 'submit' }, 'Open');
  const form = h('form', { class: 'signin', onsubmit: async (e: Event) => {
    e.preventDefault();
    go.disabled = true;
    error.textContent = '';
    try {
      const api = await Api.login(db.value, account.value, password.value);
      store('openhbam.db', db.value, 'local');
      store('openhbam.account', account.value, 'local');
      store(SESSION, JSON.stringify({ db: api.db, token: api.token }));
      open(api);
    } catch (err) {
      error.textContent = err instanceof ApiError && err.code === 212 ? 'That account name and password didn’t match.' : (err as Error).message;
      go.disabled = false;
      password.select();
    }
  } },
    h('h1', { class: 'wordmark' }, 'Tabularius'),
    h('p', { class: 'signin-lede' }, files.length ? 'Choose a file and sign in.' : 'No files are hosted here yet.'),
    files.length > 1 ? h('label', {}, h('span', {}, 'File'), db) : (db.hidden = true, db),
    files.length === 1 ? h('p', { class: 'signin-file' }, files[0]) : null,
    h('label', {}, h('span', {}, 'Account'), account),
    h('label', {}, h('span', {}, 'Password'), password),
    error,
    go,
  );
  app.replaceChildren(h('main', { class: 'signin-page' }, form));
  (account.value ? password : account).focus();
}

// ---------------------------------------------------------------------------------------------- the model

interface Model {
  file: string;
  account?: string;
  collections: Collection[];
  /** Modern layouts: pages written in HTML, CSS and JavaScript, shown as they are. */
  pages: Page[];
  scripts: { name: string; folder?: string }[];
}

/** Reads each layout the account can open (eight at a time), and groups them into collections. */
async function readModel(api: Api, progress: (done: number, of: number) => void): Promise<Model> {
  const menu = await api.menu();
  const layouts = menuLayouts(menu.layouts);
  const metas: { meta: LayoutMeta; hidden: boolean; placed?: string[] }[] = [];
  let done = 0;
  const queue = [...layouts];
  const work = async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      try {
        const [meta, placed] = await Promise.all([api.layout(l.name), placedFields(api, l.name)]);
        metas.push({ meta, hidden: l.hidden, placed });
      } catch { /* a layout this account can't open */ }
      progress(++done, layouts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, layouts.length) }, work));
  // Keep menu order, so ties go to the layout listed first.
  const order = new Map(layouts.map((l, i) => [l.name, i]));
  metas.sort((a, b) => order.get(a.meta.layout.name)! - order.get(b.meta.layout.name)!);
  const scripts: Model['scripts'] = [];
  const walk = (items: ScriptsMenuEntry[] | undefined, folder?: string) => {
    for (const s of items ?? []) {
      if ('items' in s) walk(s.items, s.name);
      else if ('id' in s) scripts.push({ name: s.name, folder });
    }
  };
  walk(menu.scripts);
  return { file: menu.database, account: menu.account, collections: collections(metas), pages: pages(metas), scripts };
}

/** The fields a layout really shows (the Data API returns only those). */
async function placedFields(api: Api, layout: string): Promise<string[] | undefined> {
  const r = await fetch(`/fmi/data/vLatest/databases/${encodeURIComponent(api.db)}/layouts/${encodeURIComponent(layout)}`, { headers: { authorization: `Bearer ${api.token}` } });
  if (!r.ok) return undefined;
  const body = await r.json();
  return (body.response?.fieldMetaData as { name: string }[] | undefined)?.map((f) => f.name);
}

// ---------------------------------------------------------------------------------------------- the workspace

/** A search and sort kept under a name, listed under its collection in the sidebar. Kept in this browser. */
interface SavedView {
  name: string;
  table: string;
  search: Search;
  sort?: SortSpec;
  found_by?: { query: FindRequest[]; label: string };
  board?: string;
}

interface View {
  collection: Collection;
  /** The saved view this list was opened from. */
  saved?: string;
  /** Shown as a board: one column per value of this field (a field with a value list), instead of a list. */
  board?: string;
  /** Rows picked for an action on several at once, by record id; `anchor` is the last one picked (for Shift). */
  selected?: Set<string>;
  anchor?: number;
  search: Search;
  sort?: SortSpec;
  records: DataRecord[];
  found: number;
  total: number;
  loading: boolean;
  /** Bumped on every new query, so a slow answer to an older one is dropped. */
  ticket: number;
  active: number;
  /** Records the assistant found, shown until a search or removing its chip replaces them. */
  found_by?: { query: FindRequest[]; label: string };
}

async function open(api: Api): Promise<void> {
  const bar = h('div', { class: 'boot-bar' }, h('span'));
  app.replaceChildren(h('main', { class: 'boot' }, h('p', { class: 'wordmark' }, 'Tabularius'), h('p', { class: 'boot-note' }, `Opening ${api.db}`), bar));
  let model: Model;
  try {
    model = await readModel(api, (d, n) => { (bar.firstElementChild as HTMLElement).style.width = `${Math.round((d / Math.max(1, n)) * 100)}%`; });
  } catch (e) {
    store(SESSION, undefined);
    return signIn((e as Error).message);
  }
  current?.stop();
  current = new Workspace(api, model);
  current.start();
}

let current: Workspace | undefined;

class Workspace {
  private view?: View;
  /** The page shown instead of a collection, when one is open. */
  private page?: Page;
  private record?: DataRecord;
  private readonly palette: Palette;
  private readonly root = h('div', { class: 'shell' });
  private readonly nav = h('nav', { class: 'rail', 'aria-label': 'Collections' });
  private readonly main = h('main', { class: 'stage' });
  private readonly sheet = h('aside', { class: 'sheet', 'aria-label': 'Record', hidden: true });
  private readonly toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  private toastTimer = 0;

  private readonly api: Api;
  private readonly model: Model;

  constructor(api: Api, model: Model) {
    this.api = api;
    this.model = model;
    this.palette = new Palette(() => this.commands(), (q) => this.askCommand(q));
    api.onExpired = () => { store(SESSION, undefined); signIn('Your session ended. Sign in again to carry on.'); };
  }

  private readonly onKey = (e: KeyboardEvent): void => this.key(e);
  private readonly onHash = (): void => this.route();

  /** Takes this workspace's window listeners off, when a new one replaces it (after the file's layouts change). */
  stop(): void {
    removeEventListener('keydown', this.onKey);
    removeEventListener('hashchange', this.onHash);
    this.conversation?.stop();
  }

  start(): void {
    this.root.append(this.nav, this.main, this.sheet, this.toast, this.palette.element);
    app.replaceChildren(this.root);
    document.documentElement.style.setProperty('--hue', String(hue(this.model.file)));
    this.loadViews();
    this.drawRail();
    addEventListener('keydown', this.onKey);
    addEventListener('hashchange', this.onHash);
    answerPageCalls((_id, method, args) => this.pageCall(method, args));
    this.route();
    void assistantAvailable(this.api.db, this.api.token).then((ok) => {
      if (ok) this.conversation = new Conversation(this.api.db, this.api.token, () => ({ layout: this.view?.collection.layout, recordId: this.record?.recordId }), (f) => this.showFound(f));
    });
  }

  // ---- asking the assistant

  private conversation?: Conversation;
  private asking = false;

  /** The command bar's "Ask" line for what was typed, when the assistant is on. */
  private askCommand(q: string): Command | undefined {
    if (!this.conversation || q.trim().length < 3) return undefined;
    return { group: 'Ask', label: `Ask: ${q.trim()}`, keys: '⇥', run: () => this.ask(q.trim()) };
  }

  private ask(question: string): void {
    const conv = this.conversation;
    if (!conv) return;
    this.asking = true;
    this.sheet.replaceChildren(
      h('div', { class: 'sheet-bar' },
        h('button', { class: 'ghost icon-only', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => this.closeAsk() }, icon('close')),
        h('span', { class: 'sheet-crumb' }, 'Ask about this file')),
      h('div', { class: 'sheet-body ask-body' }, conv.element));
    this.sheet.hidden = false;
    this.root.classList.add('sheet-open');
    conv.start(question);
  }

  private closeAsk(): void {
    this.asking = false;
    this.conversation?.stop();
    this.closeRecord(false);
  }

  /** Shows the records an answer found, in their collection, as one chip that says what they are. */
  private showFound(f: FoundSet): void {
    const c = this.model.collections.find((x) => x.layout === f.layout) ?? this.model.collections.find((x) => x.layouts.includes(f.layout));
    if (!c) return this.say('Those records are on a layout this view doesn’t list.', true);
    if (this.view?.collection !== c) {
      this.show(c);
      location.hash = `#/${encodeURIComponent(c.table)}`;
    }
    const v = this.view!;
    v.search = { words: '', filters: [] };
    if (this.searchInput) this.searchInput.value = '';
    v.found_by = { query: f.query, label: f.summary || `${f.foundCount.toLocaleString()} found` };
    // The assistant's find ran on its layout; the fields it named are the same on this table's layout when it is the same one.
    if (f.sort?.[0]) v.sort = { fieldName: f.sort[0].fieldName, sortOrder: f.sort[0].sortOrder ?? 'ascend' };
    this.drawChips();
    void this.query();
  }

  // ---- routing: #/<table>[/<recordId>]

  private route(): void {
    const [, table, rest] = location.hash.split('/').map((s) => decodeURIComponent(s));
    const page = table === '~' ? this.model.pages.find((p) => p.layout === rest) : undefined;
    // A page that isn't here (deleted, or just made and not read in yet) isn't a record of the first table.
    const id = table === '~' ? undefined : rest;
    if (page) return void (this.page !== page && this.showPage(page));
    this.page = undefined;
    const c = this.model.collections.find((x) => x.table === table) ?? this.model.collections.find((x) => !x.quiet) ?? this.model.collections[0];
    if (!c) return void this.main.replaceChildren(this.empty('Nothing to show', 'This account can’t open any layouts in this file, so there are no records to list.'));
    if (this.view?.collection !== c) this.show(c);
    if (id) void this.openRecord(id);
    else this.closeRecord(false);
  }

  private go(c: Collection, id?: string): void {
    const hash = `#/${encodeURIComponent(c.table)}${id ? `/${encodeURIComponent(id)}` : ''}`;
    if (location.hash !== hash) location.hash = hash;
    else this.route();
  }

  // ---- the rail

  private drawRail(): void {
    const item = (c: Collection) => [h('a', {
      href: `#/${encodeURIComponent(c.table)}`, class: 'rail-item', 'data-table': c.table,
      'aria-current': this.view?.collection === c && !this.view.saved ? 'page' : undefined,
      // From one of its saved views back to the whole collection (the address doesn't change).
      onclick: (e: Event) => { if (this.view?.collection === c && this.view.saved) { e.preventDefault(); this.closeRecord(false); this.show(c); } },
    }, c.label),
    ...this.views.filter((x) => x.table === c.table).map((x) => h('a', {
      href: `#/${encodeURIComponent(c.table)}`, class: 'rail-item rail-view', 'data-table': c.table, 'data-view': x.name,
      'aria-current': this.view?.collection === c && this.view.saved === x.name ? 'page' : undefined,
      onclick: (e: Event) => { e.preventDefault(); this.openView(x); },
    }, x.name))];
    const main = this.model.collections.filter((c) => !c.quiet);
    const quiet = this.model.collections.filter((c) => c.quiet);
    const pageItem = (p: Page) => h('a', {
      href: `#/~/${encodeURIComponent(p.layout)}`, class: 'rail-item rail-page', 'data-page': p.layout,
      'aria-current': this.page === p ? 'page' : undefined,
    }, p.layout);
    this.nav.replaceChildren(
      h('div', { class: 'rail-head' },
        h('span', { class: 'rail-file', title: this.model.file }, this.model.file),
        h('button', { class: 'ghost icon-only rail-close', 'aria-label': 'Close the sidebar', onclick: () => this.root.classList.remove('rail-open') }, icon('close'))),
      h('button', { class: 'rail-find', onclick: () => this.palette.open() }, icon('search', 14), h('span', {}, 'Go to or do…'), h('kbd', {}, `${MOD_LABEL}K`)),
      this.model.pages.length ? h('div', { class: 'rail-list rail-pages', role: 'group', 'aria-label': 'Pages' }, ...this.model.pages.map(pageItem)) : '',
      h('div', { class: 'rail-list' }, ...main.flatMap(item)),
      quiet.length ? h('details', { class: 'rail-more' }, h('summary', {}, 'More'), h('div', { class: 'rail-list' }, ...quiet.flatMap(item))) : '',
      h('div', { class: 'rail-foot' },
        h('span', { class: 'rail-account' }, this.model.account ?? ''),
        h('a', { href: '/app/', class: 'rail-classic' }, 'Classic view')),
    );
  }

  private markRail(): void {
    for (const a of this.nav.querySelectorAll<HTMLElement>('.rail-item')) {
      if (a.dataset.page !== undefined ? a.dataset.page === this.page?.layout : !this.page && a.dataset.table === this.view?.collection.table && a.dataset.view === this.view?.saved) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  // ---- saved views

  private views: SavedView[] = [];
  private get viewsKey(): string {
    return `tabularius.next.views:${this.api.db}:${this.model.account ?? ''}`;
  }

  private loadViews(): void {
    try {
      const got = JSON.parse(stored(this.viewsKey, 'local') ?? '[]');
      this.views = Array.isArray(got) ? got.filter((x) => x && typeof x.name === 'string' && typeof x.table === 'string' && x.search) : [];
    } catch {
      this.views = [];
    }
  }

  private keepViews(): void {
    store(this.viewsKey, this.views.length ? JSON.stringify(this.views) : undefined, 'local');
    this.drawRail();
  }

  /** Whether the list shows something other than everything in its natural order. */
  private narrowed(v: View): boolean {
    return !!(v.search.words || v.search.filters.length || v.sort || v.found_by || v.board);
  }

  private openView(x: SavedView): void {
    const c = this.model.collections.find((k) => k.table === x.table);
    if (!c) return;
    if (location.hash !== `#/${encodeURIComponent(c.table)}`) history.replaceState(null, '', `#/${encodeURIComponent(c.table)}`);
    this.closeRecord(false);
    this.show(c, structuredClone(x.search), { saved: x.name, sort: x.sort, found_by: x.found_by, board: x.board });
  }

  /** Asks for a name in place, in the sidebar where the view will be listed, and keeps the list as it is now. */
  private saveView(): void {
    const v = this.view;
    if (!v) return;
    // On a phone the sidebar is a drawer: open it for the name, and close it again after.
    const drawer = matchMedia('(max-width: 760px)').matches && !this.root.classList.contains('rail-open');
    if (drawer) this.root.classList.add('rail-open');
    const anchor = [...this.nav.querySelectorAll<HTMLElement>('.rail-item')].filter((a) => a.dataset.table === v.collection.table).pop();
    if (!anchor) return;
    this.nav.querySelector('.rail-name')?.remove();
    const suggestion = [...v.search.filters.map((f) => f.value), v.search.words].filter(Boolean).join(', ') || v.found_by?.label || (v.sort ? `By ${v.collection.columns.find((x) => x.name === v.sort!.fieldName)?.label.toLowerCase() ?? v.sort.fieldName}` : '');
    const input = h('input', { class: 'rail-name', 'aria-label': 'Name this view', placeholder: 'Name this view', value: suggestion.slice(0, 40) });
    anchor.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      input.remove();
      if (drawer) this.root.classList.remove('rail-open');
      if (!keep || !name) return;
      const x: SavedView = { name, table: v.collection.table, search: structuredClone(v.search), ...(v.sort ? { sort: v.sort } : {}), ...(v.found_by ? { found_by: v.found_by } : {}), ...(v.board ? { board: v.board } : {}) };
      this.views = [...this.views.filter((y) => !(y.table === x.table && y.name === name)), x];
      v.saved = name;
      this.keepViews();
      this.drawChips();
      this.say(`Saved “${name}” under ${v.collection.label}`);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  private deleteView(table: string, name: string): void {
    this.views = this.views.filter((y) => !(y.table === table && y.name === name));
    if (this.view?.saved === name && this.view.collection.table === table) this.view.saved = undefined;
    this.keepViews();
    this.drawChips();
  }

  // ---- a page (a modern layout)

  /** Shows a modern layout's page across the stage, its data calls answered as this account. */
  private showPage(p: Page): void {
    this.closeRecord(false);
    this.view = undefined;
    this.searchInput = undefined;
    this.page = p;
    this.root.classList.remove('rail-open');
    this.markRail();
    document.title = `${p.layout} · Tabularius`;
    const frame = h('div', { class: 'page-frame fm', 'data-id': String(p.viewer) });
    this.main.replaceChildren(
      h('header', { class: 'stage-head page-head' },
        h('button', { class: 'ghost icon-only rail-toggle', 'aria-label': 'Show collections', onclick: () => this.root.classList.add('rail-open') }, icon('menu')),
        h('div', { class: 'stage-title' }, h('h1', {}, p.layout)),
        h('button', { class: 'ghost', onclick: () => void this.editThisPage(), title: 'Edit this page’s HTML, CSS and JavaScript' }, icon('file', 14), h('span', {}, 'Edit page'))),
      frame,
    );
    void this.pageAddress(p).then((address) => {
      if (this.page !== p) return;
      if (address === undefined) return void frame.replaceChildren(this.empty('Nothing to show yet', 'This page’s address is worked out by a script or from a record, so it shows in the classic view.'));
      const viewer = webViewer(address, p.bridge);
      viewer.setAttribute('title', p.layout);
      frame.replaceChildren(viewer);
    });
  }

  /** Opens the open page's code beside a preview; saving shows the page again as it now is. */
  private async editThisPage(): Promise<void> {
    const p = this.page;
    if (!p) return;
    try {
      await editPage(this.api, p, () => void open(this.api));
    } catch (e) {
      this.say((e as Error).message, true);
    }
  }

  /** A new page on the open table, with a starter that lists its records; opens it to write. */
  private async newPageHere(): Promise<void> {
    const c = this.view?.collection ?? this.model.collections.find((x) => x.table === this.page?.table);
    if (!c) return;
    const taken = new Set(this.model.pages.map((x) => x.layout).concat(this.model.collections.flatMap((x) => x.layouts)));
    let name = `${c.label} page`;
    for (let n = 2; taken.has(name); n++) name = `${c.label} page ${n}`;
    try {
      await newPage(this.api, name, c.table, () => {
        location.hash = `#/~/${encodeURIComponent(name)}`;
        void open(this.api);
      });
    } catch (e) {
      this.say((e as Error).message, true);
    }
  }

  /** The web viewer's address, worked out by the server as FileMaker would (on the layout's first record, if any). */
  private async pageAddress(p: Page): Promise<string | undefined> {
    try {
      const first = (await this.api.records(p.layout, { offset: 1, limit: 1 }).catch(() => undefined))?.data[0];
      const body = { mode: 'browse', view: 'form', foundCount: first ? 1 : 0, totalCount: first ? 1 : 0 };
      const state = first
        ? (await this.api.view(p.layout, { ...body, records: [{ id: first.recordId, number: 1 }] })).records?.[first.recordId]
        : (await this.api.view(p.layout, body)).find;
      return state?.web?.[p.viewer] || undefined;
    } catch (e) {
      this.say((e as Error).message, true);
      return undefined;
    }
  }

  /**
   * A call from the page (window.tabularius, FileMaker.PerformScript): the same calls the classic client answers, each
   * as this account, so the server's privilege checks apply.
   */
  private async pageCall(method: string, args: unknown[]): Promise<unknown> {
    const text = (v: unknown, what: string): string => {
      if (typeof v !== 'string' || !v) throw new Error(`${what} is missing`);
      return v;
    };
    const fields = (v: unknown): Record<string, Value> => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Field data must be an object of field names and values');
      return v as Record<string, Value>;
    };
    const range = (o: unknown) => {
      const x = (o && typeof o === 'object' ? o : {}) as { offset?: unknown; limit?: unknown; sort?: unknown };
      return {
        offset: Math.max(1, Math.trunc(Number(x.offset) || 1)),
        limit: Math.min(1000, Math.max(1, Math.trunc(Number(x.limit) || 100))),
        ...(Array.isArray(x.sort) ? { sort: x.sort as SortSpec[] } : {}),
      };
    };
    switch (method) {
      case 'context': return { file: this.api.db, layout: this.page?.layout, mode: 'browse' };
      case 'records': return this.api.records(text(args[0], 'The layout'), range(args[1]));
      case 'find': {
        const query = Array.isArray(args[1]) ? args[1] : args[1] && typeof args[1] === 'object' ? [args[1]] : undefined;
        if (!query?.length) throw new Error('A find needs at least one request, such as {"Status": "Open"}');
        return this.api.records(text(args[0], 'The layout'), { ...range(args[2]), query: query as FindRequest[] });
      }
      case 'record': return this.api.record(text(args[0], 'The layout'), text(args[1], 'The record id'));
      case 'create': return { recordId: await this.api.create(text(args[0], 'The layout'), fields(args[1])) };
      case 'update': return { modId: await this.api.update(text(args[0], 'The layout'), text(args[1], 'The record id'), fields(args[2])) };
      case 'remove': await this.api.remove(text(args[0], 'The layout'), text(args[1], 'The record id')); return { deleted: true };
      case 'summarize': {
        if (!args[0] || typeof args[0] !== 'object') throw new Error('summarize takes a widget, such as {"kind": "number", "layout": "Invoices"}');
        return this.api.summarize(args[0] as Record<string, unknown>);
      }
      case 'performScript': await this.runScript(text(args[0], 'The script name'), String(args[1] ?? '')); return null;
    }
    throw new Error(`No such call: ${method}`);
  }

  // ---- a collection

  private show(c: Collection, search: Search = { words: '', filters: [] }, from: Pick<View, 'saved' | 'sort' | 'found_by' | 'board'> = {}): void {
    this.view = { collection: c, search, records: [], found: 0, total: 0, loading: true, ticket: 0, active: -1, ...from };
    this.root.classList.remove('rail-open');
    this.markRail();
    document.title = `${c.label} · Tabularius`;
    this.drawStage();
    void this.query();
  }

  private searchInput?: HTMLInputElement;

  private drawStage(): void {
    const v = this.view!;
    const c = v.collection;
    const input = h('input', {
      type: 'search', class: 'search', placeholder: `Search ${c.label.toLowerCase()}`, 'aria-label': `Search ${c.label}`,
      value: unparse({ words: v.search.words, filters: [] }), autocomplete: 'off', spellcheck: 'false',
    });
    let timer = 0;
    const apply = (): void => {
      timer = 0;
      const s = parse(input.value, c.columns);
      // A finished "field: value" becomes a chip; the words stay.
      if (s.filters.length) input.value = s.words;
      v.search = { words: s.words, filters: [...v.search.filters.filter((f) => !s.filters.some((n) => n.field === f.field)), ...s.filters] };
      v.found_by = undefined;
      this.drawChips();
      void this.query();
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 220);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      // Enter while the list is still catching up with the typing finishes the search (so a chip forms) rather
      // than opening a row from the list as it was a moment ago; Enter again opens the first row.
      if (e.key === 'Enter' && timer) { e.preventDefault(); clearTimeout(timer); apply(); return; }
      if (e.key === 'Enter' && v.active < 0 && v.records.length && !v.loading) { e.preventDefault(); this.go(c, v.records[0].recordId); }
      if (e.key === 'Backspace' && !input.value && v.search.filters.length) { v.search.filters.pop(); this.drawChips(); void this.query(); }
    });
    this.searchInput = input;
    this.main.replaceChildren(
      h('header', { class: 'stage-head' },
        h('button', { class: 'ghost icon-only rail-toggle', 'aria-label': 'Show collections', onclick: () => this.root.classList.add('rail-open') }, icon('menu')),
        h('div', { class: 'stage-title' },
          h('h1', {}, c.label),
          h('span', { class: 'count', 'aria-live': 'polite' })),
        this.shapeSwitch(),
        h('button', { class: 'ghost new', onclick: () => void this.newRecord(), title: 'New record (N)' }, icon('plus', 14), h('span', {}, 'New'))),
      h('div', { class: 'searchbar' }, icon('search', 15), input, h('div', { class: 'chips' })),
      h('div', { class: 'list', role: 'region', 'aria-label': `${c.label} list` }),
    );
    this.drawChips();
  }

  private drawChips(): void {
    const v = this.view!;
    const box = this.main.querySelector('.chips')!;
    const ai = v.found_by ? h('span', { class: 'chip chip-ai' }, icon('spark', 12), h('span', { class: 'chip-value' }, v.found_by.label),
      h('button', { class: 'chip-x', 'aria-label': 'Remove what the assistant found', onclick: () => {
        v.found_by = undefined;
        this.drawChips();
        void this.query();
      } }, icon('close', 12))) : '';
    // A list narrowed down can be kept by name; one opened from a saved view says which.
    const kept = v.saved && this.views.find((x) => x.table === v.collection.table && x.name === v.saved);
    const same = kept && JSON.stringify([kept.search, kept.sort, kept.found_by?.query, kept.board]) === JSON.stringify([v.search, v.sort, v.found_by?.query, v.board]);
    const save = this.narrowed(v) && !same
      ? h('button', { class: 'ghost save-view', onclick: () => kept ? this.updateView(kept) : this.saveView() }, kept ? `Update “${kept.name}”` : 'Save view')
      : '';
    box.replaceChildren(ai, ...v.search.filters.map((f, i) => h('span', { class: 'chip' },
      h('span', { class: 'chip-field' }, f.label), h('span', { class: 'chip-value' }, f.value),
      h('button', { class: 'chip-x', 'aria-label': `Remove ${f.label} filter`, onclick: () => {
        v.search.filters.splice(i, 1);
        this.drawChips();
        void this.query();
        this.searchInput?.focus();
      } }, icon('close', 12)))), save);
  }

  private updateView(x: SavedView): void {
    const v = this.view!;
    Object.assign(x, { search: structuredClone(v.search), sort: v.sort, found_by: v.found_by, board: v.board });
    this.keepViews();
    this.drawChips();
    this.say(`Updated “${x.name}”`);
  }

  private async query(more = false): Promise<void> {
    const v = this.view!;
    const ticket = more ? v.ticket : ++v.ticket;
    const c = v.collection;
    const searchable = c.columns.filter((x) => x.type === 'text' && !x.key);
    v.loading = true;
    this.drawCount();
    if (!more) this.drawChips();
    try {
      const r = await this.api.records(c.layout, {
        offset: more ? v.records.length + 1 : 1, limit: PAGE,
        query: v.found_by ? v.found_by.query : requests(v.search, searchable), sort: v.sort ? [v.sort] : undefined,
      });
      if (ticket !== v.ticket || this.view !== v) return;
      v.records = more ? [...v.records, ...r.data] : r.data;
      if (!more) { v.selected = undefined; v.anchor = undefined; }
      v.found = r.foundCount;
      if (r.totalCount >= 0) v.total = r.totalCount;
      if (!more) v.active = -1;
    } catch (e) {
      if (ticket !== v.ticket) return;
      this.say((e as Error).message, true);
      // Records the assistant found that can't be shown here: go back to the list as it was, not a stale one.
      if (v.found_by && !more) {
        v.found_by = undefined;
        v.loading = false;
        this.drawChips();
        return void this.query();
      }
    } finally {
      if (ticket === v.ticket) v.loading = false;
    }
    this.drawList();
  }

  private drawCount(): void {
    const v = this.view!;
    const el = this.main.querySelector('.count');
    if (!el) return;
    const narrowed = v.search.words || v.search.filters.length || v.found_by;
    el.textContent = v.loading && !v.records.length ? '' : narrowed ? `${v.found.toLocaleString()} of ${v.total.toLocaleString()}` : v.found.toLocaleString();
  }

  /** Fields a board can be grouped by: one value from a value list (not a set of checkboxes). */
  private boardFields(c: Collection): Column[] {
    return c.columns.filter((x) => x.choices && x.choices.display !== 'checkbox' && x.choices.values.length > 1 && x.choices.values.length <= 12 && !x.readOnly && !x.key);
  }

  /** List or Board, quietly beside the title, only when the collection has a field to group a board by. */
  private shapeSwitch(): HTMLElement | '' {
    const v = this.view!;
    const fields = this.boardFields(v.collection);
    if (!fields.length) return '';
    const pick = (board?: string) => () => { v.board = board; this.drawStage(); this.drawList(); };
    return h('div', { class: 'shape', role: 'group', 'aria-label': 'Show as' },
      h('button', { class: 'shape-item', 'aria-pressed': String(!v.board), onclick: pick(undefined) }, 'List'),
      h('button', { class: 'shape-item', 'aria-pressed': String(!!v.board), onclick: pick(v.board ?? fields[0].name), title: `Cards grouped by ${fields[0].label.toLowerCase()}` }, 'Board'));
  }

  /**
   * The board: one column per value of the grouping field, records as cards. Dragging a card to another column
   * changes its value; a click opens it. Values outside the list gather under Other.
   */
  private drawBoard(box: Element): void {
    const v = this.view!;
    const c = v.collection;
    const group = c.columns.find((x) => x.name === v.board);
    if (!group?.choices) { v.board = undefined; return this.drawList(); }
    const values = group.choices.values;
    const label = (x: string) => group.choices!.labels?.[values.indexOf(x)] ?? x;
    const titleCol = c.columns.find((x) => x.name === c.title);
    const extra = listColumns(c).filter((x) => x.name !== c.title && x.name !== group.name).slice(0, 2);
    const lanes = new Map<string, DataRecord[]>([['', []], ...values.map((x) => [x, []] as [string, DataRecord[]]), ['\u0000other', []]]);
    for (const r of v.records) {
      const val = String(r.fieldData[group.name] ?? '');
      (lanes.get(val) ?? lanes.get('\u0000other')!).push(r);
    }
    const card = (r: DataRecord) => {
      const el = h('a', {
        class: `card${this.record?.recordId === r.recordId ? ' open' : ''}`, href: `#/${encodeURIComponent(c.table)}/${encodeURIComponent(r.recordId)}`,
        draggable: 'true', 'data-id': r.recordId,
      },
        h('span', { class: 'card-title' }, (titleCol && show(r.fieldData[titleCol.name], titleCol)) || h('span', { class: 'untitled' }, 'Untitled')),
        ...extra.map((x) => { const t = show(r.fieldData[x.name], x); return t ? h('span', { class: 'card-line' }, h('span', { class: 'card-label' }, x.label), t) : ''; }));
      el.addEventListener('dragstart', (e) => { e.dataTransfer!.setData('text/x-tabularius-record', r.recordId); e.dataTransfer!.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      // From the keyboard: Shift and an arrow move the card to the next column, as dragging it there would.
      el.addEventListener('keydown', (e) => {
        if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const order = ['', ...values];
        const at = order.indexOf(String(r.fieldData[group.name] ?? ''));
        const to = order[at < 0 ? (e.key === 'ArrowRight' ? 1 : 0) : at + (e.key === 'ArrowRight' ? 1 : -1)];
        if (to !== undefined && (at < 0 || to !== order[at])) void this.moveCard(c, r, group, to).then(() => this.main.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(r.recordId)}"]`)?.focus());
      });
      el.title = `Drag to another column, or Shift ← → to move it`;
      return el;
    };
    const lane = (key: string, rows: DataRecord[]) => {
      const other = key === '\u0000other';
      const name = other ? 'Other' : key ? label(key) : `No ${group.label.toLowerCase()}`;
      const col = h('section', { class: 'lane', 'aria-label': name },
        h('h3', { class: 'lane-head' }, h('span', {}, name), h('span', { class: 'count' }, rows.length ? rows.length.toLocaleString() : '')),
        h('div', { class: 'lane-cards' }, ...rows.map(card)));
      if (!other) {
        col.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-tabularius-record')) { e.preventDefault(); col.classList.add('drop'); } });
        col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget as Node)) col.classList.remove('drop'); });
        col.addEventListener('drop', (e) => {
          e.preventDefault();
          col.classList.remove('drop');
          const id = e.dataTransfer!.getData('text/x-tabularius-record');
          const r = v.records.find((x) => x.recordId === id);
          if (r && String(r.fieldData[group.name] ?? '') !== key) void this.moveCard(c, r, group, key);
        });
      }
      return col;
    };
    // Empty "No value" and "Other" lanes stay out of the way.
    const shown = [...lanes].filter(([k, rows]) => rows.length || (k !== '' && k !== '\u0000other'));
    const more = v.records.length < v.found
      ? h('button', { class: 'ghost more-rows', onclick: (e: Event) => { (e.currentTarget as HTMLButtonElement).disabled = true; void this.query(true); } }, `Show more · ${(v.found - v.records.length).toLocaleString()} left`)
      : null;
    box.replaceChildren(h('div', { class: 'board', role: 'region', 'aria-label': `${c.label} by ${group.label.toLowerCase()}` }, ...shown.map(([k, rows]) => lane(k, rows))), more ?? '');
  }

  /** A card dropped in another column: the record takes that column's value. */
  private async moveCard(c: Collection, r: DataRecord, group: Column, value: string): Promise<void> {
    const before = r.fieldData[group.name];
    r.fieldData[group.name] = value;
    this.drawList();
    try {
      r.modId = await this.api.update(c.layout, r.recordId, { [group.name]: value }, { modId: r.modId });
      if (this.record?.recordId === r.recordId) void this.openRecord(r.recordId);
    } catch (e) {
      r.fieldData[group.name] = before;
      this.drawList();
      this.say(e instanceof ApiError && e.code === 306 ? 'Someone else changed this record meanwhile. Here is their version.' : (e as Error).message, true);
      void this.query();
    }
  }

  private drawList(): void {
    const v = this.view!;
    const c = v.collection;
    const box = this.main.querySelector('.list')!;
    this.drawCount();
    box.classList.toggle('as-board', !!v.board);
    if (v.board && v.records.length) return this.drawBoard(box);
    if (!v.records.length) {
      this.main.querySelector('.tray')?.remove();
      this.main.classList.remove('picking');
      const narrowed = v.search.words || v.search.filters.length || v.found_by;
      box.replaceChildren(narrowed
        ? this.empty('No matches', v.found_by ? 'None of these records match what the assistant looked for any more.' : 'Nothing here matches that. Try fewer words, or remove a filter.')
        : this.empty(`No ${c.label.toLowerCase()} yet`, 'Records you add will show up here.', h('button', { class: 'primary', onclick: () => void this.newRecord() }, 'Add the first one')));
      return;
    }
    const cols = listColumns(c);
    const sortIcon = (col: Column) => v.sort?.fieldName === col.name ? icon(v.sort.sortOrder === 'descend' ? 'down' : 'up', 12) : null;
    const head = h('div', { class: 'row head', role: 'row' },
      ...cols.map((col, i) => h('button', {
        class: `cell sort${v.sort?.fieldName === col.name ? ' sorted' : ''}${i === 0 ? ' lead' : ''}${col.type === 'number' ? ' num' : ''}`, role: 'columnheader',
        'aria-sort': v.sort?.fieldName === col.name ? (v.sort.sortOrder === 'descend' ? 'descending' : 'ascending') : undefined,
        onclick: () => {
          v.sort = v.sort?.fieldName !== col.name ? { fieldName: col.name, sortOrder: 'ascend' } : v.sort.sortOrder === 'ascend' ? { fieldName: col.name, sortOrder: 'descend' } : undefined;
          void this.query();
        },
      }, h('span', {}, col.label), sortIcon(col))));
    const rows = v.records.map((r, i) => this.row(c, cols, r, i));
    const more = v.records.length < v.found
      ? h('button', { class: 'ghost more-rows', onclick: (e: Event) => { (e.currentTarget as HTMLButtonElement).disabled = true; void this.query(true); } }, `Show more · ${(v.found - v.records.length).toLocaleString()} left`)
      : null;
    box.replaceChildren(h('div', { class: 'table', role: 'table', 'aria-label': c.label, style: `--rest:${cols.length - 1}` }, head, ...rows), more ?? '');
    this.main.classList.toggle('picking', !!v.selected);
    this.drawTray();
    if (more) new IntersectionObserver((entries, obs) => {
      if (entries.some((x) => x.isIntersecting)) { obs.disconnect(); more.click(); }
    }, { rootMargin: '400px' }).observe(more);
  }

  private row(c: Collection, cols: Column[], r: DataRecord, i: number): HTMLElement {
    const v = this.view!;
    const title = c.title ? show(r.fieldData[c.title]) : '';
    const pic = c.image && isImage(r.fieldData[c.image]) ? String(r.fieldData[c.image]) : undefined;
    const picked = !!v.selected?.has(r.recordId);
    const pick = h('button', {
      type: 'button', class: 'pick', role: 'checkbox', 'aria-checked': String(picked), 'aria-label': `Select ${title || 'this record'}`, tabindex: -1,
      onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); this.pick(i, (e as MouseEvent).shiftKey); },
    });
    const lead = (col: Column) => h('span', { class: 'lead-inner' }, pick,
      c.title === col.name && c.image ? h('span', { class: 'avatar', 'aria-hidden': 'true' }, pic ? h('img', { src: `${pic}&thumb=64`, alt: '', loading: 'lazy' }) : initials(title)) : null,
      h('span', { class: 'lead-text' }, show(r.fieldData[col.name], col) || h('span', { class: 'untitled' }, 'Untitled')));
    return h('a', {
      class: `row${v.active === i ? ' active' : ''}${this.record?.recordId === r.recordId ? ' open' : ''}${picked ? ' picked' : ''}`, role: 'row', href: `#/${encodeURIComponent(c.table)}/${encodeURIComponent(r.recordId)}`,
      // One tab stop for the whole list (the row the keyboard is on); arrows and J/K move within it.
      'data-id': r.recordId, tabindex: i === Math.max(0, v.active) ? 0 : -1,
      onfocus: () => { v.active = i; this.rove(); },
    }, ...cols.map((col, j) => h('span', { class: `cell${j === 0 ? ' lead' : ''}${col.type === 'number' ? ' num' : ''}`, role: 'cell' },
      j === 0 ? lead(col) : show(r.fieldData[col.name], col))));
  }

  private rove(): void {
    const at = Math.max(0, this.view?.active ?? 0);
    this.main.querySelectorAll<HTMLElement>('.row:not(.head)').forEach((r, i) => { r.tabIndex = i === at ? 0 : -1; });
  }

  private move(by: number): void {
    const v = this.view;
    if (!v?.records.length) return;
    v.active = Math.max(0, Math.min(v.records.length - 1, v.active + by));
    const rows = this.main.querySelectorAll<HTMLElement>('.row:not(.head)');
    rows.forEach((r, i) => r.classList.toggle('active', i === v.active));
    this.rove();
    rows[v.active]?.focus();
    rows[v.active]?.scrollIntoView({ block: 'nearest' });
  }

  // ---- several records at once

  /** Picks or unpicks row `i` (with Shift, every row from the last one picked); the tray shows what can be done. */
  private pick(i: number, range = false): void {
    const v = this.view;
    const r = v?.records[i];
    if (!v || !r) return;
    const sel = v.selected ?? new Set<string>();
    const on = !sel.has(r.recordId);
    const from = range && v.anchor !== undefined ? Math.min(v.anchor, i) : i;
    const to = range && v.anchor !== undefined ? Math.max(v.anchor, i) : i;
    for (let k = from; k <= to; k++) {
      const id = v.records[k].recordId;
      if (on) sel.add(id); else sel.delete(id);
    }
    v.selected = sel.size ? sel : undefined;
    v.anchor = i;
    this.markPicked();
  }

  private markPicked(): void {
    const v = this.view!;
    this.main.classList.toggle('picking', !!v.selected);
    for (const row of this.main.querySelectorAll<HTMLElement>('.row:not(.head)')) {
      const on = !!v.selected?.has(row.dataset.id!);
      row.classList.toggle('picked', on);
      row.querySelector('.pick')?.setAttribute('aria-checked', String(on));
    }
    this.drawTray();
  }

  private unpick(): void {
    const v = this.view;
    if (!v?.selected) return;
    v.selected = undefined;
    v.anchor = undefined;
    this.markPicked();
  }

  /** The bar that floats over the list while rows are picked: how many, and what can be done to all of them. */
  private drawTray(mode: 'actions' | 'set' | 'delete' = 'actions'): void {
    const v = this.view!;
    this.main.querySelector('.tray')?.remove();
    const n = v.selected?.size ?? 0;
    if (!n) return;
    const c = v.collection;
    const count = `${n.toLocaleString()} selected`;
    const tray = h('div', { class: 'tray', role: 'toolbar', 'aria-label': 'Selected records' });
    const close = h('button', { class: 'ghost icon-only', 'aria-label': 'Clear the selection', title: 'Clear (Esc)', onclick: () => this.unpick() }, icon('close'));
    if (mode === 'actions') {
      const every = v.records.length > n ? h('button', { class: 'ghost', onclick: () => { v.selected = new Set(v.records.map((r) => r.recordId)); this.markPicked(); } }, `Select all ${v.records.length.toLocaleString()} shown`) : null;
      const editable = c.columns.some((x) => !x.readOnly && !x.calculated && x.type !== 'container');
      tray.append(h('span', { class: 'tray-count' }, count), every ?? '',
        editable ? h('button', { class: 'ghost', onclick: () => this.drawTray('set') }, 'Set a field…') : '',
        h('button', { class: 'ghost danger', onclick: () => this.drawTray('delete') }, 'Delete…'), close);
    } else if (mode === 'delete') {
      tray.classList.add('confirming');
      tray.append(h('span', { class: 'tray-count' }, `Delete ${n === 1 ? 'this record' : `these ${n.toLocaleString()} records`}? This can’t be undone.`),
        h('button', { class: 'ghost', onclick: () => this.drawTray() }, 'Keep them'),
        h('button', { class: 'danger-solid', onclick: () => void this.applyToPicked('delete') }, 'Delete'));
    } else {
      const cols = c.columns.filter((x) => !x.readOnly && !x.calculated && x.type !== 'container');
      const field = h('select', { class: 'tray-field', 'aria-label': 'Field' }, ...cols.map((x) => h('option', { value: x.name }, x.label)));
      const valueBox = h('span', { class: 'tray-value' });
      let input: HTMLInputElement | HTMLSelectElement;
      const drawValue = () => {
        const col = cols.find((x) => x.name === field.value)!;
        input = col.choices && col.choices.display !== 'checkbox'
          ? h('select', { class: 'editor', 'aria-label': 'Value' }, h('option', { value: '' }, '—'), ...col.choices.values.map((x, i) => h('option', { value: x }, col.choices!.labels?.[i] ?? x)))
          : h('input', { class: 'editor', 'aria-label': 'Value', placeholder: 'New value (empty clears it)', type: col.type === 'date' ? 'date' : 'text' });
        input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); set(); } });
        valueBox.replaceChildren(input);
      };
      const set = () => {
        const col = cols.find((x) => x.name === field.value)!;
        void this.applyToPicked('set', { [col.name]: col.type === 'date' ? fromInputDate(input.value) : input.value });
      };
      field.addEventListener('change', drawValue);
      drawValue();
      tray.append(h('span', { class: 'tray-count' }, `Set for ${n.toLocaleString()}`), field, valueBox,
        h('button', { class: 'ghost', onclick: () => this.drawTray() }, 'Cancel'),
        h('button', { class: 'primary', onclick: set }, 'Set'));
      setTimeout(() => field.focus());
    }
    tray.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (mode === 'actions') this.unpick(); else this.drawTray(); } });
    this.main.append(tray);
    if (mode === 'delete') (tray.querySelector('.ghost') as HTMLElement).focus();
  }

  /** Changes or deletes every picked record, one at a time, then shows the list as the file now has it. */
  private async applyToPicked(what: 'set' | 'delete', fieldData: Record<string, string> = {}): Promise<void> {
    const v = this.view!;
    const c = v.collection;
    const ids = [...(v.selected ?? [])];
    const tray = this.main.querySelector<HTMLElement>('.tray');
    let done = 0;
    const failed: string[] = [];
    for (const id of ids) {
      if (tray) tray.replaceChildren(h('span', { class: 'tray-count' }, `${what === 'set' ? 'Changing' : 'Deleting'} ${(done + 1).toLocaleString()} of ${ids.length.toLocaleString()}…`));
      try {
        if (what === 'set') await this.api.update(c.layout, id, fieldData);
        else await this.api.remove(c.layout, id);
      } catch (e) {
        failed.push((e as Error).message);
      }
      done++;
    }
    if (what === 'delete' && this.record && ids.includes(this.record.recordId)) this.closeRecord();
    await this.query();
    if (this.record && what === 'set' && ids.includes(this.record.recordId)) void this.openRecord(this.record.recordId);
    const ok = ids.length - failed.length;
    const verb = what === 'set' ? 'Changed' : 'Deleted';
    this.say(failed.length ? `${verb} ${ok.toLocaleString()} of ${ids.length.toLocaleString()}. ${failed[0]}` : `${verb} ${ok.toLocaleString()} ${ok === 1 ? 'record' : 'records'}.`, failed.length > 0);
  }

  // ---- a record

  private async openRecord(id: string): Promise<void> {
    const c = this.view!.collection;
    try {
      const r = await this.api.record(c.layout, id);
      if (this.view?.collection !== c) return;
      this.record = r;
      this.asking = false;
      this.drawSheet(c, r);
      this.root.classList.add('sheet-open');
      for (const row of this.main.querySelectorAll<HTMLElement>('.row:not(.head)')) row.classList.toggle('open', row.dataset.id === id);
    } catch (e) {
      this.say(e instanceof ApiError && e.code === 101 ? 'That record is gone: someone may have deleted it.' : (e as Error).message, true);
      this.go(c);
    }
  }

  private closeRecord(navigate = true): void {
    this.record = undefined;
    // An answer stays open while the list moves on.
    if (this.asking && !navigate) {
      for (const row of this.main.querySelectorAll('.row.open')) row.classList.remove('open');
      return;
    }
    this.sheet.hidden = true;
    this.root.classList.remove('sheet-open');
    for (const row of this.main.querySelectorAll('.row.open')) row.classList.remove('open');
    if (navigate && this.view) this.go(this.view.collection);
  }

  private drawSheet(c: Collection, r: DataRecord): void {
    const title = c.title ? show(r.fieldData[c.title]) : '';
    // The picture field shows at the top, unless what it holds isn't a picture: then it's a file like any other.
    const pic = c.image && (!r.fieldData[c.image] || isImage(r.fieldData[c.image])) ? c.image : undefined;
    const fields = c.columns.filter((x) => x.name !== c.title && x.name !== pic && !x.key);
    const keys = c.columns.filter((x) => x.key);
    const saved = h('span', { class: 'saved', 'aria-live': 'polite' });
    const menu = this.recordMenu(c, r);
    this.sheet.replaceChildren(
      h('div', { class: 'sheet-bar' },
        h('button', { class: 'ghost icon-only', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => this.closeRecord() }, icon('close')),
        h('span', { class: 'sheet-crumb' }, c.label),
        saved,
        this.stepper(r),
        menu),
      h('div', { class: 'sheet-body' },
        h('header', { class: 'record-head' },
          pic ? this.fileField(c, r, c.columns.find((x) => x.name === pic)!, saved, true) : null,
          c.title ? this.editable(c, r, c.columns.find((x) => x.name === c.title)!, saved, 'record-title') : h('h2', { class: 'record-title' }, `Record ${r.recordId}`)),
        h('dl', { class: 'fields' }, ...fields.flatMap((col) => [h('dt', {}, col.label),
          h('dd', {}, col.type === 'container' ? this.fileField(c, r, col, saved) : this.editable(c, r, col, saved))])),
        ...c.related.map((rel) => {
          const rows = r.portalData?.[rel.name] ?? [];
          // A row opens as a record when its table is one of the collections.
          const target = rel.table ? this.model.collections.find((x) => x.table === rel.table && x.file === rel.file) : undefined;
          const add = rel.create && rel.columns.some((x) => !x.readOnly && !x.calculated);
          const section: HTMLElement = h('section', { class: 'related' },
            h('div', { class: 'related-head' },
              h('h3', {}, rel.label, h('span', { class: 'count' }, rows.length ? String(rows.length) : '')),
              add ? h('button', { class: 'ghost related-add', 'aria-label': `Add to ${rel.label.toLowerCase()}`, onclick: () => this.addRelatedRow(c, r, rel, section, saved) }, icon('plus', 14), h('span', {}, 'Add')) : null),
            rows.length
              ? h('div', { class: 'mini', style: `--cols:${Math.min(rel.columns.length, 4)}` }, ...rows.map((row) => h(target ? 'a' : 'div', {
                class: 'mini-row', ...(target ? { href: `#/${encodeURIComponent(target.table)}/${encodeURIComponent(row.recordId)}` } : {}),
              },
                ...rel.columns.slice(0, 4).map((col) => h('span', { class: `cell${col.type === 'number' ? ' num' : ''}` }, show(row[col.name], col))))))
              : h('p', { class: 'quiet-note' }, 'None yet.'));
          return section;
        }),
        keys.length ? h('details', { class: 'details' }, h('summary', {}, 'Details'),
          h('dl', { class: 'fields' }, ...keys.flatMap((col) => [h('dt', {}, col.label), h('dd', {}, this.editable(c, r, col, saved))]))) : null,
      ),
    );
    this.sheet.hidden = false;
  }

  /**
   * A new related row, typed in place under the list: one box per column it can fill. Enter saves it as a new
   * related record (its match fields filled from this record), Escape or leaving it empty drops it.
   */
  private addRelatedRow(c: Collection, r: DataRecord, rel: Related, section: HTMLElement, saved: HTMLElement): void {
    if (section.querySelector('.mini-new')) { section.querySelector<HTMLElement>('.mini-new input')?.focus(); return; }
    const cols = rel.columns.slice(0, 4);
    const inputs = cols.map((col) => col.readOnly || col.calculated ? null : h('input', {
      class: `editor mini-editor${col.type === 'number' ? ' num' : ''}`, 'aria-label': `New ${rel.label.toLowerCase()}: ${col.label}`, placeholder: col.label,
      type: col.type === 'date' ? 'date' : 'text', inputmode: col.type === 'number' ? 'decimal' : undefined,
    }));
    const row = h('div', { class: 'mini-new', style: `--cols:${cols.length}` }, ...inputs.map((i) => i ?? h('span', { class: 'cell' })));
    let done = false;
    const finish = async (keep: boolean) => {
      if (done) return;
      done = true;
      const data: Record<string, string> = {};
      cols.forEach((col, i) => { const v = inputs[i]?.value.trim(); if (v) data[col.name] = col.type === 'date' ? fromInputDate(v) : v; });
      if (!keep || !Object.keys(data).length) { row.remove(); return; }
      saved.textContent = 'Saving…';
      saved.className = 'saved';
      row.classList.add('busy');
      try {
        r.modId = (await this.api.addRelated(c.layout, r.recordId, rel.name, data)).modId;
        Object.assign(r, await this.api.record(c.layout, r.recordId));
        this.refreshRow(c, r);
        this.drawSheet(c, r);
        const now = this.sheet.querySelector<HTMLElement>('.saved')!;
        now.textContent = 'Saved';
        now.className = 'saved ok';
        setTimeout(() => { if (now.textContent === 'Saved') now.textContent = ''; }, 1600);
        [...this.sheet.querySelectorAll<HTMLElement>('.related-add')].find((b) => b.getAttribute('aria-label') === `Add to ${rel.label.toLowerCase()}`)?.focus();
      } catch (e) {
        saved.textContent = '';
        row.remove();
        this.say((e as Error).message, true);
      }
    };
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void finish(false); }
    });
    row.addEventListener('focusout', (e) => { if (!row.contains((e as FocusEvent).relatedTarget as Node)) void finish(true); });
    const list = section.querySelector('.mini');
    section.querySelector('.quiet-note')?.remove();
    if (list) list.after(row); else section.append(row);
    inputs.find(Boolean)?.focus();
  }

  /** The values of a value list of related values for one record (and their labels, if shown instead). */
  private async recordChoices(c: Collection, r: DataRecord, list: number): Promise<{ values: string[]; labels?: string[] } | undefined> {
    try {
      const state = (await this.api.view(c.layout, { mode: 'browse', view: 'form', foundCount: 1, totalCount: 1, records: [{ id: r.recordId, number: 1 }] })).records?.[r.recordId];
      const values = state?.valueLists?.[list];
      if (!values) return undefined;
      const labels = state?.valueListLabels?.[list];
      // "-" is a divider line, not a value.
      const keep = values.map((v, i) => [v, labels?.[i] ?? v] as const).filter(([v]) => v !== '-');
      return { values: keep.map(([v]) => v), labels: labels ? keep.map(([, l]) => l) : undefined };
    } catch {
      return undefined;
    }
  }

  /** "3 of 60" with previous and next, when the record is in the list. */
  private stepper(r: DataRecord): HTMLElement | null {
    const v = this.view;
    const i = v ? v.records.findIndex((x) => x.recordId === r.recordId) : -1;
    if (!v || i < 0) return null;
    return h('span', { class: 'stepper' },
      h('span', { class: 'stepper-at' }, `${(i + 1).toLocaleString()} of ${v.found.toLocaleString()}`),
      h('button', { class: 'ghost icon-only', 'aria-label': 'Previous record', title: 'Previous (K)', disabled: i === 0, onclick: () => this.step(-1) }, icon('up')),
      h('button', { class: 'ghost icon-only', 'aria-label': 'Next record', title: 'Next (J)', disabled: i >= v.found - 1, onclick: () => this.step(1) }, icon('down')));
  }

  private async step(by: number): Promise<void> {
    const v = this.view;
    if (!v || !this.record) return;
    const i = v.records.findIndex((x) => x.recordId === this.record!.recordId);
    if (i < 0) return;
    if (i + by >= v.records.length && v.records.length < v.found) await this.query(true);
    const next = v.records[i + by];
    if (next) {
      v.active = i + by;
      this.go(v.collection, next.recordId);
      this.main.querySelector(`.row[data-id="${CSS.escape(next.recordId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The record's few actions, behind one quiet button. */
  private recordMenu(c: Collection, r: DataRecord): HTMLElement {
    const list = h('div', { class: 'menu', role: 'menu', hidden: true });
    const button = h('button', { class: 'ghost icon-only', 'aria-label': 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
    const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    const item = (label: string, run: () => void, danger = false) => h('button', { role: 'menuitem', class: danger ? 'danger' : '', onclick: () => { close(); run(); } }, label);
    list.append(
      item('Duplicate', () => void this.duplicate(c, r)),
      item('Switch to classic view', () => { location.href = '/app/'; }),
      h('hr'),
      item('Delete…', () => this.confirmDelete(c, r), true),
    );
    button.addEventListener('click', () => {
      list.hidden = !list.hidden;
      button.setAttribute('aria-expanded', String(!list.hidden));
      if (!list.hidden) (list.querySelector('button') as HTMLElement).focus();
    });
    list.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll<HTMLElement>('button')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') { e.stopPropagation(); close(); button.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    });
    document.addEventListener('pointerdown', (e) => { if (!list.hidden && !list.parentElement?.contains(e.target as Node)) close(); });
    return h('div', { class: 'menu-wrap' }, button, list);
  }

  /** A value that turns into a field when clicked, and saves when you leave it. */
  /**
   * A container field: its picture or file, opened with a click. A file dropped on it, or picked with Replace
   * (or Add, when it's empty), goes into the field; Remove empties it. As the record's picture it is the square at
   * the top of the panel, and a click on that picks a new one.
   */
  private fileField(c: Collection, r: DataRecord, col: Column, saved: HTMLElement, picture = false): HTMLElement {
    const value = String(r.fieldData[col.name] ?? '');
    const readOnly = col.readOnly || !(col.name in r.fieldData);
    const name = fileName(value);
    const image = isImage(value);
    const picker = h('input', { type: 'file', hidden: true, accept: picture ? 'image/*' : undefined, tabindex: -1, 'aria-hidden': 'true' });
    const choose = () => picker.click();
    const put = async (run: () => Promise<void>, doing: string) => {
      saved.textContent = doing;
      saved.className = 'saved';
      wrap.classList.add('busy');
      try {
        await run();
        Object.assign(r, await this.api.record(c.layout, r.recordId));
        this.refreshRow(c, r);
        this.drawSheet(c, r);
        const now = this.sheet.querySelector<HTMLElement>('.saved')!;
        now.textContent = 'Saved';
        now.className = 'saved ok';
        setTimeout(() => { if (now.textContent === 'Saved') now.textContent = ''; }, 1600);
      } catch (e) {
        saved.textContent = '';
        wrap.classList.remove('busy');
        this.say((e as Error).message, true);
      }
    };
    const upload = (file: File | undefined) => { if (file) void put(() => this.api.upload(c.layout, r.recordId, col.name, 1, file), 'Uploading…'); };
    picker.addEventListener('change', () => upload(picker.files?.[0]));

    let wrap: HTMLElement;
    if (picture) {
      const img = value && image ? h('img', { class: 'record-pic', src: `${value}&thumb=256`, alt: '' }) : null;
      wrap = readOnly
        ? h('div', { class: 'pic-slot' }, img)
        : h('div', { class: 'pic-slot' }, h('button', {
          class: `pic-button${img ? '' : ' empty'}`, onclick: choose,
          'aria-label': img ? `Change ${col.label.toLowerCase()}` : `Add ${col.label.toLowerCase()}`, title: img ? 'Change picture, or drop one here' : 'Add a picture, or drop one here',
        }, img ?? icon('image', 22)), picker);
      if (readOnly && !img) return h('span');
    } else {
      const open = value ? h('a', { class: 'file-link', href: value, target: '_blank', rel: 'noopener' },
        image ? h('img', { class: 'file-thumb', src: `${value}&thumb=96`, alt: '' }) : icon('file', 15),
        h('span', { class: 'file-name' }, name)) : null;
      wrap = h('div', { class: `file-value${value ? '' : ' empty'}` },
        open ?? (readOnly ? h('span', { class: 'value readonly empty' }) : h('button', { type: 'button', class: 'file-add', onclick: choose }, 'Add a file')),
        !readOnly && value ? h('span', { class: 'file-actions' },
          h('button', { type: 'button', class: 'ghost', onclick: choose }, 'Replace'),
          h('button', { type: 'button', class: 'ghost', onclick: () => void put(() => this.api.clearContainer(c.layout, r.recordId, col.name, 1), 'Removing…') }, 'Remove')) : null,
        readOnly ? null : picker);
    }
    if (readOnly) return wrap;
    // Dropping a file on the field puts it there.
    wrap.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); wrap.classList.add('drop'); } });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('drop'); upload(e.dataTransfer?.files[0]); });
    return wrap;
  }

  private editable(c: Collection, r: DataRecord, col: Column, saved: HTMLElement, cls = ''): HTMLElement {
    const value = () => String(r.fieldData[col.name] ?? '');
    const readOnly = col.readOnly || !(col.name in r.fieldData);
    let choices = col.choices;
    const several = choices?.display === 'checkbox';
    const picked = () => value().split(/\r\n?|\n/).filter(Boolean);
    const label = (v: string) => (choices?.labels ? choices.labels[choices.values.indexOf(v)] ?? v : v);
    const display = () => {
      const text = several ? picked().map(label).join(', ') : choices?.labels ? label(value()) : show(r.fieldData[col.name], col);
      return h(cls === 'record-title' ? 'h2' : 'div', {
        class: `value${readOnly ? ' readonly' : ''}${text ? '' : ' empty'} ${cls}`.trim(),
        tabindex: readOnly ? undefined : 0, role: readOnly ? undefined : 'button',
        'aria-label': readOnly ? undefined : `${col.label}: ${text || 'empty'}. Edit`,
        title: readOnly ? (col.calculated ? 'Worked out from other fields' : undefined) : undefined,
      }, text || (cls === 'record-title' ? 'Untitled' : '—'));
    };
    const wrap = h('div', { class: 'editable' }, display());
    if (readOnly) return wrap;

    let saving = false;
    /** Saves a new value (when it changed), then shows the record as the file now has it. */
    const commit = async (next: string | undefined) => {
      if (next !== undefined && next !== value()) {
        saving = true;
        saved.textContent = 'Saving…';
        saved.className = 'saved';
        try {
          r.modId = await this.api.update(c.layout, r.recordId, { [col.name]: next }, { modId: r.modId });
          // Calculations and auto-enter may have changed other fields: read the record again.
          Object.assign(r, await this.api.record(c.layout, r.recordId));
          this.refreshRow(c, r);
          this.drawSheet(c, r);
          // The panel was drawn again: confirm on its new status line, and keep the place.
          const now = this.sheet.querySelector<HTMLElement>('.saved')!;
          now.textContent = 'Saved';
          now.className = 'saved ok';
          setTimeout(() => { if (now.textContent === 'Saved') now.textContent = ''; }, 1600);
          [...this.sheet.querySelectorAll<HTMLElement>('.value')].find((x) => x.getAttribute('aria-label')?.startsWith(`${col.label}:`))?.focus();
          return;
        } catch (e) {
          saved.textContent = '';
          this.say(e instanceof ApiError && e.code === 306 ? 'Someone else changed this record meanwhile. Here is their version.' : (e as Error).message, true);
          const fresh = await this.api.record(c.layout, r.recordId).catch(() => undefined);
          if (fresh) Object.assign(r, fresh);
        } finally {
          saving = false;
        }
      }
      wrap.replaceChildren(display());
      (wrap.firstElementChild as HTMLElement)?.focus();
    };

    // A value list of related values: this record's values are asked for as the field opens.
    const edit = () => {
      if (saving) return;
      if (choices?.perRecord === undefined) return open();
      void this.recordChoices(c, r, choices.perRecord).then((got) => {
        if (got) choices = { ...choices!, ...got };
        open();
      });
    };
    const open = () => {
      if (saving) return;
      // Several values: toggles, each saved as it's flipped; the panel closes when focus leaves it.
      if (several) {
        const on = new Set(picked());
        let done = false;
        const finish = (next: string | undefined) => { if (!done) { done = true; void commit(next); } };
        const group = h('div', { class: 'choices', role: 'group', 'aria-label': col.label },
          ...choices!.values.map((v) => h('button', {
            type: 'button', class: 'choice', 'aria-pressed': String(on.has(v)),
            onclick: (e: Event) => {
              const b = e.currentTarget as HTMLElement;
              if (on.has(v)) on.delete(v); else on.add(v);
              b.setAttribute('aria-pressed', String(on.has(v)));
            },
          }, label(v))),
          h('button', { type: 'button', class: 'ghost choices-done', onclick: () => finish(choices!.values.filter((v) => on.has(v)).join('\r')) }, 'Done'));
        group.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(undefined); } });
        group.addEventListener('focusout', (e) => {
          if (!group.contains((e as FocusEvent).relatedTarget as Node)) finish(choices!.values.filter((v) => on.has(v)).join('\r'));
        });
        wrap.replaceChildren(group);
        (group.querySelector('.choice') as HTMLElement | null)?.focus();
        return;
      }
      // One of a list: a menu, saved as soon as one is picked.
      if (choices && (choices.display === 'popup' || choices.display === 'radio')) {
        const current = value();
        const known = choices.values.includes(current);
        const select = h('select', { class: `editor ${cls}`.trim(), 'aria-label': col.label },
          h('option', { value: '' }, '—'),
          !known && current ? h('option', { value: current, selected: true }, current) : null,
          ...choices.values.map((v) => h('option', { value: v, selected: v === current }, label(v))));
        let done = false;
        const finish = (next: string | undefined) => { if (!done) { done = true; void commit(next); } };
        select.addEventListener('change', () => finish(select.value));
        select.addEventListener('blur', () => finish(undefined));
        select.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(undefined); } });
        wrap.replaceChildren(select);
        select.focus();
        return;
      }
      const long = col.type === 'text' && (value().length > 60 || /\n|\r/.test(value()));
      const input = long
        ? h('textarea', { rows: Math.min(10, value().split(/\r\n?|\n/).length + 1) })
        : h('input', { type: col.type === 'date' ? 'date' : 'text', inputmode: col.type === 'number' ? 'decimal' : undefined });
      input.className = `editor ${cls}`.trim();
      input.setAttribute('aria-label', col.label);
      input.value = col.type === 'date' ? toInputDate(value()) : value();
      // A drop-down list suggests its values but takes any typing.
      let list: HTMLDataListElement | undefined;
      if (choices && input instanceof HTMLInputElement) {
        list = h('datalist', { id: `choices-${Math.random().toString(36).slice(2)}` }, ...choices.values.map((v) => h('option', { value: v }, label(v))));
        input.setAttribute('list', list.id);
      }
      let done = false;
      const finish = (keep: boolean) => {
        if (done) return;
        done = true;
        void commit(keep ? (col.type === 'date' ? fromInputDate(input.value) : input.value) : undefined);
      };
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (e) => {
        const k = e as KeyboardEvent;
        if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); finish(false); }
        if (k.key === 'Enter' && (!long || mod(k))) { k.preventDefault(); finish(true); }
      });
      wrap.replaceChildren(input, list ?? '');
      input.focus();
      if (input instanceof HTMLInputElement && input.type === 'text') input.select();
    };
    wrap.addEventListener('click', (e) => { if ((e.target as HTMLElement).classList.contains('value')) edit(); });
    wrap.addEventListener('keydown', (e) => { if ((e.target as HTMLElement).classList.contains('value') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); edit(); } });
    return wrap;
  }

  private refreshRow(c: Collection, r: DataRecord): void {
    const v = this.view;
    if (!v || v.collection !== c) return;
    const i = v.records.findIndex((x) => x.recordId === r.recordId);
    if (i < 0) return;
    v.records[i] = { ...r };
    const old = this.main.querySelector(`.row[data-id="${CSS.escape(r.recordId)}"]`);
    old?.replaceWith(this.row(c, listColumns(c), v.records[i], i));
  }

  private async newRecord(): Promise<void> {
    const c = this.view?.collection;
    if (!c) return;
    try {
      const id = await this.api.create(c.layout);
      await this.query();
      this.go(c, id);
      // Start on the title, as a new note would.
      setTimeout(() => (this.sheet.querySelector('.record-head .value') as HTMLElement | null)?.click(), 60);
    } catch (e) {
      this.say((e as Error).message, true);
    }
  }

  private async duplicate(c: Collection, r: DataRecord): Promise<void> {
    try {
      const res = await fetch(`/fmi/data/vLatest/databases/${encodeURIComponent(this.api.db)}/layouts/${encodeURIComponent(c.layout)}/records/${encodeURIComponent(r.recordId)}`, {
        method: 'POST', headers: { authorization: `Bearer ${this.api.token}`, 'content-type': 'application/json' }, body: '{}',
      });
      const body = await res.json();
      const msg = body.messages?.[0];
      if (!res.ok || msg?.code !== '0') throw new Error(msg?.message ?? 'Couldn’t duplicate it');
      await this.query();
      this.go(c, body.response.recordId);
      this.say('Duplicated.');
    } catch (e) {
      this.say((e as Error).message, true);
    }
  }

  private confirmDelete(c: Collection, r: DataRecord): void {
    const title = (c.title && show(r.fieldData[c.title])) || 'this record';
    const bar = h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Delete record' },
      h('p', {}, `Delete ${title}? This can’t be undone.`),
      h('div', { class: 'confirm-actions' },
        h('button', { class: 'ghost', onclick: () => bar.remove() }, 'Keep it'),
        h('button', { class: 'danger-solid', onclick: async () => {
          try {
            await this.api.remove(c.layout, r.recordId);
            bar.remove();
            this.closeRecord();
            await this.query();
            this.say('Deleted.');
          } catch (e) {
            this.say((e as Error).message, true);
          }
        } }, 'Delete')));
    this.sheet.querySelector('.sheet-body')!.prepend(bar);
    (bar.querySelector('.ghost') as HTMLElement).focus();
  }

  // ---- commands

  private commands(): Command[] {
    const v = this.view;
    const out: Command[] = [];
    for (const p of this.model.pages) out.push({ group: 'Go to', label: p.layout, hint: 'Page', run: () => { location.hash = `#/~/${encodeURIComponent(p.layout)}`; } });
    for (const c of this.model.collections) out.push({ group: 'Go to', label: c.label, hint: c.quiet ? 'More' : undefined, run: () => this.go(c) });
    for (const x of this.views) out.push({ group: 'Go to', label: x.name, hint: this.model.collections.find((c) => c.table === x.table)?.label, run: () => this.openView(x) });
    if (v) {
      const c = v.collection;
      out.push({ group: 'Actions', label: `New ${singular(c.label)}`, keys: 'N', run: () => void this.newRecord() });
      for (const col of listColumns(c, 8)) {
        out.push({ group: 'Sort', label: `Sort by ${col.label.toLowerCase()}`, run: () => { v.sort = { fieldName: col.name, sortOrder: 'ascend' }; void this.query(); } });
      }
      if (v.sort) out.push({ group: 'Sort', label: 'Clear sort', run: () => { v.sort = undefined; void this.query(); } });
      if (v.search.words || v.search.filters.length) out.push({ group: 'Actions', label: 'Show everything', run: () => this.show(c) });
      out.push({ group: 'Actions', label: 'Search…', keys: '/', run: () => this.searchInput?.focus() });
      if (this.narrowed(v)) out.push({ group: 'Actions', label: 'Save this view…', run: () => this.saveView() });
      for (const f of this.boardFields(c)) if (v.board !== f.name) out.push({ group: 'Show as', label: `Board by ${f.label.toLowerCase()}`, run: () => { v.board = f.name; this.drawStage(); this.drawList(); } });
      if (v.board) out.push({ group: 'Show as', label: 'List', run: () => { v.board = undefined; this.drawStage(); this.drawList(); } });
      if (v.records.length) out.push({ group: 'Actions', label: 'Select all shown', keys: 'X', run: () => { v.selected = new Set(v.records.map((r) => r.recordId)); this.markPicked(); } });
      if (v.saved) { const name = v.saved; out.push({ group: 'Actions', label: `Delete view “${name}”`, run: () => this.deleteView(c.table, name) }); }
    }
    for (const s of this.model.scripts) out.push({ group: 'Run', label: s.name, hint: s.folder, run: () => void this.runScript(s.name) });
    if (this.page) out.push({ group: 'Actions', label: 'Edit this page…', run: () => void this.editThisPage() });
    if (v || this.page) out.push({ group: 'Actions', label: 'New page…', hint: 'HTML, CSS and JavaScript', run: () => void this.newPageHere() });
    out.push({ group: 'Account', label: 'Switch to classic view', run: () => { location.href = '/app/'; } });
    out.push({ group: 'Account', label: 'Switch file', run: () => this.signOut() });
    out.push({ group: 'Account', label: 'Sign out', run: () => this.signOut() });
    return out;
  }

  private async runScript(name: string, parameter?: string): Promise<void> {
    const layout = this.page?.layout ?? this.view?.collection.layout;
    if (!layout) return;
    this.say(`Running ${name}…`);
    try {
      const param = parameter ? `?script.param=${encodeURIComponent(parameter)}` : '';
      const r = await fetch(`/fmi/data/vLatest/databases/${encodeURIComponent(this.api.db)}/layouts/${encodeURIComponent(layout)}/script/${encodeURIComponent(name)}${param}`, { headers: { authorization: `Bearer ${this.api.token}` } });
      const body = await r.json();
      const msg = body.messages?.[0];
      if (!r.ok || msg?.code !== '0') throw new Error(msg?.message ?? 'The script couldn’t run');
      const err = body.response?.scriptError;
      const result = body.response?.scriptResult;
      this.say(err && err !== '0' ? `${name} stopped with error ${err}.` : result ? `${name}: ${result}` : `${name} finished.`, !!err && err !== '0');
      if (this.page) return void tellPages(this.main, 'refresh', {});
      await this.query();
      if (this.record) void this.openRecord(this.record.recordId);
    } catch (e) {
      this.say((e as Error).message, true);
    }
  }

  private async signOut(): Promise<void> {
    await this.api.logout();
    store(SESSION, undefined);
    location.hash = '';
    signIn();
  }

  // ---- keys

  private key(e: KeyboardEvent): void {
    if (mod(e) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.palette.toggle(); return; }
    if (this.palette.isOpen) return;
    if (e.key === 'Escape') {
      if (this.root.classList.contains('rail-open')) return void this.root.classList.remove('rail-open');
      if (this.asking && !this.palette.isOpen) { e.preventDefault(); return void this.closeAsk(); }
      if (this.record && !typing(e)) return void this.closeRecord();
      if (this.view?.selected && !typing(e)) return void this.unpick();
      if (typing(e) && e.target === this.searchInput && this.searchInput.value) return;
    }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); this.searchInput?.focus(); }
    else if (e.key === 'n') { e.preventDefault(); void this.newRecord(); }
    else if (e.key.toLowerCase() === 'x' && this.view && this.view.active >= 0) { e.preventDefault(); this.pick(this.view.active, e.shiftKey); }
    else if (e.key === 'j' || e.key === 'k') { e.preventDefault(); const by = e.key === 'j' ? 1 : -1; if (this.record) void this.step(by); else this.move(by); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!this.sheet.contains(e.target as Node)) { e.preventDefault(); this.move(e.key === 'ArrowDown' ? 1 : -1); } }
  }

  // ---- bits

  private empty(title: string, text: string, action?: HTMLElement): HTMLElement {
    return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), h('p', {}, text), action ?? null);
  }

  /** A short message at the bottom of the window; errors stay until the next one. */
  private say(text: string, error = false): void {
    clearTimeout(this.toastTimer);
    this.toast.textContent = text;
    this.toast.className = `toast show${error ? ' error' : ''}`;
    this.toastTimer = setTimeout(() => { this.toast.className = 'toast'; }, error ? 6000 : 2600);
  }
}

/**
 * A file's own hue, from its name: the same file always gets the same colour. Picked from hues that stay clear
 * at both lightnesses the theme uses (yellows and olives go muddy), so every file's accent reads as a colour.
 */
const HUES = [212, 250, 280, 318, 352, 18, 160, 186, 232, 140];
export function hue(name: string): number {
  let x = 2166136261;
  for (const ch of name.toLowerCase()) x = Math.imul(x ^ ch.codePointAt(0)!, 16777619);
  return HUES[(x >>> 0) % HUES.length];
}

function singular(label: string): string {
  const l = label.toLowerCase();
  return l.endsWith('ies') ? l.slice(0, -3) + 'y' : l.endsWith('ses') ? l.slice(0, -2) : l.endsWith('s') && !l.endsWith('ss') ? l.slice(0, -1) : l;
}

void boot();

export type { Value };
