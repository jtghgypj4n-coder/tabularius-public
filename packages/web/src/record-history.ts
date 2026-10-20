// The History sheet: who changed a record and when, from where, with each change's old and new value and a button
// to put it back. The server logs every create, edit and delete on its own; this only reads that log (and asks the
// server to put a change back, which it does with the account's own privileges and logs as a revert).

export interface HistoryChange { field: string; from?: unknown; to?: unknown; how?: string; seq: number }
export interface HistoryEvent {
  at: string;
  account: string | null;
  kind: 'created' | 'changed' | 'deleted';
  by?: string;
  surface?: string;
  script?: string;
  copyOf?: number;
  revertOf?: number;
  seqs: number[];
  changes: HistoryChange[];
}
export interface RecordHistory { table: string; recordId: number; exists: boolean; events: HistoryEvent[]; more?: number }
export interface RevertResult { action: 'updated' | 'deleted' | 'created'; fields: string[]; skipped: { field: string; reason: string }[] }

export interface HistoryActions {
  /** Puts back what the entries changed: `fields` limits an edit to some of its fields. */
  revert(seq: number, fields?: string[]): Promise<RevertResult>;
  /** Ran after something was put back, so the window shows the record as it is now. */
  changed(): void;
}

const SURFACES: Record<string, string> = {
  web: 'the web client', rest: 'the Data API', odata: 'OData', sql: 'SQL', mcp: 'an AI app', admin: 'the admin console',
  automation: 'an automation', hook: 'an inbound webhook', cleanup: 'Clean Up Data', agent: 'an AI agent', assistant: 'the assistant', design: 'the design tools', import: 'an import', sync: 'a sync',
};

/** Where an event came from, in words: "the web client", "the Data API, script Tidy States". */
export function sourceText(e: Pick<HistoryEvent, 'surface' | 'script' | 'by' | 'copyOf'>): string {
  const parts = [e.surface ? (SURFACES[e.surface] ?? e.surface) : '', e.script ? `script “${e.script}”` : '', e.by ?? ''].filter(Boolean);
  return parts.join(', ');
}

/** One value as the sheet shows it. */
export function valueText(v: unknown): string {
  return v === null || v === undefined || v === '' ? 'empty' : String(v).replace(/\r|\n/g, '¶');
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

function eventHeading(e: HistoryEvent): string {
  const what = e.revertOf !== undefined ? 'Put back a change' : e.copyOf !== undefined ? `Duplicated from record ${e.copyOf}` : e.kind === 'created' ? 'Created' : e.kind === 'deleted' ? 'Deleted' : 'Changed';
  return `${what} by ${e.account ?? 'someone'}`;
}

/** The sheet's contents for a record's history. */
export function renderHistory(history: RecordHistory, actions: HistoryActions, status: (message: string) => void): HTMLElement {
  const root = h('div', { class: 'history-body' });
  if (!history.events.length) {
    root.append(h('p', { class: 'muted' }, 'Nothing is logged for this record yet. The log reaches back only as far as it is kept.'));
    return root;
  }
  if (!history.exists) root.append(h('p', { class: 'history-gone' }, 'This record has been deleted.'));
  for (const e of history.events) {
    const when = new Date(e.at);
    const source = sourceText(e);
    const head = h('div', { class: 'history-head' },
      h('strong', {}, eventHeading(e)),
      h('time', { datetime: e.at }, Number.isNaN(when.getTime()) ? e.at : when.toLocaleString()),
      ...(source ? [h('span', { class: 'history-source' }, `via ${source}`)] : []));
    const rows = e.changes.map((c) => {
      const row = h('li', { class: 'history-change' },
        h('span', { class: 'history-field' }, c.field),
        ...(e.kind === 'changed'
          ? [h('span', { class: 'history-from' }, valueText(c.from)), ' → ', h('span', { class: 'history-to' }, valueText(c.to))]
          : [h('span', { class: e.kind === 'created' ? 'history-to' : 'history-from' }, valueText(e.kind === 'created' ? c.to : c.from))]),
        ...(c.how ? [h('span', { class: 'history-how muted' }, c.how)] : []));
      if (e.kind === 'changed' && history.exists) row.append(act('Put back', `Put ${c.field} back to ${valueText(c.from)}`, () => actions.revert(c.seq, [c.field]), actions, status));
      return row;
    });
    const item = h('li', { class: 'history-event' }, head, h('ul', { class: 'history-changes' }, ...rows));
    if (e.kind === 'deleted' && !history.exists) {
      item.append(act('Bring this record back', 'Bring this record back, as it was before it was deleted', () => actions.revert(e.seqs[0]), actions, status));
    } else if (e.kind === 'created' && history.exists && e.revertOf === undefined && e.copyOf === undefined) {
      item.append(act('Delete this record', 'Delete this record: puts back the way things were before it was made', () => actions.revert(e.seqs[0]), actions, status, true));
    }
    root.append(item);
  }
  if (history.more) root.append(h('p', { class: 'muted' }, `${history.more} older changes are not shown.`));
  return root;
}

function act(label: string, title: string, run: () => Promise<RevertResult>, actions: HistoryActions, status: (m: string) => void, confirmFirst = false): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'history-put-back', title }, label);
  b.addEventListener('click', async () => {
    if (confirmFirst && !confirm(`${title}?`)) return;
    b.disabled = true;
    try {
      const r = await run();
      const left = r.skipped.map((s) => `${s.field} (${s.reason})`);
      status(left.length ? `Put back, except ${left.join('; ')}.` : 'Put back.');
      actions.changed();
    } catch (e) {
      b.disabled = false;
      status((e as Error).message);
    }
  });
  return b;
}

/** Opens the History sheet; `load` fetches the history again after a change was put back. */
export function showRecordHistory(title: string, load: () => Promise<RecordHistory>, actions: HistoryActions): HTMLDialogElement {
  const body = h('div', { class: 'history-wrap' });
  const message = h('p', { class: 'history-status', role: 'status', 'aria-live': 'polite' });
  const done = h('button', { type: 'button', class: 'primary' }, 'Done');
  const dialog = h('dialog', { class: 'explain-sheet history-sheet', 'aria-labelledby': 'history-title' },
    h('h2', { id: 'history-title' }, title), message, body, h('div', { class: 'actions' }, done)) as HTMLDialogElement;
  const show = async () => {
    try {
      body.replaceChildren(renderHistory(await load(), { revert: actions.revert, changed: () => { actions.changed(); void show(); } }, (m) => { message.textContent = m; }));
    } catch (e) {
      message.textContent = (e as Error).message;
    }
  };
  done.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  done.focus();
  void show();
  return dialog;
}
