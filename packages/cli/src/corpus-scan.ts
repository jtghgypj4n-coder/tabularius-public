// tabularius corpus-scan: what a collection of FileMaker files uses, counted.
//
// Ranks what matters across real solutions (plug-in calls, functions, Get ( )
// options, script steps, layout objects, triggers, conversion failures) from
// files that may hold clients' data. So the report keeps counts only: files are
// named by a hash of their content, and formulas only ever leave as a "shape"
// with every field, variable and custom function name, string, comment and
// long number masked, kept to show how an undecoded function or plug-in call
// is used. Nothing from records, no names, no paths.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { createReadStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, encryptionInfo, fileSource, observeCalcs, readLayoutDesigns, scriptStepName, type BlockSource, type LayoutObject } from '../../fmp12/src/index.ts';
import { importFmp12 } from '../../store/src/index.ts';

type Tally = Record<string, number>;
const STAGES = ['read blocks', 'schema', 'tables', 'records', 'calcs', 'layouts', 'scripts'] as const;
export type ScanStage = typeof STAGES[number];
export interface ScanProgress {
  stage: ScanStage;
  bytesRead: number;
  tablesConverted: number;
  recordsConverted: number;
  /** Highest sampled V8 heap usage; sampled at stage changes and after each MiB read. */
  peakHeapBytes: number;
  stageMs: Partial<Record<ScanStage, number>>;
}
const PROGRESS_LINE = 'tabularius-scan-progress ';

/** What one file uses; every key is FileMaker's own vocabulary or an id, never the file's words. */
export interface FileScan {
  status: 'ok' | 'encrypted' | 'failed' | 'timeout';
  /** Why it failed: a fixed error class and code location, with no file contents. */
  error?: string;
  creator?: string;
  versionDate?: string;
  counts?: Tally;
  functions?: Tally;
  getOptions?: Tally;
  /** "OWNR:index" for each plug-in function call. */
  plugins?: Tally;
  /** MBS ( "Function.Name" ; … ): MBS's own function names. */
  mbs?: Tally;
  unknownFunctions?: Tally;
  unknownGet?: Tally;
  steps?: Tally;
  /** Script step ids Tabularius has no name for (plug-in script steps among them). */
  unknownSteps?: Tally;
  layoutObjects?: Tally;
  triggers?: Tally;
  /** Masked shapes of calls to undecoded functions and plug-in functions, by id. */
  shapes?: Record<string, string[]>;
  conversion?: { ok: boolean; error?: string; seconds: number };
  progress?: ScanProgress;
}

export interface CorpusReport {
  tool: 'tabularius corpus-scan';
  version: 1;
  scannedAt: string;
  files: { found: number; unique: number; duplicates: number; bytes: number };
  status: Tally;
  errors: Tally;
  conversion?: { ok: number; failed: number; errors: Tally };
  creators: Tally;
  /** Sums over the unique files that opened. */
  totals: Tally;
  pluginOwners: Ranked[];
  plugins: Ranked[];
  mbs: Ranked[];
  functions: Ranked[];
  unknownFunctions: Ranked[];
  getOptions: Ranked[];
  unknownGet: Ranked[];
  steps: Ranked[];
  unknownSteps: Ranked[];
  layoutObjects: Ranked[];
  triggers: Ranked[];
  /** One row per unique file, by an anonymous id (the start of its content hash). */
  perFile: (FileScan & { id: string; sizeMB: number; copies: number })[];
}

/** A name, how often it occurs, and in how many files. */
export interface Ranked {
  name: string;
  uses: number;
  files: number;
  vendor?: string;
  known?: boolean;
  shapes?: string[];
}

// Plug-in ids whose maker is known (from Tabularius's migration plans and calc decoder).
const VENDORS: Record<string, string> = {
  MBSP: 'MBS (MonkeyBread)', GyBE: 'BaseElements', '3MLR': '360Works Email', AUDI: 'DataGuard (WorldSync)',
};

const SHAPES_PER_ID = 5;
const SHAPE_LENGTH = 240;

