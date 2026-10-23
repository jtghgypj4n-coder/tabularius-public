// Live calculations for a hosted file: unstored calculations computed on
// read, stored calculations and auto-enter options applied on write, and
// field validation. Formulas run on @tabularius/calc; this module supplies the
// record, related records (through the relationship graph), globals, Get ()
// values, custom functions and design functions.

import { cleanSql, sqlName, sqlTokens } from './sql-tokens.ts';
import { rethrowExecutionRefusal } from '../../calc/src/execution-refusal.ts';
import { charCount } from '../../calc/src/text.ts';
import { FUNCTIONS, pluginNotInstalled } from '../../calc/src/functions.ts';
import { fileMakerSqlSyntax, oneStatement, withAccount } from './sql-dates.ts';
import { anyAllToIn, containerCastsToName, expandStars, fetchToLimit, refuseUnsupportedJoins } from './sql-grammar.ts';
import { checkGrouping, checkUnionTypes } from './sql-checks.ts';
import {
  compile, CalcError, CalcNestingError, ERR, EMPTY, fromStored, toStored, asText, asNumberOrEmpty, asDate, asTime, asTimestamp, asBoolean,
  isEmpty, isEmbeddingData, num, text, NameTable, decimalSum, type CalcContext, type Compiled, type DateStyle, type FieldRef, type Value,
  type StyleRun, type Node, type ValueType,
} from '../../calc/src/index.ts';
import type { Field, FieldType, LayoutObject, Relationship, Schema, Table, TableOccurrence } from '../../fmp12/src/index.ts';
import { dataSourceFile, q } from './import.ts';
import { decimalKey, nativeValue } from './native-types.ts';
import { designFunction, NO_FILE_ARGUMENT } from './design-functions.ts';
import type { StatementSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { getHeapStatistics } from 'node:v8';
import type { PluginFunction } from '../../calc/src/index.ts';
import type { Store } from './store.ts';
import type { Privileges } from './privileges.ts';
import { writer } from './activity.ts';
import { PreparedCache, preparing, prepareCaches } from './preparation.ts';
import { checkMemory, timeLeft } from './errors.ts';
import { traceNote, tracing } from './trace.ts';
import { schemaVisibility, tableDDL } from './table-ddl.ts';
import { customFunctionDef } from './javascript.ts';
import { relatedRows, relationPath, matchPredicate } from './related.ts';
import { repetitionText } from './text-styles.ts';
import { foldCase, sortFunction, sortLanguage } from '../../calc/src/collation.ts';

type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

/** A record of some table in some hosted file. */
export interface Rec {
  store: Store;
  table: Table;
  row: Row;
}

/** One window's private record, with stored results retained until an input changes. */
export interface EditedRecord extends Rec {
  account?: string;
  privileges?: Privileges;
  fields: Set<Field>;
  stored: Map<Field, Value>;
  columns: string;
}

/** Validation failure, with the Data API's error code. */
export class ValidationError extends Error {
  readonly code: number;
  readonly field: string;
  constructor(code: number, field: string, message: string) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

/** One evaluation pass: computed values and related-record lookups are reused within it. */
export interface Pass {
  /** Record identities contributing field values to an observed formula evaluation. */
  onRead?: (store: Store, table: string, ids: number[]) => void;
  /** SQL provenance and result count, including cached results; callers must not persist query text. */
  onQuery?: (store: Store, query: string, rows: number) => void;
  values: Map<string, Value>;
  busy: Set<string>;
  /** A private row with uncommitted edits and the calculations whose inputs changed. */
  edited?: EditedRecord;
  /** Related records worked out in the pass: the ids of all of them, or the first one. */
  related: Map<string, number[] | Rec | null>;
  account?: string;
  /**
   * The viewing account's privileges, when the pass computes values for a user
   * read (a record returned through a layout, a related/portal value). With it,
   * an unstored calculation sees only what the account may: related records it
   * cannot view are excluded from aggregates and related fields (as FileMaker
   * does), fields it has no access to contribute nothing, and in-calc ExecuteSQL
   * is scoped to its records. Absent for internal passes (computing a stored
   * calculation, evaluating a record-access rule, validation), which run with
   * full data — matching FileMaker, where stored values are computed once.
   */
  privileges?: Privileges;
  /**
   * The formula was typed by the account (with `privileges`): a field of another file it cannot see is missing, as one
   * that is not there is, instead of empty (see EvaluateOptions.typed).
   */
  typed?: boolean;
  /** The found set summary fields in its table cover (all of the table's records when absent). */
  foundSet?: { table: Table; recs: Iterable<Rec> };
  /** The found set's current sort, when a window supplied one for GetSummary. */
  sort?: { fieldName: string }[];
  /** Summaries over all of a table's records, worked out once in the pass. */
  sums?: Map<string, Summed>;
  /** The ids a limited view rule allows, worked out once in the pass (a rule that changes with the clock is then one answer for it). */
  viewable?: Map<string, number[]>;
  /**
   * The pass shows values to a person (a record read through a layout): a
   * whole-table summary or ExecuteSQL result from before the latest change
   * may stand in while the background warmer works out the new one.
   * Scripts, validation and stored calculations never get one, nor does an
   * account that changed the file a moment ago (it sees its own change).
   */
  display?: boolean;
  /** How many values from before the latest change stood in during the pass (shown as "updating"). */
  stale?: number;
  /** The whole-table summaries among them. */
  staleSums?: Set<Field>;
  /** Calculations worked out in the pass from a value that stood in (keys of `values`). */
  staleValues?: Set<string>;
  /** Each file's data version, read once in the pass (see Calculations.lookup). */
  stamps?: Map<Store, string>;
  summaryDependencies?: Map<Store, Map<Store, { stamp: string; schema: Schema }>>;
}

/**
 * What a summary keeps of the records it covers: the count, the numbers, or
 * the text (for a List Of). Collected one record at a time, so a summary over
 * a large table never holds its records, only these.
 */
export interface Summed {
  count: number;
  nums: number[];
  texts?: string[];
  /** Worked out once from nums, for a summary read many times (each record of a page). */
  stats?: { sum: number; mean: number; sq: number; min: number; max: number };
}

const newPass = (account?: string, privileges?: Privileges): Pass => ({ values: new Map(), busy: new Set(), related: new Map(), account, privileges });

const AUTO_VALUE_TIME = {
  creationDate: 'date', creationTime: 'time', creationTimestamp: 'timestamp',
  modificationDate: 'date', modificationTime: 'time', modificationTimestamp: 'timestamp',
} as const;

/** Formulas whose field references are only known at run time (GetField, Evaluate, ...). */
const DYNAMIC = /\b(GetField|Evaluate|GetFieldName|ExecuteSQL|Lookup|LookupNext|GetNthRecord)\s*\(/i;

/** Functions that can read beyond the current record, including SQL and design/file lookups. */
const CROSS_RECORD_FUNCTIONS = new Set([
  'Get', 'GetField', 'GetFieldName', 'Evaluate', 'ExecuteSQL', 'BE_FileMakerSQL', 'Lookup', 'LookupNext', 'GetNthRecord', 'GetSummary',
  'GetLayoutObjectAttribute', 'LayoutNames', 'LayoutIDs', 'ScriptNames', 'ScriptIDs', 'WindowNames', 'FieldNames',
  'TableNames', 'TableIDs', 'FieldIDs', 'FieldType', 'FieldStyle', 'FieldRepetitions', 'FieldBounds', 'FieldComment',
  'RelationInfo', 'ValueListItems', 'ValueListNames', 'ValueListIDs', 'DatabaseNames', 'LayoutObjectNames',
  'ScriptStepNames', 'BaseTableNames', 'BaseTableIDs', 'GetTableDDL', 'GetRecordIDsFromFoundSet', 'GetFieldsOnLayout',
].map((name) => name.toLowerCase()));

interface Hop {
  rel: Relationship;
  /** True when walking from the relationship's right side to its left. */
  reverse: boolean;
  to: number;
}

// The serials and globals kept in the file's metadata are keyed by table name, then field name. Those names are
// data, so a table may be called __proto__ or constructor: such maps are made without a prototype and read only
// through keys they hold themselves.
function ownKeyed<T>(tables: Record<string, Record<string, T>> | undefined): Record<string, Record<string, T>> {
  const out: Record<string, Record<string, T>> = Object.create(null);
  for (const [table, fields] of Object.entries(tables ?? {})) out[table] = Object.assign(Object.create(null), fields && typeof fields === 'object' ? fields : {});
  return out;
}

function ownAt<T>(tables: Record<string, Record<string, T>> | undefined, table: string, field: string): T | undefined {
  if (!tables || typeof tables !== 'object' || !Object.hasOwn(tables, table)) return undefined;
  const fields = tables[table];
  return fields && typeof fields === 'object' && Object.hasOwn(fields, field) ? fields[field] : undefined;
}

/** Sets a value in a map made by ownKeyed. */
function ownPut<T>(tables: Record<string, Record<string, T>>, table: string, field: string, value: T): void {
  const fields = Object.hasOwn(tables, table) ? tables[table] : (tables[table] = Object.create(null) as Record<string, T>);
  fields[field] = value;
}

export class Calculations {
  private readonly store: Store;
  private readonly tosById = new Map<number, TableOccurrence>();
  private readonly tosByName = new Map<string, TableOccurrence>();
  private readonly nameTables = new Map<number, NameTable>();
  private readonly compiled = new Map<string, Compiled | null>();
  private readonly paths = new Map<string, Hop[] | null>();
  private readonly dependencies = new Map<Table, { readers: Map<string, Set<Field>>; dynamic: Set<Field> }>();
  private readonly edits = new WeakMap<object, Map<string, EditedRecord>>();
  private readonly globalValues = new PreparedCache<{
    version: number;
    values: Record<string, Record<string, SqlValue>>;
  } | undefined>(undefined, (value) => structuredClone(value));
  private globalVersionQuery?: StatementSync;
  private readonly serials = new PreparedCache<Record<string, Record<string, string>> | undefined>(undefined, (value) => structuredClone(value));

  constructor(store: Store) {
    this.store = store;
    for (const to of store.schema.tableOccurrences) {
      this.tosById.set(to.id, to);
      this.tosByName.set(to.name.toLowerCase(), to);
    }
  }

  // --- schema lookups -------------------------------------------------------

  /** The hosted file and base table behind a table occurrence of this file's graph. */
  occurrenceTable(toId: number): { store: Store; table: Table } | undefined {
    const to = this.tosById.get(toId);
    if (!to || to.baseTableId === undefined) return undefined;
    if (!to.dataSourceId) {
      const table = this.store.schema.tables.find((t) => t.id === to.baseTableId);
      return table && { store: this.store, table };
    }
    const file = dataSourceFile(this.store.schema.dataSources.find((d) => d.id === to.dataSourceId)?.paths ?? []);
    const other = file ? this.store.resolvedFile(file) : undefined;
    const table = other?.schema.tables.find((t) => t.id === to.baseTableId);
    return other && table && { store: other, table };
  }

  /** Whether a formula's field reference, seen from occurrence toId, is a container field. */
  containerRef(toId: number) {
    return (r: { occurrence?: string; name: string }): boolean => {
      const to = r.occurrence ? this.occurrence(r.occurrence) : this.tosById.get(toId);
      const t = to && this.occurrenceTable(to.id);
      return t?.table.fields.find((f) => f.name.toLowerCase() === r.name.toLowerCase())?.type === 'container';
    };
  }

  occurrence(name: string): TableOccurrence | undefined {
    return this.tosByName.get(name.toLowerCase());
  }

  /**
   * GetFieldsOnLayout (FileMaker 2025): the fields placed on a layout that a find can search, as JSON
   * {"layout_name", "fields": {"TO::Field": {"type": "number" | "string", "description"?}}}. As Claris documents,
   * globals are left out, the type is "number" for number fields and "string" otherwise, and the description is the
   * field's comment without a leading "[LLM]". Summary fields can't be searched, and neither can a field placed only
   * where Find mode entry is off, so they are left out too (both inferred), as are fields this account can't see.
   * Undefined when there is no such layout, or the account can't open it.
   */
  fieldsOnLayout(layoutName: string, privileges?: Privileges): string | undefined {
    const layout = this.store.schema.layouts.find((l) => l.name.toLowerCase() === layoutName.toLowerCase());
    if (!layout) return undefined;
    // A layout the account can't open lists nothing, as if it weren't there.
    if (privileges && this.store.local(privileges)?.layout(layout.name).layout === 'none') return undefined;
    const fields: Record<string, { type: string; description?: string }> = {};
    const add = (ref: { tableOccurrenceId: number; fieldId: number }) => {
      const to = this.tosById.get(ref.tableOccurrenceId);
      const home = to && this.occurrenceTable(to.id);
      const field = home?.table.fields.find((f) => f.id === ref.fieldId);
      if (!to || !home || !field || field.options?.global || field.kind === 'summary') return;
      // Rights in the file that holds the table (none there without an account), as field reads check them.
      if (home.store.fieldHidden(home.table.name, field.name, privileges)) return;
      const description = field.comment?.replace(/^\s*\[LLM\]\s*/i, '').trim();
      fields[`${to.name}::${field.name}`] = { ...(description ? { description } : {}), type: field.type === 'number' || field.type === 'integer' || field.type === 'decimal' || field.type === 'boolean' ? 'number' : 'string' };
    };
    const walk = (objects: LayoutObject[]) => {
      for (const o of objects) {
        // A field whose Inspector turns off entry in Find mode can't be searched there (inferred).
        if (o.field && !o.field.behavior?.find) add(o.field);
        if (o.children) walk(o.children);
      }
    };
    walk(this.store.design(layout.id)?.objects ?? []);
    // Keys in sorted order, as FileMaker writes JSON.
    const sorted = Object.fromEntries(Object.keys(fields).sort().map((k) => [k, fields[k]]));
    return JSON.stringify({ fields: sorted, layout_name: layout.name });
  }

  /** A table occurrence for a base table of this file, for formulas without a recorded context. */
  defaultOccurrence(table: Table): number | undefined {
    return this.store.schema.tableOccurrences.find((t) => !t.dataSourceId && t.baseTableId === table.id)?.id;
  }

  /**
   * The names a formula resolves from occurrence toId. With `privileges`, a field of a table in another hosted file
   * resolves only when the account can see it there (see fieldNamesOf): for a formula someone types, a field it cannot
   * see is as missing as one that does not exist, so naming it says nothing about the other file.
   */
  names(toId: number, privileges?: Privileges): NameTable {
    if (privileges && this.store.schema.tableOccurrences.some((to) => to.dataSourceId)) {
      return new NameTable({
        fields: this.fieldNamesOf(toId, privileges),
        occurrences: this.store.schema.tableOccurrences.map((to) => [to.name, this.fieldNamesOf(to.id, privileges)] as [string, string[]]),
      });
    }
    let names = this.nameTables.get(toId);
    if (!names) {
      const own = this.occurrenceTable(toId)?.table.fields.map((f) => f.name) ?? [];
      const occurrences: [string, string[]][] = this.store.schema.tableOccurrences.map((to) =>
        [to.name, this.occurrenceTable(to.id)?.table.fields.map((f) => f.name) ?? []]);
      names = new NameTable({ fields: own, occurrences });
      this.nameTables.set(toId, names);
    }
    return names;
  }

  /**
   * The fields of an occurrence's table an account may see. A table of another hosted file follows the account's
   * privileges in that file: none at all without an account there, none of a table it cannot view, and not a field
   * it has no access to (hidden or masked). This file's own tables are not narrowed here (designing them is for
   * Full Access). Without privileges, every field.
   */
  fieldNamesOf(toId: number, privileges?: Privileges): string[] {
    const home = this.occurrenceTable(toId);
    if (!home) return [];
    return home.table.fields.filter((f) => !privileges || home.store === this.store || !home.store.fieldHidden(home.table.name, f.name, privileges)).map((f) => f.name);
  }

  /** The formula of a field, parsed in its context; null when it cannot be parsed (an unknown function, say). */
  formula(table: Table, field: Field): Compiled | null {
    const key = `${table.id}/${field.id}`;
    if (this.compiled.has(key)) return this.compiled.get(key)!;
    let c: Compiled | null = null;
    const toId = field.calculationContextId ?? this.defaultOccurrence(table);
    const formula = field.calculation && this.store.externalFieldNames(field.calculation);
    // A formula with ids the decoder could not name yet would only fail; keep
    // the imported value instead of replacing it with an error.
    if (formula && toId !== undefined && !/⟨[^⟩\s]+⟩/.test(formula)) {
      try {
        c = compile(formula, this.names(toId));
      } catch (e) {
        rethrowExecutionRefusal(e);
        c = null;
      }
    }
    // A field of a file that isn't open yet may be nameable later.
    if (c || !formula?.includes('⟨field:')) this.compiled.set(key, c);
    return c;
  }

  // --- globals and serial numbers --------------------------------------------

  private meta<T>(key: string): T | undefined {
    const row = this.store.sql.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) as T : undefined;
  }

  private saveMeta(key: string, value: unknown): void {
    this.store.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json')
      .run(key, JSON.stringify(value));
  }

  /**
   * A global field's value (an array for repetitions): the current session's
   * own value when it has set one, else the value stored in the file.
   */
  globalValue(table: Table, field: Field): SqlValue {
    const mine = writer.getStore()?.globals?.readGlobal(this.store, table, field);
    if (mine !== undefined) return mine;
    // data_version changes on commits by other connections. Keep the decoded metadata until then;
    // our own writes invalidate it below, and Store resets calculations when a write is rolled back.
    const { data_version: version } = (this.globalVersionQuery ??= this.store.sql.prepare('PRAGMA data_version')).get() as { data_version: number };
    let kept = this.globalValues.value;
    if (!kept || kept.version !== version) {
      this.globalValues.value = kept = { version, values: this.meta('globals') ?? {} };
    }
    return ownAt(kept.values, table.name, field.name) ?? null;
  }

  /** Sets a global for the current session; with no session (MCP, tools), the file's stored value. */
  setGlobal(table: Table, field: Field, value: SqlValue): void {
    const session = writer.getStore()?.globals;
    if (session && field.type !== 'container') {
      session.writeGlobal(this.store, table, field, typeof value === 'bigint' ? Number(value) : (value as string | number | null));
      return;
    }
    const values = ownKeyed(this.meta<Record<string, Record<string, SqlValue>>>('globals'));
    ownPut(values, table.name, field.name, value);
    this.saveMeta('globals', values);
    this.globalValues.value = undefined;
  }

  /** Set Next Serial Value: the value the next new record gets (fields without a serial number set error 102 upstream). */
  setNextSerial(table: Table, field: Field, value: string): boolean {
    if (!field.options?.autoEnter?.serial) return false;
    const own = !this.store.sql.isTransaction;
    if (own) this.store.sql.exec('BEGIN IMMEDIATE');
    try {
      const serials = ownKeyed(this.meta<Record<string, Record<string, string>>>('serials'));
      ownPut(serials, table.name, field.name, value);
      this.serials.value = serials;
      this.saveMeta('serials', serials);
      if (own) this.store.sql.exec('COMMIT');
    } catch (e) {
      if (own && this.store.sql.isTransaction) this.store.sql.exec('ROLLBACK');
      throw e;
    }
    return true;
  }

  /** The value the next new record gets, without using it up; undefined for a field without a serial number. */
  peekSerial(table: Table, field: Field): string | undefined {
    const serial = field.options?.autoEnter?.serial;
    if (!serial) return undefined;
    const serials = ownKeyed(this.meta<Record<string, Record<string, string>>>('serials'));
    this.serials.value = serials;
    return ownAt(serials, table.name, field.name) ?? serial.next;
  }

  private nextSerial(table: Table, field: Field): string | undefined {
    const serial = field.options?.autoEnter?.serial;
    if (!serial) return undefined;
    const serials = ownKeyed(this.meta<Record<string, Record<string, string>>>('serials'));
    const current = ownAt(serials, table.name, field.name) ?? serial.next;
    ownPut(serials, table.name, field.name, serialNext(current, serial.increment || 1));
    this.serials.value = serials;
    this.saveMeta('serials', serials);
    return current;
  }

  // --- reading values -------------------------------------------------------

  /** Calculations affected by edited columns, including through other calculations. */
  editedCalculations(table: Table, columns: Iterable<string>): Set<Field> {
    let graph = this.dependencies.get(table);
    if (!graph) {
      graph = { readers: new Map(), dynamic: new Set() };
      for (const f of table.fields) {
        if (f.kind !== 'calculation' || f.options?.global) continue;
        const c = this.formula(table, f);
        if (!c) continue;
        const self = this.tosById.get(f.calculationContextId ?? this.defaultOccurrence(table)!)?.name.toLowerCase();
        // Related references can depend on an edited match key, including through another occurrence.
        if (DYNAMIC.test(c.formula) || c.fields.some((r) => r.occurrence && r.occurrence.toLowerCase() !== self)) graph.dynamic.add(f);
        for (const r of c.fields) {
          const name = r.name.toLowerCase();
          let readers = graph.readers.get(name);
          if (!readers) graph.readers.set(name, readers = new Set());
          readers.add(f);
        }
      }
      this.dependencies.set(table, graph);
    }
    const queue = [...columns].map((n) => n.toLowerCase());
    const affected = new Set<Field>();
    const add = (f: Field) => {
      if (!affected.has(f)) {
        affected.add(f);
        queue.push(f.name.toLowerCase());
      }
    };
    if (queue.length) for (const f of graph.dynamic) add(f);
    const visited = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
      if (visited.has(name)) continue;
      visited.add(name);
      for (const f of graph.readers.get(name) ?? []) add(f);
    }
    return affected;
  }

  /** The key belongs to the pending edit buffer, never to a shared record or session. */
  editedRecord(rec: Rec, columns: Iterable<string>, key?: object, account?: string, privileges?: Privileges): EditedRecord {
    const names = [...columns].sort();
    const signature = JSON.stringify(names);
    // Filtered pending inputs must never reuse results computed with hidden inputs.
    const scope = JSON.stringify([rec.table.id, rec.row._fm_record_id, account, privileges?.in(rec.store).full ? '' : privileges?.fingerprint ?? '']);
    let scopes = key && this.edits.get(key);
    if (key && !scopes) this.edits.set(key, scopes = new Map());
    let edited = scopes?.get(scope);
    if (edited && edited.row._fm_mod_id === rec.row._fm_mod_id) {
      const changed = rec.table.fields.filter((f) => f.kind === 'normal' && rec.row[f.name] !== edited!.row[f.name]).map((f) => f.name);
      if (changed.length) for (const f of this.editedCalculations(rec.table, changed)) edited.stored.delete(f);
      edited.row = rec.row;
      if (edited.columns !== signature) {
        edited.fields = this.editedCalculations(rec.table, names);
        edited.columns = signature;
      }
    } else {
      edited = { ...rec, account, privileges, fields: this.editedCalculations(rec.table, names), stored: new Map(), columns: signature };
      scopes?.set(scope, edited);
    }
    // Commit uses full data. A viewer's cached value can serve it only when
    // the inputs match and none of the formula's dependencies are restricted.
    if (!privileges) for (const candidate of scopes?.values() ?? []) {
      if (candidate === edited || candidate.table !== rec.table || candidate.account !== account
        || candidate.row._fm_record_id !== rec.row._fm_record_id || candidate.row._fm_mod_id !== rec.row._fm_mod_id
        || rec.table.fields.some((f) => f.kind === 'normal' && candidate.row[f.name] !== rec.row[f.name])) continue;
      for (const [f, value] of candidate.stored) {
        if (!edited.stored.has(f) && !this.restrictedCalculation(rec.table, f, candidate.privileges)) edited.stored.set(f, value);
      }
    }
    return edited;
  }

  private restrictedCalculation(table: Table, field: Field, privileges?: Privileges, seen = new Set<Field>()): boolean {
    if (!privileges || privileges.readsEverything || seen.has(field)) return false;
    seen.add(field);
    const c = this.formula(table, field);
    if (!c || DYNAMIC.test(c.formula)) return true;
    const self = this.tosById.get(field.calculationContextId ?? this.defaultOccurrence(table)!)?.name.toLowerCase();
    return c.fields.some((r) => {
      if (r.occurrence && r.occurrence.toLowerCase() !== self) return true;
      const input = table.fields.find((f) => f.name.toLowerCase() === r.name.toLowerCase());
      return !!input && (this.store.fieldMasked(table.name, input.name, privileges)
        || input.kind === 'calculation' && this.restrictedCalculation(table, input, privileges, seen));
    });
  }

  /** Called on each input change, including changes undone before the next read. */
  invalidateEdits(key: object, columns: string[]): void {
    for (const edited of this.edits.get(key)?.values() ?? []) {
      for (const f of this.editedCalculations(edited.table, columns)) edited.stored.delete(f);
    }
  }

  private editedRow(rec: Rec, pass: Pass): EditedRecord | undefined {
    const e = pass.edited;
    return e && e.store === rec.store && e.table.id === rec.table.id && e.row._fm_record_id === rec.row._fm_record_id ? e : undefined;
  }

  /** A field's value in a record: stored, global, or computed for an unstored calculation. */
  value(rec: Rec, field: Field, repetition = 1, pass: Pass = newPass()): Value {
    const edited = this.editedRow(rec, pass);
    if (edited) rec = edited;
    if (!field.options?.global) pass.onRead?.(rec.store, rec.table.name, [Number(rec.row._fm_record_id)]);
    // Without a found set, a summary in the record's own table covers every record.
    if (field.kind === 'summary') {
      return pass.foundSet?.table === rec.table
        ? this.foundSummary(rec, field, pass)
        : rec.store.calc.tableSummary(rec, field, pass);
    }
    if (field.options?.global) return storedValue(rec.store, this.globalValue(rec.table, field), field, repetition);
    if (field.kind === 'calculation' && (field.options?.unstored || edited?.fields.has(field) || rec.row[field.name] === undefined)) {
      return rec.store.calc.computed(rec, field, repetition, pass);
    }
    const v = storedValue(rec.store, rec.row[field.name], field, repetition);
    // Formatting kept with a text field's data, so GetAsCSS ( Notes ) and TextColorRemove ( Notes ) see it.
    // Each repetition keeps its own: GetAsCSS ( Notes[2] ).
    if (v.type === 'text' && field.kind === 'normal' && rec.store.textStyles.has(rec.table.id)) {
      const reps = Math.max(1, field.options?.repetitions ?? 1);
      const runs = rec.store.textStyles.read(rec.table.id, Number(rec.row._fm_record_id), (id, r) => (id === field.id && r === repetition ? repetitionText(rec.row[field.name], reps, r) : undefined))?.[0]?.runs;
      if (runs) return { ...v, runs };
    }
    return v;
  }

  private computed(rec: Rec, field: Field, repetition: number, pass: Pass): Value {
    if (repetition > (field.options?.repetitions ?? 1)) return EMPTY;
    const edited = this.editedRow(rec, pass);
    if (edited) rec = edited;
    const stored = !field.options?.unstored && edited?.fields.has(field) ? edited.stored : undefined;
    const kept = repetition === 1 ? stored?.get(field) : undefined;
    if (kept) return kept;
    const key = `${this.store.name}/${rec.table.id}/${rec.row._fm_record_id}/${field.id}/${repetition}`;
    const done = pass.values.get(key);
    if (done) {
      // Worked out earlier in the pass from a value that stood in: whatever uses it is updating too.
      if (pass.staleValues?.has(key)) pass.stale = (pass.stale ?? 0) + 1;
      return done;
    }
    if (pass.busy.has(key)) throw new CalcError(ERR.recursion, `${field.name} refers to itself`);
    const c = this.formula(rec.table, field);
    if (!c) return storedValue(rec.store, rec.row[field.name], field, repetition);
    pass.busy.add(key);
    try {
      const toId = field.calculationContextId ?? this.defaultOccurrence(rec.table)!;
      const ctx = this.context(rec, toId, pass, { calculationRepetition: repetition });
      const was = pass.stale ?? 0;
      const v = skipWhenEmpty(field, c, ctx, this.containerRef(toId)) ? EMPTY : c.evaluate(ctx, valueType(field));
      pass.values.set(key, v);
      stored?.set(field, v);
      if ((pass.stale ?? 0) > was) (pass.staleValues ??= new Set()).add(key);
      else pass.staleValues?.delete(key);
      return v;
    } finally {
      pass.busy.delete(key);
    }
  }

  /** Text for an unstored calculation in a record, as the Data API returns it ("?" when it fails). */
  unstoredValue(rec: Rec, field: Field, pass: Pass): SqlValue {
    return this.unstoredStyled(rec, field, pass).value;
  }

  /** The same, with the formatting a text result carries (TextColor, TextStyleAdd...), for a layout to show. */
  unstoredStyled(rec: Rec, field: Field, pass: Pass): { value: SqlValue; runs?: StyleRun[] } {
    try {
      const repetitions = field.options?.repetitions ?? 1;
      if (repetitions > 1) {
        const values = Array.from({ length: repetitions }, (_, rep) => storedForm(this.computed(rec, field, rep + 1, pass), field, this.store.dateOrder));
        return { value: JSON.stringify(values) };
      }
      const v = this.computed(rec, field, 1, pass);
      const value = storedForm(v, field, this.store.dateOrder);
      // Kept while the stored form has the same characters (returns are stored as \n, one for one).
      return v.type === 'text' && v.runs?.length && typeof value === 'string' && value.length === v.value.length ? { value, runs: v.runs } : { value };
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof CalcNestingError) throw e;
      if (e instanceof CalcError) return { value: '?' };
      throw e;
    }
  }

  newPass(account?: string, privileges?: Privileges): Pass {
    return newPass(account, privileges);
  }

  // --- summary fields ---------------------------------------------------------

  /**
   * Every record of a table, one at a time, for a summary of `field`: only the
   * column it summarizes when that is stored. Read as they are used, so a
   * large table is never held in memory. (A statement of its own: one being
   * iterated can't be reused by a nested read of the same table.)
   */
  private *allRecords(store: Store, table: Table, field?: Field): Generator<Rec> {
    const cols = field && summaryColumns(table, [field]);
    const select = cols ? ['_fm_record_id', ...cols].map(q).join(', ') : '*';
    for (const row of store.sql.prepare(`SELECT ${select} FROM ${q(table.name)} ORDER BY _fm_record_id`).iterate() as Iterable<Row>) {
      yield { store, table, row };
    }
  }

  /**
   * What `field` summarizes, collected over records one at a time. Values of
   * calculations are worked out in a pass of their own, emptied after each
   * record, so memory stays that of one record whatever the number of them.
   */
  collect(recs: Iterable<Rec>, table: Table, fields: Field[], pass: Pass): Map<Field, Summed> {
    const c = this.collector(table, fields, pass);
    for (const r of recs) c.add(r);
    return c.result;
  }

  /** Summary inputs follow the same field-access rule as user-facing formula reads. */
  private summaryInput(rec: Rec, field: Field, pass: Pass): Value {
    return rec.store.fieldHidden(rec.table.name, field.name, pass.privileges) ? EMPTY : this.value(rec, field, 1, pass);
  }

  /** Collects what `fields` summarize one record at a time, as `collect` does, for callers that read the records themselves. */
  collector(table: Table, fields: Field[], pass: Pass): { add(r: Rec): void; result: Map<Field, Summed> } {
    const out = new Map<Field, Summed>();
    const ofs = fields.map((f) => [f, f.summary && table.fields.find((x) => x.id === f.summary!.fieldId)] as const);
    for (const [f] of ofs) out.set(f, { count: 0, nums: [], ...(f.summary?.type === 'list' ? { texts: [] } : {}) });
    const sub: Pass = { ...newPass(pass.account, pass.privileges), onRead: pass.onRead, onQuery: pass.onQuery, foundSet: pass.foundSet, sums: (pass.sums ??= new Map()) };
    const add = (r: Rec) => {
      checkMemory();
      for (const [f, of] of ofs) {
        if (!of) continue;
        const v = this.summaryInput(r, of, sub);
        if (isEmpty(v)) continue;
        const acc = out.get(f)!;
        acc.count++;
        if (acc.texts) acc.texts.push(asText(v));
        else if (f.summary!.type !== 'count') {
          const n = asNumberOrEmpty(v);
          if (n !== undefined) acc.nums.push(n);
        }
      }
      sub.values.clear();
      sub.related.clear();
    };
    return { add, result: out };
  }

  /** A summary over the pass's found set: collected once in the pass, then each record's own value applied. */
  private foundSummary(rec: Rec, field: Field, pass: Pass): Value {
    const of = field.summary && rec.table.fields.find((f) => f.id === field.summary!.fieldId);
    if (!of) return EMPTY;
    const key = `found:${rec.store.name}/${rec.table.id}/${field.id}`;
    const sums = (pass.sums ??= new Map());
    let acc = sums.get(key);
    if (!acc) {
      acc = this.collect(pass.foundSet!.recs, rec.table, [field], pass).get(field)!;
      sums.set(key, acc);
    }
    return summedFor(rec.table, field, acc, this.summaryInput(rec, of, pass));
  }

  /** A summary field's value over a set of records (a found set or related records). */
  summary(recs: Iterable<Rec>, table: Table, field: Field, pass: Pass, current?: Rec): Value {
    const of = field.summary && table.fields.find((f) => f.id === field.summary!.fieldId);
    if (!of) return EMPTY;
    const own = current ? this.summaryInput(current, of, pass) : undefined;
    return summedFor(table, field, this.collect(recs, table, [field], pass).get(field)!, own);
  }

  /** A summary over every record of its table, for a record of it. */
  private tableSummary(rec: Rec, field: Field, pass: Pass): Value {
    const of = field.summary && rec.table.fields.find((f) => f.id === field.summary!.fieldId);
    if (!of) return EMPTY;
    return summedFor(rec.table, field, this.wholeTable(rec.table, [field], pass).get(field)!, this.summaryInput(rec, of, pass));
  }

  /**
   * Whether a field's value depends only on this file's data (and the
   * account): no clock, random numbers, globals, variables, window or layout
   * state, dynamic field names, or tables in other files, through the
   * unstored calculations, summaries and custom functions it reaches. Such a
   * value stays right until the file's write token moves, so results worked
   * out from it can be kept between reads.
   */
  stable(table: Table, f: Field, seen = new Set<string>(), globals?: Map<string, { table: Table; field: Field }>): boolean {
    this.refreshPlugins();
    const key = `${table.id}\u0000${f.id}`;
    const known = this.stability.get(key);
    // Collecting globals: a field known to be unstable may be so only through globals, so it is walked again.
    if (known !== undefined && (!globals || known)) return known;
    if (seen.has(key)) return true; // a cycle: decided by the rest of the walk
    seen.add(key);
    let ok: boolean;
    if (f.options?.global) {
      ok = !!globals;
      globals?.set(key, { table, field: f });
    } else if (f.kind === 'summary') {
      const of = table.fields.find((x) => x.id === f.summary?.fieldId);
      ok = !of || this.stable(table, of, seen, globals);
    } else if (f.kind === 'calculation' && f.options?.unstored) ok = this.stableFormula(table, f.calculation ?? '', seen, 0, globals, f.calculationContextId ?? this.defaultOccurrence(table));
    else ok = true; // stored: its value is data, which the write token covers
    if (!globals && (seen.size === 1 || !ok)) this.stability.set(key, ok);
    seen.delete(key);
    return ok;
  }

  /**
   * The globals a field's value rests on, when it is otherwise stable (see
   * stable): a result worked out from it stays right while the data and
   * those globals' values are the same. Undefined when it isn't stable.
   */
  stableGivenGlobals(table: Table, f: Field): { table: Table; field: Field }[] | undefined {
    const key = `${table.id}\u0000${f.id}`;
    this.refreshPlugins();
    if (this.givenGlobals.has(key)) return this.givenGlobals.get(key) ?? undefined;
    const globals = new Map<string, { table: Table; field: Field }>();
    const out = this.stable(table, f) ? [] : this.stable(table, f, new Set(), globals) ? [...globals.values()] : undefined;
    this.givenGlobals.set(key, out ?? null);
    return out;
  }

  private readonly givenGlobals = new Map<string, { table: Table; field: Field }[] | null>();

  /** What the globals a field rests on hold now (for this session): '' when it rests on none. */
  globalsKey(table: Table, f: Field): string {
    const globals = this.stableGivenGlobals(table, f);
    if (!globals?.length) return '';
    const values = globals.map((g) => {
      const v = this.globalValue(g.table, g.field);
      return typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v;
    });
    return `~g${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 16)}`;
  }

  private stableFormula(table: Table, formula: string, seen: Set<string>, depth = 0, globals?: Map<string, { table: Table; field: Field }>, contextId?: number): boolean {
    if (VOLATILE.test(formula) || depth > 20) return false;
    // Only text coercion uses the moving two-digit-year window. Unknown expressions
    // remain volatile; even a calculation declared as a date can return text.
    // A normal field is trusted by its type, though a date, timestamp or number field can hold text that
    // didn't parse when written, which fromStored parses again (with the current window) on each read.
    // Not tracked here: such a value goes stale across a year boundary for at most COMPUTED_KEEP_MS,
    // the lifetime of every kept result.
    const nonTextDateArg = (n: Node): boolean => {
      if (n.k === 'num') return true;
      if (n.k === 'unary') return nonTextDateArg(n.a);
      if (n.k === 'call' && ['date', 'time'].includes(n.name.toLowerCase())) return n.args.every(nonTextDateArg);
      if (n.k !== 'field') return false;
      const to = n.occurrence ? this.occurrence(n.occurrence) : contextId === undefined ? undefined : this.tosById.get(contextId);
      if (to?.dataSourceId) return false;
      const target = to ? this.occurrenceTable(to.id)?.table : n.occurrence ? undefined : table;
      const field = target?.fields.find((f) => f.name.toLowerCase() === n.name.toLowerCase());
      return !!field && field.kind === 'normal' && ['number', 'date', 'time', 'timestamp'].includes(field.type);
    };
    // Inspect parsed calls, including bare zero-argument calls and decoded owner/index markers.
    // Strings and locally bound names must not be mistaken for plug-in calls.
    const stableCalls = (n: Node, locals = new Set<string>()): boolean => {
      const stableName = (name: string, bare = false): boolean => {
        const lower = name.toLowerCase();
        if ((lower.startsWith('be_') && !PURE_BE.has(lower)) || lower === 'mbs') return false;
        if (FUNCTIONS.has(lower)) return PURE_BE.has(lower) || STABLE_BUILTINS.has(lower);
        const plugin = this.store.plugin(name);
        if (!this.pluginFunctions.has(lower)) this.designHash = undefined;
        this.pluginFunctions.set(lower, plugin);
        if (plugin) return plugin.pure === true;
        return bare ? !pluginNotInstalled(name) : lower === '[]' || this.store.schema.customFunctions.some((cf) => cf.name.toLowerCase() === lower);
      };
      switch (n.k) {
        // Get parameters include session/window state and indirect clock/random reads.
        // Unknown future parameters must not silently become cacheable either.
        case 'get': return false;
        case 'call': {
          const lower = n.name.toLowerCase();
          // The query is read for clock functions, so it must be written out in the formula.
          if ((lower === 'executesql' || lower === 'executesqle') && (n.args[0]?.k !== 'str' || SQL_CLOCK.test(n.args[0].value))) return false;
          // Datatype 3 (date) and 5 (timestamp) parse values with the moving two-digit-year window.
          if ((lower === 'sortvalues' || lower === 'uniquevalues') && n.args.length > 1) {
            const d = n.args[1];
            const literal = d.k === 'num' ? d.value : d.k === 'unary' && d.op === '-' && d.a.k === 'num' ? -d.a.value : undefined;
            if (literal === undefined || [3, 5].includes(Math.abs(Math.trunc(literal)))) return false;
          }
          return (DATE_COERCIONS.has(lower)
            ? n.args.length >= FUNCTIONS.get(lower)!.min && n.args.every(nonTextDateArg)
            : stableName(n.name)) && n.args.every((a) => stableCalls(a, locals));
        }
        case 'var': return (locals.has(n.name.toLowerCase()) || stableName(n.name, true)) && (!n.rep || stableCalls(n.rep, locals));
        case 'field': return !n.rep || stableCalls(n.rep, locals);
        case 'let': {
          const bound = new Set(locals);
          for (const [name, value, rep] of n.binds) {
            if (!stableCalls(value, bound) || (rep && !stableCalls(rep, bound))) return false;
            bound.add(name.toLowerCase());
          }
          return stableCalls(n.body, bound);
        }
        case 'unary': return stableCalls(n.a, locals);
        case 'bin': return stableCalls(n.a, locals) && stableCalls(n.b, locals);
        default: return true;
      }
    };
    try {
      if (!stableCalls(compile(formula, contextId === undefined ? new NameTable() : this.names(contextId)).node)) return false;
    } catch (e) {
      rethrowExecutionRefusal(e);
      return false;
    }
    // SQL in the formula: every table it names must be in this file, and named in the formula, not at run time.
    if (/executesql/i.test(formula) && /\b(?:FROM|JOIN)\s*(?:\\")?"\s*&/i.test(formula)) return false;
    if (/executesql/i.test(formula)) for (const m of formula.matchAll(/\b(?:FROM|JOIN)\s+(?:\\?"([^"\\]+)\\?"|([\w.~]+))/gi)) {
      const to = this.occurrence(m[1] ?? m[2]);
      // One this file doesn't have may be anything.
      if (!to || to.dataSourceId) return false;
    }
    const lower = formula.toLowerCase();
    // Related fields: TO::Field. Each occurrence the formula names (the longest name where they overlap), and
    // its field read against the occurrence's table, longest name first, as the parser reads them; a field
    // that can't be read is taken as unstable, since what it holds isn't known.
    if (formula.includes('::')) {
      const found: { start: number; end: number; to: TableOccurrence }[] = [];
      for (const o of this.store.schema.tableOccurrences) {
        const n = o.name.toLowerCase();
        if (!lower.includes(n)) continue;
        for (const m of lower.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(n)}\\s*::\\s*`, 'gu'))) found.push({ start: m.index, end: m.index + m[0].length, to: o });
      }
      found.sort((x, y) => y.end - y.start - (x.end - x.start));
      const taken: { start: number; end: number }[] = [];
      for (const { start, end, to } of found) {
        if (taken.some((t) => start >= t.start && end <= t.end)) continue;
        taken.push({ start, end });
        if (to.dataSourceId) return false;
        const other = this.store.schema.tables.find((t) => t.id === to.baseTableId);
        if (!other) return false;
        const rest = lower.slice(end);
        const field = [...other.fields].sort((x, y) => y.name.length - x.name.length)
          .find((x) => rest.startsWith(x.name.toLowerCase()) && !/[\p{L}\p{N}_]/u.test(rest[x.name.length] ?? ''));
        if (!field || !this.stable(other, field, seen, globals)) return false;
        if (!this.stablePath(contextId, to.id, seen, globals)) return false;
      }
    }
    // Fields of its own table, by whole name.
    for (const field of table.fields) {
      if (!field.options?.global && (field.kind === 'normal' || (field.kind === 'calculation' && !field.options?.unstored))) continue;
      if (wholeName(lower, field.name.toLowerCase()) && !this.stable(table, field, seen, globals)) return false;
    }
    // Custom functions it calls (one in JavaScript may use the clock or Math.random: never stable).
    for (const cf of this.store.schema.customFunctions) {
      if (cf.formula && wholeName(lower, cf.name.toLowerCase()) &&
        (cf.language === 'javascript' || !this.stableFormula(table, cf.formula, seen, depth + 1, globals, contextId))) return false;
    }
    return true;
  }

  /** Purity follows enable/disable and replacement without requiring a database write. */
  private readonly pluginFunctions = new Map<string, PluginFunction | undefined>();

  private refreshPlugins(): void {
    let changed = false;
    for (const [name, previous] of this.pluginFunctions) {
      const current = this.store.plugin(name);
      if (current !== previous) {
        this.pluginFunctions.set(name, current);
        changed = true;
      }
    }
    if (!changed) return;
    this.stability.clear();
    this.givenGlobals.clear();
    this.tableSums.clear();
    this.sqlResults.clear();
    this.computedValues.clear();
    this.computedCount = 0;
    this.dropFound();
    this.designHash = undefined;
  }

  private readonly stability = new Map<string, boolean>();

  /**
   * Whether the records related to a record (seen from `fromId`, the
   * occurrence its calculation is worked out from) depend only on the data:
   * no global or unstable match field on either side of a relationship on the
   * way, and no other file's occurrence.
   */
  private stablePath(fromId: number | undefined, toId: number, seen: Set<string>, globals?: Map<string, { table: Table; field: Field }>): boolean {
    const tos = this.store.schema.tableOccurrences;
    if (fromId === undefined) return true;
    {
      for (const hop of relationPath(this.store.schema, fromId, toId) ?? []) {
        for (const p of hop.rel.predicates) {
          for (const [toOf, fieldId] of [[hop.rel.leftTableOccurrenceId, p.leftFieldId], [hop.rel.rightTableOccurrenceId, p.rightFieldId]] as const) {
            const occ = tos.find((t) => t.id === toOf);
            if (!occ || occ.dataSourceId) return false;
            const t = this.store.schema.tables.find((x) => x.id === occ.baseTableId);
            const f = t?.fields.find((x) => x.id === fieldId);
            if (t && f && !this.stable(t, f, seen, globals)) return false;
          }
        }
      }
    }
    return true;
  }

  private summaryDependencies(pass: Pass): Map<Store, { stamp: string; schema: Schema }> {
    const kept = pass.summaryDependencies?.get(this.store);
    if (kept && ![...kept.keys(), this.store].some((store) => store.sql.isTransaction)) return kept;
    const dependencies = new Map<Store, { stamp: string; schema: Schema }>();
    const visited = new Set<Store>([this.store]);
    const visit = (store: Store) => {
      // Conservatively include every reachable source, including transitive sources
      // and relationship match fields. Cycles are common in hosted solutions.
      for (const source of store.schema.dataSources) {
        const name = dataSourceFile(source.paths ?? []);
        const other = name && store.resolvedFile(name);
        if (!other || visited.has(other)) continue;
        visited.add(other);
        dependencies.set(other, { stamp: other.calc.passStamp(pass), schema: other.schema });
        visit(other);
      }
    };
    visit(this.store);
    (pass.summaryDependencies ??= new Map()).set(this.store, dependencies);
    return dependencies;
  }

  /**
   * Summaries over every record of a table: once per pass, and kept between
   * passes while the data is the same when they summarize stored values (so
   * paging through a large table doesn't read it all again for each page).
   */
  wholeTable(table: Table, fields: Field[], pass: Pass): Map<Field, Summed> {
    // An account that may view only some of the table's records: over those, once per pass, never kept for others.
    const limited = pass.privileges && this.store.limitsView(table.name, pass.privileges);
    // Preparation also keeps summaries only in the pass, including nested reads in other stores.
    if (preparing.getStore() || limited || pass.onRead) {
      const out = new Map<Field, Summed>();
      const key = (f: Field) => `${limited ? 'limited/' : ''}${sumKey(this.store, table, f, pass)}`;
      const missing = fields.filter((f) => {
        const kept = pass.sums?.get(key(f));
        if (kept) out.set(f, kept);
        return !kept;
      });
      if (missing.length) {
        const recs = limited
          ? rowsById(this.store, table, this.store.viewableIds(table.name, pass.privileges!) ?? [])
          : this.allRecords(this.store, table, missing.length === 1 ? missing[0] : undefined);
        for (const [f, acc] of this.collect(recs, table, missing, pass)) {
          out.set(f, acc);
          (pass.sums ??= new Map()).set(key(f), acc);
        }
      }
      return out;
    }
    const out = new Map<Field, Summed>();
    const token = this.passStamp(pass);
    const missing: Field[] = [];
    const fresh = (k: string) => {
      const e = this.tableSums.get(k);
      return e && e.token === token && e.until > Date.now() ? e.acc : undefined;
    };
    let stale = false;
    for (const f of fields) {
      const key = sumKey(this.store, table, f, pass);
      let kept = pass.sums?.get(key) ?? (this.stableGivenGlobals(table, f) ? fresh(key) : undefined);
      // Worked out by another process or the warmer; one from before the latest change only stands in on a layout read.
      if (!kept && this.shareable(table, f, pass)) {
        const shared = this.store.results!.get(this.sharedKey(`sum/${key}`));
        // One at this version stands only while it is recent (an older version's is marked stale and rewarmed).
        if (shared && (shared.stamp === token ? recent(shared.at) : this.standIn(pass, this.store, shared.stamp, token))) {
          kept = parseSummed(shared.value);
          if (shared.stamp === token) this.tableSums.set(key, { token, acc: kept, until: shared.at + COMPUTED_KEEP_MS });
          else {
            stale = true;
            (pass.staleSums ??= new Set()).add(f);
          }
        }
      }
      if (kept) out.set(f, kept);
      else {
        missing.push(f);
        if (tracing()) traceNote(`sum t${table.id}.f${f.id} worked out: ${this.missReason(table, f, pass, key, token)}`);
      }
    }
    if (stale) {
      pass.stale = (pass.stale ?? 0) + 1;
      this.store.warmSoon();
    }
    // One process works each shared result out at a time: the others (and their requests) wait for it rather than
    // each reading every record at once, which multiplies the time and memory by the number of processes.
    const claimed: string[] = [];
    if (missing.length && this.store.results) {
      const theirs: Field[] = [];
      for (const f of missing.splice(0)) {
        const claim = this.shareable(table, f, pass) && `${this.sharedKey(`sum/${sumKey(this.store, table, f, pass)}`)}@${token}`;
        if (!claim || this.store.results.claim(claim, CLAIM_MS)) {
          missing.push(f);
          if (claim) claimed.push(claim);
        } else theirs.push(f);
      }
      for (const f of theirs) {
        const key = sumKey(this.store, table, f, pass);
        const shared = this.waitShared(this.sharedKey(`sum/${key}`), token, claimed);
        if (!shared) {
          missing.push(f);
          if (tracing()) traceNote(`sum t${table.id}.f${f.id} worked out: another connection's work on it didn't finish in time`);
          continue;
        }
        const acc = parseSummed(shared.value);
        this.tableSums.set(key, { token, acc, until: shared.at + COMPUTED_KEEP_MS });
        out.set(f, acc);
      }
    }
    if (missing.length) try {
      const dependencies = missing.some((f) => !this.stableGivenGlobals(table, f)) ? this.summaryDependencies(pass) : undefined;
      // Do not publish values read from another file's uncommitted transaction.
      const pendingDependency = dependencies && [...dependencies.keys()].some((store) => store.sql.isTransaction);
      // Sums from before the last change are dropped, not kept beside the new ones.
      for (const [k, v] of this.tableSums) if (v.token !== token || v.until <= Date.now()) this.tableSums.delete(k);
      for (const [k, v] of this.observedSummaries) if (v.token !== token || v.until <= Date.now()) this.observedSummaries.delete(k);
      const one = missing.length === 1 ? missing[0] : undefined;
      const cols = summaryColumns(table, missing);
      // The data version and the records are read in one read transaction, so what is kept is exactly as of `at`
      // (another process's change can land after `token` was read, but not in the middle of the records).
      const sql = this.store.sql;
      const own = !!this.store.results && !sql.isTransaction;
      let at = token;
      let collected: Map<Field, Summed>;
      if (own) sql.exec('BEGIN');
      try {
        if (own) {
          at = this.store.dataStamp();
          // Only read in this transaction, so its related lookups can be kept (at the version read).
          (pass.stamps ??= new Map()).set(this.store, at);
          this.reading = true;
        }
        const recs = cols ? this.storedRows(table, cols) : this.allRecords(this.store, table, one);
        collected = this.collect(claimed.length ? this.renewing(recs, claimed) : recs, table, missing, pass);
      } finally {
        this.reading = false;
        if (own && sql.isTransaction) sql.exec('COMMIT');
      }
      // Kept at the version read, which a change meanwhile makes older than now: then it only stands in.
      const moved = at !== token;
      for (const [f, acc] of collected) {
        const key = sumKey(this.store, table, f, pass);
        out.set(f, acc);
        (pass.sums ??= new Map()).set(key, acc);
        // Kept while the data is the same. External state may change between reads, even within a minute.
        const shareable = this.shareable(table, f, pass);
        const stable = shareable || !!summaryColumns(table, [f]) || (!!this.stableGivenGlobals(table, f) && !volatileRules(pass));
        // Over a session's own state ($$variables), which can change without the data changing: not kept.
        // Nor when the batch read another file inside its uncommitted transaction.
        if (!moved && !pendingDependency && stable) this.tableSums.set(key, { token, acc, until: Date.now() + COMPUTED_KEEP_MS });
        // Preserve the existing pre-commit refusal checks for recently warmed unstable summaries,
        // without keeping their result available for a later read.
        if (!moved && !stable && !sessionTag()) this.observedSummaries.set(key, { token, until: Date.now() + COMPUTED_KEEP_MS });
        if (shareable) this.store.results!.put(this.sharedKey(`sum/${key}`), at, JSON.stringify({ count: acc.count, nums: acc.nums, texts: acc.texts }));
      }
    } finally {
      for (const c of claimed) this.store.results!.release(c);
    }
    return out;
  }

  /** Why a whole-table summary wasn't kept or shared (for the trace; ids only). */
  private missReason(table: Table, f: Field, pass: Pass, key: string, token: string): string {
    const e = this.tableSums.get(key);
    const kept = !e ? 'not kept here' : e.token !== token ? 'kept at an older data version' : e.until <= Date.now() ? 'kept too long' : 'kept';
    if (!this.store.results) return `${kept}; sharing off`;
    if (summaryColumns(table, [f])) return `${kept}; stored column, not in shared results at this version`;
    if (volatileRules(pass)) return `${kept}; privilege rules read the clock or globals`;
    const globals = this.stableGivenGlobals(table, f);
    if (!globals) return `${kept}; not stable (clock, other files, unstable match keys or dynamic references)`;
    return `${kept}; not in shared results at this version${globals.length ? ` (rests on ${globals.length} globals)` : ''}`;
  }

  /**
   * The records, renewing this process's claims every few seconds while it
   * reads them: a claim lapses soon after its holder dies or stops, so others
   * don't wait on a result nobody is working out.
   */
  private *renewing(recs: Iterable<Rec>, claims: string[]): Iterable<Rec> {
    let renewed = performance.now();
    let n = 0;
    for (const r of recs) {
      if ((++n & 15) === 0 && performance.now() - renewed > CLAIM_RENEW_MS) {
        for (const c of claims) this.store.results!.renew(c, CLAIM_MS);
        renewed = performance.now();
      }
      yield r;
    }
  }

  /**
   * Waits for a shared result another process has claimed to work out at
   * `token`: undefined when it gave up, or it takes too long (then this one
   * works it out itself). It waits at most half the time the request has
   * left, so there is still time to work it out after giving up, renewing
   * `mine` (this process's own claims) meanwhile.
   */
  private waitShared(key: string, token: string, mine: string[] = []): { stamp: string; value: string; at: number } | undefined {
    const results = this.store.results!;
    // While the other connection keeps its claim it is still at work: wait for it, but for at most half the
    // time left, so this one can still work it out (and the summaries after it) if it gives up.
    const until = performance.now() + Math.min(CLAIM_WAIT_MS, timeLeft() / 2);
    let renewed = performance.now();
    while (performance.now() < until) {
      Atomics.wait(SLEEP, 0, 0, 100);
      // This process's own claims (taken before waiting) are kept while it waits.
      if (mine.length && performance.now() - renewed > CLAIM_RENEW_MS) {
        for (const c of mine) results.renew(c, CLAIM_MS);
        renewed = performance.now();
      }
      const s = results.get(key);
      if (s?.stamp === token && recent(s.at)) return s;
      if (!results.claimed(`${key}@${token}`)) return undefined;
    }
    return undefined;
  }

  /**
   * Whether a shared result from before the latest change may stand in for the
   * current one: on a layout read only, of the same store file, and not for an
   * account that changed the file a moment ago, which sees its own change.
   */
  private standIn(pass: Pass, target: Store, stamp: string, token: string): boolean {
    return !!pass.display && !target.warming && sameFile(stamp, token) && !target.wroteRecently(pass.account);
  }

  /**
   * Whether a field's value depends on nothing but its own record's stored
   * values: a stored field, or an unstored calculation over such fields with
   * no related fields, summaries, Get functions, SQL or custom functions.
   */
  private ownRecord(table: Table, f: Field, depth = 0): boolean {
    if (f.options?.global || f.kind === 'summary' || depth > 20) return false;
    if (!(f.kind === 'calculation' && f.options?.unstored)) return true;
    const formula = f.calculation ?? '';
    if (!this.stable(table, f) || formula.includes('::')) return false;
    const c = this.formula(table, f);
    if (!c) return false;
    const ownFunctions = (n: Node, locals = new Set<string>()): boolean => {
      switch (n.k) {
        case 'call': {
          const name = n.name.toLowerCase();
          // Unknown calls may belong to an enabled plug-in; their dependencies aren't known here.
          return !CROSS_RECORD_FUNCTIONS.has(name) && FUNCTIONS.has(name) && n.args.every((a) => ownFunctions(a, locals));
        }
        case 'get': return false;
        case 'var': {
          const name = n.name.toLowerCase();
          const field = table.fields.some((x) => x.name.toLowerCase() === name);
          return (field || locals.has(name) || (!CROSS_RECORD_FUNCTIONS.has(name) && FUNCTIONS.get(name)?.min === 0)) && (!n.rep || ownFunctions(n.rep, locals));
        }
        case 'field': return !n.occurrence && (!n.rep || ownFunctions(n.rep, locals));
        case 'let': {
          const bound = new Set(locals);
          for (const [name, value, rep] of n.binds) {
            if (!ownFunctions(value, bound) || (rep && !ownFunctions(rep, bound))) return false;
            bound.add(name.toLowerCase());
          }
          return ownFunctions(n.body, bound);
        }
        case 'unary': return ownFunctions(n.a, locals);
        case 'bin': return ownFunctions(n.a, locals) && ownFunctions(n.b, locals);
        default: return true;
      }
    };
    if (!ownFunctions(c.node)) return false;
    const lower = formula.toLowerCase();
    for (const other of table.fields) {
      if (other !== f && wholeName(lower, other.name.toLowerCase()) && !this.ownRecord(table, other, depth + 1)) return false;
    }
    return true;
  }

  /**
   * After one record of `table` changed and nothing else in the file did
   * (the data version moved from `before` to `after` by that one change):
   * whole-table summaries shared at `before` are brought up to `after` by
   * taking the record's old value out and putting its new one in, rather
   * than read again over every record. Only values of the record itself
   * qualify for a delta. Other warmed sources are checked inside the write
   * transaction for refusals and left for the warmer. Returns a publisher
   * that runs no formulas, to call only after COMMIT succeeds.
   */
  applyDelta(table: Table, old: Row | undefined, now: Row | undefined, before: string, after: string): (() => void) | undefined {
    const results = this.store.results;
    if (!results) return;
    return prepareCaches(() => {
      const bare = newPass();
      const prepared: { key: string; acc: Summed; value: string; at: number }[] = [];
      const eligible = new Set(this.deltaFields(table).map(({ f }) => f));
      for (const { f, of } of this.summaryFields(table)) {
        if (!f.summary) continue;
        const key = sumKey(this.store, table, f, bare);
        const shared = results.get(this.sharedKey(`sum/${key}`));
        const value = (row: Row) => this.value({ store: this.store, table, row }, of, 1, newPass());
        if (!eligible.has(f)) {
          // Unstable summaries have session/account keys. A warmed source still needs its file guards checked in this write's session.
          const prefix = `${this.store.name}/${table.id}/${f.id}/${f.summary.fieldId}/${f.summary.type}/`;
          const warmed = shared?.stamp === before || [...this.tableSums].some(([k, v]) => k.startsWith(prefix) && v.token === before && v.until > Date.now())
            || [...this.observedSummaries].some(([k, v]) => k.startsWith(prefix) && v.token === before && v.until > Date.now());
          if (warmed) {
            if (old) value(old);
            if (now) value(now);
          }
          continue;
        }
        // A delta keeps the result's age, so a run of writes never keeps it past COMPUTED_KEEP_MS.
        if (!shared || shared.stamp !== before || !recent(shared.at)) continue;
        const acc = parseSummed(shared.value);
        if (old && !takeOut(acc, f.summary.type, value(old))) continue;
        if (now) putIn(acc, f.summary.type, value(now));
        prepared.push({ key, acc, value: JSON.stringify({ count: acc.count, nums: acc.nums }), at: shared.at });
      }
      // Only prepared data is published after COMMIT; formulas run while the write can still roll back.
      return () => {
        for (const { key, acc, value, at } of prepared) {
          results.put(this.sharedKey(`sum/${key}`), after, value, at);
          this.tableSums.set(key, { token: after, acc, until: at + COMPUTED_KEEP_MS });
        }
      };
    });
  }

  /** Summary sources whose warmed reads must finish before a single-record write commits. */
  summaryFields(table: Table): { f: Field; of: Field }[] {
    let out = this.summaries.get(table);
    if (!out) {
      out = [];
      for (const f of table.fields) {
        if (f.kind !== 'summary' || !f.summary || f.summary.type === 'list') continue;
        const of = table.fields.find((x) => x.id === f.summary!.fieldId);
        if (of) out.push({ f, of });
      }
      this.summaries.set(table, out);
    }
    return out;
  }

  /** The summaries a write can update incrementally; other warmed sources are only checked before COMMIT. */
  deltaFields(table: Table): { f: Field; of: Field }[] {
    let out = this.deltas.get(table);
    if (!out) {
      out = this.summaryFields(table).filter(({ of }) => this.ownRecord(table, of));
      this.deltas.set(table, out);
    }
    return out;
  }

  private readonly summaries = new WeakMap<Table, { f: Field; of: Field }[]>();
  private readonly deltas = new WeakMap<Table, { f: Field; of: Field }[]>();

  /** Whether a summary's result can be shared between processes: shared results are on, and it depends only on the data. */
  private shareable(table: Table, f: Field, pass: Pass): boolean {
    return !!this.store.results && (!!summaryColumns(table, [f]) || (!!this.stableGivenGlobals(table, f) && !volatileRules(pass)));
  }

  /** A shared result's key: the design it was worked out under, so a changed formula never reads an old result. */
  private sharedKey(key: string): string {
    this.designHash ??= createHash('sha256').update(JSON.stringify([RESULTS_VERSION, this.store.schema.tables, this.store.schema.tableOccurrences, this.store.schema.relationships, this.store.schema.customFunctions, this.store.dateOrder, this.store.pluginsKey()])).digest('hex').slice(0, 16);
    return `${this.store.name}/${this.designHash}/${key}`;
  }

  private designHash?: string;

  /** Every record of a table with only the given stored columns, one at a time. */
  private *storedRows(table: Table, cols: string[]): Generator<Rec> {
    for (const row of this.store.sql.prepare(`SELECT ${['_fm_record_id', ...cols].map(q).join(', ')} FROM ${q(table.name)}`).iterate() as Iterable<Row>) {
      yield { store: this.store, table, row };
    }
  }

  /** Whole-table summaries of stored fields, by store/table/field, with the data token they were worked out at. */
  private readonly tableSums = new Map<string, { token: string; acc: Summed; until: number }>();
  /** Recently read unstable summaries still participate in write guards, but their values are never reused. */
  private readonly observedSummaries = new Map<string, { token: string; until: number }>();

  // --- relationships ----------------------------------------------------------

  /** Relationships from one occurrence to another; FileMaker's graph has one path between any two. */
  private path(from: number, to: number): Hop[] | null {
    const key = `${from}>${to}`;
    if (this.paths.has(key)) return this.paths.get(key)!;
    const prev = new Map<number, Hop | null>([[from, null]]);
    const queue = [from];
    while (queue.length && !prev.has(to)) {
      const at = queue.shift()!;
      for (const rel of this.store.schema.relationships) {
        const hops: Hop[] = [];
        if (rel.leftTableOccurrenceId === at) hops.push({ rel, reverse: false, to: rel.rightTableOccurrenceId });
        if (rel.rightTableOccurrenceId === at) hops.push({ rel, reverse: true, to: rel.leftTableOccurrenceId });
        for (const h of hops) {
          if (prev.has(h.to)) continue;
          prev.set(h.to, h);
          queue.push(h.to);
        }
      }
    }
    let result: Hop[] | null = null;
    if (prev.has(to)) {
      result = [];
      for (let at = to; at !== from;) {
        const h = prev.get(at)!;
        result.unshift(h);
        at = h.reverse ? h.rel.rightTableOccurrenceId : h.rel.leftTableOccurrenceId;
      }
    }
    this.paths.set(key, result);
    return result;
  }

  /**
   * Records related to rec (seen through occurrence `from`) in occurrence
   * `to`, in creation order. Read in batches as they are used, so a
   * relationship that matches most of a large table never holds it all.
   */
  *relatedRecs(rec: Rec, from: number, to: number, pass: Pass, cols?: string[]): Generator<Rec> {
    const target = this.occurrenceTable(to);
    if (!target) return;
    let ids = this.relatedIds(rec, from, to, pass);
    // For a user read, related records the account can't view are excluded, so
    // an aggregate over them (Sum, Count, List, ...) omits them — as FileMaker's
    // summary and multi-record calculations do.
    if (pass.privileges) {
      const allowed = target.store.viewableIds(target.table.name, pass.privileges);
      if (allowed) {
        const set = new Set(allowed);
        ids = ids.filter((id) => set.has(id));
      }
    }
    yield* rowsById(target.store, target.table, ids, cols);
  }

  /** Records related to rec in occurrence `to`, in creation order, as a list. */
  related(rec: Rec, from: number, to: number, pass: Pass): Rec[] {
    return [...this.relatedRecs(rec, from, to, pass)];
  }

  /** The first related record (in creation order), as a related field shows it. */
  firstRelated(rec: Rec, from: number, to: number, pass: Pass): Rec | undefined {
    const key = `first:${rec.store.name}/${rec.table.id}/${rec.row._fm_record_id}@${from}>${to}`;
    const cached = pass.related.get(key);
    if (cached !== undefined) return (cached as Rec | null) ?? undefined;
    const hops = this.path(from, to);
    const target = this.occurrenceTable(to);
    // For a user read, the related field shows the first record the account may
    // view; one it can't view is skipped, not shown as <No Access>.
    if (pass.privileges && target) {
      const allowed = target.store.viewableIds(target.table.name, pass.privileges);
      if (allowed !== undefined) {
        const set = new Set(allowed);
        const id = this.relatedIds(rec, from, to, pass).find((x) => set.has(x));
        const first = id === undefined ? undefined : this.rowById(target, id, pass);
        pass.related.set(key, first ?? null);
        return first;
      }
    }
    let first: Rec | undefined;
    if (hops && target) {
      if (hops.length === 1) {
        const q1 = this.hopQuery(rec, from, hops[0], pass, '*', 1);
        const row = q1 && target.store.calc.lookup(pass, q1, () => (target.store.calc.statement(q1.sql).get(...q1.params) as Row | undefined) ?? null) || undefined;
        if (row) first = { store: target.store, table: target.table, row };
      } else {
        const id = this.relatedIds(rec, from, to, pass)[0];
        if (id !== undefined) first = this.rowById(target, id, pass);
      }
    }
    pass.related.set(key, first ?? null);
    return first;
  }

  /** One record by id, kept with the file's other lookups while the data is the same (a related field on every record of a list). */
  private rowById(target: { store: Store; table: Table }, id: number, pass: Pass): Rec | undefined {
    const sql = `SELECT * FROM ${q(target.table.name)} WHERE _fm_record_id = ?`;
    const row = target.store.calc.lookup(pass, { sql, params: [id] }, () => (target.store.calc.statement(sql).get(id) as Row | undefined) ?? null);
    return row ? { store: target.store, table: target.table, row } : undefined;
  }

  /**
   * Ids of the records related to rec in occurrence `to`, in creation order.
   * Each hop through the graph keeps only ids; the records of a middle hop are
   * read back in batches to find where they lead.
   */
  relatedIds(rec: Rec, from: number, to: number, pass: Pass): number[] {
    const key = `${rec.store.name}/${rec.table.id}/${rec.row._fm_record_id}@${from}>${to}`;
    const cached = pass.related.get(key);
    if (Array.isArray(cached)) return cached;
    const hops = this.path(from, to);
    let ids: number[] = [];
    if (hops) {
      let at = from;
      let sources: Iterable<Rec> = [rec];
      for (const [i, hop] of hops.entries()) {
        // From a middle hop's records, one query for all of them when the match fields allow it.
        const joined = i > 0 ? this.joinHop(at, ids, hop, pass) : undefined;
        if (joined) {
          ids = joined;
          at = hop.to;
          const target = this.occurrenceTable(hop.to)!;
          sources = rowsById(target.store, target.table, ids, hops[i + 1] && this.matchColumns(at, hops[i + 1]));
          continue;
        }
        const found = new Set<number>();
        // Match values of the records a middle hop passes through are worked out one record at a time.
        const sub: Pass = i === 0 ? pass : { values: new Map(), busy: pass.busy, related: new Map(), account: pass.account };
        for (const r of sources) {
          checkMemory();
          const query = this.hopQuery(r, at, hop, sub, '_fm_record_id');
          if (query) {
            const target = this.occurrenceTable(hop.to)!;
            const hit = target.store.calc.lookup(pass, query, () => (target.store.calc.statement(query.sql).all(...query.params) as { _fm_record_id: number }[]).map((x) => Number(x._fm_record_id)));
            for (const id of hit) found.add(id);
          }
          if (sub !== pass) {
            sub.values.clear();
            sub.related.clear();
          }
        }
        ids = [...found];
        if (i > 0) ids.sort((a, b) => a - b);
        at = hop.to;
        const target = this.occurrenceTable(hop.to);
        if (!target) {
          ids = [];
          break;
        }
        sources = rowsById(target.store, target.table, ids, hops[i + 1] && this.matchColumns(at, hops[i + 1]));
      }
    }
    pass.related.set(key, ids);
    return ids;
  }

  /**
   * The columns a middle hop's records are read with to follow `hop` from
   * them: just its stored match fields, so a wide record (many fields, or
   * containers) isn't read whole. Undefined (every column) when a match
   * field is worked out from others: an unstored calculation or a summary.
   */
  private matchColumns(from: number, hop: Hop): string[] | undefined {
    const source = this.occurrenceTable(from);
    if (!source) return undefined;
    const cols: string[] = [];
    for (const p of hop.rel.predicates) {
      if (p.operator === '×') continue;
      const f = source.table.fields.find((x) => x.id === (hop.reverse ? p.rightFieldId : p.leftFieldId));
      if (!f) return undefined;
      if (f.options?.global) continue;
      if (f.kind === 'normal' || (f.kind === 'calculation' && !f.options?.unstored)) {
        if (!cols.includes(f.name)) cols.push(f.name);
      } else return undefined;
    }
    return cols;
  }

  /**
   * Ids of the records one hop leads to from all of `ids` (records of
   * occurrence `from`) at once, in creation order: when every match is "="
   * (or ×) between stored fields of the same type in one file, and no source
   * value is a multikey. Undefined when the hop has to go record by record.
   * Kept with the file's lookups while the data is the same: occurrences down
   * the same path, and a warm read, ask it again.
   */
  private joinHop(from: number, ids: number[], hop: Hop, pass: Pass): number[] | undefined {
    const source = this.occurrenceTable(from);
    const target = this.occurrenceTable(hop.to);
    if (!source || !target || source.store !== target.store) return undefined;
    if (!ids.length) return [];
    const stored = (f: Field | undefined) => !!f && !f.options?.global && (f.options?.repetitions ?? 1) <= 1 && (f.kind === 'normal' || (f.kind === 'calculation' && !f.options?.unstored));
    const on: string[] = [];
    const lines: string[] = [];
    for (const p of hop.rel.predicates) {
      if (p.operator === '×') continue;
      if (p.operator !== '=') return undefined;
      const mine = source.table.fields.find((f) => f.id === (hop.reverse ? p.rightFieldId : p.leftFieldId));
      const theirs = target.table.fields.find((f) => f.id === (hop.reverse ? p.leftFieldId : p.rightFieldId));
      if (!stored(mine) || !stored(theirs) || mine!.type !== theirs!.type || !['text', 'number'].includes(theirs!.type)) return undefined;
      // Number columns have REAL affinity, so they compare as numbers; text compares as the match index does.
      on.push(`t.${q(theirs!.name)} = s.${q(mine!.name)}${theirs!.type === 'text' ? ' COLLATE NOCASE' : ''} AND s.${q(mine!.name)} IS NOT NULL AND s.${q(mine!.name)} != ''`);
      if (theirs!.type === 'text') lines.push(`instr(s.${q(mine!.name)}, char(13)) OR instr(s.${q(mine!.name)}, char(10))`);
      target.store.calc.ensureIndex(target.table, theirs!);
    }
    const S = q(source.table.name);
    const T = q(target.table.name);
    const inIds = 's._fm_record_id IN (SELECT value FROM json_each(?))';
    const json = JSON.stringify(ids);
    const multi = lines.length ? `SELECT 1 FROM ${S} AS s WHERE ${inIds} AND (${lines.join(' OR ')}) LIMIT 1` : '';
    const sql = on.length
      ? `SELECT DISTINCT t._fm_record_id AS id FROM ${S} AS s CROSS JOIN ${T} AS t ON ${on.join(' AND ')} WHERE ${inIds} ORDER BY t._fm_record_id`
      : `SELECT t._fm_record_id AS id FROM ${T} AS t ORDER BY t._fm_record_id`;
    // Query the file the tables live in, which is source.store (= target.store here), not necessarily this.store: a portal whose whole relationship is in another hosted file.
    const found = source.store.calc.lookup(pass, { sql: `${multi}\u0000${sql}`, params: on.length ? [json] : [] }, () => {
      if (multi && source.store.calc.statement(multi).get(json)) return null;
      const out: number[] = [];
      for (const r of source.store.calc.statement(sql).iterate(...(on.length ? [json] : [])) as Iterable<{ id: number }>) {
        checkMemory();
        out.push(Number(r.id));
      }
      return out;
    });
    return found ?? undefined;
  }

  /**
   * A stored field's values in the records one hop away, in creation order,
   * from one query that reads just that column (the common Sum, Count or
   * List over a relationship). Undefined when the records are further away.
   */
  private storedRelatedValues(rec: Rec, from: number, to: number, f: Field, repetition: number, pass: Pass): Value[] | undefined {
    // The value cache has no record identities; observed reads use the row iterator.
    if (pass.onRead) return undefined;
    const hops = this.path(from, to);
    const target = this.occurrenceTable(to);
    if (!hops || hops.length !== 1 || !target) return undefined;
    if (pass.edited?.store === target.store && pass.edited.table.id === target.table.id) return undefined;
    // Records the account can't view are left out of what it sees: read them one by one (relatedRecs) instead.
    if (pass.privileges && target.store.limitsView(target.table.name, pass.privileges)) return undefined;
    const query = this.hopQuery(rec, from, hops[0], pass, `_fm_record_id, ${q(f.name)}`);
    if (!query) return [];
    return target.store.calc.lookup(pass, { sql: `${query.sql}\u0000${repetition}`, params: query.params }, () => {
      const out: Value[] = [];
      for (const row of target.store.calc.statement(query.sql).iterate(...query.params) as Iterable<Row>) {
        checkMemory();
        out.push(storedValue(target.store, row[f.name], f, repetition));
      }
      return out;
    });
  }

  /**
   * One related-record lookup (a query of this file's records), kept while the
   * data is the same: records of a table often share the record they relate
   * to (many invoices, one customer), so a summary over a calculation, or a
   * page of records, asks the same thing many times. Large results aren't kept.
   */
  /**
   * The file's data version, read once a pass (a portal's filter or a calculation shown on every row asks for
   * it once a record, and reading it is a query). Inside a transaction, where a write may move it, each time.
   */
  passStamp(pass: Pass): string {
    if (this.store.sql.isTransaction) return this.store.dataStamp();
    const kept = (pass.stamps ??= new Map()).get(this.store);
    if (kept !== undefined) return kept;
    const token = this.store.dataStamp();
    pass.stamps.set(this.store, token);
    return token;
  }

  lookup<T>(pass: Pass, query: { sql: string; params: (string | number)[] }, run: () => T): T {
    // Inside a transaction the data may yet be rolled back, and its version with it (not in a read-only one).
    if (preparing.getStore() || (this.store.sql.isTransaction && !this.reading)) return run();
    const token = (pass.stamps ??= new Map()).get(this.store) ?? this.store.dataStamp();
    pass.stamps.set(this.store, token);
    if (token !== this.lookupToken) {
      this.dropLookups();
      this.lookupToken = token;
    }
    const key = `${query.sql}\u0000${JSON.stringify(query.params)}`;
    if (this.lookups.has(key)) return this.lookups.get(key) as T;
    const out = run();
    if (Array.isArray(out) && out.length > LOOKUP_KEEP_MAX) return out;
    // What the key and the values take, roughly; a large one (long text, a container) isn't kept.
    const bytes = 2 * key.length + 64 + sizeOf(out, LOOKUP_ENTRY_MAX);
    if (bytes > LOOKUP_ENTRY_MAX) return out;
    // All open files together keep within LOOKUP_BUDGET_MAX (or a sixty-fourth of the heap).
    if (lookupBytes.total + bytes > lookupBudget()) this.dropLookups();
    if (lookupBytes.total + bytes > lookupBudget()) return out;
    this.lookups.set(key, out);
    this.lookupBytes.bytes += bytes;
    lookupBytes.total += bytes;
    return out;
  }

  /** Explicit join-cache eviction, without changing the data version or shared calculation results. */
  dropLookups(): void {
    this.lookups.clear();
    lookupBytes.total -= this.lookupBytes.bytes;
    this.lookupBytes.bytes = 0;
  }

  /**
   * Summaries over a found set (the rows `query` selects), kept while the data
   * is the same: paging through a found set, or reading it again unchanged,
   * doesn't add them up again. Only when every one depends on this file's data
   * alone, not over a find's temporary copy, never inside a transaction (it may be rolled back), and never when
   * a value stood in for one still being worked out.
   */
  foundSums<T extends Map<string | number, unknown>>(table: Table, defs: Field[], pass: Pass, query: string, params: unknown[], compute: () => T): T {
    // A find on unstored calculations reads a temporary copy worked out for it, which may hold clock- or global-dependent values.
    if (preparing.getStore() || this.store.sql.isTransaction || /\btemp\./i.test(query) || volatileRules(pass) || !defs.every((f) => this.stableGivenGlobals(table, f))) return compute();
    const token = this.store.dataStamp();
    const select = createHash('sha256').update(`${query}\u0000${JSON.stringify(params, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v))}`).digest('hex');
    const key = `${select}|${defs.map((f) => sumKey(this.store, table, f, pass)).join('|')}`;
    if (token !== this.foundToken) {
      this.dropFound();
      this.foundToken = token;
    }
    const hit = this.foundKept.get(key);
    if (hit) {
      // The most recently used are kept longest.
      this.foundKept.delete(key);
      this.foundKept.set(key, hit);
      return hit.acc as T;
    }
    const was = pass.stale ?? 0;
    const acc = compute();
    const bytes = 2 * key.length + 64 + sizeOf([...acc.values()], FOUND_SUMS_MAX);
    if ((pass.stale ?? 0) !== was || this.store.dataStamp() !== token || bytes > FOUND_SUMS_MAX) return acc;
    if (this.foundKept.size >= FOUND_SUMS_KEEP) {
      const [oldest, e] = this.foundKept.entries().next().value!;
      this.foundKept.delete(oldest);
      this.foundBytes.bytes -= e.bytes;
      lookupBytes.total -= e.bytes;
    }
    // Counted with the related lookups, within the same share of the heap.
    if (lookupBytes.total + bytes > lookupBudget()) this.dropFound();
    if (lookupBytes.total + bytes > lookupBudget()) return acc;
    this.foundKept.set(key, { acc, bytes });
    this.foundBytes.bytes += bytes;
    lookupBytes.total += bytes;
    return acc;
  }

  private dropFound(): void {
    this.foundKept.clear();
    lookupBytes.total -= this.foundBytes.bytes;
    this.foundBytes.bytes = 0;
  }

  /** Found sets' summaries, at foundToken (see foundSums). */
  private readonly foundKept = new Map<string, { acc: Map<string | number, unknown>; bytes: number }>();
  private readonly foundBytes = keptLookups(this);
  private foundToken = '';
  private readonly lookups = new Map<string, unknown>();
  /** True while wholeTable reads in its own read-only transaction. */
  private reading = false;
  /** This file's share of lookupBytes.total, given back when it is dropped or this is collected. */
  private readonly lookupBytes = keptLookups(this);
  private lookupToken = '';

  /** The query for the records one hop from rec leads to, or undefined when an empty match field means none. */
  private hopQuery(rec: Rec, from: number, hop: Hop, pass: Pass, select: string, limit?: number): { sql: string; params: (string | number)[] } | undefined {
    const target = this.occurrenceTable(hop.to);
    const source = this.occurrenceTable(from);
    if (!target || !source) return undefined;
    const where: string[] = [];
    const params: SqlValue[] = [];
    for (const p of hop.rel.predicates) {
      if (p.operator === '×') continue;
      const mine = source.table.fields.find((f) => f.id === (hop.reverse ? p.rightFieldId : p.leftFieldId));
      const theirs = target.table.fields.find((f) => f.id === (hop.reverse ? p.leftFieldId : p.rightFieldId));
      if (!mine || !theirs) return undefined;
      const v = this.value(rec, mine, 1, pass);
      if (isEmpty(v)) return undefined;
      // FileMaker reads "Left::a < Right::b" as left op right; the query is about their side, so walking left to right flips it.
      const op = hop.reverse ? p.operator : FLIP[p.operator];
      const sourceText = mine.type === 'decimal' && typeof rec.row[mine.name] === 'string' ? rec.row[mine.name] as string : asText(v);
      target.store.calc.ensureIndex(target.table, theirs);
      const raw = op === '=' ? sourceText.split(/\r|\n/).filter((k) => k !== '') : [sourceText];
      const values = raw.map((k) => mine.type === 'decimal' || theirs.type === 'decimal' ? k
        : op === '=' ? toStored(text(k), calcFieldType(theirs.type) ?? 'unknown', this.store.dateOrder)
          : toStored(v, calcFieldType(theirs.type) ?? 'unknown', this.store.dateOrder));
      const predicate = matchPredicate(op, mine, theirs, values);
      if (!predicate) return undefined;
      where.push(predicate.where);
      params.push(...predicate.params);
    }
    const sql = `SELECT ${select} FROM ${q(target.table.name)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY _fm_record_id${limit ? ` LIMIT ${limit}` : ''}`;
    return { sql, params: params as (string | number)[] };
  }

  /** A table's columns, read once (this is replaced with the design, and the columns with it). */
  columnNames(table: Table): string[] {
    let names = this.columns.get(table.name);
    if (!names) this.columns.set(table.name, names = (this.store.sql.prepare(`PRAGMA table_info(${q(table.name)})`).all() as { name: string }[]).map((c) => c.name));
    return names;
  }

  private readonly columns = new Map<string, string[]>();
  private readonly indexed = new PreparedCache(new Set<string>(), (value) => new Set(value));
  private readonly statements = new Map<string, StatementSync>();

  statement(sql: string): StatementSync {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.store.sql.prepare(sql);
      if (this.statements.size > 500) this.statements.clear();
      this.statements.set(sql, st);
    }
    return st;
  }

  /** Match fields get an index, as FileMaker indexes them, so related lookups stay fast. */
  ensureIndex(table: Table, field: Field): void {
    const key = `${table.id}/${field.id}`;
    if (this.indexed.value.has(key)) return;
    const name = `_fm_match_${table.id}_${field.id}`;
    const nocase = field.type === 'text' ? ' COLLATE NOCASE' : '';
    try {
      this.store.sql.exec(`CREATE INDEX IF NOT EXISTS ${q(name)} ON ${q(table.name)} (${q(field.name)}${nocase})`);
      if (field.type === 'decimal') this.store.sql.exec(`CREATE INDEX IF NOT EXISTS ${q(`${name}_range`)} ON ${q(table.name)} (fm_decimal_key(${q(field.name)}))`);
      this.indexed.value.add(key);
    } catch {
      // A read-only or busy database still answers, just without the index.
    }
  }

  // --- formula context -------------------------------------------------------

  /** The context a formula sees when it runs on rec, from table occurrence toId of this file. */
  context(rec: Rec | undefined, toId: number, pass: Pass = newPass(), extra: Partial<CalcContext> = {}): CalcContext {
    const self = this.tosById.get(toId);
    const store = this.store;
    const locals = new Map<string, Value>();
    const fieldOf = (t: Table, name: string) => t.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
    const target = (ref: { occurrence?: string }) => {
      const to = ref.occurrence ? this.occurrence(ref.occurrence) : self;
      if (!to) return undefined;
      const where = this.occurrenceTable(to.id);
      return where && { to, ...where };
    };
    const records = (ref: { occurrence?: string }, field: Field, to: TableOccurrence, t: { store: Store; table: Table }): Rec[] | 'global' => {
      if (field.options?.global) return 'global';
      if (!rec) return [];
      if (!ref.occurrence || to.id === toId) return [rec];
      const first = this.firstRelated(rec, toId, to.id, pass);
      return first ? [first] : [];
    };
    return {
      names: this.names(toId),
      occurrence: self?.name,
      dateOrder: store.dateOrder,
      field: (ref: FieldRef) => {
        const t = target(ref);
        const f = t && fieldOf(t.table, ref.field);
        if (!t || !f) return undefined;
        // User-facing formulas must not recover a hidden field through an unstored
        // calc, tooltip or condition, including on their own record. fieldHidden
        // includes masked fields. Internal stored/validation/rule passes have no
        // privileges and keep using full data (see docs/calculation-privileges.md).
        if (pass.privileges && t.store.fieldHidden(t.table.name, f.name, pass.privileges)) return pass.typed && t.store !== store ? undefined : EMPTY;
        // A summary through a relationship summarizes the related records.
        if (f.kind === 'summary' && ref.occurrence && t.to.id !== toId) {
          return t.store.calc.summary(rec ? this.relatedRecs(rec, toId, t.to.id, pass) : [], t.table, f, pass);
        }
        const rs = records(ref, f, t.to, t);
        if (rs === 'global') return storedValue(t.store, t.store.calc.globalValue(t.table, f), f, ref.repetition);
        return rs.length ? t.store.calc.value(rs[0], f, ref.repetition, pass) : EMPTY;
      },
      related: (ref: FieldRef) => {
        if (!ref.occurrence || ref.occurrence.toLowerCase() === self?.name.toLowerCase()) return undefined;
        const t = target(ref);
        const f = t && fieldOf(t.table, ref.field);
        if (!t || !f) return undefined;
        // Check before the global and same-occurrence shortcuts as well.
        if (pass.privileges && t.store.fieldHidden(t.table.name, f.name, pass.privileges)) return pass.typed && t.store !== store ? undefined : [];
        if (f.options?.global) return [storedValue(t.store, t.store.calc.globalValue(t.table, f), f, ref.repetition)];
        if (!rec) return [];
        if (t.to.id === toId) return [this.value(rec, f, ref.repetition, pass)];
        // Every related record's value, read in batches (only the field's column when it is stored), each worked out on its own.
        const stored = f.kind === 'normal' || (f.kind === 'calculation' && !f.options?.unstored);
        if (stored) {
          const direct = this.storedRelatedValues(rec, toId, t.to.id, f, ref.repetition, pass);
          if (direct) return direct;
        }
        const out: Value[] = [];
        const sub: Pass = { values: new Map(), busy: pass.busy, related: new Map(), account: pass.account, privileges: pass.privileges, edited: pass.edited, onRead: pass.onRead, onQuery: pass.onQuery };
        for (const r of this.relatedRecs(rec, toId, t.to.id, pass, stored ? [f.name] : undefined)) {
          checkMemory();
          out.push(t.store.calc.value(r, f, ref.repetition, sub));
          sub.values.clear();
          sub.related.clear();
        }
        return out;
      },
      lookupNext: (ref, direction) => {
        const t = target(ref);
        const f = t && fieldOf(t.table, ref.field);
        if (!rec || !t || !f || t.to.id === toId) return undefined;
        const path = relationPath(store.schema, toId, t.to.id);
        // A nearest-match result also discloses information about the source
        // key. The raw row must not bypass that field's read privileges.
        const hop = path?.[0];
        if (pass.privileges && hop?.rel.predicates.some((p) => {
          const source = rec.table.fields.find((f) => f.id === (hop.forward ? p.leftFieldId : p.rightFieldId));
          return source && (rec.store.fieldHidden(rec.table.name, source.name, pass.privileges) || rec.store.fieldMasked(rec.table.name, source.name, pass.privileges));
        })) return EMPTY;
        const row = path?.length ? nearest(t, rec.table, rec.row, path, direction) : undefined;
        if (!row) return EMPTY;
        // As a related field reads: nothing from a record or field the account can't see.
        if (pass.privileges && (t.store.fieldHidden(t.table.name, f.name, pass.privileges) || t.store.fieldMasked(t.table.name, f.name, pass.privileges)
          || !t.store.canViewRecord(t.table.name, Number(row._fm_record_id), pass.privileges))) return EMPTY;
        return storedValue(t.store, row[f.name] as SqlValue, f, ref.repetition);
      },
      repetitions: (ref) => {
        const t = target(ref);
        return (t && fieldOf(t.table, ref.field)?.options?.repetitions) || 1;
      },
      summary: (ref, brk) => {
        // Claris returns an empty subsummary until the found set is sorted by its break field.
        const t = target(ref);
        const f = t && fieldOf(t.table, ref.field);
        const b = t && fieldOf(t.table, brk.field);
        if (!t || !f || !b || f.kind !== 'summary' || !rec || t.to.id !== toId || (brk.occurrence && this.occurrence(brk.occurrence)?.id !== toId)) return undefined;
        // Group boundaries can disclose a hidden key even when the summarized values are visible.
        if (t.store.fieldHidden(t.table.name, f.name, pass.privileges) || t.store.fieldHidden(t.table.name, b.name, pass.privileges)) return EMPTY;
        if (b.id === f.id) return this.value(rec, f, 1, pass);
        if (!pass.foundSet || !pass.sort?.some((x) => x.fieldName.split('::').pop()?.toLowerCase() === b.name.toLowerCase())) return EMPTY;
        const current = Number(rec.row._fm_record_id);
        const keyPass = newPass(pass.account, pass.privileges);
        let start = 0;
        let end = 0;
        let index = 0;
        let previous: string | undefined;
        let inRun = false;
        for (const row of pass.foundSet.recs) {
          const key = foldCase(asText(this.value(row, b, 1, keyPass), store.dateOrder));
          keyPass.values.clear();
          keyPass.related.clear();
          if (previous !== undefined && key !== previous) {
            if (inRun) { end = index; break; }
            start = index;
          }
          if (Number(row.row._fm_record_id) === current) inRun = true;
          previous = key;
          index++;
        }
        if (!inRun) return EMPTY;
        if (!end) end = index;
        const group = function* () {
          let at = 0;
          for (const row of pass.foundSet!.recs) {
            if (at >= end) break;
            if (at++ >= start) yield row;
          }
        };
        return this.summary(group(), t.table, f, pass, rec);
      },
      get: (name) => {
        switch (name.toLowerCase()) {
          case 'recordid': return rec ? num(Number(rec.row._fm_record_id)) : EMPTY;
          case 'recordmodificationcount': return rec ? num(Number(rec.row._fm_mod_id ?? 0)) : EMPTY;
          case 'accountname': case 'username': return pass.account !== undefined ? text(pass.account) : undefined;
          case 'currentprivilegesetname':
            if (pass.privileges) return text(pass.privileges.in(store).name);
          // Without an explicit evaluation privilege context, use the account's saved set.
          // AccountPrivilegeSetName must never report a script's temporary elevation.
          case 'accountprivilegesetname': {
            const account = pass.privileges?.in(store).via ?? pass.account ?? pass.privileges?.account;
            const name = account !== undefined ? store.accountPrivilegeSet(account) : undefined;
            return name === undefined ? undefined : text(name);
          }
          case 'accountextendedprivileges': {
            // The keywords (standard and custom) the account's set carries, one
            // per line, as FileMaker returns them — so a solution can gate on a
            // custom extended privilege with PatternCount/FilterValues.
            if (pass.account === undefined) return undefined;
            return text(extendedPrivilegesOf(store, pass.account).join('\r'));
          }
          case 'filename': return text(store.name);
          case 'layouttablename': return self ? text(self.name) : EMPTY;
          case 'calculationrepetitionnumber': return num(extra.calculationRepetition ?? 1);
          case 'recordnumber': case 'foundcount': case 'totalrecordcount': {
            // With no record (a formula worked out from a layout alone), the counts are still the table's.
            // For an account that cannot view every record, the records it cannot view are not counted.
            if (!rec) {
              const own = name.toLowerCase() !== 'recordnumber' ? this.occurrenceTable(toId) : undefined;
              const seen = own && own.store.viewableCount(own.table.name, pass.privileges, undefined, (pass.viewable ??= new Map()));
              return num(own ? seen ?? own.store.recordCount(own.table.name) : 0);
            }
            const id = rec.row._fm_record_id as number;
            if (name.toLowerCase() === 'recordnumber') {
              const upTo = rec.store.viewableCount(rec.table.name, pass.privileges, id, (pass.viewable ??= new Map()));
              return num(upTo ?? (rec.store.calc.statement(`SELECT count(*) AS n FROM ${q(rec.table.name)} WHERE _fm_record_id <= ?`).get(id) as { n: number }).n);
            }
            return num(rec.store.viewableCount(rec.table.name, pass.privileges, undefined, (pass.viewable ??= new Map())) ?? rec.store.recordCount(rec.table.name));
          }
        }
        return undefined;
      },
      // $$variables are the session's (a script run's), as in FileMaker; $variables belong to this one evaluation.
      variable: (name, repetition) => locals.get(`${name.toLowerCase()}[${repetition}]`)
        ?? (name.startsWith('$$') ? writer.getStore()?.globals?.readVariable?.(name, repetition) : undefined),
      setVariable: (name, repetition, value) => {
        const session = name.startsWith('$$') ? writer.getStore()?.globals : undefined;
        if (session?.writeVariable) session.writeVariable(name, repetition, value);
        else locals.set(`${name.toLowerCase()}[${repetition}]`, value);
      },
      customFunction: (name) => customFunctionDef(store.schema.customFunctions.find((c) => c.name.toLowerCase() === name.toLowerCase()),
        (formula) => store.externalFieldNames(formula)),
      plugin: (name) => store.plugin(name),
      installedPlugins: () => store.installedPlugins(),
      builtinOff: (name) => store.builtinOff(name),
      design: (name, args) => this.design(name, args, pass.privileges, toId),
      executeSQL: (query, args) => this.executeSQL(query, args, pass.privileges, pass),
      persistentData: (name, instance) => store.persistentData(name, instance),
      persistentDataIds: (name) => store.persistentDataIds(name),
      ...extra,
    };
  }

  private design(name: string, args: Value[], privileges: Privileges | undefined, toId: number): Value | undefined {
    const s = this.store.schema;
    const lines = (xs: string[]) => text(xs.join('\r'));
    const arg = (i: number) => (args[i] ? asText(args[i]) : '');
    const lower = name.toLowerCase();
    // fileName: this file ("" or its name); another file isn't open to a calculation here.
    if (!NO_FILE_ARGUMENT.has(lower) && arg(0) && arg(0).toLowerCase() !== this.store.name.toLowerCase()) return undefined;
    switch (lower) {
      case 'databasenames': return text(this.store.name);
      case 'gettableddl': return text(tableDDL(s, arg(0), !!args[1] && asBoolean(args[1]), schemaVisibility(privileges?.in(this.store))));
      // With no window here, "" (the current layout) names none.
      case 'getfieldsonlayout': {
        const json = arg(0) ? this.fieldsOnLayout(arg(0), privileges) : undefined;
        return json === undefined ? text('') : text(json);
      }
      case 'valuelistitems': {
        const vl = s.valueLists.find((v) => v.name.toLowerCase() === arg(1).toLowerCase());
        if (!vl || this.store.local(privileges)?.valueList(vl.name) === 'none') return text('');
        try {
          // As the account sees them: values from records it can't view are left out.
          return lines(this.store.valueListItems(vl.id, undefined, privileges).map((x) => x.value));
        } catch (e) {
          rethrowExecutionRefusal(e);
          return lines(vl.values ?? []);
        }
      }
    }
    const here = this.occurrenceTable(toId);
    return designFunction(this.store, name, args, { table: here?.store === this.store ? here.table : undefined, occurrence: this.tosById.get(toId)?.name, privileges });
  }

  /**
   * ExecuteSQL: FileMaker SQL names table occurrences; each becomes its base
   * table under that name. Occurrences of a table in another hosted file run
   * there, and FileMaker_Tables and FileMaker_Fields describe this file.
   */
  executeSQL(query: string, args: Value[], privileges?: Privileges, pass?: Pass): Value[][] {
    const { sql, target, stable, computed } = this.translateSQL(query, privileges, pass?.account ?? privileges?.account);
    const params = args.map((a) => toStored(a, 'unknown'));
    // Queries depending only on the data are kept while it is unchanged. Queries reading external
    // state must run again on the next read, even when the data token has not moved.
    // An account that reads everything sees what anyone with full access sees: one result serves them all.
    // readsEverything is about this file: a calculated column that reaches another file (so isn't stable) may read
    // records the account can't view there.
    const everyone = !privileges || (target === this.store && privileges.readsEverything && computed.every((c) => c.store.calc.stable(c.table, c.field)));
    const who = everyone ? '' : `${privileges.account}#${privileges.fingerprint}`;
    const key = JSON.stringify([target.name, sql, params, who, stable ? '' : sessionTag()]);
    const token = pass ? target.calc.passStamp(pass) : target.dataStamp();
    const kept = !preparing.getStore() && stable && this.sqlResults.get(key);
    const shared = !preparing.getStore() && stable && target.results ? target.calc : undefined;
    let result: { types: (string | null)[]; rows: SqlValue[][] } | undefined;
    if (kept && kept.token === token && kept.until > Date.now()) {
      result = kept.result;
    } else if (shared) {
      // Worked out by another process or the warmer; one from before the latest change only stands in on a layout read.
      const s = target.results!.get(shared.sharedKey(`sql/${key}`));
      if (s && (s.stamp === token ? recent(s.at) : pass && this.standIn(pass, target, s.stamp, token))) {
        result = parseResult(s.value);
        if (s.stamp === token) this.keepResult(key, token, result, true, s.at);
        else {
          pass!.stale = (pass!.stale ?? 0) + 1;
          target.warmSoon();
        }
      }
    }
    if (!result) {
      // The query's calculated columns are worked out with the account's privileges, when they limit what it sees.
      // One pass for the whole query (its summaries are worked out once), emptied of each record's values between rows.
      const was = target.calc.sqlPass;
      const wasToken = target.calc.sqlToken;
      target.calc.sqlPass = who ? newPass(privileges!.account, privileges) : undefined;
      // The query's calculated columns are worked out at the version it reads now (the pass's may be older,
      // when another process wrote since), asked once, not on every row.
      target.calc.sqlToken = computed.length ? target.dataStamp() : undefined;
      try {
        result = target.select(sql, params, 100_000);
      } catch (e) {
        rethrowExecutionRefusal(e);
        throw new CalcError(ERR.calculation, (e as Error).message);
      } finally {
        target.calc.sqlPass = was;
        target.calc.sqlToken = wasToken;
      }
      // Kept only when no change landed meanwhile (the query runs on another connection, so it may have seen one).
      // Not inside a transaction or trial either: the query reads the committed file, and a rollback puts the token back to
      // a value that a later, different write reaches again.
      if (!preparing.getStore() && result.rows.length <= 1000 && target.dataStamp() === token && !target.undoable && !target.sql.isTransaction) {
        this.keepResult(key, token, result, stable);
        const value = shared && serializeResult(result);
        if (value) target.results!.put(shared!.sharedKey(`sql/${key}`), token, value);
        // Each record's value of the query's calculations, for the other processes.
        if (target.results) for (const c of computed) c.store.calc.shareColumn(c.table, c.field, token);
      }
    }
    pass?.onQuery?.(target, sql, result.rows.length);
    // A number field can hold text ("$3750"); FileMaker SQL reads its number.
    const number = result.types.map((t) => t === 'REAL');
    return result.rows.map((r) => r.map((v, i) => {
      if (v === null) return EMPTY;
      if (typeof v === 'number' || typeof v === 'bigint') return num(Number(v));
      if (number[i] && typeof v === 'string') {
        const n = asNumberOrEmpty(text(v));
        return n === undefined ? EMPTY : num(n);
      }
      return text(String(v));
    }));
  }

  private keepResult(key: string, token: string, result: { types: (string | null)[]; rows: SqlValue[][] }, stable: boolean, at = Date.now()): void {
    // Over a session's own state ($$variables, global fields), which can change without the data changing: not kept.
    if (!stable) return;
    if (this.sqlResults.size >= 200) this.sqlResults.delete(this.sqlResults.keys().next().value as string);
    this.sqlResults.set(key, { token, result, until: at + COMPUTED_KEEP_MS });
  }

  /**
   * FileMaker SQL as SQLite SQL, and the file it runs in: table occurrences
   * become their base tables (under the occurrence's name), FETCH FIRST
   * becomes LIMIT, and FileMaker_Tables / FileMaker_Fields are provided. `mayRead` says whether the caller may read every
   * record of another file; a table of one it may not read is treated as a name that is not a table at all.
   */
  translateSQL(query: string, privileges?: Privileges, account?: string, mayRead?: (file: Store) => boolean): { sql: string; target: Store; stable: boolean; computed: { store: Store; table: Table; field: Field }[] } {
    query = cleanSql(query);
    if (!oneStatement(query)) throw new CalcError(ERR.calculation, 'SQL runs one statement at a time');
    refuseUnsupportedJoins(query);
    // Text and date fields by name (not one that another table has as something else): `+` and `-` on them join
    // strings and add days.
    const kinds = new Map<string, 'string' | 'date' | null>();
    for (const t of this.store.schema.tables) {
      for (const f of t.fields) {
        // A field the account can't read is not told apart from any other name.
        if (privileges?.field(t.name, f.name) === 'none') continue;
        const kind = f.type === 'text' ? 'string' : f.type === 'date' ? 'date' : null;
        const key = f.name.toLowerCase();
        kinds.set(key, kinds.has(key) && kinds.get(key) !== kind ? null : kind);
      }
    }
    // The rules SQLite does not enforce: grouped columns (FQL0025) and the types of a UNION's columns (FQL0027).
    const fieldNames = new Set(this.store.schema.tables.flatMap((t) => t.fields.map((f) => f.name.toLowerCase())));
    checkGrouping(query, fieldNames);
    const types = new Map<string, string | undefined>();
    for (const t of this.store.schema.tables) {
      for (const f of t.fields) {
        if (privileges?.field(t.name, f.name) === 'none') continue;
        const key = f.name.toLowerCase();
        const type = ['text', 'number', 'date', 'time', 'timestamp'].includes(f.type) ? f.type : undefined;
        types.set(key, types.has(key) && types.get(key) !== type ? undefined : type);
      }
    }
    checkUnionTypes(query, (name) => types.get(name));
    const tableColumns = (name: string) => this.store.schema.tables.find((t) => t.name.toLowerCase() === name)?.fields.map((f) => f.name);
    let sql = anyAllToIn(fileMakerSqlSyntax(query, (name) => kinds.get(name) ?? undefined), tableColumns);
    // The filename lookup reads the container catalog. A scoped account must keep the ordinary CAST: an alias or
    // derived column with the same name as a container field could otherwise use an arbitrary id to read that catalog.
    if (!privileges || privileges.readsEverything) {
      const containers = new Map<string, boolean>();
      for (const t of this.store.schema.tables) for (const f of t.fields) {
        const key = f.name.toLowerCase();
        containers.set(key, (containers.get(key) ?? true) && f.type === 'container');
      }
      sql = containerCastsToName(sql, (name) => containers.get(name.toLowerCase()) === true);
    }
    // USER, USERNAME and CURRENT_USER: whoever is signed in (nobody, for a query run without an account).
    sql = withAccount(sql, account ?? '', fieldNames);
    // Whether its calculations depend only on the file's data (see stable).
    let stable = !SQL_CLOCK.test(query);
    const worked: { store: Store; table: Table; field: Field }[] = [];
    const byName = new Map(this.store.schema.tableOccurrences.map((to) => [to.name.toLowerCase(), to]));
    // A top-level CTE wins over a table occurrence of the same name. It also
    // must not receive a second, policy-generated CTE with that name.
    const cteNames = topLevelCteNames(sql);
    // The file the query runs in: the one holding the tables it names (one file per query).
    let target: Store | undefined;
    const unreadable = (file: Store) => file !== this.store && !!mayRead && !mayRead(file);
    // A star in a select list is the tables' fields, not their internal columns.
    sql = expandStars(sql, (name) => {
      const to = byName.get(name.replace(/^"|"$/g, '').replace(/""/g, '"').toLowerCase());
      if (cteNames.has(name.replace(/^"|"$/g, '').replace(/""/g, '"').toLowerCase())) return undefined;
      const t = to && this.occurrenceTable(to.id);
      return t && !unreadable(t.store) ? t.store.calc.columnNames(t.table) : undefined;
    });
    // FROM / JOIN <occurrence> [[AS] alias] becomes its base table, named as the query names it.
    const tableRef = /(\b(?:FROM|JOIN)\s+)("(?:[^"]|"")+"|[\w.~]+)(?:\s+(?:AS\s+)?(?!(?:WHERE|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON|ORDER|GROUP|HAVING|UNION|LIMIT|OFFSET|FETCH)\b)("(?:[^"]|"")+"|\w+))?/gi;
    const tableKeywords = new Set(sqlTokens(sql)
      .filter((t) => t.kind === 'word' && /^(?:FROM|JOIN)$/i.test(t.text)).map((t) => t.start));
    sql = sql.replace(tableRef, (m, from: string, name: string, alias: string | undefined, offset: number) => {
      if (!tableKeywords.has(offset)) return m;
      if (cteNames.has(name.replace(/^"|"$/g, '').replace(/""/g, '"').toLowerCase())) return m;
      const to = byName.get(name.replace(/^"|"$/g, '').replace(/""/g, '"').toLowerCase());
      const t = to && this.occurrenceTable(to.id);
      // A table of a file the caller may not read is left as the query wrote it, like any name that is not a table occurrence, so SQLite
      // answers it exactly as it answers a table that is not there (the same parse errors, the same order of checks, the same words).
      if (!to || !t || unreadable(t.store)) return m;
      if (target && target !== t.store) throw new CalcError(ERR.calculation, 'ExecuteSQL across tables in different files is not supported yet');
      target = t.store;
      // Without full access, the table as the account sees it (its records, NULL for hidden fields).
      const scoped = privileges && t.store.scopedTableSql(t.table.name, privileges);
      const base = scoped ? `(${scoped})` : q(t.table.name);
      // Unstored calculations and globals have no column: the query works them out for each record.
      const computed = t.table.fields.filter((f) => ((f.kind === 'calculation' && f.options?.unstored) || f.options?.global) && f.type !== 'container' && mentions(query, f.name));
      if (!computed.length) return `${from}${base} AS ${alias ?? q(to.name)}`;
      stable &&= computed.every((f) => t.store.calc.stable(t.table, f));
      for (const f of computed) worked.push({ store: t.store, table: t.table, field: f });
      t.store.calc.defineComputedColumn();
      const cols = computed.map((f) => (privileges?.field(t.table.name, f.name) === 'none' ? `NULL AS ${q(f.name)}` : `fm_computed(${t.table.id}, ${f.id}, _fm_record_id) AS ${q(f.name)}`));
      // Their columns, where the table has them, stay empty: the computed values replace them.
      const names = new Set(computed.map((f) => f.name));
      const kept = t.store.calc.columnNames(t.table).filter((c) => !names.has(c.replace(/\(\d+\)$/, ''))).map(q);
      return `${from}(SELECT ${[...kept, ...cols].join(', ')} FROM ${base}) AS ${alias ?? q(to.name)}`;
    });
    sql = fetchToLimit(sql);
    // Common table expressions put in front of the query: FileMaker's system tables, and for an account that sees
    // only part of a table, that part under the table's own name.
    const prefix = this.systemTables(sql, privileges);
    const into = target ?? this.store;
    if (privileges) {
      // Every table the account sees only part of is shadowed by the part it sees (a common table expression of
      // the same name), so no way of naming it reads the rest: a comma join, a subquery or a quoted name the
      // rewrite above doesn't catch. Naming a schema (main.Table) would get past that, and fm_computed, dbstat
      // and the container tables read records and fields without naming their table, so those are refused.
      const refused = refusedSqlName(query);
      if (refused) throw new CalcError(ERR.calculation, `ExecuteSQL can't use ${refused} here`);
      const named = new Set(sqlTokens(query)
        .filter((t) => t.kind === 'word' || t.kind === 'identifier' || t.kind === 'string')
        .map((t) => sqlName(t).toLowerCase()));
      for (const t of into.schema.tables) {
        if (!named.has(t.name.toLowerCase()) || cteNames.has(t.name.toLowerCase())) continue;
        const scoped = into.scopedTableSql(t.name, privileges);
        if (scoped) prefix.push(`${q(t.name)} AS (${scoped.replace(` FROM ${q(t.name)} `, ` FROM main.${q(t.name)} `)})`);
      }
    }
    if (prefix.length) {
      // Joined to the query's own WITH, when it has one (after any comments in front of it).
      const withClause = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*WITH(?:\s+RECURSIVE)?\b/i.exec(sql);
      sql = withClause ? `${withClause[0]} ${prefix.join(', ')},${sql.slice(withClause[0].length)}` : `WITH ${prefix.join(', ')} ${sql}`;
    }
    return { sql, target: into, stable, computed: worked };
  }

  private computedColumn = false;
  /** fm_computed values of calculations that depend only on the data, by table and field, with the write token they were worked out at. */
  private readonly computedValues = new Map<string, { token: string; values: Map<number, SqlValue | null>; until: number; shared?: boolean }>();

  /** A calculation's values on every record, worked out by another process at this data version. */
  private sharedColumn(table: Table, f: Field, token: string): { values: Map<number, SqlValue | null>; at: number } | undefined {
    const kept = this.store.results?.get(this.sharedKey(`col/${table.id}/${f.id}`));
    if (!kept || kept.stamp !== token || !recent(kept.at)) return undefined;
    try {
      return { values: new Map((JSON.parse(kept.value, revive) as [number, SqlValue | null][])), at: kept.at };
    } catch {
      return undefined;
    }
  }

  /** Shares a calculation's values once every record's is worked out (an ExecuteSQL query over the table works them all out). */
  shareColumn(table: Table, f: Field, token: string): void {
    if (preparing.getStore()) return;
    const kept = this.computedValues.get(`${table.id}\u0000${f.id}`);
    if (!kept || kept.shared || kept.token !== token || kept.until <= Date.now() || !this.store.results) return;
    if (kept.values.size < this.store.recordCount(table.name)) return;
    const value = serializeValues([...kept.values]);
    if (value) this.store.results.put(this.sharedKey(`col/${table.id}/${f.id}`), token, value, kept.until - COMPUTED_KEEP_MS);
    kept.shared = true;
  }
  private computedCount = 0;
  /** The data version the ExecuteSQL query running now read the file at (its calculated columns are kept at it). */
  sqlToken?: string;
  /** The pass of the ExecuteSQL query running now, when the account's privileges limit what it sees (see fm_computed). */
  sqlPass?: Pass;
  private readonly sqlResults = new Map<string, { token: string; result: { types: (string | null)[]; rows: SqlValue[][] }; until: number }>();

  /**
   * fm_computed(table id, field id, record id): an unstored calculation's or
   * global's value on a record, for ExecuteSQL (FileMaker's SQL reads them as
   * if they were stored).
   */
  defineComputedColumn(): void {
    if (this.computedColumn) return;
    this.computedColumn = true;
    this.store.defineQueryFunction('fm_computed', (tableId, fieldId, recordId) => {
      const table = this.store.schema.tables.find((t) => t.id === Number(tableId));
      const f = table?.fields.find((x) => x.id === Number(fieldId));
      if (!table || !f) return null;
      // A calculation that depends only on the data is worked out once per record while the data
      // is the same, so queries that differ only in their parameters don't each work out every record.
      let column: Map<number, SqlValue | null> | undefined;
      // For an account that sees less, worked out as it sees it and never kept for anyone else.
      const limited = this.sqlPass;
      if (preparing.getStore()) return this.computeColumn(table, f, recordId, limited ?? newPass());
      if (limited) {
        limited.values.clear();
        limited.related.clear();
        return this.computeColumn(table, f, recordId, limited);
      }
      if (this.stable(table, f)) {
        const key = `${table.id}\u0000${f.id}`;
        const token = this.sqlToken ?? this.store.dataStamp();
        let kept = this.computedValues.get(key);
        if (!kept || kept.token !== token || kept.until <= Date.now()) {
          if (kept) this.computedCount -= kept.values.size;
          const shared = this.sharedColumn(table, f, token);
          kept = { token, values: shared?.values ?? new Map(), until: (shared?.at ?? Date.now()) + COMPUTED_KEEP_MS };
          this.computedCount += kept.values.size;
          if (kept.values.size) kept.shared = true;
          this.computedValues.set(key, kept);
        }
        column = kept.values;
        const hit = column.get(Number(recordId));
        if (hit !== undefined || column.has(Number(recordId))) return hit ?? null;
        // Bounded: the oldest columns go first.
        while (this.computedCount >= COMPUTED_VALUES_MAX && this.computedValues.size > 1) {
          const [oldest, e] = this.computedValues.entries().next().value as [string, { values: Map<number, unknown> }];
          if (oldest === key) break;
          this.computedCount -= e.values.size;
          this.computedValues.delete(oldest);
        }
      }
      const value = this.computeColumn(table, f, recordId);
      if (column) {
        column.set(Number(recordId), value);
        this.computedCount++;
      }
      return value;
    });
  }

  /** An unstored calculation's or global's value on a record, as fm_computed returns it. */
  private computeColumn(table: Table, f: Field, recordId: unknown, pass: Pass = newPass()): SqlValue | null {
    const row = this.statement(`SELECT * FROM ${q(table.name)} WHERE _fm_record_id = ?`).get(Number(recordId)) as Row | undefined;
    if (!row) return null;
    try {
      const v = storedForm(this.value({ store: this.store, table, row }, f, 1, pass), f, this.store.dateOrder);
      return v === '' ? null : (v as SqlValue as number | string | null);
    } catch (e) {
      rethrowExecutionRefusal(e);
      return null;
    }
  }

  /** FileMaker's system tables, as common table expressions, when the query names them. */
  private systemTables(sql: string, privileges?: Privileges): string[] {
    const tables = /\bFileMaker_Tables\b/i.test(sql);
    const fields = /\bFileMaker_Fields\b/i.test(sql);
    const baseTables = /\bFileMaker_BaseTables\b/i.test(sql);
    const baseFields = /\bFileMaker_BaseTableFields\b/i.test(sql);
    if (!tables && !fields && !baseTables && !baseFields) return [];
    const lit = (rows: object[]) => `'${JSON.stringify(rows).replace(/'/g, "''")}'`;
    const schema = this.store.schema;
    const parts: string[] = [];
    // A limited account sees only the tables and fields it can read, each in the file it lives in.
    const visible = (to: { id: number }, field?: string) => {
      const t = this.occurrenceTable(to.id);
      return !privileges || !t || (schemaVisibility(privileges.in(t.store))!(t.table.name, field));
    };
    if (tables) {
      const rows = schema.tableOccurrences.filter((to) => visible(to)).map((to) => {
        const t = this.occurrenceTable(to.id);
        return { TableName: to.name, TableId: to.id, BaseTableName: t?.table.name ?? '', BaseFileName: t?.store.name ?? '', ModCount: 0 };
      });
      parts.push(`FileMaker_Tables AS (SELECT value->>'TableName' AS TableName, value->>'TableId' AS TableId, value->>'BaseTableName' AS BaseTableName, value->>'BaseFileName' AS BaseFileName, value->>'ModCount' AS ModCount FROM json_each(${lit(rows)}))`);
    }
    if (fields) {
      const type = (f: Field) => (f.type === 'number' ? 'decimal' : f.type === 'container' ? 'binary' : f.type === 'text' ? 'varchar' : f.type);
      const rows = schema.tableOccurrences.filter((to) => visible(to)).flatMap((to) => (this.occurrenceTable(to.id)?.table.fields ?? []).filter((f) => visible(to, f.name)).map((f) => ({
        TableName: to.name, FieldName: f.name, FieldType: type(f), FieldId: f.id,
        FieldClass: f.kind === 'calculation' ? 'Calculated' : f.kind === 'summary' ? 'Summary' : 'Normal',
        FieldReps: f.options?.repetitions ?? 1, ModCount: 0,
      })));
      parts.push(`FileMaker_Fields AS (SELECT value->>'TableName' AS TableName, value->>'FieldName' AS FieldName, value->>'FieldType' AS FieldType, value->>'FieldId' AS FieldId, value->>'FieldClass' AS FieldClass, value->>'FieldReps' AS FieldReps, value->>'ModCount' AS ModCount FROM json_each(${lit(rows)}))`);
    }
    // The base tables themselves, one row each however many occurrences show them.
    if (baseTables || baseFields) {
      const seen = new Set<string>();
      const bases: { store: Store; table: Table }[] = [];
      for (const to of schema.tableOccurrences) {
        const t = visible(to) && this.occurrenceTable(to.id);
        if (t && !seen.has(`${t.store.name}\u0000${t.table.name}`)) {
          seen.add(`${t.store.name}\u0000${t.table.name}`);
          bases.push(t);
        }
      }
      if (baseTables) {
        const rows = bases.map((t) => ({ BaseTableName: t.table.name, BaseFileName: t.store.name, ModCount: 0 }));
        parts.push(`FileMaker_BaseTables AS (SELECT value->>'BaseTableName' AS BaseTableName, value->>'BaseFileName' AS BaseFileName, value->>'ModCount' AS ModCount FROM json_each(${lit(rows)}))`);
      }
      if (baseFields) {
        const type = (f: Field) => (f.type === 'number' ? 'decimal' : f.type === 'container' ? 'binary' : f.type === 'text' ? 'varchar' : f.type);
        const occurrence = (t: { table: Table }) => schema.tableOccurrences.find((to) => this.occurrenceTable(to.id)?.table === t.table && visible(to));
        const rows = bases.flatMap((t) => t.table.fields.filter((f) => { const to = occurrence(t); return to && visible(to, f.name); }).map((f) => ({
          BaseTableName: t.table.name, BaseFileName: t.store.name, FieldName: f.name, FieldType: type(f), FieldId: f.id,
          FieldClass: f.kind === 'calculation' ? 'Calculated' : f.kind === 'summary' ? 'Summary' : 'Normal',
          FieldReps: f.options?.repetitions ?? 1, ModCount: 0,
        })));
        parts.push(`FileMaker_BaseTableFields AS (SELECT value->>'BaseTableName' AS BaseTableName, value->>'BaseFileName' AS BaseFileName, value->>'FieldName' AS FieldName, value->>'FieldType' AS FieldType, value->>'FieldId' AS FieldId, value->>'FieldClass' AS FieldClass, value->>'FieldReps' AS FieldReps, value->>'ModCount' AS ModCount FROM json_each(${lit(rows)}))`);
      }
    }
    return parts;
  }

  // --- writing ---------------------------------------------------------------

  /**
   * Apply FileMaker's write-time behaviour to a row about to be saved:
   * auto-enter options, stored calculations whose inputs changed, then
   * validation of the fields the client set. `set` names those fields.
   */
  beforeWrite(table: Table, row: Row, set: Set<string>, opts: { isNew: boolean; account?: string; previous?: Row; lastVisited?: Row; noValidation?: boolean; required?: boolean; requiredAtCommit?: boolean; skipEntryValidation?: boolean; performAutoEnter?: boolean; calcRuns?: Map<string, StyleRun[] | undefined>; uncommitted?: boolean; firstCommit?: boolean; entered?: Record<string, unknown>; overrideValidation?: string[]; editKey?: object }): void {
    const pass = newPass(opts.account);
    if (opts.editKey) pass.edited = this.editedRecord({ store: this.store, table, row: { ...row } }, set, opts.editKey, opts.account);
    const changed = new Set(set);
    const now = new Date();
    const assign = (f: Field, v: SqlValue) => {
      if (pass.edited && row[f.name] !== v) {
        if (f.kind === 'normal') {
          for (const dep of this.editedCalculations(table, [f.name])) {
            pass.edited.stored.delete(dep);
            pass.edited.fields.add(dep);
          }
        }
        pass.edited.row[f.name] = v;
      }
      row[f.name] = v;
      changed.add(f.name);
    };
    /** On-commit serials this commit gives, used up after validation. */
    const serials: Field[] = [];

    for (const f of table.fields) {
      const ae = f.options?.autoEnter;
      if (opts.performAutoEnter === false || !ae || f.options?.global || f.kind !== 'normal') continue;
      if (ae.value) {
        const creation = ae.value.startsWith('creation');
        if ((creation && opts.isNew && !set.has(f.name)) || (!creation)) {
          const kind = AUTO_VALUE_TIME[ae.value as keyof typeof AUTO_VALUE_TIME];
          if (kind) assign(f, toStored(clock(now, kind), calcFieldType(f.type) ?? 'unknown', this.store.dateOrder));
          else if (opts.account !== undefined) assign(f, opts.account);
        }
      }
      // A serial generated on commit: a script's New Record leaves it empty, and the record's first commit gives it one.
      // It is only used up once the record passes validation, so a commit that fails leaves no gap.
      if (ae.serial?.onCommit && opts.firstCommit && (row[f.name] ?? '') === '') {
        assign(f, normalizeFor(this.peekSerial(table, f) ?? null, f));
        serials.push(f);
        continue;
      }
      if (!opts.isNew || set.has(f.name)) continue;
      if (ae.serial?.onCommit && opts.uncommitted) continue;
      if (ae.serial) assign(f, normalizeFor(this.nextSerial(table, f) ?? null, f));
      else if (ae.lastVisited && opts.lastVisited) assign(f, opts.lastVisited[f.name] ?? null);
      else if (ae.data !== undefined) assign(f, normalizeFor(ae.data, f));
    }

    // Looked-up values: copied from the first related record when the match fields change.
    const changedLower = () => new Set([...changed].map((x) => x.toLowerCase()));
    for (const f of table.fields) {
      const lk = f.options?.autoEnter?.lookup;
      if (opts.performAutoEnter === false || !lk || f.kind !== 'normal' || f.options?.global || set.has(f.name)) continue;
      const fromId = lk.fromId ?? this.defaultOccurrence(table);
      const path = fromId === undefined ? undefined : relationPath(this.store.schema, fromId, lk.occurrenceId);
      if (!path?.length) continue;
      const hop = path[0];
      const keys = hop.rel.predicates.map((p) => (hop.forward ? p.leftFieldId : p.rightFieldId));
      const keyNames = table.fields.filter((x) => keys.includes(x.id)).map((x) => x.name.toLowerCase());
      const ch = changedLower();
      if (!keyNames.some((k) => ch.has(k)) && !(opts.isNew && keyNames.some((k) => row[table.fields.find((x) => x.name.toLowerCase() === k)!.name] != null))) continue;
      const res = relatedRows(this.store, fromId!, row as Record<string, string | number | null>, lk.occurrenceId, { limit: 1 });
      const source = res?.occurrence.table.fields.find((x) => x.id === lk.fieldId);
      if (!res || !source) continue;
      let found: Row | undefined = res.rows[0];
      if (!found && (lk.noMatch === 'lower' || lk.noMatch === 'higher')) found = nearest(res.occurrence, table, row, path, lk.noMatch);
      if (!found) {
        if (lk.noMatch === 'empty') assign(f, null);
        else if (lk.noMatch === 'value') assign(f, normalizeFor(lk.value ?? '', f));
        continue;
      }
      const v = found[source.name] ?? null;
      if ((v === null || v === '') && !lk.copyEmpty) continue;
      assign(f, typeof v === 'string' ? normalizeFor(v, f) : v);
    }

    // Formulas to run: stored calculations and auto-enter calculations.
    const rec: Rec = { store: this.store, table, row };
    const deps = new Map<Field, { local: Set<string>; dynamic: boolean }>();
    for (const f of table.fields) {
      const isStoredCalc = f.kind === 'calculation' && !f.options?.unstored && !f.options?.global;
      const isAutoCalc = opts.performAutoEnter !== false && f.kind === 'normal' && f.options?.autoEnter?.calculation && !f.options?.global;
      if (!isStoredCalc && !isAutoCalc) continue;
      const c = this.formula(table, f);
      if (!c) continue;
      const ctxName = this.tosById.get(f.calculationContextId ?? -1)?.name.toLowerCase();
      const local = new Set(c.fields.filter((r) => !r.occurrence || r.occurrence.toLowerCase() === ctxName).map((r) => r.name.toLowerCase()));
      deps.set(f, { local, dynamic: DYNAMIC.test(f.calculation ?? '') });
    }
    const pending = [...deps.keys()];
    const lower = (s: Set<string>) => new Set([...s].map((x) => x.toLowerCase()));
    while (pending.length) {
      let progressed = false;
      for (let i = 0; i < pending.length; i++) {
        const f = pending[i];
        const d = deps.get(f)!;
        // Wait for formulas this one reads that may still change.
        if (pending.some((g) => g !== f && d.local.has(g.name.toLowerCase()))) continue;
        pending.splice(i--, 1);
        progressed = true;
        const ch = lower(changed);
        const touched = d.dynamic ? ch.size > 0 : [...d.local].some((n) => ch.has(n));
        let run: boolean;
        if (f.kind === 'calculation') run = opts.isNew || touched;
        else {
          const ae = f.options!.autoEnter!;
          if (set.has(f.name)) run = false;
          else if (opts.isNew) run = true;
          else run = touched && (!!ae.replaceExisting || row[f.name] === null || row[f.name] === undefined || row[f.name] === '');
        }
        if (!run) continue;
        let v: SqlValue;
        try {
          // Values computed earlier in this pass may be stale now that the row changed.
          pass.values.clear();
          pass.related.clear();
          if (f.kind === 'calculation' && pass.edited?.fields.has(f)) {
            const result = this.computed(rec, f, 1, pass);
            v = storedForm(result, f, this.store.dateOrder);
            opts.calcRuns?.set(f.name, result.type === 'text' && result.runs?.length && typeof v === 'string' && v.length === result.value.length ? result.runs : undefined);
            if (v !== row[f.name]) assign(f, v);
            continue;
          }
          const c = this.formula(table, f)!;
          const toId = f.calculationContextId ?? this.defaultOccurrence(table)!;
          const repetitions = f.kind === 'calculation' ? f.options?.repetitions ?? 1 : 1;
          const results: SqlValue[] = [];
          for (let rep = 1; rep <= repetitions; rep++) {
            const ctx = this.context(rec, toId, pass, { calculationRepetition: rep });
            if (skipWhenEmpty(f, c, ctx, this.containerRef(toId))) {
              if (f.kind === 'normal') { results.length = 0; break; }
              results.push(null);
              continue;
            }
            const r = c.evaluate(ctx, valueType(f));
            const one = storedForm(r, f, this.store.dateOrder);
            results.push(one);
            // A single stored text result can carry formatting. Repeating values are stored as an array.
            if (f.kind === 'calculation' && repetitions === 1) opts.calcRuns?.set(f.name, r.type === 'text' && r.runs?.length && typeof one === 'string' && one.length === r.value.length ? r.runs : undefined);
          }
          if (!results.length) continue;
          v = repetitions > 1 ? JSON.stringify(results) : results[0];
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (e instanceof CalcNestingError) throw e;
          if (!(e instanceof CalcError)) throw e;
          v = null;
        }
        if (f.kind === 'calculation' && v === null) opts.calcRuns?.set(f.name, undefined);
        if (v !== row[f.name]) assign(f, v);
      }
      if (!progressed) throw new Error(`Cyclic calculation dependencies: ${pending.map((f) => f.name).join(', ')}`);
    }

    // Validation, for the fields the client entered (and required fields of a new record, or of a script's new record
    // at its first commit); not when putting old values back.
    const overrides = new Set(opts.overrideValidation?.map((name) => name.toLowerCase()));
    for (const f of opts.noValidation ? [] : table.fields) {
      const val = f.options?.validation;
      if (!val || f.kind !== 'normal') continue;
      if (!val.strict && overrides.has(f.name.toLowerCase())) continue;
      // Commit Records/Requests [ Skip data entry validation ] skips "Only during data entry" checks; "Always" ones still run.
      if (opts.skipEntryValidation && !val.always) continue;
      const entered = set.has(f.name) || (((opts.isNew && !opts.requiredAtCommit) || opts.required) && val.notEmpty);
      if (entered) this.validate(rec, f, pass, false, opts.entered);
      else if (val.always) this.validate(rec, f, pass, false, undefined, !!val.calculationAlways);
      // "Validate only if field has been modified" unchecked: the calculation is checked on every commit.
      else if (val.calculation && val.calculationAlways) this.validate(rec, f, pass, true);
    }
    for (const f of serials) this.nextSerial(table, f);
  }

  /**
   * A stored calculation (or auto-enter calculation) evaluated for an existing
   * record, in its stored form; null when it fails or cannot be parsed. Used
   * when design mode adds or changes a stored formula. With `strict`, a
   * formula that fails throws its CalcError instead of giving null.
   */
  computeStored(rec: Rec, f: Field, strict = false): SqlValue {
    return this.computeStoredStyled(rec, f, strict).value;
  }

  /** The same, with the formatting a text result carries, for the store to keep beside the value. */
  computeStoredStyled(rec: Rec, f: Field, strict = false, privileges?: Privileges): { value: SqlValue; runs?: StyleRun[] } {
    const c = this.formula(rec.table, f);
    const toId = f.calculationContextId ?? this.defaultOccurrence(rec.table);
    if (!c || toId === undefined) return { value: null };
    try {
      const repetitions = f.kind === 'calculation' ? f.options?.repetitions ?? 1 : 1;
      // With privileges (design mode working out a formula its author just wrote), reads of other files are theirs.
      const pass = newPass(privileges?.account, privileges);
      const results: SqlValue[] = [];
      let styled: { value: SqlValue; runs?: StyleRun[] } | undefined;
      for (let rep = 1; rep <= repetitions; rep++) {
        const ctx = this.context(rec, toId, pass, { calculationRepetition: rep });
        if (skipWhenEmpty(f, c, ctx, this.containerRef(toId))) { results.push(null); continue; }
        const r = c.evaluate(ctx, valueType(f));
        const value = storedForm(r, f, this.store.dateOrder);
        results.push(value);
        if (repetitions === 1) styled = r.type === 'text' && r.runs?.length && typeof value === 'string' && value.length === r.value.length ? { value, runs: r.runs } : { value };
      }
      return repetitions > 1 ? { value: JSON.stringify(results) } : styled ?? { value: null };
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof CalcNestingError) throw e;
      if (!(e instanceof CalcError) || strict) throw e;
      return { value: null };
    }
  }

  /** A field's validation on a record as it is now: what it fails, or undefined when it passes (or has none). */
  checkValidation(rec: Rec, f: Field, account?: string): ValidationError | undefined {
    if (!f.options?.validation || f.kind !== 'normal') return undefined;
    try {
      this.validate(rec, f, this.newPass(account));
      return undefined;
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof ValidationError) return e;
      if (e instanceof CalcNestingError) throw e;
      if (e instanceof CalcError) return undefined;
      throw e;
    }
  }

  /** Whether another record already holds a nonempty value of this unique field. */
  uniqueCollision(rec: Rec, f: Field): boolean {
    const matches = sameValuesElsewhere(rec, f);
    if (!matches.size) return false;
    const pass = this.newPass();
    for (const rep of matches) if (!isEmpty(this.value(rec, f, rep, pass))) return true;
    return false;
  }

  private validate(rec: Rec, f: Field, pass: Pass, calculationOnly = false, entered?: Record<string, unknown>, checkCalculation = true): void {
    const all = f.options!.validation!;
    const val = calculationOnly ? { calculation: all.calculation } : all;
    const fail = (code: number, why: string) => {
      let message = all.message;
      // A calculated message is worked out for this record; one that fails falls back to the standard words.
      if (message && all.messageCalculation) {
        try {
          const toId = f.calculationContextId ?? this.defaultOccurrence(rec.table)!;
          message = asText(compile(message, this.names(toId)).evaluate(this.context(rec, toId, pass)));
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (e instanceof CalcNestingError) throw e;
          if (!(e instanceof CalcError)) throw e;
          message = undefined;
        }
      }
      throw new ValidationError(code, f.name, message && !/\bAllow anyway\?\s*$/.test(message) ? message : `Field "${f.name}" ${why}`);
    };
    if (!calculationOnly) {
      let matches: Set<number> | undefined;
      const sameValue = (rep: number) => (matches ??= sameValuesElsewhere(rec, f)).has(rep);
      for (let rep = 1; rep <= Math.max(1, f.options?.repetitions ?? 1); rep++) {
        const v = this.value(rec, f, rep, pass);
        // Date/time columns are normalized before this point. Strict validation must still see
        // the entered year and clock time (for example, 5/12/26 must not become 2026-05-12).
        const enteredKey = rep === 1 ? f.name : `${f.name}(${rep})`;
        const typed = entered && Object.hasOwn(entered, enteredKey) && entered[enteredKey] != null
          ? text(String(entered[enteredKey])) : v;
        if (isEmpty(v)) {
          // Not empty applies to the first repetition, as before: whether FileMaker requires every repetition of a
          // repeating field to be filled is not documented, so later empty repetitions are not refused.
          if (val.notEmpty && rep === 1) fail(509, 'requires a value');
          continue;
        }
        if (val.unique && sameValue(rep)) fail(504, 'must be unique');
        if (val.range && !inRange(v, val.range, f, this.store.dateOrder)) fail(503, `must be between ${val.range.min} and ${val.range.max}`);
        if (val.valueList !== undefined) {
          const vl = this.store.schema.valueLists.find((l) => l.id === val.valueList);
          // File-level integrity check, not a displayed value list: deliberately
          // retain the full list. This reveals membership to editors; the
          // compatibility decision and evidence limits are documented in
          // docs/calculation-privileges.md.
          // Lists of related values depend on the record; they aren't checked here.
          const list = vl && !vl.field?.relatedFromId ? this.store.valueListItems(vl.id).map((x) => x.value) : undefined;
          if (list && !list.some((x) => foldCase(x) === foldCase(asText(v)))) fail(506, 'must be a value from its value list');
        }
        if (val.type === 'number' && !isPlainNumber(asText(v))) fail(502, 'must be a number');
        if (val.type === 'date4' && !strictDate4(typed, this.store.dateOrder)) fail(500, 'must be a date with a four-digit year');
        if (val.type === 'time' && !strictTimeOfDay(typed)) fail(501, 'must be a time of day');
        if (val.existing && !sameValue(rep)) fail(505, 'must be a value another record already has');
        if (val.maxLength !== undefined && charCount(asText(v)) > val.maxLength) fail(511, `must be at most ${val.maxLength} characters`);
      }
    }
    if (val.calculation && checkCalculation) {
      let ok = true;
      try {
        const toId = f.calculationContextId ?? this.defaultOccurrence(rec.table)!;
        ok = asBoolean(compile(val.calculation, this.names(toId)).evaluate(this.context(rec, toId, pass)));
      } catch (e) {
        rethrowExecutionRefusal(e);
        if (e instanceof CalcNestingError) throw e;
        if (!(e instanceof CalcError)) throw e;
        // A formula this engine cannot run does not block the write.
      }
      if (!ok) fail(507, 'does not meet its validation calculation');
    }
  }
}

