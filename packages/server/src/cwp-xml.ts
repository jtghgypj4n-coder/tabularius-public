// Custom Web Publishing XML, the legacy way FileMaker Server answered scripts and web pages that asked for records as
// XML (help.claris.com, "FileMaker Server Custom Web Publishing with XML"). Reads only: nothing here changes a record,
// and no script is run.
//
//   GET /fmi/xml/fmresultset.xml?-db=Sales&-lay=Contacts&-findall&-max=20&-sortfield.1=Name
//   GET /fmi/xml/FMPXMLRESULT.xml?-db=Sales&-lay=Contacts&City=Oslo&City.op=eq
//   GET /fmi/xml/FMPXMLLAYOUT.xml?-db=Sales&-lay=Contacts&-view
//   GET /fmi/xml/fmresultset.xml?-dbnames   (also -layoutnames, -scriptnames with -db)
//
// Commands: -dbnames -layoutnames -scriptnames -find -findall -findany -findquery -view. Parameters: -db -lay -skip -max
// -sortfield.N -sortorder.N -lop -recid -query -qN -qN.value -lay.response, and field=value with field.op (eq cn bw ew gt
// gte lt lte neq). -new -edit -delete -dup are refused (error 3) and so is any -script parameter (9 when script access
// is denied, otherwise 960). The account signs in with HTTP Basic or an API token,
// as with OData, and its privilege set needs the fmxml extended privilege.
//
// Errors are answered in the grammar asked for, with HTTP 200, as that server did; only a missing or wrong sign-in is a
// 401 (with a Basic challenge).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { logFault } from './fault-log.ts';
import { StoreError, fieldDisplayTypes, fieldMetaData, type FindOptions, type FindRequest, type LayoutInfo, type Privileges, type SortSpec, type Store, type StoredRecord } from '../../store/src/index.ts';
import { esc } from '../../store/src/snippet-xml.ts';
import { ApiError, maxLimit, readBody, type DataApi } from './dataapi.ts';
import { listedFiles, refuseUnknownFile } from './file-list.ts';
import type { Host } from './host.ts';
import { signIn } from './sql.ts';
import { SERVER_VERSION } from './version.ts';

const PREFIX = '/fmi/xml/';
const GRAMMARS = ['fmresultset', 'FMPXMLRESULT', 'FMPXMLLAYOUT'] as const;
type Grammar = typeof GRAMMARS[number];

const READ_COMMANDS = ['dbnames', 'layoutnames', 'scriptnames', 'find', 'findall', 'findany', 'findquery', 'view'];
const WRITE_COMMANDS = ['new', 'edit', 'delete', 'dup'];
const OPERATORS = new Set(['eq', 'cn', 'bw', 'ew', 'gt', 'gte', 'lt', 'lte', 'neq']);
/** The date, time and timestamp formats the records are written in (the first two are the grammars' own attribute values). */
const DATE_FORMAT = 'MM/dd/yyyy';
const TIME_FORMAT = 'HH:mm:ss';
const STAMP_FORMAT = 'MM/dd/yyyy HH:mm:ss';
const MAX_BODY = 64 * 1024; // The database and command may be in this pre-authentication form.

class CwpError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** The query string and, for a POST, the form body: names matched without regard to case, in the order given. */
class Params {
  readonly pairs: [string, string][];
  constructor(pairs: [string, string][]) {
    this.pairs = pairs;
  }
  get(name: string): string | undefined {
    const n = name.toLowerCase();
    return this.pairs.find(([k]) => k.toLowerCase() === n)?.[1];
  }
}

function whole(v: string | undefined, name: string, fallback: number | undefined): number | undefined {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new CwpError(960, `Parameter is invalid: ${name}`);
  return n;
}

// --- What a request answers with, before it is written in one of the grammars.

/** A field as the grammars describe it. */
interface Def {
  name: string;
  type: string;
  result: string;
  global: boolean;
  autoEnter: boolean;
  fourDigitYear: boolean;
  maxRepeat: number;
  notEmpty: boolean;
  numeric: boolean;
  timeOfDay: boolean;
}

