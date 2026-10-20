// Data Viewer, like FileMaker Pro's, without running a script: watch formulas
// and see the current record's fields and the session's $$variables. It
// follows the web client window it was opened from (the record it shows,
// found count, mode) and re-evaluates whenever that window changes. Needs a
// full-access account. While a script is paused in the Script Debugger, it
// follows the script instead: watches evaluate in the script's context, and
// the Current tab shows its record, local and global variables. The watch list
// is the same one the Script Debugger shows.

import { h, button } from '../design/dom.ts';
import { AssistantPanel, assistantInfo } from '../assistant.ts';
import { httpProblem } from '../http-problem.ts';

/** What the web client window shows, as it announces it. */
interface WindowInfo { layout?: string; recordId?: number; mode?: string; view?: string; foundCount?: number; totalCount?: number; number?: number }
interface Result { value: string; type?: string; error?: number; message?: string }
/** A paused Script Debugger run, as GET /runs shows it. */
interface Paused { id: string; script: string; index: number; line: string; layout?: string; recordId?: number; foundCount: number; mode: string; variables: { locals: Record<string, string>; globals: Record<string, string> } }
interface RunView { id: string; paused?: Omit<Paused, 'id'> }
interface Current { layout: string; occurrence: string; table: string; recordId?: number; fields: Record<string, string | number>; variables: Record<string, string> }

class ViewerError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const app = document.getElementById('app')!;

function session(): { db: string; token: string } | undefined {
  try {
    const saved = sessionStorage.getItem('tabularius.session');
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private windows: watches last only this page
  }
}

