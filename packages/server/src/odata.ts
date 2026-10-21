// OData v4 over hosted files, like FileMaker Server's OData API, so Excel,
// Power BI, Tableau and other OData clients connect directly ("OData feed").
//
//   GET    /fmi/odata/v4                              the hosted files
//   GET    /fmi/odata/v4/{db}                         its entity sets (table occurrences)
//   GET    /fmi/odata/v4/{db}/$metadata               CSDL XML: types, fields, keys
//   GET    /fmi/odata/v4/{db}/{set}                   records: $filter $search $select $orderby $top $skip $count
//   GET    /fmi/odata/v4/{db}/{set}/$count            how many, as plain text
//   POST   /fmi/odata/v4/{db}/{set}                   create a record
//   GET    /fmi/odata/v4/{db}/{set}({id})             one record (with an ETag)
//   PATCH  /fmi/odata/v4/{db}/{set}({id})             change fields (If-Match: the ETag, or *)
//   DELETE /fmi/odata/v4/{db}/{set}({id})             delete it
//   GET    /fmi/odata/v4/{db}/{set}({id})/{field}[/$value]   one field; $value of a container is the file
//   GET    /fmi/odata/v4/{db}/{set}({id})/{related}   the related records (a navigation property)
//   GET    /fmi/odata/v4/{db}/{set}({id})/{related}/$ref   where the related records are, as links (also {related}(n)/$ref)
//   $expand={related}[($select=...;$top=n)],...         related records inline, on a list or one record
//   $filter=Related/any(x: x/Field gt 1), Related/all(...)   by the related records the account may view (not inside $expand, $apply, $crossjoin)
//   $apply=filter(...)/groupby((A,B),aggregate(X with sum as Total,$count as N))   groups and totals (odata-apply.ts)
//   $compute=Price mul Qty as Total                     a property worked out for each record: put it in $select to show it, or use
//                                                       it in $filter (on a list of records; not $orderby, $expand, $apply or $crossjoin)
//   POST   /fmi/odata/v4/{db}/Script.{name}           run a script: {"scriptParameterValue": ...}
//   POST/PATCH/DELETE /fmi/odata/v4/{db}/FileMaker_Tables[/{table}[/{field}]]   change the schema
//   POST/DELETE /fmi/odata/v4/{db}/FileMaker_Indexes/{table}[/{field}]         ([Full Access] only; see odata-schema.ts)
//   POST   /fmi/odata/v4/{db}/$batch                  several requests in one (multipart/mixed or JSON);
//                                                     a change set is all or nothing
//
// Entity sets are table occurrences, as on FileMaker Server; records are
// keyed by ROWID (the record id), and ROWMODID is the modification count.
// Names that aren't OData identifiers (spaces, punctuation) have those
// characters replaced with "_" in the metadata and URLs. Each relationship
// in the graph gives the occurrences at both ends a navigation property named
// after the other one, to its related records, as FileMaker Server's does.
//
// Sign in with HTTP Basic (an account and password, as Excel and Power BI
// ask for), a Data API session token or an API token (Bearer). The privilege
// set needs the fmodata extended privilege, as on FileMaker Server; record
// access, field access and script access apply as everywhere else. Scripts
// run offline unless the server allows them network access.