/** A record, or a portal row: a list of repetitions for each field of its definition. */
interface Row {
  recordId: number;
  modId: number;
  values: string[][];
}

interface Result {
  database: string;
  layout: string;
  table: string;
  total: number;
  found: number;
  defs: Def[];
  /** The portals (by the portal object's name), each with the definition of its rows. */
  portals: { name: string; table: string; defs: Def[] }[];
  records: (Row & { portalRows: Row[][] })[];
}

const text = (name: string): Def => ({ name, type: 'normal', result: 'text', global: false, autoEnter: false, fourDigitYear: false, maxRepeat: 1, notEmpty: false, numeric: false, timeOfDay: false });

function defOf(m: Record<string, unknown>, masked = false): Def {
  return {
    name: String(m.name), type: String(m.type), result: masked ? 'text' : String(m.result), global: !!m.global, autoEnter: !!m.autoEnter,
    fourDigitYear: !!m.fourDigitYear, maxRepeat: Number(m.maxRepeat) || 1, notEmpty: !!m.notEmpty, numeric: !!m.numeric, timeOfDay: !!m.timeOfDay,
  };
}

/** A list of names as a result: a column and a record for each. */
function listing(column: string, names: string[], database = ''): Result {
  return {
    database, layout: '', table: '', total: names.length, found: names.length, defs: [text(column)], portals: [],
    records: names.map((n) => ({ recordId: 0, modId: 0, values: [[n]], portalRows: [] })),
  };
}

// --- The grammars.

const yes = (b: boolean) => (b ? 'yes' : 'no');
const product = `build="" name="tabularius" version="${esc(SERVER_VERSION)}"`;

function fieldDefinition(d: Def): string {
  return `<field-definition auto-enter="${yes(d.autoEnter)}" four-digit-year="${yes(d.fourDigitYear)}" global="${yes(d.global)}" max-repeat="${d.maxRepeat}" name="${esc(d.name)}" not-empty="${yes(d.notEmpty)}" numeric-only="${yes(d.numeric)}" result="${esc(d.result)}" time-of-day="${yes(d.timeOfDay)}" type="${esc(d.type)}"/>`;
}

const data = (reps: string[], tag = 'data') => (reps.length ? reps : ['']).map((v) => `<${tag}>${esc(v)}</${tag}>`).join('');

function fieldValues(defs: Def[], row: Row): string {
  return defs.map((d, i) => `<field name="${esc(d.name)}">${data(row.values[i] ?? [])}</field>`).join('');
}

