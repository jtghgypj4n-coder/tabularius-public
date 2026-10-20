// Layouts, scripts, value lists, custom functions, external data sources, containers and the design history.

import { modernDesign } from '../page-source.ts';
import type { Flavour } from '../page-templates.ts';
import { FLAVOURS, HOME_PREFIX, dashboardPage, flavourOf, homePage, homeScript, pickTable, planDashboard } from '../page-templates.ts';
import type { Change, Design, DesignDataSource, DesignTable, DesignValueList, ScriptComparison, ScriptLintIssue, ScriptLimits } from './client.ts';
import { h, button, select, field, check, toast } from './dom.ts';
import { copyForFileMaker, current, designWithAI, draftWithAI, errorText, type Studio } from './main.ts';
import { layoutEditor } from './layout-editor.ts';
import { openModernize } from './modernize.ts';
import { orderedList } from './order.ts';
import { formulaChecker } from './formula.ts';
import { findInScripts, replaceInScripts, toggleSteps, type FindOptions } from './script-find.ts';
import { diffHunks, diffSummary, lineDiff } from './line-diff.ts';
import { historyPanel, testsPanel } from './script-tests.ts';
import { profilePanel } from './script-profile.ts';
import { dryRunPanel } from './script-dry-run.ts';
import { improvePanel } from './script-refactor.ts';
import { groupSteps } from './step-groups.ts';
import { dependsPanel } from './script-depends.ts';
import { scriptTabs, type ScriptTabs } from './script-tabs.ts';
import type { LineMark } from './profile-marks.ts';
import { mergeText } from './merge.ts';
import { initials, personColor } from './together.ts';
import { windowRecord } from './window-record.ts';
import { confirmRename, impactNote, impactPanel, type ImpactKind } from './impact.ts';

/** A list on the left, the selected item on the right. */
function master<T extends { id: number; name: string }>(studio: Studio, key: string, title: string, items: T[], describe: (t: T) => string,
  detail: (t: T) => (HTMLElement | undefined)[], create: HTMLElement, ordered?: Omit<Parameters<typeof orderedList<T>>[1], 'key' | 'items' | 'current' | 'describe'>): HTMLElement {
  const current = items.find((i) => i.id === studio.selected[key]) ?? items[0];
  const list = h('ul', { class: 'd-list' });
  for (const it of ordered ? [] : items) {
    const li = h('li', { class: it === current ? 'selected' : '' }, h('button', { type: 'button' }, h('span', {}, it.name), h('span', { class: 'd-count' }, describe(it))));
    li.querySelector('button')!.addEventListener('click', () => {
      studio.selected[key] = it.id;
      studio.render();
    });
    list.append(li);
  }
  return h('div', { class: 'd-split' },
    h('aside', { class: 'd-side' }, h('h2', {}, title), ...(ordered ? orderedList(studio, { ...ordered, key, items, current, describe }) : [list]), create),
    h('section', { class: 'd-main' }, ...(current ? detail(current) : [h('p', { class: 'd-muted' }, `No ${title.toLowerCase()} yet.`)]).filter((x): x is HTMLElement => !!x)),
  );
}

export function createForm(studio: Studio, key: string, placeholder: string, extra: HTMLElement[], change: (name: string) => Change, find: (name: string) => number | undefined): HTMLFormElement {
  const name = h('input', { placeholder, 'aria-label': placeholder });
  const form = h('form', { class: 'd-inline-form' }, name, ...extra, h('button', { type: 'submit', class: 'primary' }, 'Create'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) return;
    if (await studio.apply([change(n)])) {
      studio.selected[key] = find(n);
      studio.render();
    }
  });
  return form;
}

export function renameRow(studio: Studio, current: string, change: (name: string) => Change, del: () => void, what: string, explain?: string, copy?: Parameters<typeof copyForFileMaker>[1], impact?: ImpactKind): HTMLElement {
  const name = h('input', { value: current, class: 'd-title-input', 'aria-label': `${what} name` });
  const rename = button('Rename', async () => {
    const to = name.value.trim();
    if (!to || to === current) return;
    // Before a rename that breaks something (a use by name, a privilege entry, a Data API client), say what.
    if (impact && !(await confirmRename(studio, impact, current, to))) return;
    void studio.apply([change(to)], `${what} renamed`);
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') rename.click();
  });
  const ask = studio.ask && explain ? [button('Explain with AI', () => studio.ask!(explain), { title: 'Ask the assistant what this does' })] : [];
  const copyOut = copy ? [button('Copy for FileMaker', () => void copyForFileMaker(studio, copy, current), { title: 'Copy as FileMaker clipboard XML, to paste into FileMaker Pro or another Tabularius file' })] : [];
  const heading = h('div', { class: 'd-heading' }, name, rename, h('span', { class: 'd-spacer' }), ...ask, ...copyOut, button(`Delete ${what.toLowerCase()}…`, del, { class: 'danger' }));
  return impact ? h('div', { class: 'd-stack' }, heading, impactPanel(studio, impact, current)) : heading;
}

// ---------------------------------------------------------------- layouts

/** A phone layout made from a desktop one: stacked, tap-sized, and following the desktop layout's changes. */
export async function makePhoneLayout(studio: Studio, l: { id: number; name: string }): Promise<void> {
  const taken = new Set(studio.design.layouts.map((x) => x.name));
  let name = `${l.name} (phone)`;
  for (let n = 2; taken.has(name); n++) name = `${l.name} (phone ${n})`;
  if (!await studio.apply([{ op: 'createLayout', name, phoneOf: l.id }], `Made "${name}": it follows "${l.name}" until you edit it`)) return;
  const made = studio.design.layouts.find((x) => x.name === name);
  if (made) {
    studio.selected.layout = made.id;
    studio.render();
  }
}

/** Where a phone layout came from, whether it still follows it, and a way to rebuild it. */
function phoneNote(studio: Studio, l: Design['layouts'][number]): HTMLElement[] {
  if (!l.phone) return [];
  const from = studio.design.layouts.find((x) => x.id === l.phone!.of);
  if (!from) return [h('p', { class: 'd-muted' }, 'A phone layout; the layout it was made from no longer exists.')];
  const rebuild = button(`Rebuild from "${from.name}"`, () => {
    if (l.phone!.following || confirm(`Rebuild "${l.name}" from "${from.name}"? Changes made to it by hand are replaced.`)) {
      void studio.apply([{ op: 'updateLayout', layout: l.id, rebuildPhone: true }], 'Rebuilt: it follows the desktop layout again');
    }
  });
  return [h('div', { class: 'd-group' }, h('p', {}, l.phone.following
    ? `Phone layout made from "${from.name}": changes there show here too, until this layout is edited by hand.`
    : `Phone layout made from "${from.name}", edited by hand since, so it no longer follows that layout.`), rebuild)];
}

/** Manage Layouts' Duplicate: the whole design under "<name> Copy". */
async function duplicateLayout(studio: Studio, l: { id: number; name: string; tableOccurrenceId?: number }): Promise<void> {
  try {
    const design = await studio.client.layout(l.id);
    const taken = new Set(studio.design.layouts.map((x) => x.name));
    let name = `${l.name} Copy`;
    for (let n = 2; taken.has(name); n++) name = `${l.name} Copy ${n}`;
    const { id: _id, name: _name, ...rest } = design as typeof design & { id?: number; name?: string };
    await studio.apply([{ op: 'createLayout', name, occurrence: l.tableOccurrenceId ?? design.tableOccurrenceId, design: rest }], 'Layout duplicated');
    const copy = studio.design.layouts.find((x) => x.name === name);
    if (copy) {
      studio.selected.layout = copy.id;
      studio.render();
    }
  } catch (e) {
    toast(errorText(e));
  }
}

function tableOf(studio: Studio, occurrence: number): DesignTable | undefined {
  const to = studio.design.tableOccurrences.find((t) => t.id === occurrence);
  return studio.design.tables.find((t) => t.id === to?.baseTableId);
}

