import type { Host } from './host.ts';

// The Access-log lines for sign-ins on OData, the XML interface, SQL over HTTP and the PostgreSQL protocol, which the
// Data API, OAuth and the web client already write, so password guessing on any way in shows in the admin log viewer.
// Anyone can cause a failure, so a minute keeps at most 30 lines of them and says how many more there were; a
// success is written once for each account and way in every 10 minutes (a BI tool's every request would fill the log).

const FAILURES_PER_MINUTE = 30;
const SUCCESS_EVERY_MS = 10 * 60_000;
const MAX_REMEMBERED = 1000;

interface State {
  start: number;
  written: number;
  dropped: number;
  seen: Map<string, number>;
}

const states = new WeakMap<Host, State>();
const CONTROL = /[\u0000-\u001f\u007f]/g;
const plain = (s: string) => s.replace(CONTROL, ' ').slice(0, 200);

/** A sign-in on `surface` ("OData", "SQL over HTTP", ...): written as a success, or as a failure with its reason. */
export function noteSurfaceSignIn(host: Host, from: string, database: string, account: string, surface: string, failure?: string): void {
  const logs = host.logs;
  if (!logs) return;
  let s = states.get(host);
  if (!s) states.set(host, (s = { start: -Infinity, written: 0, dropped: 0, seen: new Map() }));
  const now = performance.now();
  if (failure !== undefined) {
    if (now - s.start >= 60_000) {
      if (s.dropped) logs.write('Access', 'Warning', from, `${s.dropped} more failed sign-ins in the last minute were not logged one by one`);
      s.start = now;
      s.written = 0;
      s.dropped = 0;
    }
    if (s.written < FAILURES_PER_MINUTE) {
      s.written++;
      logs.write('Access', 'Warning', from, `${plain(account) || 'Someone'} could not sign in to ${plain(database)} through ${surface}: ${plain(failure)}`);
    } else s.dropped++;
    return;
  }
  const key = [database.toLowerCase(), account.toLowerCase(), surface].join('\0');
  if ((s.seen.get(key) ?? 0) > now) return;
  if (s.seen.size >= MAX_REMEMBERED) s.seen.clear();
  s.seen.set(key, now + SUCCESS_EVERY_MS);
  logs.write('Access', 'Information', from, `${plain(account)} signed in to ${plain(database)} (${surface})`);
}