/** Text that is wholly a number: a sign, digits with thousands commas, a decimal part and an exponent; "12x" is not. */
const isPlainNumber = (t: string) => /^\s*[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?\s*$/.test(t) && /\d/.test(t.split(/e/i)[0]);

/** Strict data type checks the entered date's year and real calendar day, not a rolled-over date calculation. */
function strictDate4(v: Value, style: DateStyle): boolean {
  if (v.type === 'date') return true;
  if (v.type !== 'text') return false;
  const order = typeof style === 'string' ? style : style.order;
  const input = v.value.trim();
  const parts = order === 'ISO' || order === 'YMD'
    ? /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(input)
    : /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(input);
  if (!parts) return false;
  const [year, month, day] = order === 'ISO' || order === 'YMD'
    ? [+parts[1], +parts[2], +parts[3]]
    : order === 'DMY' ? [+parts[3], +parts[2], +parts[1]] : [+parts[3], +parts[1], +parts[2]];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** FileMaker's strict Time of Day bounds hours and minutes; seconds are not evaluated. */
function strictTimeOfDay(v: Value): boolean {
  if (v.type === 'time') return v.value >= 0 && v.value < 86400;
  if (v.type !== 'text') return false;
  const match = /^(\d{1,2}):(\d{1,2})(?::\d{1,2}(?:\.\d+)?)?\s*([AaPp][Mm])?$/.exec(v.value.trim());
  if (!match) return false;
  const hour = +match[1];
  return +match[2] < 60 && (match[3] ? hour >= 1 && hour <= 12 : hour < 24);
}

/**
 * A lookup's "copy next lower / higher value": with no record matching, the
 * related record whose match field is the closest below or above this
 * record's. Only for one relationship with one "=" match field, as FileMaker
 * offers it.
 */
function nearest(target: { store: Store; table: Table }, table: Table, row: Row, path: { rel: Schema['relationships'][number]; forward: boolean }[], dir: 'lower' | 'higher'): Row | undefined {
  const [hop] = path;
  const [p] = hop.rel.predicates;
  if (path.length !== 1 || hop.rel.predicates.length !== 1 || p.operator !== '=') return undefined;
  const mine = table.fields.find((x) => x.id === (hop.forward ? p.leftFieldId : p.rightFieldId));
  const theirs = target.table.fields.find((x) => x.id === (hop.forward ? p.rightFieldId : p.leftFieldId));
  const key = mine && row[mine.name];
  if (!theirs || key === null || key === undefined || key === '') return undefined;
  // Text compares in FileMaker's index order (case and accents ignored).
  const fn = sortKeyFunction(theirs);
  const col = theirs.type === 'text' ? `${fn}(${q(theirs.name)})` : q(theirs.name);
  const arg = theirs.type === 'text' ? `${fn}(?)` : '?';
  const sql = `SELECT * FROM ${q(target.table.name)} WHERE ${col} ${dir === 'lower' ? '<' : '>'} ${arg} AND ${q(theirs.name)} IS NOT NULL AND ${q(theirs.name)} != '' ORDER BY ${col} ${dir === 'lower' ? 'DESC' : 'ASC'} LIMIT 1`;
  return target.store.sql.prepare(sql).get(key as string | number) as Row | undefined;
}

const FLIP: Record<string, string> = { '=': '=', '≠': '≠', '<': '>', '>': '<', '≤': '≥', '≥': '≤', '×': '×' };

/** Get ( AccountPrivilegeSetName ): the privilege set of a FileMaker account (names match case-insensitively). */
export function privilegeSetName(schema: Schema, account: string): string | undefined {
  const a = schema.accounts.find((x) => x.name.toLowerCase() === account.toLowerCase());
  return a?.privilegeSetId === undefined ? undefined : schema.privilegeSets.find((p) => p.id === a.privilegeSetId)?.name;
}

/**
 * Get ( AccountExtendedPrivileges ): the extended-privilege keywords the
 * account's privilege set carries, resolved through Tabularius's saved sets (so
 * a granted or revoked keyword is reflected at once), standard and custom
 * alike. Empty list when the account has no set.
 */
export function extendedPrivilegesOf(store: Store, account: string): string[] {
  const setName = store.accountPrivilegeSet(account);
  const def = setName ? store.privilegeSet(setName) : undefined;
  return def?.extendedPrivileges ?? [];
}

/** The SQL function giving a text field's sort keys: the order of the field's Default language (English for Unicode and for a language not named). */
export function sortKeyFunction(f: Field | undefined): string {
  return sortFunction(sortLanguage(f?.options?.indexLanguage));
}

export function calcFieldType(type: FieldType): ValueType | undefined {
  if (type === 'unknown') return undefined;
  if (type === 'boolean' || type === 'integer' || type === 'decimal') return 'number';
  if (type === 'json' || type === 'uuid') return 'text';
  return type;
}

export function valueType(f: Field): ValueType | undefined {
  return calcFieldType(f.type);
}

/** A stored column value as a calculation value; repetitions are JSON arrays, containers show their file name. */
/**
 * The columns the summary fields read, when each summarizes a stored field
 * (so a found set can be read as just those columns); undefined when one
 * summarizes a calculation computed from the rest of the record.
 */
export function summaryColumns(table: Table, summaries: Field[]): string[] | undefined {
  const cols = new Set<string>();
  for (const s of summaries) {
    const of = s.summary && table.fields.find((f) => f.id === s.summary!.fieldId);
    if (!of) continue;
    const stored = !of.options?.global && (of.kind === 'normal' || (of.kind === 'calculation' && !of.options?.unstored));
    if (!stored) return undefined;
    cols.add(of.name);
  }
  return [...cols];
}

/** Embeddings are a few thousand numbers (131,071 fit in 1 MB); nothing bigger is read whole for a calculation. */
const EMBEDDING_LIMIT = 1 << 20;

export function storedValue(store: Store, raw: SqlValue | undefined, f: Field, repetition: number): Value {
  let v: SqlValue | undefined = raw;
  if (typeof v === 'string' && v.startsWith('[') && (f.options?.repetitions ?? 1) > 1) {
    try {
      const arr = JSON.parse(v) as SqlValue[];
      v = arr[repetition - 1] ?? null;
    } catch {
      // Not an array after all: text that happens to start with "[".
    }
  } else if (repetition > 1) {
    v = null;
  }
  if (v === null || v === undefined) return EMPTY;
  if (f.type === 'container') {
    return containerValue(store, Number(v), String(v)) ?? { type: 'container', value: String(v) };
  }
  if (f.type === 'decimal') return fromStored(Number(v), 'number');
  return fromStored(typeof v === 'bigint' ? Number(v) : (v as string | number), calcFieldType(f.type) ?? 'text');
}

/**
 * A stored container file as a calculation value: its name, with its bytes read only when a function asks for them,
 * and its size and first bytes without reading the rest. Undefined when there is no such file.
 */
export function containerValue(store: Store, id: number, unnamed = ''): Value | undefined {
  const info = store.containerInfo(id);
  const name = info?.filename;
  const changed = info?.external?.changed ? { changed: true as const } : {};
  // An embedding (FileMaker 2024's FVE data, whatever the file is called) carries its
  // bytes, so CosineSimilarity and the other embedding functions can read it. Only
  // untyped files are checked, by their first 8 bytes; images and the like stay unread.
  if (info && info.size >= 16 && info.size <= EMBEDDING_LIMIT && (info.mime === 'application/octet-stream' || name?.toLowerCase().endsWith('.fve'))
    && isEmbeddingData(store.containerRange(info.id, 0, 7))) {
    const data = store.container(info.id)?.data;
    if (data) return { type: 'container', value: name ?? unnamed, data, ...changed };
  }
  if (!info) return undefined;
  // A file stored outside that isn't there has no bytes (not an empty file); one gone since is the same.
  const read = () => {
    if (info.external?.missing) return undefined;
    try {
      return store.container(info.id)?.data;
    } catch {
      return undefined;
    }
  };
  const value = withLazyData({ type: 'container', value: name ?? unnamed, ...changed }, read);
  if (info.external?.missing) return value;
  // Its size and first bytes, so the file's size and an image's dimensions don't read a whole file (a video).
  return Object.defineProperties(value, {
    size: { value: info.size, enumerable: false },
    head: {
      value: (bytes: number) => {
        try {
          return store.containerRange(info.id, 0, Math.min(bytes, info.size) - 1);
        } catch {
          return new Uint8Array(0);
        }
      },
      enumerable: false,
    },
  });
}

/**
 * A container value whose file is read only when a function asks for its bytes (GetWidth, GetContainerAttribute,
 * Base64Encode, the hash functions...), once; a formula that only shows the file name never reads it.
 */
function withLazyData<V extends Value & { type: 'container' }>(value: V, read: () => Uint8Array | undefined): V {
  let data: Uint8Array | undefined;
  let done = false;
  // Not enumerable: what walks a value's properties (a cache measuring its size, JSON) mustn't read the file.
  return Object.defineProperty(value, 'data', {
    enumerable: false,
    configurable: true,
    get: () => {
      if (!done) [data, done] = [read(), true];
      return data;
    },
  });
}

/**
 * "Do not evaluate if all referenced fields are empty", FileMaker's default
 * for calculations: a formula that reads fields, all of them empty, gives
 * an empty result (or leaves an auto-entered value alone). A container field
 * never counts as empty here: a private sample stores 1 for IsEmpty(Container)
 * on every record with an empty container (5,000+ values over 23 fields),
 * while formulas over empty text, number and date fields stay empty (all
 * 1,900 of them).
 */
export function skipWhenEmpty(f: Field, c: Compiled, ctx: CalcContext, isContainer: (r: Compiled['fields'][number]) => boolean): boolean {
  if ((f.kind === 'calculation' && f.options?.evaluateWhenEmpty) || f.options?.autoEnter?.evaluateWhenEmpty || !c.fields.length || DYNAMIC.test(c.formula)) return false;
  const rep = (ctx.calculationRepetition ?? 1) > 1 && /\bExtend\s*\(/i.test(c.formula) ? 1 : ctx.calculationRepetition ?? 1;
  return c.fields.every((r) => {
    if (isContainer(r)) return false;
    const v = ctx.field?.({ occurrence: r.occurrence, field: r.name, repetition: rep });
    return v === undefined || isEmpty(v);
  });
}

/**
 * A calculation result in a field's column form. Text that reads as a date,
 * time or timestamp becomes one in fields of those types; other text stays
 * text, as FileMaker keeps it.
 */
/** Does a query name this field (bare or in double quotes)? */
function mentions(query: string, name: string): boolean {
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`"${e}"|(?<![\\w."])${e}(?![\\w"])`, 'i').test(query);
}

function storedForm(v: Value, f: Field, order: DateStyle): SqlValue {
  if (v.type === 'text' && v.value !== '') {
    const t = f.type === 'date' ? asDate(v, order) : f.type === 'time' ? asTime(v) : f.type === 'timestamp' ? asTimestamp(v, order) : undefined;
    if (t !== undefined) return toStored({ type: f.type as 'date' | 'time' | 'timestamp', value: t }, f.type, order);
  }
  const out = toStored(v, calcFieldType(f.type) ?? 'unknown', order);
  if (f.type === 'boolean' || f.type === 'integer' || f.type === 'decimal' || f.type === 'json' || f.type === 'uuid') {
    const native = out === null ? null : nativeValue(String(out), f.type);
    if (out !== null && native === undefined) throw new ValidationError(500, f.name, `Field "${f.name}" must be a valid ${f.type}`);
    return native ?? null;
  }
  // FileMaker keeps 16 significant digits of a calculated number.
  return typeof out === 'number' && Number.isFinite(out) ? Number(out.toPrecision(16)) : out;
}

function clock(now: Date, kind: 'date' | 'time' | 'timestamp'): Value {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  const seconds = Math.floor(local.getTime() / 1000);
  const day = Math.floor(seconds / 86400) + 719163; // 1/1/1970 is day 719163 counted from 1/1/0001
  const time = seconds % 86400;
  if (kind === 'date') return { type: 'date', value: day };
  if (kind === 'time') return { type: 'time', value: time };
  return { type: 'timestamp', value: (day - 1) * 86400 + time };
}

function normalizeFor(v: string | null, f: Field): SqlValue {
  if (v === null) return null;
  if (f.type === 'number') {
    const n = asNumberOrEmpty(text(v));
    return n !== undefined && String(n) === v.trim() ? n : v;
  }
  return v;
}

/**
 * Repetitions whose values another record holds. Repeating fields share one scan across all their values.
 * Scalar text uses the field's NOCASE index for ASCII; non-ASCII text ("É" against "é") needs a scan that
 * folds every script.
 */
function sameValuesElsewhere(rec: Rec, f: Field): Set<number> {
  const stored = rec.row[f.name];
  const repeated = (f.options?.repetitions ?? 1) > 1;
  if (stored === null || stored === undefined) return new Set();
  const id = (rec.row._fm_record_id ?? -1) as number;
  const from = `FROM ${q(rec.table.name)} WHERE`;
  if (repeated) {
    let values: SqlValue[] = [stored];
    if (typeof stored === 'string' && stored.startsWith('[')) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) values = parsed;
      } catch { /* A literal value beginning with [ is still text. */ }
    }
    values = values.slice(0, f.options!.repetitions);
    if (f.type === 'text') values = values.map((v) => v === null ? null : foldCase(String(v)));
    const col = q(f.name);
    const cells = `json_each(CASE WHEN json_valid(${col}) THEN CASE WHEN json_type(${col}) = 'array' THEN ${col} ELSE json_array(${col}) END ELSE json_array(${col}) END)`;
    const value = f.type === 'text' ? 'fm_fold_case(cell.value)' : 'cell.value';
    // Scan the stored repetitions once for all candidate values, rather than once per repetition.
    // Return the matching positions so validation still reports errors in repetition order.
    const found = rec.store.sql.prepare(`SELECT DISTINCT ${value} AS value FROM ${q(rec.table.name)} CROSS JOIN ${cells} AS cell
      WHERE _fm_record_id != ? AND ${value} IN (SELECT value FROM json_each(?))`).all(id, JSON.stringify(values)) as { value: SqlValue }[];
    const matches = new Set(found.map((r) => r.value));
    return new Set(values.flatMap((v, i) => v !== null && matches.has(v) ? [i + 1] : []));
  }
  const value = stored;
  if (f.type === 'text' && typeof value === 'string' && /[^\u0000-\u007f]/.test(value)) {
    return new Set(rec.store.sql.prepare(`SELECT 1 ${from} fm_fold_case(${q(f.name)}) = ? AND _fm_record_id != ? LIMIT 1`).get(foldCase(value), id) ? [1] : []);
  }
  return new Set(rec.store.sql.prepare(`SELECT 1 ${from} ${q(f.name)}${f.type === 'text' ? ' COLLATE NOCASE' : ''} = ? AND _fm_record_id != ? LIMIT 1`).get(value, id) ? [1] : []);
}

