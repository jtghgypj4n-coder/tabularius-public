// Parts of the assistant's chat panel that stand apart from the panel: what a failed question means for the
// person, which actions ask first, the usage of a whole conversation, what a tool call looks like, and keeping
// a conversation to the sign-in it belongs to.

import { h } from './design/dom.ts';

/** A tool call as the panel shows it: from the server's {"tool": ...} lines of a streamed answer. */
export interface ToolStep {
  id?: string;
  name?: string;
  /** In words ("Looking at layout "Orders""). */
  label: string;
  args?: unknown;
  /** The start of the result; the server has hidden secrets and cut it. */
  result?: string;
  resultLength?: number;
  error?: boolean;
}

export type ErrorKind = 'policy' | 'budget' | 'provider' | 'network' | 'session' | 'off' | 'other';

export interface ChatError {
  kind: ErrorKind;
  /** What happened, in a few words. */
  title: string;
  /** What to do about it. */
  hint: string;
  /** Asking the same question again might work. */
  retry: boolean;
}

/**
 * What a failed question means. `status` is the HTTP status of the answer, or of the error the stream ended with; absent when
 * the request never got an answer (the connection failed).
 */
export function classifyError(status: number | undefined, message: string): ChatError {
  if (status === undefined) return { kind: 'network', title: 'Can\'t reach the server', hint: 'Check the connection, then try again.', retry: true };
  if (/Invalid FileMaker Data API token|session ended|session has ended/i.test(message) || (status === 401 && /token/i.test(message))) {
    return { kind: 'session', title: 'Your session ended', hint: 'Log in again to carry on. This conversation is cleared when you sign out.', retry: false };
  }
  if (status === 429 || /\b(?:budget|daily limit|used (?:up )?(?:today|this month)|limit)\b/i.test(message)) {
    return { kind: 'budget', title: 'The assistant\'s budget is used up', hint: 'It is available again when the limit resets (the message says when). An administrator can raise the limit.', retry: false };
  }
  if (status === 503 && /off on this server/i.test(message)) return { kind: 'off', title: 'The assistant is off on this server', hint: 'An administrator turns it on in the server settings.', retry: false };
  if (status === 401 || status === 403 || /privilege|not allowed|policy|turned off|AI is off|AI access/i.test(message)) {
    return { kind: 'policy', title: 'Blocked by this file\'s AI policy', hint: 'Your account or this file isn\'t allowed to use the assistant for this. Ask an administrator if you need it.', retry: false };
  }
  if (status >= 500 || /AI provider|AI model|Can't reach/i.test(message)) {
    return { kind: 'provider', title: 'The AI provider isn\'t answering', hint: 'It is usually brief. Try again in a moment.', retry: true };
  }
  return { kind: 'other', title: 'That didn\'t work', hint: '', retry: true };
}

/** Things a change would do that deserve a deliberate yes first, in words. */
export function destructiveChanges(changes: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    const op = String(c.op ?? '');
    const what = (key: string) => (typeof c[key] === 'string' || typeof c[key] === 'number' ? String(c[key]) : '');
    switch (op) {
      case 'deleteTable': out.push(`Delete the table ${what('table')} with its fields and layouts' links to it`); break;
      case 'deleteField': out.push(`Delete the field ${what('table')}::${what('field')} and what is stored in it`); break;
      case 'deleteLayout': out.push(`Delete the layout ${what('layout')}`); break;
      case 'deleteScript': out.push(`Delete the script ${what('script')}`); break;
      case 'deleteRelationship': out.push('Delete a relationship'); break;
      case 'deleteOccurrence': out.push(`Delete the table occurrence ${what('occurrence')}`); break;
      case 'deleteValueList': out.push(`Delete the value list ${what('valueList')}`); break;
      case 'deleteCustomFunction': out.push(`Delete the custom function ${what('customFunction')}`); break;
      case 'deleteDataSource': out.push(`Delete the data source ${what('dataSource')}`); break;
      case 'deleteCustomMenu': out.push(`Delete the custom menu ${what('customMenu')}`); break;
      case 'deleteTheme': out.push(`Delete the theme ${what('theme')}`); break;
      default: if (/^delete/.test(op)) out.push(`Delete (${op})`);
    }
  }
  return out;
}

/** What running one step of an agent plan does, when it is something to ask about first; undefined for a step that only looks. */
export function stepNeedsConfirmation(kind: string, line: string): string | undefined {
  switch (kind) {
    case 'delete': return `Delete records: ${line}`;
    case 'set': return `Change records: ${line}`;
    case 'script': return `Run a script that can change anything the script does: ${line}`;
    case 'create': return `Make records: ${line}`;
    default: return undefined;
  }
}