export function layoutsTab(studio: Studio): HTMLElement | Promise<HTMLElement> {
  const { design } = studio;
  const editing = studio.selected.editLayout;
  if (editing !== undefined) {
    return layoutEditor(studio, editing, () => {
      studio.selected.editLayout = undefined;
      studio.render();
    }).catch((e) => {
      studio.selected.editLayout = undefined;
      return h('p', { class: 'd-muted' }, `Couldn't open the layout: ${errorText(e)}`);
    });
  }
  const tos = design.tableOccurrences.map((t) => [String(t.id), t.name] as [string, string]);
  const occurrence = select(tos, tos[0]?.[0] ?? '', { 'aria-label': 'Shows records from' });
  // Modern: the layout is a page in HTML, CSS and JavaScript (a web viewer filling the window), which FileMaker Pro opens too.
  const kind = select([['classic', 'Classic layout'], ['modern', 'Modern layout (HTML, CSS, JavaScript)'], ...FLAVOURS.map(([k, label]) => [k, `Modern ${label[0].toLowerCase()}${label.slice(1)}`] as [string, string])], 'classic', { 'aria-label': 'Kind of layout' });
  // The table's name suggests a template (an Invoices table, the invoicing dashboard) when the kind is still the default.
  occurrence.addEventListener('change', () => {
    if (kind.value !== 'classic' && kind.value !== 'modern') { const t = tableOf(studio, Number(occurrence.value)); kind.value = (t && flavourOf(t)) ?? 'general'; }
  });
  const create = h('div', {}, createForm(studio, 'layout', 'New layout name', [occurrence, kind],
    (name) => {
      const op = { op: 'createLayout', name, occurrence: Number(occurrence.value) };
      if (kind.value === 'modern') return { ...op, design: modernDesign(name, name) };
      if (kind.value === 'classic') return op;
      // Tiles, charts and the latest records, worked out from the table's field names and types, live from the data.
      const to = studio.design.tableOccurrences.find((t) => t.id === op.occurrence);
      const table = tableOf(studio, op.occurrence);
      return { ...op, design: modernDesign(name, name, dashboardPage(name, name, planDashboard(table ?? { id: 0, name: to?.name ?? name, fields: [], records: null }, kind.value as Flavour | 'general'))) };
    },
    (n) => studio.design.layouts.find((l) => l.name === n)?.id),
  ...designWithAI(studio, 'Describe a layout to add…', (want) => `Design a new layout for this file: ${want}. ` +
    'Pick the table occurrence it shows and the fields people need, and draft it with propose_layout, which follows the theme, styles ' +
    'and components of the layouts already here (totals, a find and a sort, portals of related records with column totals too). If it needs ' +
    'more than that (buttons), propose it with propose_design_change, following the look of the layouts already here. For a dashboard, a ' +
    'landing page or anything that should look striking or animated, write a modern layout with propose_page instead.'),
  h('div', { class: 'd-actions' }, button('Modernize interfaces…', () => openModernize(studio), { title: 'A list, a record form and a list with the form beside it for each table, from templates with no AI, beside your own layouts' })), fileOptions(studio));
  return master(studio, 'layout', 'Layouts', design.layouts, (l) => l.occurrence ?? '', (l) => {
    const to = select(tos, String(l.tableOccurrenceId ?? ''));
    const save = button('Save', () => void studio.apply([{ op: 'updateLayout', layout: l.id, occurrence: Number(to.value) }], 'Saved'));
    const open = button('Open in browse mode', () => {
      try {
        sessionStorage.setItem(`tabularius.layout.${studio.client.db}`, l.name);
        // The window left for Manage Layouts would otherwise come back as it was, on the layout it was on.
        sessionStorage.removeItem('tabularius.return');
      } catch { /* the app opens its first layout instead */ }
      location.href = './';
    });
    return [
      renameRow(studio, l.name, (name) => ({ op: 'updateLayout', layout: l.id, name }), async () => {
        const note = await impactNote(studio, 'layout', l.name, 'delete');
        if (confirm(`Delete layout "${l.name}"? Records are not affected.${note ? `\n\n${note}` : ''}`)) {
          studio.selected.layout = undefined;
          void studio.apply([{ op: 'deleteLayout', layout: l.id }], 'Layout deleted');
        }
      }, 'Layout', `Explain the layout "${l.name}": what it is for, what it shows, its buttons and the scripts they run, and its triggers.`, undefined, 'layout'),
      h('div', { class: 'd-group' }, field('Shows records from', h('div', { class: 'd-row' }, to, save)),
        inMenu(studio, 'Include in layout menus', design.layoutOrder, l.id, (on) => ({ op: 'updateLayout', layout: l.id, includeInMenu: on }))),
      h('div', { class: 'd-actions' }, button('Edit layout', () => {
        studio.selected.editLayout = l.id;
        studio.render();
      }, { class: 'primary' }), open, button('Duplicate', () => void duplicateLayout(studio, l)),
      ...(l.phone ? [] : [button('Make a phone layout', () => void makePhoneLayout(studio, l), { title: 'A copy stacked in one column for phones, with fields and buttons big enough to tap, that follows this layout\'s changes' })])),
      ...phoneNote(studio, l),
    ];
  }, create, { list: 'layouts', order: design.layoutOrder });
}

/** File Options: the layout the file opens on, and the scripts run when its first window opens and its last closes, and when any window opens or closes. */
function fileOptions(studio: Studio): HTMLElement {
  const fo = studio.design.fileOptions ?? {};
  const scripts: [string, string][] = [['', 'None'], ...studio.design.scripts.map((s) => [String(s.id), s.name] as [string, string])];
  const layouts: [string, string][] = [['', 'The first layout'], ...studio.design.layouts.map((l) => [String(l.id), l.name] as [string, string])];
  const set = (key: string, v: string) => void studio.apply([{ op: 'setFileOptions', [key]: v ? Number(v) : null }], 'File options saved');
  const pick = (opts: [string, string][], value: number | undefined, key: string, label: string) => {
    const el = select(opts, value === undefined ? '' : String(value), { 'aria-label': label });
    el.addEventListener('change', () => set(key, el.value));
    return field(label, el);
  };
  return h('details', { class: 'd-report' }, h('summary', {}, 'File options'),
    h('div', { class: 'd-stack' },
      pick(layouts, fo.openLayoutId, 'openLayout', 'Switch to layout on open'),
      pick(scripts, fo.onFirstWindowOpen?.scriptId, 'onFirstWindowOpen', 'OnFirstWindowOpen script'),
      pick(scripts, fo.onLastWindowClose?.scriptId, 'onLastWindowClose', 'OnLastWindowClose script'),
      pick(scripts, fo.onWindowOpen?.scriptId, 'onWindowOpen', 'OnWindowOpen script'),
      pick(scripts, fo.onWindowClose?.scriptId, 'onWindowClose', 'OnWindowClose script'),
      button('Make a landing page for each privilege set…', () => void makeLandingPages(studio), { title: 'A modern layout per privilege set, and the script that sends each account to its own when the file opens' })));
}

/**
 * A landing page for each privilege set: a modern layout per set (each with its own colour, showing the layouts the
 * signed-in account may open), and a script that sends each account to its set's page when the file opens, set as the
 * OnFirstWindowOpen script unless the file already has one. Pages and script already there are left as they are.
 */
async function makeLandingPages(studio: Studio): Promise<void> {
  const d = studio.design;
  const have = new Set(d.layouts.map((l) => l.name));
  const sets = d.privilegeSets.map((set) => ({ set, layout: `${HOME_PREFIX}${set}` }));
  const fresh = sets.filter((x) => !have.has(x.layout));
  const main = pickTable(d.tables);
  const occurrence = d.tableOccurrences.find((t) => t.baseTableId === main?.id && !t.dataSourceId) ?? d.tableOccurrences.find((t) => !t.dataSourceId);
  if (!occurrence) return toast('Add a table first: a landing page is a layout, and a layout shows a table');
  if (!fresh.length) return toast('Every privilege set already has a landing page');
  const script = 'Go to my home page';
  const ops: Change[] = fresh.map((x) => ({ op: 'createLayout', name: x.layout, occurrence: occurrence.id, design: modernDesign(x.layout, x.layout, homePage(x.layout, x.set)) }));
  const scriptExists = d.scripts.some((x) => x.name === script);
  if (!scriptExists) ops.push({ op: 'createScript', name: script, text: homeScript(sets) });
  const fo = d.fileOptions;
  const setsOpen = !fo?.onFirstWindowOpen && !scriptExists;
  if (setsOpen) ops.push({ op: 'setFileOptions', onFirstWindowOpen: script });
  const done = await studio.apply(ops, `Made ${fresh.length} landing page${fresh.length === 1 ? '' : 's'}${setsOpen ? ' and set the file to open on yours' : scriptExists ? '' : '; the file already has an OnFirstWindowOpen script, so call "Go to my home page" from it'}`);
  if (done) studio.render();
}

/** "Include in menu": a checkbox that saves as soon as it changes. */
function inMenu(studio: Studio, label: string, order: { id: number; kind: string; hidden?: true }[], id: number, change: (on: boolean) => Change): HTMLElement {
  const box = check(label, !order.some((o) => o.kind === 'item' && o.id === id && o.hidden));
  box.input.addEventListener('change', () => void studio.apply([change(box.input.checked)], 'Saved'));
  return box.el;
}

// ---------------------------------------------------------------- scripts

