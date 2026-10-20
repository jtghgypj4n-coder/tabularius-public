// Stored-calculation fidelity: recompute every stored calculation field with
// Tabularius's engine on the records FileMaker computed it for, and compare with
// the value FileMaker stored. Prints counts per file and per function, and with
// --examples a few mismatches per field (values clipped; don't use on private data).
// Store mode also checks auto-enter calculations (the formula on the record now
// against what was entered then: they can drift legitimately when inputs change)
// and looked-up values (the first related record's value now).
// --raw reads the .fmp12 directly instead of importing it (for files too big to
// import): formulas that reach other tables, unstored or global fields, or read
// container contents are skipped, --tables a-b and --ms limit the work.
// Usage: node --no-warnings scripts/calc-fidelity.ts [--n 200] [--examples] [--json] [--raw [--tables 1-200] [--ms 36000]] <file.fmp12 | store.sqlite>...
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { FUNCTIONS } from '../packages/calc/src/functions.ts';
import { asText, coerce, compile, fromStored, NameTable, type Value, type ValueType } from '../packages/calc/src/index.ts';
import { importFmp12, relatedRows, Store } from '../packages/store/src/index.ts';
import { FmpDatabase, type Field } from '../packages/fmp12/src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; args.splice(i, 1); return true; };
const opt = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const perField = Number(opt('--n') ?? 200);
const examples = flag('--examples');
const json = flag('--json');
const raw = flag('--raw');
const [t0, t1] = (opt('--tables') ?? '0-1000000').split('-').map(Number);
const deadline = Date.now() + Number(opt('--ms') ?? 1e12);

