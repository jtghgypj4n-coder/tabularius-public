// Design mode with other people, which FileMaker doesn't do: who else is in
// design mode on this file and which layout, script or table they're on, what
// they have selected, and their saves arriving live. Nothing is ever locked: a
// layout or script two people edit at once is merged when one of them saves
// (merge.ts), and Tables & fields shows each change as it lands.
import { Api } from '../api.ts';
import { listen, type Change } from '../live.ts';

export type Where = 'layout' | 'script' | 'table';

export interface Designer {
  account: string;
  /** The layout open in their layout editor, if any. */
  layout: number | null;
  /** The script open in their script editor, or the table they're on in Tables & fields. */
  script?: number;
  table?: number;
  /** What they have selected there: objects on a layout, fields of a table. */
  selection: number[];
}

/** The design tables presence and saves come under (packages/store/src/activity.ts). */
const TABLES: Record<string, Where> = { '_design': 'layout', '_design/scripts': 'script', '_design/tables': 'table' };

/** Whether a designer is on this layout, script or table. */
export function isAt(d: Designer, where: Where, id: number): boolean {
  return where === 'layout' ? d.layout === id : d[where] === id;
}

/** Renew presence well inside the server's 45 seconds. */
const RENEW_MS = 20_000;

export class Together {
  /** Other people in design mode, by account. */
  readonly others = new Map<string, Designer>();
  private readonly api: Api;
  private readonly peerListeners = new Set<() => void>();
  private readonly designListeners = new Set<(layouts: number[], account: string | undefined, where: Where) => void>();
  private here: { layout?: number; script?: number; table?: number; selection: number[] } = { layout: 0, selection: [] };
  private sent = '';
  private timer?: ReturnType<typeof setTimeout>;
  private renew?: ReturnType<typeof setInterval>;
  private stopListening?: () => void;

  constructor(db: string, token: string) {
    this.api = new Api(db, token);
  }

  private url(): string {
    return `/tabularius/live/v1/databases/${encodeURIComponent(this.api.db)}/design`;
  }

  private async call(method: string, body?: unknown): Promise<unknown> {
    const r = await fetch(this.url(), {
      method,
      headers: { authorization: `Bearer ${this.api.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return r.ok ? r.json() : undefined;
  }

  start(): void {
    this.stopListening = listen(this.api, (c) => this.heard(c), () => this.stop());
    this.renew = setInterval(() => void this.refresh(), RENEW_MS);
    addEventListener('pagehide', () => {
      // Leaving: tell the others now rather than after the presence lapses.
      void fetch(this.url(), { method: 'DELETE', headers: { authorization: `Bearer ${this.api.token}` }, keepalive: true });
    });
    void this.refresh();
  }

  stop(): void {
    this.stopListening?.();
    clearInterval(this.renew);
    clearTimeout(this.timer);
  }

  /** Where I am: the layout open in the editor (0 for none) and what's selected there. Sent shortly after it settles. */
  at(layout: number, selection: number[]): void {
    this.go('layout', layout, selection);
  }

  /** Where I am, anywhere: a layout, a script or a table (0 for none), and what's selected there. */
  go(where: Where, id: number, selection: number[] = []): void {
    this.here = { [where]: id, selection: [...selection].sort((a, b) => a - b) };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.send(), 150);
  }

  onPeers(fn: () => void): () => void {
    this.peerListeners.add(fn);
    return () => this.peerListeners.delete(fn);
  }

  /** Someone else saved a design change: the layouts (or scripts, or tables) it touched, and who. */
  onDesign(fn: (ids: number[], account: string | undefined, where: Where) => void): () => void {
    this.designListeners.add(fn);
    return () => this.designListeners.delete(fn);
  }

  private async send(force = false): Promise<void> {
    const key = JSON.stringify(this.here);
    if (!force && key === this.sent) return;
    this.sent = key;
    await this.call('POST', this.here);
  }

  /** Renews my presence and re-reads who's here (presence lapses quietly when a browser goes away). */
  private async refresh(): Promise<void> {
    await this.send(true);
    const r = await this.call('GET') as { designers: { account: string; layout: number | null; script?: number; table?: number; self: boolean }[] } | undefined;
    if (!r) return;
    const seen = new Set<string>();
    for (const d of r.designers) {
      if (d.self) continue;
      seen.add(d.account);
      const was = this.others.get(d.account);
      const same = was && was.layout === d.layout && was.script === d.script && was.table === d.table;
      this.others.set(d.account, { account: d.account, layout: d.layout, ...(d.script ? { script: d.script } : {}), ...(d.table ? { table: d.table } : {}), selection: same ? was.selection : [] });
    }
    for (const a of [...this.others.keys()]) if (!seen.has(a)) this.others.delete(a);
    this.changed();
  }

  private heard(c: Change): void {
    const where = TABLES[c.table];
    if (!where || c.self) return;
    const account = c.account ?? 'Someone';
    if (c.kind === 'designer') {
      const id = c.recordId || undefined;
      this.others.set(account, { account, layout: where === 'layout' ? id ?? null : null, ...(where !== 'layout' && id ? { [where]: id } : {}), selection: c.ids ?? [] });
      this.changed();
    } else if (c.kind === 'leave') {
      this.others.delete(account);
      this.changed();
    } else if (c.kind === 'design') {
      for (const fn of this.designListeners) fn(c.ids ?? [], c.account, where);
    }
  }

  private changed(): void {
    for (const fn of this.peerListeners) fn();
  }
}

/** A steady colour per person, from their account name. */
export function personColor(account: string): string {
  let h = 0;
  for (const ch of account) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 36%)`;
}

/** Up to two initials for a person's chip. */
export function initials(account: string): string {
  const words = account.trim().split(/[\s._@-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}