/**
 * Asks before an action: a modal dialog (the browser traps focus and Escape cancels) with the action in words, the
 * safe choice focused, and nothing the conversation or the data says able to answer it. True when confirmed.
 */
export function confirmAction(opts: { title: string; lines: string[]; confirm: string; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'ai-confirm', 'aria-labelledby': 'ai-confirm-title', role: 'alertdialog' }) as HTMLDialogElement;
    const cancel = h('button', { type: 'button', class: 'quiet' }, opts.cancel ?? 'Cancel') as HTMLButtonElement;
    const ok = h('button', { type: 'button', class: 'danger' }, opts.confirm) as HTMLButtonElement;
    const done = (yes: boolean) => {
      if (!dialog.open) return;
      dialog.close(yes ? 'yes' : 'no');
    };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'yes');
    });
    dialog.append(
      h('h2', { id: 'ai-confirm-title' }, opts.title),
      h('ul', {}, ...opts.lines.slice(0, 8).map((l) => h('li', {}, l)), ...(opts.lines.length > 8 ? [h('li', {}, `and ${opts.lines.length - 8} more`)] : [])),
      h('p', { class: 'ai-note' }, 'Only you can confirm this, here. Nothing in your data or the conversation can.'),
      h('div', { class: 'ai-actions' }, cancel, ok));
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export interface ChatUsage { inputTokens: number; cachedTokens: number; outputTokens: number; costUsd?: number }

/** What the answers of a conversation used, from the counters the server reported with each. */
export function chatUsage(messages: { usage?: ChatUsage }[]): (ChatUsage & { answers: number }) | undefined {
  const used = messages.filter((m) => m.usage);
  if (!used.length) return undefined;
  const total = { answers: used.length, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: undefined as number | undefined };
  for (const m of used) {
    total.inputTokens += m.usage!.inputTokens;
    total.cachedTokens += m.usage!.cachedTokens;
    total.outputTokens += m.usage!.outputTokens;
    if (m.usage!.costUsd !== undefined) total.costUsd = (total.costUsd ?? 0) + m.usage!.costUsd;
  }
  return total;
}

/** A tool call's arguments as the panel shows them: pretty JSON, as the server sent them (it hid the secrets). */
export function argsText(args: unknown): string {
  if (args === undefined) return '';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/** A tool call: one line, opening to what the assistant asked for and what came back. */
export function toolView(t: ToolStep, running: boolean, copy: (text: string) => void): HTMLElement {
  const kind = running ? 'running' : t.error ? 'failed' : 'done';
  const mark = () => h('span', { class: `ai-tool-status ai-tool-${kind}` }, running ? 'Running' : t.error ? 'Failed' : 'Done');
  if (running || (t.args === undefined && !t.result)) return h('li', { class: 'ai-tool' }, h('div', { class: 'ai-tool-line' }, mark(), ` ${t.label}${running ? '…' : ''}`));
  const summary = h('summary', {}, mark(), ` ${t.label}`);
  const args = argsText(t.args);
  const body: HTMLElement[] = [];
  if (args && args !== '{}') body.push(h('div', {}, h('div', { class: 'ai-note' }, 'Asked for'), h('pre', { tabindex: '0', 'aria-label': `Arguments of ${t.label}` }, args)));
  if (t.result) {
    const more = t.resultLength && t.resultLength > t.result.length ? ` (${t.resultLength.toLocaleString()} characters; the start is shown)` : '';
    body.push(h('div', {}, h('div', { class: 'ai-note' }, `${t.error ? 'Failed with' : 'Came back with'}${more}`), h('pre', { tabindex: '0', 'aria-label': `Result of ${t.label}` }, t.result)));
  }
  const copyButton = h('button', { type: 'button', class: 'ai-again' }, 'Copy') as HTMLButtonElement;
  copyButton.addEventListener('click', () => {
    copy([t.label, args && `Asked for:\n${args}`, t.result && `${t.error ? 'Failed with' : 'Came back with'}:\n${t.result}`].filter(Boolean).join('\n\n'));
    copyButton.textContent = 'Copied';
    setTimeout(() => (copyButton.textContent = 'Copy'), 1500);
  });
  return h('li', { class: 'ai-tool' }, h('details', {}, summary, ...body, copyButton));
}

const KEY_PREFIX = 'tabularius.assistant.';

/** A short fingerprint of the sign-in a conversation belongs to (not secret: the token itself is never stored with it). */
export function ownerOf(token: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < token.length; i++) {
    a = Math.imul(a ^ token.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + token.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/** Forgets every kept conversation of this browser tab: signing out (or the session ending) takes the conversation with it. */
export function forgetAssistantHistory(): void {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(KEY_PREFIX)) sessionStorage.removeItem(k);
  } catch {
    // Storage is off: nothing was kept.
  }
}