import { IdentityInFlight, busyHeaders } from './in-flight.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PrivilegeError, StoreError, relatedIdList, type LayoutInfo, type Privileges, type SortSpec, type Store } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { ScriptError, ScriptSession, runScript } from '../../scripts/src/index.ts';
import { Readable, Writable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { requestOrigin } from './public-origin.ts';
import { endTransaction, writer, type Transaction } from '../../store/src/index.ts';
import { ApiError, jsonNumberSource, readBody, readJson, stringifyJsonPreservingNumbers, validateNativeJsonBody, type DataApi } from './dataapi.ts';
import { schemaChange, SCHEMA_SETS } from './odata-schema.ts';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { decimalKey, decimalNumberText } from '../../store/src/native-types.ts';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { JoinJob, JoinResult, JoinTable } from './odata-crossjoin-worker.ts';
import { aggregateSql, aggregateType, parseApply } from './odata-apply.ts';
import { CROSSJOIN_LIMIT, balanced, bareRowId, conjuncts, crossjoinExpand, crossjoinSets, paths } from './odata-crossjoin.ts';
import { searchSql } from './odata-search.ts';
import { ReadAudit } from './read-audit.ts';
import { batchRequests, batchResponse, BatchError, failure, MAX_BATCH_BYTES, BATCH_LIMIT, type BatchAnswer, type BatchRequest, type BatchResult, type BatchUnit } from './odata-batch.ts';
import type { Host } from './host.ts';
import { signIn } from './sql.ts';
import type { ContainerFiles } from './containers.ts';
import { listedFiles, refuseUnknownFile } from './file-list.ts';
import { logFault } from './fault-log.ts';

const ROOT = '/fmi/odata/v4';
/** Records per page; clients follow @odata.nextLink for the rest. */
const PAGE = 1000;
const MAX_PAGE = 10_000;
/** Related records an $expand or navigation gives for one record, at most. */
const MAX_RELATED = 1000;
/** Related records a page of records may carry in all; past that, the page ends early with a next link (tests lower it). */
export const EXPAND_LIMIT = { records: 20_000 };
/** Records one $apply reads at most (tests lower it). */
export const APPLY_LIMIT = { records: 500_000 };
/** How long and how deep one $filter may be, so a long one (as a $batch can carry) can't hold up the server. */
export const FILTER_LIMIT = { chars: 1_000_000, tokens: 10_000, depth: 32, params: 30_000, sql: 256_000 };
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

interface Prop {
  /** The OData name. */
  name: string;
  field: string;
  type: string;
  edm: string;
  /** Stored in the table's own column, so $filter and $orderby can use it. */
  queryable: boolean;
  writable: boolean;
  /** A container field the account may put a file in (PATCH a file to it, or base64 in JSON). */
  fillable?: boolean;
}

interface EntitySet {
  name: string;
  occurrence: string;
  /** The table occurrence's id in the graph of `graph`, the file the request is for. */
  toId: number;
  graph: Store;
  info: LayoutInfo;
  props: Prop[];
  /** Navigation properties: the occurrences one relationship away, by their set's name. */
  nav: { name: string; target: EntitySet }[];
}

const EDM: Record<string, string> = {
  text: 'Edm.String', number: 'Edm.Decimal', date: 'Edm.Date', time: 'Edm.TimeOfDay', timestamp: 'Edm.DateTimeOffset', container: 'Edm.String',
  boolean: 'Edm.Boolean', integer: 'Edm.Int64', decimal: 'Edm.Decimal', json: 'Edm.String', uuid: 'Edm.Guid',
};

/** An OData identifier for a FileMaker name, unique among `taken`. */
function identifier(name: string, taken: Set<string>): string {
  let id = name.replace(/[^\p{L}\p{N}_]/gu, '_').slice(0, 120) || '_';
  if (!/^[\p{L}_]/u.test(id)) id = '_' + id;
  let out = id;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${id}_${i}`;
  taken.add(out.toLowerCase());
  return out;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class ODataError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  /** For a 405: the methods the address takes. */
  readonly allow?: string;
  constructor(status: number, code: string, message: string, retryAfter?: number, allow?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.allow = allow;
  }
}

/** A method this address doesn't take: 405, naming the ones it does. */
const notAllowed = (message: string, allow: string) => new ODataError(405, '3', message, undefined, allow);

const bad = (message: string, code = '8310') => new ODataError(400, code, message);

/** The table occurrences an account can see, with the fields it can see. */
function model(store: Store, p: Privileges): EntitySet[] {
  const sets: EntitySet[] = [];
  const taken = new Set<string>();
  for (const to of store.schema.tableOccurrences) {
    let info: LayoutInfo;
    try {
      info = store.occurrence(to.name);
    } catch {
      continue; // in a file that isn't hosted
    }
    const owner = info.owner;
    const local = owner === store ? p : p.in(owner);
    if (!owner.tableVisible(info.table, local)) continue;
    const table = owner.schema.tables.find((t) => t.name === info.table);
    const names = new Set(['rowid', 'rowmodid']);
    const props: Prop[] = [];
    for (const f of info.fields) {
      if (local.field(info.table, f.name) === 'none') continue;
      const def = table?.fields.find((x) => x.name === f.name);
      const computed = def?.options?.global || (def?.kind === 'calculation' && def.options?.unstored) || (def?.options?.repetitions ?? 1) > 1;
      props.push({
        name: identifier(f.name, names), field: f.name, type: f.type, edm: EDM[f.type] ?? 'Edm.String',
        queryable: !computed && f.type !== 'container',
        writable: !f.calculated && f.type !== 'container' && local.field(info.table, f.name) === 'modifiable',
        ...(f.type === 'container' && !f.calculated && local.field(info.table, f.name) === 'modifiable' ? { fillable: true } : {}),
      });
    }
    sets.push({ name: identifier(to.name, taken), occurrence: to.name, toId: to.id, graph: store, info, props, nav: [] });
  }
  // Each relationship links the sets at both ends, when the account can see both.
  const byId = new Map(sets.map((s) => [s.toId, s]));
  // Following a relationship shows its match fields' values, so it is offered only when the account can read them
  // all, at both ends: a hidden or masked key would come back in full through the records on the other side.
  const readable = (s: EntitySet, fieldId: number) => {
    const owner = s.info.owner;
    const name = owner.schema.tables.find((t) => t.name === s.info.table)?.fields.find((f) => f.id === fieldId)?.name;
    return !!name && (owner === store ? p : p.in(owner)).field(s.info.table, name) !== 'none';
  };
  for (const s of sets) {
    const taken = new Set(['rowid', 'rowmodid', ...s.props.map((x) => x.name.toLowerCase())]);
    const seen = new Set<number>();
    for (const rel of store.schema.relationships) {
      const other = rel.leftTableOccurrenceId === s.toId ? rel.rightTableOccurrenceId : rel.rightTableOccurrenceId === s.toId ? rel.leftTableOccurrenceId : undefined;
      const target = other === undefined ? undefined : byId.get(other);
      if (!target || seen.has(target.toId)) continue;
      const forward = rel.leftTableOccurrenceId === s.toId;
      if (!rel.predicates.every((x) => readable(s, forward ? x.leftFieldId : x.rightFieldId) && readable(target, forward ? x.rightFieldId : x.leftFieldId))) continue;
      seen.add(target.toId);
      s.nav.push({ name: identifier(target.name, taken), target });
    }
  }
  return sets;
}

function metadata(namespace: string, sets: EntitySet[]): string {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">',
    '<edmx:DataServices>',
    `<Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="${xml(namespace)}">`,
  ];
  for (const s of sets) {
    out.push(`<EntityType Name="${xml(s.name)}">`, '<Key><PropertyRef Name="ROWID"/></Key>',
      '<Property Name="ROWID" Type="Edm.Int64" Nullable="false"/>', '<Property Name="ROWMODID" Type="Edm.Int64" Nullable="false"/>');
    for (const p of s.props) {
      out.push(`<Property Name="${xml(p.name)}" Type="${p.edm}"${p.edm === 'Edm.Decimal' ? ' Scale="variable"' : ''}/>`);
    }
    for (const n of s.nav) out.push(`<NavigationProperty Name="${xml(n.name)}" Type="Collection(${xml(namespace)}.${xml(n.target.name)})"/>`);
    out.push('</EntityType>');
  }
  out.push('<EntityContainer Name="Container">');
  for (const s of sets) {
    const bindings = s.nav.map((n) => `<NavigationPropertyBinding Path="${xml(n.name)}" Target="${xml(n.target.name)}"/>`);
    out.push(bindings.length
      ? `<EntitySet Name="${xml(s.name)}" EntityType="${xml(namespace)}.${xml(s.name)}">${bindings.join('')}</EntitySet>`
      : `<EntitySet Name="${xml(s.name)}" EntityType="${xml(namespace)}.${xml(s.name)}"/>`);
  }
  out.push('</EntityContainer>', '</Schema>', '</edmx:DataServices>', '</edmx:Edmx>');
  return out.join('\n') + '\n';
}

// --- values ------------------------------------------------------------------

/** A stored value as OData JSON has it. */
function toJson(v: string | number | undefined, type: string): string | number | boolean | null {
  if (v === undefined || v === '') return null;
  if (type === 'boolean') return v === 1 || v === '1' ? true : v === 0 || v === '0' ? false : String(v);
  if (type === 'integer') return ieeeContext.getStore()?.enabled ? String(v) : Number(v);
  if (type === 'decimal' || type === 'json' || type === 'uuid') return String(v);
  if (type === 'number') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null; // text typed into a number field
  }
  if (type === 'timestamp' && typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? v + 'Z' : null;
  if (type === 'date' && typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (type === 'time' && typeof v === 'string') return /^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? v : null;
  return String(v);
}

/** A timestamp from OData (with a time zone) as stored: UTC, without one. */
function storedTimestamp(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i.test(s)) throw bad(`"${s}" is not a timestamp`, '500');
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(s)) return s;
  const iso = new Date(s).toISOString();
  return iso.endsWith('.000Z') ? iso.slice(0, 19) : iso.slice(0, -1);
}

/** A value from a request body as a field takes it. */
function fromJson(v: unknown, p: Prop): string | number {
  if (v === null) return '';
  if (p.type === 'json' && typeof v === 'object') return stringifyJsonPreservingNumbers(v);
  if (typeof v === 'number') {
    if (p.type === 'decimal') {
      const exact = decimalNumberText(v);
      if (exact === undefined) throw bad(`${p.name}: send a decimal string for numbers with more than 15 significant digits`, '500');
      return exact;
    }
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') throw bad(`${p.name}: a ${p.edm} value is expected`, '500');
  // Text that is not a number would be stored as nothing in a number field: refused, as a number for a text field is.
  if (p.type === 'number' && v.trim() !== '' && !Number.isFinite(Number(v))) throw bad(`${p.name}: a ${p.edm} value is expected, not "${v.length > 40 ? `${v.slice(0, 40)}...` : v}"`, '500');
  return p.type === 'timestamp' && v ? storedTimestamp(v) : v;
}

// --- $filter -------------------------------------------------------------------

type Kind = 'string' | 'number' | 'date' | 'time' | 'timestamp' | 'bool' | 'null';
interface Expr { sql: string; params: SqlValue[]; kind: Kind; decimal?: boolean; uuid?: boolean; rawNumber?: string }

const KIND: Record<string, Kind> = { text: 'string', number: 'number', date: 'date', time: 'time', timestamp: 'timestamp', boolean: 'bool', integer: 'number', decimal: 'number', json: 'string', uuid: 'string' };

/** A $filter's names, values and operators. */
export function filterTokens(text: string): string[] {
  return text.match(/'(?:[^']|'')*'|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?|\d{4}-\d{2}-\d{2}|\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[mMdDfFlL]?|[\p{L}_][\p{L}\p{N}_]*|[(),\-/]|\S/gu) ?? [];
}

const globbed = (sql: string) => `replace(replace(replace(${sql}, '[', '[[]'), '*', '[*]'), '?', '[?]')`;

/**
 * What `Nav/any(x: ...)` and `Nav/all(x: ...)` mean in a $filter: the SQL condition, on this set's own records, for those
 * with some (any) or only (all) related records that satisfy the predicate (given as a $filter of its own, on the related
 * set, with the range variable taken out). Left out where there is no record access to read the related records with.
 */
type Lambda = (navigation: string, all: boolean, predicate: string | undefined) => Expr;

/** How deep any()/all() may nest in one $filter, and how many there may be (each reads the related table). */
const LAMBDA_LIMIT = { depth: 3, count: 20 };

/** OData $filter as a SQL condition on the table's columns, with parameters. */
export function filterSql(text: string, props: Prop[], lambda?: Lambda, computed?: Computed[], asValue = false): { where: string; params: SqlValue[]; fields: string[]; kind: Kind } {
  if (text.length > FILTER_LIMIT.chars) throw bad(`$filter is too long: at most ${FILTER_LIMIT.chars.toLocaleString('en-US')} characters`);
  const tokens = filterTokens(text);
  if (!props.some((p) => p.type === 'uuid')) {
    const guid = tokens.find((t) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(t));
    if (guid) throw bad(`$filter: there is no property "${guid}"`, '102');
  }
  if (tokens.length > FILTER_LIMIT.tokens) throw bad(`$filter is too long: at most ${FILTER_LIMIT.tokens.toLocaleString('en-US')} names, values and operators`);
  let i = 0;
  let depth = 0;
  const nested = <T>(fn: () => T): T => {
    if (++depth > FILTER_LIMIT.depth) throw bad(`$filter nests parentheses, functions, not and minus more than ${FILTER_LIMIT.depth} deep`);
    const r = fn();
    depth--;
    return r;
  };
  // Each piece of SQL names its argument once, but keep a backstop on the values and the SQL text so nothing grows past what SQLite takes.
  const sized = (e: Expr): Expr => {
    if (e.params.length > FILTER_LIMIT.params || e.sql.length > FILTER_LIMIT.sql) throw bad('$filter is too complex: simplify it');
    return e;
  };
  const fields = new Set<string>();
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const is = (word: string) => peek()?.toLowerCase() === word && !peek()!.startsWith("'");
  const expect = (t: string) => {
    if (next() !== t) throw bad(`$filter: "${t}" expected near "${tokens.slice(Math.max(0, i - 2), i + 1).join(' ')}"`);
  };
  const isName = (x: string | undefined) => x !== undefined && /^[\p{L}_]/u.test(x);
  const bool = (e: Expr): Expr => (e.kind === 'bool' ? e : sized({ sql: `coalesce((${e.sql}) <> 0, 0)`, params: e.params, kind: 'bool' }));

  const or = (): Expr => {
    let a = and();
    while (is('or')) {
      next();
      const x = bool(a);
      const y = bool(and());
      a = sized({ sql: `(${x.sql} OR ${y.sql})`, params: [...x.params, ...y.params], kind: 'bool' });
    }
    return a;
  };
  const and = (): Expr => {
    let a = not();
    while (is('and')) {
      next();
      const x = bool(a);
      const y = bool(not());
      a = sized({ sql: `(${x.sql} AND ${y.sql})`, params: [...x.params, ...y.params], kind: 'bool' });
    }
    return a;
  };
  const not = (): Expr => {
    if (is('not')) {
      next();
      const a = bool(nested(not));
      return sized({ sql: `NOT (${a.sql})`, params: a.params, kind: 'bool' });
    }
    return compare();
  };
  const OPS: Record<string, string> = { eq: 'IS', ne: 'IS NOT', gt: '>', ge: '>=', lt: '<', le: '<=' };
  const compare = (): Expr => {
    const a = additive();
    const op = peek()?.toLowerCase();
    if (op && Object.hasOwn(OPS, op) && !peek()!.startsWith("'")) {
      next();
      const b = additive();
      if ((a.decimal || b.decimal) && a.kind !== 'null' && b.kind !== 'null') {
        const key = (e: Expr) => `fm_decimal_key(${e.sql})`;
        return { sql: `(${key(a)}) ${op === 'eq' ? '=' : op === 'ne' ? 'IS NOT' : OPS[op]} (${key(b)})`, params: [...(a.rawNumber ? [a.rawNumber] : a.params), ...(b.rawNumber ? [b.rawNumber] : b.params)], kind: 'bool' };
      }
      if ((a.uuid || b.uuid) && a.kind !== 'null' && b.kind !== 'null') {
        return { sql: `lower(${a.sql}) ${OPS[op]} lower(${b.sql})`, params: [...a.params, ...b.params], kind: 'bool' };
      }
      return { sql: `(${a.sql}) ${OPS[op]} (${b.sql})`, params: [...a.params, ...b.params], kind: 'bool' };
    }
    if (op === 'in') {
      next();
      expect('(');
      const list: Expr[] = [];
      do list.push(additive());
      while (peek() === ',' && next());
      expect(')');
      if (a.decimal) return { sql: `fm_decimal_key(${a.sql}) IN (${list.map((x) => `fm_decimal_key(${x.sql})`).join(', ')})`, params: [...a.params, ...list.flatMap((x) => x.rawNumber ? [x.rawNumber] : x.params)], kind: 'bool' };
      if (a.uuid) return { sql: `lower(${a.sql}) IN (${list.map((x) => `lower(${x.sql})`).join(', ')})`, params: [...a.params, ...list.flatMap((x) => x.params)], kind: 'bool' };
      return { sql: `(${a.sql}) IN (${list.map((x) => x.sql).join(', ')})`, params: [...a.params, ...list.flatMap((x) => x.params)], kind: 'bool' };
    }
    return a;
  };
  const ARITH: Record<string, string> = { add: '+', sub: '-', mul: '*', div: '/', mod: '%' };
  const additive = (): Expr => {
    let a = multiplicative();
    while (is('add') || is('sub')) {
      const op = ARITH[next().toLowerCase()];
      const b = multiplicative();
      a = { sql: `(${a.sql} ${op} ${b.sql})`, params: [...a.params, ...b.params], kind: 'number' };
    }
    return a;
  };
  const multiplicative = (): Expr => {
    let a = unary();
    while (is('mul') || is('div') || is('mod')) {
      const op = ARITH[next().toLowerCase()];
      const b = unary();
      a = { sql: op === '/' ? `(CAST(${a.sql} AS REAL) / ${b.sql})` : `(${a.sql} ${op} ${b.sql})`, params: [...a.params, ...b.params], kind: 'number' };
    }
    return a;
  };
  const unary = (): Expr => {
    if (peek() === '-') {
      next();
      const a = nested(unary);
      return { sql: `(-${a.sql})`, params: a.params, kind: 'number' };
    }
    return primary();
  };
  // cast(value, type): the value as that type, or null when it can't be one (as 'abc' is not a number). Names the value once.
  const cast = (a: Expr, type: string): Expr => {
    const t = type.replace(/^Edm\./i, '').toLowerCase();
    const of = (then: string, kind: Kind): Expr => ({ sql: `(SELECT ${then} FROM (SELECT v, trim(CAST(v AS TEXT)) AS t FROM (SELECT ${a.sql} AS v)))`, params: a.params, kind });
    const numeric = "(t GLOB '[0-9]*' OR t GLOB '-[0-9]*') AND substr(t, 2) NOT GLOB '*[^0-9.]*'";
    if (t === 'string') return of('CASE WHEN v IS NULL THEN NULL ELSE t END', 'string');
    if (['int16', 'int32', 'int64', 'byte', 'sbyte'].includes(t)) return of(`CASE WHEN typeof(v) IN ('integer', 'real') THEN CAST(v AS INTEGER) WHEN ${numeric} THEN CAST(CAST(t AS REAL) AS INTEGER) END`, 'number');
    if (['double', 'single', 'decimal'].includes(t)) return of(`CASE WHEN typeof(v) IN ('integer', 'real') THEN v WHEN ${numeric} THEN CAST(t AS REAL) END`, 'number');
    if (t === 'date') return of("CASE WHEN t GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN substr(t, 1, 10) END", 'date');
    throw new ODataError(501, '3', `$filter: cast to ${type || 'a type'} is not supported (Edm.String, whole and decimal numbers and Edm.Date are)`);
  };
  const call = (name: string, args: Expr[]): Expr => {
    const want = (n: number) => {
      if (args.length !== n) throw bad(`$filter: ${name} takes ${n} argument${n === 1 ? '' : 's'}`);
    };
    const [a, b] = args;
    const both = (sql: string, kind: Kind, ps: SqlValue[] = [...a.params, ...b.params]): Expr => ({ sql, params: ps, kind });
    const part = (from: number, len: number): Expr => {
      want(1);
      const at = a.kind === 'time' ? from - 11 : from;
      return { sql: `CAST(substr(${a.sql}, ${at}, ${len}) AS INTEGER)`, params: a.params, kind: 'number' };
    };
    switch (name) {
      case 'contains': want(2); return both(`instr(${a.sql}, ${b.sql}) > 0`, 'bool');
      // GLOB with the pattern's own wildcards escaped is a case-sensitive prefix or suffix test that names each side once.
      case 'startswith': want(2); return both(`((${a.sql}) GLOB ${globbed(b.sql)} || '*')`, 'bool');
      case 'endswith': want(2); return both(`((${a.sql}) GLOB '*' || ${globbed(b.sql)})`, 'bool');
      case 'indexof': want(2); return both(`(instr(${a.sql}, ${b.sql}) - 1)`, 'number');
      case 'concat': want(2); return both(`(coalesce(${a.sql}, '') || coalesce(${b.sql}, ''))`, 'string');
      case 'substring': {
        if (args.length === 2) return both(`substr(${a.sql}, ${b.sql} + 1)`, 'string');
        if (args.length !== 3) throw bad('$filter: substring takes 2 or 3 arguments');
        return { sql: `substr(${a.sql}, ${b.sql} + 1, ${args[2].sql})`, params: [...a.params, ...b.params, ...args[2].params], kind: 'string' };
      }
      case 'length': want(1); return { sql: `length(${a.sql})`, params: a.params, kind: 'number' };
      case 'tolower': want(1); return { sql: `lower(${a.sql})`, params: a.params, kind: 'string' };
      case 'toupper': want(1); return { sql: `upper(${a.sql})`, params: a.params, kind: 'string' };
      case 'trim': want(1); return { sql: `trim(${a.sql})`, params: a.params, kind: 'string' };
      case 'year': return part(1, 4);
      case 'month': return part(6, 2);
      case 'day': return part(9, 2);
      case 'hour': return part(12, 2);
      case 'minute': return part(15, 2);
      case 'second': return part(18, 2);
      case 'date': want(1); return { sql: `substr(${a.sql}, 1, 10)`, params: a.params, kind: 'date' };
      case 'time': want(1); return { sql: `substr(${a.sql}, 12, 8)`, params: a.params, kind: 'time' };
      case 'round': want(1); return { sql: `round(${a.sql})`, params: a.params, kind: 'number' };
      case 'floor': want(1); return { sql: `floor(${a.sql})`, params: a.params, kind: 'number' };
      case 'ceiling': want(1); return { sql: `ceil(${a.sql})`, params: a.params, kind: 'number' };
      // The earliest and latest time stamps, for ranges with an open end; a stored time stamp has no offset, so its offset is 0.
      case 'mindatetime': want(0); return { sql: '?', params: ['0001-01-01T00:00:00'], kind: 'timestamp' };
      case 'maxdatetime': want(0); return { sql: '?', params: ['9999-12-31T23:59:59'], kind: 'timestamp' };
      case 'totaloffsetminutes': want(1); return { sql: `(SELECT CASE WHEN v IS NULL THEN NULL ELSE 0 END FROM (SELECT ${a.sql} AS v))`, params: a.params, kind: 'number' };
      case 'now': want(0); return { sql: '?', params: [new Date().toISOString().slice(0, 19)], kind: 'timestamp' };
    }
    throw new ODataError(501, '3', `$filter: ${name}() is not supported`);
  };
  const primary = (): Expr => {
    let t = next();
    if (t === undefined) throw bad('$filter: the expression ends too soon');
    if (t === '(') {
      const e = nested(or);
      expect(')');
      return e;
    }
    if (t.startsWith("'")) {
      if (!t.endsWith("'") || t.length < 2) throw bad('$filter: a string is not closed');
      return { sql: '?', params: [t.slice(1, -1).replace(/''/g, "'")], kind: 'string' };
    }
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(t)) return { sql: '?', params: [t.toLowerCase()], kind: 'string' };
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return { sql: '?', params: [storedTimestamp(t)], kind: 'timestamp' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { sql: '?', params: [t], kind: 'date' };
    if (/^\d{2}:\d{2}/.test(t)) return { sql: '?', params: [t.length === 5 ? t + ':00' : t], kind: 'time' };
    if (/^-?\d/.test(t)) {
      if (/[eE]/.test(t)) throw bad('$filter: exponent literals are unsupported; use a plain decimal literal');
      return { sql: '?', params: [Number(t.replace(/[mMdDfFlL]$/, ''))], kind: 'number', rawNumber: t.replace(/[mMdDfFlL]$/, '') };
    }
    // Nav/any(x: predicate), Nav/all(x: predicate): the related records, as the account sees them.
    if (peek() === '/' && /^(any|all)$/i.test(tokens[i + 1] ?? '') && tokens[i + 2] === '(') {
      if (!lambda) throw bad(`$filter: ${tokens[i + 1]}() isn't supported here`, '102');
      const all = tokens[i + 1].toLowerCase() === 'all';
      i += 3;
      const start = i;
      for (let open = 1; i < tokens.length; i++) {
        if (tokens[i] === '(') open++;
        else if (tokens[i] === ')' && --open === 0) break;
      }
      if (i >= tokens.length) throw bad(`$filter: ${tokens[start - 2]}( is not closed`);
      const inner = tokens.slice(start, i++);
      let predicate: string | undefined;
      if (inner.length) {
        if (!isName(inner[0]) || inner[1] !== ':') throw bad(`$filter: ${all ? 'all' : 'any'}() takes a range variable and a condition, as ${all ? 'all' : 'any'}(x: x/Total gt 5)`);
        const range = inner[0].toLowerCase();
        const rest: string[] = [];
        // The range variable's own name before "/" stands for the related record: its properties are plain names there.
        for (let k = 2; k < inner.length; k++) {
          if (inner[k].toLowerCase() === range && inner[k + 1] === '/' && isName(inner[k + 2]) && inner[k - 1] !== '/') k++;
          else rest.push(inner[k]);
        }
        predicate = rest.join(' ');
        if (!predicate) throw bad(`$filter: ${all ? 'all' : 'any'}(${inner[0]}: ) needs a condition`);
      } else if (all) {
        throw bad('$filter: all() needs a range variable and a condition');
      }
      return sized(nested(() => lambda(t, all, predicate)));
    }
    // Set/Property, as $crossjoin names its properties.
    if (peek() === '/' && /^[\p{L}_]/u.test(t) && /^[\p{L}_]/u.test(tokens[i + 1] ?? '')) t = `${t}/${tokens[(i += 2) - 1]}`;
    const word = t.toLowerCase();
    if (word === 'null') return { sql: 'NULL', params: [], kind: 'null' };
    if (word === 'true' || word === 'false') return { sql: word === 'true' ? '1' : '0', params: [], kind: 'bool' };
    if (word === 'cast' && peek() === '(') {
      next();
      const a = nested(or);
      expect(',');
      // The type is Edm.Int32 as a name or 'Edm.Int32' as a string.
      let type = next() ?? '';
      if (type.startsWith("'")) type = type.slice(1, -1);
      else while (peek() === '.') type += next() + (next() ?? '');
      expect(')');
      return sized(cast(a, type));
    }
    if (peek() === '(' && /^[a-z]+$/.test(word)) {
      next();
      const args: Expr[] = [];
      nested(() => {
        if (peek() !== ')') {
          do args.push(or());
          while (peek() === ',' && next());
        }
      });
      expect(')');
      return sized(call(word, args));
    }
    if (word === 'rowid') return { sql: '_fm_record_id', params: [], kind: 'number' };
    if (word === 'rowmodid') return { sql: '_fm_mod_id', params: [], kind: 'number' };
    const c = computed?.find((x) => x.name === t) ?? computed?.find((x) => x.name.toLowerCase() === word);
    if (c) {
      for (const f of c.fields) fields.add(f);
      return sized({ sql: `(${c.sql})`, params: [...c.params], kind: c.kind });
    }
    const p = props.find((x) => x.name === t) ?? props.find((x) => x.name.toLowerCase() === word);
    if (!p) throw bad(`$filter: there is no property "${t}"`, '102');
    if (!p.queryable) throw bad(`$filter: ${p.name} is not stored (a global, unstored calculation, repeating or container field), so it can't be filtered on`, '102');
    fields.add(p.field);
    const kind = KIND[p.type] ?? 'string';
    return { sql: kind === 'number' && p.type !== 'decimal' ? `CAST(${q(p.field)} AS REAL)` : q(p.field), params: [], kind, ...(p.type === 'decimal' ? { decimal: true } : {}), ...(p.type === 'uuid' ? { uuid: true } : {}) };
  };

  if (!tokens.length) throw bad('$filter is empty');
  const e = asValue ? or() : bool(or());
  if (i < tokens.length) throw bad(`$filter: unexpected "${tokens[i]}"`);
  return { where: e.sql, params: e.params, fields: [...fields], kind: e.kind };
}

