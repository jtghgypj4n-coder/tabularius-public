// Design mode: build and change a solution's tables, fields, relationships,
// value lists, custom functions, layouts and scripts in the browser. Uses the
// session of the web client (log in there first).

import { DesignClient, DesignError, type Change, type Design } from './client.ts';
import { AssistantPanel, assistantInfo, type DraftTarget, type UseDraft } from '../assistant.ts';
import { h, button, toast } from './dom.ts';
import { PRODUCT_NAME, markSvg } from '../brand.ts';
import { Together, initials, isAt, personColor, type Designer, type Where } from './together.ts';
import { tablesTab } from './schema.ts';
import { graphTab } from './graph.ts';
import { openModernize } from './modernize.ts';
import { layoutsTab, scriptsTab, valueListsTab, functionsTab, dataSourcesTab, containersTab, historyTab } from './catalog.ts';
import { reportTab } from './report.ts';
import { reviewTab } from './review.ts';
import { menusTab } from './menus.ts';
import { themesTab } from './styles.ts';
import { proposalPicture } from './layout-editor.ts';
import { draftsReplaced, scriptTabs } from './script-tabs.ts';
import { plainMessage } from '../http-problem.ts';
import { canLeaveLayout, commitReplacingScriptDrafts } from './async-state.ts';
import { announce } from '../announcer.ts';

export interface Studio {
  client: DesignClient;
  design: Design;
  /** Apply changes; true when they were made. Errors are shown to the user. */
  apply(changes: Change[], done?: string): Promise<boolean>;
  /** The changes that take back the last apply, when it only added things. */
  lastUndo?: Change[];
  /** Selection within a tab (a table, a script, ...), kept across re-renders. */
  selected: Record<string, number | undefined>;
  render(): void;
  /** Asks the AI assistant a question in its panel (when the server has one). */
  ask?: (question: string, draft?: { target: DraftTarget; use: UseDraft }) => Promise<string | undefined>;
  /** Whether the open editor (the layout or script editor) has unsaved edits that applying a change would drop. */
  unsaved?: () => boolean;
  /** Whether the script shown has unsaved steps (kept through a redraw by its tab; lost when the tab closes). */
  unsavedScript?: () => boolean;
  /** Pastes layout objects copied in FileMaker's Layout mode into the open layout editor; the notes, or undefined when nothing was pasted. */
  pasteLayout?: (xml: string) => Promise<string[] | undefined>;
  /** Other people in design mode on this file, and their saves as they happen. */
  together?: Together;
  /** Opened as FileMaker's Layout mode from a browse window: leaving goes back to it, in the mode given. */
  layoutMode?: { exit: (mode: 'browse' | 'find' | 'preview') => void };
}

type TabId = 'tables' | 'relationships' | 'dataSources' | 'containers' | 'layouts' | 'scripts' | 'valueLists' | 'functions' | 'menus' | 'themes' | 'history' | 'review' | 'report';
const TABS: [TabId, string, (s: Studio) => HTMLElement | Promise<HTMLElement>][] = [
  ['tables', 'Tables & fields', tablesTab],
  ['relationships', 'Relationships', graphTab],
  ['dataSources', 'Data sources', dataSourcesTab],
  ['containers', 'Containers', containersTab],
  ['layouts', 'Layouts', layoutsTab],
  ['scripts', 'Scripts', scriptsTab],
  ['valueLists', 'Value lists', valueListsTab],
  ['functions', 'Custom functions', functionsTab],
  ['menus', 'Custom menus', menusTab],
  ['themes', 'Themes', themesTab],
  ['history', 'History', historyTab],
  ['review', 'Review changes', reviewTab],
  ['report', 'Report', reportTab],
];

const app = document.getElementById('app')!;