const add = (t: Tally, k: string, n = 1) => {
  t[k] = (t[k] ?? 0) + n;
};

/** A fixed error class and code location, with no decoder message or file contents. */
export function errorClass(e: unknown): string {
  const err = e as Error;
  // Decoder messages may contain unquoted file contents. Keep only a fixed error class and code location.
  const msg = e instanceof RangeError ? 'RangeError' : e instanceof TypeError ? 'TypeError' : 'Error';
  const frame = String(err?.stack ?? '').split('\n').slice(1).map((l) => l.match(/packages\/([\w-]+\/src\/[\w.-]+):(\d+)/)).find(Boolean);
  return frame ? `${msg} @ ${frame[1]}:${frame[2]}` : msg;
}

/** The call around each marker (⟨fn:…⟩, ⟨get:…⟩, ⟨OWNR:n⟩) in a masked formula: a little before, the call and its arguments. */
export function callShapes(shape: string, marker: string): string[] {
  const out: string[] = [];
  for (let at = shape.indexOf(marker); at >= 0; at = shape.indexOf(marker, at + 1)) out.push(callShapeAt(shape, marker, at));
  return out;
}

function callShapeAt(shape: string, marker: string, at: number): string {
    let end = at + marker.length;
    const limit = Math.min(shape.length, at + SHAPE_LENGTH + 1);
    while (end < limit && /\s/.test(shape[end])) end++;
    if (shape[end] === '(') {
      let depth = 0;
      // A report keeps at most 240 characters; stop before a deep nested call
      // makes extracting every call walk the same long suffix repeatedly.
      for (; end < limit; end++) {
        if (shape[end] === '(') depth++;
        else if (shape[end] === ')' && --depth === 0) {
          end++;
          break;
        }
      }
    }
    else end = Math.min(shape.length, end + 40); // a Get ( ) option: what it's compared with
    const from = Math.max(0, at - 60);
    const text = (from > 0 ? '…' : '') + shape.slice(from, end);
    return text.length > SHAPE_LENGTH ? text.slice(0, SHAPE_LENGTH) + '…' : text;
}

function walkObjects(objects: LayoutObject[], each: (o: LayoutObject) => void): void {
  for (const o of objects) {
    each(o);
    if (o.children) walkObjects(o.children, each);
  }
}