function inRange(v: Value, range: { min: string; max: string }, f: Field, order: DateStyle): boolean {
  if (f.type === 'decimal') {
    const value = decimalKey(asText(v));
    const lo = range.min === '' ? undefined : decimalKey(range.min);
    const hi = range.max === '' ? undefined : decimalKey(range.max);
    return value !== null && (lo === undefined || (lo !== null && value >= lo)) && (hi === undefined || (hi !== null && value <= hi));
  }
  const as = (x: Value): number | undefined => {
    switch (f.type) {
      case 'date': return asDate(x, order);
      case 'time': return asTime(x);
      case 'timestamp': return asTimestamp(x, order);
      default: return asNumberOrEmpty(x);
    }
  };
  const n = as(v);
  const lo = range.min === '' ? undefined : as(text(range.min));
  const hi = range.max === '' ? undefined : as(text(range.max));
  if (n === undefined) return false;
  return (lo === undefined || n >= lo) && (hi === undefined || n <= hi);
}

/** Aggregate non-empty values the way a summary field of that type does. */
export function summarize(type: NonNullable<Field['summary']>['type'], values: Value[], own?: Value): Value {
  const nonEmpty = values.filter((v) => !isEmpty(v));
  return summed(type, {
    count: nonEmpty.length,
    nums: type === 'list' ? [] : nonEmpty.map((v) => asNumberOrEmpty(v)).filter((n): n is number => n !== undefined),
    ...(type === 'list' ? { texts: nonEmpty.map((v) => asText(v)) } : {}),
  }, own);
}