/** A property worked out for each record by $compute: its SQL on the table's columns, the fields that reads and what it gives. */
export interface Computed { name: string; sql: string; params: SqlValue[]; kind: Kind; fields: string[] }

/** At most this many properties in one $compute. */
const COMPUTE_LIMIT = 50;
/** All the values and SQL text of one $compute together (a page reads them with its record ids, within SQLite's limit on values; tests lower it). */
export const COMPUTE_SIZE = { params: 10_000, sql: 256_000 };

/** $compute=Expression as Name,...: the expressions are $filter's, and the names are new ones (not a property, ROWID or each other). */
function computedProps(text: string | null, set: EntitySet): Computed[] {
  if (text === null) return [];
  const items = topLevel(text, ',', '$compute');
  if (!items.length) throw bad('$compute is empty');
  if (items.length > COMPUTE_LIMIT) throw bad(`$compute names more than ${COMPUTE_LIMIT} properties`);
  const out: Computed[] = [];
  for (const item of items) {
    const m = /^([\s\S]+?)\s+as\s+([\p{L}_][\p{L}\p{N}_]*)$/iu.exec(item);
    if (!m) throw bad(`$compute: "${item}" is not an expression and "as" and a name`);
    const name = m[2]!;
    const taken = (x: string) => x.toLowerCase() === name.toLowerCase();
    if (/^ROW(MOD)?ID$/i.test(name) || set.props.some((x) => taken(x.name)) || set.nav.some((x) => taken(x.name)) || out.some((x) => taken(x.name))) {
      throw bad(`$compute: "${name}" is already a property: give the new one a name of its own`);
    }
    try {
      const f = filterSql(m[1]!, set.props, undefined, undefined, true);
      out.push({ name, sql: f.where, params: f.params, kind: f.kind, fields: f.fields });
    } catch (e) {
      if (e instanceof ODataError) throw new ODataError(e.status, e.code, e.message.replaceAll('$filter', '$compute'));
      throw e;
    }
  }
  if (out.reduce((n, c) => n + c.params.length, 0) > COMPUTE_SIZE.params || out.reduce((n, c) => n + c.sql.length, 0) > COMPUTE_SIZE.sql) throw bad('$compute is too complex: simplify it');
  return out;
}

/** A computed value as JSON: what SQLite gave, as the expression's kind says. */
function computedJson(v: unknown, kind: Kind): unknown {
  if (v === null || v === undefined) return null;
  if (kind === 'bool') return Number(v) !== 0;
  if (kind === 'number') return typeof v === 'bigint' ? Number(v) : v;
  if ((kind === 'date' || kind === 'time' || kind === 'timestamp') && v === '') return null;
  if (kind === 'timestamp' && typeof v === 'string' && !/(Z|[+-]\d{2}:\d{2})$/.test(v)) return `${v}Z`;
  return v;
}

/** $top, $skip (or $skiptoken) and the page size a request asks for. */
function paging(req: IncomingMessage, url: URL): { top?: number; skip: number; page: number; pref?: string } {
  const int = (name: string) => {
    const v = url.searchParams.get(name);
    if (v === null) return undefined;
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw bad(`${name} must be a whole number`);
    return Number(v);
  };
  const pref = /odata\.maxpagesize=(\d+)/i.exec(String(req.headers.prefer ?? ''))?.[1];
  return { top: int('$top'), skip: int('$skip') ?? int('$skiptoken') ?? 0, page: Math.min(MAX_PAGE, Math.max(1, pref ? Number(pref) : PAGE)), pref };
}

/** The entity set a request names. */
function findSet(sets: EntitySet[], name: string): EntitySet {
  const set = sets.find((s) => s.name === name) ?? sets.find((s) => s.name.toLowerCase() === name.toLowerCase() || s.occurrence.toLowerCase() === name.toLowerCase());
  if (!set) throw new ODataError(404, '102', `There is no entity set "${name}"`);
  return set;
}

/** Runs a query with a $filter in it: past SQLite's own limits, it is the client's to shorten (400), not a server fault. */
function filtered<T>(hasFilter: boolean, run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (hasFilter && (e as { code?: string }).code === 'ERR_SQLITE_ERROR' && /Expression tree is too large|too many SQL variables/.test((e as Error).message)) {
      throw new ODataError(400, '3', `$filter is too complex: ${(e as Error).message}`);
    }
    throw e;
  }
}

/** Runs a $crossjoin's join in a worker (odata-crossjoin-worker.ts), stopped past CROSSJOIN_LIMIT.ms. */
let joining = 0;
function crossJoin(job: JoinJob): Promise<JoinResult> {
  if (joining >= CROSSJOIN_LIMIT.running) {
    return Promise.reject(new ODataError(503, '3', `$crossjoin: ${CROSSJOIN_LIMIT.running} joins are running already: try again shortly`));
  }
  joining++;
  return new Promise<JoinResult>((resolve, reject) => {
    // Started the way cluster.ts starts its workers, so the release executable (whose launcher takes
    // --no-warnings, then a script to run) runs the join rather than the command line. Its memory cap goes in
    // NODE_OPTIONS, which that executable reads too; it gets only the environment it needs.
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: `--max-old-space-size=${CROSSJOIN_LIMIT.heapMb}` };
    for (const k of ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'TABULARIUS_HOME']) {
      if (process.env[k] !== undefined) env[k] = process.env[k];
    }
    const child = fork(fileURLToPath(new URL('./odata-crossjoin-worker.ts', import.meta.url)), [], {
      serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env,
      execArgv: ['--no-warnings', ...process.execArgv.filter((a) => a !== '--no-warnings' && !/^--(max[-_]old[-_]space[-_]size|inspect)/.test(a))],
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr = (stderr + d).slice(-2000);
    });
    const late: JoinResult = { refused: `$crossjoin: the join took longer than ${CROSSJOIN_LIMIT.ms / 1000} s: narrow each set in $filter with conditions on it alone, or simplify $filter and $orderby` };
    let answered = false;
    const answer = (m: JoinResult) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(m);
    };
    // The join stops itself at the deadline; past it by a little, it is killed wherever it is.
    const timer = setTimeout(() => answer(late), Math.max(0, job.deadline - Date.now()) + 1000);
    child.once('message', (m: JoinResult) => answer('refused' in m && m.refused === 'late' ? late : m));
    // 'close' rather than 'exit': it comes once stderr has been read to the end.
    child.once('close', (code, signal) => {
      if (answered) return;
      // A heap that runs out ends the process with a message about it; anything else is a fault, not the query's.
      if (/heap out of memory|allocation failed/i.test(stderr)) {
        answer({ refused: '$crossjoin: the join ran out of memory: narrow each set in $filter with conditions on it alone' });
        return;
      }
      answered = true;
      clearTimeout(timer);
      // Its stderr (paths, stacks) is for the server's log, not the client.
      console.error(`$crossjoin: the join stopped (${signal ?? `exit ${code}`})${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`);
      reject(new Error('$crossjoin: the join stopped unexpectedly'));
    });
    child.once('error', (e) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(e);
    });
    child.send(job);
  }).finally(() => {
    joining--;
  });
}

/** $orderby as sort specs. */
function orderBy(text: string, props: Prop[]): SortSpec[] {
  return text.split(',').map((part) => {
    const [name, dir, extra] = part.trim().split(/\s+/);
    if (!name || extra || (dir && !/^(asc|desc)$/i.test(dir))) throw bad(`$orderby: "${part.trim()}" is not a property and asc or desc`);
    if (/^rowid$/i.test(name)) throw bad('$orderby: records are in ROWID order when no other order is given', '102');
    const p = props.find((x) => x.name === name) ?? props.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p) throw bad(`$orderby: there is no property "${name}"`, '102');
    if (!p.queryable) throw bad(`$orderby: ${p.name} is not stored, so it can't be sorted on`, '102');
    return { fieldName: p.field, sortOrder: /^desc$/i.test(dir ?? '') ? 'descend' : 'ascend' };
  });
}

/** $select as the properties to show (all for none or *). */
function selected(text: string | null, set: EntitySet, option = '$select'): Prop[] {
  if (!text || text.trim() === '*') return set.props;
  return text.split(',').map((x) => x.trim()).filter((x) => !/^ROW(MOD)?ID$/i.test(x)).map((name) => {
    const prop = set.props.find((x) => x.name === name) ?? set.props.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!prop) throw bad(`${option}: there is no property "${name}"`, '102');
    return prop;
  });
}