/** Scans one file (in its own process; see corpusScan). */
export function scanFile(path: string, opts: { convert?: boolean; onProgress?: (p: ScanProgress) => void } = {}): FileScan {
  const started = performance.now();
  let stageStarted = started;
  let lastEmittedBytes = 0;
  const progress: ScanProgress = { stage: 'read blocks', bytesRead: 0, tablesConverted: 0, recordsConverted: 0, peakHeapBytes: 0, stageMs: {} };
  const emit = () => {
    progress.peakHeapBytes = Math.max(progress.peakHeapBytes, process.memoryUsage().heapUsed);
    progress.stageMs[progress.stage] = Math.round(performance.now() - stageStarted + (progress.stageMs[progress.stage] ?? 0));
    opts.onProgress?.({ ...progress, stageMs: { ...progress.stageMs } });
    delete progress.stageMs[progress.stage];
    lastEmittedBytes = progress.bytesRead;
  };
  const stage = (next: ScanStage) => {
    const now = performance.now();
    progress.stageMs[progress.stage] = Math.round(now - stageStarted + (progress.stageMs[progress.stage] ?? 0));
    progress.stage = next;
    stageStarted = now;
    emit();
  };
  const trackedSource = (): BlockSource => {
    const source = fileSource(path);
    return { size: source.size, close: () => source.close?.(), read(offset, length) {
      const data = source.read(offset, length);
      progress.bytesRead += data.length;
      if (progress.bytesRead - lastEmittedBytes >= 1 << 20) emit();
      return data;
    } };
  };
  const openTracked = (): FmpDatabase => {
    const source = trackedSource();
    try { return new FmpDatabase(source); }
    catch (error) { source.close?.(); throw error; }
  };
  const src = trackedSource();
  emit();
  let encrypted: boolean;
  try {
    encrypted = encryptionInfo(src).encrypted;
  } finally {
    src.close?.();
  }
  if (encrypted) return { status: 'encrypted', progress };
  const functions: Tally = {}, getOptions: Tally = {}, plugins: Tally = {}, mbs: Tally = {}, unknownFunctions: Tally = {}, unknownGet: Tally = {};
  const shapes: Record<string, Set<string>> = {};
  const pluginNames = new Map<string, string>();
  const counts: Tally = {}, steps: Tally = {}, unknownSteps: Tally = {}, layoutObjects: Tally = {}, triggers: Tally = {};
  const scan: FileScan = { status: 'ok', counts, functions, getOptions, plugins, mbs, unknownFunctions, unknownGet, steps, unknownSteps, layoutObjects, triggers };
  const keepShape = (marker: string, key: string, shape: string, at: number) => {
    const set = (shapes[key] ??= new Set());
    if (set.size < SHAPES_PER_ID) set.add(callShapeAt(shape, marker, at));
  };
  let db: FmpDatabase | undefined;
  try {
    db = openTracked();
    const file = db.file;
    scan.creator = file.header.creator;
    scan.versionDate = file.header.versionDate;
    stage('schema');
    observeCalcs({
      token(kind, id, name) {
        if (kind === 'function') add(functions, id);
        else if (kind === 'get') add(getOptions, id);
        else if (kind === 'plugin') {
          add(plugins, id);
          if (name) pluginNames.set(name, id);
        }
        else if (kind === 'custom') add(counts, 'customFunctionCalls');
        else if (kind === 'unknown-function') add(unknownFunctions, id);
        else add(unknownGet, id);
      },
      formula(text, shape) {
        if (progress.stage === 'schema') stage('calcs');
        add(counts, 'formulas');
        for (const m of text.matchAll(/\bMBS\s*\(\s*"([A-Za-z][\w.]{0,80})"/g)) add(mbs, m[1]);
        for (const m of shape.matchAll(/⟨(fn|get):([0-9a-f]+)⟩/g)) keepShape(m[0], `${m[1] === 'fn' ? 'function' : 'get'}:${m[2]}`, shape, m.index);
        for (const m of shape.matchAll(/⟨([^:⟩]{4}):(\d+)⟩/g)) keepShape(m[0], `${m[1] === 'FMDR' ? 'function' : 'plugin'}:${m[1]}:${m[2]}`, shape, m.index);
        // Plug-in calls the decoder already names: their shapes still show how they're used.
        for (const m of shape.matchAll(/\b[A-Za-z_][A-Za-z_0-9]*(?=\s*\()/g)) {
          const id = pluginNames.get(m[0]);
          if (id) keepShape(m[0], `plugin:${id}`, shape, m.index);
        }
      },
    }, () => {
      const s = db!.schema;
      counts.tables = s.tables.length;
      counts.fields = s.tables.reduce((n, t) => n + t.fields.length, 0);
      counts.calculationFields = s.tables.reduce((n, t) => n + t.fields.filter((f) => f.kind === 'calculation').length, 0);
      counts.summaryFields = s.tables.reduce((n, t) => n + t.fields.filter((f) => f.kind === 'summary').length, 0);
      counts.containerFields = s.tables.reduce((n, t) => n + t.fields.filter((f) => f.type === 'container').length, 0);
      counts.tableOccurrences = s.tableOccurrences.length;
      counts.relationships = s.relationships.length;
      counts.layouts = s.layouts.length;
      counts.scripts = s.scripts.length;
      counts.valueLists = s.valueLists.length;
      counts.customFunctions = s.customFunctions.length;
      counts.accounts = s.accounts.length;
      counts.privilegeSets = s.privilegeSets.length;
      counts.dataSources = s.dataSources.length;
      counts.customMenus = s.customMenus.length;
      counts.scriptSteps = 0;
      stage('scripts');
      for (const script of s.scripts) {
        for (const step of script.steps) {
          counts.scriptSteps++;
          const name = scriptStepName(step.stepId);
          if (name.startsWith('Unknown step')) add(unknownSteps, String(step.stepId));
          else add(steps, name);
        }
      }
      if (s.fileOptions?.onFirstWindowOpen) add(triggers, 'file:OnFirstWindowOpen');
      if (s.fileOptions?.onLastWindowClose) add(triggers, 'file:OnLastWindowClose');
      stage('layouts');
      const designs = readLayoutDesigns(file, s);
      for (const l of designs.layouts) {
        for (const t of l.triggers ?? []) add(triggers, `layout:${t.event}`);
        walkObjects(l.objects, (o) => {
          add(layoutObjects, o.kind);
          if (o.kind === 'chart' && o.chart) add(layoutObjects, `chart:${o.chart.type}`);
          if (o.field) add(layoutObjects, `field:${o.field.display}`);
          if (o.conditions?.length) add(counts, 'conditionalFormats', o.conditions.length);
          if (o.hide) add(counts, 'hideConditions');
          for (const t of o.triggers ?? []) add(triggers, `object:${t.event}`);
        });
      }
    });
  } catch (e) {
    scan.status = 'failed';
    scan.error = errorClass(e);
  } finally {
    db?.close();
  }
  scan.shapes = Object.fromEntries(Object.entries(shapes).map(([k, v]) => [k, [...v]]));
  if (opts.convert && scan.status === 'ok') {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-corpus-'));
    const conversionStarted = performance.now();
    let convertDb: FmpDatabase | undefined;
    try {
      stage('tables');
      convertDb = openTracked();
      importFmp12(convertDb, join(dir, 'converted.sqlite'), (p) => {
        if (progress.stage !== 'records') stage('records');
        progress.tablesConverted = p.tablesDone;
        progress.recordsConverted = p.records;
        emit();
      });
      scan.conversion = { ok: true, seconds: Math.round((performance.now() - conversionStarted) / 100) / 10 };
    } catch (e) {
      scan.conversion = { ok: false, error: errorClass(e), seconds: Math.round((performance.now() - conversionStarted) / 100) / 10 };
    } finally {
      convertDb?.close();
      // The converted copy holds the file's records: never left behind.
      rmSync(dir, { recursive: true, force: true });
    }
  }
  emit();
  scan.progress = { ...progress, stageMs: { ...progress.stageMs, [progress.stage]: Math.round(performance.now() - stageStarted + (progress.stageMs[progress.stage] ?? 0)) } };
  return scan;
}

// Folders that hold app data rather than people's files; walking a home folder's Library over a network share takes hours.
const SKIP_DIRS = new Set(['Library', 'node_modules', 'System', 'Applications']);

/** Every .fmp12 under dir (symbolic links not followed), and how many folders couldn't be read (a share's protected Desktop, say). */
export function findFiles(dir: string, opts: { all?: boolean } = {}): { paths: string[]; unreadable: number } {
  const paths: string[] = [];
  let unreadable = 0;
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch (e) {
      if (d === dir) throw e;
      unreadable++;
      return;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const p = join(d, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        unreadable++;
        continue;
      }
      if (st.isDirectory()) {
        if (opts.all || !SKIP_DIRS.has(name)) walk(p);
      }
      else if (st.isFile() && /\.fmp12$/i.test(name)) paths.push(p);
    }
  };
  walk(dir);
  return { paths: paths.sort(), unreadable };
}

/** sha256 of a file, or of its first `limit` bytes and its size. */
function sha256(path: string, limit?: number, size?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    if (limit !== undefined) h.update(`${size}:`);
    createReadStream(path, limit !== undefined ? { end: limit - 1 } : {}).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

const HEAD = 1 << 20;

/**
 * Files grouped by identical content. Over a network share most of the cost is
 * reading, so only files of the same size are compared, first by their first
 * megabyte, and only those still alike are read whole. A file alone at its size
 * is keyed by the hash of its first megabyte and size.
 */
export async function dedupe(paths: string[]): Promise<{ groups: Map<string, { path: string; size: number; copies: number }>; unreadable: number }> {
  let unreadable = 0;
  // A file that can't be read (permissions, a dropped share) is skipped and counted.
  const hash = async (p: string, limit?: number, size?: number) => {
    try {
      return await sha256(p, limit, size);
    } catch {
      unreadable++;
      return undefined;
    }
  };
  const bySize = new Map<number, string[]>();
  for (const p of paths) {
    const size = lstatSync(p).size;
    const list = bySize.get(size);
    if (list) list.push(p);
    else bySize.set(size, [p]);
  }
  const out = new Map<string, { path: string; size: number; copies: number }>();
  for (const [size, list] of bySize) {
    if (list.length === 1) {
      const h = await hash(list[0], HEAD, size);
      if (h) out.set(h, { path: list[0], size, copies: 1 });
      continue;
    }
    const byHead = new Map<string, string[]>();
    for (const p of list) {
      const h = await hash(p, HEAD, size);
      if (!h) continue;
      const same = byHead.get(h);
      if (same) same.push(p);
      else byHead.set(h, [p]);
    }
    for (const [head, same] of byHead) {
      if (same.length === 1 || size <= HEAD) {
        out.set(head, { path: same[0], size, copies: same.length });
        continue;
      }
      for (const p of same) {
        const h = await hash(p);
        if (!h) continue;
        const seen = out.get(h);
        if (seen) seen.copies++;
        else out.set(h, { path: p, size, copies: 1 });
      }
    }
  }
  return { groups: out, unreadable };
}

export function scanInChild(entry: string, path: string, convert: boolean, timeoutMs: number): Promise<FileScan> {
  return new Promise((resolve) => {
    // The child's own temporary folder, made and removed here: a converted copy (the file's records) it leaves when it is
    // killed at the timeout or crashes goes with the folder, however it ended.
    const runDir = mkdtempSync(join(tmpdir(), 'tabularius-corpus-run-'));
    let child;
    try {
      child = spawn(process.execPath, [...process.execArgv, entry, 'corpus-scan', '--one', path, ...(convert ? ['--convert'] : [])], {
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: runDir, TMP: runDir, TEMP: runDir },
      });
    } catch {
      rmSync(runDir, { recursive: true, force: true });
      resolve({ status: 'failed', error: 'process could not start' });
      return;
    }
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (scan: FileScan) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try {
        rmSync(runDir, { recursive: true, force: true });
        resolve(scan);
      } catch {
        resolve({ status: 'failed', error: 'process cleanup failed' });
      }
    };
    let out = '';
    let err = '';
    let progress: ScanProgress | undefined;
    let progressReceivedAt = 0;
    let stderrLine = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d: Buffer) => {
      stderrLine += d.toString();
      for (let at = stderrLine.indexOf('\n'); at >= 0; at = stderrLine.indexOf('\n')) {
        const line = stderrLine.slice(0, at);
        stderrLine = stderrLine.slice(at + 1);
        if (line.startsWith(PROGRESS_LINE)) {
          try { progress = JSON.parse(line.slice(PROGRESS_LINE.length)) as ScanProgress; progressReceivedAt = performance.now(); } catch { /* incomplete diagnostic */ }
        } else err = (err + line + '\n').slice(-2048);
      }
    });
    let timedOut = false;
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', () => finish({ status: 'failed', error: 'process could not start' }));
    child.on('close', (code) => {
      if (timedOut) {
        progress ??= { stage: 'read blocks', bytesRead: 0, tablesConverted: 0, recordsConverted: 0, peakHeapBytes: 0, stageMs: {} };
        progress.stageMs[progress.stage] = (progress.stageMs[progress.stage] ?? 0) + Math.round(progressReceivedAt ? performance.now() - progressReceivedAt : timeoutMs);
        finish({ status: 'timeout', progress });
        return;
      }
      try {
        const scan = JSON.parse(out) as FileScan;
        finish(progress && !scan.progress ? { ...scan, progress } : scan);
      } catch {
        // Crashed (out of memory, say): keep only the kind of failure, not its text.
        const kind = /heap out of memory/i.test(err) ? 'out of memory' : `exited with code ${code}`;
        finish({ status: 'failed', error: `process ${kind}` });
      }
    });
  });
}