export function scriptsTab(studio: Studio): HTMLElement {
  const { design } = studio;
  const create = h('div', {}, createForm(studio, 'script', 'New script name', [], (name) => ({ op: 'createScript', name, steps: [] }),
    (n) => studio.design.scripts.find((s) => s.name === n)?.id),
  ...designWithAI(studio, 'Describe a script to add…', (want) => `Write a new script for this file: ${want}. ` +
    'Name it the way the scripts already here are named, use the layouts, fields and scripts that exist, check it, and propose it. ' +
    'It must not send email or reach the network.'));
  create.prepend(scriptFinder(studio));
  const tabs = scriptTabs(studio.client.db);
  return master(studio, 'script', 'Scripts', design.scripts, (s) => `${s.steps.length} steps`, (s) => [
    tabStrip(studio, tabs, s.id),
    renameRow(studio, s.name, (name) => ({ op: 'updateScript', script: s.id, name }), async () => {
      const note = await impactNote(studio, 'script', s.name, 'delete');
      if (confirm(`Delete script "${s.name}"? Buttons and scripts that perform it will do nothing.${note ? `\n\n${note}` : ''}`)) {
        studio.selected.script = undefined;
        void studio.apply([{ op: 'deleteScript', script: s.id }], 'Script deleted');
      }
    }, 'Script', `Explain the script "${s.name}" in plain English: what it does, step by step in a few lines; what it needs to start (layout, found set, parameter); ` +
      `what it changes; what calls it and what it calls; anything that would send something outside the file; and anything that looks wrong or won't work here.`, { scripts: [s.id] }, 'script'),
    inMenu(studio, 'Include in menu', design.scriptOrder, s.id, (on) => ({ op: 'updateScript', script: s.id, includeInMenu: on })),
    scriptEditor(studio, s, tabs),
  ], create, { list: 'scripts', order: design.scriptOrder });
}

/** The open scripts as tabs above the editor, as in FileMaker's Script Workspace; a dot marks unsaved steps. */
function tabStrip(studio: Studio, tabs: ScriptTabs, current: number): HTMLElement {
  const names = new Map(studio.design.scripts.map((x) => [x.id, x.name]));
  // A script picked from the list (or a tab) opens a tab; the one shown by default after closing every tab doesn't.
  if (studio.selected.script !== undefined) tabs.closedAll = false;
  const ids = tabs.shown((id) => names.has(id), tabs.closedAll ? undefined : current, tabs.last, (d) =>
    toast(`${d.name ? `"${d.name}"` : 'A script you had open'} was deleted, with your unsaved changes to it.`, 'info',
      { label: 'Copy the steps', run: () => void navigator.clipboard?.writeText(d.text) }));
  tabs.last = tabs.closedAll ? undefined : current;
  const strip = h('div', { class: 'se-tabs', role: 'tablist', 'aria-label': 'Open scripts' });
  for (const id of ids) {
    const name = names.get(id)!;
    const unsaved = id !== current && tabs.drafts.has(id);
    const pick = h('button', { type: 'button', role: 'tab', class: 'se-tab-name', 'aria-selected': String(id === current), title: unsaved ? `${name} (unsaved changes)` : name },
      name, ...(unsaved ? [h('span', { class: 'se-tab-dot', 'aria-hidden': 'true' }, '•')] : []));
    pick.addEventListener('click', () => {
      if (id === current) return;
      studio.selected.script = id;
      studio.render();
    });
    const close = button('×', () => {
      const editing = id === current ? studio.unsavedScript?.() : tabs.drafts.has(id);
      if (editing && !confirm(`Close "${name}"? Its unsaved changes are lost.`)) return;
      const next = tabs.close(id);
      if (id === current) {
        studio.selected.script = next;
      }
      studio.render();
    }, { class: 'se-tab-close', title: `Close ${name}`, 'aria-label': `Close ${name}` });
    strip.append(h('div', { class: id === current ? 'se-tab current' : 'se-tab' }, pick, close));
  }
  return strip;
}

/** What Find in scripts last looked for, kept across re-renders; and the line a result opens at. */
const finding: { query: string; replace: string; opts: FindOptions; open: boolean } = { query: '', replace: '', opts: {}, open: false };
let goToLine: { script: number; line: number } | undefined;

/** Find (and replace) text in every script, like the Script Workspace's Find and Replace. */
function scriptFinder(studio: Studio): HTMLElement {
  const query = h('input', { type: 'search', placeholder: 'Find in scripts', 'aria-label': 'Find in scripts', value: finding.query }) as HTMLInputElement;
  const replace = h('input', { placeholder: 'Replace with', 'aria-label': 'Replace with', value: finding.replace }) as HTMLInputElement;
  const matchCase = check('Match case', !!finding.opts.matchCase);
  const wholeWord = check('Whole word', !!finding.opts.wholeWord);
  const results = h('ul', { class: 'd-list se-found' });
  const summary = h('p', { class: 'd-hint', 'aria-live': 'polite' });
  const opts = (): FindOptions => ({ matchCase: matchCase.input.checked, wholeWord: wholeWord.input.checked });
  const scripts = () => studio.design.scripts.map((x) => ({ id: x.id, name: x.name, text: x.text }));
  const draw = () => {
    Object.assign(finding, { query: query.value, replace: replace.value, opts: opts() });
    const found = findInScripts(scripts(), query.value, opts());
    const shown = found.slice(0, 200);
    summary.textContent = !query.value ? '' : found.length
      ? `${found.length} line${found.length === 1 ? '' : 's'} in ${new Set(found.map((m) => m.script)).size} script${new Set(found.map((m) => m.script)).size === 1 ? '' : 's'}${found.length > shown.length ? ` (first ${shown.length} shown)` : ''}`
      : 'Not found';
    results.replaceChildren(...shown.map((m) => {
      const li = h('li', {}, h('button', { type: 'button', title: m.text.trim() }, h('span', {}, `${m.name} · line ${m.line}`), h('span', { class: 'd-count g-mono' }, m.text.trim().slice(0, 80))));
      li.querySelector('button')!.addEventListener('click', () => {
        studio.selected.script = m.script;
        goToLine = { script: m.script, line: m.line };
        studio.render();
      });
      return li;
    }));
  };
  for (const el of [query, replace]) el.addEventListener('input', draw);
  for (const c of [matchCase, wholeWord]) c.input.addEventListener('change', draw);
  const replaceAll = button('Replace all', async () => {
    const changed = replaceInScripts(scripts(), query.value, replace.value, opts());
    if (!changed.length) return;
    const count = changed.reduce((n, c) => n + c.count, 0);
    if (!confirm(`Replace ${count} match${count === 1 ? '' : 'es'} in ${changed.length} script${changed.length === 1 ? '' : 's'}? Each changed line is read again as a step.`)) return;
    // One change for all of them: every script is replaced, or none is (a line that no longer reads as a step stops it).
    await studio.apply(changed.map((c) => ({ op: 'updateScript', script: c.script, text: c.text })), `Replaced ${count} in ${changed.length} script${changed.length === 1 ? '' : 's'}`);
  }, { title: 'Replace every match in every script' });
  const box = h('details', { class: 'se-find' }, h('summary', {}, 'Find and replace'),
    h('div', { class: 'd-stack' }, query, replace, h('div', { class: 'd-inline-form' }, matchCase.el, wholeWord.el, replaceAll), summary, results));
  (box as HTMLDetailsElement).open = finding.open;
  box.addEventListener('toggle', () => {
    finding.open = (box as HTMLDetailsElement).open;
    if (finding.open) query.focus();
  });
  draw();
  return box;
}

/** Every script step, searchable; clicking one adds it to the script. */
function stepList(names: string[], insert: (name: string) => void): HTMLElement {
  const search = h('input', { type: 'search', placeholder: 'Search steps', 'aria-label': 'Search steps' }) as HTMLInputElement;
  const list = h('div', { class: 'se-step-list' });
  const groups = groupSteps(names);
  /** Groups open as last left (FileMaker keeps them as you leave them). */
  const open = new Set<string>(['Control']);
  const item = (n: string) => h('li', {}, button(n, () => insert(n), { title: `Add ${n}` }));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    if (q) {
      // Searching: every match in one list, as FileMaker's search does.
      list.replaceChildren(h('ul', {}, ...names.filter((n) => n.toLowerCase().includes(q)).map(item)));
      return;
    }
    list.replaceChildren(...groups.map(([g, steps]) => {
      const d = h('details', { class: 'se-step-group', ...(open.has(g) ? { open: '' } : {}) }, h('summary', {}, g), h('ul', {}, ...steps.map(item))) as HTMLDetailsElement;
      d.addEventListener('toggle', () => (d.open ? open.add(g) : open.delete(g)));
      return d;
    }));
  };
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    // Enter adds the first match.
    if (e.key === 'Enter') {
      e.preventDefault();
      list.querySelector('button')?.click();
    }
  });
  draw();
  return h('div', { class: 'se-steps' }, search, list);
}

