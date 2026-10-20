// Working alongside other people: record locks while editing, who else has
// a record on screen, and live changes from everyone else (see packages/server/src/live.ts).

import type { Api } from './api.ts';

export interface Change {
  kind: 'create' | 'update' | 'delete' | 'truncate' | 'lock' | 'unlock' | 'view' | 'leave' | 'design' | 'designer';
  file: string;
  table: string;
  recordId?: number;
  modId?: number;
  account?: string;
  /** Made by this session. */
  self: boolean;
  /** Design mode (table "_design"): the layouts a design change touched, or the objects a designer has selected. */
  ids?: number[];
}

const enc = encodeURIComponent;
/** Locks lapse after a minute on the server; renew well before that while still editing. */
const RENEW_MS = 20_000;

function base(api: Api): string {
  return `/tabularius/live/v1/databases/${enc(api.db)}`;
}

/** How long to wait before the next try to reconnect: 1 s, doubling to 30 s, with up to a quarter more so windows don't all return together. */
export function reconnectDelay(failures: number, random = Math.random()): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + random / 4));
}

/** Failed tries before the window says it is reconnecting (a single dropped connection reconnects at once, unseen). */
const SAY_AFTER = 2;

export interface ListenHooks {
  /** The stream is back after it dropped: changes made meanwhile were not delivered, so refresh what is shown. */
  onReconnect?: () => void;
  /** Whether live updates are flowing; false once reconnecting has been failing for a while. */
  onState?: (live: boolean) => void;
}

/**
 * Listens for changes until stopped, reconnecting after network drops with a growing pause.
 * Calls onExpired when the server ends the session, and onMessage when the
 * administrator sends a message to this client.
 */
export function listen(api: Api, onChange: (c: Change) => void, onExpired: () => void, onMessage?: (text: string) => void, hooks: ListenHooks = {}): () => void {
  let stopped = false;
  let abort = new AbortController();
  const run = async () => {
    let failures = 0;
    let dropped = false;
    while (!stopped) {
      try {
        const r = await fetch(`${base(api)}/events`, { headers: { authorization: `Bearer ${api.token}` }, signal: abort.signal });
        if (r.status === 401) {
          onExpired();
          return;
        }
        if (!r.ok || !r.body) throw new Error(`the live-update connection answered HTTP ${r.status}`);
        failures = 0;
        hooks.onState?.(true);
        if (dropped) {
          dropped = false;
          hooks.onReconnect?.();
        }
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let end: number;
          while ((end = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, end);
            buf = buf.slice(end + 2);
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (event === 'expired') {
              onExpired();
              return;
            }
            if (event === 'change' && data) onChange(JSON.parse(data) as Change);
            if (event === 'message' && data) onMessage?.((JSON.parse(data) as { text: string }).text);
          }
        }
      } catch (e) {
        if (stopped) return;
        console.warn('Live updates disconnected', e);
      }
      // The stream ended or failed: whatever changes while it is down are missed, so the window refreshes when it is back.
      dropped = true;
      failures++;
      if (failures >= SAY_AFTER) hooks.onState?.(false);
      await new Promise((ok) => setTimeout(ok, reconnectDelay(failures)));
    }
  };
  void run();
  return () => {
    stopped = true;
    abort.abort();
    abort = new AbortController();
  };
}

/** Records being edited right now, by anyone. */
export async function currentLocks(api: Api): Promise<{ file: string; table: string; recordId: number; account: string; self: boolean }[]> {
  const r = await fetch(`${base(api)}/locks`, { headers: { authorization: `Bearer ${api.token}` } });
  if (!r.ok) return [];
  return (await r.json()).locks ?? [];
}

/** Thrown when someone else is editing the record (FileMaker error 301). */
export class LockedError extends Error {
  readonly code = 301;
}

/** The record locks this window holds, renewed while held. */
export class Locks {
  private readonly api: Api;
  private readonly held = new Map<string, { layout: string; recordId: string; timer: ReturnType<typeof setInterval> }>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly releasing = new Set<Promise<void>>();
  private disposed = false;

