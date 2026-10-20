// The log line for a fault of the server's own (an error that is neither an API error nor a store error). The client
// is told "Unknown error"; the cause goes to the log, but only so many per minute, so a caller who triggers one over
// and over can't fill the disk. The first ones of each minute keep their cause; the rest are counted, and the count is
// logged when the next minute begins.

import { monotonicClock } from '../../store/src/monotonic.ts';

export const FAULT_LOGS_PER_MINUTE = 20;

// The sink looks console.error up at each call, so a test that replaces it sees the lines.
export interface FaultLog {
  (e: unknown): void;
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
      sink(e);
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
  return e instanceof Error ? e.message : String(e);
}