/** Splits at `sep` outside parentheses. */
function topLevel(text: string, sep: string, option = '$expand'): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  // Inside a 'string' (where '' is a quote) parentheses and separators are text.
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) throw bad(`${option}: a ")" has no "("`);
  }
  if (depth || quoted) throw bad(quoted ? `${option}: a ' string is not closed` : `${option}: a "(" is not closed`);
  out.push(text.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A navigation property to show inline: which properties, and how many records at most. */
interface Expansion {
  name: string; target: EntitySet; props: Prop[]; top?: number; skip: number;
  /** $filter and $orderby on the related records. */
  filter?: { where: string; params: SqlValue[]; fields: string[] };
  sort?: SortSpec[];
}
/** How many more related record ids this response may read. */
interface Budget { left: number }

/** A response's related records ran past EXPAND_LIMIT. */
class Exhausted extends Error {}
const exhausted = () => bad(`$expand: more than ${EXPAND_LIMIT.records.toLocaleString('en-US')} related records for one response; ask for fewer at a time ($top, or $top inside $expand)`);

function navigation(set: EntitySet, name: string): EntitySet['nav'][number] | undefined {
  return set.nav.find((n) => n.name === name) ?? set.nav.find((n) => n.name.toLowerCase() === name.toLowerCase());
}

const whole = (option: string, v: string) => {
  if (!/^\d+$/.test(v.trim())) throw bad(`${option} must be a whole number`);
  return Number(v.trim());
};

/** $expand: navigation properties, each with its own $select, $top and $skip in parentheses. */
function expansions(text: string | null, set: EntitySet): Expansion[] {
  if (text === null) return [];
  const out: Expansion[] = [];
  for (const item of topLevel(text, ',')) {
    const m = /^([^()]+?)\s*(?:\(([\s\S]*)\))?$/.exec(item);
    if (!m) throw bad(`$expand: "${item}" is not a navigation property`);
    const star = m[1] === '*';
    for (const name of star ? set.nav.map((n) => n.name) : [m[1]]) {
      const nav = navigation(set, name);
      if (!nav) throw bad(`$expand: there is no navigation property "${name}"`, '102');
      if (out.some((x) => x.name === nav.name)) {
        if (star) continue;
        throw bad(`$expand: ${nav.name} is named twice`);
      }
      const e: Expansion = { name: nav.name, target: nav.target, props: nav.target.props, skip: 0 };
      const given = new Set<string>();
      for (const opt of m[2] ? topLevel(m[2], ';') : []) {
        const [k, ...rest] = opt.split('=');
        const v = rest.join('=');
        const key = k.trim().toLowerCase();
        if (given.has(key)) throw bad(`$expand: ${k.trim()} is given twice for ${nav.name}`);
        given.add(key);
        if (key === '$select') e.props = selected(v, nav.target, `$expand ${nav.name} $select`);
        else if (key === '$top') e.top = whole('$top', v);
        else if (key === '$skip') e.skip = whole('$skip', v);
        else if (key === '$filter') e.filter = filterSql(v, nav.target.props);
        else if (key === '$orderby') e.sort = orderBy(v, nav.target.props);
        else throw new ODataError(501, '3', `$expand: ${k.trim()} is not supported (only $select, $filter, $orderby, $top and $skip)`);
      }
      out.push(e);
    }
  }
  return out;
}

// --- the endpoint --------------------------------------------------------------

export class ODataEndpoint {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly verified = new Map<string, number>();
  /** Serves container files (with ranges) for .../{field}/$value. */
  files?: ContainerFiles;
  /** Script sessions per file, account and sign-in route, so global variables last between calls like a Data API session. */
  private readonly sessions = new Map<string, ScriptSession>();
  private readonly inFlight = new IdentityInFlight();

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for OData. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== ROOT && !url.pathname.startsWith(ROOT + '/')) return false;
    const requested = /IEEE754Compatible\s*=\s*true/i.test(String(req.headers.accept ?? '')) || /IEEE754Compatible\s*=\s*true/i.test(url.searchParams.get('$format') ?? '');
    await ieeeContext.run({ requested, enabled: false }, async () => {
      try { await this.route(req, res, url); }
      catch (e) { fail(res, e); }
    });
    return true;
  }

  private async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET';
    const parts = url.pathname.slice(ROOT.length).split('/').filter(Boolean).map(decodeURIComponent);
    const root = `${origin(req, this.host.publicUrl)}${ROOT}`;
    if (!parts.length) {
      if (method !== 'GET' && method !== 'HEAD') throw notAllowed('Only GET and HEAD are allowed here', READ_METHODS);
      // The files, as FileMaker Server lists them; signing in happens per file.
      const names = listedFiles(this.host);
      if (!names) throw new ODataError(404, '3', 'The list of files is turned off on this server: name the file in the address');
      return send(res, 200, {
        '@odata.context': `${root}/$metadata`,
        value: names.map((name) => ({ name, kind: 'EntityContainer', url: encodeURIComponent(name) })),
      });
    }
    const store = this.host.get(parts[0]);
    if (!store) {
      await refuseUnknownFile(this.host, req);
      throw new ODataError(404, '802', `Unable to open file "${parts[0]}"`);
    }
    const ieee = ieeeContext.getStore();
    if (ieee && store.fileMode === 'native' && ieee.requested) { ieee.enabled = true; ieee754Responses.add(res); }
    const { privileges: p, readOnlyToken, via } = await signIn(req, store, this.api, this.verified, 'fmodata', 'OData access');
    const done = this.inFlight.enter(JSON.stringify([store.name.toLowerCase(), p.account.toLowerCase()]), res);
    if (!done) {
      busyHeaders(res);
      throw new ODataError(503, '956', 'Too many requests in flight for this identity');
    }
    try {
      const base = `${root}/${encodeURIComponent(store.name)}`;
      const sets = model(store, p);
      const at: Service = { store, p, readOnlyToken, via, base, sets };
      if (parts[1] === '$batch' && parts.length === 2) return await this.batch(req, res, at);
      return await this.resource(req, res, url, parts, at);
    } finally { done(); }
  }

  /** A request within one file's service, signed in: from the client, or one request of a $batch. */
  private async resource(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[], at: Service): Promise<void> {
    const method = req.method ?? 'GET';
    const { store, p, base, sets } = at;
    const reading = method === 'GET' || method === 'HEAD';
    const writing = !reading;
    if (writing && at.readOnlyToken) throw new ODataError(403, '9', 'This API token is read-only');

    if (parts.length === 1) {
      if (!reading) throw notAllowed('Only GET and HEAD are allowed here', READ_METHODS);
      return send(res, 200, {
        '@odata.context': `${base}/$metadata`,
        value: sets.map((s) => ({ name: s.name, kind: 'EntitySet', url: s.name })),
      });
    }
    if (parts[1] === '$metadata') {
      if (!reading) throw notAllowed('Only GET and HEAD are allowed here', READ_METHODS);
      const doc = metadata(identifier(store.name, new Set()), sets);
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'content-length': Buffer.byteLength(doc), 'x-content-type-options': 'nosniff', 'odata-version': '4.0', 'cache-control': 'no-store' })
        .end(doc);
      return;
    }
    if (parts[1] === '$batch') throw bad(at.inBatch ? 'A $batch can\'t hold another $batch' : 'A $batch is sent with POST to the file\'s service root', '3');
    const script = /^Script\.(.+)$/.exec(parts[1]);
    if (script && parts.length === 2) {
      if (method !== 'POST') throw notAllowed('Scripts are run with POST', 'POST');
      return this.script(req, res, store, p, script[1], at.via);
    }
    if (SCHEMA_SETS.some((n) => n.toLowerCase() === parts[1].toLowerCase())) {
      if (!p.full) throw new ApiError(9, `Only [Full Access] can change the schema; "${p.name}" can't`, 403);
      const body = method === 'POST' || method === 'PATCH' ? await readJson(req) : {};
      const r = schemaChange(store, p, method, parts.slice(1), body);
      if (r.status === 204) {
        res.writeHead(204, { 'odata-version': '4.0' }).end();
        return;
      }
      return send(res, r.status, r.body);
    }

    const cross = crossjoinSets(parts[1]);
    if (cross) {
      if (parts.length !== 2) throw new ODataError(404, '3', 'A $crossjoin has no paths below it');
      if (!reading) throw notAllowed('Only GET and HEAD are allowed here', READ_METHODS);
      return this.crossjoined(req, res, url, base, cross.map((name) => findSet(sets, name)), p);
    }

    const m = /^(.+?)(?:\((.*)\))?$/.exec(parts[1])!;
    const set = findSet(sets, m[1]);
    const opts = { account: p.account, privileges: p };

    if (m[2] === undefined) {
      if (parts[2] === '$count' && parts.length === 3) {
        if (!reading) throw notAllowed('Only GET and HEAD are allowed here', READ_METHODS);
        const query = this.idQuery(set, url, p);
        const count = String(filtered(!!query.where, () => set.info.owner.countIds(set.info, query)));
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': count.length, 'x-content-type-options': 'nosniff', 'odata-version': '4.0', 'cache-control': 'no-store' }).end(count);
        return;
      }
      if (parts.length !== 2) throw new ODataError(404, '3', 'Navigation is not supported');
      if (reading) return this.list(req, res, url, base, set, p);
      if (method === 'POST') {
        const { data, files } = this.body(await readJson(req, set.info.owner.fileMode === 'native'), set);
        const r = allOrNothing(() => {
          const made = set.info.owner.create(set.info, data, opts);
          return { recordId: made.recordId, modId: this.fill(set, made.recordId, files, opts) ?? made.modId };
        });
        const entity = this.entity(set, r.recordId, p);
        const where = `${base}/${encodeURIComponent(set.name)}(${r.recordId})`;
        res.setHeader('location', where);
        res.setHeader('etag', etag(r.modId));
        const want = returnPreference(req);
        if (want) res.setHeader('preference-applied', `return=${want}`);
        if (want === 'minimal') {
          // Just where the new record is (OData 4.0 section 8.2.8.7).
          res.writeHead(204, { 'odata-version': '4.0', 'odata-entityid': where }).end();
          return;
        }
        return send(res, 201, { '@odata.context': `${base}/$metadata#${set.name}/$entity`, ...entity });
      }
      throw notAllowed(`${method} is not allowed on an entity set`, `${READ_METHODS}, POST`);
    }

    const key = /^(?:ROWID=)?(\d+)$/i.exec(m[2].trim())?.[1];
    if (!key) throw bad(`Records are addressed by ROWID, as ${set.name}(123)`, '500');
    const id = Number(key);
    const owner = set.info.owner;
    if (parts.length >= 3 && method !== 'GET' && method !== 'HEAD') {
      // A container field takes a file: the body, with its Content-Type (PATCH or PUT), or is emptied (DELETE).
      const prop = set.props.find((x) => x.name === parts[2]) ?? set.props.find((x) => x.name.toLowerCase() === parts[2].toLowerCase());
      if (!prop?.fillable || (parts.length > 3 && parts[3] !== '$value') || !['PATCH', 'PUT', 'DELETE'].includes(method)) {
        throw notAllowed(prop?.type === 'container' && !prop.fillable ? `${prop.name} cannot be modified` : 'Only a container field takes PATCH, PUT or DELETE here; other fields are changed on the record',
          prop?.fillable && parts.length <= 4 ? `${READ_METHODS}, PATCH, PUT, DELETE` : READ_METHODS);
      }
      const expected = ifMatch(req);
      if (expected !== undefined && owner.get(set.info, id, 'iso', undefined, p, { fields: [] }).modId !== expected) {
        throw new ODataError(412, '306', 'Record modification id does not match');
      }
      // The account's right to put a file there is settled before the body is read.
      if (method !== 'DELETE') owner.checkContainerWrite(set.info, id, prop.field, 1, opts);
      const file = method === 'DELETE' ? null : await upload(req, prop);
      // Checked again once the body is in, with no wait before the write, so a change made meanwhile isn't overwritten.
      if (expected !== undefined && owner.get(set.info, id, 'iso', undefined, p, { fields: [] }).modId !== expected) {
        throw new ODataError(412, '306', 'Record modification id does not match');
      }
      const r = owner.setContainer(set.info, id, prop.field, 1, file, opts);
      res.writeHead(204, { 'odata-version': '4.0', etag: etag(r.modId) }).end();
      return;
    }
    if (parts.length >= 3) {
      const keyed = /^(.+?)\((.*)\)$/.exec(parts[2]);
      const nav = navigation(set, keyed ? keyed[1] : parts[2]);
      if (nav && !set.props.some((x) => x.name === parts[2])) {
        if (keyed) {
          // One related record, by its ROWID: only while it is related to this one (and the account may view it).
          const child = /^(?:ROWID=)?(\d+)$/i.exec(keyed[2].trim())?.[1];
          if (!child) throw bad(`Records are addressed by ROWID, as ${nav.name}(123)`, '500');
          const ref = parts[3] === '$ref' && parts.length === 4;
          if (parts.length > 3 && !ref) throw new ODataError(404, '3', 'Navigation goes one relationship at a time');
          this.entity(set, id, p);
          const e: Expansion = { name: nav.name, target: nav.target, props: nav.target.props, skip: 0 };
          if (!this.withinLimit(() => this.relatedIds(set, id, e, p, { left: EXPAND_LIMIT.records })).includes(Number(child))) {
            throw new ODataError(404, '101', `Record ${child} is not related to ${set.name}(${id}) through ${nav.name}`);
          }
          if (ref) {
            nav.target.info.owner.logRead(nav.target.info.table, [Number(child)], { privileges: p });
            return send(res, 200, { '@odata.context': `${base}/$metadata#$ref`, '@odata.id': `${base}/${nav.target.name}(${child})` });
          }
          const expand = expansions(url.searchParams.get('$expand'), nav.target);
          const entity = this.entity(nav.target, Number(child), p, expand);
          const select = url.searchParams.get('$select');
          const keep = select && select.trim() !== '*' ? new Set(['@odata.etag', 'ROWID', 'ROWMODID', ...selected(select, nav.target).map((x) => x.name), ...expand.map((x) => x.name)]) : undefined;
          res.setHeader('etag', entity['@odata.etag'] as string);
          this.logEntities(nav.target, [entity], expand, p);
          return send(res, 200, { '@odata.context': `${base}/$metadata#${nav.target.name}/$entity`, ...(keep ? Object.fromEntries(Object.entries(entity).filter(([k]) => keep.has(k))) : entity) });
        }
        const counting = parts[3] === '$count' && parts.length === 4;
        const refs = parts[3] === '$ref' && parts.length === 4;
        if (parts.length > 3 && !counting && !refs) throw new ODataError(404, '3', 'Navigation goes one relationship at a time');
        const e: Expansion = {
          name: nav.name, target: nav.target, props: selected(url.searchParams.get('$select'), nav.target), skip: 0,
          ...(url.searchParams.has('$top') ? { top: whole('$top', url.searchParams.get('$top')!) } : {}),
        };
        if (url.searchParams.has('$skip')) e.skip = whole('$skip', url.searchParams.get('$skip')!);
        if (url.searchParams.has('$filter')) e.filter = filterSql(url.searchParams.get('$filter')!, nav.target.props, this.lambdaFor(nav.target, p, { left: EXPAND_LIMIT.records }));
        if (url.searchParams.has('$orderby')) e.sort = orderBy(url.searchParams.get('$orderby')!, nav.target.props);
        this.entity(set, id, p); // the record itself must be there and viewable
        if (counting) {
          const ids = this.withinLimit(() => this.relatedIds(set, id, { ...e, sort: undefined, skip: 0 }, p, { left: EXPAND_LIMIT.records }));
          const n = ids.length; // a count discloses no records, so it logs no ids (as a top-level $count)
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(n).length, 'x-content-type-options': 'nosniff', 'odata-version': '4.0', 'cache-control': 'no-store' }).end(String(n));
          return;
        }
        const body: Record<string, unknown> = { '@odata.context': `${base}/$metadata#${refs ? 'Collection($ref)' : nav.target.name}` };
        if (/^true$/i.test(url.searchParams.get('$count') ?? '')) {
          body['@odata.count'] = this.withinLimit(() => this.relatedIds(set, id, { ...e, sort: undefined, skip: 0 }, p, { left: EXPAND_LIMIT.records })).length;
        }
        if (refs) {
          // Only where each related record is, not what is in it.
          const ids = this.withinLimit(() => this.relatedIds(set, id, e, p, { left: EXPAND_LIMIT.records }, Math.min(e.top ?? MAX_RELATED, MAX_RELATED)));
          body.value = ids.map((rid) => ({ '@odata.id': `${base}/${nav.target.name}(${rid})` }));
          nav.target.info.owner.logRead(nav.target.info.table, ids, { privileges: p });
          return send(res, 200, body);
        }
        const value = this.withinLimit(() => this.related(set, id, e, p, { left: EXPAND_LIMIT.records }));
        body.value = value;
        this.logEntities(nav.target, value, [], p);
        return send(res, 200, body);
      }
      return this.property(req, res, base, set, id, parts[2], parts[3], p, at.inBatch);
    }
    if (reading) {
      for (const [k] of url.searchParams) {
        if (!k.startsWith('$')) continue;
        if (k === '$levels') throw new ODataError(501, '3', '$levels is not supported');
        if (!['$select', '$expand', '$format'].includes(k)) throw bad(`${k} can't be used on one record (only $select, $expand and $format)`);
      }
      const format = url.searchParams.get('$format');
      if (format && !/^(json|application\/json)/i.test(format)) throw new ODataError(501, '3', 'Only JSON is supported');
      const expand = expansions(url.searchParams.get('$expand'), set);
      const entity = this.entity(set, id, p, expand);
      res.setHeader('etag', entity['@odata.etag'] as string);
      // $select as on a list and on a related record: the key and etag, the properties named, and what was expanded.
      const select = url.searchParams.get('$select');
      const props = select && select.trim() !== '*' ? selected(select, set) : undefined;
      const keep = props ? new Set(['@odata.etag', 'ROWID', 'ROWMODID', ...props.map((x) => x.name), ...expand.map((x) => x.name)]) : undefined;
      const context = `${base}/$metadata#${set.name}${props ? `(${['ROWID', 'ROWMODID', ...props.map((x) => x.name), ...expand.map((e) => e.name)].join(',')})` : ''}/$entity`;
      this.logEntities(set, [entity], expand, p);
      return send(res, 200, { '@odata.context': context, ...(keep ? Object.fromEntries(Object.entries(entity).filter(([k]) => keep.has(k))) : entity) });
    }
    if (method === 'PATCH' || method === 'PUT') {
      const { data, files } = this.body(await readJson(req, set.info.owner.fileMode === 'native'), set);
      const expected = ifMatch(req);
      const r = allOrNothing(() => {
        const changed = owner.update(set.info, id, data, expected, opts);
        return { modId: this.fill(set, id, files, opts) ?? changed.modId };
      });
      res.setHeader('etag', etag(r.modId));
      const want = returnPreference(req);
      if (want) res.setHeader('preference-applied', `return=${want}`);
      if (want === 'representation') {
        return send(res, 200, { '@odata.context': `${base}/$metadata#${set.name}/$entity`, ...this.entity(set, id, p) });
      }
      res.writeHead(204, { 'odata-version': '4.0' }).end();
      return;
    }
    if (method === 'DELETE') {
      const expected = ifMatch(req);
      if (expected !== undefined) {
        const current = owner.get(set.info, id, 'iso', undefined, p, { fields: [] }).modId;
        if (current !== expected) throw new ODataError(412, '306', 'Record modification id does not match');
      }
      owner.delete(set.info, id, opts);
      res.writeHead(204, { 'odata-version': '4.0' }).end();
      return;
    }
    throw notAllowed(`${method} is not allowed on a record`, `${READ_METHODS}, PATCH, PUT, DELETE`);
  }

  /**
   * $batch: each request in turn, signed in as the batch was (so each one has
   * exactly the batch's access). A change set is one transaction: if any of its
   * requests fails, none of its changes are kept. Without Prefer:
   * odata.continue-on-error the batch stops at the first request that fails.
   */
  private async batch(req: IncomingMessage, res: ServerResponse, at: Service): Promise<void> {
    if (req.method !== 'POST') throw notAllowed('A $batch is sent with POST', 'POST');
    const { json, units } = batchRequests(String(req.headers['content-type'] ?? ''), await readBody(req, MAX_BATCH_BYTES));
    const keepGoing = /odata\.continue-on-error(?!\s*=\s*false)/i.test(String(req.headers.prefer ?? ''));
    const located = new Map<string, string>();
    const failed = new Set<string>();
    const results: BatchResult[] = [];
    const used = { bytes: 0, joins: 0 };
    for (const unit of units) {
      const blocked = unit.requests.flatMap((r) => r.dependsOn ?? []).find((d) => failed.has(d));
      const full = used.bytes > BATCH_LIMIT.responseBytes;
      const result: BatchResult = blocked !== undefined
        ? skipped(unit, failure(424, '3', `"${blocked}", which this depends on, failed`))
        : full ? skipped(unit, failure(400, '3', `This $batch's answers reached ${BATCH_LIMIT.responseBytes / 1024 / 1024} MB, so this request wasn't run: send it in another $batch`))
          : unit.atomic ? await this.changeSet(req, unit, at, located, used)
            : { unit, answers: [await this.one(req, unit.requests[0], at, located, used)] };
      results.push(result);
      const wrong = result.failed !== undefined || result.answers.some((a) => a.status >= 400);
      if (wrong) {
        for (const r of unit.requests) if (r.id !== undefined) failed.add(r.id);
        if (unit.group !== undefined) failed.add(unit.group);
        if (!keepGoing) break;
      }
    }
    const out = batchResponse(json, results);
    res.writeHead(200, {
      'content-type': out.type, 'odata-version': '4.0', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      ...(keepGoing ? { 'preference-applied': 'odata.continue-on-error' } : {}),
    }).end(out.data);
  }

  /** A change set: its requests in one transaction, kept only if every one of them succeeds. */
  private async changeSet(outer: IncomingMessage, unit: BatchUnit, at: Service, located: Map<string, string>, used: { bytes: number; joins: number }): Promise<BatchResult> {
    const { requests } = unit;
    const tx: Transaction = { files: new Map() };
    const answers: BatchAnswer[] = [];
    let failed: BatchAnswer | undefined;
    try {
      await writer.run({ ...(writer.getStore() ?? {}), transaction: { open: tx } }, async () => {
        for (const r of requests) {
          const a = await this.one(outer, r, at, located, used);
          answers.push(a);
          if (a.status >= 400) {
            failed = a;
            break;
          }
          // The size cap holds inside a change set too: past it, the whole set fails.
          if (used.bytes > BATCH_LIMIT.responseBytes) {
            failed = failure(400, '3', `This change set's answers passed ${BATCH_LIMIT.responseBytes / 1024 / 1024} MB, so none of it was kept: send it in smaller pieces`);
            answers[answers.length - 1] = failed;
            break;
          }
        }
      });
    } catch (e) {
      endTransaction(tx, false);
      throw e;
    }
    endTransaction(tx, !failed);
    if (!failed) return { unit, answers };
    // What the change set created is gone, so later requests can't address it.
    for (const r of requests) if (r.id !== undefined) located.delete(r.id);
    return { unit, answers, failed };
  }

  /** One request of a $batch, answered as it would be on its own. */
  private async one(outer: IncomingMessage, r: BatchRequest, at: Service, located: Map<string, string>, used: { bytes: number; joins: number }): Promise<BatchAnswer> {
    // Other clients get a turn between the requests of a batch.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const res = new Captured();
    try {
      // "$1/..." is what request 1 created (its Location).
      const ref = /^\$([^/?]+)(.*)$/s.exec(r.url);
      const target = ref && located.has(ref[1]) ? located.get(ref[1])! + ref[2] : r.url;
      let url: URL;
      try {
        url = new URL(target, `${at.base}/`);
      } catch {
        throw bad(`"${r.url}" is not a valid address`, '3');
      }
      if (!url.pathname.startsWith(`${ROOT}/`)) throw bad(`"${r.url}" is not a request to this service`, '3');
      const parts = url.pathname.slice(ROOT.length).split('/').filter(Boolean).map(decodeURIComponent);
      if (this.host.get(parts[0]) !== at.store || parts.length < 2) throw bad(`"${r.url}" is not a request to this file's service`, '3');
      // Each $crossjoin runs a worker for up to CROSSJOIN_LIMIT.ms, so a batch of them would hold the join slots for as long as it likes.
      if (/^\$crossjoin\(/i.test(parts[1]!) && ++used.joins > BATCH_LIMIT.crossjoins) {
        throw new ODataError(400, '3', `A $batch runs at most ${BATCH_LIMIT.crossjoins} $crossjoin requests: send the rest in another $batch`);
      }
      const forwarded = Object.fromEntries(['host', 'x-forwarded-host', 'x-forwarded-proto'].flatMap((k) => outer.headers[k] === undefined ? [] : [[k, outer.headers[k]]]));
      const req = Object.assign(Readable.from(r.body.length ? [r.body] : []), {
        method: r.method, url: url.pathname + url.search, headers: { ...r.headers, ...forwarded }, socket: outer.socket,
      }) as unknown as IncomingMessage;
      await this.resource(req, res as unknown as ServerResponse, url, parts, { ...at, inBatch: true });
    } catch (e) {
      fail(res as unknown as ServerResponse, e);
    }
    const answer = res.answer();
    // A HEAD answer has GET's headers (content-length too) and no body.
    if (r.method === 'HEAD') answer.body = Buffer.alloc(0);
    used.bytes += answer.body.length;
    if (r.id !== undefined && answer.status < 400 && answer.headers.location) located.set(r.id, answer.headers.location);
    return answer;
  }

  /**
   * any() and all() in a $filter. The related records that satisfy the predicate (for all: that fail it) are found as the
   * account sees them, then the records of `set` related to them; `any` keeps those, `all` leaves them out (so a record
   * with no related records passes `all`, as it does in OData). Both read at most EXPAND_LIMIT.records records.
   */
  private lambdaFor(set: EntitySet, p: Privileges, budget: Budget, level = 0, count = { n: 0 }): Lambda {
    return (name, all, predicate) => {
      if (level >= LAMBDA_LIMIT.depth) throw bad(`$filter nests any() and all() more than ${LAMBDA_LIMIT.depth} deep`);
      if (++count.n > LAMBDA_LIMIT.count) throw bad(`$filter has more than ${LAMBDA_LIMIT.count} any() and all() tests`);
      const nav = navigation(set, name);
      if (!nav) throw bad(`$filter: "${name}" is not a navigation property of ${set.name}`, '102');
      const inner = predicate === undefined ? undefined : filterSql(predicate, nav.target.props, this.lambdaFor(nav.target, p, budget, level + 1, count));
      const target = nav.target;
      const found = filtered(!!inner, () => target.info.owner.selectIds(target.info, {
        where: inner ? (all ? `coalesce((${inner.where}), 0) = 0` : inner.where) : undefined,
        params: inner?.params, fields: inner?.fields, privileges: p, limit: budget.left + 1,
      }));
      const tooMany = () => bad(`$filter: ${all ? 'all' : 'any'}(${name}) would read more than ${EXPAND_LIMIT.records.toLocaleString('en-US')} related records: narrow the condition`);
      budget.left -= found.length;
      if (budget.left < 0) throw tooMany();
      const owners = new Set<number>();
      for (const id of found) {
        const row = target.info.owner.row(target.info, id);
        const back = relatedIdList(target.graph, target.toId, row, set.toId);
        budget.left -= back?.ids.length ?? 0;
        if (budget.left < 0) throw tooMany();
        for (const x of back?.ids ?? []) owners.add(x);
      }
      return { sql: `_fm_record_id ${all ? 'NOT IN' : 'IN'} (SELECT value FROM json_each(?))`, params: [JSON.stringify([...owners])], kind: 'bool' };
    };
  }

  /** The SQL selection shared by a page and its unpaged count. */
  private idQuery(set: EntitySet, url: URL, p: Privileges) {
    const filter = url.searchParams.get('$filter');
    const search = url.searchParams.get('$search');
    const conditions = [filter ? filterSql(filter, set.props, this.lambdaFor(set, p, { left: EXPAND_LIMIT.records }), computedProps(url.searchParams.get('$compute'), set)) : undefined, search !== null ? searchSql(search, set.props) : undefined].filter((x) => x !== undefined);
    const order = url.searchParams.get('$orderby');
    if (order && url.searchParams.has('$compute')) {
      const named = computedProps(url.searchParams.get('$compute'), set);
      for (const part of order.split(',')) {
        const key = part.trim().split(/\s+/)[0]!.toLowerCase();
        if (named.some((c) => c.name.toLowerCase() === key)) throw new ODataError(501, '3', `$orderby: ${part.trim().split(/\s+/)[0]} is a $compute property, which can't be sorted on yet: sort on the stored properties it is worked out from`);
      }
    }
    return {
      where: conditions.length ? conditions.map((c) => `(${c.where})`).join(' AND ') : undefined,
      params: conditions.flatMap((c) => c.params), fields: conditions.flatMap((c) => c.fields),
      sort: order ? orderBy(order, set.props) : undefined, privileges: p,
    };
  }

  private list(req: IncomingMessage, res: ServerResponse, url: URL, base: string, set: EntitySet, p: Privileges): void | Promise<void> {
    for (const [k] of url.searchParams) {
      if (!k.startsWith('$')) continue;
      if (k === '$levels') throw new ODataError(501, '3', '$levels is not supported');
      if (!['$filter', '$search', '$select', '$orderby', '$top', '$skip', '$count', '$format', '$skiptoken', '$expand', '$apply', '$compute'].includes(k)) throw bad(`Unknown query option ${k}`);
    }
    const count = url.searchParams.get('$count');
    if (count !== null && !/^(true|false)$/i.test(count)) throw bad('$count is true or false');
    const format = url.searchParams.get('$format');
    if (format && !/^(json|application\/json)/i.test(format)) throw new ODataError(501, '3', 'Only JSON is supported');
    const { top, skip, page, pref } = paging(req, url);

    if (url.searchParams.has('$apply')) return this.applied(res, url, base, set, p, { top, skip, page, pref });

    const select = url.searchParams.get('$select');
    // A computed property is shown only where $select names it.
    const computed = computedProps(url.searchParams.get('$compute'), set);
    const names = (select ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const shown = computed.filter((c) => names.some((n) => n.toLowerCase() === c.name.toLowerCase()));
    const others = names.filter((n) => !shown.some((c) => c.name.toLowerCase() === n.toLowerCase()));
    const props = select === null || !shown.length ? selected(select, set) : others.length ? selected(others.join(','), set) : [];
    const expand = expansions(url.searchParams.get('$expand'), set);
    const query = this.idQuery(set, url, p);
    // One extra id detects the next page; $top still bounds the whole request.
    const wanted = filtered(!!query.where, () => set.info.owner.selectIds(set.info, {
      ...query, offset: skip, limit: Math.min(top ?? page + 1, page + 1),
    }));
    const ids = wanted.slice(0, page);
    // OData entity sets exclude summary fields, so no full found set is needed.
    const records = set.info.owner.getMany(set.info, ids, ids, { dateFormat: 'iso', privileges: p, fields: set.props.map((x) => x.field) });
    const values = shown.length ? set.info.owner.computeValues(set.info, ids, shown, p) : undefined;
    const budget: Budget = { left: EXPAND_LIMIT.records };
    const body: Record<string, unknown> = {
      '@odata.context': `${base}/$metadata#${set.name}${select && select.trim() !== '*' ? `(${['ROWID', 'ROWMODID', ...props.map((x) => x.name), ...shown.map((c) => c.name), ...expand.map((e) => e.name)].join(',')})` : ''}`,
    };
    if (/^true$/i.test(url.searchParams.get('$count') ?? '')) body['@odata.count'] = filtered(!!query.where, () => set.info.owner.countIds(set.info, query));
    // A page whose related records ($expand) pass EXPAND_LIMIT ends early, and the next link carries on from there.
    const value: Record<string, unknown>[] = [];
    let served = ids.length;
    for (const r of records) {
      let related: Record<string, unknown>;
      try {
        related = this.expanded(set, r.recordId, expand, p, budget);
      } catch (e) {
        if (!(e instanceof Exhausted)) throw e;
        if (!value.length) throw exhausted();
        served = ids.indexOf(r.recordId);
        break;
      }
      value.push({
        '@odata.etag': etag(r.modId),
        ROWID: r.recordId, ROWMODID: r.modId,
        ...Object.fromEntries(props.map((x) => [x.name, toJson(r.fieldData[x.field], x.type)])),
        ...(values ? Object.fromEntries(shown.map((c, n) => [c.name, computedJson(values.get(r.recordId)?.[n], c.kind)])) : {}),
        ...related,
      });
    }
    body.value = value;
    this.logEntities(set, value, expand, p);
    if (wanted.length > served) {
      const next = new URL(`${base}/${encodeURIComponent(set.name)}`);
      for (const [k, v] of url.searchParams) if (k !== '$skip' && k !== '$top' && k !== '$skiptoken') next.searchParams.set(k, v);
      next.searchParams.set('$skip', String(skip + served));
      if (top !== undefined) next.searchParams.set('$top', String(top - served));
      body['@odata.nextLink'] = next.toString();
    }
    if (pref) res.setHeader('preference-applied', `odata.maxpagesize=${page}`);
    send(res, 200, body);
  }

  /**
   * $apply: the records' groups and totals (see odata-apply.ts). The records are read as the account sees them, put in
   * a table of their own, and grouped there; $filter, $orderby, $top, $skip and $count then work on the rows that gives.
   */
  private async applied(res: ServerResponse, url: URL, base: string, set: EntitySet, p: Privileges, paging: { top?: number; skip: number; page: number; pref?: string }): Promise<void> {
    for (const k of ['$select', '$expand', '$compute']) {
      if (url.searchParams.has(k)) throw bad(`${k} can't be used with $apply: groupby and aggregate name the properties`);
    }
    if (url.searchParams.has('$search')) throw bad('$search can\'t be used with $apply: narrow the records with filter(...) instead');
    const apply = parseApply(url.searchParams.get('$apply')!, set.props);
    // The filter() steps are one $filter, so its limits hold for all of them together.
    const f = apply.filters.length ? filterSql(apply.filters.map((x) => `(${x})`).join(' and '), set.props) : undefined;
    const ids = filtered(!!f, () => set.info.owner.selectIds(set.info, { where: f?.where, params: f?.params, fields: f?.fields, privileges: p, limit: APPLY_LIMIT.records + 1 }));
    if (ids.length > APPLY_LIMIT.records) throw bad(`$apply reads at most ${APPLY_LIMIT.records.toLocaleString('en-US')} records and this one would read more: narrow it with filter(...) first`, '3');
    const sources = [...new Set([...apply.groupBy, ...apply.aggregates.flatMap((a) => (a.prop ? [a.prop as Prop] : []))])] as Prop[];
    const col = new Map(sources.map((x, i) => [x.field, `c${i}`]));
    // Text groups and counts its values without regard to case (all of Unicode, as the store's summaries do): each
    // text column has a lowercased key beside it, k0 for c0, and a group shows the first of its spellings.
    const key = (x: { field: string; type: string }) => (x.type === 'text' ? col.get(x.field)!.replace(/^c/, 'k') : col.get(x.field)!);
    // Numbers are summed as doubles, as SQLite and JavaScript do.
    const typed = (type: string) => (type === 'number' ? 'REAL' : type === 'integer' || type === 'boolean' ? 'INTEGER' : type === 'text' ? 'TEXT COLLATE NOCASE' : 'TEXT');
    const db = new DatabaseSync(':memory:');
    try {
      db.function('fm_decimal_key', { deterministic: true }, (v) => decimalKey(v as string | number | null));
      const columns = sources.flatMap((x) => (x.type === 'text' ? [`${col.get(x.field)} TEXT`, `${key(x)} TEXT`] : [`${col.get(x.field)} ${typed(x.type)}`]));
      db.exec(`CREATE TABLE r (${columns.length ? columns.join(', ') : 'x'})`);
      if (sources.length) {
        const insert = db.prepare(`INSERT INTO r VALUES (${columns.map(() => '?').join(', ')})`);
        // A value as it is grouped: empty, and what OData shows as null (text in a number field, a date that isn't one), are null.
        const value = (v: string | number | undefined, type: string): SqlValue => {
          const shown = toJson(v, type);
          return shown === null ? null : typeof shown === 'boolean' ? (shown ? 1 : 0) : type === 'timestamp' ? String(v) : shown;
        };
        const names = sources.map((x) => x.field);
        db.exec('BEGIN');
        try {
          for (let i = 0; i < ids.length; i += 1000) {
            const chunk = ids.slice(i, i + 1000);
            for (const r of set.info.owner.getMany(set.info, chunk, chunk, { dateFormat: 'iso', privileges: p, fields: names })) {
              insert.run(...sources.flatMap((x) => {
                const v = value(r.fieldData[x.field], x.type);
                return x.type === 'text' ? [v, v === null ? null : String(v).toLowerCase()] : [v];
              }));
            }
            // Other clients get a turn between chunks.
            if (i + 1000 < ids.length) await new Promise<void>((resolve) => setImmediate(resolve));
          }
          db.exec('COMMIT');
        } catch (e) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw e;
        }
      }
      // The rows $apply gives, as properties $filter and $orderby know.
      const out: Prop[] = [
        ...apply.groupBy.map((x) => ({ name: x.name, field: x.name, type: x.type, edm: EDM[x.type] ?? 'Edm.String', queryable: true, writable: false })),
        ...apply.aggregates.map((a) => ({ name: a.alias, field: a.alias, type: aggregateType(a), edm: EDM[aggregateType(a)] ?? 'Edm.String', queryable: true, writable: false })),
      ];
      db.exec(`CREATE TABLE g (${out.map((x) => `${q(x.field)} ${typed(x.type)}`).join(', ')})`);
      const keys = apply.groupBy.map(key);
      const shown = apply.groupBy.map((x) => (x.type === 'text' ? `MIN(${col.get(x.field)})` : col.get(x.field)!));
      // Only $count: the records need no table, just their number.
      const from = sources.length ? 'r' : '(SELECT 1 FROM json_each(?))';
      const aggs = apply.aggregates.map((a) => aggregateSql(a, a.prop ? (a.method === 'countdistinct' ? key(a.prop) : col.get(a.prop.field)!) : ''));
      db.prepare(`INSERT INTO g SELECT ${[...shown, ...aggs].join(', ')} FROM ${from}${keys.length ? ` GROUP BY ${keys.join(', ')}` : ''}`)
        .run(...(sources.length ? [] : [JSON.stringify(ids)]));

      const filter = url.searchParams.get('$filter');
      const f = filter ? filterSql(filter, out) : undefined;
      if (f && /\b_fm_(record|mod)_id\b/.test(f.where)) throw bad('$filter: rows $apply gives have no ROWID or ROWMODID', '102');
      const order = url.searchParams.get('$orderby');
      // The groups always end the order, so pages that follow one another don't repeat or skip a group.
      const sort = [...(order ? orderBy(order, out).map((x) => `${out.find((p) => p.field === x.fieldName)?.type === 'decimal' ? `fm_decimal_key(${q(x.fieldName)})` : q(x.fieldName)} ${x.sortOrder === 'descend' ? 'DESC' : 'ASC'}`) : []),
        ...out.slice(0, apply.groupBy.length).map((x) => q(x.field))];
      const sql = `FROM g${f ? ` WHERE ${f.where}` : ''}`;
      const { top, skip, page, pref } = paging;
      const wanted = top === undefined ? -1 : top;
      const rows = filtered(!!f, () => db.prepare(`SELECT * ${sql}${sort.length ? ` ORDER BY ${sort.join(', ')}` : ''} LIMIT ? OFFSET ?`)
        .all(...(f?.params ?? []), wanted === -1 ? page + 1 : Math.min(wanted, page + 1), skip)) as Record<string, string | number | null>[];
      const more = rows.length > page;
      const body: Record<string, unknown> = { '@odata.context': `${base}/$metadata#${set.name}(${out.map((x) => x.name).join(',')})` };
      if (/^true$/i.test(url.searchParams.get('$count') ?? '')) body['@odata.count'] = (db.prepare(`SELECT count(*) AS n ${sql}`).get(...(f?.params ?? [])) as { n: number }).n;
      body.value = rows.slice(0, page).map((r) => ({ '@odata.id': null, ...Object.fromEntries(out.map((x) => [x.name, toJson(r[x.field] ?? undefined, x.type)])) }));
      if (more) {
        const next = new URL(`${base}/${encodeURIComponent(set.name)}`);
        for (const [k, v] of url.searchParams) if (k !== '$skip' && k !== '$top' && k !== '$skiptoken') next.searchParams.set(k, v);
        next.searchParams.set('$skip', String(skip + page));
        if (top !== undefined) next.searchParams.set('$top', String(top - page));
        body['@odata.nextLink'] = next.toString();
      }
      if (pref) res.setHeader('preference-applied', `odata.maxpagesize=${page}`);
      set.info.owner.logRead(set.info.table, ids, { privileges: p });
      send(res, 200, body);
    } finally {
      db.close();
    }
  }

  /**
   * $crossjoin: the pairs (or triples) of records from `sets` that $filter keeps (see odata-crossjoin.ts). Conditions
   * on one set alone narrow that set's records in the store; the records are then put in tables of their own and
   * joined there, with only the columns the rest of $filter and $orderby name.
   */
  private async crossjoined(req: IncomingMessage, res: ServerResponse, url: URL, base: string, sets: EntitySet[], p: Privileges): Promise<void> {
    if (new Set(sets.map((s) => s.name)).size !== sets.length) throw bad('$crossjoin: name each entity set once');
    for (const [k] of url.searchParams) {
      if (!k.startsWith('$')) continue;
      if (!['$filter', '$orderby', '$top', '$skip', '$count', '$format', '$skiptoken', '$expand'].includes(k)) throw bad(`$crossjoin: ${k} is not supported here`);
    }
    const format = url.searchParams.get('$format');
    if (format && !/^(json|application\/json)/i.test(format)) throw new ODataError(501, '3', 'Only JSON is supported');
    const { top, skip, page, pref } = paging(req, url);
    const expand = crossjoinExpand(url.searchParams.get('$expand'), sets.map((s) => s.name));
    const filter = url.searchParams.get('$filter');
    const order = url.searchParams.get('$orderby');

    // Each condition that names one set alone (and not its ROWID) runs in the store, on that set's records.
    const own: string[][] = sets.map(() => []);
    const rest: string[] = [];
    const tokens = filter ? filterTokens(filter) : [];
    if (bareRowId(tokens)) throw bad('$crossjoin: name a record\'s ROWID as Set/ROWID', '102');
    if (!balanced(tokens)) throw bad('$filter: its parentheses don\'t pair up');
    for (const c of filter ? conjuncts(tokens) : []) {
      const ps = paths(c);
      const named = new Set(ps.map(([s]) => s.toLowerCase()));
      const one = named.size === 1 ? sets.findIndex((s) => named.has(s.name.toLowerCase())) : -1;
      if (one >= 0 && !ps.some(([, x]) => /^ROW(MOD)?ID$/i.test(x))) own[one].push(c.join(' '));
      else rest.push(c.join(' '));
    }
    const ids = sets.map((s, i) => {
      const f = own[i].length ? filterSql(own[i].map((x) => `(${x})`).join(' and '), s.props.map((x) => ({ ...x, name: `${s.name}/${x.name}` }))) : undefined;
      const found = s.info.owner.selectIds(s.info, { where: f?.where, params: f?.params, fields: f?.fields, privileges: p, limit: CROSSJOIN_LIMIT.records + 1 });
      if (found.length > CROSSJOIN_LIMIT.records) throw bad(`$crossjoin reads at most ${CROSSJOIN_LIMIT.records.toLocaleString('en-US')} records of each set and ${s.name} has more: narrow it in $filter with a condition on ${s.name} alone`);
      return found;
    });
    if (ids.reduce((n, x) => n * x.length, 1) > CROSSJOIN_LIMIT.pairs) {
      throw bad(`$crossjoin joins at most ${CROSSJOIN_LIMIT.pairs.toLocaleString('en-US')} combinations of records: narrow each set in $filter with conditions on it alone`);
    }

    // The columns the rest of $filter and $orderby name, as the properties filterSql and orderBy know.
    const wanted = new Set([...paths(filterTokens(rest.join(' and '))).map(([a, b]) => `${a}/${b}`.toLowerCase()),
      ...(order ? order.split(',').map((x) => x.trim().split(/\s+/)[0].toLowerCase()) : [])]);
    const columns = sets.map((s, i) => {
      const own: Prop[] = [{ name: `${s.name}/ROWID`, field: `t${i}_id`, type: 'number', edm: 'Edm.Decimal', queryable: true, writable: false }];
      s.props.forEach((x, j) => {
        if (x.queryable && wanted.has(`${s.name}/${x.name}`.toLowerCase())) own.push({ ...x, name: `${s.name}/${x.name}`, field: `t${i}_c${j}`, source: x.field } as Prop);
      });
      return own;
    });
    const props = columns.flat();
    // Each set's records as rows of the columns named, read a chunk at a time with other clients served between.
    let bytes = 0;
    const tables: JoinTable[] = [];
    for (const [i, s] of sets.entries()) {
      const cols = columns[i];
      const rows: SQLInputValue[][] = [];
      const names = cols.slice(1).map((x) => (x as Prop & { source: string }).source);
      if (!names.length) rows.push(...ids[i].map((id) => [id]));
      for (let k = 0; names.length && k < ids[i].length; k += 1000) {
        const chunk = ids[i].slice(k, k + 1000);
        for (const r of s.info.owner.getMany(s.info, chunk, chunk, { dateFormat: 'iso', privileges: p, fields: names })) {
          rows.push([r.recordId, ...cols.slice(1).map((x) => {
            const v = r.fieldData[(x as Prop & { source: string }).source];
            // Numbers as stored, so a condition reads them as it would on the set alone (CAST AS REAL).
            const kept = x.type === 'number' ? v ?? null : ((shown) => (shown === null ? null : x.type === 'timestamp' ? String(v) : shown))(toJson(v, x.type));
            if (typeof kept === 'string') bytes += kept.length;
            return typeof kept === 'boolean' ? (kept ? 1 : 0) : kept;
          })]);
        }
        if (bytes > CROSSJOIN_LIMIT.bytes) throw bad(`$crossjoin: the properties $filter and $orderby name hold more than ${(CROSSJOIN_LIMIT.bytes / 1e6).toLocaleString('en-US')} MB of text: narrow each set in $filter with conditions on it alone`);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      tables.push({ columns: cols.map((x) => ({ name: x.field, type: x.type })), rows });
    }
    {
      const f = rest.length ? filterSql(rest.join(' and '), props) : undefined;
      if (f && /\b_fm_(record|mod)_id\b/.test(f.where)) throw bad('$crossjoin: name a record\'s ROWID as Set/ROWID', '102');
      const sort = order ? orderBy(order, props).map((x) => ({ column: x.fieldName, type: props.find((y) => y.field === x.fieldName)!.type, desc: x.sortOrder === 'descend' })) : [];
      const limit = top === undefined ? page + 1 : Math.min(top, page + 1);
      const count = /^true$/i.test(url.searchParams.get('$count') ?? '');
      // The join and its sort run in a worker, stopped at the time limit, so no filter or sort can hold up other clients.
      const result = await crossJoin({ tables, where: f?.where, params: f?.params ?? [], sort, limit, skip, count, deadline: Date.now() + CROSSJOIN_LIMIT.ms });
      if ('refused' in result) throw bad(result.refused);
      const rows = result.rows.map((r) => Object.fromEntries(r.map((id, i) => [`i${i}`, id]))) as Record<string, number>[];
      const more = rows.length > page;
      const shown = rows.slice(0, page);

      const audit = new ReadAudit();
      for (const [i, set] of sets.entries()) audit.add(set.info.owner, set.info.table, shown.map((r) => r[`i${i}`]));

      // The records $expand puts inline, read once each.
      const inline = sets.map((s, i) => {
        if (!expand.has(s.name)) return undefined;
        const want = [...new Set(shown.map((r) => r[`i${i}`]))];
        const pick = selected(expand.get(s.name) ?? null, s);
        return new Map(s.info.owner.getMany(s.info, want, want, { dateFormat: 'iso', privileges: p }).map((r) => [r.recordId, {
          '@odata.etag': etag(r.modId), ROWID: r.recordId, ROWMODID: r.modId,
          ...Object.fromEntries(pick.map((x) => [x.name, toJson(r.fieldData[x.field], x.type)])),
        }]));
      });
      const body: Record<string, unknown> = { '@odata.context': `${base}/$metadata#Collection(Edm.ComplexType)` };
      if (count) body['@odata.count'] = result.count;
      body.value = shown.map((r) => Object.fromEntries(sets.map((s, i) => (inline[i]
        ? [s.name, inline[i]!.get(r[`i${i}`]) ?? null]
        : [`${s.name}@odata.navigationLink`, `${s.name}(${r[`i${i}`]})`]))));
      if (more) {
        const next = new URL(`${base}/$crossjoin(${sets.map((s) => encodeURIComponent(s.name)).join(',')})`);
        for (const [k, v] of url.searchParams) if (k !== '$skip' && k !== '$top' && k !== '$skiptoken') next.searchParams.set(k, v);
        next.searchParams.set('$skip', String(skip + page));
        if (top !== undefined) next.searchParams.set('$top', String(top - page));
        body['@odata.nextLink'] = next.toString();
      }
      if (pref) res.setHeader('preference-applied', `odata.maxpagesize=${page}`);
      audit.log(p);
      send(res, 200, body);
    }
  }

  /** Log only completed response rows: an expansion can exhaust its budget partway through the next row. */
  private logEntities(set: EntitySet, rows: Record<string, unknown>[], expand: Expansion[], p: Privileges): void {
    const audit = new ReadAudit();
    audit.add(set.info.owner, set.info.table, rows.map((r) => r.ROWID as number));
    for (const e of expand) {
      const related = rows.flatMap((r) => r[e.name] as Record<string, unknown>[]);
      audit.add(e.target.info.owner, e.target.info.table, related.map((r) => r.ROWID as number));
    }
    audit.log(p);
  }

  /** One record, as a list entry has it, with the related records `expand` asks for. */
  private entity(set: EntitySet, id: number, p: Privileges, expand: Expansion[] = [], budget: Budget = { left: EXPAND_LIMIT.records }): Record<string, unknown> {
    const [r] = set.info.owner.getMany(set.info, [id], [id], { dateFormat: 'iso', privileges: p });
    if (!r) throw new ODataError(404, '101', 'Record is missing');
    return {
      '@odata.etag': etag(r.modId), ROWID: r.recordId, ROWMODID: r.modId,
      ...Object.fromEntries(set.props.map((x) => [x.name, toJson(r.fieldData[x.field], x.type)])),
      ...this.withinLimit(() => this.expanded(set, id, expand, p, budget)),
    };
  }

  private withinLimit<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      throw e instanceof Exhausted ? exhausted() : e;
    }
  }

  /**
   * The records related to one record through a navigation property, as the account sees them: records it can't view
   * are left out, and so are fields it can't see. At most MAX_RELATED records are read for one record.
   */
  private related(set: EntitySet, id: number, e: Expansion, p: Privileges, budget: Budget): Record<string, unknown>[] {
    return this.relatedRecords(e, this.relatedIds(set, id, e, p, budget, Math.min(e.top ?? MAX_RELATED, MAX_RELATED)), p);
  }

  /**
   * The ids of the records related to one record through a navigation property that the account may view, after
   * the expansion's $filter, in its $orderby (else the relationship's) order: from e.skip, at most `take` of them.
   */
  private relatedIds(set: EntitySet, id: number, e: Expansion, p: Privileges, budget: Budget, take = Infinity): number[] {
    if (budget.left <= 0) throw new Exhausted();
    const owner = e.target.info.owner;
    const row = set.info.owner.row(set.info, id);
    if (e.filter || e.sort) {
      // Filtered or sorted: every match is read, then narrowed and ordered in SQL among the records the account may view.
      const all = relatedIdList(set.graph, set.toId, row, e.target.toId);
      if (!all) return [];
      budget.left -= all.ids.length;
      if (budget.left < 0) throw new Exhausted();
      const picked = filtered(!!e.filter, () => owner.selectIds(e.target.info, {
        where: `(${e.filter?.where ?? '1'}) AND _fm_record_id IN (SELECT value FROM json_each(?))`,
        params: [...(e.filter?.params ?? []), JSON.stringify(all.ids)],
        fields: e.filter?.fields, sort: e.sort, privileges: p,
      }));
      // Without $orderby they stay in the relationship's order.
      const keep = new Set(picked);
      return (e.sort ? picked : all.ids.filter((x) => keep.has(x))).slice(e.skip, e.skip + take);
    }
    // Records the account can't view are left out before paging, as in portals; then the whole match has to be read.
    const viewable = owner.limitsView(e.target.info.table, p) ? new Set(owner.viewableIds(e.target.info.table, p)) : undefined;
    const list = relatedIdList(set.graph, set.toId, row, e.target.toId, viewable || take === Infinity ? undefined : e.skip + take);
    if (!list) return [];
    budget.left -= list.ids.length;
    if (budget.left < 0) throw new Exhausted();
    return (viewable ? list.ids.filter((x) => viewable.has(x)) : list.ids).slice(e.skip, e.skip + take);
  }

  private relatedRecords(e: Expansion, ids: number[], p: Privileges): Record<string, unknown>[] {
    const records = e.target.info.owner.getMany(e.target.info, ids, ids, { dateFormat: 'iso', privileges: p });
    return records.map((r) => ({
      '@odata.etag': etag(r.modId), ROWID: r.recordId, ROWMODID: r.modId,
      ...Object.fromEntries(e.props.map((x) => [x.name, toJson(r.fieldData[x.field], x.type)])),
    }));
  }

  /** The related records `expand` asks for; throws Exhausted when they run past the budget. */
  private expanded(set: EntitySet, id: number, expand: Expansion[], p: Privileges, budget: Budget): Record<string, unknown> {
    return Object.fromEntries(expand.map((e) => [e.name, this.related(set, id, e, p, budget)]));
  }

  private async property(req: IncomingMessage, res: ServerResponse, base: string, set: EntitySet, id: number, name: string, value: string | undefined, p: Privileges, inBatch?: boolean): Promise<void> {
    if (value !== undefined && value !== '$value') throw new ODataError(404, '3', `"${value}" is not supported here`);
    const entity = this.entity(set, id, p);
    const prop = /^ROW(MOD)?ID$/i.test(name) ? undefined : set.props.find((x) => x.name === name) ?? set.props.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!prop && !/^ROW(MOD)?ID$/i.test(name)) throw new ODataError(404, '102', `There is no property "${name}"`);
    const key = prop?.name ?? name.toUpperCase();
    const v = entity[key];
    set.info.owner.logRead(set.info.table, [id], { privileges: p });
    if (value === undefined) return send(res, 200, { '@odata.context': `${base}/$metadata#${set.name}(${id})/${key}`, value: v });
    if (prop?.type === 'container') {
      // The file itself, which can be any size: not held in memory to go in a batch response.
      if (inBatch) throw bad('A container file is fetched on its own, not in a $batch', '3');
      const cid = set.info.owner.containerId(set.info, id, prop.field);
      if (cid === undefined) {
        res.writeHead(204, { 'odata-version': '4.0' }).end();
        return;
      }
      if (this.files) return this.files.send(req, res, set.info.owner, cid, { headers: { 'odata-version': '4.0' } });
      const file = set.info.owner.container(cid);
      if (!file) {
        res.writeHead(204, { 'odata-version': '4.0' }).end();
        return;
      }
      // Without the container service (the server always has one), the type is only the uploader's word: save it, never show it as this site.
      res.writeHead(200, {
        'content-type': file.mime, 'content-length': file.data.length, 'odata-version': '4.0', 'x-content-type-options': 'nosniff',
        'content-disposition': 'attachment', 'content-security-policy': "sandbox; default-src 'none'",
      }).end(file.data);
      return;
    }
    if (v === null) {
      res.writeHead(204, { 'odata-version': '4.0' }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(String(v)), 'x-content-type-options': 'nosniff', 'odata-version': '4.0', 'cache-control': 'no-store' }).end(String(v));
  }

  /** A request body's properties as field data. */
  private body(json: Record<string, unknown>, set: EntitySet): { data: Record<string, string | number>; files: Fill[] } {
    const data: Record<string, string | number> = {};
    const files: Fill[] = [];
    for (const [k, v] of Object.entries(json)) {
      if (k.includes('@') || /^ROW(MOD)?ID$/i.test(k)) continue;
      const prop = set.props.find((x) => x.name === k) ?? set.props.find((x) => x.name.toLowerCase() === k.toLowerCase());
      if (!prop) throw bad(`There is no property "${k}"`, '102');
      if (prop.fillable) {
        // A container: its file as base64, with the content type and file name as annotations; null empties it.
        const note = (name: string) => {
          const a = json[`${k}@com.filemaker.odata.${name}`] ?? json[`${k}@${name}`];
          return typeof a === 'string' && a ? a : undefined;
        };
        files.push({ field: prop.field, file: v === null ? null : fileOf(v, prop, note('ContentType'), note('Filename')) });
        continue;
      }
      if (!prop.writable) throw new ODataError(400, '201', `${prop.name} cannot be modified`);
      if (prop.type === 'json' && v !== null && typeof v === 'object') validateNativeJsonBody(json);
      if (prop.type === 'integer' && typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)) throw bad(`${prop.name}: integer is outside the safe range: ${jsonNumberSource(json, k) ?? String(v)}`, '500');
      data[prop.field] = fromJson(v, prop);
    }
    return { data, files };
  }

  /** Puts files in container fields, after the record's other fields are written. */
  private fill(set: EntitySet, id: number, files: Fill[], opts: { account: string; privileges: Privileges }): number | undefined {
    let modId: number | undefined;
    for (const f of files) modId = set.info.owner.setContainer(set.info, id, f.field, 1, f.file, opts).modId;
    return modId;
  }

  private async script(req: IncomingMessage, res: ServerResponse, store: Store, p: Privileges, name: string, via?: string): Promise<void> {
    // Claris form: Script.FMSID:<id> names the script by its id, so renaming it breaks no integration. A script really named that way still wins.
    const byId = /^FMSID:(\d+)$/i.exec(name);
    const found = store.schema.scripts.find((s) => s.name === name) ?? store.schema.scripts.find((s) => s.name.toLowerCase() === name.toLowerCase())
      ?? (byId ? store.schema.scripts.find((s) => s.id === Number(byId[1])) : undefined);
    if (!found) throw new ODataError(404, '104', `Script "${name}" is missing`);
    p.checkScript(found.name);
    const body = await readJson(req);
    const raw = body.scriptParameterValue;
    const parameter = raw === undefined || raw === null ? '' : typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : JSON.stringify(raw);
    const account = p.account;
    // One session per file, account and way of signing in, so $$ variables and AI state never cross hosted files or accounts.
    const key = [store.name.toLowerCase(), account.toLowerCase(), via ?? ''].join('\0');
    let session = this.sessions.get(key);
    if (!session) {
      if (this.sessions.size > 1000) {
        for (const old of this.sessions.values()) old.close();
        this.sessions.clear();
      }
      this.sessions.set(key, (session = new ScriptSession()));
    }
    const r = await runScript(store, found.name, { parameter, account, session, ...this.host.scriptOptions(store.name), executionAccount: account, executionVia: via, privileges: p });
    send(res, 200, { scriptResult: { code: r.error, resultParameter: r.result ?? '' } });
  }
}