export function errorText(e: unknown): string {
  if (e instanceof DesignError) return `${e.message} (error ${e.code})`;
  return plainMessage(e);
}

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
    app.replaceChildren(h('div', { class: 'd-empty' }, h('p', {}, 'Log in to a file first, then open Design.'), h('a', { href: './' }, 'Log in')));
    return;
  }
  const client = new DesignClient(s.db, s.token);
  let design: Design;
  try {
    design = await client.design();
  } catch (e) {
    const msg = e instanceof DesignError && e.code === 952 ? 'Your session ended. Log in again, then open Design.' : errorText(e);
    app.replaceChildren(h('div', { class: 'd-empty' }, h('p', {}, msg), h('a', { href: './' }, 'Back to the file')));
    return;
  }

  // Layout mode from a browse window (#layoutmode=<layout id>): straight into that layout's editor.
  const layoutModeId = Number(/^#layoutmode=(\d+)$/.exec(location.hash)?.[1] ?? NaN);
  const inLayoutMode = Number.isInteger(layoutModeId) && design.layouts.some((l) => l.id === layoutModeId);
  if (inLayoutMode) announce('Layout mode.');
  // #modernize (the link a file just hosted from the welcome page opens) goes to the Layouts tab with Modernize interfaces open.
  const modernize = location.hash === '#modernize';
  let tab: TabId = inLayoutMode || modernize ? 'layouts' : (/^#(\w+)/.exec(location.hash)?.[1] as TabId) ?? 'tables';
  if (!TABS.some(([id]) => id === tab)) tab = 'tables';
  const nav = h('nav', { class: 'd-tabs', role: 'tablist' });
  const body = h('main', { class: 'd-body' });
  const title = h('h1', { class: 'd-title' });
  let rendering = 0;

  const studio: Studio = {
    client,
    design,
    // #scripts=<name> (the debugger's Edit Script) opens on that script.
    selected: { script: design.scripts.find((x) => `#scripts=${encodeURIComponent(x.name)}` === location.hash)?.id },
    async apply(changes, done) {
      // A change to a script with unsaved steps here (the assistant's, Replace all, Undo) replaces them: ask first,
      // then drop them, so a later Save can't write the old lines back over it.
      const drafts = scriptTabs(client.db).drafts;
      const hit = draftsReplaced(changes, drafts);
      if (hit.length) {
        const names = hit.map((id) => `"${studio.design.scripts.find((x) => x.id === id)?.name ?? drafts.get(id)?.name ?? id}"`).join(', ');
        if (!confirm(`This changes ${names}, which ${hit.length === 1 ? 'has' : 'have'} unsaved changes here. They are replaced by this change. Go ahead?`)) return false;
      }
      try {
        const r = await commitReplacingScriptDrafts(drafts, hit, () => client.change(changes),
          (result, id, fallback) => result.design.scripts.find((script) => script.id === id)?.text ?? fallback);
        studio.lastUndo = r.undo;
        studio.design = r.design;
        if (done) toast(done, 'info');
        studio.render();
        return true;
      } catch (e) {
        toast(errorText(e));
        return false;
      }
    },
    render() {
      const n = ++rendering;
      // In design mode, on no layout, script or table until the tab drawn says otherwise.
      studio.together?.go('layout', 0);
      studio.unsaved = undefined;
      studio.unsavedScript = undefined;
      title.textContent = studio.design.database;
      document.title = `${studio.design.database} · Design`;
      nav.replaceChildren(...TABS.map(([id, label]) => {
        const b = button(label, () => {
          const dirty = !!studio.unsaved?.();
          if (!canLeaveLayout(dirty, !dirty || confirm('Leave this layout without saving your changes?'))) return;
          tab = id;
          history.replaceState(null, '', `#${id}`);
          studio.render();
        }, { role: 'tab', 'aria-selected': String(id === tab) });
        return b;
      }));
      const make = TABS.find(([id]) => id === tab)![2];
      Promise.resolve(make(studio)).then((el) => {
        if (n === rendering) body.replaceChildren(el);
      }, (e) => toast(errorText(e)));
    },
  };

  if (inLayoutMode) {
    studio.selected.layout = layoutModeId;
    studio.selected.editLayout = layoutModeId;
    history.replaceState(null, '', '#layouts');
    studio.layoutMode = { exit: (mode) => leaveLayoutMode(studio, mode) };
  }
  const brand = h('span', { class: 'd-brand' });
  brand.innerHTML = markSvg();
  brand.append(PRODUCT_NAME);
  const header = h('header', { class: 'd-header' },
    brand, title, h('span', { class: 'd-mode' }, inLayoutMode ? 'Layout mode' : 'Design'), nav,
    h('span', { class: 'd-spacer' }),
    button('Paste from FileMaker', () => pasteDialog(studio, () => tab), { class: 'd-paste', title: 'Paste tables, fields, scripts, steps, custom functions, value lists or layout objects copied in FileMaker Pro' }),
    inLayoutMode ? layoutModeSwitch(studio) : h('a', { class: 'd-back', href: './' }, 'Back to browse'),
  );
  // In Layout mode FileMaker's mode keys go back: ⌘B Browse, ⌘F Find, ⌘U Preview (⌘L stays Lock in the editor).
  if (inLayoutMode) {
    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const mode = ({ b: 'browse', f: 'find', u: 'preview' } as Record<string, 'browse' | 'find' | 'preview'>)[e.key.toLowerCase()];
      if (!mode) return;
      e.preventDefault();
      leaveLayoutMode(studio, mode);
    });
  }
  // Cmd/Ctrl+V of FileMaker's clipboard XML anywhere but a text box pastes it into the file.
  document.addEventListener('paste', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!/^\s*(<\?xml[^>]*>\s*)?<fmxmlsnippet\b/.test(text)) return;
    e.preventDefault();
    void pasteSnippet(studio, text, tab);
  });
  // Working alongside others: who else is in design mode, and their saves as they land.
  const together = new Together(s.db, s.token);
  studio.together = together;
  const peers = h('span', { class: 'd-peers', 'aria-label': 'Also in design mode' });
  header.insertBefore(peers, header.querySelector('.d-spacer')!.nextSibling);
  together.onPeers(() => {
    peers.replaceChildren(...[...together.others.values()].map((d) => h('span', {
      class: 'd-peer', style: `--peer:${personColor(d.account)}`, title: `${d.account}: ${whereIs(studio, d)}`,
    }, initials(d.account))));
    // The chips beside layouts, scripts and tables in the lists.
    for (const el of document.querySelectorAll<HTMLElement>('[data-peers]')) fillPeers(studio, el);
  });
  // A save that touched only the script open in the script editor is that editor's to show (it merges it).
  let ownScript = false;
  together.onDesign(async (ids, account, where) => {
    // Every save comes as a layout change (its layouts, perhaps none) and, when it touched them, script and table changes.
    if (where === 'script') {
      if (tab === 'scripts' && studio.selected.script !== undefined && ids.includes(studio.selected.script)) ownScript = true;
      return;
    }
    // The script and table changes of the same save arrive just after this layout change: start listening for them now.
    if (where === 'layout') ownScript = false;
    let fresh: Design;
    try {
      fresh = await client.design();
    } catch {
      return;
    }
    studio.design = fresh;
    if (where === 'table') {
      // Tables & fields applies each change as it's made, so the table on screen redraws, unless something is being typed.
      const typing = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
      if (tab === 'tables' && studio.selected.table !== undefined && ids.includes(studio.selected.table) && !typing) studio.render();
      return;
    }
    // The layout editor merges its own layout; everything else waits for a click, so nothing typed is lost.
    // (Wait for the script changes of the same save before deciding.)
    await new Promise((ok) => setTimeout(ok, 100));
    if (studio.selected.editLayout === undefined && tab !== 'tables' && !ownScript) {
      toast(`${account ?? 'Someone'} saved a design change`, 'info', { label: 'Show it', run: () => {
        if (studio.unsaved?.() && !confirm('Showing it redraws the page, and your unsaved changes are lost. Show it anyway?')) return;
        studio.render();
      } });
    }
  });
  together.start();
  // Scripts left with unsaved steps in their tabs (kept only in this page): leaving the page asks first.
  addEventListener('beforeunload', (e) => {
    if (scriptTabs(s.db).drafts.size || studio.unsaved?.()) e.preventDefault();
  });
  const shell = h('div', { class: 'd-shell' }, header, body);
  app.replaceChildren(shell);
  studio.render();
  if (modernize) {
    history.replaceState(null, '', location.pathname + location.search);
    openModernize(studio);
  }
  // The AI assistant: explains and drafts; its proposed changes apply here like any other.
  const info = await assistantInfo(s.db, s.token);
  if (info.available) {
    const panel = new AssistantPanel(s.db, s.token, () => ({ mode: 'design', design: designContext(studio, tab) }),
      info.canDesign ? async (changes) => {
        if (studio.unsaved?.() && !confirm('Applying this redraws what you have open, and your unsaved changes to it are lost. Apply anyway?')) return false;
        const ok = await studio.apply(changes as Change[], 'Applied the assistant\'s changes');
        return ok && { undo: studio.lastUndo };
      } : undefined, info.canDesign ? (undo) => studio.apply(undo as Change[], 'Undone') : undefined);
    // Layouts it proposes are drawn in the panel before anything is applied, and open in the layout editor after.
    panel.layoutPicture = (l) => proposalPicture(studio, l);
    panel.openLayout = (l) => {
      const id = studio.design.layouts.find((x) => x.id === l.id && x.name === l.name)?.id ?? studio.design.layouts.find((x) => x.name === l.name)?.id;
      if (id === undefined) return toast(`The layout "${l.name}" isn't in the file any more`);
      tab = 'layouts';
      history.replaceState(null, '', '#layouts');
      studio.selected.layout = id;
      studio.selected.editLayout = id;
      studio.render();
    };
    header.insertBefore(button('Ask AI', () => panel.toggle(), { class: 'd-ai' }), header.lastElementChild);
    shell.classList.add('with-ai');
    shell.append(panel.element);
    studio.ask = (question, draft) => panel.askAbout(question, draft);
    studio.render();
  }
}

