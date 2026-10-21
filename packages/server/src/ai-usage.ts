// What the AI assistant has used, kept in one small SQLite file in the server's folder so every worker process
// counts toward the same limits: the day's tokens (the server's and each account's), the month's tokens and
// approximate cost against its budget, and the latest questions for the admin console. Never a question's or an
// answer's text: only when, which file and account, the model, the time taken, tokens and cost.
//
// Each change is one atomic statement (an UPSERT adding to a total), so ten workers answering at once add up
// exactly; reads see every worker's writes. A file left by an older server (.openhbam-ai-usage.json) is read
// once into the new one.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const USAGE_DB = '.openhbam-ai-usage.sqlite';
const OLD_USAGE_FILE = '.openhbam-ai-usage.json';

/** One finished question, for the admin console. */
export interface QuestionRecord {
  at: string;
  database: string;
  account: string;
  /** What asked: the assistant, a digest, an import, a conversion guide. */
  via: string;
  model: string;
  ms: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd?: number;
  steps: number;
}

export interface MonthUsage {
  month: string;
  tokens: number;
  costUsd: number;
  questions: number;
  /** Calls to models with no known price, so not in costUsd. */
  unpriced: number;
}

const RECENT = 50;
/** The server's own total for a day, beside each account's. */
const SERVER = '';

const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

/** What the assistant reads and adds to: the shared file, or (when it can't be used) this process's own count. */
export interface UsageCounts {
  today(who?: string): number;
  month(): MonthUsage;
  recent(): QuestionRecord[];
  add(who: string, tokens: number, costUsd: number, at?: Date): void;
  question(q: QuestionRecord): void;
}

/**
 * The shared file when it can be opened, otherwise a count kept in this process (logged once), so the limits still
 * hold, per process, on a folder the server can't write to. Nothing is created until something is used.
 */
export function openUsage(dir: string, log: (msg: string) => void = () => {}): UsageCounts {
  try {
    return new AiUsage(dir);
  } catch (e) {
    log(`AI usage: can't use ${join(dir, USAGE_DB)} (${(e as Error).message}); counting in this process only, so with several workers each keeps its own limits`);
    return new MemoryUsage();
  }
}

/** Whether a usage file exists yet, so a read with nothing used makes no file. */
export const usageFileExists = (dir: string): boolean => existsSync(join(dir, USAGE_DB));

/** Whether an older server's JSON count is waiting to be read in (there is no shared file yet). */
export const oldUsageWaiting = (dir: string): boolean => !usageFileExists(dir) && existsSync(join(dir, OLD_USAGE_FILE));

/** This process's own count, for when the shared file can't be used. */
export class MemoryUsage implements UsageCounts {
  private days = new Map<string, number>();
  private months = new Map<string, MonthUsage>();
  private day = dayOf();
  private saturated = false;
  private latest: QuestionRecord[] = [];
  private rollDay(): void {
    const day = dayOf();
    if (day !== this.day) {
      this.days.clear();
      this.saturated = false;
      this.day = day;
    }
  }
  today(who = SERVER): number {
    this.rollDay();
    return this.days.get(`${this.day}\0${who}`) ?? (this.saturated ? this.days.get(`${this.day}\0${SERVER}`) ?? 0 : 0);
  }
  month(): MonthUsage {
    const month = monthOf();
    for (const key of this.months.keys()) if (key !== month) this.months.delete(key);
    return { ...(this.months.get(month) ?? { month, tokens: 0, costUsd: 0, questions: 0, unpriced: 0 }) };
  }
  recent(): QuestionRecord[] {
    return [...this.latest].reverse();
  }
  add(who: string, tokens: number, costUsd: number, at = new Date()): void {
    this.rollDay();
    const day = dayOf(at);
    for (const w of who === SERVER ? [SERVER] : [SERVER, who]) {
      const key = `${day}\0${w}`;
      if (!this.days.has(key) && this.days.size >= 1024) {
        // Do not hand forgotten accounts another allowance: the server total is a conservative fallback.
        this.saturated = true;
        continue;
      }
      this.days.set(key, (this.days.get(key) ?? 0) + tokens);
    }
    const month = monthOf(at);
    const m = this.months.get(month) ?? { month, tokens: 0, costUsd: 0, questions: 0, unpriced: 0 };
    this.months.set(month, { ...m, tokens: m.tokens + tokens, costUsd: m.costUsd + costUsd });
  }
  question(q: QuestionRecord): void {
    const m = this.month();
    this.months.set(m.month, { ...m, questions: m.questions + 1, unpriced: m.unpriced + (q.costUsd === undefined ? 1 : 0) });
    this.latest.push(q);
    if (this.latest.length > RECENT) this.latest.shift();
  }
}

export class AiUsage implements UsageCounts {
  private readonly db: DatabaseSync;

