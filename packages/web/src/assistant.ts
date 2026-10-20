// The AI assistant panel, in browse and design mode: ask about the file, the
// layout or the record; explain a calculation or script; draft one. Design
// changes it proposes are shown with an Apply button and change nothing until
// a person with [Full Access] applies them.

import { renderChart } from './chart.ts';
import { webViewer } from './layout.ts';
import { modernPage } from './page-source.ts';
import { automationCard, type AutomationOut } from './automation-view.ts';
import { connectionCard } from './connection-card.ts';
import { cleanupCard, type CleanupScan } from './cleanup-view.ts';
import { agentPlanCard, type AgentPlan } from './agent-view.ts';
import { renderWidget, type Widget, type WidgetData } from './dashboard-view.ts';
import { httpProblem } from './http-problem.ts';
import { chatUsage, classifyError, confirmAction, destructiveChanges, ownerOf, toolView, type ChatError, type ToolStep } from './assistant-chat.ts';

export interface AssistantContext {
  layout?: string;
  recordId?: number;
  /** The field the cursor is in, as the Data API names it. */
  field?: string;
  mode?: 'browse' | 'find' | 'design' | 'debug' | 'security' | 'viewer';
  /** In Manage Security: the tab and the account or privilege set selected on it. */
  security?: { tab: string; selection?: { kind: 'account' | 'privilege set'; name: string }[] };
  /** In the script debugger: where the script is paused (or how it ended). */
  debug?: { script: string; step?: number; line?: string; lastError?: number; stack?: string[]; variables?: Record<string, string>; finished?: boolean; result?: string; message?: string };
  /** In design mode: the tab and what is selected on it. */
  design?: { tab: string; selection?: { kind: string; name: string }[] };
  foundSet?: { query?: unknown; sort?: unknown; foundCount: number; recordIds?: number[] };
  /** In design mode: the formula box or script editor a draft is wanted for (contextTo: the table occurrence it is evaluated from). */
  draft?: DraftTarget;
}

export interface DraftTarget {
  kind: 'calculation' | 'script' | 'function';
  for: string;
  contextTo?: number;
}

/** A drafted formula or script, checked by the server, for the editor it was asked from. */
interface Draft {
  kind: DraftTarget['kind'];
  text: string;
  summary: string;
  /** A custom function's parameters. */
  parameters?: string[];
  /** A drafted script's run on a throwaway copy of the file, offline. */
  dryRun?: DraftDryRun;
  /** A drafted script's linter findings. */
  lint?: { line: number; severity: string; message: string }[];
  /** A drafted calculation's results on a few records (nothing stored). */
  samples?: { layout: string; results: { recordId: number; value?: string; error?: string }[] };
}

interface DraftDryRun {
  outcome: 'ok' | 'error' | 'stalled' | 'skipped'; error?: number; steps?: number; layout?: string; step?: string; message?: string;
  /** The records the run created, changed or deleted on the copy, field by field (a script draft's only). */
  changes?: { records: { table: string; recordId: number; kind: 'create' | 'update' | 'delete'; fields: { field: string; before: string; after: string }[] }[]; more?: number; truncated: { table: string; records: number }[]; incomplete?: boolean };
}