/** Where a whole-table summary is kept: by what it summarizes, so a design change starts afresh. */
/**
 * A whole-table summary's key. The account matters only when its privileges
 * hide records or fields: everyone who reads everything sees the same result
 * (calculations that read the account name aren't kept, see stable). With
 * it goes what its privilege set allows, so a changed set starts afresh.
 */
function sumKey(store: Store, table: Table, f: Field, pass: Pass): string {
  const base = `${store.name}/${table.id}/${f.id}/${f.summary?.fieldId}/${f.summary?.type}/`;
  const pv = pass.privileges && !pass.privileges.readsEverything ? pass.privileges : undefined;
  // Stored columns also depend on field access, even when every record is viewable (see wholeTable).
  if (summaryColumns(table, [f])) return `${base}${pv ? `#${pv.fingerprint}` : ''}`;
  // Over calculations: what a limiting set allows decides it, and the account too when the set has record-level
  // rules (any of which may read the account, directly or through custom functions, fields or relationships)
  // or the calculation may read it (Get ( AccountName ) makes a calculation unstable).
  const stable = !!store.calc.stableGivenGlobals(table, f);
  const byAccount = !stable || (!!pv && hasRecordRules(pv));
  // With what the globals it rests on hold now: another session's, or a changed one, is another result.
  // Over $$variables (not stable even given globals): this session's own.
  return `${base}${byAccount ? pass.account ?? '' : ''}${pv ? `#${pv.fingerprint}` : ''}${store.calc.globalsKey(table, f)}${stable ? '' : sessionTag()}`;
}