/** A script as text: one step per line, as FileMaker's script workspace shows it. */
function scriptEditor(studio: Studio, s: Studio['design']['scripts'][number], tabs: ScriptTabs): HTMLElement {
  const gutter = h('pre', { class: 'se-gutter', 'aria-hidden': 'true' });
  const text = h('textarea', { class: 'se-text', spellcheck: 'false', wrap: 'off', 'aria-label': `Steps of ${s.name}` });
  text.value = s.text;
  /** The script as last saved (by anyone): what unsaved edits are measured and merged against. */
  let base = s.text;
  // Back to a tab left with unsaved steps: they come back, with any save made since merged in.
  const kept = tabs.restore(s.id, s.text);
  if (kept) {
    text.value = kept.text;
    if (kept.merged) toast(kept.conflicts
      ? `This script was saved while you were in another tab. That save is merged with your unsaved changes; where both changed the same lines (${kept.conflicts}), yours are kept.`
      : 'This script was saved while you were in another tab. That save is merged with your unsaved changes.', 'info');
  }
  const error = h('p', { class: 'se-error', role: 'alert' });
  const status = h('span', { class: 'd-muted' });
  const findings = h('div', { class: 'se-lint', hidden: '' });
  // Others with this script open, and the line they're on.
  const others = h('div', { class: 'se-peers', 'aria-live': 'polite' });
  /** The profiler's timings beside the lines (Profile), shown while the editor matches the saved script. */
  let marks: Map<number, LineMark> | undefined;
  const lines = () => {
    const n = text.value.split('\n').length;
    if (marks && text.value === base) {
      gutter.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const m = marks!.get(i + 1);
        return h('span', { class: m?.hot ? 'se-ln se-hot' : 'se-ln', ...(m ? { title: m.title } : {}) },
          ...(m ? [h('span', { class: 'se-ms' }, m.label)] : []), String(i + 1), i < n - 1 ? '\n' : '');
      }));
      gutter.classList.add('se-gutter-timed');
    } else {
      gutter.textContent = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
      gutter.classList.remove('se-gutter-timed');
    }
    status.textContent = text.value === base ? `${s.steps.length} steps` : 'Unsaved changes';
    tabs.edit(s.id, text.value, base, s.name);
  };
  const together = studio.together;
  const here = () => together?.go('script', s.id, [text.value.slice(0, text.selectionStart).split('\n').length]);
  const drawOthers = () => {
    const there = [...(together?.others.values() ?? [])].filter((d) => d.script === s.id);
    others.replaceChildren(...there.map((d) => h('span', { class: 'se-peer', style: `--peer:${personColor(d.account)}` },
      h('span', { class: 'd-peer d-peer-sm', 'aria-hidden': 'true' }, initials(d.account)), `${d.account} is here${d.selection[0] ? ` (line ${d.selection[0]})` : ''}`)));
  };
  /**
   * Someone else saved this script: with nothing unsaved here it just shows theirs; otherwise theirs merges into
   * these edits line by line (mine kept where we both changed the same lines). False when the script was deleted.
   */
  const catchUp = async (account?: string): Promise<boolean> => {
    let theirs: string | undefined;
    try {
      studio.design = await studio.client.design();
      theirs = studio.design.scripts.find((x) => x.id === s.id)?.text;
    } catch {
      return true;
    }
    if (theirs === undefined) {
      toast(`${account ?? 'Someone'} deleted this script. Copy your steps before leaving it.`);
      return false;
    }
    if (theirs === base) return true;
    const who = account ?? 'Someone';
    if (text.value === base) {
      text.value = theirs;
      toast(`${who} saved this script; it now shows their version`, 'info');
    } else {
      const { text: merged, conflicts } = mergeText(base, text.value, theirs);
      const at = text.selectionStart;
      text.value = merged;
      text.setSelectionRange(Math.min(at, merged.length), Math.min(at, merged.length));
      toast(conflicts
        ? `${who} saved this script too. Their changes are merged with yours; where you both changed the same lines (${conflicts}), yours are kept.`
        : `${who} saved this script too. Their changes are merged with yours, still unsaved.`, 'info');
    }
    base = theirs;
    // Someone else's save moves the steps the timings were placed on.
    marks = undefined;
    lines();
    return true;
  };
  if (together) {
    const offPeers = together.onPeers(() => (text.isConnected ? drawOthers() : offPeers()));
    const offDesign = together.onDesign((ids, account, where) => {
      if (!text.isConnected) return offDesign();
      if (where === 'script' && ids.includes(s.id)) void catchUp(account);
    });
    drawOthers();
    here();
    for (const ev of ['keyup', 'click', 'focus'] as const) text.addEventListener(ev, here);
  }
  // Each tab keeps its unsaved steps through a redraw, so only leaving the page asks (see leaving below);
  // closing this tab asks too.
  studio.unsavedScript = () => text.isConnected && text.value !== base;
  text.addEventListener('input', lines);
  // Check again a moment after typing stops.
  let pause: ReturnType<typeof setTimeout> | undefined;
  text.addEventListener('input', () => {
    clearTimeout(pause);
    pause = setTimeout(() => {
      if (text.isConnected && text.value !== checked) void check(true);
    }, 1200);
  });
  text.addEventListener('scroll', () => (gutter.scrollTop = text.scrollTop));
  /** Disable (// ) or comment (# ) the steps on the selected lines, or undo it. */
  const toggle = (prefix: '// ' | '# ') => {
    const first = text.value.slice(0, text.selectionStart).split('\n').length - 1;
    const last = text.value.slice(0, Math.max(text.selectionStart, text.selectionEnd - 1)).split('\n').length - 1;
    const next = toggleSteps(text.value, first, last, prefix);
    if (next === text.value) return;
    const rows = next.split('\n');
    const start = rows.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
    const end = rows.slice(0, last + 1).reduce((n, l) => n + l.length + 1, 0) - 1;
    text.focus();
    // Through the editing commands where they work, so the browser's Undo can take it back.
    text.setSelectionRange(0, text.value.length);
    if (!document.execCommand?.('insertText', false, next)) text.value = next;
    text.setSelectionRange(start, Math.max(start, end));
    lines();
  };
  text.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      // ⌘/ disables or enables the selected steps, as in FileMaker.
      e.preventDefault();
      toggle('// ');
    } else if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      // Tab indents, as in FileMaker's workspace, instead of leaving the editor.
      e.preventDefault();
      text.setRangeText('\t', text.selectionStart, text.selectionEnd, 'end');
      lines();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  });
  const save = async () => {
    error.textContent = '';
    // Whatever someone else saved meanwhile comes in first, so their save isn't lost.
    if (!(await catchUp())) return;
    try {
      const r = await studio.client.change([{ op: 'updateScript', script: s.id, text: text.value }]);
      tabs.drafts.delete(s.id);
      studio.design = r.design;
      studio.render();
    } catch (e) {
      error.textContent = errorText(e);
      const line = /Line (\d+)/.exec(error.textContent)?.[1];
      if (line) {
        // Put the cursor on the line that failed.
        const at = text.value.split('\n').slice(0, Number(line) - 1).reduce((n, l) => n + l.length + 1, 0);
        text.focus();
        text.setSelectionRange(at, at + (text.value.split('\n')[Number(line) - 1]?.length ?? 0));
      }
    }
  };
  /** Select line n (from 1) of the editor. */
  const selectLine = (n: number, last = n) => {
    const all = text.value.split('\n');
    const at = all.slice(0, n - 1).reduce((x, l) => x + l.length + 1, 0);
    const end = all.slice(0, last).reduce((x, l) => x + l.length + 1, 0) - 1;
    text.focus();
    text.setSelectionRange(at, Math.max(at, end));
    text.scrollTop = Math.max(0, (n - 5) * 12 * 1.6);
  };
  /**
   * Check, which FileMaker doesn't have: loops that never end and guards that catch nothing, each with a fix.
   * It also runs by itself a moment after typing stops (`live`), then only showing when there is something to say.
   */
  let checked = '';
  const check = async (live = false) => {
    let issues: ScriptLintIssue[];
    const at = text.value;
    try {
      issues = await studio.client.lintScript(at, s.id);
    } catch (e) {
      if (!live) error.textContent = errorText(e);
      return;
    }
    // Typing went on meanwhile, or the editor was replaced: a newer check will say.
    if (text.value !== at || !text.isConnected) return;
    checked = at;
    if (live && !issues.length && findings.hidden) return;
    findings.hidden = false;
    findings.replaceChildren(
      h('p', { class: 'd-hint', 'aria-live': 'polite' }, issues.length
        ? `${issues.length} script issue${issues.length === 1 ? '' : 's'} to review before running:`
        : 'No script issues found.'),
      ...(issues.length ? [h('ul', { class: 'd-list se-lint-list' }, ...issues.map((i) => {
        const why = i.detail ? h('p', { class: 'se-lint-why', hidden: '' }, i.detail) : undefined;
        const actions = h('div', { class: 'se-lint-actions' },
          ...(why ? [button('Why?', () => {
            why.hidden = !why.hidden;
          }, { title: 'Why it can\'t end, or catch what it seems to: where the values come from and when they are empty' })] : []),
          ...(studio.ask ? [button('Fix with AI', () => {
            const unsaved = text.value !== base && text.value.length <= 6000 ? `\n\nThe editor has unsaved steps; fix these:\n${text.value}` : '';
            void studio.ask!(`Fix this problem in the script "${s.name}", line ${i.line}: ${i.message} Suggested fix: ${i.fix}` +
              ` Change only the steps this needs and keep everything else as it is; write out the whole script.${unsaved}`,
            { target: { kind: 'script', for: s.name }, use: (draft) => showReview(draft) });
          }, { title: 'The assistant drafts the fix; you see it as a diff and nothing changes until you put it in the editor and save' })] : []));
        const li = h('li', { class: `se-lint-${i.severity}` },
          h('button', { type: 'button', title: 'Select this line' }, h('span', { class: 'g-mono' }, `Line ${i.line}`)),
          h('div', {}, h('p', {}, i.message), h('p', { class: 'd-muted' }, i.fix), ...(why ? [why] : []), actions));
        li.querySelector('button')!.addEventListener('click', () => selectLine(i.line));
        return li;
      }))] : []));
  };
  lines();
  // Findings show as soon as the script opens.
  if (s.text.trim()) void check(true);
  // Opened from a Find in scripts result: select that line.
  if (goToLine?.script === s.id) {
    const n = goToLine.line;
    goToLine = undefined;
    const at = text.value.split('\n').slice(0, n - 1).reduce((x, l) => x + l.length + 1, 0);
    // After the page has redrawn (the editor is replaced on each render).
    setTimeout(() => {
      if (!text.isConnected) return;
      text.scrollIntoView({ block: 'nearest' });
      text.focus();
      text.setSelectionRange(at, at + (text.value.split('\n')[n - 1]?.length ?? 0));
      // Scroll the line into view: lines are 1.6em of 12px.
      text.scrollTop = Math.max(0, (n - 5) * 12 * 1.6);
    }, 50);
  }
  /** A drafted script, as the lines it adds and removes, to put in the editor (still unsaved) or discard. */
  const review = h('div', { class: 'se-review', hidden: '' });
  // Tests and History, opened from the toolbar (built when first opened).
  const extra = h('div', { class: 'd-stack' });
  let open: 'tests' | 'history' | 'profile' | 'dryRun' | 'improve' | 'depends' | undefined;
  const panel = (which: 'tests' | 'history' | 'profile' | 'dryRun' | 'improve' | 'depends') => {
    open = open === which ? undefined : which;
    marks = undefined;
    lines();
    extra.replaceChildren(...(open === 'tests' ? [testsPanel(studio, s)]
      : open === 'dryRun' ? [dryRunPanel(studio, s)]
      : open === 'depends' ? [dependsPanel(studio, s, selectLine)]
      : open === 'improve' ? [improvePanel(studio, s, () => text.value, () => base, selectLine, (draft, prove) => showReview(draft, prove))]
      : open === 'profile' ? [profilePanel(studio, s, (m) => {
        marks = m;
        lines();
      }, selectLine)]
      : open === 'history' ? [historyPanel(studio, s, (old) => {
        text.value = old;
        error.textContent = '';
        text.focus();
        lines();
        toast('An earlier version is in the editor, not saved yet', 'info');
      })] : []));
  };
  /** A drafted script: with `prove`, put in the editor only once it is shown to do what the script does. */
  const showReview = (draft: string, prove = false) => {
    const diff = lineDiff(text.value, draft);
    const put = () => {
      text.value = draft;
      error.textContent = '';
      review.hidden = true;
      text.focus();
      lines();
    };
    const putButton = button('Put in the editor', put, { class: 'primary', title: 'Replaces the steps in the editor; nothing is saved until you save the script' });
    const proof = h('div', { class: 'se-review-proof', 'aria-live': 'polite' });
    review.replaceChildren(
      h('div', { class: 'se-review-head' }, h('strong', {}, 'Drafted changes'), h('span', { class: 'd-muted' }, diffSummary(diff))),
      ...diffHunks(diff).map((hunk) => h('pre', { class: 'se-diff', 'aria-label': `From line ${hunk.line}` },
        ...hunk.lines.map((d) => h('span', { class: `se-diff-${d.kind}` }, `${d.kind === 'add' ? '+' : d.kind === 'del' ? '−' : ' '} ${d.text}\n`)))),
      ...(prove ? [proof] : []),
      h('div', { class: 'd-actions' },
        ...(prove ? [] : [putButton]),
        button('Dry run', () => {
          const box = review.querySelector('.se-review-dry');
          if (box) box.remove();
          else review.append(h('div', { class: 'se-review-dry' }, dryRunPanel(studio, s, draft)));
        }, { title: 'Run the drafted steps once on a throwaway copy of the file, offline, and see which records and fields they would change' }),
        button('Discard', () => (review.hidden = true))));
    review.hidden = false;
    review.scrollIntoView({ block: 'nearest' });
    if (prove) void proveDraft(draft, proof, putButton, put);
  };
  /** Runs the script and the draft side by side on a copy; offers the draft only when they end the same. */
  const proveDraft = async (draft: string, proof: HTMLElement, putButton: HTMLButtonElement, put: () => void) => {
    proof.replaceChildren(h('p', { class: 'd-hint' }, 'Checking the draft does what the script does: running both on a copy of the file, offline…'));
    const against = text.value;
    let r: ScriptComparison;
    try {
      r = await studio.client.compareScriptDraft(s.id, draft, against !== base ? against : undefined);
    } catch (e) {
      proof.replaceChildren(h('p', { class: 'd-error' }, `Couldn't check the draft: ${errorText(e)}`),
        h('div', { class: 'd-actions' }, button('Use it anyway', put, { title: 'Put the draft in the editor without the check; nothing is saved until you save the script' })));
      return;
    }
    // The editor changed while it ran: the check was against steps that are gone.
    if (text.value !== against) {
      proof.replaceChildren(h('p', { class: 'd-hint' }, 'The steps in the editor changed while the draft was checked.'),
        h('div', { class: 'd-actions' }, button('Check again', () => void proveDraft(draft, proof, putButton, put), { class: 'primary' })));
      return;
    }
    const runs = `${r.cases.length} run${r.cases.length === 1 ? '' : 's'}`;
    const tests = r.tests.length ? ` and ${r.tests.filter((t) => t.passed).length} of ${r.tests.length} saved test case${r.tests.length === 1 ? '' : 's'} pass` : '';
    if (r.equal) {
      proof.replaceChildren(h('p', { class: 'd-ok' }, `Same results: ${runs} ended the same and changed the same records${tests}.` +
        (r.tests.length ? '' : ' Saved test cases make this check stronger (Tests).')));
      proof.closest('.se-review')?.querySelector('.d-actions')?.prepend(putButton);
      return;
    }
    const broke = r.tests.filter((t) => !t.passed);
    proof.replaceChildren(
      h('p', { class: 'd-error' }, r.cases.length ? `Not the same: the draft ends differently from the script in ${r.cases.filter((c) => !c.same).length} of ${runs}${broke.length ? `, and ${broke.length} saved test case${broke.length === 1 ? '' : 's'} fail${broke.length === 1 ? 's' : ''}` : ''}.` : 'Nothing to compare: the script has no runs to check.'),
      h('ul', { class: 'd-list' }, ...r.cases.filter((c) => !c.same).map((c) => h('li', {}, h('strong', {}, `${c.name}: `),
        c.differences.slice(0, 4).map((d) => `${d.what} was ${d.expected || '(empty)'}, is ${d.actual || '(empty)'}`).join('; '))),
      ...broke.map((t) => h('li', {}, h('strong', {}, `Test "${t.name}": `), t.failures.slice(0, 3).map((f) => `${f.what} expected ${f.expected || '(empty)'}, got ${f.actual || '(empty)'}`).join('; ') || t.message || 'failed'))),
      h('div', { class: 'd-actions' },
        ...(studio.ask ? [button('Ask AI to fix', () => {
          const what = [...r.cases.filter((c) => !c.same).map((c) => `- ${c.name}: ${c.differences.map((d) => `${d.what} should be ${d.expected || '(empty)'} but is ${d.actual || '(empty)'}`).join('; ')}`),
            ...broke.map((t) => `- Test "${t.name}": ${t.failures.map((f) => `${f.what} expected ${f.expected || '(empty)'}, got ${f.actual || '(empty)'}`).join('; ')}`)].join('\n');
          void studio.ask!(`Your refactored version of the script "${s.name}" doesn't do what the script does. Run on a copy of the file, these differ:\n${what}\n` +
            `Fix the draft so it does exactly what the script does; write out the whole script.\n\nYour draft:\n${draft.slice(0, 6000)}`,
          { target: { kind: 'script', for: s.name }, use: (next) => showReview(next, true) });
        }, { class: 'primary' })] : []),
        button('Use it anyway', put, { class: 'quiet', title: 'Put the draft in the editor even though it does something different; nothing is saved until you save the script' })));
  };
  return h('div', { class: 'd-stack' },
    others,
    h('div', { class: 'se-wrap' }, h('div', { class: 'se' }, gutter, text), stepList(studio.design.scriptSteps ?? [], (name) => {
      // A new line after the cursor's line, indented like it, as FileMaker's steps pane inserts.
      const at = text.selectionEnd;
      const start = text.value.lastIndexOf('\n', at - 1) + 1;
      const endAt = text.value.indexOf('\n', at);
      const end = endAt < 0 ? text.value.length : endAt;
      const indent = /^[\t ]*/.exec(text.value.slice(start, end))![0];
      const blank = text.value.slice(start, end).trim() === '';
      if (blank) text.setRangeText(indent + name, start, end, 'end');
      else text.setRangeText(`\n${indent}${name}`, end, end, 'end');
      text.focus();
      lines();
    })),
    error,
    h('div', { class: 'd-actions' }, button('Save script', () => void save(), { class: 'primary' }),
      button('Check', () => void check(), { title: 'Check loops, guards and execution options that need repair before running' }),
      button('Disable/Enable', () => toggle('// '), { title: 'Turn the selected steps off or back on (⌘/)' }),
      button('Comment', () => toggle('# '), { title: 'Make the selected lines comments, or back into steps' }),
      button('Copy steps', () => {
        // The selected lines' steps, as FileMaker's Script Workspace copies them; from the saved script.
        if (text.value !== base) {
          toast('Save the script first: steps are copied as saved');
          return;
        }
        const line = (at: number) => text.value.slice(0, at).split('\n').length;
        const first = line(text.selectionStart);
        const last = line(Math.max(text.selectionStart, text.selectionEnd - (text.value[text.selectionEnd - 1] === '\n' ? 1 : 0)));
        void copyForFileMaker(studio, { steps: { script: s.id, lines: [first, last] } }, first === last ? 'the step' : 'the steps');
      }, { title: 'Copy the selected steps as FileMaker XML, to paste into FileMaker Pro\'s Script Workspace or another Tabularius script' }),
      button('Revert', () => {
      text.value = base;
      error.textContent = '';
      lines();
    }),
      button('Tests', () => panel('tests'), { title: 'Saved inputs and expected results for this script, run offline on a copy (FileMaker has no script tests)' }),
      button('History', () => panel('history'), { title: 'Each save of this script here, and what it changed' }),
      button('Dry run', () => panel('dryRun'), { title: 'Which records and fields the script would change, each before and after; runs on a copy, nothing is saved (FileMaker has no dry run)' }),
      button('Improve', () => panel('improve'), { title: 'Where the script could be simpler or faster: branches that never run, repeated steps, slow loops, and where the time goes (FileMaker has nothing like it)' }),
      button('Depends', () => panel('depends'), { title: 'What the script uses and what starts it, and what breaks if one of its fields or layouts changes (FileMaker has no dependency map)' }),
      button('Profile', () => panel('profile'), { title: 'Each step\'s time beside its line, and the slowest steps picked out (FileMaker has no script profiler)' }), status),
    findings,
    review,
    extra,
    ...(studio.ask ? [h('div', { class: 'd-actions' }, ...draftWithAI(studio, () => ({ kind: 'script', for: s.name }),
      (want) => `Draft the script "${s.name}"${want ? `: ${want}` : ', from its name'}.` + (text.value.trim() ? ' Change the steps it has where needed; write out the whole script.' : ''),
      (draft) => showReview(draft)),
      button('Why does it fail?', () => {
        const at = windowRecord();
        void studio.ask!(`Why does the script "${s.name}" fail` + (at.layout ? ` when run from the layout "${at.layout}" on record ${at.recordId}` : '') +
          '? Call explain_script_failure (it runs on a copy, offline), then say which step stops it, why, and the change that fixes it.');
      }, { title: 'Runs the script again on a throwaway copy, offline, and the assistant explains the step that fails' }))] : []),
    limitsBox(studio, s),
    h('p', { class: 'd-hint' }, 'One step per line: Step name [ option ; option ]. “Quotes” name layouts and scripts; Table::Field names fields. // disables a step (⌘/ turns the selected steps off and on), # is a comment. Lines you don\'t change keep every option they had.'),
  );
}