async function start(): Promise<void> {
  const s = session();
  if (!s) {
    app.replaceChildren(h('p', { class: 'empty' }, 'Log in to a file first, then open the Data Viewer from its toolbar. ', h('a', { href: './' }, 'Log in')));
    return;
  }
  const base = `/tabularius/debug/v1/databases/${encodeURIComponent(s.db)}`;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new ViewerError(json.error?.code ?? r.status, json.error?.message ?? httpProblem(r.status));
    return json as T;
  };

  const watchKey = `tabularius.dataviewer.watch.${s.db}`;
  let watches: string[] = load(watchKey, []);
  let tab: 'watch' | 'current' = load(`${watchKey}.tab`, 'watch');
  // Until the window answers: the layout it last showed, on no record.
  let win: WindowInfo = (() => {
    try {
      const layout = sessionStorage.getItem(`tabularius.layout.${s.db}`);
      return layout ? { layout } : {};
    } catch {
      return {};
    }
  })();
  let editing: number | undefined;
  /** The Script Debugger's paused run, which the viewer follows while it waits. */
  let paused: Paused | undefined;
  const follow = (r?: RunView) => {
    paused = r?.paused ? { ...r.paused, id: r.id } : undefined;
  };

  const where = h('span', { class: 'g-status' });
  const tabs = h('div', { class: 'g-tabs', role: 'tablist' });
  const body = h('main', { class: 'g-side g-viewer' });
  const refresh = button('Refresh', () => void render(), { title: 'Evaluate again' });
  const header = h('header', { class: 'g-header' }, h('h1', { class: 'g-title' }, 'Data Viewer'), h('span', {}, s.db), h('span', { class: 'g-spacer' }), refresh);
  const shell = h('div', { class: 'g-shell g-viewer-shell' },
    header,
    h('div', { class: 'g-controls' }, tabs, h('span', { class: 'g-spacer' }), where),
    body,
  );
  app.replaceChildren(shell);
  document.title = `${s.db} · Data Viewer`;

  // --- expression editor (Edit Expression) -------------------------------------
  const editor = h('textarea', { rows: '3', placeholder: 'Formula, e.g. Get ( FoundCount ) or Customers::Name', 'aria-label': 'Expression', spellcheck: 'false' });
  const result = h('div', { class: 'g-mono g-result', 'aria-live': 'polite' });
  const evaluateBtn = button('Evaluate', () => void evaluateNow(), { title: 'Evaluate on the current record (⌘↩)' });
  const addBtn = button('Add to Watch', () => addWatch(), { class: 'primary' });
  const cancelBtn = button('Cancel', () => stopEditing(), { hidden: '' });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void evaluateNow();
    }
  });
  // The AI assistant, when the server has it: drafts an expression from words, or explains one, on the record the window shows.
  const aiRow = h('div', { class: 'g-row g-ai-row', hidden: '' });
  const editorBox = h('section', { class: 'g-watch g-editor' }, h('h3', {}, 'Expression'), editor, h('div', { class: 'g-row' }, evaluateBtn, addBtn, cancelBtn), result, aiRow);
  void assistantInfo(s.db, s.token).then((info) => {
    if (!info.available) return;
    const panel = new AssistantPanel(s.db, s.token, () => ({ mode: 'viewer', layout: win.layout, recordId: win.recordId }));
    header.insertBefore(button('Ask AI', () => panel.toggle(), { class: 'g-ai' }), refresh);
    shell.classList.add('with-ai');
    shell.append(panel.element);
    const want = h('input', { class: 'g-ai-want', placeholder: 'What should the expression work out?', 'aria-label': 'What to draft' }) as HTMLInputElement;
    const draft = () => void panel.askAbout(`Draft a Data Viewer expression${want.value.trim() ? `: ${want.value.trim()}` : ''}` +
      (editor.value.trim() ? `. The box now has ${editor.value.trim().slice(0, 300)}` : '') + '.', {
      target: { kind: 'calculation', for: 'Data Viewer expression' },
      use: (text) => {
        editor.value = text;
        editor.focus();
        void evaluateNow();
      },
    });
    want.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        draft();
      }
    });
    const explain = button('Explain with AI', () => {
      const formula = editor.value.trim();
      if (formula) void panel.askAbout(`Explain the expression ${formula.slice(0, 2000)}: what it works out, and why it gives ${result.textContent?.replace(/^Result: /, '') || 'its result'} on this record.`);
    }, { title: 'Ask the assistant what this expression does on this record' });
    aiRow.replaceChildren(want, button('Draft with AI', draft, { title: 'The assistant writes it and checks it; Use puts it in the box' }), explain);
    aiRow.hidden = false;
  });

  function stopEditing(): void {
    editing = undefined;
    editor.value = '';
    result.replaceChildren();
    addBtn.textContent = 'Add to Watch';
    cancelBtn.hidden = true;
  }

  function addWatch(): void {
    const formula = editor.value.trim();
    if (!formula) return;
    watches = editing === undefined ? [...watches, formula] : watches.map((w, i) => (i === editing ? formula : w));
    save(watchKey, watches);
    stopEditing();
    void render();
  }

  async function evaluate(formulas: string[]): Promise<Result[]> {
    if (paused) {
      const id = paused.id;
      try {
        return await Promise.all(formulas.map((formula) => call<Result>('POST', `/runs/${id}/evaluate`, { formula })));
      } catch (e) {
        // The script went on or ended: back to the web client's window.
        if (!(e instanceof ViewerError) || (e.code !== 3 && e.code !== 101)) {
          return formulas.map(() => ({ value: '', error: e instanceof ViewerError ? e.code : -1, message: (e as Error).message }));
        }
        if (paused?.id === id) paused = undefined;
      }
    }
    if (!win.layout) return formulas.map(() => ({ value: '', error: -1, message: 'Open a layout in the web client first' }));
    try {
      return (await call<{ results: Result[] }>('POST', '/evaluate', { formulas, layout: win.layout, recordId: win.recordId, window: win })).results;
    } catch (e) {
      return formulas.map(() => ({ value: '', error: e instanceof ViewerError ? e.code : -1, message: (e as Error).message }));
    }
  }

  function shown(r: Result): Node {
    if (r.error) return h('span', { class: 'g-err' }, `${r.value && r.value !== '?' ? `${r.value} ` : ''}Error ${r.error}${r.message ? `: ${r.message}` : ''}`);
    return r.value === '' ? h('span', { class: 'g-none' }, 'empty') : document.createTextNode(r.value);
  }

  async function evaluateNow(): Promise<void> {
    const formula = editor.value.trim();
    if (!formula) return;
    const [r] = await evaluate([formula]);
    result.replaceChildren(h('span', { class: 'g-label' }, 'Result: '), shown(r));
  }

  function table(rows: [string | Node, Node | string, Node?][]): HTMLElement {
    return h('table', {}, h('tbody', {}, ...rows.map(([k, v, x]) => h('tr', {}, h('td', { class: 'g-mono' }, k), h('td', { class: 'g-mono' }, v), ...(x ? [h('td', { class: 'g-act' }, x)] : [])))));
  }

  // --- tabs ------------------------------------------------------------------
  function drawTabs(): void {
    tabs.replaceChildren(...(['watch', 'current'] as const).map((t) => {
      const b = button(t === 'watch' ? 'Watch' : 'Current', () => {
        tab = t;
        save(`${watchKey}.tab`, tab);
        void render();
      }, { role: 'tab', 'aria-selected': String(tab === t), class: tab === t ? 'on' : '' });
      return b;
    }));
  }

  let rendering = 0;
  async function render(): Promise<void> {
    const n = ++rendering;
    drawTabs();
    where.textContent = paused ? `Script “${paused.script}” paused at step ${paused.index + 1}${paused.layout ? ` · ${paused.layout}` : ''}${paused.recordId !== undefined ? ` · record ID ${paused.recordId} of ${paused.foundCount} found` : ' · no record'}`
      : !win.layout ? 'Not following a window'
      : `${win.layout}${win.mode === 'find' ? ' · Find mode' : win.recordId !== undefined ? ` · record ${win.number ?? '?'} of ${win.foundCount ?? '?'} (ID ${win.recordId})` : ' · no record'}`;
    let parts: HTMLElement[];
    if (tab === 'watch') {
      const results = await evaluate(watches);
      parts = [h('section', { class: 'g-watch' }, h('h3', {}, 'Watch'), watches.length
        ? table(watches.map((formula, i) => {
          const edit = button('Edit', () => {
            editing = i;
            editor.value = formula;
            addBtn.textContent = 'Update';
            cancelBtn.hidden = false;
            editor.focus();
            void evaluateNow();
          }, { class: 'g-x', title: 'Edit this expression' });
          const remove = button('×', () => {
            watches = watches.filter((_, j) => j !== i);
            save(watchKey, watches);
            if (editing === i) stopEditing();
            void render();
          }, { class: 'g-x', title: 'Stop watching', 'aria-label': `Stop watching ${formula}` });
          return [formula, shown(results[i]), h('span', {}, edit, remove)];
        }))
        : h('p', { class: 'g-none' }, 'Add an expression below to see its value on each record.')), editorBox];
    } else {
      let current: Current | undefined;
      let failure = '';
      const at = paused ? { layout: paused.layout, recordId: paused.mode === 'find' ? undefined : paused.recordId } : win;
      if (at.layout) {
        try {
          const q = new URLSearchParams({ layout: at.layout, ...(at.recordId !== undefined ? { recordId: String(at.recordId) } : {}) });
          current = await call<Current>('GET', `/current?${q}`);
        } catch (e) {
          failure = (e as Error).message;
        }
      }
      const fieldRows = Object.entries(current?.fields ?? {}).map(([k, v]): [string, Node | string] => [`${current!.occurrence}::${k}`, v === '' ? h('span', { class: 'g-none' }, 'empty') : String(v)]);
      const listed = (vars: Record<string, string>) => Object.entries(vars).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]): [string, Node | string] => [k, v === '' ? h('span', { class: 'g-none' }, 'empty') : v]);
      const varRows = paused ? listed(paused.variables.globals) : Object.entries(current?.variables ?? {}).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]): [string, Node | string] => [k, v === '' ? h('span', { class: 'g-none' }, 'empty') : v]);
      parts = [
        h('section', {}, h('h3', {}, 'Fields'), failure ? h('p', { class: 'g-err' }, failure)
          : fieldRows.length ? table(fieldRows) : h('p', { class: 'g-none' }, at.layout ? 'No record is showing.' : 'Open a layout in the web client first.')),
        ...(paused ? [h('section', {}, h('h3', {}, `Local variables of “${paused.script}”`), Object.keys(paused.variables.locals).length
          ? table(listed(paused.variables.locals)) : h('p', { class: 'g-none' }, 'None set yet.'))] : []),
        h('section', {}, h('h3', {}, 'Global variables'), varRows.length ? table(varRows) : h('p', { class: 'g-none' }, paused ? 'None set.' : 'None set in this session.')),
      ];
    }
    if (n === rendering) body.replaceChildren(...parts);
  }

  // --- follow the web client window ---------------------------------------------
  let pending: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(pending);
    pending = setTimeout(() => void render(), 150);
  };
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(`tabularius.window.${s.db}`);
    channel.onmessage = (e) => {
      if (e.data?.type !== 'window') return;
      const { type: _, ...info } = e.data as WindowInfo & { type: string };
      win = info;
      soon();
    };
    channel.postMessage({ type: 'hello' });
    // The Script Debugger says when its run pauses or goes on.
    const debug = new BroadcastChannel(`tabularius.debug.${s.db}`);
    debug.onmessage = (e) => {
      if (e.data?.type !== 'run') return;
      const id = String(e.data.id ?? '');
      if (!e.data.paused || !id) {
        if (!id || paused?.id === id) follow(undefined);
        soon();
        return;
      }
      call<RunView>('GET', `/runs/${id}`).then(follow, () => follow(undefined)).finally(soon);
    };
    debug.postMessage({ type: 'hello' });
  }
  // The watch list is shared with the Script Debugger.
  window.addEventListener('storage', (e) => {
    if (e.key !== watchKey) return;
    watches = load(watchKey, []);
    soon();
  });
  try {
    follow((await call<{ runs: RunView[] }>('GET', '/runs')).runs.find((r) => r.paused));
  } catch {
    // an older server, or no debugger access: follow the window only
  }
  window.addEventListener('focus', soon);
  await render();
}

start().catch((e) => app.replaceChildren(h('p', { class: 'empty' }, `Couldn't start: ${(e as Error).message}`)));