/** Back to the browse window Layout mode came from, in the mode picked; asks first when the layout has unsaved edits. */
function leaveLayoutMode(studio: Studio, mode: 'browse' | 'find' | 'preview'): void {
  if (studio.unsaved?.() && !confirm('Leave Layout mode without saving your changes to this layout?')) return;
  try {
    // The browse window comes back on the layout being edited, in the mode picked.
    const raw = sessionStorage.getItem('tabularius.return');
    const back = raw ? JSON.parse(raw) as { layout?: string; mode?: string } : {};
    const editing = studio.design.layouts.find((l) => l.id === (studio.selected.editLayout ?? studio.selected.layout));
    const next = editing && editing.name !== back.layout ? { layout: editing.name, view: 'form', index: 0, mode } : { ...back, mode };
    sessionStorage.setItem('tabularius.return', JSON.stringify(next));
    if (editing) sessionStorage.setItem(`tabularius.layout.${studio.client.db}`, editing.name);
  } catch { /* the browse window opens on its last layout */ }
  location.href = './';
}

/** Browse, Find, Layout and Preview, as the browse window's mode switch, with Layout pressed. */
function layoutModeSwitch(studio: Studio): HTMLElement {
  const group = h('div', { class: 'segmented d-modes', role: 'group', 'aria-label': 'Mode' });
  for (const [mode, label, title] of [['browse', 'Browse', 'Browse Mode (⌘B): back to the records'], ['find', 'Find', 'Find Mode (⌘F)'], ['layout', 'Layout', 'Layout Mode: changing this layout'], ['preview', 'Preview', 'Preview Mode (⌘U)']] as const) {
    group.append(button(label, () => { if (mode !== 'layout') leaveLayoutMode(studio, mode); }, { 'aria-pressed': String(mode === 'layout'), title }));
  }
  return group;
}

