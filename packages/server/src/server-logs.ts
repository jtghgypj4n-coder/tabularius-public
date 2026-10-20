// The server's logs, like FileMaker Server's Logs folder: tab-separated text
// files in <folder>/Logs, each renamed <name>-old.log when it reaches the size
// limit and started again, so a log never fills the disk.
//
//   Event.log            server start and stop, files opened, closed and paused,
//                        backups, schedules, errors
//   Access.log           sign-ins, sign-outs and failed sign-ins, by client
//   ScriptEvent.log      server-side scripts that ended with an error
//                        (FileMaker Server's FMSEScriptErrors.log)
//   fmdapi.log           every Data API call: method, path, status, error code,
//                        time taken, bytes sent, account
//   Admin.log            changes made in the admin console and Admin API
//
// Each line: timestamp, type (Information, Warning or Error), where it came
// from, and the message. Passwords never reach a log, and session tokens are
// cut out of paths. Lines are written in batches, a fraction of a second
// apart, so logging doesn't slow requests down.
//
//   GET /tabularius/admin/v1/logs                          the logs and their sizes
//   GET /tabularius/admin/v1/logs/<name>?from=&to=&type=&q=&limit=
//                                                         entries, newest first
//   GET /tabularius/admin/v1/logs/<name>/download          the file as it is

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOGS = ['Event', 'Access', 'ScriptEvent', 'fmdapi', 'Admin'] as const;
export type LogName = (typeof LOGS)[number];
export type LogType = 'Information' | 'Warning' | 'Error';

export interface LogEntry {
  at: string;
  type: LogType;
  source: string;
  message: string;
}

/** FileMaker Server's default log size limit. */
export const DEFAULT_LOG_LIMIT = 40 * 1024 * 1024;
const DEFAULT_LIMIT = DEFAULT_LOG_LIMIT;
/** The least a log limit may be (a smaller one would turn the logs over every few lines). */
const MIN_LOG_LIMIT = 64 * 1024;
/** Characters of log lines kept in memory while a log cannot be written (a full or missing disk); older ones are dropped. */
const KEEP_CHARS = 8 * 1024 * 1024;
/** How long after a failed write the lines are tried again. */
const RETRY_MS = 5000;

/** "100MB", "1.5GB", "512KB" or a bare number of megabytes, in bytes: what `--log-limit` and the settings file's `logLimit` take. */
export function parseLogLimit(text: string | number): number {
  const m = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/i.exec(String(text).trim());
  const bytes = m ? Math.round(Number(m[1]) * (({ kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 } as Record<string, number>)[(m[2] ?? 'mb').toLowerCase()])) : NaN;
  if (!(bytes >= MIN_LOG_LIMIT)) throw new Error(`--log-limit: "${text}" is not a size like 100MB or 2GB (at least 64KB)`);
  return bytes;
}

/** A timestamp like FileMaker Server's: local time with milliseconds and the offset from UTC. */
export function logTime(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} ${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
}

/** One line of a log: tabs and line breaks in the text become spaces, so each entry stays one line. */
const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

/** Session tokens in Data API paths (signing out names one) are cut out. */
export function redactPath(path: string): string {
  return path.replace(/(\/sessions\/)[^/?]+/i, '$1…').replace(/([?&](?:token|access_token|code|state)=)[^&]*/gi, '$1…');
}

export class ServerLogs {
  readonly dir: string;
  readonly limit: number;
  /** Whether this process starts a log over at the limit (in a cluster only the leader does, so two can't race). */
  readonly rotate: boolean;
  private readonly pending = new Map<LogName, string[]>();
  private timer?: NodeJS.Timeout;
  private writing: Promise<void> = Promise.resolve();
  private closed = false;
  /** Whether the last write failed (so the next failure is not printed again until one succeeds). */
  private failing = false;
  /** Told of every line as it is written (the email notifications). */
  onEntry?: (type: LogType, source: string, message: string) => void;

  constructor(folder: string, opts: { limit?: number; rotate?: boolean } = {}) {
    this.dir = join(folder, 'Logs');
    this.limit = opts.limit ?? DEFAULT_LIMIT;
    this.rotate = opts.rotate ?? true;
  }

