import { isDeepStrictEqual } from 'node:util';
import type { Value } from './values.ts';

interface Entry { name: string; args: Value[]; result: Value; error: boolean }
interface Journal { entries: Entry[]; cursor: number; previous?: Journal }
const journals = new WeakMap<object, Journal>();

/** Keep completed plug-in calls while one script step waits for a host result. */
export function beginMbsReplay(scope: object): Journal {
  const journal: Journal = { entries: [], cursor: 0, previous: journals.get(scope) };
  journals.set(scope, journal);
  return journal;
}

export function rewindMbsReplay(journal: Journal): void {
  journal.cursor = 0;
}

export function endMbsReplay(scope: object, journal: Journal): void {
  if (journals.get(scope) !== journal) throw new Error('Plug-in replay journal is out of order');
  if (journal.previous) journals.set(scope, journal.previous);
  else journals.delete(scope);
  journal.entries.length = 0;
}

export function replayMbsCall(scope: object, name: string, args: Value[], run: () => Value,
  error: () => boolean, restoreError: (value: boolean) => void): Value {
  const journal = journals.get(scope);
  if (!journal) return run();
  const at = journal.cursor++;
  if (at < journal.entries.length) {
    const entry = journal.entries[at];
    if (entry.name !== name.toLowerCase() || !isDeepStrictEqual(entry.args, args))
      throw new Error('Plug-in calls changed while replaying a suspended script step');
    restoreError(entry.error);
    return entry.result;
  }
  // A host wait throws here. Its call has not completed, so the next attempt runs it again.
  const result = run();
  journal.entries.push({ name: name.toLowerCase(), args, result, error: error() });
  return result;
}