/** Tabularius's runaway guard on one script (FileMaker has none): it stops cleanly past these, whoever runs it. */
function limitsBox(studio: Studio, s: { id: number; limits?: ScriptLimits }): HTMLElement {
  const input = (label: string, value: number | undefined, hint: string) => {
    const el = h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', placeholder: 'No limit', value: value === undefined ? '' : String(value), 'aria-label': label }) as HTMLInputElement;
    return { el, row: field(label, el, hint) };
  };
  const steps = input('Steps', s.limits?.steps, 'Steps this script and its subscripts may run');
  const seconds = input('Seconds', s.limits?.seconds, 'Time it may take, not counting waits for a person');
  const passes = input('Times round a loop', s.limits?.loopPasses, 'For each of its loops');
  const read = (x: HTMLInputElement) => (x.value.trim() === '' ? undefined : Number(x.value));
  const save = button('Save limits', () => {
    const limits = { steps: read(steps.el), seconds: read(seconds.el), loopPasses: read(passes.el) };
    const set = Object.values(limits).some((v) => v !== undefined);
    void studio.apply([{ op: 'updateScript', script: s.id, limits: set ? limits : null }], set ? 'Limits saved' : 'Limits taken off');
  });
  const on = s.limits ? Object.entries(s.limits).map(([k, v]) => `${v.toLocaleString('en-US')} ${k === 'loopPasses' ? 'times round' : k}`).join(', ') : '';
  return h('details', { class: 'd-report' }, h('summary', {}, `Runaway guard${on ? `: ${on}` : ''}`),
    h('div', { class: 'd-stack' },
      h('p', { class: 'd-muted' }, 'Stops this script cleanly, like Halt Script, when it goes past any of these, however it is run (a button, a schedule, the Data API, the AI). FileMaker has no such guard. Leave a box empty for no limit.'),
      steps.row, seconds.row, passes.row, h('div', { class: 'd-actions' }, save)));
}