  write(log: LogName, type: LogType, source: string, message: string): void {
    if (this.closed) return;
    try { this.onEntry?.(type, source, message); } catch { /* a listener never stops logging */ }
    const line = `${logTime()}\t${type}\t${clean(source)}\t${clean(message)}\n`;
    const lines = this.pending.get(log) ?? [];
    lines.push(line);
    this.pending.set(log, lines);
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), 200);
      this.timer.unref();
    }
  }

  event(type: LogType, message: string, source = 'server'): void {
    this.write('Event', type, source, message);
  }

  /**
   * Writes what's waiting. Lines a write could not put in the file (a full disk, a folder in the way) are kept and
   * tried again a few seconds later, in their order, so a failure that passes loses nothing.
   */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.writing = this.writing.then(async () => {
      const batch = [...this.pending];
      this.pending.clear();
      let failure: Error | undefined;
      for (const [log, lines] of batch) {
        try {
          await mkdir(this.dir, { recursive: true });
          const file = join(this.dir, `${log}.log`);
          if (this.rotate) {
            try {
              if ((await stat(file)).size >= this.limit) await rename(file, join(this.dir, `${log}-old.log`));
            } catch {
              // not there yet
            }
          }
          await appendFile(file, lines.join(''));
        } catch (e) {
          failure ??= e as Error;
          this.keep(log, lines);
        }
      }
      if (!failure) { this.failing = false; return; }
      if (!this.failing) console.error(`logs: ${failure.message} (the lines are kept and tried again)`);
      this.failing = true;
      if (!this.timer && !this.closed) {
        this.timer = setTimeout(() => void this.flush(), RETRY_MS);
        this.timer.unref();
      }
    });
    return this.writing;
  }

  /** Puts lines that were not written back ahead of any newer ones, keeping no more than KEEP_CHARS of the newest. */
  private keep(log: LogName, lines: string[]): void {
    const all = lines.concat(this.pending.get(log) ?? []);
    let size = 0;
    let from = all.length;
    while (from > 0 && size + all[from - 1].length <= KEEP_CHARS) size += all[--from].length;
    this.pending.set(log, all.slice(from));
  }

  /** Writes what's waiting at once (the server is stopping), and takes no more. */
  close(): void {
    clearTimeout(this.timer);
    this.closed = true;
    try {
      mkdirSync(this.dir, { recursive: true });
      for (const [log, lines] of this.pending) appendFileSync(join(this.dir, `${log}.log`), lines.join(''));
    } catch (e) {
      console.error(`logs: ${(e as Error).message}`);
    }
    this.pending.clear();
  }

  /** The logs there are, with their sizes (the older halves included). */
  list(): { name: LogName; bytes: number; oldBytes: number }[] {
    const size = (f: string) => (existsSync(f) ? statSync(f).size : 0);
    return LOGS.map((name) => ({ name, bytes: size(join(this.dir, `${name}.log`)), oldBytes: size(join(this.dir, `${name}-old.log`)) }));
  }

  file(name: LogName): string {
    return join(this.dir, `${name}.log`);
  }

  /**
   * Entries newest first, from the log and its older half: between `from` and
   * `to` (ms since 1970), of one type, containing `q` (any case), at most `limit`.
   */
  async read(name: LogName, filter: { from?: number; to?: number; type?: LogType; q?: string; limit?: number } = {}): Promise<{ entries: LogEntry[]; more: boolean }> {
    await this.flush();
    const limit = Math.min(Math.max(1, filter.limit ?? 500), 5000);
    const q = filter.q?.toLowerCase();
    const out: LogEntry[] = [];
    for (const f of [join(this.dir, `${name}.log`), join(this.dir, `${name}-old.log`)]) {
      if (!existsSync(f)) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const [at, type, source, ...rest] = lines[i].split('\t');
        if (!at || !type) continue;
        const message = rest.join('\t');
        if (filter.type && type !== filter.type) continue;
        if (filter.from !== undefined || filter.to !== undefined) {
          const t = parseLogTime(at);
          if (filter.from !== undefined && t < filter.from) continue;
          if (filter.to !== undefined && t > filter.to) continue;
        }
        if (q && !`${source}\t${message}`.toLowerCase().includes(q)) continue;
        if (out.length === limit) return { entries: out, more: true };
        out.push({ at, type: type as LogType, source, message });
      }
    }
    return { entries: out, more: false };
  }
}

/** ms since 1970 for a log timestamp. */
export function parseLogTime(at: string): number {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) ([+-])(\d\d)(\d\d)$/.exec(at);
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
  const off = (+m[9] * 60 + +m[10]) * (m[8] === '+' ? 1 : -1);
  return utc - off * 60_000;
}