/** A unit that wasn't run: every request in it gets the same answer. */
function skipped(unit: BatchUnit, answer: BatchAnswer): BatchResult {
  return { unit, answers: unit.requests.map(() => answer), ...(unit.atomic ? { failed: answer } : {}) };
}

/** Stands in for the ServerResponse of one request in a $batch, keeping what is written to it. */
class Captured extends Writable {
  statusCode = 200;
  headersSent = false;
  private readonly head: Record<string, string> = {};
  private readonly chunks: Buffer[] = [];

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.head[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    return this;
  }
  getHeader(name: string): string | undefined {
    return this.head[name.toLowerCase()];
  }
  removeHeader(name: string): void {
    delete this.head[name.toLowerCase()];
  }
  writeHead(status: number, headers?: Record<string, string | number | readonly string[]>): this {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers ?? {})) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  override _write(chunk: Buffer | string, _enc: BufferEncoding, done: (e?: Error | null) => void): void {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    done();
  }
  answer(): BatchAnswer {
    return { status: this.statusCode, headers: { ...this.head }, body: Buffer.concat(this.chunks) };
  }
}

/** What one file's service is signed in as, for a request and the requests of a $batch. */
interface Service {
  via?: string;
  store: Store;
  p: Privileges;
  readOnlyToken?: boolean;
  base: string;
  sets: EntitySet[];
  /** Answering one request of a $batch. */
  inBatch?: boolean;
}