/**
 * Which session (script run, Data API session) a result was worked out in, for results over calculations that read
 * session state ($$variables, global fields): kept for that session only, never handed to another one.
 */
const sessionTags = new WeakMap<object, number>();
let lastSessionTag = 0;
function sessionTag(): string {
  const session = writer.getStore()?.globals;
  if (!session) return '';
  let tag = sessionTags.get(session);
  if (tag === undefined) sessionTags.set(session, (tag = ++lastSessionTag));
  return `/session:${tag}`;
}

/** How many found sets' summaries are kept, and the most one may take (bytes, roughly; see Calculations.foundSums). */
const FOUND_SUMS_KEEP = 64;
const FOUND_SUMS_MAX = 256 * 1024;

/** The most records a related-record lookup may return and still be kept (see Calculations.lookup). */
const LOOKUP_KEEP_MAX = 1_000;
/** The most one kept lookup may take (bytes, roughly). */
const LOOKUP_ENTRY_MAX = 64 * 1024;
let lookupBudgetBytes = 0;
/**
 * Changes when the same data and design give different results (a fix to how
 * something is worked out), so results shared by an older version aren't read.
 */
const RESULTS_VERSION = 4;

/** At most this much (bytes) per process: a server runs several, each with its own. */
const LOOKUP_BUDGET_MAX = 64 * 1024 * 1024;
const lookupBudget = () => (lookupBudgetBytes ||= Math.min(LOOKUP_BUDGET_MAX, getHeapStatistics().heap_size_limit / 64));
/** What the kept lookups of every open file take together. */
const lookupBytes = { total: 0 };
const lookupsGone = new FinalizationRegistry<{ bytes: number }>((share) => { lookupBytes.total -= share.bytes; });
function keptLookups(owner: object): { bytes: number } {
  const share = { bytes: 0 };
  lookupsGone.register(owner, share);
  return share;
}