function fmresultset(r: Result, error = 0): string {
  const rows = r.records.map((rec) => {
    const related = r.portals.map((p, i) => {
      const portalRows = rec.portalRows[i] ?? [];
      return `<relatedset count="${portalRows.length}" table="${esc(p.table)}">${portalRows.map((x) => `<record mod-id="${x.modId}" record-id="${x.recordId}">${fieldValues(p.defs, x)}</record>`).join('')}</relatedset>`;
    }).join('');
    return `<record mod-id="${rec.modId}" record-id="${rec.recordId}">${fieldValues(r.defs, rec)}${related}</record>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<fmresultset xmlns="http://www.filemaker.com/xml/fmresultset" version="1.0">` +
    `<error code="${error}"/>` +
    `<product ${product}/>` +
    `<datasource database="${esc(r.database)}" date-format="${DATE_FORMAT}" layout="${esc(r.layout)}" table="${esc(r.table)}" time-format="${TIME_FORMAT}" timestamp-format="${STAMP_FORMAT}" total-count="${r.total}"/>` +
    `<metadata>${r.defs.map(fieldDefinition).join('')}${r.portals.map((p) => `<relatedset-definition table="${esc(p.table)}">${p.defs.map(fieldDefinition).join('')}</relatedset-definition>`).join('')}</metadata>` +
    `<resultset count="${r.found}" fetch-size="${r.records.length}">${rows}</resultset>` +
    `</fmresultset>`;
}

const FMP_TYPE: Record<string, string> = { text: 'TEXT', number: 'NUMBER', date: 'DATE', time: 'TIME', timeStamp: 'TIMESTAMP', container: 'CONTAINER', boolean: 'NUMBER', integer: 'NUMBER', decimal: 'NUMBER', json: 'TEXT', uuid: 'TEXT' };

function fmpxmlresult(r: Result, error = 0): string {
  // A portal's fields follow the record's own as columns of their own, with a DATA for each portal row.
  const columns = [...r.defs, ...r.portals.flatMap((p) => p.defs)];
  const meta = columns.map((d) => `<FIELD EMPTYOK="${d.notEmpty ? 'NO' : 'YES'}" MAXREPEAT="${d.maxRepeat}" NAME="${esc(d.name)}" TYPE="${FMP_TYPE[d.result] ?? 'TEXT'}"/>`).join('');
  const rows = r.records.map((rec) => {
    const own = r.defs.map((_, i) => `<COL>${data(rec.values[i] ?? [], 'DATA')}</COL>`).join('');
    const related = r.portals.flatMap((p, pi) => p.defs.map((_, fi) => {
      const rowsOfPortal = rec.portalRows[pi] ?? [];
      return `<COL>${rowsOfPortal.length ? rowsOfPortal.map((x) => `<DATA>${esc(x.values[fi]?.[0] ?? '')}</DATA>`).join('') : '<DATA></DATA>'}</COL>`;
    })).join('');
    return `<ROW MODID="${rec.modId}" RECORDID="${rec.recordId}">${own}${related}</ROW>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<FMPXMLRESULT xmlns="http://www.filemaker.com/fmpxmlresult">` +
    `<ERRORCODE>${error}</ERRORCODE>` +
    `<PRODUCT BUILD="" NAME="tabularius" VERSION="${esc(SERVER_VERSION)}"/>` +
    `<DATABASE DATEFORMAT="${DATE_FORMAT}" LAYOUT="${esc(r.layout)}" NAME="${esc(r.database)}" RECORDS="${r.total}" TIMEFORMAT="${TIME_FORMAT}"/>` +
    `<METADATA>${meta}</METADATA>` +
    `<RESULTSET FOUND="${r.found}">${rows}</RESULTSET>` +
    `</FMPXMLRESULT>`;
}

/** How a layout shows a field, in FMPXMLLAYOUT's words. */
const STYLE: Record<string, string> = { editText: 'EDITTEXT', secureText: 'EDITTEXT', popupList: 'POPUPLIST', popupMenu: 'POPUPMENU', checkBox: 'CHECKBOX', radioButtons: 'RADIOBUTTONS', calendar: 'CALENDAR' };

interface LayoutDoc {
  database: string;
  layout: string;
  fields: { name: string; style: string; valueList?: string }[];
  valueLists: { name: string; values: string[] }[];
}

function fmpxmllayout(l: LayoutDoc, error = 0): string {
  const fields = l.fields.map((f) => `<FIELD NAME="${esc(f.name)}"><STYLE TYPE="${f.style}" VALUELIST="${esc(f.valueList ?? '')}"/></FIELD>`).join('');
  const lists = l.valueLists.map((v) => `<VALUELIST NAME="${esc(v.name)}">${v.values.map((x) => `<VALUE>${esc(x)}</VALUE>`).join('')}</VALUELIST>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` +
    `<FMPXMLLAYOUT xmlns="http://www.filemaker.com/fmpxmllayout">` +
    `<ERRORCODE>${error}</ERRORCODE>` +
    `<PRODUCT BUILD="" NAME="tabularius" VERSION="${esc(SERVER_VERSION)}"/>` +
    `<LAYOUT DATABASE="${esc(l.database)}" NAME="${esc(l.layout)}">${fields}</LAYOUT>` +
    `<VALUELISTS>${lists}</VALUELISTS>` +
    `</FMPXMLLAYOUT>`;
}

/** An answer that is only an error code, in the grammar asked for. */
function errorDocument(grammar: Grammar, code: number, database = '', layout = ''): string {
  if (grammar === 'FMPXMLLAYOUT') return fmpxmllayout({ database, layout, fields: [], valueLists: [] }, code);
  const empty: Result = { database, layout, table: '', total: 0, found: 0, defs: [], portals: [], records: [] };
  return grammar === 'FMPXMLRESULT' ? fmpxmlresult(empty, code) : fmresultset(empty, code);
}

// --- Reading the request.

/** The one query command a request names. */
function commandOf(params: Params): string {
  const named = [...new Set(params.pairs.map(([k]) => k.toLowerCase()).filter((k) => k.startsWith('-')).map((k) => k.slice(1)).filter((k) => READ_COMMANDS.includes(k) || WRITE_COMMANDS.includes(k)))];
  if (!named.length) throw new CwpError(4, 'Command is unknown: name a query command such as -findall');
  if (named.length > 1) throw new CwpError(957, `Conflicting query commands: ${named.map((n) => '-' + n).join(', ')}`);
  if (WRITE_COMMANDS.includes(named[0])) throw new CwpError(3, `Command is unavailable: -${named[0]} would change records, and this interface only reads`);
  return named[0];
}

/** The sort order of -sortfield.N / -sortorder.N, N from 1 to 9. */
function sortOf(params: Params, info: LayoutInfo): SortSpec[] | undefined {
  const out: SortSpec[] = [];
  for (let n = 1; n <= 9; n++) {
    const field = params.get(`-sortfield.${n}`);
    if (field === undefined || field === '') continue;
    const order = params.get(`-sortorder.${n}`);
    out.push({ fieldName: fieldNamed(info, field), sortOrder: order === undefined || order === '' ? 'ascend' : order });
  }
  return out.length ? out : undefined;
}

/** A field's name as the layout's table spells it (names match without regard to case); other names are left for the find to refuse. */
function fieldNamed(info: LayoutInfo, name: string): string {
  if (name.includes('::')) return name;
  return info.fields.find((f) => f.name === name)?.name ?? info.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.name ?? name;
}

/** A find request that takes the records it matches out of the found set. */
const omitting = (criteria: Record<string, string>): FindRequest => ({ ...criteria, omit: true } as FindRequest);

/** What -find's field=value pairs (and field.op) ask for, as find requests. */
function findRequests(params: Params, info: LayoutInfo): FindRequest[] {
  const lop = (params.get('-lop') ?? 'and').toLowerCase();
  if (lop !== 'and' && lop !== 'or') throw new CwpError(960, 'Parameter is invalid: -lop (and or or)');
  const ops = new Map<string, string>();
  const asked: [string, string][] = [];
  for (const [key, value] of params.pairs) {
    if (key.startsWith('-')) continue;
    const op = /^(.+)\.op$/i.exec(key);
    if (op) {
      if (!OPERATORS.has(value.toLowerCase())) throw new CwpError(960, `Parameter is invalid: ${key} (${[...OPERATORS].join(', ')})`);
      ops.set(op[1].toLowerCase(), value.toLowerCase());
    } else if (value !== '') asked.push([key, value]);
  }
  if (!asked.length) throw new CwpError(958, 'Parameter missing: -find needs a field name and the value to look for');
  const includes: FindRequest[] = [];
  const omits: FindRequest[] = [];
  const together: FindRequest = {};
  for (const [key, value] of asked) {
    const op = ops.get(key.toLowerCase()) ?? 'bw';
    const field = fieldNamed(info, key);
    if (op === 'neq') {
      if (lop === 'or') throw new CwpError(960, `Parameter is invalid: ${key}.op=neq can't be combined with -lop=or`);
      omits.push(omitting({ [field]: `==${value}` }));
      continue;
    }
    const criterion = op === 'eq' ? `==${value}` : op === 'cn' ? `*${value}*` : op === 'ew' ? `*${value}` : op === 'gt' ? `>${value}` : op === 'gte' ? `>=${value}` : op === 'lt' ? `<${value}` : op === 'lte' ? `<=${value}` : value;
    if (lop === 'or') includes.push({ [field]: criterion });
    else if (field in together) throw new CwpError(960, `Parameter is invalid: ${key} is given twice with -lop=and`);
    else together[field] = criterion;
  }
  // The includes first, then each omit takes its records out of what was found.
  return lop === 'or' ? includes : [together, ...omits];
}

/** -findquery's -query=(q1,q2);(q3);!(q4): commas and, semicolons or, and a leading ! omits. Each qN is -qN=field with -qN.value. */
function queryRequests(params: Params, info: LayoutInfo): FindRequest[] {
  const query = params.get('-query');
  if (query === undefined || query === '') throw new CwpError(958, 'Parameter missing: -query');
  if (!/^\s*!?\([^()]*\)(\s*;\s*!?\([^()]*\))*\s*$/.test(query)) throw new CwpError(960, 'Parameter is invalid: -query (as (q1,q2);(q3);!(q4))');
  return [...query.matchAll(/(!?)\(([^()]*)\)/g)].map(([, omit, inner]) => {
    const request: Record<string, string> = {};
    for (const raw of inner.split(',')) {
      const q = raw.trim();
      if (!/^q\d+$/i.test(q)) throw new CwpError(960, `Parameter is invalid: -query names "${q}", not a -qN`);
      const field = params.get(`-${q}`);
      const value = params.get(`-${q}.value`);
      if (!field) throw new CwpError(958, `Parameter missing: -${q}`);
      if (value === undefined) throw new CwpError(958, `Parameter missing: -${q}.value`);
      const name = fieldNamed(info, field);
      if (name in request) throw new CwpError(960, `Parameter is invalid: ${field} is used twice in one group of -query`);
      request[name] = value;
    }
    return omit ? omitting(request) : request;
  });
}

// --- Describing a layout.

type Design = NonNullable<ReturnType<Store['design']>>;

/** The fields a layout shows, as the account may see them, in the order the layout places them. */
function layoutFields(store: Store, info: LayoutInfo, p: Privileges, design: Design | undefined): { defs: Def[]; styles: Map<string, string> } {
  const placed = design ? fieldDisplayTypes(design.objects, info.occurrence) : undefined;
  const own = info.owner.schema.tables.find((t) => t.name === info.table);
  const access = p.in(info.owner);
  const names = placed
    ? [...placed.keys()].filter((k) => !k.includes('::')).flatMap((k) => info.fields.filter((f) => f.name.toLowerCase() === k).map((f) => f.name))
    : info.fields.map((f) => f.name);
  const styles = new Map<string, string>();
  const defs: Def[] = [];
  for (const name of names) {
    const level = access.fieldAccess(info.table, name);
    if (level === 'none') continue;
    const display = placed?.get(name.toLowerCase()) ?? 'editText';
    defs.push(defOf(fieldMetaData(name, own?.fields.find((x) => x.name === name), display), level === 'masked'));
    styles.set(name, display);
  }
  // Fields from other tables placed outside a portal show the first related record's value.
  for (const r of info.plan?.related ?? []) {
    for (const f of r.fields) {
      const d = relatedDef(store, p, r.occurrence, f, placed?.get(`${r.occurrence}::${f}`.toLowerCase()));
      if (d) { defs.push(d); styles.set(d.name, placed?.get(d.name.toLowerCase()) ?? 'editText'); }
    }
  }
  return { defs, styles };
}

/** A related field as the account may see it; undefined when it is hidden or its file is not hosted. */
function relatedDef(store: Store, p: Privileges, occurrence: string, field: string, display?: string): Def | undefined {
  try {
    const o = store.occurrence(occurrence);
    const level = p.in(o.owner).fieldAccess(o.table, field);
    if (level === 'none') return undefined;
    const def = o.owner.schema.tables.find((t) => t.name === o.table)?.fields.find((f) => f.name === field);
    return defOf(fieldMetaData(`${occurrence}::${field}`, def, display ?? 'editText'), level === 'masked');
  } catch {
    return undefined;
  }
}

/** The repetitions of a field in a record's (or portal row's) data: "Name", "Name(2)", ... */
function repetitions(source: Record<string, unknown>, name: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const v = source[i === 1 ? name : `${name}(${i})`];
    out.push(v === undefined || v === null ? '' : String(v));
  }
  return out;
}

export class CwpXmlEndpoint {
  private readonly host: Host;
  private readonly api: DataApi;
  private readonly verified = new Map<string, number>();

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  /** Returns false when the request is not for the XML interface. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith(PREFIX)) return false;
    const name = url.pathname.slice(PREFIX.length);
    // Only the grammars' documents: a file name below it (container data in the old server) is not here.
    if (!/^[^/]+\.xml$/i.test(name)) return false;
    const grammar = GRAMMARS.find((g) => `${g}.xml`.toLowerCase() === name.toLowerCase());
    let database = '';
    let layout = '';
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') throw new CwpError(3, 'Command is unavailable: use GET or POST');
      if (!grammar) throw new CwpError(954, `Unsupported XML grammar: ${name}. This server answers ${GRAMMARS.map((g) => g + '.xml').join(', ')}`);
      const params = await this.params(req, url);
      database = params.get('-db') ?? '';
      layout = params.get('-lay') ?? '';
      const body = await this.answer(req, params, grammar);
      this.send(res, 200, body);
    } catch (e) {
      this.fail(res, e, grammar ?? 'fmresultset', database, layout);
    }
    return true;
  }

  private async params(req: IncomingMessage, url: URL): Promise<Params> {
    const pairs = [...url.searchParams.entries()];
    if (req.method === 'POST') {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type && type !== 'application/x-www-form-urlencoded') throw new CwpError(960, 'Send the parameters in the address or as a form (application/x-www-form-urlencoded)');
      pairs.push(...new URLSearchParams((await readBody(req, MAX_BODY)).toString('utf8')).entries());
    }
    return new Params(pairs);
  }

  private async answer(req: IncomingMessage, params: Params, grammar: Grammar): Promise<string> {
    const command = commandOf(params);
    const scripts = params.pairs.filter(([k]) => /^-script(\.|=|$)/i.test(k));
    const refuseScripts = () => { throw new CwpError(960, 'Parameter is invalid: scripts are not run through this read-only interface'); };
    if (grammar === 'FMPXMLLAYOUT' && command !== 'view') throw new CwpError(954, `Unsupported XML grammar: FMPXMLLAYOUT answers -view; use fmresultset or FMPXMLRESULT for -${command}`);
    const render = (r: Result) => (grammar === 'FMPXMLRESULT' ? fmpxmlresult(r) : fmresultset(r));

    if (command === 'dbnames') {
      if (scripts.length) refuseScripts();
      const names = listedFiles(this.host);
      if (!names) throw new CwpError(3, 'Command is unavailable: this server does not list its files; name the file with -db');
      return render(listing('DATABASE_NAME', names));
    }

    const db = params.get('-db');
    if (!db) throw new CwpError(955, 'Database name is missing: give -db');
    const store = this.host.get(db);
    if (!store) {
      await refuseUnknownFile(this.host, req);
      throw new CwpError(802, `Unable to open file "${db}"`);
    }
    const { privileges: p } = await signIn(req, store, this.api, this.verified, 'fmxml', 'XML publishing');
    if (scripts.length) {
      for (const [key, name] of scripts) {
        if (['-script', '-script.prefind', '-script.presort'].includes(key.toLowerCase()) && p.script(name) === 'none') {
          throw new CwpError(9, `Insufficient privileges to run script "${name}"`);
        }
      }
      refuseScripts();
    }

    if (command === 'layoutnames') {
      return render(listing('LAYOUT_NAME', store.layouts().map((l) => l.name).filter((n) => p.layout(n).layout !== 'none'), store.name));
    }
    if (command === 'scriptnames') {
      return render(listing('SCRIPT_NAME', store.schema.scripts.map((s) => s.name).filter((n) => p.script(n) !== 'none'), store.name));
    }

    const lay = params.get('-lay');
    if (!lay) throw new CwpError(105, 'Layout is missing: give -lay');
    if (p.layout(lay).layout === 'none') throw new CwpError(105, `Layout "${lay}" is missing`);
    const info = store.layout(lay);

    if (command === 'view') {
      if (grammar === 'FMPXMLLAYOUT') return fmpxmllayout(this.layoutDoc(store, info, p));
      return render(this.describe(store, info, p));
    }
    return render(this.records(store, info, p, params, command));
  }

  /** Finds the records for -find, -findall, -findany and -findquery, and describes them. */
  private records(store: Store, info: LayoutInfo, p: Privileges, params: Params, command: string): Result {
    const skip = whole(params.get('-skip'), '-skip', 0)!;
    const cap = maxLimit() || Number.MAX_SAFE_INTEGER;
    const asked = params.get('-max');
    // -max defaults to every record found; the server's own cap on a request (TABULARIUS_DATA_API_MAX_LIMIT) still applies, and the
    // resultset's count (found) against its fetch-size (returned) shows when it did.
    const limit = Math.min(cap, asked === undefined || asked === '' || asked.toLowerCase() === 'all' ? cap : whole(asked, '-max', cap)!);
    const sort = sortOf(params, info);
    const shown = this.responseLayout(store, info, p, params.get('-lay.response'));
    const opts: FindOptions = { sort, offset: skip + 1, limit, dateFormat: 'us', privileges: p, layoutOnly: true };

    let found: { records: StoredRecord[]; foundCount: number; totalCount: number };
    if (command === 'findall') {
      found = store.find(info, opts);
    } else if (command === 'findany') {
      const count = store.find(info, { privileges: p, limit: 0 }).totalCount;
      found = count ? { ...store.find(info, { ...opts, sort: undefined, offset: 1 + Math.floor(Math.random() * count), limit: 1 }), foundCount: 1 } : { records: [], foundCount: 0, totalCount: 0 };
    } else {
      const recid = params.get('-recid');
      if (command === 'find' && recid !== undefined && recid !== '') {
        const id = whole(recid, '-recid', undefined)!;
        const record = store.get(info.name, id, 'us', undefined, p, { layoutOnly: true });
        found = { records: [record], foundCount: 1, totalCount: store.find(info, { privileges: p, limit: 0 }).totalCount };
      } else {
        const query = command === 'findquery' ? queryRequests(params, info) : findRequests(params, info);
        found = store.find(info, { ...opts, query });
      }
    }
    if (!found.foundCount) throw new CwpError(401, 'No records match the request');
    const records = shown.name === info.name ? found.records : found.records.map((x) => store.get(shown.name, x.recordId, 'us', undefined, p, { layoutOnly: true }));
    store.logRead(info.table, records.map((x) => x.recordId), { account: p.account, privileges: p });
    const shape = this.describe(store, shown, p);
    return { ...shape, total: found.totalCount, found: found.foundCount, records: records.map((x) => this.rowOf(x, shape)) };
  }

  /** The layout that records are written with: -lay.response when given (and over the same table), else the one asked for. */
  private responseLayout(store: Store, info: LayoutInfo, p: Privileges, name: string | undefined): LayoutInfo {
    if (name === undefined || name === '') return info;
    if (p.layout(name).layout === 'none') throw new CwpError(105, `Layout "${name}" is missing`);
    const shown = store.layout(name);
    if (shown.owner !== info.owner || shown.table !== info.table) throw new CwpError(960, 'Parameter is invalid: -lay.response (it must show the same table as -lay)');
    return shown;
  }

  /** The layout's fields and portals, with no records: the metadata of every answer. */
  private describe(store: Store, info: LayoutInfo, p: Privileges): Result {
    const design = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
    const { defs } = layoutFields(store, info, p, design);
    const portals = (info.plan?.portals ?? []).map((portal) => ({
      name: portal.name,
      table: portal.occurrence,
      defs: portal.fields.flatMap((f) => relatedDef(store, p, portal.occurrence, f) ?? []),
    }));
    return { database: store.name, layout: info.name, table: info.occurrence, total: 0, found: 0, defs, portals, records: [] };
  }

  /** A record as the grammars show it: the layout's fields (all their repetitions), then its portals' rows. */
  private rowOf(record: StoredRecord, shape: Result): Result['records'][number] {
    const data = record.fieldData as Record<string, unknown>;
    return {
      recordId: record.recordId, modId: record.modId,
      values: shape.defs.map((d) => repetitions(data, d.name, d.maxRepeat)),
      portalRows: shape.portals.map((portal) => (record.portalData?.[portal.name] ?? []).map((row) => ({
        recordId: Number(row.recordId), modId: Number(row.modId),
        values: portal.defs.map((d) => repetitions(row as Record<string, unknown>, d.name, d.maxRepeat)),
      }))),
    };
  }

  /** -view in FMPXMLLAYOUT: the fields the layout shows, how, and the value lists they use. */
  private layoutDoc(store: Store, info: LayoutInfo, p: Privileges): LayoutDoc {
    const design = info.layoutId !== undefined ? store.design(info.layoutId) : undefined;
    const { defs, styles } = layoutFields(store, info, p, design);
    // The value list each field uses (by the first place it is on the layout).
    const used = new Map<string, number>();
    const walk = (objects: NonNullable<Design['objects']>) => {
      for (const o of objects) {
        const f = o.field;
        if (f?.field && f.valueListId) {
          const own = f.tableOccurrence === undefined || f.tableOccurrence.toLowerCase() === info.occurrence.toLowerCase();
          const key = own ? f.field : `${f.tableOccurrence}::${f.field}`;
          if (!used.has(key.toLowerCase())) used.set(key.toLowerCase(), f.valueListId);
        }
        if (o.children) walk(o.children);
      }
    };
    if (design) walk(design.objects);
    const lists = store.schema.valueLists.filter((v) => [...used.values()].includes(v.id) && (v.values || v.external || (v.field && v.field.relatedFromId === undefined)) && p.valueList(v.name) !== 'none');
    const listed = new Set(lists.map((v) => v.id));
    return {
      database: store.name,
      layout: info.name,
      fields: defs.map((d) => {
        const id = used.get(d.name.toLowerCase());
        const list = id !== undefined && listed.has(id) ? store.schema.valueLists.find((v) => v.id === id)?.name : undefined;
        return { name: d.name, style: STYLE[styles.get(d.name) ?? 'editText'] ?? 'EDITTEXT', ...(list ? { valueList: list } : {}) };
      }),
      valueLists: lists.map((v) => ({ name: v.name, values: store.valueListItems(v.id, undefined, p).map((x) => x.value) })),
    };
  }

  private send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }).end(body);
  }

  /** Every failure is an error code in the grammar asked for; a refused sign-in is also a 401 with the Basic challenge. */
  private fail(res: ServerResponse, e: unknown, grammar: Grammar, database: string, layout: string): void {
    let code = 951;
    let status = 200;
    const headers: Record<string, string> = {};
    if (e instanceof CwpError) code = e.code;
    else if (e instanceof ApiError) {
      code = e.code;
      if (e.status === 401 || e.retryAfter) status = e.status;
      if (e.status === 401) headers['www-authenticate'] = 'Basic realm="tabularius XML", charset="UTF-8"';
      if (e.retryAfter) headers['retry-after'] = String(e.retryAfter);
    } else if (e instanceof StoreError) code = e.code;
    else {
      // The server's own fault: 951 for the caller, the cause in the log.
      logFault(e);
      status = 500;
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    this.send(res, status, errorDocument(grammar, code, database, layout), headers);
  }
}
