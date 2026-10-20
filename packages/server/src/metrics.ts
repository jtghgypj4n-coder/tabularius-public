import { clientAddress } from './client-address.ts';
// Health and metrics, for load balancers, container orchestrators and
// monitoring (Prometheus, Grafana, Datadog's OpenMetrics check).
//
//   GET /tabularius/health                 200 {"status":"ok"} while the server is serving: no sign-in,
//                                        and nothing about the files
//   GET /tabularius/admin/v1/metrics       Prometheus text format, with the admin console's sign-in
//                                        (Prometheus: basic_auth with the admin password)
//
// Metrics: requests by kind and status, their durations, sessions, live
// update streams, record locks, PostgreSQL connections, file sizes, backups
// (scheduled, progressive, off-site), script schedules, the certificate's
// expiry, standbys and the process (memory, CPU, event loop delay).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Host } from './host.ts';
import { STORE_EXT } from './host.ts';
import { SERVER_VERSION } from './version.ts';
import { freeBytes, type StatFs } from './disk.ts';
import type { RequestGate } from './request-gate.ts';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const ROUTES = new Set(['admin', 'app', 'assistant', 'auth', 'containers', 'debug', 'design', 'health', 'images', 'live', 'replication', 'sql']);

/** The kind of request, from its path: a fixed few, so series stay few whatever is asked for. */
export function routeOf(path: string): string {
  if (path.startsWith('/fmi/data/')) return 'dataapi';
  if (path === '/fmi/odata/v4' || path.startsWith('/fmi/odata/')) return 'odata';
  if (path.startsWith('/fmi/xml/')) return 'xml';
  if (path.startsWith('/fmi/admin/')) return 'adminapi';
  if (path === '/mcp') return 'mcp';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path.startsWith('/app/')) return 'app';
  if (path === '/') return 'root';
  const m = /^\/tabularius\/(\w+)/.exec(path);
  return m && ROUTES.has(m[1]) ? m[1] : 'other';
}

/** What the metrics read from the rest of the server. */
export interface MetricSources {
  host: Host;
  clients(): { db: string }[];
  liveStreams(): number;
  /** Sessions in memory, timed-out ones not yet swept included. */
  sessionsHeld?(): number;
  pgConnections?(): number;
  backups?: { last?: { at: number; ok: boolean } };
  progressive?: { last?: { at: number; ok: boolean } };
  offsite?: { last?: { at: number; ok: boolean } };
  schedules?(): { id: string; name: string; enabled: boolean; next?: string; last?: { at: string; error: number }; runs?: number; failures?: number }[];
  certificateExpires?(): number | undefined;
  /** The folders whose free disk space is reported, by what they are for. */
  diskFree?(): { area: string; path: string }[];
  /** How the system says what is free (statfs; replaced in tests). */
  statfs?: StatFs;
  standbys?(): { from: string; file: string; behind: number; at: number }[];
}

export interface CallTotals {
  calls: number;
  seconds: number;
  bytesIn: number;
  bytesOut: number;
  inProgress: number;
}

/** A call that finished, as stats-log.ts adds it up. */
export interface FinishedCall {
  route: string;
  method: string;
  path: string;
  client: string;
  start: number;
  end: number;
  seconds: number;
  bytesIn: number;
  bytesOut: number;
}

/** One process's request counts and durations, as passed to the others of a cluster (see cluster.ts). */
export interface RequestSnapshot {
  /** Calls made, seconds spent on them, bytes in and out, and calls under way (for Stats.log). */
  totals?: CallTotals;
  requests: [string, number][];
  durations: [string, { buckets: number[]; sum: number; count: number }][];
  gate?: { active: number; queued: number; shed: number };
}

export class Metrics {
  requestGate?: RequestGate;
  private readonly started = Date.now();
  private readonly startedTick = performance.now();
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, { buckets: number[]; sum: number; count: number }>();
  private readonly loop: IntervalHistogram;
  sources?: MetricSources;
  private readonly callTotals: CallTotals = { calls: 0, seconds: 0, bytesIn: 0, bytesOut: 0, inProgress: 0 };
  /** Told of every call that finishes (streams excepted). */
  onCall?: (call: FinishedCall) => void;
  /** The other worker processes' requests (a cluster's), added to this one's. */
  elsewhere?: () => RequestSnapshot[];

