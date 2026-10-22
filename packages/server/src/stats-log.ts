// Statistics logs in FileMaker Server's layout, so the tools people already
// point at a FileMaker Server's Logs folder (Zabbix and Splunk templates,
// log viewers, the Admin Console's statistics charts' data) read this server's:
//
//   Logs/Stats.log        one line a minute: network and disk rates, cache,
//                         clients, open files, sessions, calls per second, calls
//                         under way and the time a call takes
//   Logs/TopCallStats.log the slowest calls of each minute, summed by what was
//                         asked and who asked: when, how long, bytes each way
//
// Tab separated, a header line first, times as in the other logs, elapsed
// times in microseconds, as FileMaker Server writes them. What Tabularius does
// not measure is written as 0: cache hit and unsaved percentages (SQLite's
// page cache is not reported), and the wait and I/O parts of a call's time (a
// call's whole time is its elapsed time). Disk read and write rates are this
// process's own, from /proc/self/io where the system has it (Linux; elsewhere
// they are 0); a cluster's Stats.log line holds the process that writes it.
// Bytes are those of the connection the call used, so live-update streams
// (which never end) are left out.
//
// Off with `statsInterval: 0`; `serve --stats-interval 30s` changes the minute.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { appendFileSync, readFileSync, renameSync } from '../../store/src/fs-boundary.ts';
import { join } from 'node:path';
import type { FinishedCall, Metrics } from './metrics.ts';
import { DEFAULT_LOG_LIMIT, logTime, redactPath } from './server-logs.ts';

export const STATS_HEADER = ['Timestamp', 'Network KB/sec In', 'Network KB/sec Out', 'Disk KB/sec Read', 'Disk KB/sec Write', 'Cache Hit %', 'Cache Unsaved %', 'Pro Clients', 'Open Databases', 'Sessions', 'Remote Calls/sec', 'Remote Calls In Progress', 'Elapsed Time/call', 'Wait Time/call', 'I/O Time/call'];
export const TOP_CALL_HEADER = ['Timestamp', 'Start Time', 'End Time', 'Total Elapsed', 'Operation', 'Target', 'Client Name', 'Network Bytes In', 'Network Bytes Out', 'Elapsed Time', 'Wait Time', 'I/O Time'];
const MAX_TIMER_MS = 2_147_483_647;

const OPERATIONS: Record<string, string> = {
  dataapi: 'Data API', odata: 'OData', adminapi: 'Admin API', mcp: 'MCP', sql: 'SQL', admin: 'Admin Console', app: 'Web Client', assistant: 'AI Assistant', containers: 'Container', design: 'Design', auth: 'Sign-in',
};
const TOP_CALLS = 25;

/** What the lines are made from. */
export interface StatsSources {
  clients(): number;
  openFiles(): number;
  sessions(): number;
  /** Bytes this process has read from and written to disk so far, when the system says (default: /proc/self/io). */
  disk?(): { read: number; write: number } | undefined;
}

/** Bytes this process has read from and written to storage, from Linux's /proc/self/io; undefined elsewhere. */
export function procDiskBytes(file = '/proc/self/io'): { read: number; write: number } | undefined {
  try {
    const text = readFileSync(file, 'utf8');
    const read = /^read_bytes:\s*(\d+)/m.exec(text)?.[1];
    const write = /^write_bytes:\s*(\d+)/m.exec(text)?.[1];
    return read === undefined || write === undefined ? undefined : { read: Number(read), write: Number(write) };
  } catch {
    return undefined;
  }
}

interface Tally { op: string; target: string; client: string; first: number; last: number; seconds: number; count: number; bytesIn: number; bytesOut: number }

export class StatsLog {
  private readonly dir: string;
  private readonly metrics: Metrics;
  private readonly sources: StatsSources;
  private readonly opts: { intervalMs: number; stats: boolean; limit?: number };
  private timer?: NodeJS.Timeout;
  private last?: { at: number; calls: number; seconds: number; bytesIn: number; bytesOut: number };
  private lastDisk?: { read: number; write: number };
  private readonly calls = new Map<string, Tally>();
  /** Only one process of a cluster writes Stats.log (the others' calls are added in); each writes its own top calls. */
  constructor(folder: string, metrics: Metrics, sources: StatsSources, opts: { intervalMs: number; stats: boolean; limit?: number }) {
    if (!Number.isSafeInteger(opts.intervalMs) || opts.intervalMs < 0 || opts.intervalMs > MAX_TIMER_MS) throw new RangeError('stats interval must fit the runtime timer');
    if (opts.limit !== undefined && (!Number.isSafeInteger(opts.limit) || opts.limit <= 0)) throw new RangeError('log limit must be a positive safe integer');
    this.metrics = metrics;
    this.sources = sources;
    this.opts = opts;
    this.dir = join(folder, 'Logs');
  }