  constructor(dir: string) {
    const file = join(dir, USAGE_DB);
    // Account and file names are in it: readable by the server's user only, like the files themselves. SQLite gives
    // its -wal and -shm files the same permissions.
    if (!existsSync(file)) writeFileSync(file, '', { mode: 0o600, flag: 'a' });
    try {
      chmodSync(file, 0o600);
    } catch {
      // Another user's file on a shared folder: left as it is.
    }
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout = 5000');
    // Several workers starting at once can find the file mid-setup, and switching it to WAL doesn't wait its turn:
    // tried again for a moment.
    for (let tries = 0; ; tries++) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL');
        this.tx(() => this.db.exec(`
          CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, who TEXT NOT NULL, tokens INTEGER NOT NULL, PRIMARY KEY (day, who));
          CREATE TABLE IF NOT EXISTS monthly (month TEXT PRIMARY KEY, tokens INTEGER NOT NULL, cost REAL NOT NULL, questions INTEGER NOT NULL, unpriced INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS recent (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`));
        break;
      } catch (e) {
        if (tries >= 50 || !/locked|busy/i.test((e as Error).message)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    this.importOld(dir);
  }

  /** Tokens used today (UTC): the server's, or one account's. */
  today(who = SERVER): number {
    const row = this.db.prepare('SELECT tokens FROM daily WHERE day = ? AND who = ?').get(dayOf(), who) as { tokens: number } | undefined;
    return row?.tokens ?? 0;
  }

  /** This month's (UTC) totals. */
  month(): MonthUsage {
    const month = monthOf();
    const row = this.db.prepare('SELECT tokens, cost, questions, unpriced FROM monthly WHERE month = ?').get(month) as
      { tokens: number; cost: number; questions: number; unpriced: number } | undefined;
    return { month, tokens: row?.tokens ?? 0, costUsd: row?.cost ?? 0, questions: row?.questions ?? 0, unpriced: row?.unpriced ?? 0 };
  }

  /** The latest questions, newest first. */
  recent(): QuestionRecord[] {
    return (this.db.prepare('SELECT json FROM recent ORDER BY id DESC LIMIT ?').all(RECENT) as { json: string }[]).map((r) => JSON.parse(r.json) as QuestionRecord);
  }

  /** Adds tokens (and their cost) to today's totals, the server's and the account's, and to the month's. */
  add(who: string, tokens: number, costUsd: number, at = new Date()): void {
    if (!tokens && !costUsd) return;
    const day = dayOf(at);
    this.tx(() => {
      const daily = this.db.prepare('INSERT INTO daily (day, who, tokens) VALUES (?, ?, ?) ON CONFLICT (day, who) DO UPDATE SET tokens = tokens + excluded.tokens');
      daily.run(day, SERVER, tokens);
      if (who !== SERVER) daily.run(day, who, tokens);
      this.db.prepare(`INSERT INTO monthly (month, tokens, cost, questions, unpriced) VALUES (?, ?, ?, 0, 0)
        ON CONFLICT (month) DO UPDATE SET tokens = tokens + excluded.tokens, cost = cost + excluded.cost`).run(monthOf(at), tokens, costUsd);
    });
  }

  /** A finished question: counted for the month, and kept in the latest few. */
  question(q: QuestionRecord): void {
    this.tx(() => {
      this.db.prepare(`INSERT INTO monthly (month, tokens, cost, questions, unpriced) VALUES (?, 0, 0, 1, ?)
        ON CONFLICT (month) DO UPDATE SET questions = questions + 1, unpriced = unpriced + excluded.unpriced`).run(monthOf(), q.costUsd === undefined ? 1 : 0);
      this.db.prepare('INSERT INTO recent (json) VALUES (?)').run(JSON.stringify(q));
      this.db.prepare('DELETE FROM recent WHERE id <= (SELECT MAX(id) FROM recent) - ?').run(RECENT);
      // Days older than the month before are no use to any limit.
      this.db.prepare('DELETE FROM daily WHERE day < ?').run(dayOf(new Date(Date.now() - 62 * 86_400_000)));
    });
  }

  close(): void {
    this.db.close();
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Reads an older server's JSON file once, whichever worker gets there first. */
  private importOld(dir: string): void {
    const f = join(dir, OLD_USAGE_FILE);
    if (!existsSync(f)) return;
    this.tx(() => {
      if (this.db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('imported-json', ?)`).run(new Date().toISOString()).changes !== 1) return;
      let kept: { day?: unknown; tokens?: unknown; accounts?: unknown; month?: unknown; recent?: unknown };
      try {
        kept = JSON.parse(readFileSync(f, 'utf8'));
      } catch {
        return; // A damaged file: the count starts afresh.
      }
      // Valid JSON that is not an object (null, 5, "x", a list) is as unreadable as damaged text.
      if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return;
      if (typeof kept.day === 'string' && typeof kept.tokens === 'number' && kept.tokens >= 0) {
        const daily = this.db.prepare('INSERT OR REPLACE INTO daily (day, who, tokens) VALUES (?, ?, ?)');
        daily.run(kept.day, SERVER, kept.tokens);
        if (kept.accounts && typeof kept.accounts === 'object') {
          for (const [who, n] of Object.entries(kept.accounts)) if (typeof n === 'number' && n >= 0 && who !== SERVER) daily.run(kept.day, who, n);
        }
      }
      const m = kept.month as Record<string, unknown> | undefined;
      if (m && typeof m.month === 'string' && typeof m.tokens === 'number' && typeof m.costUsd === 'number' && typeof m.questions === 'number') {
        this.db.prepare('INSERT OR REPLACE INTO monthly (month, tokens, cost, questions, unpriced) VALUES (?, ?, ?, ?, ?)')
          .run(m.month, m.tokens, m.costUsd, m.questions, typeof m.unpriced === 'number' ? m.unpriced : 0);
      }
      if (Array.isArray(kept.recent)) {
        for (const q of kept.recent.filter((r) => r && typeof r === 'object').slice(-RECENT)) this.db.prepare('INSERT INTO recent (json) VALUES (?)').run(JSON.stringify(q));
      }
    });
  }
}