/** Select by the same 12-digit content hash shown in the report. */
export function selectOnly<T>(unique: [string, T][], id: string): [string, T][] {
  if (!/^[0-9a-f]{12}$/i.test(id)) throw new Error('corpus-scan --only needs a 12 hexadecimal digit anonymous id');
  const selected = unique.filter(([hash]) => hash.slice(0, 12) === id.toLowerCase());
  if (selected.length !== 1) throw new Error(`corpus-scan --only: anonymous id was ${selected.length ? 'ambiguous' : 'not found'}`);
  return selected;
}

const ranked = (uses: Tally, files: Tally): Ranked[] =>
  Object.entries(uses).map(([name, n]) => ({ name, uses: n, files: files[name] ?? 0 })).sort((a, b) => b.files - a.files || b.uses - a.uses || a.name.localeCompare(b.name));

/** Adds up per-file scans into the corpus report. */
export function buildReport(found: number, bytes: number, scans: { id: string; sizeMB: number; copies: number; scan: FileScan }[]): CorpusReport {
  const keys = ['functions', 'getOptions', 'plugins', 'mbs', 'unknownFunctions', 'unknownGet', 'steps', 'unknownSteps', 'layoutObjects', 'triggers'] as const;
  const uses = Object.fromEntries(keys.map((k) => [k, {} as Tally])) as Record<(typeof keys)[number], Tally>;
  const files = Object.fromEntries(keys.map((k) => [k, {} as Tally])) as Record<(typeof keys)[number], Tally>;
  const status: Tally = {}, errors: Tally = {}, creators: Tally = {}, totals: Tally = {};
  const ownerUses: Tally = {}, ownerFiles: Tally = {};
  const shapes: Record<string, Set<string>> = {};
  let conversion: CorpusReport['conversion'];
  for (const { scan } of scans) {
    add(status, scan.status);
    if (scan.error) add(errors, scan.error);
    if (scan.creator) add(creators, scan.creator);
    for (const [k, n] of Object.entries(scan.counts ?? {})) add(totals, k, n);
    for (const k of keys) {
      for (const [name, n] of Object.entries(scan[k] ?? {})) {
        add(uses[k], name, n);
        add(files[k], name);
      }
    }
    const owners = new Set<string>();
    for (const [pair, n] of Object.entries(scan.plugins ?? {})) {
      const owner = pair.split(':')[0];
      add(ownerUses, owner, n);
      owners.add(owner);
    }
    for (const o of owners) add(ownerFiles, o);
    for (const [k, list] of Object.entries(scan.shapes ?? {})) {
      const set = (shapes[k] ??= new Set());
      for (const s of list) if (set.size < SHAPES_PER_ID) set.add(s);
    }
    if (scan.conversion) {
      conversion ??= { ok: 0, failed: 0, errors: {} };
      if (scan.conversion.ok) conversion.ok++;
      else {
        conversion.failed++;
        add(conversion.errors, scan.conversion.error ?? 'unknown');
      }
    }
  }
  const withShapes = (list: Ranked[], prefix: string) => list.map((r) => (shapes[prefix + r.name] ? { ...r, shapes: [...shapes[prefix + r.name]] } : r));
  const r = (k: (typeof keys)[number]) => ranked(uses[k], files[k]);
  return {
    tool: 'tabularius corpus-scan',
    version: 1,
    scannedAt: new Date().toISOString(),
    files: { found, unique: scans.length, duplicates: found - scans.length, bytes },
    status,
    errors,
    ...(conversion ? { conversion } : {}),
    creators,
    totals,
    pluginOwners: ranked(ownerUses, ownerFiles).map((o) => ({ ...o, ...(VENDORS[o.name] ? { vendor: VENDORS[o.name] } : {}) })),
    plugins: r('plugins').map((p) => {
      const owner = p.name.split(':')[0];
      return { ...p, ...(VENDORS[owner] ? { vendor: VENDORS[owner] } : {}), ...(shapes[`plugin:${p.name}`] ? { shapes: [...shapes[`plugin:${p.name}`]] } : {}) };
    }),
    mbs: r('mbs'),
    functions: r('functions'),
    unknownFunctions: withShapes(r('unknownFunctions'), 'function:'),
    getOptions: r('getOptions'),
    unknownGet: withShapes(r('unknownGet'), 'get:'),
    steps: r('steps'),
    unknownSteps: r('unknownSteps'),
    layoutObjects: r('layoutObjects'),
    triggers: r('triggers'),
    perFile: scans.map(({ id, sizeMB, copies, scan }) => {
      const { shapes: _, ...rest } = scan;
      return { id, sizeMB, copies, ...rest };
    }),
  };
}