/** Answers a failed request with an OData error. */
function fail(res: ServerResponse, e: unknown): void {
  const err = e instanceof ODataError ? e
    : e instanceof BatchError ? new ODataError(400, '3', e.message)
      : e instanceof ApiError ? new ODataError(e.status, String(e.code), e.message, e.retryAfter)
        : e instanceof StoreError || e instanceof PrivilegeError ? storeError(e)
          : e instanceof ScriptError ? new ODataError(400, String(e.code), e.message)
            : e instanceof URIError ? new ODataError(400, '3', 'The address has a malformed %-escape')
              : unexpected(e);
  if (res.headersSent) res.end();
  else {
    res.writeHead(err.status, {
      'content-type': 'application/json; charset=utf-8', 'odata-version': '4.0', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      ...(err.status === 401 ? { 'www-authenticate': 'Basic realm="tabularius OData", charset="UTF-8"' } : {}),
      ...(err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {}),
      ...(err.allow ? { allow: err.allow } : {}),
    }).end(JSON.stringify({ error: { code: err.code, message: err.message } }));
  }
}

/** A fault of the server's own: the client gets a plain message (SQLite and file-system errors name paths and tables), the log gets the cause. */
function unexpected(e: unknown): ODataError {
  logFault(e);
  return new ODataError(500, '-1', 'Unknown error');
}