// ---------------------------------------------------------------- value lists

export function valueListsTab(studio: Studio): HTMLElement {
  const create = h('div', {}, createForm(studio, 'valueList', 'New value list name', [], (name) => ({ op: 'createValueList', name, values: [] }),
    (n) => studio.design.valueLists.find((v) => v.name === n)?.id),
  ...designWithAI(studio, 'Describe a value list to add…', (want) => `Make a new value list for this file: ${want}. ` +
    'Use custom values, or values from a field when the choices live in a table here, and propose it.'));
  const d = studio.design;
  const occName = (id?: number) => d.tableOccurrences.find((t) => t.id === id)?.name ?? '?';
  const fieldName = (toId: number, id?: number) => tableOf(toId)?.fields.find((f) => f.id === id)?.name ?? '?';
  const tableOf = (toId: number) => {
    const to = d.tableOccurrences.find((t) => t.id === toId);
    return to && !to.dataSourceId ? d.tables.find((t) => t.id === to.baseTableId) : undefined;
  };
  const describe = (v: DesignValueList) => v.field ? `from ${occName(v.field.occurrenceId)}::${fieldName(v.field.occurrenceId, v.field.fieldId)}` : v.values ? `${v.values.length} values` : 'from a field';
  return master(studio, 'valueList', 'Value lists', d.valueLists, describe, (v) => {
    // Custom values, or values from a field (FileMaker's "Edit Value List" dialog).
    const local = d.tableOccurrences.filter((t) => tableOf(t.id));
    const src = { ...(v.field ?? { occurrenceId: local[0]?.id ?? 0, fieldId: 0 }) };
    let fromField = !!v.field;
    const custom = h('input', { type: 'radio', name: 'vl-source' }) as HTMLInputElement;
    const byField = h('input', { type: 'radio', name: 'vl-source' }) as HTMLInputElement;
    custom.checked = !fromField;
    byField.checked = fromField;
    const values = h('textarea', { rows: '12', class: 'd-code', 'aria-label': 'Values, one per line' }, (v.values ?? []).join('\n'));
    const fieldBox = h('div', { class: 'd-stack' });
    const drawField = () => {
      const fields = tableOf(src.occurrenceId)?.fields.filter((f) => f.kind !== 'summary' && f.type !== 'container') ?? [];
      if (!fields.some((f) => f.id === src.fieldId)) src.fieldId = fields[0]?.id ?? 0;
      if (!fields.some((f) => f.id === src.secondFieldId)) delete src.secondFieldId;
      const pick = (opts: [string, string][], value: string, set: (v: string) => void, redraw = false) => {
        const s = select(opts, value);
        s.addEventListener('change', () => {
          set(s.value);
          if (redraw) drawField();
        });
        return s;
      };
      const options = fields.map((f) => [String(f.id), f.name] as [string, string]);
      const onlySecond = check('Show values only from the second field', !!src.showSecondOnly);
      onlySecond.input.addEventListener('change', () => (src.showSecondOnly = onlySecond.input.checked));
      const sortSecond = check('Sort by the second field', !!src.sortBySecond);
      sortSecond.input.addEventListener('change', () => (src.sortBySecond = sortSecond.input.checked));
      fieldBox.replaceChildren(
        field('Use values from', pick(local.map((t) => [String(t.id), t.name]), String(src.occurrenceId), (x) => (src.occurrenceId = Number(x)), true)),
        field('Field', pick(options, String(src.fieldId), (x) => (src.fieldId = Number(x)))),
        field('Also display values from', pick([['', 'No second field'], ...options], String(src.secondFieldId ?? ''), (x) => {
          if (x) src.secondFieldId = Number(x);
          else delete src.secondFieldId;
        }, true)),
        ...(src.secondFieldId !== undefined ? [onlySecond.el, sortSecond.el] : []),
        field('Include', pick([['', 'All values'], ...d.tableOccurrences.filter((t) => t.id !== src.occurrenceId).map((t) => [String(t.id), `Only related values, starting from ${t.name}`] as [string, string])],
          String(src.relatedFromId ?? ''), (x) => {
            if (x) src.relatedFromId = Number(x);
            else delete src.relatedFromId;
          })),
      );
    };
    const customBox = field('Custom values, one per line', values);
    const show = () => {
      customBox.style.display = fromField ? 'none' : '';
      fieldBox.style.display = fromField ? '' : 'none';
      if (fromField) drawField();
    };
    custom.addEventListener('change', () => {
      fromField = false;
      show();
    });
    byField.addEventListener('change', () => {
      fromField = true;
      show();
    });
    show();
    const save = button('Save value list', () => {
      if (!fromField) return void studio.apply([{ op: 'updateValueList', valueList: v.id, values: values.value.split('\n').map((x) => x.trim()).filter(Boolean) }], 'Saved');
      if (!src.fieldId) return toast('Pick a field to take the values from');
      void studio.apply([{ op: 'updateValueList', valueList: v.id, field: {
        occurrence: src.occurrenceId, field: src.fieldId, second: src.secondFieldId ?? null, related: src.relatedFromId ?? null,
        showSecondOnly: !!src.showSecondOnly, sortBySecond: !!src.sortBySecond,
      } }], 'Saved');
    }, { class: 'primary' });
    return [
      renameRow(studio, v.name, (name) => ({ op: 'updateValueList', valueList: v.id, name }), async () => {
        const note = await impactNote(studio, 'valueList', v.name, 'delete');
        if (confirm(`Delete value list "${v.name}"?${note ? `\n\n${note}` : ''}`)) void studio.apply([{ op: 'deleteValueList', valueList: v.id }]);
      }, 'Value list', `Explain the value list "${v.name}": where its values come from and which fields use it.`, { valueLists: [v.id] }, 'valueList'),
      v.values || v.field ? undefined : h('p', { class: 'd-muted' }, 'This list takes its values from a field that Tabularius can\'t read from the file yet. Saving replaces it.'),
      h('div', { class: 'd-row' }, h('label', { class: 'd-check' }, custom, 'Use custom values'), h('label', { class: 'd-check' }, byField, 'Use values from a field')),
      customBox,
      fieldBox,
      h('div', { class: 'd-actions' }, save),
    ];
  }, create);
}