  constructor(api: Api) {
    this.api = api;
  }

  private url(layout: string, recordId: string): string {
    return `${base(this.api)}/layouts/${enc(layout)}/records/${enc(recordId)}/lock`;
  }

  private async post(layout: string, recordId: string): Promise<void> {
    const r = await fetch(this.url(layout, recordId), { method: 'POST', headers: { authorization: `Bearer ${this.api.token}` } });
    if (r.ok) return;
    const body = await r.json().catch(() => ({}));
    if (body.error?.code === 301) throw new LockedError(body.error.message);
    // Other failures (an old server, a missing record) don't stop editing: the save reports them.
  }

  holds(layout: string, recordId: string): boolean {
    return this.held.has(`${layout}\u0000${recordId}`);
  }

  /** Locks a record for editing. Rejects with LockedError when someone else has it. */
  acquire(layout: string, recordId: string): Promise<void> {
    const key = `${layout}\u0000${recordId}`;
    if (this.held.has(key)) return Promise.resolve();
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    const p = this.post(layout, recordId).then(() => {
      if (this.disposed) return;
      const timer = setInterval(() => void this.post(layout, recordId).catch(() => {}), RENEW_MS);
      this.held.set(key, { layout, recordId, timer });
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  /** Releases a record's lock (after its edit is saved or abandoned). */
  async release(layout: string, recordId: string): Promise<void> {
    const key = `${layout}\u0000${recordId}`;
    await this.pending.get(key)?.catch(() => {});
    const lock = this.held.get(key);
    if (!lock) return;
    clearInterval(lock.timer);
    this.held.delete(key);
    const done = fetch(this.url(layout, recordId), { method: 'DELETE', headers: { authorization: `Bearer ${this.api.token}` } }).then(() => {}, () => {});
    this.releasing.add(done);
    await done;
    this.releasing.delete(done);
  }

  /** Forgets every lock and stops renewing them, for a session that is gone (there is nothing to release it on). */
  dispose(): void {
    this.disposed = true;
    for (const l of this.held.values()) clearInterval(l.timer);
    this.held.clear();
  }

  /** Releases every lock, waiting for releases already on their way too. */
  async releaseAll(): Promise<void> {
    await Promise.all([...[...this.held.values()].map((l) => this.release(l.layout, l.recordId)), ...this.releasing]);
  }
}

/** Who is looking at which record right now, by anyone. */
export async function currentViewers(api: Api): Promise<{ file: string; table: string; recordId: number; account: string; self: boolean }[]> {
  const r = await fetch(`${base(api)}/viewers`, { headers: { authorization: `Bearer ${api.token}` } }).catch(() => undefined);
  if (!r?.ok) return [];
  return (await r.json()).viewers ?? [];
}

/** Tells the server which record this window shows, so others can see it is open here. */
export class Presence {
  private readonly api: Api;
  private current?: { layout: string; recordId: string };
  private timer?: ReturnType<typeof setInterval>;

  constructor(api: Api) {
    this.api = api;
  }

  private url(c: { layout: string; recordId: string }): string {
    return `${base(this.api)}/layouts/${enc(c.layout)}/records/${enc(c.recordId)}/view`;
  }

  private send(method: string, c: { layout: string; recordId: string }): void {
    // An old server, or a record that went away, just means no presence.
    void fetch(this.url(c), { method, keepalive: true, headers: { authorization: `Bearer ${this.api.token}` } }).catch(() => {});
  }

  /** The record now on screen, or none. Returns whether that changed. */
  look(layout?: string, recordId?: string): boolean {
    const next = layout && recordId ? { layout, recordId } : undefined;
    if (next?.layout === this.current?.layout && next?.recordId === this.current?.recordId) return false;
    if (this.current) this.send('DELETE', this.current);
    clearInterval(this.timer);
    this.current = next;
    if (next) {
      this.send('POST', next);
      this.timer = setInterval(() => this.send('POST', next), RENEW_MS);
    }
    return true;
  }

  stop(): void {
    this.look();
  }
}