/** A file for a container field, or null to empty it. */
interface Fill { field: string; file: { filename: string | null; mime: string; data: Uint8Array } | null }

/** The most a container file sent through OData may be; bigger ones go through the Data API's streamed upload. */
export const MAX_CONTAINER_BYTES = 64 * 1024 * 1024;

/** A media type as stored for a container: type/subtype only, else application/octet-stream. */
const mediaType = (v: string | undefined) => {
  const t = (v ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/.test(t) ? t : 'application/octet-stream';
};

/** A container's file from base64 in a JSON body. */
function fileOf(v: unknown, p: Prop, mime?: string, filename?: string): NonNullable<Fill['file']> {
  if (typeof v !== 'string' || !/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(v)) throw bad(`${p.name}: a container's file is sent as base64 (or null to empty it)`, '500');
  const data = Buffer.from(v, 'base64');
  if (data.length > MAX_CONTAINER_BYTES) throw new ODataError(413, '960', `${p.name}: files over ${MAX_CONTAINER_BYTES / 1024 / 1024} MB go through the Data API's container upload`);
  return { filename: filename ? filename.replace(/^.*[\\/]/, '') || null : null, mime: mediaType(mime), data: new Uint8Array(data) };
}

/** A container's file from a request body: its Content-Type, and a file name from Content-Disposition. */
async function upload(req: IncomingMessage, p: Prop): Promise<NonNullable<Fill['file']>> {
  const data = await readBody(req, MAX_CONTAINER_BYTES);
  if (!data.length) throw bad(`${p.name}: the body is the file (send DELETE to empty the field)`, '500');
  const disposition = String(req.headers['content-disposition'] ?? '');
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1];
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/.exec(disposition);
  let filename: string | null = plain?.[1] ?? plain?.[2] ?? null;
  if (star) {
    try {
      filename = decodeURIComponent(star.trim());
    } catch { /* keep the plain name */ }
  }
  const mime = mediaType(String(req.headers['content-type'] ?? ''));
  return { filename: filename ? filename.replace(/^.*[\\/]/, '') : null, mime, data: new Uint8Array(data) };
}