  /** This process's request counts and durations, to pass on. */
  snapshot(): RequestSnapshot {
    return { totals: { ...this.callTotals }, requests: [...this.requests], durations: [...this.durations].map(([k, d]) => [k, { ...d, buckets: [...d.buckets] }]),
      ...(this.requestGate ? { gate: { active: this.requestGate.running, queued: this.requestGate.queued, shed: this.requestGate.shed } } : {}) };
  }

  /** Every call so far, the other workers' of a cluster included. */
  totals(): CallTotals {
    const t = { ...this.callTotals };
    for (const o of this.elsewhere?.() ?? []) {
      if (!o.totals) continue;
      t.calls += o.totals.calls;
      t.seconds += o.totals.seconds;
      t.bytesIn += o.totals.bytesIn;
      t.bytesOut += o.totals.bytesOut;
      t.inProgress += o.totals.inProgress;
    }
    return t;
  }

  constructor() {
    this.loop = monitorEventLoopDelay({ resolution: 20 });
    this.loop.enable();
  }

  stop(): void {
    this.loop.disable();
  }

  /** Counts a request when it finishes; streams (live updates, long polls) count but aren't timed. */
  track(req: IncomingMessage, res: ServerResponse, path: string): void {
    const start = process.hrtime.bigint();
    const route = routeOf(path);
    const startedAt = Date.now();
    const sock = req.socket;
    const read0 = sock?.bytesRead ?? 0;
    const written0 = sock?.bytesWritten ?? 0;
    const streamPath = route === 'live' || path.endsWith('/changes') || path === '/tabularius/health';
    if (!streamPath) {
      this.callTotals.inProgress++;
      res.once('close', () => { this.callTotals.inProgress--; });
    }
    res.once('finish', () => {
      const key = `${route}\0${req.method ?? 'GET'}\0${Math.floor(res.statusCode / 100)}xx`;
      this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
      const streamed = String(res.getHeader('content-type') ?? '').startsWith('text/event-stream') || path.endsWith('/changes');
      if (streamed) return;
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      if (!streamPath) {
        // The connection's counters, as far as this call used them (calls on one connection follow one another).
        const bytesIn = Math.max(0, (sock?.bytesRead ?? 0) - read0);
        const bytesOut = Math.max(0, (sock?.bytesWritten ?? 0) - written0);
        const t = this.callTotals;
        t.calls++;
        t.seconds += seconds;
        t.bytesIn += bytesIn;
        t.bytesOut += bytesOut;
        this.onCall?.({ route, method: req.method ?? 'GET', path, client: clientAddress(req), start: startedAt, end: Date.now(), seconds, bytesIn, bytesOut });
      }
      let d = this.durations.get(route);
      if (!d) this.durations.set(route, (d = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
      BUCKETS.forEach((b, i) => {
        if (seconds <= b) d.buckets[i]++;
      });
      d.sum += seconds;
      d.count++;
    });
  }

  /** The health check's answer. */
  health(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      .end(JSON.stringify({ status: 'ok', uptimeSeconds: Math.round((performance.now() - this.startedTick) / 1000) }));
  }

  /** Everything, in Prometheus's text format (version 0.0.4). */
  render(): string {
    const out: string[] = [];
    const metric = (name: string, type: 'gauge' | 'counter' | 'histogram', help: string, samples: [labels: Record<string, string | number>, value: number][]) => {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, value] of samples) out.push(`${name}${labelText(labels)} ${num(value)}`);
    };
    const one = (value: number | undefined): [Record<string, string>, number][] => (value === undefined ? [] : [[{}, value]]);
    const s = this.sources;

    metric('tabularius_up', 'gauge', 'The server is serving.', [[{}, 1]]);
    metric('tabularius_build_info', 'gauge', 'The server build version.', [[{ version: SERVER_VERSION }, 1]]);
    metric('tabularius_start_time_seconds', 'gauge', 'When the server started (Unix time).', [[{}, this.started / 1000]]);
    if (this.requestGate) {
      const others = this.elsewhere?.() ?? [];
      metric('tabularius_request_gate_active', 'gauge', 'Short HTTP requests holding a request slot across workers.', [[{}, this.requestGate.running + others.reduce((n, x) => n + (x.gate?.active ?? 0), 0)]]);
      metric('tabularius_request_gate_queue_depth', 'gauge', 'Short HTTP requests waiting for a slot across workers.', [[{}, this.requestGate.queued + others.reduce((n, x) => n + (x.gate?.queued ?? 0), 0)]]);
      metric('tabularius_request_gate_shed_total', 'counter', 'Requests refused because the queue filled or their wait expired across workers.', [[{}, this.requestGate.shed + others.reduce((n, x) => n + (x.gate?.shed ?? 0), 0)]]);
    }

    // Every worker's, with several.
    const requests = new Map(this.requests);
    const durations = new Map([...this.durations].map(([k, d]) => [k, { ...d, buckets: [...d.buckets] }]));
    for (const o of this.elsewhere?.() ?? []) {
      for (const [k, v] of o.requests) requests.set(k, (requests.get(k) ?? 0) + v);
      for (const [k, x] of o.durations) {
        const d = durations.get(k);
        if (!d) durations.set(k, { ...x, buckets: [...x.buckets] });
        else {
          x.buckets.forEach((n, i) => { d.buckets[i] = (d.buckets[i] ?? 0) + n; });
          d.sum += x.sum;
          d.count += x.count;
        }
      }
    }
    metric('tabularius_http_requests_total', 'counter', 'HTTP requests by kind, method and status class.',
      [...requests].map(([k, v]) => {
        const [route, method, status] = k.split('\0');
        return [{ route, method, status }, v];
      }));
    out.push('# HELP tabularius_http_request_duration_seconds Time to answer HTTP requests, by kind (streams excluded).', '# TYPE tabularius_http_request_duration_seconds histogram');
    for (const [route, d] of durations) {
      BUCKETS.forEach((b, i) => out.push(`tabularius_http_request_duration_seconds_bucket${labelText({ route, le: b })} ${d.buckets[i]}`));
      out.push(`tabularius_http_request_duration_seconds_bucket${labelText({ route, le: '+Inf' })} ${d.count}`);
      out.push(`tabularius_http_request_duration_seconds_sum${labelText({ route })} ${num(d.sum)}`);
      out.push(`tabularius_http_request_duration_seconds_count${labelText({ route })} ${d.count}`);
    }

    if (s) {
      const names = s.host.names();
      const clients = s.clients();
      metric('tabularius_files', 'gauge', 'Hosted files.', [[{}, names.length]]);
      metric('tabularius_file_size_bytes', 'gauge', 'Size of each hosted file, with its write-ahead log.', names.map((n) => {
        const file = join(s.host.dir, n + STORE_EXT);
        return [{ file: n }, size(file) + size(file + '-wal')];
      }));
      metric('tabularius_sessions', 'gauge', 'Signed-in sessions (web client, Data API), by file.', names.map((n) => [{ file: n }, clients.filter((c) => c.db.toLowerCase() === n.toLowerCase()).length]));
      metric('tabularius_record_locks', 'gauge', 'Records being edited, by file.', names.map((n) => [{ file: n }, s.host.get(n)?.locks.all().length ?? 0]));
      metric('tabularius_live_streams', 'gauge', 'Open live-update streams.', [[{}, s.liveStreams()]]);
      metric('tabularius_server_scripts_running', 'gauge', 'Server-side scripts running (Perform Script on Server, schedules).', [[{}, s.host.serverScripts.running]]);
      metric('tabularius_server_scripts_queued', 'gauge', 'Server-side scripts waiting for a turn.', [[{}, s.host.serverScripts.queued]]);
      if (s.sessionsHeld) metric('tabularius_sessions_held', 'gauge', 'Sessions kept in memory, timed-out ones not yet cleared included.', [[{}, s.sessionsHeld()]]);
      if (s.pgConnections) metric('tabularius_postgresql_connections', 'gauge', 'Open PostgreSQL-protocol connections.', [[{}, s.pgConnections()]]);

      const outcome = (name: string, what: string, last: { at: number; ok: boolean } | undefined) => {
        if (!last) return;
        metric(`tabularius_${name}_last_run_timestamp_seconds`, 'gauge', `When the last ${what} ran (Unix time).`, [[{}, last.at / 1000]]);
        metric(`tabularius_${name}_last_run_ok`, 'gauge', `1 when the last ${what} worked, 0 when it failed.`, [[{}, last.ok ? 1 : 0]]);
      };
      outcome('backup', 'scheduled backup', s.backups?.last);
      outcome('progressive_backup', 'progressive backup', s.progressive?.last);
      outcome('offsite_backup', 'off-site copy', s.offsite?.last);

      const schedules = s.schedules?.() ?? [];
      if (schedules.length) {
        const labels = (x: { id: string; name: string }) => ({ schedule: x.name, id: x.id });
        metric('tabularius_schedule_enabled', 'gauge', 'Script schedules, 1 when enabled.', schedules.map((x) => [labels(x), x.enabled ? 1 : 0]));
        metric('tabularius_schedule_next_run_timestamp_seconds', 'gauge', 'When each schedule runs next (Unix time).',
          schedules.filter((x) => x.next).map((x) => [labels(x), Date.parse(x.next!) / 1000]));
        metric('tabularius_schedule_last_run_timestamp_seconds', 'gauge', 'When each schedule last ran (Unix time).',
          schedules.filter((x) => x.last).map((x) => [labels(x), Date.parse(x.last!.at) / 1000]));
        metric('tabularius_schedule_last_error', 'gauge', "The last run's FileMaker error code (0: none).",
          schedules.filter((x) => x.last).map((x) => [labels(x), x.last!.error]));
        metric('tabularius_schedule_runs_total', 'counter', 'Runs since the server started.', schedules.map((x) => [labels(x), x.runs ?? 0]));
        metric('tabularius_schedule_failures_total', 'counter', 'Runs that ended with an error since the server started.', schedules.map((x) => [labels(x), x.failures ?? 0]));
      }
      metric('tabularius_certificate_expiry_timestamp_seconds', 'gauge', 'When the HTTPS certificate expires (Unix time).', one(s.certificateExpires?.() && s.certificateExpires!()! / 1000));
      const disks = (s.diskFree?.() ?? []).map((d) => ({ ...d, bytes: freeBytes(d.path, s.statfs) })).filter((d): d is typeof d & { bytes: number } => d.bytes !== undefined);
      if (disks.length) metric('tabularius_disk_free_bytes', 'gauge', 'Free disk space where the files (data) and the backups (backups) are kept.', disks.map((d) => [{ area: d.area }, d.bytes]));
      const standbys = s.standbys?.() ?? [];
      if (standbys.length) {
        metric('tabularius_standby_behind', 'gauge', 'Changes each standby has yet to copy, by standby address and file.', standbys.map((c) => [{ standby: c.from, file: c.file }, c.behind]));
        metric('tabularius_standby_last_seen_timestamp_seconds', 'gauge', 'When each standby last asked for changes (Unix time).', standbys.map((c) => [{ standby: c.from, file: c.file }, c.at / 1000]));
      }
    }

    const mem = process.memoryUsage();
    metric('process_resident_memory_bytes', 'gauge', 'Resident memory.', [[{}, mem.rss]]);
    metric('nodejs_heap_used_bytes', 'gauge', 'JavaScript heap in use.', [[{}, mem.heapUsed]]);
    // Timers, sockets and the like keeping the process busy: a number that only grows is a leak.
    metric('nodejs_active_resources', 'gauge', 'Active timers, sockets and other handles.', [[{}, process.getActiveResourcesInfo().length]]);
    const cpu = process.cpuUsage();
    metric('process_cpu_seconds_total', 'counter', 'CPU time used (user and system).', [[{}, (cpu.user + cpu.system) / 1e6]]);
    metric('nodejs_eventloop_delay_p99_seconds', 'gauge', 'Event loop delay, 99th percentile since the last scrape: how long requests wait for the server.', [[{}, this.loop.percentile(99) / 1e9]]);
    this.loop.reset();
    return out.join('\n') + '\n';
  }
}

function size(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

const num = (v: number) => (Number.isFinite(v) ? String(v) : v > 0 ? '+Inf' : v < 0 ? '-Inf' : 'NaN');

function labelText(labels: Record<string, string | number>): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}