/** Roughly how many bytes a value takes, counting no further than max. */
function sizeOf(v: unknown, max: number, depth = 0): number {
  if (typeof v === 'string') return 16 + v.length * 2;
  if (v === null || typeof v !== 'object') return 8;
  if (ArrayBuffer.isView(v)) return 16 + v.byteLength;
  if (v instanceof ArrayBuffer) return 16 + v.byteLength;
  if (depth > 3) return max;
  let n = 16;
  for (const x of Array.isArray(v) ? v : Object.values(v)) {
    n += 8 + sizeOf(x, max, depth + 1);
    if (n > max) return n;
  }
  return n;
}

/**
 * How long a claim to work out a shared result holds unless renewed (its
 * holder renews it every CLAIM_RENEW_MS while it works), and how long others
 * wait for it at most (less when the request has less time left).
 */
const CLAIM_MS = 15_000;
const CLAIM_RENEW_MS = 5_000;
const CLAIM_WAIT_MS = 40_000;
/** For sleeping between looks at a claimed result (Atomics.wait on memory nobody else touches). */
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

/** Values kept by fm_computed, across every column. */
const COMPUTED_VALUES_MAX = 500_000;
/**
 * The longest any kept result (whole-table summary, ExecuteSQL rows, fm_computed values, and shared results
 * read back) is used, however stable its formula looks: a result misjudged stable, or one over text a date
 * field holds (see stableFormula), is wrong for at most this long after the clock or year moves.
 */