// ---------------------------------------------------------------- custom functions

export function functionsTab(studio: Studio): HTMLElement {
  const create = h('div', {}, createForm(studio, 'customFunction', 'New function name', [], (name) => ({ op: 'createCustomFunction', name, parameters: [], formula: '""' }),
    (n) => studio.design.customFunctions.find((c) => c.name === n)?.id),
  ...designWithAI(studio, 'Describe a function to add…', (want) => `Write a new custom function for this file: ${want}. ` +
    'Give it a clear name and parameters, check the formula, and propose it.'));
  return master(studio, 'customFunction', 'Custom functions', studio.design.customFunctions,
    (c) => `( ${c.parameters.join(' ; ')} )${c.language === 'javascript' ? ' · JavaScript' : ''}`, (c) => {
    const params = h('input', { value: c.parameters.join(' ; '), 'aria-label': 'Parameters' });
    const formula = h('textarea', { rows: '12', class: 'd-code', spellcheck: 'false' }, c.formula ?? '');
    const language = h('select', { 'aria-label': 'Written in' },
      h('option', { value: 'calculation' }, 'FileMaker calculation'), h('option', { value: 'javascript' }, 'JavaScript'));
    language.value = c.language ?? 'calculation';
    const js = () => language.value === 'javascript';
    const parameters = () => params.value.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    const checker = formulaChecker(studio, formula, () => ({ parameters: parameters() }));
    const jsNote = h('p', { class: 'd-muted' }, 'The body of a JavaScript function of the parameters: it returns the answer (a number, text, ' +
      'true/false, or an object as JSON text); dates come in as text like 2026-10-12. It runs in a sandbox with no files, network or ' +
      'modules, for up to 1 second and 64 MB each call. FileMaker Pro can\'t run it.');
    const showLanguage = () => {
      jsNote.hidden = !js();
      checker.button.hidden = js();
      checker.message.hidden = true;
    };
    language.addEventListener('change', showLanguage);
    const save = button('Save function', async () => {
      // A JavaScript body is checked when it is saved (the server compiles it without running it).
      if (!js() && formula.value !== (c.formula ?? '') && !await checker.confirmSave()) return;
      void studio.apply([{ op: 'updateCustomFunction', customFunction: c.id, formula: formula.value, parameters: parameters(),
        language: language.value as 'calculation' | 'javascript' }], 'Saved');
    }, { class: 'primary' });
    showLanguage();
    return [
      renameRow(studio, c.name, (name) => ({ op: 'updateCustomFunction', customFunction: c.id, name }), () => {
        if (confirm(`Delete custom function "${c.name}"? Formulas that call it will fail.`)) void studio.apply([{ op: 'deleteCustomFunction', customFunction: c.id }]);
      }, 'Function', `Explain the custom function "${c.name}": what it does with each parameter, with an example, and where it's used.`, { customFunctions: [c.id] }),
      field('Parameters', params, 'Separated by semicolons'),
      field('Written in', language),
      field('Formula', formula),
      jsNote,
      checker.message,
      h('div', { class: 'd-actions' }, save, checker.button, ...draftWithAI(studio, () => ({ kind: 'function', for: c.name }),
        (want) => `Draft the custom function "${c.name}"${want ? `: ${want}` : ', from its name'}, with its parameters.` +
          (formula.value.trim() && formula.value.trim() !== '""' ? ` It now has parameters ( ${params.value} ) and ${current(formula.value)}.` : ''),
        (text, parameters) => {
          formula.value = text;
          if (parameters) params.value = parameters.join(' ; ');
          formula.focus();
        })),
      tryFunction(studio, c.name, parameters, formula, js),
      usedIn(studio, c.name, 'customFunction'),
    ];
  }, create);
}

// ---------------------------------------------------------------- external data sources

/**
 * Manage External Data Sources: FileMaker file references and ODBC entries.
 * They're kept as FileMaker has them, and nothing connects out: a file
 * reference finds the hosted database of the same name.
 */
export function dataSourcesTab(studio: Studio): HTMLElement {
  const sources = studio.design.dataSources ?? [];
  const kind = select([['file', 'FileMaker file'], ['odbc', 'ODBC']], 'file', { 'aria-label': 'Type' });
  const create = h('div', {}, createForm(studio, 'dataSource', 'New data source name', [kind],
    (name) => ({ op: 'createDataSource', name, paths: [kind.value === 'odbc' ? `odbc:${name}` : `file:${name}`] }),
    (n) => studio.design.dataSources?.find((d) => d.name === n)?.id),
  h('p', { class: 'd-muted' }, 'Tables in other files come through these. Tabularius never connects out: a FileMaker file reference finds the hosted database with that name.'));
  return master(studio, 'dataSource', 'Data sources', sources, (d) => (d.kind === 'odbc' ? 'ODBC' : d.hosted ? `→ ${d.hosted}` : 'not hosted'), (d) => [
    renameRow(studio, d.name, (name) => ({ op: 'updateDataSource', dataSource: d.id, name }), () => {
      if (confirm(`Delete data source "${d.name}"?`)) void studio.apply([{ op: 'deleteDataSource', dataSource: d.id }], 'Data source deleted');
    }, 'Data source'),
    ...(d.kind === 'odbc' ? odbcSource(studio, d) : fileSource(studio, d)),
  ], create);
}

function fileSource(studio: Studio, d: DesignDataSource): HTMLElement[] {
  const paths = h('textarea', { rows: '4', class: 'd-code', spellcheck: 'false', 'aria-label': 'File paths' }, d.paths.join('\n'));
  const save = button('Save paths', () => void studio.apply([{ op: 'updateDataSource', dataSource: d.id, paths: paths.value.split('\n') }], 'Saved'), { class: 'primary' });
  return [
    h('p', {}, d.hosted ? `Finds the hosted database ${d.hosted}.` : 'No hosted database has this name yet: host one with that name, or change the path, and its tables show.'),
    field('File paths', paths, 'One per line, tried in order: file:Name (same folder or server), fmnet:/host/Name, filemac:/path/Name.fmp12, filewin:/path/Name.fmp12, or a $variable. Each is matched to a hosted database by its file name.'),
    h('div', { class: 'd-actions' }, save),
    h('p', { class: 'd-muted' }, d.occurrences ? `${d.occurrences} table occurrence${d.occurrences === 1 ? '' : 's'} use${d.occurrences === 1 ? 's' : ''} it.` : 'No table occurrence uses it yet.'),
  ];
}

