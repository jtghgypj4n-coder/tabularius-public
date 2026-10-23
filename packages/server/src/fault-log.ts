// The log line for a fault of the server's own (an error that is neither an API error nor a store error). The client
// is told "Unknown error"; the cause goes to the log, but only so many per minute, so a caller who triggers one over
// and over can't fill the disk. The first ones of each minute keep their cause; the rest are counted, and the count is
// logged when the next minute begins.

import { homedir } from 'node:os';
import { redactDiagnosticText } from '../../scripts/src/redaction.ts';
import { monotonicClock } from '../../store/src/monotonic.ts';

export const FAULT_LOGS_PER_MINUTE = 20;

// The sink looks console.error up at each call, so a test that replaces it sees the lines.
export interface FaultLog {
  (e: unknown): void;
}

// An absolute path in a fault's text names the machine's layout (the data folder, the account it runs as). The log keeps
// the file's own name and hides the folders above it: a path under the home folder becomes [home]/<name>, any other with
// two or more folders becomes [path]/<name>. A URL is not a path. The "at ..." frames of a stack are the code's own
// locations, which a person debugging needs whole, so they are left as they are.
const POSIX_PATH = /(?<![\w:/.\\-])(?:file:\/\/)?(?:\/[\w.@+~%-]+){2,}/g;
const WINDOWS_PATH = /(?<![\w])[A-Za-z]:\\(?:[^\\/:*?"<>|\s]+\\)*[^\\/:*?"<>|\s]*/g;

export function redactPaths(text: string): string {
  return text.split('\n').map((line) => (/^\s+at /.test(line) ? line : redactLine(line))).join('\n');
}

function redactLine(text: string): string {
  const home = homedir();
  let out = text;
  if (home.length > 1) {
    const under = new RegExp(`(?:file://)?${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}((?:/[\\w.@+~%-]+)*)`, 'g');
    out = out.replace(under, (_all, rest: string) => rest ? `[home]/${rest.slice(rest.lastIndexOf('/') + 1)}` : '[home]');
  }
  out = out.replace(POSIX_PATH, (path) => {
    const last = path.slice(path.lastIndexOf('/') + 1);
    return `[path]/${last}`;
  });
  return out.replace(WINDOWS_PATH, (path) => `[path]\\${path.slice(path.lastIndexOf('\\') + 1)}`);
}

function diagnosticChain(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current = error;
  while (current !== undefined) {
    if (seen.has(current)) { parts.push('[circular cause]'); break; }
    seen.add(current);
    parts.push(current instanceof Error ? (current.stack ?? current.message) : String(current));
    if (!(current instanceof Error)) break;
    current = current.cause;
  }
  // Redact together so a labelled value in one error is also hidden when echoed by a cause.
  return redactPaths(redactDiagnosticText(parts.join('\nCaused by: ')));
}

export function faultLog(sink: (...args: unknown[]) => void = (...args) => console.error(...args), now: () => number = () => monotonicClock.now(), perMinute = FAULT_LOGS_PER_MINUTE,
  schedule: (fn: () => void, delay: number) => { unref?: () => void } = (fn, delay) => setTimeout(fn, delay)):
  FaultLog {
  let minute = -1;
  let logged = 0;
  let held = 0;
  let flushTimer: { unref?: () => void } | undefined;
  const scheduleFlush = () => {
    const heldMinute = minute;
    let timer: { unref?: () => void };
    timer = schedule(() => {
      if (flushTimer !== timer) return;
      flushTimer = undefined;
      if (minute !== heldMinute) {
        if (held) scheduleFlush();
        return;
      }
      if (held) {
        sink(`${held} more faults in the minute before were not logged (the first ${perMinute} of a minute are)`);
        held = 0;
      }
    }, (minute + 1) * 60_000 - now());
    flushTimer = timer;
    timer.unref?.();
  };
  return (e) => {
    const m = Math.floor(now() / 60_000);
    if (m !== minute) {
      if (held) sink(`${held} more faults in the minute before were not logged (the first ${perMinute} of a minute are)`);
      minute = m;
      logged = 0;
      held = 0;
    }
    if (logged < perMinute) {
      logged++;
      // Error inspection also prints causes and custom properties; never forward those objects.
      sink(diagnosticChain(e));
    } else {
      held++;
      if (!flushTimer) scheduleFlush();
    }
  };
}

/** The server's own log of faults, shared by the Data API and OData. */
export const logFault: FaultLog = faultLog();

/** Faults from one database get their own cap so a noisy file cannot hide another file's cause. */
const scopedFaultLogs = new WeakMap<object, FaultLog>();
export function logFaultFor(scope: object): FaultLog {
  let log = scopedFaultLogs.get(scope);
  if (!log) scopedFaultLogs.set(scope, (log = faultLog()));
  return log;
}

/**
 * Whether an error is a fault of the server's own, whose text says things a caller shouldn't read: a file-system error
 * (it names a path), a SQLite error (a table, a column, sometimes a file), or a JavaScript bug (TypeError and the like,
 * which name the code). Errors the code throws on purpose, with a message written for the caller, are not.
 * `sql` lets a SQLite error through, for the one place a caller's own SQL is run and its error is the answer.
 */
export function isFault(e: unknown, options: { sql?: boolean } = {}): boolean {
  if (!(e instanceof Error)) return false;
  if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof EvalError || e instanceof URIError) return true;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  if (code === 'ERR_SQLITE_ERROR') return !options.sql;
  return /^E[A-Z0-9]{2,}$/.test(code) || code.startsWith('ERR_');
}

/** What a caller is told in place of a fault's text (the cause is in the server log). */
export const FAULT_MESSAGE = 'Unknown error: the server hit a problem it did not expect. The cause is in the server log.';

/** An error's text for a caller: a fault of the server's own is logged and replaced by FAULT_MESSAGE, anything else is as written. */
export function callerText(e: unknown): string {
  if (isFault(e)) {
    logFault(e);
    return FAULT_MESSAGE;
  }
  // Assignments only (name=value, "name": value): a mask on every "label: word" would turn "Invalid token: signature mismatch" into nonsense.
  return redactDiagnosticText(e instanceof Error ? e.message : String(e), { labels: 'assignments' });
}