/** Runs fn as one transaction, unless one is already open (a $batch change set), which it then belongs to. */
function allOrNothing<T>(fn: () => T): T {
  if (writer.getStore()?.transaction?.open) return fn();
  const tx: Transaction = { files: new Map() };
  try {
    const r = writer.run({ ...(writer.getStore() ?? {}), transaction: { open: tx } }, fn);
    endTransaction(tx, true);
    return r;
  } catch (e) {
    endTransaction(tx, false);
    throw e;
  }
}

function storeError(e: StoreError | PrivilegeError): ODataError {
  const status = e.code === 212 ? 401 : e.code === 101 ? 404 : e.code === 9 || e.code === 200 || e.code === 201 ? 403
    : e.code === 301 ? 409 : e.code === 306 ? 412 : e.code === 105 ? 404 : 400;
  return new ODataError(status, String(e.code), e.message);
}

const ieee754Responses = new WeakSet<ServerResponse>();
const ieeeContext = new AsyncLocalStorage<{ requested: boolean; enabled: boolean }>();

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, ieeeContext.getStore()?.enabled ? (key, value: unknown) =>
    (key === 'ROWID' || key === 'ROWMODID' || key === '@odata.count') && typeof value === 'number' ? String(value) : value : undefined);
  res.writeHead(status, { 'content-type': `application/json; odata.metadata=minimal${ieee754Responses.has(res) || ieeeContext.getStore()?.enabled ? '; IEEE754Compatible=true' : ''}; charset=utf-8`, 'content-length': Buffer.byteLength(text), 'odata-version': '4.0', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    .end(text);
}

/** The methods that read: HEAD answers with GET's status and headers and no body. */
const READ_METHODS = 'GET, HEAD';

/** The `return` preference a request names (OData 4.0 section 8.2.8.7): the last of `return=minimal` and `return=representation` in Prefer. */
function returnPreference(req: IncomingMessage): 'minimal' | 'representation' | undefined {
  let want: 'minimal' | 'representation' | undefined;
  for (const m of String(req.headers.prefer ?? '').matchAll(/(?:^|[,\s])return\s*=\s*"?(minimal|representation)\b/gi)) want = m[1].toLowerCase() as 'minimal' | 'representation';
  return want;
}

const etag = (modId: number) => `W/"${modId}"`;

/** The modification id an If-Match header names; undefined for none or "*". */
function ifMatch(req: IncomingMessage): number | undefined {
  const h = String(req.headers['if-match'] ?? '').trim();
  if (!h || h === '*') return undefined;
  const m = /^(?:W\/)?"(\d+)"$/.exec(h);
  if (!m) throw bad('If-Match must be an ETag from this service or *', '500');
  return Number(m[1]);
}

/** The URL clients reached the server at, for links in responses. */
function origin(req: IncomingMessage, publicUrl?: string): string {
  const { proto, host } = requestOrigin(req, publicUrl);
  return `${proto}://${/^[\w.:[\]-]+$/.test(host) ? host : 'localhost'}`;
}
