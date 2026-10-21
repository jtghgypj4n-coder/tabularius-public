// A dry run of a drafted script: the assistant's draft runs on a throwaway
// copy of the file, offline (no network, no mail, no plug-ins: the engine's
// defaults, never relaxed here), so the person sees what happens before they
// put it in the script editor. The live file is never touched, so nobody
// else's work can be rolled back with it.

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type Privileges } from '../../store/src/index.ts';
import { recordChanges, runScript, startingPoints, offlineScriptOptions, type RecordChanges } from '../../scripts/src/index.ts';
import type { Script } from '../../fmp12/src/index.ts';

export interface DryRun {
  outcome: 'ok' | 'error' | 'stalled' | 'skipped';
  /** Get ( LastError ) at the end. */
  error?: number;
  steps?: number;
  /** The layout it started on. */
  layout?: string;
  /** The last step that set an error (or the last step run, when it stalled), and why. */
  step?: string;
  message?: string;
  /**
   * Each record the run created, changed or deleted, field by field, before and after (only when asked for: for the
   * person who asked for the draft, never for the model).
   */
  changes?: RecordChanges & { incomplete?: boolean };
}

/** Records listed in a draft's dry run, and the characters of values they may hold in all (a wide table's records are big). */
const DRAFT_RECORDS = 50;
const DRAFT_CHARS = 200_000;

/** The first records whose values fit in DRAFT_CHARS; the rest are counted. */
export function fitChanges(c: RecordChanges): RecordChanges {
  let chars = 0;
  const fits = c.records.findIndex((r) => (chars += r.fields.reduce((n, f) => n + f.field.length + f.before.length + f.after.length, 0)) > DRAFT_CHARS);
  return fits < 0 ? c : { ...c, records: c.records.slice(0, fits), more: c.more + c.records.length - fits };
}

/** Files larger than this aren't copied for a dry run (the copy takes a while and the disk). */
export const DRY_RUN_MAX_BYTES = 200 * 1024 * 1024;

export async function dryRunScript(store: Store, name: string, text: string, maxBytes = DRY_RUN_MAX_BYTES, opts: { changes?: boolean } = {}): Promise<DryRun> {
  const existing = store.schema.scripts.find((s) => s.name === name);
  const change = existing ? { op: 'updateScript', script: existing.id, text } : { op: 'createScript', name, text };
  return (await dryRunChanges(store, [change], [name], maxBytes, opts))[0].run;
}

/**
 * Design changes applied to a throwaway copy of the file, then each named script run there once, offline:
 * what a proposed fix does before anyone applies it.
 */
export async function dryRunChanges(store: Store, changes: unknown[], scripts: string[], maxBytes = DRY_RUN_MAX_BYTES, opts: { changes?: boolean; readOtherFile?: (file: Store) => boolean; privileges?: Privileges } = {}): Promise<{ script: string; run: DryRun }[]> {
  if (!scripts.length) return [];
  let size = 0;
  try {
    size = statSync(store.path).size;
  } catch {
    // a store without a file (in memory): copy it anyway
  }
  const all = (run: DryRun) => scripts.map((script) => ({ script, run }));
  if (size > maxBytes) return all({ outcome: 'skipped', message: `the file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, too large to copy for a dry run` });
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-dryrun-'));
  const documents = join(dir, 'documents');
  let copy: Store | undefined;
  try {
    const file = join(dir, 'copy.sqlite');
    await store.backup(file);
    copy = new Store(file, store.name);
    copy.readContainersLike(store); // its externally stored container files stay where they are
    // The copy sees other hosted files only while the changes apply, and only those the caller may design (as the real change would); scripts run on it with no other file.
    if (opts.readOtherFile) copy.resolveFile = (name) => store.resolveFile(name);
    copy.applyDesign(changes as never, { account: 'AI dry run', ...(opts.readOtherFile ? { readOtherFile: opts.readOtherFile } : {}), ...(opts.privileges ? { privileges: opts.privileges } : {}) });
    copy.resolveFile = () => undefined;
    const out: { script: string; run: DryRun }[] = [];
    for (const name of scripts) {
      const script = copy.schema.scripts.find((s) => s.name === name);
      out.push({ script: name, run: script ? await runOnce(copy, script) : { outcome: 'skipped', message: 'no script by that name after the changes' } });
    }
    return out;
  } catch (e) {
    return all({ outcome: 'error', error: -1, message: (e as Error).message });
  } finally {
    copy?.close();
    rmSync(dir, { recursive: true, force: true });
  }

  async function runOnce(copy: Store, script: Script): Promise<DryRun> {
    const layout = startingPoints(copy).get(script.id)?.layout;
    const before = copy.auditLog({ limit: 1 }).at(-1)?.seq ?? 0;
    const r = await runScript(copy, script, offlineScriptOptions({ ...(layout ? { layout } : {}), documents, timeoutMs: 5_000, maxSteps: 20_000, trace: true }));
    let changed: DryRun['changes'];
    if (opts.changes) {
      const entries = copy.auditLog({ afterSeq: before, limit: 10_000 });
      const found = fitChanges(recordChanges(entries, DRAFT_RECORDS));
      if (found.records.length || found.truncated.length) changed = { ...found, ...(entries.length >= 10_000 ? { incomplete: true } : {}) };
    }
    const trace = r.trace ?? [];
    const stalled = r.actions.some((a) => a.step === 'Halt Script' && /limit reached/.test(String(a.reason)));
    const last = stalled ? trace[trace.length - 1] : [...trace].reverse().find((t) => t.error);
    return {
      outcome: stalled ? 'stalled' : r.error ? 'error' : 'ok',
      error: r.error,
      steps: r.steps,
      ...(layout ? { layout } : {}),
      ...(last ? { step: `${last.script}: ${last.line.replace(/\s+/g, ' ').slice(0, 200)}` } : {}),
      ...(last?.message ? { message: last.message } : {}),
      ...(changed ? { changes: changed } : {}),
    };
  }
}