/** Where a paste goes: fields into the table shown on the Tables tab, steps at the end of the script shown on the Scripts tab. */
function pasteTarget(studio: Studio, tab: TabId): { table?: number; script?: number } {
  return {
    ...(studio.selected.table !== undefined && studio.design.tables.some((t) => t.id === studio.selected.table) ? { table: studio.selected.table } : studio.design.tables.length === 1 ? { table: studio.design.tables[0].id } : {}),
    ...(tab === 'scripts' && studio.design.scripts.length ? { script: studio.design.scripts.find((x) => x.id === studio.selected.script)?.id ?? studio.design.scripts[0].id } : {}),
  };
}

/** Paste FileMaker's clipboard XML: the server reads it into changes, applied here like any other. Returns the notes, or undefined when nothing was pasted. */
async function pasteSnippet(studio: Studio, xml: string, tab: TabId): Promise<string[] | undefined> {
  if (/<fmxmlsnippet[^>]*type\s*=\s*["']LayoutObjectList["']/.test(xml)) {
    if (studio.pasteLayout) return studio.pasteLayout(xml);
    toast('These are layout objects: open a layout in the layout editor (Layouts tab) to paste them');
    return undefined;
  }
  try {
    const r = await studio.client.snippet(xml, pasteTarget(studio, tab));
    if (!await studio.apply(r.changes, `Pasted ${r.summary.join(', ')}`)) return undefined;
    if (r.notes.length) notesDialog(r.summary, r.notes);
    return r.notes;
  } catch (e) {
    toast(errorText(e));
    return undefined;
  }
}

/**
 * Copy objects as FileMaker's clipboard XML. FileMaker Pro reads its own clipboard types, so pasting the text there
 * needs a clipboard tool that converts it; pasting into another Tabularius file's design page works as it is.
 */
export function copyForFileMaker(studio: Studio, pick: Parameters<DesignClient['copySnippet']>[0], what: string): Promise<boolean> {
  return copyXml(() => studio.client.copySnippet(pick), what);
}

/** Puts FileMaker clipboard XML on the clipboard, or shows it (and any notes) to copy by hand. False when the XML could not be made. */
export async function copyXml(make: () => Promise<{ xml: string; notes: string[] }>, what: string): Promise<boolean> {
  try {
    const { xml, notes } = await make();
    let copied = true;
    try {
      await navigator.clipboard.writeText(xml);
    } catch {
      copied = false;
    }
    if (copied && !notes.length) {
      toast(`Copied ${what} as FileMaker XML`, 'info');
      return true;
    }
    const text = h('textarea', { class: 'd-paste-xml', rows: '12', spellcheck: 'false', readonly: '' });
    text.value = xml;
    const d = h('dialog', { class: 'd-dialog', 'aria-labelledby': 'd-xml-title' },
      h('h3', { id: 'd-xml-title' }, copied ? `Copied ${what} as FileMaker XML` : `${what} as FileMaker XML`),
      copied ? undefined : h('p', {}, 'The browser didn\'t allow copying: select the XML below and copy it.'),
      notes.length ? h('ul', { class: 'd-notes' }, ...notes.map((n) => h('li', {}, n))) : undefined,
      text,
      h('div', { class: 'd-row' }, button('Close', () => d.close())));
    d.addEventListener('close', () => d.remove());
    (document.querySelector('.d-shell') ?? document.body).append(d);
    d.showModal();
    if (!copied) text.select();
    return true;
  } catch (e) {
    toast(errorText(e));
    return false;
  }
}

export function notesDialog(summary: string[], notes: string[]): void {
  const d = h('dialog', { class: 'd-dialog', 'aria-labelledby': 'd-notes-title' },
    h('h3', { id: 'd-notes-title' }, `Pasted ${summary.join(', ')}`),
    h('p', {}, 'A few things didn\'t carry over as they were:'),
    h('ul', { class: 'd-notes' }, ...notes.map((n) => h('li', {}, n))),
    h('div', { class: 'd-row' }, button('OK', () => d.close())));
  d.addEventListener('close', () => d.remove());
  (document.querySelector('.d-shell') ?? document.body).append(d);
  d.showModal();
}

/** A box to paste FileMaker's clipboard XML into, for browsers that don't hand it to the page. */
function pasteDialog(studio: Studio, tab: () => TabId): void {
  const target = pasteTarget(studio, tab());
  const where = [
    target.table !== undefined ? `Fields go into ${studio.design.tables.find((t) => t.id === target.table)?.name}.` : 'Select a table on the Tables tab to paste fields into it.',
    target.script !== undefined ? `Steps go at the end of ${studio.design.scripts.find((x) => x.id === target.script)?.name}.` : 'Steps without a script make a new script (select one on the Scripts tab to add them to it).',
  ].join(' ');
  const text = h('textarea', { class: 'd-paste-xml', rows: '14', spellcheck: 'false', placeholder: '<fmxmlsnippet type="FMObjectList"> ...' });
  const d = h('dialog', { class: 'd-dialog', 'aria-labelledby': 'd-paste-title' },
    h('h3', { id: 'd-paste-title' }, 'Paste from FileMaker'),
    h('p', {}, 'In FileMaker Pro, copy tables or fields (Manage Database), scripts or steps (Script Workspace), custom functions, value lists, or objects in Layout mode (into the open layout editor). ' +
      'If your browser doesn\'t paste them straight into this page, paste the XML below; a clipboard tool may be needed to get it as text.'),
    h('p', { class: 'd-hint' }, where),
    text,
    h('div', { class: 'd-row' },
      button('Paste', async () => {
        if (!text.value.trim()) return;
        const notes = await pasteSnippet(studio, text.value, tab());
        if (notes) d.close();
      }, { class: 'primary' }),
      button('Cancel', () => d.close())));
  d.addEventListener('close', () => d.remove());
  (document.querySelector('.d-shell') ?? document.body).append(d);
  d.showModal();
  text.focus();
}

/**
 * "Draft with AI" beside a formula box or the script editor: what it should do, in words, and a button. The
 * assistant's checked draft comes back in its panel with a button that puts it in the editor (unsaved).
 */
export function draftWithAI(studio: Studio, target: () => DraftTarget, question: (want: string) => string, use: UseDraft): HTMLElement[] {
  if (!studio.ask) return [];
  const want = h('input', { class: 'd-ai-want', placeholder: target().kind === 'script' ? 'What should the script do?' : 'What should it work out?', 'aria-label': 'What to draft' });
  const go = () => studio.ask!(question(want.value.trim()), { target: target(), use });
  want.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go();
    }
  });
  return [want, button('Draft with AI', go, { title: 'The assistant writes it and checks it; you review it before saving' })];
}