  start(): void {
    if (this.opts.intervalMs <= 0) return;
    this.metrics.onCall = (c) => this.add(c);
    this.last = { at: Date.now(), ...this.metrics.totals() };
    this.lastDisk = this.disk();
    this.timer = setInterval(() => this.sample(), this.opts.intervalMs);
    this.timer.unref();
  }

  private disk(): { read: number; write: number } | undefined {
    return this.sources.disk ? this.sources.disk() : procDiskBytes();
  }

  /** Writes what the last interval saw, and stops. */
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.opts.intervalMs > 0) this.sample();
    this.metrics.onCall = undefined;
  }

  private add(c: FinishedCall): void {
    const op = OPERATIONS[c.route];
    if (!op) return;
    const target = `${c.method} ${redactPath(c.path)}`;
    const key = `${op}\0${target}\0${c.client}`;
    const x = this.calls.get(key) ?? { op, target, client: c.client, first: c.start, last: c.end, seconds: 0, count: 0, bytesIn: 0, bytesOut: 0 };
    x.first = Math.min(x.first, c.start);
    x.last = Math.max(x.last, c.end);
    x.seconds += c.seconds;
    x.count++;
    x.bytesIn += c.bytesIn;
    x.bytesOut += c.bytesOut;
    this.calls.set(key, x);
    // A key per path would grow without end where paths hold ids: keep the heaviest.
    if (this.calls.size > 5000) this.keepTop(1000);
  }

  private keepTop(n: number): [string, Tally][] {
    const top = [...this.calls].sort((a, b) => b[1].seconds - a[1].seconds).slice(0, n);
    this.calls.clear();
    for (const [k, v] of top) this.calls.set(k, v);
    return top;
  }

  /** One line of Stats.log and the interval's top calls. */
  sample(now = Date.now()): void {
    const t = this.metrics.totals();
    const before = this.last ?? { at: now - this.opts.intervalMs, calls: 0, seconds: 0, bytesIn: 0, bytesOut: 0 };
    this.last = { at: now, ...t };
    const secs = Math.max(0.001, (now - before.at) / 1000);
    const calls = t.calls - before.calls;
    if (this.opts.stats) {
      const disk = this.disk();
      const rate = (now: number | undefined, was: number | undefined) => (now === undefined || was === undefined ? '0' : (Math.max(0, now - was) / 1024 / secs).toFixed(3));
      const diskRead = rate(disk?.read, this.lastDisk?.read);
      const diskWrite = rate(disk?.write, this.lastDisk?.write);
      this.lastDisk = disk;
      const row = [
        logTime(new Date(now)),
        ((t.bytesIn - before.bytesIn) / 1024 / secs).toFixed(3),
        ((t.bytesOut - before.bytesOut) / 1024 / secs).toFixed(3),
        diskRead, diskWrite, '0', '0',
        this.sources.clients(),
        this.sources.openFiles(),
        this.sources.sessions(),
        (calls / secs).toFixed(3),
        t.inProgress,
        calls ? Math.round(((t.seconds - before.seconds) / calls) * 1e6) : 0,
        0, 0,
      ];
      this.append('Stats.log', STATS_HEADER, [row.join('\t')]);
    }
    const top = this.keepTop(TOP_CALLS);
    this.calls.clear();
    if (top.length) {
      const stamp = logTime(new Date(now));
      this.append('TopCallStats.log', TOP_CALL_HEADER, top.map(([, x]) => [
        stamp, logTime(new Date(x.first)), logTime(new Date(x.last)), Math.round(x.seconds * 1e6), x.op, clean(x.target), clean(x.client), x.bytesIn, x.bytesOut, Math.round(x.seconds * 1e6), 0, 0,
      ].join('\t')));
    }
  }

  private append(name: string, header: string[], lines: string[]): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = join(this.dir, name);
      if (existsSync(file) && statSync(file).size >= (this.opts.limit ?? DEFAULT_LOG_LIMIT)) renameSync(file, join(this.dir, name.replace(/\.log$/, '-old.log')));
      appendFileSync(file, (existsSync(file) ? '' : header.join('\t') + '\n') + lines.join('\n') + '\n');
    } catch (e) {
      console.error(`logs: ${(e as Error).message}`);
    }
  }
}

const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');

/** "30s", "2m" or a bare number of seconds, in milliseconds; 0 or "off" turns the logs off. */
export function parseStatsInterval(text: string): number {
  if (text === 'off') return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/.exec(text.trim());
  if (!m) throw new Error(`--stats-interval: "${text}" is not a time like 30s or 2m`);
  const interval = Math.round(Number(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 'm' ? 60_000 : 1000));
  if (!Number.isSafeInteger(interval) || interval > MAX_TIMER_MS || (Number(m[1]) > 0 && interval === 0)) throw new Error(`--stats-interval: "${text}" is outside the supported timer range`);
  return interval;
}