// Results that depend on when, where or by whom FileMaker computed them.
const VOLATILE = /\bGet\s*\(\s*(Current|Account|UserName|System|Application|Host|Window|Layout|Found|Record|Total|Script|Last|Active|Device|Persistent|Network|Modified|Request|Screen|Desktop|Documents|Temporary|File|Preferences|Calculation|Encryption|Connection|Uuid|UUID|Trigger|Error)|\bRandom\b|\bGet\s*\(\s*UUID|\bGet\s*\(\s*\w*Path/i;
// Plug-in and design functions read state Tabularius doesn't have.
const EXTERNAL = /\b(BE_|MBS\b|Email|DataGuard_|FieldNames|LayoutNames|ScriptNames|TableNames|ValueListItems|DatabaseNames|LayoutObjectNames|WindowNames|FieldType|FieldComment)\w*\s*\(/;

interface Tally { evaluated: number; match: number; mismatch: number; error: number }
const blank = (): Tally => ({ evaluated: 0, match: 0, mismatch: 0, error: 0 });
const add = (t: Tally, k: keyof Tally) => { t[k]++; };

function same(stored: unknown, got: unknown, f: Field): boolean {
  const s = stored ?? '';
  const g = got ?? '';
  if (String(s) === String(g)) return true;
  // The file keeps times as "8:37:25 AM" where the engine writes 8:37:25: compare the moments.
  if ((f.type === 'date' || f.type === 'time' || f.type === 'timestamp') && s !== '' && g !== '') {
    const a = fromStored(String(s), f.type), b = fromStored(String(g), f.type);
    if (a.type === f.type && b.type === f.type) return a.value === b.value;
  }
  if (f.type === 'number') {
    const a = Number(s), b = Number(g);
    if (s !== '' && g !== '' && Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  }
  return false;
}

const functionsIn = (formula: string) => [...new Set([...formula.matchAll(/([A-Za-z_][\w.]*)\s*\(/g)].map((m) => m[1].toLowerCase()).filter((n) => FUNCTIONS.has(n)))];

const report: Record<string, unknown> = {};
const autoEnter = blank(), lookups = blank();
const worstAuto: string[] = [], worstLookup: string[] = [];
/** Raw mode: records whose referenced fields are all empty, by the field's options: did FileMaker store a result? */
const emptyRefs = new Map<string, { evaluated: number; skipped: number }>();
const byFunction = new Map<string, Tally>();

/** One stored calculation's verdicts over records, and the functions it uses. */
function tallyField(name: string, f: Field, rows: Iterable<{ stored: unknown; got: unknown }>, file: Tally, fields: { field: string; tally: Tally; examples: string[] }[]): void {
  const t = blank();
  const ex: string[] = [];
  const fns = functionsIn(f.calculation!);
  for (const { stored, got } of rows) {
    add(t, 'evaluated');
    const verdict: keyof Tally = same(stored, got, f) ? 'match' : got === null && (stored ?? '') !== '' ? 'error' : 'mismatch';
    add(t, verdict);
    for (const fn of fns) { const ft = byFunction.get(fn) ?? blank(); add(ft, 'evaluated'); add(ft, verdict); byFunction.set(fn, ft); }
    if (verdict !== 'match' && ex.length < 3) ex.push(`stored=${JSON.stringify(String(stored ?? '')).slice(0, 80)} got=${JSON.stringify(String(got ?? '')).slice(0, 80)}`);
  }
  file.evaluated += t.evaluated; file.match += t.match; file.mismatch += t.mismatch; file.error += t.error;
  if (t.mismatch + t.error) fields.push({ field: name, tally: t, examples: examples ? [f.calculation!.replace(/\s+/g, ' ').slice(0, 300), ...ex] : [] });
}

const storedCalcs = (fields: Field[]) => fields.filter((f) => f.kind === 'calculation' && f.calculation && !f.options?.unstored && !f.options?.global && f.type !== 'container');

/** Raw mode: the file's own records, formulas of the record's table only. */
function rawSweep(src: string, file: { fields: number; skippedVolatile: number; skippedExternal: number; skippedRelated: number; skippedContainer: number } & Tally, fields: { field: string; tally: Tally; examples: string[] }[]): string {
  const db = FmpDatabase.open(src);
  const s = db.schema;
  const order = db.dateStyle;
  const cfs = new Map(s.customFunctions.map((c) => [c.name.toLowerCase(), { parameters: c.parameters, formula: c.formula ?? '' }]));
  for (const table of s.tables) {
    if (table.id < t0 || table.id > t1 || Date.now() > deadline) continue;
    const calcs = storedCalcs(table.fields);
    if (!calcs.length) continue;
    const names = new NameTable({ fields: table.fields.map((f) => f.name), occurrences: [] });
    const byName = new Map(table.fields.map((f) => [f.name.toLowerCase(), f]));
    const compiled = calcs.flatMap((f) => {
      file.fields++;
      if (VOLATILE.test(f.calculation!)) { file.skippedVolatile++; return []; }
      if (EXTERNAL.test(f.calculation!)) { file.skippedExternal++; return []; }
      if (f.calculation!.includes('::') || /ExecuteSQL/i.test(f.calculation!)) { file.skippedRelated++; return []; }
      // The records hold a container's blob id, not its file: only a store can answer these.
      if (/GetContainerAttribute|Base64Encode|GetAsText\s*\(|Length\s*\(|GetThumbnail|VerifyContainer/i.test(f.calculation!) && table.fields.some((g) => g.type === 'container' && f.calculation!.includes(g.name))) { file.skippedContainer++; return []; }
      let c;
      try { c = compile(f.calculation!, names); } catch { file.error++; return []; }
      // Unstored and global fields have no value in the records.
      if (c.fields.some((r) => { const g = byName.get(r.name.toLowerCase()); return g?.options?.unstored || g?.options?.global; })) { file.skippedRelated++; return []; }
      return [{ f, c, rows: [] as { stored: unknown; got: unknown }[] }];
    });
    if (!compiled.length) continue;
    let n = 0;
    for (const r of db.rawRecords(table.id)) {
      if (n++ >= perField || Date.now() > deadline) break;
      const read = (f: Field, rep: number): Value => {
        const v = r.values.get(f.id)?.[rep - 1] ?? '';
        if (v === '') return { type: 'text', value: '' };
        // The reader turns returns into \n, as the store keeps them; fromStored gives calculations their \r.
        return fromStored(v, f.type === 'container' ? 'text' : f.type);
      };
      const ctx = {
        dateOrder: order,
        field: (ref: { field: string; repetition: number }) => { const f = byName.get(ref.field.toLowerCase()); return f ? read(f, ref.repetition) : undefined; },
        repetitions: (ref: { field: string }) => { const f = byName.get(ref.field.toLowerCase()); return f ? Math.max(1, r.values.get(f.id)?.length ?? 1) : 1; },
        customFunction: (name: string) => cfs.get(name.toLowerCase()),
        variable: () => undefined, setVariable: () => {},
      };
      for (const { f, c, rows } of compiled) {
        let got: string | null;
        try { got = asText(coerce(c.evaluate(ctx as never), f.type as ValueType, order), order).replace(/\r/g, '\n'); } catch { got = null; }
        const stored = r.values.get(f.id)?.[0] ?? '';
        // "Do not evaluate if all referenced fields are empty": count what FileMaker did when they were.
        // A container reference never counts as empty (as the store does).
        const refs = c.fields.map((ref) => byName.get(ref.name.toLowerCase()));
        if (refs.length && refs.every((g) => g?.type !== 'container' && (r.values.get(g?.id ?? -1)?.[0] ?? '') === '') && got !== '') {
          const key = `evaluateWhenEmpty ${f.options?.evaluateWhenEmpty ? 'on' : 'off'}, ${f.options?.index ? 'indexed' : 'not indexed'}`;
          const e = emptyRefs.get(key) ?? { evaluated: 0, skipped: 0 };
          if (stored === '') e.skipped++; else e.evaluated++;
          emptyRefs.set(key, e);
          if (!f.options?.evaluateWhenEmpty) got = '';
        }
        rows.push({ stored, got });
      }
    }
    for (const { f, rows } of compiled) tallyField(`${table.name}::${f.name}`, f, rows, file, fields);
  }
  return basename(src, '.fmp12');
}

for (const src of args) {
  const file = { fields: 0, skippedVolatile: 0, skippedExternal: 0, skippedRelated: 0, skippedContainer: 0, ...blank() };
  const fields: { field: string; tally: Tally; examples: string[] }[] = [];
  let name: string;
  if (raw) name = rawSweep(src, file, fields);
  else {
    let dir: string | undefined;
    let path = src;
    if (src.endsWith('.fmp12')) {
      dir = mkdtempSync(join(tmpdir(), 'fidelity-'));
      path = join(dir, basename(src, '.fmp12') + '.sqlite');
      importFmp12(src, path);
    }
    const store = new Store(path, basename(src).replace(/\.(fmp12|sqlite)$/, ''));
    name = store.name;
    for (const table of store.schema.tables) {
      const stored = storedCalcs(table.fields);
      if (!stored.length) continue;
      let rows: Record<string, unknown>[];
      try { rows = store.sql.prepare(`SELECT * FROM "${table.name.replace(/"/g, '""')}" LIMIT ?`).all(perField) as Record<string, unknown>[]; } catch { continue; }
      for (const f of stored) {
        file.fields++;
        if (VOLATILE.test(f.calculation!)) { file.skippedVolatile++; continue; }
        if (EXTERNAL.test(f.calculation!)) { file.skippedExternal++; continue; }
        tallyField(`${table.name}::${f.name}`, f, rows.map((row) => ({ stored: row[f.name], got: store.calc.computeStored({ store, table, row } as never, f) })), file, fields);
      }
      // Auto-enter calculations and looked-up values on normal fields.
      for (const f of table.fields) {
        const ae = f.options?.autoEnter;
        if (f.kind !== 'normal' || f.options?.global || !ae || f.type === 'container') continue;
        if (ae.calculation && f.calculation && !VOLATILE.test(f.calculation) && !EXTERNAL.test(f.calculation)) {
          const t = blank();
          for (const row of rows) {
            if ((row[f.name] ?? '') === '') continue;
            const got = store.calc.computeStored({ store, table, row } as never, f);
            add(t, 'evaluated'); add(t, same(row[f.name], got, f) ? 'match' : got === null ? 'error' : 'mismatch');
          }
          autoEnter.evaluated += t.evaluated; autoEnter.match += t.match; autoEnter.mismatch += t.mismatch; autoEnter.error += t.error;
          if (t.mismatch + t.error) worstAuto.push(`${name}: ${table.name}::${f.name} ${t.mismatch + t.error} of ${t.evaluated}`);
        }
        const lk = ae.lookup;
        if (lk) {
          const fromId = lk.fromId ?? store.schema.tableOccurrences.find((o) => o.baseTableId === table.id && !o.dataSourceId)?.id;
          if (fromId === undefined) continue;
          const t = blank();
          for (const row of rows) {
            let res;
            try { res = relatedRows(store, fromId, row as never, lk.occurrenceId, { limit: 1 }); } catch { continue; }
            const source = res?.occurrence.table.fields.find((x) => x.id === lk.fieldId);
            const found = res?.rows[0];
            if (!source || !found) continue; // no match now: nothing to compare
            add(t, 'evaluated'); add(t, same(row[f.name], found[source.name], f) ? 'match' : 'mismatch');
          }
          lookups.evaluated += t.evaluated; lookups.match += t.match; lookups.mismatch += t.mismatch;
          if (t.mismatch) worstLookup.push(`${name}: ${table.name}::${f.name} ${t.mismatch} of ${t.evaluated}`);
        }
      }
    }
    store.close?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  report[name] = { ...file, worst: fields.sort((a, b) => (b.tally.mismatch + b.tally.error) - (a.tally.mismatch + a.tally.error)).slice(0, examples ? 40 : 10) };
  if (!json) {
    console.log(`== ${name}: ${file.fields} stored calcs (${file.skippedVolatile} volatile, ${file.skippedExternal} plug-in/design, ${file.skippedRelated} related or unstored, ${file.skippedContainer} container contents skipped); ${file.evaluated} values, ${file.match} match, ${file.mismatch} differ, ${file.error} fail`);
    for (const w of (report[name] as { worst: typeof fields }).worst) {
      console.log(`   ${w.field}: ${w.tally.mismatch} differ, ${w.tally.error} fail of ${w.tally.evaluated}`);
      for (const e of w.examples) console.log(`      ${e}`);
    }
  }
}
const fnRows = [...byFunction].map(([name, t]) => ({ name, ...t, rate: (t.mismatch + t.error) / t.evaluated })).filter((r) => r.mismatch + r.error).sort((a, b) => (b.mismatch + b.error) - (a.mismatch + a.error));
if (json) console.log(JSON.stringify({ files: report, functions: fnRows, emptyRefs: Object.fromEntries(emptyRefs), autoEnter, lookups, worstAuto, worstLookup }, null, 1));
else {
  console.log('== by function (values of formulas using it that differ or fail)');
  for (const r of fnRows.slice(0, 40)) console.log(`   ${r.name}: ${r.mismatch + r.error} of ${r.evaluated} (${(100 * r.rate).toFixed(1)}%)`);
  if (emptyRefs.size) console.log('== all referenced fields empty, formula not empty: FileMaker stored a result / stored nothing');
  for (const [k, e] of emptyRefs) console.log(`   ${k}: ${e.evaluated} / ${e.skipped}`);
  if (autoEnter.evaluated) console.log(`== auto-enter calculations (formula now vs value entered): ${autoEnter.match} match, ${autoEnter.mismatch} differ, ${autoEnter.error} fail`);
  for (const w of worstAuto.slice(0, 15)) console.log(`   ${w}`);
  if (lookups.evaluated) console.log(`== looked-up values (first related record now): ${lookups.match} match, ${lookups.mismatch} differ`);
  for (const w of worstLookup.slice(0, 15)) console.log(`   ${w}`);
}