function odbcSource(studio: Studio, d: DesignDataSource): HTMLElement[] {
  const dsn = h('input', { value: d.paths[0]?.replace(/^odbc:/, '') ?? '', 'aria-label': 'DSN' });
  const save = button('Save', () => void studio.apply([{ op: 'updateDataSource', dataSource: d.id, paths: [`odbc:${dsn.value.trim()}`] }], 'Saved'), { class: 'primary' });
  return [
    field('DSN', dsn, 'The ODBC data source name, as set up on the computer that hosts the file in FileMaker Server'),
    h('div', { class: 'd-actions' }, save),
    h('p', { class: 'd-muted' }, 'Kept for FileMaker. Tabularius doesn\'t connect to ODBC sources, and doesn\'t keep their user names or passwords.'),
  ];
}

// ---------------------------------------------------------------- containers

const size = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

/**
 * Manage Containers: the base directories FileMaker stores container data in
 * (relative to the database's folder), and the fields set to store there.
 * Tabularius keeps every container file in the database itself; the settings are
 * kept for FileMaker (Design Report, copying fields).
 */
export function containersTab(studio: Studio): HTMLElement {
  const dirs = studio.design.containerDirectories ?? [];
  const data = studio.design.containerData;
  const openField = (tableId: number, fieldId: number) => {
    studio.selected.table = tableId;
    studio.selected.field = fieldId;
    [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((b) => b.textContent === 'Tables & fields')?.click();
  };
  const rows = dirs.map((d) => {
    const path = h('input', { value: d.path, class: 'd-code', 'aria-label': `Path of base directory ${d.id}` });
    const save = button('Save', () => void studio.apply([{ op: 'updateContainerDirectory', directory: d.id, path: path.value }], 'Saved'));
    const del = d.id === 0 ? '' : button('Delete', () => {
      if (confirm(`Delete the base directory ${d.path}?`)) void studio.apply([{ op: 'deleteContainerDirectory', directory: d.id }], 'Base directory deleted');
    }, { class: 'danger', ...(d.fields.length ? { disabled: '', title: 'Fields store their data here' } : {}) });
    const fields = d.fields.length ? d.fields.map((f, i) => {
      const link = h('button', { type: 'button', class: 'link' }, `${f.table}::${f.field}`);
      link.addEventListener('click', () => openField(f.tableId, f.fieldId));
      return [i ? ', ' : '', link];
    }).flat() : [h('span', { class: 'd-muted' }, 'No fields')];
    return h('tr', {}, h('td', {}, d.id === 0 ? 'Default' : String(d.id)), h('td', {}, h('div', { class: 'd-row' }, h('span', { class: 'd-muted' }, '[database location]/'), path, save)), h('td', {}, ...fields), h('td', {}, del));
  });
  const newPath = h('input', { placeholder: 'Files/Attachments/', class: 'd-code', 'aria-label': 'New base directory' });
  const add = h('form', { class: 'd-row' }, newPath, h('button', { type: 'submit' }, 'Add base directory'));
  add.addEventListener('submit', (e) => {
    e.preventDefault();
    if (newPath.value.trim()) void studio.apply([{ op: 'createContainerDirectory', path: newPath.value }], 'Base directory added');
  });
  return h('section', { class: 'd-main' },
    h('h2', {}, 'Containers'),
    h('p', {}, `Tabularius keeps every container file in the database${data ? `: ${data.files} file${data.files === 1 ? '' : 's'}, ${size(data.bytes)}` : ''}. ` +
      'Base directories and each field\'s "store externally" setting are kept for FileMaker, as Manage Containers has them; set a field\'s storage in its options.'),
    h('h3', {}, 'Base directories'),
    h('table', { class: 'd-grid' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Path'), h('th', {}, 'Fields stored here'), h('th', {}, ''))), h('tbody', {}, ...rows)),
    add,
    h('p', { class: 'd-muted' }, 'Thumbnails are made by the server when a picture or PDF is shown, and kept in memory.'),
  );
}

/** "Try it": the formula as it is in the box, with a value for each parameter. */
function tryFunction(studio: Studio, name: string, parameters: () => string[], formula: HTMLTextAreaElement, js: () => boolean): HTMLElement {
  const inputs = h('div', { class: 'd-stack' });
  const result = h('p', { class: 'd-formula-msg', role: 'status', hidden: '' });
  const values = new Map<string, HTMLInputElement>();
  const fill = () => {
    inputs.replaceChildren(...parameters().map((p) => {
      const input = values.get(p) ?? h('input', { placeholder: 'A formula, e.g. "text" or 42', 'aria-label': `Value for ${p}`, class: 'd-code' });
      values.set(p, input);
      return field(p, input);
    }));
  };
  fill();
  const run = async () => {
    const ps = parameters();
    // Unsaved edits run as written: the parameters become Let names around the body. A JavaScript function runs as saved.
    const binds = ps.map((p) => `${p} = ( ${values.get(p)?.value.trim() || '""'} )`);
    const args = ps.map((p) => values.get(p)?.value.trim() || '""');
    const text = js() ? `${name} ( ${args.join(' ; ')} )` : ps.length ? `Let ( [ ${binds.join(' ; ')} ] ; ${formula.value} )` : formula.value;
    result.hidden = false;
    result.classList.remove('error');
    try {
      const r = await studio.client.evaluate(text);
      result.textContent = r.value === '' ? '(empty)' : r.value;
    } catch (e) {
      result.classList.add('error');
      result.textContent = errorText(e);
    }
  };
  return h('details', { class: 'd-report' }, h('summary', {}, `Try ${name}`),
    h('div', { class: 'd-stack' }, inputs, h('div', { class: 'd-actions' }, button('Run', () => void run()), button('Refresh parameters', fill, { class: 'quiet' })), result));
}

/** Where something is used, loaded when opened. */
function usedIn(studio: Studio, name: string, kind: string): HTMLElement {
  const list = h('ul', {});
  const box = h('details', { class: 'd-report' }, h('summary', {}, 'Used in'), list);
  box.addEventListener('toggle', async () => {
    if (!box.open || list.childElementCount) return;
    try {
      const uses = await studio.client.used(name, kind);
      list.replaceChildren(...(uses.length ? uses.map((u) => h('li', {}, h('strong', {}, u.where), h('br'), h('code', {}, u.text))) : [h('li', { class: 'd-muted' }, 'Not used anywhere.')]));
    } catch (e) {
      list.replaceChildren(h('li', {}, errorText(e)));
    }
  });
  return box;
}

// ---------------------------------------------------------------- history

/** A change in words, naming things as they are now. */
function describe(studio: Studio, c: Change): string {
  const d = studio.design;
  const table = (id: unknown) => d.tables.find((t) => t.id === id)?.name ?? `table ${id}`;
  const fieldName = (t: unknown, f: unknown) => d.tables.find((x) => x.id === t)?.fields.find((x) => x.id === f)?.name ?? `field ${f}`;
  const to = (id: unknown) => d.tableOccurrences.find((t) => t.id === id)?.name ?? `occurrence ${id}`;
  const named = (c.name as string | undefined) ? ` "${c.name}"` : '';
  switch (c.op) {
    case 'createTable': return `Created table${named}`;
    case 'renameTable': return `Renamed table to${named}`;
    case 'deleteTable': return `Deleted ${table(c.table)}`;
    case 'createField': return `Added field ${table(c.table)}::${c.name}`;
    case 'updateField': return `Changed field ${table(c.table)}::${fieldName(c.table, c.field)}`;
    case 'deleteField': return `Deleted a field of ${table(c.table)}`;
    case 'restoreDeleted': return 'Restored a deleted table or field';
    case 'createOccurrence': return `Added occurrence${named}`;
    case 'updateOccurrence': return c.graph && Object.keys(c).length === 3 ? `Moved ${to(c.occurrence)} on the graph` : `Changed occurrence ${to(c.occurrence)}`;
    case 'deleteOccurrence': return 'Deleted an occurrence';
    case 'createRelationship': return `Related ${to(c.left)} to ${to(c.right)}`;
    case 'updateRelationship': return `Changed the relationship ${to(c.left)} – ${to(c.right)}`;
    case 'deleteRelationship': return 'Deleted a relationship';
    default: return `${c.op.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (x) => x.toUpperCase())}${named}`;
  }
}

export async function historyTab(studio: Studio): Promise<HTMLElement> {
  let entries;
  try {
    entries = await studio.client.history();
  } catch (e) {
    return h('p', { class: 'd-muted' }, errorText(e));
  }
  if (!entries.length) return h('section', { class: 'd-main' }, h('p', { class: 'd-muted' }, 'No design changes yet. Changes made here, by scripts or by AI are listed with who made them.'));
  const rows = entries.reverse().map((e) => h('tr', {},
    h('td', { class: 'd-muted' }, new Date(e.at).toLocaleString()),
    h('td', {}, e.account ?? ''),
    h('td', {}, describe(studio, e.op)),
  ));
  return h('section', { class: 'd-main' },
    h('h2', {}, 'Design history'),
    h('table', { class: 'd-grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'Change'))), h('tbody', {}, ...rows)));
}