const COMPUTED_KEEP_MS = 60_000;
/** Whether a result worked out at `at` (Date.now()) is still within COMPUTED_KEEP_MS. */
const recent = (at: number): boolean => Date.now() - at < COMPUTED_KEEP_MS;
/** FileMaker SQL's clock functions (and the SQLite ones they become); a query naming one isn't kept. */
const SQL_CLOCK = /\b(?:CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|CURDATE|CURTIME|CURTIMESTAMP|NOW|TODAY|USER|USERNAME|CURRENT_USER)\b/i;

// Audited built-ins whose results depend only on their arguments and tracked file data.
// Registration in FUNCTIONS alone never confers stability. Deliberately omitted:
// - session/device/design callbacks (including Location, persistent data, RAG and embeddings),
//   dynamic evaluation/field lookup, Self, GetNthRecord and GetSummary;
// - Random and salted CryptEncrypt/CryptEncryptBase64;
// - date-text coercions, checked by argument type in stableCalls because their
//   two-digit-year window depends on the current year;
// - container readers and GetThumbnail's container passthrough, whose Value.data/head
//   can load external bytes lazily.
// ExecuteSQL is further checked below stableCalls for statically named local tables.
const STABLE_BUILTINS = new Set(`
  if case choose while isempty isvalid evaluationerror isvalidexpression setrecursion
  getrepetition extend lookup last []
  left right middle length upper lower proper trim trimall exact filter substitute replace position patterncount
  quote char code serialincrement wordcount leftwords rightwords middlewords
  valuecount getvalue leftvalues rightvalues middlevalues filtervalues uniquevalues sortvalues list
  textstyleadd textstyleremove textcolor textcolorremove textfont textfontremove textsize textsizeremove textformatremove
  plain bold italic underline highlightyellow condense strikethrough smallcaps superscript subscript uppercase lowercase
  titlecase wordunderline doubleunderline allstyles rgb getascss getassvg getasurlencoded getastext getasnumber getasboolean getastime
  abs ceiling floor int round truncate setprecision mod div sign sqrt exp ln log lg sin cos tan asin acos atan degrees radians
  factorial combination pmt fv pv npv sum average variance variancep stdev stdevp count max min date time hour minute seconds
  jsonraw jsonstring jsonnumber jsonobject jsonarray jsonboolean jsonnull jsongetelement jsondeleteelement
  jsonlistkeys jsonlistvalues jsongetelementtype jsonformatelements jsonparse jsonparsedstate jsonmakearray jsonsetelement
  base64decode hexdecode cryptdecryptbase64 textencode gettokencount executesql executesqle
  posixpath winpath urlpath converttofilemakerpath convertfromfilemakerpath
  hiragana katakana kanahankaku kanazenkaku kanjinumeral romanhankaku romanzenkaku numtojtext
  trtext_getline dial_centerpointofrect
`.trim().split(/\s+/));