const table = (title: string, rows: Ranked[], limit: number, cols: (r: Ranked) => string[] = (r) => [r.name, String(r.files), String(r.uses)], head = ['Name', 'Files', 'Uses']): string => {
  if (!rows.length) return `## ${title}\n\nNone.\n`;
  const lines = [`## ${title}`, '', `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows.slice(0, limit)) lines.push(`| ${cols(r).map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
  if (rows.length > limit) lines.push('', `…and ${rows.length - limit} more in the JSON report.`);
  return lines.join('\n') + '\n';
};

/** The report as Markdown: the top of each ranking. */
export function reportMarkdown(r: CorpusReport): string {
  const kv = (t: Tally) => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`).join('\n') || '- none';
  const shape = (x: Ranked) => (x.shapes?.[0] ? '`' + x.shapes[0].replace(/`/g, "'") + '`' : '');
  return [
    '# FileMaker corpus scan',
    '',
    `${r.files.found} files found, ${r.files.unique} unique by content (${r.files.duplicates} duplicates), ${Math.round(r.files.bytes / 1e6)} MB unique. Scanned ${r.scannedAt}.`,
    'Counts only: no file names, record data, field or script names. "Files" is how many unique files use it, "Uses" how often it occurs in decoded formulas, steps or layouts.',
    '',
    '## Status',
    '',
    kv(r.status),
    '',
    ...(Object.keys(r.errors).length ? ['## Read failures', '', kv(r.errors), ''] : []),
    ...(r.conversion ? ['## Conversion', '', `${r.conversion.ok} converted, ${r.conversion.failed} failed.`, '', kv(r.conversion.errors), ''] : []),
    '## Scan progress',
    '',
    '| ID | Status | Stage reached | Bytes read | Tables converted | Records converted | Peak heap bytes |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...r.perFile.map((f) => `| ${f.id} | ${f.status} | ${f.progress?.stage ?? '?'} | ${f.progress?.bytesRead ?? 0} | ${f.progress?.tablesConverted ?? 0} | ${f.progress?.recordsConverted ?? 0} | ${f.progress?.peakHeapBytes ?? 0} |`),
    '',
    '## Per-stage time (ms, summed over scanned files)',
    '',
    '| Stage | ms |',
    '| --- | ---: |',
    ...STAGES.map((stage) => `| ${stage} | ${r.perFile.reduce((n, f) => n + (f.progress?.stageMs[stage] ?? 0), 0)} |`),
    '',
    '## FileMaker versions that last saved them',
    '',
    kv(r.creators),
    '',
    '## Totals',
    '',
    kv(r.totals),
    '',
    table('Plug-ins (by id)', r.pluginOwners, 50, (x) => [x.name, x.vendor ?? '?', String(x.files), String(x.uses)], ['Id', 'Maker', 'Files', 'Uses']),
    table('Plug-in functions (id:index)', r.plugins, 100, (x) => [x.name, x.vendor ?? '?', String(x.files), String(x.uses), shape(x)], ['Call', 'Maker', 'Files', 'Uses', 'Example shape']),
    table('MBS functions', r.mbs, 100),
    table('Calculation functions Tabularius can\'t name yet', r.unknownFunctions, 100, (x) => [x.name, String(x.files), String(x.uses), shape(x)], ['Token', 'Files', 'Uses', 'Example shape']),
    table('Get ( ) options Tabularius can\'t name yet', r.unknownGet, 50, (x) => [x.name, String(x.files), String(x.uses), shape(x)], ['Token', 'Files', 'Uses', 'Example shape']),
    table('Script steps Tabularius can\'t name yet (by id)', r.unknownSteps, 50),
    table('Calculation functions', r.functions, 150),
    table('Get ( ) options', r.getOptions, 150),
    table('Script steps', r.steps, 250),
    table('Layout objects', r.layoutObjects, 80),
    table('Script triggers', r.triggers, 80),
  ].join('\n');
}

/** Finds, dedupes and scans every .fmp12 under dir, a few at a time, each in its own process. */
/** The .fmp12 files named one per line in `listFile` (for example Spotlight's results), each once. */
export function listedFiles(listFile: string): { paths: string[]; unreadable: number } {
  const paths = new Set<string>();
  let unreadable = 0;
  for (const line of readFileSync(listFile, 'utf8').split('\n')) {
    const p = line.replace(/\r$/, '');
    if (!p) continue;
    if (!/\.fmp12$/i.test(p)) continue;
    try {
      // The real path: a link is read as its target, and one file listed twice is counted once.
      if (statSync(p).isFile()) paths.add(realpathSync(p));
    } catch {
      unreadable++;
    }
  }
  return { paths: [...paths].sort(), unreadable };
}

/** `dir` is walked for .fmp12 files, unless `opts.list` names a file listing them. */
export async function corpusScan(dir: string, opts: { out: string; entry: string; all?: boolean; list?: string; only?: string; convert?: boolean; dedupeOnly?: boolean; jobs?: number; timeoutSeconds?: number; log?: (line: string) => void }): Promise<CorpusReport> {
  const jobs = opts.jobs ?? Math.max(1, Math.floor(availableParallelism() / 2));
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('corpus-scan --jobs needs a whole number of 1 or more');
  const timeoutSeconds = opts.timeoutSeconds ?? 300;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('corpus-scan --timeout needs a positive number of seconds');
  if (timeoutSeconds > 2147483) throw new Error('corpus-scan --timeout must be at most 2147483 seconds');
  const log = opts.log ?? (() => {});
  const { paths, unreadable } = opts.list ? listedFiles(opts.list) : findFiles(dir, { all: opts.all });
  if (unreadable) log(`${unreadable} folders or files couldn't be read and were skipped`);
  if (!paths.length) throw new Error(`corpus-scan: no .fmp12 files in ${opts.list ? 'the list' : dir}`);
  log(`${paths.length} files; comparing same-size files to find duplicates`);
  const { groups, unreadable: unreadableFiles } = await dedupe(paths);
  if (unreadableFiles) log(`${unreadableFiles} files couldn't be read and were skipped`);
  const unique = (opts.only ? selectOnly([...groups.entries()], opts.only) : [...groups.entries()]).sort((a, b) => a[1].size - b[1].size);
  const found = opts.only ? unique.reduce((n, [, f]) => n + f.copies, 0) : paths.length;
  const uniqueBytes = unique.reduce((n, [, f]) => n + f.size, 0);
  log(`${unique.length} unique, ${(uniqueBytes / 1e9).toFixed(1)} GB`);
  if (opts.dedupeOnly) return buildReport(found, uniqueBytes, []);
  log(`scanning${opts.convert ? ' and converting' : ''}`);
  const results: { id: string; sizeMB: number; copies: number; scan: FileScan }[] = new Array(unique.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < unique.length) {
      const i = next++;
      const [hash, f] = unique[i];
      const scan = await scanInChild(opts.entry, f.path, !!opts.convert, timeoutSeconds * 1000);
      results[i] = { id: hash.slice(0, 12), sizeMB: Math.round(f.size / 1e5) / 10, copies: f.copies, scan };
      if (++done % 25 === 0 || done === unique.length) log(`${done}/${unique.length}`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  const report = buildReport(found, uniqueBytes, results);
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, 'corpus-report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(opts.out, 'corpus-report.md'), reportMarkdown(report));
  return report;
}
