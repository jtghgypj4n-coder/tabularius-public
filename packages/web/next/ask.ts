// Asking the file's assistant from the command bar: the question and its answer show in the side panel, where a
// record would, with room for a follow-up. An answer that found records offers to show them in the list. Only
// there when the server runs the assistant (`tabularius serve --ai`); it reads only, as everywhere.

import type { FindRequest, SortSpec } from '../src/types.ts';
import { h, icon } from './dom.ts';

export interface FoundSet {
  layout: string;
  query: FindRequest[];
  sort?: SortSpec[];
  foundCount: number;
  summary: string;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  foundSets?: FoundSet[];
  failed?: boolean;
}

const enc = encodeURIComponent;

/** Whether the server runs the assistant for this file and account. */
export async function assistantAvailable(db: string, token: string): Promise<boolean> {
  try {
    const r = await fetch(`/tabularius/assistant/v1/databases/${enc(db)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    return !!(await r.json()).available;
  } catch {
    return false;
  }
}

/** Paragraphs and lines of an answer as text nodes (never as HTML), with **bold** kept. */
export function prose(text: string): HTMLElement[] {
  return text.split(/\n{2,}/).map((para) => {
    const p = h('p');
    para.split('\n').forEach((line, i) => {
      if (i) p.append(h('br'));
      line.split(/(\*\*[^*]+\*\*)/).forEach((bit) => p.append(/^\*\*[^*]+\*\*$/.test(bit) ? h('strong', {}, bit.slice(2, -2)) : bit));
    });
    return p;
  });
}

export class Conversation {
  private turns: Turn[] = [];
  private busy = false;
  private waited = 0;
  private step = '';
  private partial = '';
  private stopper?: AbortController;
  readonly element = h('div', { class: 'ask' });
  private readonly log = h('div', { class: 'ask-log', 'aria-live': 'polite' });
  private readonly input = h('textarea', { class: 'ask-input', rows: 1, placeholder: 'Ask a follow-up', 'aria-label': 'Ask a follow-up' });
  private readonly db: string;
  private readonly token: string;
  private readonly context: () => { layout?: string; recordId?: string };
  private readonly showFound: (f: FoundSet) => void;

  constructor(db: string, token: string, context: () => { layout?: string; recordId?: string }, showFound: (f: FoundSet) => void) {
    this.db = db;
    this.token = token;
    this.context = context;
    this.showFound = showFound;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const q = this.input.value.trim();
        if (q) { this.input.value = ''; void this.ask(q); }
      }
    });
    this.input.addEventListener('input', () => { this.input.style.height = 'auto'; this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`; });
    this.element.append(this.log, h('div', { class: 'ask-compose' }, this.input));
  }

  /** Starts over with a new question. */
  start(question: string): void {
    this.stopper?.abort();
    this.turns = [];
    void this.ask(question);
  }

  focus(): void {
    this.input.focus();
  }

  stop(): void {
    this.stopper?.abort();
  }

  private async ask(question: string): Promise<void> {
    if (this.busy) return;
    this.turns.push({ role: 'user', content: question });
    this.busy = true;
    this.waited = 0;
    this.step = '';
    this.partial = '';
    this.draw();
    this.stopper = new AbortController();
    const started = Date.now();
    const ticker = setInterval(() => { this.waited = Math.floor((Date.now() - started) / 1000); this.draw(); }, 1000);
    try {
      const r = await fetch(`/tabularius/assistant/v1/databases/${enc(this.db)}`, {
        method: 'POST', signal: this.stopper.signal,
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: JSON.stringify({ messages: this.turns.filter((t) => !t.failed).map(({ role, content }) => ({ role, content })), context: { ...this.context(), mode: 'browse' } }),
      });
      const streamed = r.ok && /x-ndjson/.test(r.headers.get('content-type') ?? '') && !!r.body;
      const body = streamed ? await this.read(r) : await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error?.message ?? `The assistant couldn’t answer (HTTP ${r.status}).`);
      this.turns.push({ role: 'assistant', content: String(body.reply || 'No answer came back.'), foundSets: body.foundSets ?? [] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') this.turns.pop();
      else this.turns.push({ role: 'assistant', content: (e as Error).message, failed: true });
    } finally {
      clearInterval(ticker);
      this.busy = false;
    }
    this.draw();
    this.input.focus();
  }

  /** Reads a streamed answer: a line per step and pieces of the answer as they are written, then the whole answer. */
  private async read(r: Response): Promise<{ reply?: string; foundSets?: FoundSet[] }> {
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
        if (event.error) throw new Error(event.error.message);
        if (event.done) return event.done;
        if (typeof event.step === 'string') { this.step = event.step; this.partial = ''; this.draw(); }
        else if (typeof event.text === 'string') { this.partial += event.text; this.draw(); }
      }
      if (done) throw new Error('The answer was cut off');
    }
  }

  private draw(): void {
    this.log.replaceChildren(...this.turns.map((t) => t.role === 'user'
      ? h('div', { class: 'ask-q' }, t.content)
      : h('div', { class: `ask-a${t.failed ? ' failed' : ''}` },
        ...prose(t.content),
        ...(t.foundSets ?? []).map((f) => h('button', { class: 'ask-found', onclick: () => this.showFound(f) },
          h('span', { class: 'ask-found-text' }, f.summary || 'Records it found'),
          h('span', { class: 'ask-found-count' }, `Show ${f.foundCount.toLocaleString()}`), icon('go', 14))))),
    this.busy && this.partial ? h('div', { class: 'ask-a' }, ...prose(this.partial)) : '',
    this.busy ? h('div', { class: 'ask-a thinking', 'aria-label': 'Thinking' }, h('span'), h('span'), h('span'),
      h('span', { class: 'ask-wait' }, this.step ? `${this.step}… ${this.waited}s` : this.waited < 5 ? '' : `Still working… ${this.waited}s`),
      h('button', { class: 'ask-cancel', onclick: () => this.stopper?.abort() }, 'Cancel')) : '');
    this.input.disabled = this.busy;
    this.log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
}