const DATE_COERCIONS = new Set(`
  getasdate getastimestamp timestamp day month year dayofweek dayname monthname
  daynamej monthnamej dayofyear weekofyear weekofyearfiscal
`.trim().split(/\s+/));

// Audited compatibility functions with no session, host, clock, random or I/O dependence.
// Everything else defaults to volatile, including functions that update BE error state.
// MBS dispatches dynamic names into session references, variables, clocks and host operations;
// even its arithmetic/text calls update MBS.IsError, so the whole dispatcher is volatile.
const PURE_BE = new Set(`
  BE_Version BE_VersionAutoUpdate BE_VersionPro
  BE_ButtonOK BE_ButtonCancel BE_ButtonAlternate
  BE_MessageDigestAlgorithmMD5 BE_MessageDigestAlgorithmSHA256 BE_MessageDigestAlgorithmMDC2
  BE_MessageDigestAlgorithmSHA BE_MessageDigestAlgorithmSHA1 BE_MessageDigestAlgorithmSHA224
  BE_MessageDigestAlgorithmSHA384 BE_MessageDigestAlgorithmSHA512
  BE_FileTypeAll BE_FileTypeFile BE_FileTypeFolder BE_EncodingHex BE_EncodingBase64
  BE_ScriptControlHalt BE_ScriptControlExit BE_ScriptControlResume BE_ScriptControlPause
  BE_ValuesUnique BE_ValuesFilterOut BE_ValuesContainsDuplicates BE_ValuesSort BE_ValuesTimesDuplicated BE_ValuesTrim
  BE_JSON_Encode BE_JSON_ArraySize BE_TextExtractWords BE_XOR
  BE_VectorDotProduct BE_VectorEuclideanDistance BE_Vector_EuclideanDistance BE_EncryptAES BE_DecryptAES
`.trim().toLowerCase().split(/\s+/));
/** Formula text whose value can change without this file's data changing. */
const VOLATILE = /\b(?:random|evaluate\s*\(|(?:valuelist|layout|script|field|table|database)(?:items|names|ids|objectnames|type|style|repetitions|comment|bounds|ids)\s*\(|relationinfo\s*\(|getfield\s*\(|getfieldname|get\s*\(\s*(?:current|uuid|window|layout|active|last|trigger|script|modifier|portal|request|user|system|host|application|device|screen|session|network|temporary|documents|desktop|preferences|file|connection|persistent|multi|status|page|calculationrepetition|encryption|installed|template|quickfind|instant|sort|account|privilege|extended|user))|\$/i;

/** Whether a privilege set limits records by a calculation (a rule), in any table. */
function hasRecordRules(pv: Privileges): boolean {
  const set = pv.set as { records?: { view?: unknown }; tables?: Record<string, { view?: unknown }> };
  return typeof set.records?.view === 'string' || Object.values(set.tables ?? {}).some((t) => typeof t?.view === 'string');
}

/** Whether the account's privilege set has rules whose answer changes without the data changing (the clock, globals). */
function volatileRules(pass: Pass): boolean {
  const pv = pass.privileges;
  return !!pv && !pv.readsEverything && VOLATILE.test(JSON.stringify(pv.set));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `name` appears in `text` as a whole name (both lower-cased). */
function wholeName(text: string, name: string): boolean {
  const word = /[\p{L}\p{N}_]/u;
  for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
    if (!word.test(text[i - 1] ?? ' ') && !word.test(text[i + name.length] ?? ' ')) return true;
  }
  return false;
}

/**
 * What a summary field's value is: the lowest or highest of a date, time or timestamp field is a date, time or
 * timestamp (Claris: "the lowest number, or earliest date, time, or timestamp"); everything else is a number.
 */
export function summaryKind(table: Table, f: Field): 'date' | 'time' | 'timestamp' | undefined {
  if (f.summary?.type !== 'minimum' && f.summary?.type !== 'maximum') return undefined;
  const t = table.fields.find((x) => x.id === f.summary!.fieldId)?.type;
  return t === 'date' || t === 'time' || t === 'timestamp' ? t : undefined;
}

/** The type a summary field's value is stored and shown as. */
export const summaryType = (table: Table, f: Field): Field['type'] => summaryKind(table, f) ?? f.type;

/** A summary field's value from what was collected over its records. */
export function summedFor(table: Table, f: Field, acc: Summed, own?: Value): Value {
  return summed(f.summary!.type, acc, own, summaryKind(table, f));
}

/** A summary's value from what was collected over its records. */
export function summed(type: NonNullable<Field['summary']>['type'], acc: Summed, own?: Value, kind?: 'date' | 'time' | 'timestamp'): Value {
  if (type === 'list') return text((acc.texts ?? []).join('\r'));
  if (type === 'count') return num(acc.count);
  const nums = acc.nums;
  if (!nums.length) return type === 'total' ? num(0) : EMPTY;
  if (!acc.stats) {
    const total = decimalSum(nums);
    const avg = total / nums.length;
    let min = nums[0];
    let max = nums[0];
    let squares = 0;
    for (const n of nums) {
      if (n < min) min = n;
      if (n > max) max = n;
      squares += (n - avg) ** 2;
    }
    acc.stats = { sum: total, mean: avg, sq: squares, min, max };
  }
  // Min and max by a loop, not Math.min(...nums): spreading a large table's values overflows the stack.
  const { sum, mean, sq, min, max } = acc.stats;
  switch (type) {
    case 'total': return num(sum);
    case 'average': return num(mean);
    case 'minimum': return kind ? { type: kind, value: min } : num(min);
    case 'maximum': return kind ? { type: kind, value: max } : num(max);
    case 'stdDev': return nums.length > 1 ? num(Math.sqrt(sq / (nums.length - 1))) : num(0);
    case 'stdDevP': return num(Math.sqrt(sq / nums.length));
    case 'fractionOfTotal': {
      const n = own ? asNumberOrEmpty(own) : undefined;
      return n === undefined || sum === 0 ? EMPTY : num(n / sum);
    }
  }
  return EMPTY;
}

/**
 * The value after `s` in an auto-entered serial number. A plain number (decimal,
 * negative or past 2^53) is added to exactly; anything else, a prefix with
 * digits or a number with leading zeros, goes through SerialIncrement.
 */
export function serialNext(s: string, by: number): string {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  const step = /^-?\d+(?:\.\d+)?$/.exec(String(by));
  if (!m || !step || /^0\d/.test(m[2])) return serialIncrement(s, Math.trunc(by));
  const [, whole, frac = ''] = /^-?(\d+)(?:\.(\d+))?$/.exec(String(by).replace(/^-/, ''))!;
  const places = Math.max(frac.length, (m[3] ?? '').length);
  const scaled = (sign: string, w: string, f = '') => (sign === '-' ? -1n : 1n) * BigInt(w + f.padEnd(places, '0'));
  const total = scaled(m[1], m[2], m[3]) + scaled(by < 0 ? '-' : '', whole, frac);
  const digits = (total < 0n ? -total : total).toString().padStart(places + 1, '0');
  const out = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.0+$|(\.\d*?)0+$/, '$1') : digits;
  return (total < 0n ? '-' : '') + out;
}

/** FileMaker's SerialIncrement: bump the last run of digits, keeping its width. */
export function serialIncrement(s: string, by: number): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(s);
  if (!m) return s;
  return m[1] + String(Number(m[2]) + by).padStart(m[2].length, '0') + m[3];
}

/**
 * Records of a table by id, in the order given, read in batches so only one
 * batch is in memory at a time. `cols` reads just those columns.
 */
export function* rowsById(store: Store, table: Table, ids: Iterable<number>, cols?: string[]): Generator<Rec> {
  const select = cols ? ['_fm_record_id', ...cols].map(q).join(', ') : '*';
  const sql = `SELECT ${select} FROM ${q(table.name)} WHERE _fm_record_id IN (SELECT value FROM json_each(?))`;
  const flush = function* (batch: number[]): Generator<Rec> {
    const byId = new Map<number, Row>();
    // A statement kept for reuse: it is read to the end before anything else runs.
    for (const row of store.calc.statement(sql).iterate(JSON.stringify(batch)) as Iterable<Row>) byId.set(Number(row._fm_record_id), row);
    for (const id of batch) {
      const row = byId.get(id);
      if (row) yield { store, table, row };
    }
  };
  let batch: number[] = [];
  for (const id of ids) {
    batch.push(id);
    if (batch.length === ROW_BATCH) {
      yield* flush(batch);
      batch = [];
    }
  }
  if (batch.length) yield* flush(batch);
}
const ROW_BATCH = 500;

/** Adds one record's value to what a summary collected, as collector() does. */
function putIn(acc: Summed, type: string, v: Value): void {
  if (isEmpty(v)) return;
  acc.count++;
  if (type !== 'count') {
    const n = asNumberOrEmpty(v);
    if (n !== undefined) acc.nums.push(n);
  }
}

/** Takes one record's value back out of what a summary collected; false when it isn't there to take. */
function takeOut(acc: Summed, type: string, v: Value): boolean {
  if (isEmpty(v)) return true;
  if (type !== 'count') {
    const n = asNumberOrEmpty(v);
    if (n !== undefined) {
      const i = acc.nums.indexOf(n);
      if (i < 0) return false;
      acc.nums.splice(i, 1);
    }
  }
  acc.count--;
  return true;
}

/** Whether two data stamps are of the same store file, so an older result is that file's last one (not another file's put in its place). */
const sameFile = (a: string, b: string) => a.slice(0, a.lastIndexOf('/v')) === b.slice(0, b.lastIndexOf('/v')) && a.includes('/v');

function parseSummed(value: string): Summed {
  const v = JSON.parse(value) as { count: number; nums: (number | null)[]; texts?: string[] };
  return { count: v.count, nums: v.nums.map((n) => (n === null ? NaN : n)), ...(v.texts ? { texts: v.texts } : {}) };
}

/** JSON for shared results: bigints kept exact; undefined when a value can't be (binary data). */
function serializeValues(v: unknown): string | undefined {
  let ok = true;
  const out = JSON.stringify(v, (_k, x) => {
    if (typeof x === 'bigint') return { $big: x.toString() };
    if (x instanceof Uint8Array) ok = false;
    return x;
  });
  return ok ? out : undefined;
}

function revive(_k: string, x: unknown): unknown {
  return x && typeof x === 'object' && '$big' in x ? BigInt((x as { $big: string }).$big) : x;
}

function serializeResult(r: { types: (string | null)[]; rows: SqlValue[][] }): string | undefined {
  return serializeValues(r);
}

function parseResult(value: string): { types: (string | null)[]; rows: SqlValue[][] } {
  return JSON.parse(value, revive) as { types: (string | null)[]; rows: SqlValue[][] };
}

/** Names defined by the query's outer WITH clause, including quoted names and
 * optional column lists. A definition shadows the same-named base table. */
function topLevelCteNames(sql: string): Set<string> {
  const tokens = sqlTokens(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const names = new Set<string>();
  let i = 0;
  if (tokens[i++]?.text.toUpperCase() !== 'WITH') return names;
  if (tokens[i]?.text.toUpperCase() === 'RECURSIVE') i++;
  const parenthesized = () => {
    if (tokens[i]?.text !== '(') return false;
    let depth = 0;
    do {
      const token = tokens[i++];
      if (!token) return false;
      if (token.text === '(') depth++;
      else if (token.text === ')') depth--;
    } while (depth);
    return true;
  };
  while (i < tokens.length) {
    const name = tokens[i++];
    if (name?.kind !== 'word' && name?.kind !== 'identifier') return names;
    names.add(sqlName(name).toLowerCase());
    if (tokens[i]?.text === '(' && !parenthesized()) return names;
    if (tokens[i++]?.text.toUpperCase() !== 'AS') return names;
    if (tokens[i]?.text.toUpperCase() === 'NOT') i++;
    if (tokens[i]?.text.toUpperCase() === 'MATERIALIZED') i++;
    if (!parenthesized() || tokens[i]?.text !== ',') return names;
    i++;
  }
  return names;
}

/** Names a limited account's query can't use: the functions and tables that read records, fields or their names without naming their table. */
const REFUSED_SQL_NAMES = new Set(['fm_computed', 'dbstat', '_fm_containers', '_fm_container_chunks', 'sqlite_master', 'sqlite_schema', 'sqlite_temp_master', 'sqlite_temp_schema']);

/**
 * What a limited account's ExecuteSQL query names that would read past its privileges, if anything: a schema
 * (main.Table, however the name is quoted or commented) or one of REFUSED_SQL_NAMES. The query is read as SQLite
 * reads it, so comments count as spaces and a string literal can name a schema.
 */
export function refusedSqlName(query: string): string | undefined {
  const tokens: { name?: string; literal?: true; dot?: true }[] = [];
  const token = /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?(?:\*\/|$)|'((?:[^']|'')*)'?|"((?:[^"]|"")*)"?|`((?:[^`]|``)*)`?|\[([^\]]*)\]?|([\p{L}\p{N}_$]+)|(\.)|[\s\S]/gu;
  for (const m of query.matchAll(token)) {
    const name = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    if (name !== undefined) tokens.push({ name: name.toLowerCase(), ...(m[1] !== undefined ? { literal: true as const } : {}) });
    else if (m[6]) tokens.push({ dot: true });
    else if (!/^\s|^--|^\/\*/.test(m[0])) tokens.push({});
  }
  for (const [i, t] of tokens.entries()) {
    if (t.name === undefined) continue;
    if ((t.name === 'main' || t.name === 'temp') && tokens[i + 1]?.dot) return `a schema name (${t.name}.)`;
    // A string literal counts for the tables (SQLite reads FROM '_fm_containers' as the table), not for a function or dbstat's value.
    if (REFUSED_SQL_NAMES.has(t.name) && (!t.literal || /^(?:_fm_|sqlite_)/.test(t.name))) return t.name;
    // The pragma functions (pragma_table_info and the rest) list every table's fields.
    if (t.name.startsWith('pragma_') && !t.literal) return t.name;
  }
  return undefined;
}