/**
 * "Design with AI" under a list (new tables, new layouts): what is wanted, in words. The assistant proposes the
 * changes in its panel, checked against the design, and nothing changes until they are applied.
 */
export function designWithAI(studio: Studio, placeholder: string, question: (want: string) => string): HTMLElement[] {
  if (!studio.ask) return [];
  const want = h('input', { class: 'd-ai-want', placeholder, 'aria-label': placeholder });
  const go = () => {
    if (want.value.trim()) void studio.ask!(question(want.value.trim()));
  };
  const form = h('form', { class: 'd-inline-form d-ai-design' }, want, h('button', { type: 'submit' }, 'Design with AI'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  return [form];
}

/** An editor's formula for a question: short ones as they are, long ones left for the assistant to read from the design. */
export function current(formula: string): string {
  const f = formula.trim();
  return f.length <= 300 ? `the formula ${f}` : `a ${f.split('\n').length}-line formula (read it with get_design)`;
}

/** What is open in design mode, for the assistant: the tab and the table, field, layout, script, ... selected on it. */
function designContext(studio: Studio, tab: TabId): { tab: string; selection?: { kind: string; name: string }[] } {
  const d = studio.design;
  const pick = <T extends { id: number; name: string }>(items: T[], key: string) => items.find((i) => i.id === studio.selected[key]) ?? items[0];
  const selection: { kind: string; name: string }[] = [];
  const add = (kind: string, item?: { name: string }) => item && selection.push({ kind, name: item.name });
  if (tab === 'tables') {
    const table = pick(d.tables, 'table');
    add('table', table);
    add('field', table?.fields.find((f) => f.id === studio.selected.field));
  } else if (tab === 'layouts') add('layout', pick(d.layouts, 'layout'));
  else if (tab === 'scripts') add('script', pick(d.scripts, 'script'));
  else if (tab === 'valueLists') add('value list', pick(d.valueLists, 'valueList'));
  else if (tab === 'functions') add('custom function', pick(d.customFunctions, 'customFunction'));
  else if (tab === 'dataSources') add('data source', pick(d.dataSources ?? [], 'dataSource'));
  const label = TABS.find(([id]) => id === tab)![1];
  return { tab: label, ...(selection.length ? { selection } : {}) };
}

start().catch((e) => app.replaceChildren(h('p', { class: 'd-empty' }, `Couldn't start: ${errorText(e)}`)));

/** Where someone is in design mode, in words. */
function whereIs(studio: Studio, d: Designer): string {
  const name = (list: { id: number; name: string }[], id: number) => list.find((x) => x.id === id)?.name ?? `#${id}`;
  if (d.layout) return `editing the layout "${name(studio.design.layouts, d.layout)}"`;
  if (d.script) return `editing the script "${name(studio.design.scripts, d.script)}"`;
  if (d.table) return `on the table ${name(studio.design.tables, d.table)}`;
  return 'in design mode';
}

/** The initials of whoever else has this layout, script or table open, beside it in a list; kept current as people move. */
export function peersAt(studio: Studio, where: Where, id: number, selected?: number): HTMLElement {
  const el = h('span', { class: 'd-peers-at', 'data-peers': `${where}:${id}${selected !== undefined ? `:${selected}` : ''}` });
  fillPeers(studio, el);
  return el;
}

function fillPeers(studio: Studio, el: HTMLElement): void {
  const [where, id, selected] = (el.dataset.peers ?? '').split(':') as [Where, string, string | undefined];
  // With `selected`: only those who have that picked there (a field of a table).
  const here = [...(studio.together?.others.values() ?? [])].filter((d) => isAt(d, where, Number(id)) && (selected === undefined || d.selection.includes(Number(selected))));
  el.replaceChildren(...here.map((d) => h('span', { class: 'd-peer d-peer-sm', style: `--peer:${personColor(d.account)}`, title: `${d.account} has this ${selected === undefined ? 'open' : 'selected'}` }, initials(d.account))));
}