/** What a draft's dry run did to records on the copy: a row per field, before and after. */
function dryRunChanges(c: NonNullable<DraftDryRun['changes']>): HTMLElement[] {
  const kind = { create: 'new', update: 'changed', delete: 'deleted' } as const;
  const shown = (v: string) => (v === '' ? '(empty)' : v);
  const rows = c.records.flatMap((r) => (r.fields.length ? r.fields : [{ field: '', before: '', after: '' }]).map((f, i) => h('tr', {},
    h('th', { scope: 'row' }, i ? '' : `${r.table} ${r.recordId} (${kind[r.kind]})`),
    h('td', {}, f.field),
    h('td', { class: 'ai-before' }, r.kind === 'create' || !f.field ? '' : shown(f.before)),
    h('td', {}, r.kind === 'delete' || !f.field ? '' : shown(f.after)))));
  const notes = [
    ...c.truncated.map((t) => `Emptied ${t.table} (${t.records} record${t.records === 1 ? '' : 's'}).`),
    ...(c.more ? [`And ${c.more} more record${c.more === 1 ? '' : 's'}.`] : []),
    ...(c.incomplete ? ['It wrote more than could be read back; these are the first changes.'] : []),
  ];
  return [
    h('div', { class: 'ai-note' }, 'What it did to records on the copy:'),
    ...(rows.length ? [h('table', { class: 'ai-samples ai-changes' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Record'), h('th', { scope: 'col' }, 'Field'), h('th', { scope: 'col' }, 'Before'), h('th', { scope: 'col' }, 'After'))),
      h('tbody', {}, ...rows))] : []),
    ...notes.map((n) => h('div', { class: 'ai-note' }, n)),
  ];
}

/** A dry run in a line, for the draft card. */
function dryRunNote(r: DraftDryRun): { text: string; bad: boolean } {
  const where = r.layout ? ` from ${r.layout}` : '';
  const steps = `${r.steps} step${r.steps === 1 ? '' : 's'}`;
  if (r.outcome === 'skipped') return { text: `Not test run: ${r.message ?? 'skipped'}.`, bad: false };
  if (r.outcome === 'ok') return { text: `Test run on a copy of the file, offline: ran ${steps}${where} with no errors. The copy was thrown away.`, bad: false };
  if (r.outcome === 'stalled') return { text: `Test run on a copy of the file stopped after ${steps}${where}, at ${r.step ?? 'an unknown step'}. Check for a loop that never exits.`, bad: true };
  return { text: `Test run on a copy of the file ended with error ${r.error}${r.step ? ` at ${r.step}` : ''}${r.message ? ` (${r.message})` : ''}.`, bad: true };
}

/**
 * The conversation as kept for the browser tab. Proposed layouts' designs are for their pictures, and too big to
 * keep. A dry run's record values (an object, where a proposal's design changes are a list) aren't kept either: the
 * next account to sign in on this tab may not be allowed to see them.
 */
export function keptForTab(messages: unknown[]): string {
  return JSON.stringify(messages, (k, v) => {
    if ((k === 'layouts' && Array.isArray(v)) || (k === 'changes' && v && typeof v === 'object' && !Array.isArray(v))) return undefined;
    // What a tool was asked and answered is the file's data: only the line about it is kept.
    if (k === 'tools' && Array.isArray(v) && v.every((t) => t && typeof t === 'object' && 'label' in t)) return v.map((t: ToolStep) => ({ label: t.label, ...(t.error ? { error: true } : {}) }));
    return v;
  });
}

/** Puts a draft in the editor it was asked from. */
export type UseDraft = (text: string, parameters?: string[]) => void;

interface Proposal {
  summary: string;
  changes: Record<string, unknown>[];
  /** What the changes do, one line each. */
  preview?: string[];
  dryRuns?: { script: string; run: DraftDryRun }[];
  /** Layouts the changes make or change, as they would be (design mode draws them). */
  layouts?: ProposalLayout[];
}

/** A layout as a proposal would make it, with Check's findings on it. */
export interface ProposalLayout {
  id: number;
  name: string;
  design: import('./types.ts').LayoutDesign;
  before?: import('./types.ts').LayoutDesign;
  issues: { rule: string; severity: 'error' | 'warning' | 'info'; objectIds: number[]; message: string }[];
}

/** Applies proposed design changes: false when they weren't made, else what takes them back (when they only added things). */
export type ApplyChanges = (changes: Record<string, unknown>[]) => Promise<false | { undo?: Record<string, unknown>[] }>;

/** Where a script that stopped with an error ran, and how it ended. */
export interface ScriptFailureContext { script: string; error: number; message?: string; layout?: string; recordId?: number; parameter?: string }

export interface FoundSet {
  layout: string;
  query: Record<string, string | number | boolean>[];
  sort?: { fieldName: string; sortOrder?: string }[];
  foundCount: number;
  summary: string;
}

/** A chart the assistant drew from the data: a found set grouped by a field. */
interface ChartOut {
  type: 'column' | 'bar' | 'line' | 'pie';
  title: string;
  layout: string;
  xTitle: string;
  yTitle: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  groupCount?: number;
}

/** A dashboard the assistant built, worked out from the data; saved only when the person saves it. */
interface DashboardOut {
  name: string;
  description?: string;
  widgets: Widget[];
  data: WidgetData[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** The name of a picture sent with the question (a layout to copy); the picture itself isn't kept. */
  picture?: string;
  proposals?: Proposal[];
  foundSets?: FoundSet[];
  drafts?: Draft[];
  charts?: ChartOut[];
  dashboards?: DashboardOut[];
  cleanups?: { summary: string; scan: CleanupScan }[];
  automations?: AutomationOut[];
  connections?: { name: string }[];
  plans?: { plan: AgentPlan; lines: string[] }[];
  /** Tokens the answer used, for keeping an eye on the API bill. */
  usage?: { inputTokens: number; cachedTokens: number; outputTokens: number; costUsd?: number };
  /** Puts a draft in the editor it was asked from (not kept across reloads; the draft is still shown to copy). */
  use?: UseDraft;
  /** What the assistant did to answer, one entry per tool call (the arguments and results are not kept across a reload). */
  tools?: ToolStep[];
  /** A failed exchange: shown, but not sent back to the model. */
  failed?: boolean;
  /** Why it failed, when that is known. */
  error?: ChatError;
}

const enc = encodeURIComponent;
/** A cost in dollars: cents for most, more places for the fractions of a cent a short answer costs. */
const dollars = (usd: number) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

/** Whether this server and account have the assistant, and whether the account can apply design changes. */
export async function assistantInfo(db: string, token: string): Promise<{ available: boolean; canDesign: boolean; canExplainScripts: boolean }> {
  try {
    const r = await fetch(`/tabularius/assistant/v1/databases/${enc(db)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return { available: false, canDesign: false, canExplainScripts: false };
    const body = await r.json();
    return { available: !!body.available, canDesign: !!body.canDesign, canExplainScripts: !!body.canExplainScripts };
  } catch {
    return { available: false, canDesign: false, canExplainScripts: false };
  }
}

/** Inline markdown the model uses: `code` and **bold**. */
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  // A citation of the field a fact came from: [Invoices::Total #12] (a related record) or [Customers::Name].
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\[\]:]+::[^\[\]#]+?)(?: #(\d+))?\]/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? h('code', {}, m[1]) : m[2] !== undefined ? h('strong', {}, m[2])
      : h('span', { class: 'ai-cite', title: m[4] ? `${m[3]}, related record ${m[4]}` : m[3] }, m[3].replace(/^.*::/, '') + (m[4] ? ` #${m[4]}` : '')));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A markdown table: header, separator, rows; numbers right-aligned. */
function table(lines: string[]): HTMLElement {
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const align = cells(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
  const rows = lines.slice(2).map(cells);
  const numeric = head.map((_, i) => rows.length > 0 && rows.every((r) => /^[-+]?[$€£]?[\d,.]+%?$/.test(r[i] ?? '') || !r[i]));
  const style = (i: number): Record<string, string> => {
    const a = align[i] || (numeric[i] ? 'right' : '');
    return a ? { class: `ai-${a}` } : {};
  };
  return h('div', { class: 'ai-table' }, h('table', {},
    h('thead', {}, h('tr', {}, ...head.map((c, i) => h('th', style(i), ...inline(c))))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...head.map((_, i) => h('td', style(i), ...inline(r[i] ?? '')))))),
  ));
}

/** Paragraphs, bullet and numbered lists, tables and fenced code blocks (with a Copy button), built as DOM, never as HTML. */
export function renderText(text: string): HTMLElement {
  const box = h('div', { class: 'ai-text' });
  const parts = text.split(/```[^\n]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/\n$/, '');
      const copy = h('button', { type: 'button', class: 'ai-copy' }, 'Copy');
      copy.addEventListener('click', () => void navigator.clipboard?.writeText(code).then(() => (copy.textContent = 'Copied')));
      box.append(h('div', { class: 'ai-code' }, copy, h('pre', {}, code)));
      return;
    }
    for (const para of part.split(/\n{2,}/)) {
      const lines = para.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      // A heading line starts its own block.
      const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
      if (heading) {
        box.append(h(heading[1].length <= 1 ? 'h3' : 'h4', {}, ...inline(heading[2])));
        lines.shift();
        if (!lines.length) continue;
      }
      if (lines.every((l) => /^\s*[-*] /.test(l))) {
        box.append(h('ul', {}, ...lines.map((l) => h('li', {}, ...inline(l.replace(/^\s*[-*] /, ''))))));
      } else if (lines.every((l) => /^\s*\d+[.)] /.test(l))) {
        box.append(h('ol', {}, ...lines.map((l) => h('li', {}, ...inline(l.replace(/^\s*\d+[.)] /, ''))))));
      } else if (lines.length >= 2 && lines.every((l) => l.trim().startsWith('|')) && /^\s*\|?\s*:?-{2,}/.test(lines[1])) {
        box.append(table(lines));
      } else {
        const p = h('p', {});
        lines.forEach((l, n) => p.append(...(n ? [h('br'), ...inline(l.replace(/^#+\s*/, ''))] : inline(l.replace(/^#+\s*/, '')))));
        box.append(p);
      }
    }
  });
  return box;
}

/** "Ask about this record": a summary of the record with its related records, citing the fields it used. */
export const ABOUT_RECORD = 'Summarize this record and its related records';

/** Starting questions for where the person is; `full` ([Full Access]) adds ones only it can ask, like who changed a record. */
export function suggestions(c: AssistantContext, full = false): string[] {
  switch (c.mode) {
    case 'design': return ['Explain how this file fits together', 'What won\'t work yet after the conversion?', 'Which scripts send email or call outside services?', 'What changed in the design recently, and who changed it?', 'Which finds are slow, and what would speed them up?', 'Draft a script that marks overdue records'];
    case 'debug': return ['What does this script do?', 'Why did the last step fail?', 'What are the variables set to, and why?'];
    case 'security': return ['Review the security of this file: what is risky?', 'Explain what each privilege set can do',
      'Which accounts can use AI or the Data API?', 'Which accounts have no password or no second factor?'];
    case 'viewer': return ['What could I watch on this layout to understand it?', 'Draft an expression that lists the related records\' names',
      'Which global variables are set, and what sets them?'];
    case 'find': return ['What can I search for on this layout?', 'Find records changed this week'];
    default: return [
      ...(c.field ? [`Explain the field ${c.field}: where its value comes from and what uses it`] : []),
      'What does this layout show?',
      ...(c.foundSet && c.foundSet.foundCount > 1 ? [`Summarize these ${c.foundSet.foundCount} records`] : []),
      ...(c.recordId !== undefined ? [ABOUT_RECORD, 'What stands out about this record?'] : []),
      ...(c.recordId !== undefined && full ? ['What changed on this record, who changed it, and why?'] : []),
      'Which scripts can I run here, and what do they do?',
    ];
  }
}

/** A chart the assistant drew, as SVG, with a note when it shows only the largest groups. */
function chartCard(c: ChartOut): HTMLElement {
  const box = h('figure', { class: 'ai-chart' });
  try {
    box.append(renderChart({ type: c.type, source: 'found-set', title: c.title, xTitle: c.xTitle, yTitle: c.yTitle, series: [{ data: '' }] },
      { title: c.title, xTitle: c.xTitle, yTitle: c.yTitle, categories: c.categories, series: c.series }, 340, 230));
  } catch {
    box.append(h('p', {}, `(Couldn't draw the chart "${c.title}")`));
  }
  box.append(h('figcaption', {}, `${c.layout}${c.groupCount ? ` · ${c.categories.length} of ${c.groupCount} groups` : ''}`));
  return box;
}

/** Puts text on the clipboard; over plain http (no Clipboard API) through a hidden text box. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' }) as HTMLTextAreaElement;
    box.value = text;
    document.body.append(box);
    box.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      box.remove();
    }
  }
}

export class AssistantPanel {
  readonly element = h('aside', { class: 'ai-panel', 'aria-label': 'AI assistant', hidden: '' });
  // The log is redrawn as an answer streams in, so it isn't live (it would be read out again and
  // again); the finished answer is said once through `said`.
  private readonly log = h('div', { class: 'ai-log' });
  private readonly said = h('div', { class: 'sr-only', role: 'status' });
  /** Failures, said at once. */
  private readonly alerts = h('div', { class: 'sr-only', role: 'alert' });
  /** What the conversation has used so far, from the server's counters. */
  private readonly chatTotal = h('div', { class: 'ai-chat-total', hidden: '' });
  private readonly input = h('textarea', { class: 'ai-input', rows: '3', placeholder: 'Ask about this file, layout or record…', 'aria-label': 'Question' });
  private readonly send = h('button', { type: 'button', class: 'primary' }, 'Ask');
  /** A picture to send with the next question (design: "make a layout like this"), and the chip showing it. */
  private picture?: { name: string; mediaType: string; data: string };
  private readonly pictureChip = h('div', { class: 'ai-picture', hidden: '' });
  private readonly pictureButton = h('button', { type: 'button', class: 'quiet', title: 'Send a screenshot or sketch of a layout with your question', hidden: '' }, 'Add picture');
  /** The server's token use today, for [Full Access] (who looks after the bill). */
  private readonly today = h('div', { class: 'ai-today', hidden: '' });
  private readonly messages: Message[] = [];
  private busy = false;
  /** The account has [Full Access] (from the server): it may ask about the audit log and design history. */
  private full = false;
  /** Stops the question being answered (the Stop button); the server stops calling the model. */
  private stopper?: AbortController;
  /** What the assistant has done so far for the question being answered: a line per tool call, running until its result comes. */
  private trace: { step: ToolStep; running: boolean }[] = [];
  /** The answer so far, while it streams in, and the boxes it is shown in. */
  private partial = '';
  private live?: HTMLElement;
  private toolsBox?: HTMLElement;
  private waiting?: HTMLElement;
  private readonly db: string;
  private readonly token: string;
  private readonly context: () => AssistantContext;
  private readonly apply?: ApplyChanges;
  /** Applies the changes that take an applied proposal back; true when they were made. */
  private readonly undo?: (changes: Record<string, unknown>[]) => Promise<boolean>;
  /** Shows a found set the assistant found in the window (browse mode). */
  show?: (found: FoundSet) => Promise<void>;
  /** A dashboard the person saved from the panel (the dashboards page shows it). */
  onDashboardSaved?: (id: string) => void;
  /** A picture of a layout a proposal makes or changes (design mode). */
  layoutPicture?: (layout: ProposalLayout) => Promise<HTMLElement>;
  /** Opens a layout in the layout editor, after a proposal that made or changed it is applied (design mode). */
  openLayout?: (layout: ProposalLayout) => void;
  /** Opens Find mode on a layout with the requests filled in, to change and perform there; `words` names the find. */
  editFind?: (layout: string, requests: FoundSet['query'], words?: string) => Promise<void>;

  constructor(db: string, token: string, context: () => AssistantContext, apply?: ApplyChanges, undo?: (changes: Record<string, unknown>[]) => Promise<boolean>) {
    this.db = db;
    this.token = token;
    this.context = context;
    this.apply = apply;
    this.undo = undo;
    const close = h('button', { type: 'button', class: 'quiet', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    const clear = h('button', { type: 'button', class: 'quiet ai-new', title: 'Start a new conversation' }, 'New chat');
    clear.addEventListener('click', () => {
      if (this.busy) return;
      this.messages.length = 0;
      this.said.textContent = this.alerts.textContent = '';
      this.failure = undefined;
      this.picture = undefined;
      this.notePicture();
      this.save();
      this.renderLog();
      this.input.focus();
    });
    this.send.addEventListener('click', () => (this.busy ? this.stopper?.abort() : void this.ask()));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.ask();
      } else if (e.key === 'Escape' && this.busy) {
        // Stops the answer from the keyboard, without leaving the box.
        e.preventDefault();
        this.stopper?.abort();
      }
    });
    // Pictures: picked, or pasted into the question box (people with design access, for layouts from a screenshot or sketch).
    const picker = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: '' }) as HTMLInputElement;
    this.pictureButton.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => {
      if (picker.files?.[0]) void this.takePicture(picker.files[0]);
      picker.value = '';
    });
    this.input.addEventListener('paste', (e) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file || !this.full) return;
      e.preventDefault();
      void this.takePicture(file);
    });
    this.element.append(
      h('header', { class: 'ai-header' }, h('strong', {}, 'Assistant'), h('span', { class: 'ai-note' }, 'Reads only; never runs scripts'), clear, close),
      this.today,
      this.log,
      this.chatTotal,
      this.pictureChip,
      h('div', { class: 'ai-compose' }, this.input, h('div', { class: 'ai-compose-actions' }, this.send, this.pictureButton, picker)),
      this.said,
      this.alerts,
    );
    this.restore();
    this.renderLog();
  }

  /** The conversation is kept for the browser tab, per file, so a reload or a trip to Design doesn't lose it. */
  private get storageKey(): string {
    return `tabularius.assistant.${this.db}`;
  }

  /** Only the sign-in that had the conversation gets it back: a conversation kept for another (or from before sign-in was recorded) is not shown. */
  private restore(): void {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.storageKey) ?? 'null');
      if (saved && !Array.isArray(saved) && saved.owner === ownerOf(this.token) && Array.isArray(saved.messages)) {
        this.messages.push(...(saved.messages as Message[]).filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').slice(-40));
      } else if (saved) sessionStorage.removeItem(this.storageKey);
    } catch {
      // Nothing saved, or storage is off.
    }
  }

  private save(): void {
    try {
      sessionStorage.setItem(this.storageKey, `{"owner":${JSON.stringify(ownerOf(this.token))},"messages":${keptForTab(this.messages.slice(-40))}}`);
    } catch {
      // Storage full or off: the conversation just isn't kept.
    }
  }

  toggle(open = this.element.hidden): void {
    // Closing it with focus inside: focus goes back to the button that opens it.
    const refocus = !open && this.element.contains(document.activeElement);
    this.element.hidden = !open;
    for (const b of document.querySelectorAll('.ai-button')) b.setAttribute('aria-expanded', String(open));
    if (refocus) document.querySelector<HTMLElement>('.ai-button')?.focus();
    if (open) {
      void this.refreshUsage();
      // The starting questions follow where the person is now.
      if (!this.messages.length && !this.busy) this.renderLog();
      this.input.focus();
    }
  }

  private renderLog(follow = false): void {
    if (!this.messages.length) {
      // Questions to start from, for where the person is; a click asks one.
      let context: AssistantContext = {};
      try {
        context = this.context();
      } catch {
        // The window isn't ready yet: general questions.
      }
      const chips = suggestions(context, this.full).map((q) => {
        const b = h('button', { type: 'button', class: 'ai-chip' }, q);
        b.addEventListener('click', () => void this.askAbout(q));
        return b;
      });
      this.log.replaceChildren(h('p', { class: 'ai-hint' }, 'Ask about this file in your own words, or start with:'), h('div', { class: 'ai-chips' }, ...chips));
      return;
    }
    const stick = follow || this.nearBottom();
    const top = this.log.scrollTop;
    this.log.replaceChildren(...this.messages.map((m, i) => this.messageEl(m, i)));
    if (this.busy) this.log.append(this.pendingBubble());
    else this.toolsBox = this.live = this.waiting = undefined;
    // Follow the answer only while the person is at the bottom: reading further up stays where it is.
    this.log.scrollTop = stick ? this.log.scrollHeight : top;
    this.drawTotal();
  }

  private nearBottom(): boolean {
    return this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 30;
  }

  /** What the whole conversation has used, from the counters the server sent with each answer. */
  private drawTotal(): void {
    const u = chatUsage(this.messages);
    this.chatTotal.hidden = !u;
    if (!u) return;
    const n = (x: number) => x.toLocaleString();
    this.chatTotal.textContent = `This chat: ${u.answers} answer${u.answers === 1 ? '' : 's'}, ${n(u.inputTokens)} tokens in${u.cachedTokens ? ` (${n(u.cachedTokens)} cached)` : ''}, ${n(u.outputTokens)} out${u.costUsd !== undefined ? ` · ${dollars(u.costUsd)}` : ''}`;
  }

  /** The line shown while a question is being answered: what it has done so far, and the answer as it is written. */
  private pendingBubble(): HTMLElement {
    const bubble = h('div', { class: 'ai-msg ai-assistant ai-thinking', 'aria-busy': 'true' });
    this.waiting = h('div', { class: 'ai-waiting' }, 'Looking into it…');
    this.toolsBox = h('ol', { class: 'ai-tools', 'aria-label': 'What the assistant is doing' });
    this.live = h('div', { class: 'ai-live' });
    this.traceEls = [];
    if (this.partial) this.live.append(renderText(this.partial));
    bubble.append(this.waiting, this.toolsBox, this.live);
    this.drawTrace();
    return bubble;
  }

  private traceEls: HTMLElement[] = [];
  /** The tool calls so far, each drawn once and redrawn only when its result arrives (so one the person opened stays open). */
  private drawTrace(changed?: number): void {
    if (!this.toolsBox) return;
    this.trace.forEach((t, i) => {
      if (this.traceEls[i] && i !== changed) return;
      const el = toolView(t.step, t.running, (text) => void copyText(text));
      if (this.traceEls[i]) this.traceEls[i].replaceWith(el);
      else this.toolsBox!.append(el);
      this.traceEls[i] = el;
    });
    this.toolsBox.hidden = !this.trace.length;
    if (this.waiting) this.waiting.hidden = !!this.trace.length || !!this.partial;
  }

  private messageEl(m: Message, i: number): HTMLElement {
    const el = h('div', { class: `ai-msg ai-${m.role}${m.error ? ' ai-failed' : ''}` });
    if (m.error) {
      el.append(h('div', { class: `ai-error ai-error-${m.error.kind}` },
        h('strong', {}, m.error.title),
        h('p', {}, m.content),
        ...(m.error.hint ? [h('p', { class: 'ai-note' }, m.error.hint)] : [])));
    } else el.append(m.role === 'user' ? h('p', {}, m.content) : renderText(m.content));
    if (m.picture) el.append(h('p', { class: 'ai-note' }, `With a picture: ${m.picture}`));
    if (m.tools?.length) {
      el.append(h('details', { class: 'ai-did' },
        h('summary', {}, `${m.tools.length} step${m.tools.length === 1 ? '' : 's'} the assistant took`),
        h('ol', { class: 'ai-tools' }, ...m.tools.map((t) => toolView(t, false, (text) => void copyText(text))))));
    }
    for (const f of m.foundSets ?? []) el.append(this.foundSet(f));
    for (const p of m.proposals ?? []) el.append(this.proposal(p));
    for (const d of m.drafts ?? []) el.append(this.draft(d, m.use));
    for (const c of m.charts ?? []) el.append(chartCard(c));
    for (const d of m.dashboards ?? []) el.append(this.dashboard(d));
    for (const c of m.cleanups ?? []) el.append(cleanupCard(c.scan, this.db, this.token, c.summary));
    for (const a of m.automations ?? []) el.append(automationCard(a, this.db, this.token));
    for (const c of m.connections ?? []) el.append(connectionCard(c, this.db, this.token));
    for (const p of m.plans ?? []) el.append(agentPlanCard(p.plan, p.lines, this.db, this.token));
    const last = i === this.messages.length - 1 && !this.busy;
    if (m.role === 'assistant' && last) {
      const actions = h('div', { class: 'ai-actions' });
      // Copy the answer as written (markdown), to paste into an email, a ticket or a script comment.
      if (!m.failed && m.content.trim()) {
        const copy = h('button', { type: 'button', class: 'ai-again ai-copy-answer', title: 'Copy this answer' }, 'Copy');
        copy.addEventListener('click', () => void copyText(m.content).then((ok) => {
          copy.textContent = ok ? 'Copied' : 'Couldn\'t copy';
          setTimeout(() => (copy.textContent = 'Copy'), 1500);
        }));
        actions.append(copy);
      }
      // Ask the same question again: after a failure or a stop, or for another try at an answer.
      if (this.messages[i - 1]?.role === 'user' && (!m.error || m.error.retry)) {
        const again = h('button', { type: 'button', class: 'ai-again' }, m.failed ? 'Try again' : 'Ask again');
        again.addEventListener('click', () => void this.retry());
        actions.append(again);
      }
      if (actions.childElementCount) el.append(actions);
    }
    if (m.usage) {
      const n = (x: number) => x.toLocaleString();
      el.append(h('div', { class: 'ai-usage', title: 'Tokens this answer used: input (cached input costs a tenth) and output, and what they cost at the model\'s list price' },
        `${n(m.usage.inputTokens)} tokens in${m.usage.cachedTokens ? ` (${n(m.usage.cachedTokens)} cached)` : ''}, ${n(m.usage.outputTokens)} out${m.usage.costUsd !== undefined ? ` · ${dollars(m.usage.costUsd)}` : ''}`));
    }
    return el;
  }

  /** Asks the last question again: the answer to it (or the failure) goes, and the question is asked as it was. */
  private async retry(): Promise<void> {
    if (this.busy) return;
    while (this.messages.length && this.messages.at(-1)!.role === 'assistant') this.messages.pop();
    const question = this.messages.pop();
    if (question?.role !== 'user') return;
    this.input.value = question.content;
    await this.ask();
  }

  /** Keeps a picture for the next question: PNG, JPEG, GIF or WebP up to 5 MB, as the model takes them. */
  private async takePicture(file: File): Promise<void> {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return this.notePicture('Pictures are PNG, JPEG, GIF or WebP.');
    if (file.size > 3.75 * 1024 * 1024) return this.notePicture('That picture is over 3.7 MB; send a smaller one.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    this.picture = { name: file.name || 'picture', mediaType: file.type, data: btoa(bin) };
    this.notePicture();
    if (!this.input.value.trim()) this.input.value = 'Make a layout like this picture';
    this.input.focus();
  }

  /** The chip over the question box: the picture going with it (with a way to take it off), or why it can't. */
  private notePicture(problem?: string): void {
    this.pictureChip.replaceChildren();
    this.pictureChip.hidden = !problem && !this.picture;
    if (problem) return void this.pictureChip.append(h('span', { class: 'ai-note' }, problem));
    if (!this.picture) return;
    const remove = h('button', { type: 'button', class: 'quiet', 'aria-label': 'Take the picture off' }, '×');
    remove.addEventListener('click', () => {
      this.picture = undefined;
      this.notePicture();
    });
    this.pictureChip.append(h('span', {}, `Picture: ${this.picture.name}`), remove);
  }

  /** Today's token use on the server and its daily limit; only [Full Access] is told. */
  private async refreshUsage(): Promise<void> {
    try {
      const r = await fetch(`/tabularius/assistant/v1/databases/${enc(this.db)}`, { headers: { authorization: `Bearer ${this.token}` } });
      const info = r.ok ? await r.json() as { canDesign?: boolean; usageToday?: { tokens: number; limit?: number }; usageMonth?: { costUsd: number; questions: number; unpriced: number; budgetUsd?: number }; accountUsageToday?: { tokens: number; limit: number } } : {};
      this.pictureButton.hidden = !info.canDesign;
      if (!!info.canDesign !== this.full) {
        this.full = !!info.canDesign;
        if (!this.messages.length && !this.busy) this.renderLog();
      }
      const u = info.usageToday, mine = info.accountUsageToday, month = info.usageMonth;
      if (!u && !mine) return;
      const n = (x: number) => x.toLocaleString();
      // [Full Access] sees the server's day; with a per-account limit, everyone sees their own.
      const parts = [
        ...(u ? [`Today: ${n(u.tokens)}${u.limit ? ` of ${n(u.limit)}` : ''} tokens`] : []),
        ...(mine ? [`${u ? 'you' : 'Today'}: ${n(mine.tokens)} of ${n(mine.limit)}${u ? '' : ' tokens'}`] : []),
        ...(month ? [`this month ${dollars(month.costUsd)}${month.budgetUsd ? ` of ${dollars(month.budgetUsd)}` : ''}`] : []),
      ];
      this.today.textContent = parts.join('; ');
      this.today.classList.toggle('ai-near', !!u?.limit && u.tokens >= u.limit * 0.8 || !!mine && mine.tokens >= mine.limit * 0.8 || !!month?.budgetUsd && month.costUsd >= month.budgetUsd * 0.8);
      this.today.title = [
        ...(u ? [u.limit ? 'Tokens the assistant used on this server today (UTC), and the daily limit (--ai-daily-tokens)' : 'Tokens the assistant used on this server today (UTC); no daily limit is set'] : []),
        ...(mine ? ['Tokens your account used today, and its daily limit (--ai-account-daily-tokens)'] : []),
        ...(month ? [`What the assistant cost on this server this month (UTC) at list prices, over ${n(month.questions)} question${month.questions === 1 ? '' : 's'}${month.budgetUsd ? ', and the monthly budget (--ai-monthly-budget)' : ''}${month.unpriced ? `; ${n(month.unpriced)} used a model with no known price and aren't counted` : ''}`] : []),
      ].join('. ');
      this.today.hidden = false;
    } catch {
      // Usage is a convenience; the panel works without it.
    }
  }

  /** The answer as it is written: only its own box is redrawn. */
  private renderPartial(): void {
    if (!this.live) return this.renderLog();
    const stick = this.nearBottom();
    this.live.replaceChildren(renderText(this.partial));
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }

  private foundSet(f: FoundSet): HTMLElement {
    // The find requests are shown, and can be changed here before showing the records (the server still runs
    // the find as the signed-in account, so changing them can't reach records it may not view).
    const query = f.query.map((r) => ({ ...r }));
    let edited = false;
    const label = () => (edited ? 'Find with these requests' : `Show ${f.foundCount} record${f.foundCount === 1 ? '' : 's'}`);
    const card = h('div', { class: 'ai-proposal' }, h('div', { class: 'ai-proposal-title' }, f.summary || f.layout), h('div', { class: 'ai-note' }, `On layout ${f.layout}`));
    const show = this.show && f.foundCount ? h('button', { type: 'button', class: 'primary' }, label()) : undefined;
    if (query.length) {
      const list = h('details', { class: 'ai-requests' }, h('summary', {}, `${query.length} find request${query.length === 1 ? '' : 's'}`));
      (list as HTMLDetailsElement).open = query.length <= 3;
      query.forEach((r, i) => {
        const omit = r.omit === true || r.omit === 'true';
        const box = h('div', { class: `ai-request${omit ? ' ai-request-omit' : ''}` }, h('div', { class: 'ai-note' }, `${omit ? 'Omit' : 'Find'}${query.length > 1 ? ` (request ${i + 1})` : ''}`));
        for (const [k, v] of Object.entries(r)) {
          if (k === 'omit') continue;
          const input = h('input', { type: 'text', 'aria-label': `${k} criteria` }) as HTMLInputElement;
          input.value = String(v);
          input.addEventListener('input', () => {
            r[k] = input.value;
            edited = true;
            if (show) show.textContent = label();
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && show) show.click();
          });
          box.append(h('label', { class: 'ai-criterion' }, h('span', {}, k), input));
        }
        list.append(box);
      });
      card.append(list);
    } else {
      card.append(h('div', { class: 'ai-note' }, 'All records'));
    }
    if (f.sort?.length) card.append(h('div', { class: 'ai-note' }, `Sorted by ${f.sort.map((x) => `${x.fieldName}${x.sortOrder === 'descend' ? ' (descending)' : ''}`).join(', ')}`));
    const actions = h('div', { class: 'ai-actions' });
    if (show) {
      show.addEventListener('click', () => void this.show!({ ...f, query: query.map((r) => ({ ...r })) }));
      actions.append(show);
    } else if (!f.foundCount) {
      card.append(h('p', { class: 'ai-note' }, 'No records match'));
    } else {
      card.append(h('p', { class: 'ai-note' }, `${f.foundCount} records`));
    }
    if (this.editFind && query.length) {
      const b = h('button', { type: 'button' }, 'Edit in Find mode');
      b.addEventListener('click', () => void this.editFind!(f.layout, query.map((r) => ({ ...r })), f.summary));
      actions.append(b);
    }
    if (actions.childElementCount) card.append(actions);
    return card;
  }

  private dashboard(d: DashboardOut): HTMLElement {
    const name = h('input', { type: 'text', 'aria-label': 'Dashboard name' }) as HTMLInputElement;
    name.value = d.name;
    const card = h('div', { class: 'ai-proposal ai-dashboard' }, h('div', { class: 'ai-proposal-title' }, 'Dashboard'), name,
      ...(d.description ? [h('div', { class: 'ai-note' }, d.description)] : []),
      ...d.data.map((w) => renderWidget(w, { width: 340, height: 220 })));
    const save = h('button', { type: 'button', class: 'primary' }, 'Save dashboard');
    const status = h('span', { class: 'ai-note' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const r = await fetch(`/tabularius/dashboards/v1/databases/${enc(this.db)}`, {
          method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ name: name.value, description: d.description, widgets: d.widgets }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error?.message ?? httpProblem(r.status));
        const id = body.dashboard.id as string;
        save.textContent = 'Saved';
        status.replaceChildren(h('a', { href: `dashboard.html?id=${enc(id)}`, target: 'tabularius-dashboards' }, 'Open in Dashboards'));
        this.onDashboardSaved?.(id);
      } catch (e) {
        status.textContent = (e as Error).message;
        save.disabled = false;
      }
    });
    card.append(h('div', { class: 'ai-actions' }, save, status));
    return card;
  }

  private proposal(p: Proposal): HTMLElement {
    const card = h('div', { class: 'ai-proposal' },
      h('div', { class: 'ai-proposal-title' }, `Proposed: ${p.summary}`),
      ...(p.preview?.length ? [h('ul', { class: 'ai-preview' }, ...p.preview.map((l) => h('li', { class: /^[+-] /.test(l) ? `ai-diff ai-diff-${l[0] === '+' ? 'add' : 'del'}` : /^ {2}/.test(l) ? 'ai-diff' : '' }, l)))] : []),
      h('details', {}, h('summary', {}, `${p.changes.length} design change${p.changes.length === 1 ? '' : 's'}${p.preview?.length ? ' as sent' : ''}`), h('pre', {}, JSON.stringify(p.changes, null, 2))));
    // A modern layout's page, shown as it will look (no data calls until it is applied and opened in Browse mode).
    const pages = (p.layouts ?? []).map((l) => modernPage(l.design.objects)).filter((x) => x !== undefined);
    if (pages.length) {
      card.insertBefore(h('div', { class: 'ai-page-previews' }, ...pages.map((x) => {
        const bytes = new TextEncoder().encode(x.html);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return h('div', { class: 'ai-page-preview' }, webViewer('data:text/html;base64,' + btoa(bin)));
      })), card.querySelector('details'));
    } else if (p.layouts?.length && this.layoutPicture) {
      // What the layouts will look like, drawn as design mode draws them, before anything is applied.
      const pictures = h('div', { class: 'ai-layout-pictures' });
      card.insertBefore(pictures, card.querySelector('details'));
      for (const l of p.layouts) void this.layoutPicture(l).then((el) => pictures.append(el), () => {});
    }
    // Each new or changed script, run once on a copy of the file: how it ended and the records it changed.
    let failed = 0;
    for (const d of p.dryRuns ?? []) {
      const n = dryRunNote(d.run);
      if (n.bad) failed++;
      card.append(h('div', { class: `ai-note ai-dry-run${n.bad ? ' ai-dry-run-bad' : ''}` }, `${d.script}: ${n.text}`));
      if (d.run.changes) card.append(...dryRunChanges(d.run.changes));
    }
    if (this.apply) {
      // A script that failed its test run isn't offered like one that worked: Apply anyway, quietly.
      const b = h('button', { type: 'button', class: failed ? 'quiet' : 'primary' }, failed ? 'Apply anyway' : 'Apply');
      const undo = h('button', { type: 'button', hidden: '' }, 'Undo');
      // After applying a layout: open it to adjust by hand. Before: discard puts the proposal away.
      const open = h('button', { type: 'button', hidden: '' }, p.layouts?.length === 1 ? 'Open in layout editor' : 'Open the first layout');
      open.addEventListener('click', () => p.layouts?.[0] && this.openLayout?.(p.layouts[0]));
      const discard = h('button', { type: 'button', class: 'quiet' }, 'Discard');
      discard.addEventListener('click', () => {
        card.classList.add('ai-discarded');
        card.replaceChildren(h('div', { class: 'ai-note' }, `Discarded: ${p.summary}`));
      });
      let back: Record<string, unknown>[] | undefined;
      b.addEventListener('click', async () => {
        // Deleting things is asked about first, in words, by the page itself.
        const risky = destructiveChanges(p.changes);
        if (risky.length && !(await confirmAction({ title: 'Apply these changes?', lines: risky, confirm: 'Apply changes' }))) return;
        b.disabled = true;
        const r = await this.apply!(p.changes);
        if (!r) {
          b.disabled = false;
          return;
        }
        b.textContent = 'Applied';
        back = r.undo;
        undo.hidden = !(back && this.undo);
        discard.hidden = true;
        open.hidden = !(p.layouts?.length && this.openLayout);
      });
      undo.addEventListener('click', async () => {
        if (!back || !this.undo) return;
        undo.disabled = true;
        if (await this.undo(back)) {
          undo.hidden = true;
          open.hidden = true;
          discard.hidden = false;
          b.textContent = failed ? 'Apply anyway' : 'Apply';
          b.disabled = false;
        }
        undo.disabled = false;
      });
      card.append(h('div', { class: 'ai-actions' }, b, open, undo, discard));
    } else {
      card.append(h('p', { class: 'ai-note' }, 'Someone with [Full Access] can apply this in Design.'));
    }
    return card;
  }

  private draft(d: Draft, use?: UseDraft): HTMLElement {
    const what = d.kind === 'calculation' ? 'formula' : d.kind === 'function' ? 'function' : 'script';
    const copy = h('button', { type: 'button' }, 'Copy');
    copy.addEventListener('click', () => void navigator.clipboard?.writeText(d.text).then(() => (copy.textContent = 'Copied')));
    const card = h('div', { class: 'ai-proposal ai-draft' },
      h('div', { class: 'ai-proposal-title' }, `Drafted ${what}: ${d.summary}`),
      ...(d.parameters ? [h('div', { class: 'ai-note' }, `Parameters: ${d.parameters.join(' ; ') || 'none'}`)] : []),
      h('pre', {}, d.text));
    if (d.dryRun) {
      const n = dryRunNote(d.dryRun);
      card.append(h('div', { class: `ai-note ai-dry-run${n.bad ? ' ai-dry-run-bad' : ''}` }, n.text));
      if (d.dryRun.changes) card.append(...dryRunChanges(d.dryRun.changes));
    }
    if (d.lint?.length) {
      card.append(h('div', { class: 'ai-note ai-dry-run-bad' }, 'Script check:'),
        h('ul', { class: 'ai-lint' }, ...d.lint.map((i) => h('li', {}, `Line ${i.line}: ${i.message}`))));
    }
    if (d.samples?.results.length) {
      const bad = d.samples.results.some((r) => r.error);
      card.append(h('div', { class: `ai-note ai-samples${bad ? ' ai-dry-run-bad' : ''}` }, `Results on records of ${d.samples.layout} (nothing saved):`),
        h('table', { class: 'ai-samples' }, ...d.samples.results.map((r) => h('tr', {},
          h('th', {}, `Record ${r.recordId}`),
          h('td', r.error ? { class: 'ai-dry-run-bad' } : {}, r.error ? `Error: ${r.error}` : r.value === '' ? '(empty)' : r.value!)))));
    }
    const actions = h('div', { class: 'ai-actions' });
    if (use) {
      const b = h('button', { type: 'button', class: 'primary' }, `Use this ${what}`);
      b.addEventListener('click', () => {
        use(d.text, d.parameters);
        b.textContent = 'In the editor, not saved yet';
      });
      actions.append(b);
    }
    actions.append(copy);
    card.append(actions);
    return card;
  }

  /** Reads a streamed answer: a line per step (shown as it happens), then the answer. */
  private async read(r: Response): Promise<{ reply?: string; proposals?: Proposal[]; foundSets?: FoundSet[]; drafts?: Draft[]; charts?: ChartOut[]; dashboards?: DashboardOut[]; cleanups?: Message['cleanups']; automations?: AutomationOut[]; connections?: { name: string }[]; plans?: Message['plans']; usage?: Message['usage'] }> {
    const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      buffer += value ?? '';
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop()!;
      for (const l of lines) {
        if (!l.trim()) continue;
        const event = JSON.parse(l);
        if (event.error) throw Object.assign(new Error(event.error.message), { status: typeof event.error.status === 'number' ? event.error.status : 500 });
        if (event.done) return event.done;
        if (typeof event.step === 'string') {
          // Text written before a tool step was thinking aloud; the answer is what comes after the last step.
          this.trace.push({ step: { label: event.step }, running: true });
          this.partial = '';
          this.live?.replaceChildren();
          this.drawTrace();
          this.said.textContent = `${event.step}…`;
        } else if (event.tool && typeof event.tool.label === 'string') {
          // The call's arguments (secrets hidden) and the start of what came back.
          const at = this.trace.findIndex((t) => t.running && t.step.label === event.tool.label);
          const entry = { step: event.tool as ToolStep, running: false };
          if (at >= 0) this.trace[at] = entry;
          else this.trace.push(entry);
          this.drawTrace(at >= 0 ? at : undefined);
        } else if (typeof event.text === 'string') {
          const first = !this.partial;
          this.partial += event.text;
          if (first) this.drawTrace();
          this.renderPartial();
        }
      }
      if (done) throw new Error('The answer was cut off');
    }
  }

  /**
   * Opens the panel and asks a question for the person (an "Explain with AI" button). With a draft
   * target ("Draft with AI" in a formula box or the script editor), a drafted formula or script comes
   * back with a button that puts it in that editor.
   */
  /** Asks a question in the panel; resolves with the answer's text (undefined when busy, stopped or failed). */
  async askAbout(question: string, draft?: { target: DraftTarget; use: UseDraft }): Promise<string | undefined> {
    this.toggle(true);
    if (this.busy) return undefined;
    this.input.value = question;
    const before = this.messages.length;
    await this.ask(draft);
    const answer = this.messages.length > before ? this.messages.at(-1) : undefined;
    return answer?.role === 'assistant' && !answer.failed ? answer.content : undefined;
  }

  /** A script that stopped with an error ("Why?"), told to the assistant with the question about it, for this chat. */
  private failure?: ScriptFailureContext;

  /** "Why?" on a script error: the assistant runs the script again on a copy, offline, and explains the failing step. */
  async explainFailure(f: ScriptFailureContext): Promise<void> {
    this.failure = f;
    await this.askAbout(`Why did the script "${f.script}" stop with error ${f.error}?`);
  }

  /**
   * A find described in words (Find mode's "Find with AI"): the assistant works out the find requests (omit
   * requests too) and, when it comes back with one found set, they are filled into the Find mode form, to check
   * and change before Perform Find. Otherwise the answer (a question back, or several to choose from) stays in the panel.
   */
  async findInWords(description: string): Promise<void> {
    const before = this.messages.length;
    await this.askAbout(`Find ${description}`);
    const answer = this.messages.length > before ? this.messages.at(-1) : undefined;
    const found = answer?.role === 'assistant' && !answer.failed && answer.foundSets?.length === 1 ? answer.foundSets[0] : undefined;
    if (found && this.editFind) await this.editFind(found.layout, found.query.map((r) => ({ ...r })), description);
    else if (found && found.foundCount && this.show) await this.show(found);
  }

  private async ask(draft?: { target: DraftTarget; use: UseDraft }): Promise<void> {
    const question = this.input.value.trim();
    if (!question || this.busy) return;
    this.input.value = '';
    const picture = this.picture;
    this.picture = undefined;
    this.notePicture();
    this.messages.push({ role: 'user', content: question, ...(picture ? { picture: picture.name } : {}) });
    this.busy = true;
    this.stopper = new AbortController();
    this.trace = [];
    this.partial = '';
    this.said.textContent = this.alerts.textContent = '';
    this.send.textContent = 'Stop';
    this.send.title = 'Stop this answer (Escape in the question box)';
    this.renderLog(true);
    let outcome: 'answered' | 'stopped' | 'failed' = 'failed';
    try {
      const r = await fetch(`/tabularius/assistant/v1/databases/${enc(this.db)}`, {
        method: 'POST',
        signal: this.stopper.signal,
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: JSON.stringify({ messages: this.messages.filter((m) => !m.failed).map(({ role, content }) => ({ role, content })), context: { ...this.context(), ...(draft ? { draft: draft.target } : {}), ...(this.failure ? { failure: this.failure } : {}) }, ...(picture ? { image: { mediaType: picture.mediaType, data: picture.data } } : {}) }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw Object.assign(new Error(err.error?.message ?? httpProblem(r.status)), { status: r.status });
      }
      const body = await this.read(r);
      const tools = this.trace.map((t) => t.step);
      this.messages.push({ role: 'assistant', content: body.reply || '(no answer)', proposals: body.proposals, foundSets: body.foundSets, charts: body.charts, ...(tools.length ? { tools } : {}), ...(body.dashboards?.length ? { dashboards: body.dashboards } : {}), ...(body.cleanups?.length ? { cleanups: body.cleanups } : {}), ...(body.automations?.length ? { automations: body.automations } : {}), ...(body.connections?.length ? { connections: body.connections } : {}), ...(body.plans?.length ? { plans: body.plans } : {}), ...(body.usage ? { usage: body.usage } : {}),
        ...(body.drafts?.length ? { drafts: body.drafts, ...(draft ? { use: draft.use } : {}) } : {}) });
      outcome = 'answered';
    } catch (e) {
      // A stopped answer keeps what was written so far, but neither it nor the question goes back to the model.
      this.messages.at(-1)!.failed = true;
      // The picture comes back to send again, unless another was added meanwhile.
      if (picture && !this.picture) {
        this.picture = picture;
        this.notePicture();
      }
      const stopped = this.stopper?.signal.aborted;
      // Calls that had not come back are shown as stopped.
      const tools = this.trace.map((t) => (t.running ? { ...t.step, label: `${t.step.label} (stopped)`, error: true } : t.step));
      if (stopped) {
        outcome = 'stopped';
        this.messages.push({ role: 'assistant', content: this.partial ? `${this.partial}\n\n(Stopped)` : 'Stopped.', failed: true, ...(tools.length ? { tools } : {}) });
      } else {
        const status = (e as { status?: number }).status;
        const error = classifyError(status, (e as Error).message);
        const content = status === undefined ? 'The request didn\'t get through to the server.' : (e as Error).message;
        this.messages.push({ role: 'assistant', content: this.partial ? `${this.partial}\n\n(${content})` : content, failed: true, error, ...(tools.length ? { tools } : {}) });
        this.alerts.textContent = `${error.title}. ${content}`;
      }
    } finally {
      // After a stop the server counts the tokens as it notices the closed connection: look a moment later.
      if (this.stopper?.signal.aborted) setTimeout(() => void this.refreshUsage(), 1000);
      this.busy = false;
      this.stopper = undefined;
      this.send.textContent = 'Ask';
      this.send.title = '';
      this.trace = [];
      this.traceEls = [];
      this.partial = '';
      this.live = undefined;
      void this.refreshUsage();
      this.save();
      this.renderLog();
      const last = this.messages.at(-1);
      // The answer is said once, when it is whole; a long one is cut for the ear (it is all in the conversation).
      if (outcome === 'answered' && last?.role === 'assistant') this.said.textContent = `Answer: ${last.content.length > 1200 ? `${last.content.slice(0, 1200)}… and more, in the conversation` : last.content}`;
      else if (outcome === 'stopped') this.said.textContent = 'Stopped.';
    }
  }
}
