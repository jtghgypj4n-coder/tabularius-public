// The one bar every command goes through (⌘K): go to a collection, start a record, sort, run a script, sign out.
// Typing narrows the list; the best match is always first, so Enter does the obvious thing.

import { h, icon } from './dom.ts';

export interface Command {
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  run: () => void;
}

/**
 * How well `query` matches `text`: every typed character must appear in order. Word starts and runs of
 * characters score higher; 0 is no match.
 */
export function score(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 800 - at - t.length / 100 + (/\W/.test(t[at - 1] ?? ' ') ? 100 : 0);
  let s = 0;
  let i = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const j = t.indexOf(ch, i);
    if (j < 0) return 0;
    run = j === i ? run + 1 : 0;
    s += 1 + run * 2 + (j === 0 || /\W/.test(t[j - 1]) ? 4 : 0);
    i = j + 1;
  }
  return s;
}

export class Palette {
  readonly element: HTMLDialogElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private shown: Command[] = [];
  private active = 0;
  private all: Command[] = [];

  private readonly source: () => Command[];
  private readonly extra?: (query: string) => Command | undefined;

  /** `extra` gives a command for whatever was typed (asking the assistant), offered with the matches. */
  constructor(source: () => Command[], extra?: (query: string) => Command | undefined) {
    this.source = source;
    this.extra = extra;
    this.input = h('input', {
      class: 'palette-input', placeholder: 'Type a command or a collection', 'aria-label': 'Command',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', autocomplete: 'off', spellcheck: 'false',
    });
    this.list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Commands' });
    this.element = h('dialog', { class: 'palette', 'aria-label': 'Commands' },
      h('div', { class: 'palette-field' }, icon('search', 16), this.input),
      this.list,
      h('p', { class: 'palette-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' to move'), h('span', {}, h('kbd', {}, '↵'), ' to choose'), h('span', {}, h('kbd', {}, 'esc'), ' to close')));
    this.input.addEventListener('input', () => { this.active = 0; this.draw(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.select(this.active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.select(this.active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.choose(this.shown[this.active]); }
      // Tab asks, whatever matched.
      else if (e.key === 'Tab' && !e.shiftKey) {
        const ask = this.input.value.trim() ? this.extra?.(this.input.value) : undefined;
        if (ask) { e.preventDefault(); this.choose(ask); }
      }
    });
    this.element.addEventListener('click', (e) => { if (e.target === this.element) this.close(); });
    this.element.addEventListener('close', () => { this.input.value = ''; });
  }

  get isOpen(): boolean {
    return this.element.open;
  }

  open(): void {
    if (this.isOpen) return;
    this.all = this.source();
    this.active = 0;
    this.draw();
    this.element.showModal();
    this.input.focus();
  }

  close(): void {
    if (this.isOpen) this.element.close();
  }

  toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  private choose(c: Command | undefined): void {
    if (!c) return;
    this.close();
    c.run();
  }

  private select(i: number): void {
    if (!this.shown.length) return;
    this.active = (i + this.shown.length) % this.shown.length;
    const items = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    items.forEach((el, j) => el.setAttribute('aria-selected', String(j === this.active)));
    items[this.active]?.scrollIntoView({ block: 'nearest' });
    this.input.setAttribute('aria-activedescendant', items[this.active]?.id ?? '');
  }

  private draw(): void {
    const q = this.input.value;
    if (q.trim()) {
      this.shown = this.all
        .map((c) => ({ c, s: Math.max(score(q, c.label), score(q, `${c.group} ${c.label}`) * 0.6) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map((x) => x.c);
    } else {
      // Unfiltered: a short, ordered menu rather than everything at once.
      const per = new Map<string, number>();
      this.shown = this.all.filter((c) => {
        const n = per.get(c.group) ?? 0;
        per.set(c.group, n + 1);
        return n < (c.group === 'Go to' ? 8 : 4);
      });
    }
    // Asking goes last when commands match, first when nothing does or it reads as a question.
    const ask = q.trim() ? this.extra?.(q) : undefined;
    if (ask) {
      const question = /\?\s*$/.test(q) || q.trim().split(/\s+/).length >= 4;
      this.shown = question || !this.shown.length ? [ask, ...this.shown] : [...this.shown, ask];
    }
    const groups = new Map<string, Command[]>();
    for (const c of this.shown) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    // Matches are drawn group by group; keep `shown` in the drawn order so arrows and Enter agree with the screen.
    this.shown = [...groups.values()].flat();
    let n = 0;
    this.list.replaceChildren(...(this.shown.length ? [...groups].map(([g, cs]) => h('div', { class: 'palette-group', role: 'group', 'aria-label': g },
      h('p', { class: 'palette-group-label', 'aria-hidden': 'true' }, g),
      ...cs.map((c) => {
        const i = n++;
        return h('div', {
          class: 'palette-item', role: 'option', id: `palette-${i}`, 'aria-selected': String(i === this.active),
          onclick: () => this.choose(c), onpointermove: () => { if (this.active !== i) this.select(i); },
        }, h('span', { class: 'palette-label' }, c.label), c.hint ? h('span', { class: 'palette-hint' }, c.hint) : null, c.keys ? h('kbd', {}, c.keys) : null);
      }))) : [h('p', { class: 'palette-none' }, 'Nothing matches that.')]));
    this.input.setAttribute('aria-activedescendant', this.shown.length ? `palette-${this.active}` : '');
  }
}
