// How much mail may go through an email connection in an hour: a runaway script or a loop stops here, and one file's
// scripts cannot use up the whole server's allowance. Counted for the server as a whole and for each file whose
// scripts are involved in a message (the call stack's files). The times of the last hour are kept in a small file
// in the hosted folder, so restarting the server does not hand a loop a fresh allowance.
//
// A message counts when it is tried, sent or not, so a loop against a failing server stops too. A message that is
// refused for being over a limit is not counted.

import { unlinkSync } from 'node:fs';
import { updateJsonStateSync, withStateLock } from '../../store/src/durable.ts';

export const MAIL_LIMIT_FILE = '.openhbam-mail-sent.json';
const HOUR = 3_600_000;

export class MailLimit {
  /** Messages an hour for the whole server. */
  perHour = 100;
  /** Messages an hour for each file whose scripts are involved in the message. */
  perFile = 50;
  /** The time now, swappable for tests. */
  clock: () => number = Date.now;
  private all: number[] = [];
  private files = new Map<string, number[]>();
  private readonly path: string;
  private readonly problem: (message: string) => void;

  constructor(path: string, problem: (message: string) => void = () => {}) {
    this.path = path;
    this.problem = problem;
  }

  /**
   * Counts a message about to be tried. Answers why it must not be sent when a limit is used up, or undefined when
   * it may go (and has been counted). `files` are the hosted files the message involves.
   */
  take(files: readonly string[]): string | undefined {
    let reason: string | undefined;
    try {
      // Recovery and the complete read/check/count/write share the same lock.
      withStateLock(this.path, () => {
        const update = () => updateJsonStateSync<{ all?: unknown; files?: unknown }>(this.path, { all: [], files: {} }, (raw) => {
          const times = (v: unknown) => Array.isArray(v) ? v.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)) : [];
          this.all = times(raw?.all);
          this.files = new Map(Object.entries(raw?.files && typeof raw.files === 'object' ? raw.files : {}).map(([k, v]) => [k, times(v)]));
          reason = this.count(files);
          return { all: this.all, files: Object.fromEntries(this.files) };
        }, { mode: 0o600 });
        try { update(); }
        catch (e) {
          if (!(e instanceof Error && e.cause instanceof SyntaxError)) throw e;
          // readJsonStateSync preserved the damaged bytes; recover while still locked.
          this.problem(`The mail count in ${this.path} could not be read (${e.message}); counting from now`);
          unlinkSync(this.path);
          update();
        }
      });
    } catch (e) {
      this.problem(`The mail count could not be saved (${(e as Error).message})`);
      // Contention must never grant a separate allowance beside another writer.
      if ((e as NodeJS.ErrnoException).code === 'STATE_LOCK_TIMEOUT') return 'mail count is busy; nothing was sent';
      return 'mail count could not be saved; nothing was sent';
    }
    return reason;
  }

  private count(files: readonly string[]): string | undefined {
    const now = this.clock();
    this.prune(now);
    const names = [...new Set(files.map((f) => f.toLowerCase()))];
    for (const n of names) {
      if ((this.files.get(n) ?? []).length >= this.perFile) {
        return `mail from ${files.find((f) => f.toLowerCase() === n)} through connections is limited to ${this.perFile} messages an hour; nothing was sent`;
      }
    }
    if (this.all.length >= this.perHour) return `mail through connections is limited to ${this.perHour} messages an hour; nothing was sent`;
    this.all.push(now);
    for (const n of names) this.files.set(n, [...(this.files.get(n) ?? []), now]);
    return undefined;
  }

  /** Forgets everything counted (for tests, and for an operator who deletes the file). */
  reset(): void {
    this.all = [];
    this.files = new Map();
    updateJsonStateSync(this.path, { all: [], files: {} }, () => ({ all: [], files: {} }), { mode: 0o600 });
  }

  private prune(now: number): void {
    this.all = this.all.filter((t) => now - t < HOUR);
    for (const [k, v] of this.files) {
      const kept = v.filter((t) => now - t < HOUR);
      if (kept.length) this.files.set(k, kept);
      else this.files.delete(k);
    }
  }
}
