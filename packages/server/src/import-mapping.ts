// Importing a spreadsheet the easy way: drop a CSV or Excel file and its columns are matched to the layout's fields
// (by name, by what the values look like, or by the assistant), with fixes for each column's format (dates written
// day-first, "$1,200.00", "yes"/"no", values that should match a value list), a preview of what each row becomes,
// rows that look like records already in the file (or earlier in the same file), and the import kept as one step
// that can be undone. One column can go into several fields: a full name split into first, middle and last, or
// "Springfield, IL 62704" into city, state and ZIP.

import { randomBytes } from 'node:crypto';
import { PendingApprovalError, PrivilegeError, StoreError, stripFormulaGuard, writer, type Privileges, type Store } from '../../store/src/index.ts';
import { q } from '../../store/src/import.ts';
import { excelDate } from '../../scripts/src/index.ts';
import { redactSecrets, secretName } from './ai-output.ts';
import { CleanupError, journalFieldChange, snapshotFields, undoCleanup } from './cleanup.ts';
import { layoutProfile } from './insight.ts';

export type Cell = string | number;

/** Fixes a column's values can get on the way in. */
export const TRANSFORMS = ['trim', 'number', 'date-mdy', 'date-dmy', 'date-ymd', 'excel-date', 'time', 'yes-no', 'value-list', 'upper', 'lower', 'title-case', 'digits', 'phone',
  'name-first', 'name-middle', 'name-last', 'city', 'state', 'postcode'] as const;
export type Transform = (typeof TRANSFORMS)[number];

/** Fixes that take one part of a column's value, so the column can go into several fields. */
export const PARTS = ['name-first', 'name-middle', 'name-last', 'city', 'state', 'postcode'] as const satisfies readonly Transform[];
export type Part = (typeof PARTS)[number];
const isPart = (t: string): t is Part => (PARTS as readonly string[]).includes(t);
const isTransform = (t: string): t is Transform => (TRANSFORMS as readonly string[]).includes(t);

/** Each field from one entry only, the first: a later one going into the same field isn't imported. */
function oneEach<C extends { field: string | null; transforms: Transform[] }>(columns: C[]): C[] {
  const seen = new Set<string>();
  return columns.map((c) => {
    if (!c.field) return c;
    if (seen.has(c.field)) return { ...c, field: null, transforms: c.transforms.filter(isPart) };
    seen.add(c.field);
    return c;
  });
}

/** A column's fixes as given (by a person or the assistant): known ones, and at most one part. */
function cleanFixes(given: readonly string[] | undefined): Transform[] {
  const fixes = [...new Set((given ?? []).filter(isTransform))];
  const part = fixes.find(isPart);
  const dates = fixes.filter((t) => t.startsWith('date-'));
  return fixes.filter((t) => (!isPart(t) || t === part) && (!t.startsWith('date-') || t === dates[0]));
}

export interface ImportField {
  name: string;
  type: string;
  valueList?: string;
  values?: string[];
  /** A global field: one value for every record, so records can't be matched on it. */
  global?: true;
}

export interface ColumnMap {
  /** 0-based column in the file. */
  column: number;
  /** The first row's text when it holds names, else "Column 3". */
  header: string;
  /** The field it goes into, or null for not imported. */
  field: string | null;
  transforms: Transform[];
  /** Why it was matched, in a few words. */
  why?: string;
  by?: 'name' | 'values' | 'order' | 'ai' | 'person';
  /** A few of its values, as in the file. */
  sample: string[];
}

export interface PreviewRow {
  /** 1-based row in the file. */
  row: number;
  values: Record<string, Cell>;
  issues: string[];
  duplicate?: { of: 'existing'; recordId: number } | { of: 'file'; row: number };
}

export interface ImportPlan {
  layout: string;
  table: string;
  rows: number;
  headerRow: boolean;
  fields: ImportField[];
  columns: ColumnMap[];
  /** Fields that say two rows are the same record (an email, a code, an id); empty: duplicates aren't checked. */
  keys: string[];
  preview: PreviewRow[];
  summary: { ready: number; withIssues: number; duplicatesInFile: number; duplicatesExisting: number };
  ai?: { used: boolean; note?: string };
}

/** The assistant's matching, when it is on: given the file's columns and the fields, a field and fixes for each column. */
export type ImportMapper = (input: MapperInput, signal?: AbortSignal) => Promise<{ columns: { column: number; field: string | null; transforms?: string[]; why?: string }[]; keys?: string[] } | undefined>;
export interface MapperInput {
  layout: string;
  table: string;
  fields: ImportField[];
  columns: { column: number; header: string; sample: string[] }[];
}

export class ImportError extends Error {}

/** Fields of the layout's table that a row can go into, for this account. */
export function importFields(store: Store, layout: string, privileges?: Privileges): ImportField[] {
  const info = store.layout(layout);
  const pv = privileges?.in(info.owner);
  const ok = new Set(info.fields.filter((f) => !f.calculated && !f.summary && f.type !== 'container' && (!pv || pv.field(info.table, f.name) === 'modifiable')).map((f) => f.name));
  const profile = new Map(layoutProfile(store, layout, { sample: false, privileges }).fields.map((f) => [f.name, f]));
  const defs = info.owner.schema.tables.find((t) => t.name === info.table)?.fields ?? [];
  return info.fields.filter((f) => ok.has(f.name)).map((f) => {
    const p = profile.get(f.name);
    const global = defs.find((d) => d.name === f.name)?.options?.global;
    return { name: f.name, type: f.type, ...(p?.valueList ? { valueList: p.valueList } : {}), ...(p?.values?.length ? { values: p.values } : {}), ...(global ? { global: true as const } : {}) };
  });
}

const squash = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// Names people give the same thing.
const SAME: string[][] = [
  ['email', 'emailaddress', 'mail', 'eaddress'],
  ['phone', 'telephone', 'tel', 'phonenumber', 'mobile', 'cell', 'cellphone'],
  ['zip', 'zipcode', 'postcode', 'postalcode', 'postal'],
  ['firstname', 'first', 'givenname', 'forename', 'namefirst'],
  ['lastname', 'last', 'surname', 'familyname', 'namelast'],
  ['company', 'companyname', 'organisation', 'organization', 'business', 'employer', 'account'],
  ['state', 'province', 'region', 'county'],
  ['city', 'town', 'locality', 'suburb'],
  ['address', 'street', 'streetaddress', 'address1', 'addressline1'],
  ['country', 'nation'],
  ['notes', 'note', 'comments', 'comment', 'remarks'],
  ['amount', 'total', 'value', 'price'],
  ['date', 'day'],
  ['id', 'number', 'no', 'code', 'ref', 'reference'],
];
const synonyms = (s: string) => SAME.find((g) => g.includes(s)) ?? [s];

/** Whether the first row names the columns: text where the rows below hold numbers or dates, or a name a field has. */
export function hasHeaderRow(rows: Cell[][], fields: ImportField[]): boolean {
  if (rows.length < 1) return false;
  const first = rows[0];
  if (first.some((v) => typeof v === 'number')) return false;
  const names = new Set(fields.map((f) => squash(f.name)));
  if (first.some((v) => names.has(squash(String(v))))) return true;
  // Mostly names people use for a field ("Tel" for Phone) or for a column of names or places to split, and nothing
  // that looks like data (a digit, an email): "Ann Lee, Cell, 555-123-4567" is a record, not a header.
  const cells = first.map((v) => String(v).trim()).filter((v) => v !== '');
  const known = new Set(fields.flatMap((f) => synonyms(squash(f.name))));
  const named = cells.filter((v) => known.has(squash(v)) || FULL_NAME.has(squash(v)) || PLACE.has(squash(v)));
  if (cells.length && named.length * 2 > cells.length && !cells.some((v) => /[\d@]/.test(v))) return true;
  const body = rows.slice(1, 20);
  return first.some((v, i) => String(v).trim() !== '' && body.length > 0 && body.every((r) => typeof r[i] === 'number' || looksLikeDate(String(r[i] ?? '')) || String(r[i] ?? '') === ''))
    && !first.some((v) => looksLikeDate(String(v)));
}

function looksLikeDate(s: string): boolean {
  return /^\s*(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(\s|T|$)/.test(s);
}

/** A field for each column, from its name or its values, before anyone (or the assistant) looks. */
export function matchColumns(rows: Cell[][], fields: ImportField[], headerRow: boolean): ColumnMap[] {
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const body = headerRow ? rows.slice(1) : rows;
  const taken = new Set<string>();
  const out: ColumnMap[] = [];
  for (let i = 0; i < width; i++) {
    const header = headerRow ? String(rows[0][i] ?? '').trim() : '';
    const sample = body.map((r) => String(r[i] ?? '')).filter((v) => v.trim() !== '').slice(0, 5);
    out.push({ column: i, header: header || `Column ${i + 1}`, field: null, transforms: [], sample });
  }
  const free = () => fields.filter((f) => !taken.has(f.name));
  const take = (c: ColumnMap, f: ImportField, by: ColumnMap['by'], why: string) => {
    c.field = f.name;
    c.by = by;
    c.why = why;
    taken.add(f.name);
  };
  if (headerRow) {
    // The same name, then a name people use for it, then one name inside the other ("Customer Email" for Email).
    for (const c of out) {
      const f = free().find((x) => squash(x.name) === squash(c.header));
      if (f && squash(c.header)) take(c, f, 'name', 'same name');
    }
    for (const c of out.filter((x) => !x.field)) {
      const words = synonyms(squash(c.header));
      const f = free().find((x) => words.includes(squash(x.name)) || synonyms(squash(x.name)).includes(squash(c.header)));
      if (f && squash(c.header)) take(c, f, 'name', `"${c.header}" usually means ${f.name}`);
    }
    for (const c of out.filter((x) => !x.field)) {
      const h = squash(c.header);
      if (h.length < 3) continue;
      const hits = free().filter((x) => squash(x.name).length >= 3 && (h.includes(squash(x.name)) || squash(x.name).includes(h)));
      if (hits.length === 1) take(c, hits[0], 'name', 'similar name');
    }
  }
  // Values that are a field's value list, whatever the column is called ("state" holding Active and Inactive).
  for (const c of out.filter((x) => !x.field && x.sample.length)) {
    const hits = free().filter((f) => f.values?.length && c.sample.filter((v) => matchValue(v, f.values!) !== undefined).length >= Math.max(2, Math.ceil(c.sample.length * 0.6)));
    if (hits.length === 1) take(c, hits[0], 'values', `values are from the ${hits[0].valueList ?? hits[0].name} value list`);
  }
  if (headerRow) splitColumns(out, body, free, take);
  if (!headerRow) {
    // No names: an email column to an email field, and otherwise in order, as FileMaker does.
    for (const c of out) {
      if (c.sample.length && c.sample.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) {
        const f = free().find((x) => /e-?mail/i.test(x.name));
        if (f) take(c, f, 'values', 'holds email addresses');
      }
    }
    for (const c of out.filter((x) => !x.field)) {
      const f = fields[c.column];
      if (f && !taken.has(f.name)) take(c, f, 'order', 'same position');
    }
  }
  for (const c of out) if (c.field) c.transforms = fixesFor(body.map((r) => r[c.column] ?? ''), fields.find((f) => f.name === c.field)!, c.transforms.find(isPart));
  return out.sort((a, b) => a.column - b.column);
}

const FULL_NAME = new Set(['name', 'fullname', 'contactname', 'customername', 'contact', 'person', 'clientname', 'membername', 'attendee', 'nameoncard']);
const PLACE = new Set(['citystatezip', 'citystate', 'csz', 'citystatepostcode', 'citystatepostalcode', 'cityprovincepostalcode', 'location', 'citystzip', 'cityregion']);

/**
 * A column left over that holds two or more things the layout has fields for: a full name where there are first and
 * last name fields, or "City, ST 12345" where there are city, state and ZIP fields. It gets an entry per part.
 */
function splitColumns(out: ColumnMap[], body: Cell[][], free: () => ImportField[], take: (c: ColumnMap, f: ImportField, by: ColumnMap['by'], why: string) => void): void {
  const fieldFor = (names: string[]) => free().find((f) => names.includes(squash(f.name)) || names.some((n) => synonyms(squash(f.name)).includes(n)));
  for (const c of out.filter((x) => !x.field && x.sample.length)) {
    const h = squash(c.header);
    const texts = body.map((r) => String(r[c.column] ?? '').trim()).filter((v) => v !== '').slice(0, 50);
    let parts: [Part, ImportField | undefined][] = [];
    let why = '';
    if (FULL_NAME.has(h) && texts.filter((v) => /^\p{L}/u.test(v) && /\s|,/.test(v) && !/\d|@/.test(v)).length >= Math.ceil(texts.length * 0.6)) {
      parts = [['name-first', fieldFor(['firstname'])], ['name-middle', fieldFor(['middlename', 'middle', 'middleinitial', 'mi'])], ['name-last', fieldFor(['lastname'])]];
      why = 'full names, split';
    } else if (texts.filter((v) => (PLACE.has(h) ? placeParts(v) : placeParts(v)?.postcode)).length >= Math.ceil(texts.length * 0.6)) {
      parts = [['city', fieldFor(['city'])], ['state', fieldFor(['state'])], ['postcode', fieldFor(['zip'])]];
      why = 'city, state and postcode, split';
    }
    const found = parts.filter((p): p is [Part, ImportField] => !!p[1]);
    // Worth splitting when it fills two fields at least (a full name: first and last).
    if (found.length < 2 || (parts[0][0] === 'name-first' && !(parts[0][1] && parts[2][1]))) continue;
    found.forEach(([part, f], i) => {
      const entry = i === 0 ? c : { ...c, sample: [...c.sample] };
      entry.transforms = [part];
      take(entry, f, 'values', why);
      if (i > 0) out.push(entry);
    });
  }
}

/** The fixes for a column going into a field, from the values it would give (one part of each, when it has a part). */
function fixesFor(values: Cell[], field: ImportField, part?: Part): Transform[] {
  if (!part) return suggestFixes(values, field);
  const parts = values.map((v) => (v === '' ? '' : partOf(String(v).trim(), part) ?? ''));
  return [part, ...suggestFixes(parts, field).filter((t) => t !== 'trim')];
}

/** The fixes a column needs to go into a field: its date order, number formatting, yes/no, value list spellings. */
export function suggestFixes(values: Cell[], field: ImportField): Transform[] {
  const texts = values.filter((v) => typeof v === 'string' && v.trim() !== '') as string[];
  const fixes: Transform[] = [];
  if (texts.some((v) => v !== v.trim() || /\s{2,}/.test(v))) fixes.push('trim');
  if (field.type === 'number') {
    if (texts.length && texts.every((v) => /^(yes|no|y|n|true|false)$/i.test(v.trim()))) fixes.push('yes-no');
    else if (texts.some((v) => /[^\d.\-\s]/.test(v.trim()) && Number.isFinite(toNumber(v)))) fixes.push('number');
  } else if (field.type === 'date' || field.type === 'timestamp') {
    if (values.some((v) => typeof v === 'number')) fixes.push('excel-date');
    const order = dateOrder(texts);
    if (order) fixes.push(order);
  } else if (field.type === 'time') {
    if (values.some((v) => typeof v === 'number' && v < 1)) fixes.push('excel-date');
    else if (texts.some((v) => /[ap]\.?m\.?$/i.test(v.trim()))) fixes.push('time');
  } else if (field.type === 'text' && field.values?.length) {
    const allowed = new Set(field.values);
    if (texts.some((v) => !allowed.has(v.trim()) && matchValue(v, field.values!) !== undefined)) fixes.push('value-list');
  } else if (field.type === 'text' && /phone|tel|mobile|cell|fax/i.test(field.name) && texts.length) {
    // Phone numbers written several ways ("555.123.4567", "(555) 123-4567"), nearly all of them North American.
    const shapes = new Set(texts.map((v) => v.trim().replace(/\d/g, '9')));
    const fixed = texts.map(phone);
    if (shapes.size > 1 && fixed.filter((p) => p?.startsWith('(')).length >= Math.ceil(texts.length * 0.8)) fixes.push('phone');
  }
  return fixes;
}

/** How a column writes its dates: year first, day first (a first part over 12), or month first. */
function dateOrder(texts: string[]): Transform | undefined {
  const parts = texts.map((v) => /^\s*(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(v)).filter((m): m is RegExpExecArray => !!m);
  if (!parts.length) return undefined;
  if (parts.every((m) => m[1].length === 4)) return parts.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m[0].trim())) ? undefined : 'date-ymd';
  if (parts.some((m) => Number(m[1]) > 12)) return 'date-dmy';
  return 'date-mdy';
}

function toNumber(v: string): number {
  const s = v.trim();
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[^\d-]+/, ''));
  // European "1.234,56" or US "1,234.56".
  const european = /^\D*\d{1,3}(\.\d{3})+(,\d+)?\D*$/.test(s) || /^\D*\d+,\d{1,2}\D*$/.test(s);
  const digits = (european ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')).replace(/[^\d.]/g, '');
  if (!digits || digits === '.') return NaN;
  const n = Number(digits);
  return negative ? -n : n;
}

function matchValue(v: string, values: string[]): string | undefined {
  const s = squash(v);
  if (!s) return undefined;
  return values.find((x) => squash(x) === s) ?? values.find((x) => squash(x).startsWith(s) && s.length >= 2);
}

const pad = (n: number) => String(n).padStart(2, '0');

const PART_NAMES: Record<Part, string> = { 'name-first': 'first name', 'name-middle': 'middle name', 'name-last': 'last name', city: 'city', state: 'state', postcode: 'postcode' };

/** One value through a column's fixes, into what the field stores; an issue when it can't be. */
export function convert(v: Cell, field: ImportField, fixes: Transform[]): { value: Cell; issue?: string } {
  let value: Cell = v;
  const has = (t: Transform) => fixes.includes(t);
  if (typeof value === 'string' && has('trim')) value = value.trim().replace(/\s{2,}/g, ' ');
  // A text export put an apostrophe before a value a spreadsheet would take for a formula; a number or date field doesn't want it.
  value = stripFormulaGuard(value, field.type);
  if (value === '') return { value };
  const part = fixes.find(isPart);
  if (part) {
    const got = partOf(String(value).trim(), part);
    if (got === undefined) return { value: '', issue: `can't find the ${PART_NAMES[part]} in "${value}"` };
    value = got;
    if (value === '') return { value };
  }
  if (has('phone')) {
    const p = phone(String(value));
    if (p === undefined) return { value, issue: `"${value}" isn't a phone number` };
    value = p;
  }
  if (typeof value === 'number' && has('excel-date')) value = excelDate(value, field.type);
  if (typeof value === 'string') {
    if (has('upper')) value = value.toUpperCase();
    if (has('lower')) value = value.toLowerCase();
    if (has('title-case')) value = value.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
    if (has('digits')) value = value.replace(/\D/g, '');
    if (has('yes-no')) {
      const s = value.trim().toLowerCase();
      if (/^(yes|y|true|x|1)$/.test(s)) value = 1;
      else if (/^(no|n|false|0)$/.test(s)) value = 0;
      else return { value, issue: `"${value}" isn't yes or no` };
    }
  }
  if (typeof value === 'string' && has('number')) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return { value, issue: `"${value}" isn't a number` };
    value = n;
  }
  if (typeof value === 'string' && (has('date-mdy') || has('date-dmy') || has('date-ymd'))) {
    const m = /^\s*(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[\sT]+(.*))?$/.exec(value);
    if (!m) return { value, issue: `"${value}" isn't a date` };
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    let [y, mo, d] = has('date-ymd') ? [a, b, c] : has('date-dmy') ? [c, b, a] : [c, a, b];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { value, issue: `"${value}" isn't a real date` };
    value = `${y}-${pad(mo)}-${pad(d)}`;
    if (field.type === 'timestamp') value += `T${normalTime(m[4] ?? '') ?? '00:00:00'}`;
  }
  if (typeof value === 'string' && has('time')) {
    const t = normalTime(value);
    if (!t) return { value, issue: `"${value}" isn't a time` };
    value = t;
  }
  if (typeof value === 'string' && has('value-list') && field.values?.length) {
    const hit = field.values.includes(value) ? value : matchValue(value, field.values);
    if (hit === undefined) return { value, issue: `"${value}" isn't in the ${field.valueList ?? ''} value list`.replace('  ', ' ') };
    value = hit;
  }
  // What the field would refuse or store as text.
  if (field.type === 'number' && typeof value === 'string' && !Number.isFinite(Number(value.replace(/,/g, '')))) return { value, issue: `"${value}" isn't a number` };
  if (field.type === 'date' && typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !looksLikeDate(value)) return { value, issue: `"${value}" isn't a date` };
  return { value };
}

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|prof|sir|dame|rev)\.?$/i;
// Suffixes and letters after a name, kept with the last name: "Smith Jr.", "Doe RN".
const SUFFIX = /^(jr|sr|ii|iii|iv|v|ph\.?d|m\.?d|rn|mba|esq|dds|dvm|cpa|jd|cfa)\.?,?$/i;
// Words that belong to the last name before it: "Ludwig van Beethoven", "Maria de la Cruz".
const PARTICLE = /^(van|von|de|der|den|del|della|da|di|du|la|le|st\.?|bin|ibn|al|ten|ter|mac)$/i;

/** A person's name in parts: "Last, First Middle" or "First Middle Last", titles dropped, a suffix kept with the last name. */
export function nameParts(s: string): { first: string; middle: string; last: string } {
  const comma = s.indexOf(',');
  let words: string[];
  let last: string[] = [];
  const suffix: string[] = [];
  const tidy = (w: string[]) => w.map((x) => x.replace(/,$/, '')).filter((x) => x !== '');
  // "Last, First" unless all after the comma is suffixes ("John Smith, Jr., Esq.").
  if (comma >= 0 && !s.slice(comma + 1).trim().split(/[\s,]+/).filter(Boolean).every((w) => SUFFIX.test(w))) {
    // "Smith, John A." (and "Smith Jr., John").
    last = tidy(s.slice(0, comma).trim().split(/\s+/));
    words = tidy(s.slice(comma + 1).trim().split(/\s+/));
    while (words.length > 1 && SUFFIX.test(words[words.length - 1])) suffix.unshift(words.pop()!);
  } else {
    words = tidy(s.trim().split(/[\s,]+/));
    while (words.length > 1 && SUFFIX.test(words[words.length - 1])) suffix.unshift(words.pop()!);
    let titled = false;
    while (words.length > 1 && HONORIFIC.test(words[0])) {
      words.shift();
      titled = true;
    }
    // "Dr. Smith": with a title, the one name left is the last name.
    if (titled && words.length === 1) last = [words.pop()!];
    if (words.length > 1) {
      last = [words.pop()!];
      while (words.length > 1 && PARTICLE.test(words[words.length - 1])) last.unshift(words.pop()!);
    }
  }
  while (words.length > 1 && HONORIFIC.test(words[0])) words.shift();
  return { first: words[0] ?? '', middle: words.slice(1).join(' '), last: [...last, ...suffix].join(' ') };
}

/** "Springfield, IL 62704", "Toronto, ON M5V 2T6" or "Lyon, Rhône": the city, the state or region, the postcode. */
export function placeParts(s: string): { city: string; state: string; postcode: string } | undefined {
  // Split and trimmed rather than one pattern, so a long cell of spaces can't make the match take forever.
  if (s.length > 200) return undefined;
  const comma = s.indexOf(',');
  if (comma < 0) return undefined;
  const city = s.slice(0, comma).trim();
  let rest = s.slice(comma + 1).trim().replace(/,\s*(USA?|United States|Canada)$/i, '').trim();
  const zip = /(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)$/i.exec(rest);
  if (zip) rest = rest.slice(0, zip.index);
  const state = rest.replace(/[\s,]+$/, '').replace(/\.$/, '').trim();
  if (!city || /,|\d/.test(state) || (!state && !zip)) return undefined;
  return { city, state, postcode: (zip?.[1] ?? '').toUpperCase() };
}

/** One part of a value; undefined when it can't be found. */
export function partOf(v: string, part: Part): string | undefined {
  if (part.startsWith('name-')) {
    const n = nameParts(v);
    return part === 'name-first' ? n.first : part === 'name-middle' ? n.middle : n.last;
  }
  const p = placeParts(v);
  return p && p[part as 'city' | 'state' | 'postcode'];
}

/**
 * A phone number written one way: North American numbers as (555) 123-4567, seven digits as 123-4567, anything
 * written with a country code other than +1 kept as written; an extension kept as " x123".
 */
export function phone(v: string): string | undefined {
  // A cell with a line break in it holds more than one number (or a note): not a phone number to tidy.
  const m = /[\r\n]/.test(v.trim()) ? null : /^(.*?)(?:\s*(?:x|ext\.?|extension|#)\s*(\d+))?\s*$/i.exec(v.trim());
  if (!m) return undefined;
  const body = m[1];
  const ext = m[2] ? ` x${m[2]}` : '';
  const d = body.replace(/\D/g, '');
  if (/[^\d\s()+.\-/]/.test(body) || d.length < 7) return undefined;
  const intl = /^\s*(\+|00)/.test(body);
  const n0 = /^\s*00/.test(body) ? d.slice(2) : d;
  if (intl && !(n0.length === 11 && n0[0] === '1')) return body.replace(/\s+/g, ' ').trim() + ext;
  if (n0.length === 10 || (n0.length === 11 && n0[0] === '1')) {
    const n = n0.slice(-10);
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}${ext}`;
  }
  if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}${ext}`;
  return undefined;
}

function normalTime(s: string): string | undefined {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(s);
  if (!m || (!m[2] && !m[4])) return undefined;
  let h = Number(m[1]);
  if (m[4]) h = (h % 12) + (m[4].toLowerCase() === 'p' ? 12 : 0);
  if (h > 23 || Number(m[2] ?? 0) > 59) return undefined;
  return `${pad(h)}:${m[2] ?? '00'}:${m[3] ?? '00'}`;
}

/** Fields that tell records apart, of those the columns go into: an email, an id or code, else the whole row. */
export function duplicateKeys(columns: ColumnMap[], fields: ImportField[]): string[] {
  const mapped = columns.filter((c) => c.field).map((c) => c.field!);
  const strong = mapped.filter((f) => /e-?mail|(^|[\s_])id$|^id|code|sku|serial|\bnumber$|\bno$|account ?(no|number)/i.test(f) && fields.some((x) => x.name === f));
  if (strong.length) return strong.slice(0, 2);
  const names = mapped.filter((f) => /name/i.test(f));
  return names.length >= 1 ? names.slice(0, 3) : [];
}

const keyOf = (values: (Cell | null | undefined)[]) => values.every((v) => v === null || v === undefined || String(v).trim() === '')
  ? undefined : values.map((v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('\u0001');

/** Records already in the table (or in `within`, a found set the account can see), by their key fields, that the account can see. */
function existingKeys(store: Store, layout: string, keys: string[], privileges?: Privileges, within?: number[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!keys.length) return out;
  const info = store.layout(layout);
  const owner = info.owner;
  const pv = privileges?.in(owner);
  const ids = within ?? (pv ? owner.viewableIds(info.table, pv) : undefined);
  const from = ids ? `(SELECT * FROM ${q(info.table)} WHERE _fm_record_id IN (SELECT value FROM json_each('${JSON.stringify(ids.map(Number))}')))` : q(info.table);
  for (const r of owner.query(`SELECT _fm_record_id AS id, ${keys.map((k, i) => `${q(k)} AS k${i}`).join(', ')} FROM ${from}`, 5_000_000)) {
    const k = keyOf(keys.map((_, i) => r[`k${i}`] as Cell | null));
    if (k !== undefined && !out.has(k)) out.set(k, Number(r.id));
  }
  return out;
}

/** Every row as it would go in: its values, issues, and whether it repeats a record. */
export function convertRows(store: Store, layout: string, rows: Cell[][], plan: { headerRow: boolean; columns: Pick<ColumnMap, 'column' | 'field' | 'transforms'>[]; keys: string[] }, fields: ImportField[], privileges?: Privileges, within?: number[], keepBlank = false): PreviewRow[] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const mapped = plan.columns.filter((c) => c.field && byName.has(c.field));
  const existing = existingKeys(store, layout, plan.keys.filter((k) => byName.has(k)), privileges, within);
  const seen = new Map<string, number>();
  const out: PreviewRow[] = [];
  const start = plan.headerRow ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const values: Record<string, Cell> = {};
    const issues: string[] = [];
    for (const c of mapped) {
      const f = byName.get(c.field!)!;
      const r = convert(rows[i][c.column] ?? '', f, c.transforms);
      if (r.issue) issues.push(`${f.name}: ${r.issue}`);
      if (r.value !== '') values[f.name] = r.value;
    }
    const row: PreviewRow = { row: i + 1, values, issues };
    const k = plan.keys.length ? keyOf(stored(store, layout, plan.keys.map((f) => values[f]), plan.keys.map((f) => byName.get(f)?.type))) : undefined;
    if (k !== undefined) {
      if (existing.has(k)) row.duplicate = { of: 'existing', recordId: existing.get(k)! };
      else if (seen.has(k)) row.duplicate = { of: 'file', row: seen.get(k)! };
      else seen.set(k, i + 1);
    }
    if (keepBlank || Object.keys(values).length) out.push(row);
  }
  return out;
}

/** Values as the fields store them ("10.50" as 10.5, "1/2/2024" as a date), so they match the records' own. */
function stored(store: Store, layout: string, values: (Cell | undefined)[], types: (string | undefined)[]): (Cell | null | undefined)[] {
  const owner = store.layout(layout).owner;
  return values.map((v, i) => (typeof v === 'string' && types[i] ? owner.normalize(v, types[i] as Parameters<Store['normalize']>[1]) as Cell | null : v));
}

/** Text the assistant may see of a column: a password, key or token column shows none of its values. */
function forModel(c: ColumnMap): { column: number; header: string; sample: string[] } {
  return { column: c.column, header: c.header, sample: secretName(c.header) ? [] : c.sample.map((v) => redactSecrets(v.slice(0, 80))) };
}

/** The plan for importing rows into a layout: columns matched (by the assistant when asked), fixes, preview and duplicates. */
export async function planImport(store: Store, layout: string, rows: Cell[][], opts: { privileges?: Privileges; mapper?: ImportMapper; signal?: AbortSignal; previewRows?: number } = {}): Promise<ImportPlan> {
  const info = store.layout(layout);
  const fields = importFields(store, layout, opts.privileges);
  if (!fields.length) throw new ImportError(`No field on ${layout} can take imported data for this account`);
  const headerRow = hasHeaderRow(rows, fields);
  let columns = matchColumns(rows, fields, headerRow);
  let keys = duplicateKeys(columns, fields);
  let ai: ImportPlan['ai'];
  if (opts.mapper) {
    try {
      const got = await opts.mapper({ layout: info.name, table: info.table, fields, columns: columns.map(forModel) }, opts.signal);
      if (got) {
        const names = new Set(fields.map((f) => f.name));
        const used = new Set<string>();
        const body = headerRow ? rows.slice(1) : rows;
        // Each column as the model matched it: one entry, or one per part when it splits the column (a full name into
        // first and last). A column it didn't answer for keeps what the names gave.
        const merged: ColumnMap[] = [];
        for (const c of columns.filter((x, i, all) => all.findIndex((y) => y.column === x.column) === i)) {
          const gs = got.columns.filter((x) => x.column === c.column);
          if (!gs.length) {
            merged.push(...columns.filter((x) => x.column === c.column));
            continue;
          }
          // Several entries with no part between them: the first.
          const split = gs.some((x) => cleanFixes(x.transforms).some(isPart));
          for (const g of split ? gs.slice(0, PARTS.length) : gs.slice(0, 1)) {
            const given = cleanFixes(g.transforms);
            // Two entries for one column only when each takes a different part of it.
            if (split && gs.length > 1 && (!given.some(isPart) || merged.some((m) => m.column === c.column && m.transforms.find(isPart) === given.find(isPart)))) continue;
            const field = g.field && names.has(g.field) && !used.has(g.field) ? g.field : null;
            if (field) used.add(field);
            const f = fields.find((x) => x.name === field);
            // The model's fixes, where they are ones we have; the values decide the rest (a date column's order, a value list).
            const fixes = cleanFixes([...given, ...(f ? fixesFor(body.map((r) => r[c.column] ?? ''), f, given.find(isPart)) : [])]);
            merged.push({ ...c, sample: [...c.sample], field, transforms: fixes, why: g.why ? String(g.why).slice(0, 200) : c.why, by: 'ai' as const });
          }
        }
        // Fields the names gave a column the model didn't answer for, taken again by the model: the model's stands.
        columns = merged.map((c) => (c.by !== 'ai' && c.field && merged.some((m) => m.by === 'ai' && m.field === c.field) ? { ...c, field: null, transforms: [], why: undefined, by: undefined } : c));
        const k = (got.keys ?? []).filter((x) => columns.some((c) => c.field === x));
        keys = k.length ? k : duplicateKeys(columns, fields);
        ai = { used: true };
      } else ai = { used: false, note: 'The assistant gave no matching; matched by name' };
    } catch (e) {
      ai = { used: false, note: `The assistant couldn't match the columns (${(e as Error).message}); matched by name` };
    }
  }
  return finish(store, layout, rows, { headerRow, columns, keys }, fields, opts.privileges, ai, opts.previewRows);
}

/** The preview for a plan someone changed: their columns, fixes and keys. */
export function replan(store: Store, layout: string, rows: Cell[][], plan: { headerRow: boolean; columns: { column: number; field: string | null; transforms?: string[] }[]; keys?: string[] }, privileges?: Privileges, within?: number[]): ImportPlan {
  const fields = importFields(store, layout, privileges);
  const base = matchColumns(rows, fields, plan.headerRow).filter((c, i, all) => all.findIndex((x) => x.column === c.column) === i);
  // Each column as the person left it: one entry, or one per part when they split it.
  const columns = oneEach(base.flatMap((c): ColumnMap[] => {
    const ps = plan.columns.filter((x) => x.column === c.column).slice(0, PARTS.length);
    if (!ps.length) return [{ ...c, field: null, transforms: [], why: undefined, by: undefined }];
    return ps.map((p) => {
      const field = p.field && fields.some((f) => f.name === p.field) ? p.field : null;
      return { ...c, sample: [...c.sample], field, transforms: cleanFixes(p.transforms), by: 'person' as const, why: undefined };
    });
  }));
  return finish(store, layout, rows, { headerRow: plan.headerRow, columns, keys: plan.keys ?? duplicateKeys(columns, fields) }, fields, privileges, undefined, 20, within);
}

function finish(store: Store, layout: string, rows: Cell[][], plan: { headerRow: boolean; columns: ColumnMap[]; keys: string[] }, fields: ImportField[], privileges?: Privileges, ai?: ImportPlan['ai'], previewRows = 20, within?: number[]): ImportPlan {
  const info = store.layout(layout);
  const all = convertRows(store, layout, rows, plan, fields, privileges, within);
  // The rows worth looking at first: ones with issues or duplicates, then the rest in order.
  const worth = [...all.filter((r) => r.issues.length || r.duplicate), ...all.filter((r) => !r.issues.length && !r.duplicate)].slice(0, previewRows).sort((a, b) => a.row - b.row);
  return {
    layout: info.name, table: info.table, rows: all.length, headerRow: plan.headerRow, fields, columns: plan.columns, keys: plan.keys,
    preview: worth,
    summary: {
      ready: all.filter((r) => !r.issues.length && !r.duplicate).length,
      withIssues: all.filter((r) => r.issues.length).length,
      duplicatesInFile: all.filter((r) => r.duplicate?.of === 'file').length,
      duplicatesExisting: all.filter((r) => r.duplicate?.of === 'existing').length,
    },
    ...(ai ? { ai } : {}),
  };
}

export interface ImportResult {
  id: string;
  foundSet: number[];
  imported: number;
  /** Records of the found set that rows updated (Update) or replaced (Replace). */
  updated?: number;
  /** Rows not imported: not allowed, not valid, or a duplicate when duplicates are skipped. */
  skipped: { row: number; why: string }[];
  /** Rows an AI agent imported that wait for a person to approve them (each is its own approval). */
  pendingApproval?: number;
  /** False when the records it changed were too many to keep what they held, so Undo can't take it back. */
  undoable?: false;
}

/**
 * FileMaker's import actions: add every row as a new record; update the records of the found set whose match
 * fields hold the same values as a row (each matching record, the last matching row winning); or replace the
 * found set's records, in order, with the rows. Update and Replace overwrite each imported field, even with a
 * blank, and with `addRemaining` the rows left over become new records.
 */
export type ImportAction = 'add' | 'update' | 'replace';

/**
 * Imports the rows as the account, and keeps the import so it can be undone: the records it added, and what the
 * fields it overwrote held before (which FileMaker can't take back). `target` is the found set, in its order,
 * already limited to records the account can see; `match` the fields Update matches on.
 */
function applyImportRun(store: Store, layout: string, rows: Cell[][], plan: { headerRow: boolean; columns: { column: number; field: string | null; transforms?: string[] }[]; keys?: string[] },
  opts: { privileges?: Privileges; account?: string; skipDuplicates?: boolean; skipIssues?: boolean; file?: string; action?: ImportAction; target?: number[]; match?: string[]; addRemaining?: boolean }): ImportResult {
  const fields = importFields(store, layout, opts.privileges);
  const columns = oneEach(plan.columns.map((c) => ({ column: c.column, field: c.field && fields.some((f) => f.name === c.field) ? c.field : null, transforms: cleanFixes(c.transforms) })));
  if (!columns.some((c) => c.field)) throw new ImportError('Choose the fields to import into');
  const action = opts.action ?? 'add';
  const mapped = [...new Set(columns.filter((c) => c.field).map((c) => c.field!))];
  const match = action === 'update' ? [...new Set(opts.match ?? [])].filter((f) => mapped.includes(f) && !fields.find((x) => x.name === f)?.global) : [];
  if (action === 'update' && !match.length) throw new ImportError('Choose the fields to match records on');
  const target = action === 'add' ? [] : opts.target ?? [];
  // Replace pairs rows with records by position, so a blank row (blanking its record's fields) keeps its place.
  const converted = convertRows(store, layout, rows, { headerRow: plan.headerRow, columns, keys: action === 'add' ? plan.keys ?? [] : [] }, fields, opts.privileges, undefined, action === 'replace');
  const ids: number[] = [];
  const mods: number[] = [];
  const skipped: ImportResult['skipped'] = [];
  let pending = 0;
  const write = { privileges: opts.privileges, account: opts.account };
  const pendingOr = (e: unknown, row: number): void => {
    if (e instanceof PendingApprovalError) {
      pending++;
      return;
    }
    if (!(e instanceof StoreError || e instanceof PrivilegeError)) throw e;
    skipped.push({ row, why: e.message });
  };

  // Update / Replace: which records of the found set each row overwrites; the rows left over may be added.
  let adding = converted;
  const changes = new Map<number, PreviewRow>();
  if (action !== 'add') {
    adding = [];
    // A row left out for an issue leaves its record (Replace: the one in its place) as it is.
    const usable = (r: PreviewRow) => {
      if (!opts.skipIssues || !r.issues.length) return true;
      skipped.push({ row: r.row, why: r.issues[0] });
      return false;
    };
    if (action === 'replace') {
      converted.forEach((r, i) => usable(r) && (i < target.length ? changes.set(target[i], r) : adding.push(r)));
    } else {
      const byKey = new Map<string, number[]>();
      for (const [k, id] of targetKeys(store, layout, match, target)) byKey.set(k, [...(byKey.get(k) ?? []), id]);
      const types = match.map((f) => fields.find((x) => x.name === f)?.type);
      for (const r of converted.filter(usable)) {
        const k = keyOf(stored(store, layout, match.map((f) => r.values[f]), types));
        const hits = k === undefined ? undefined : byKey.get(k);
        if (hits) for (const id of hits) changes.set(id, r); // the last matching row wins, as in FileMaker
        else adding.push(r);
      }
    }
    if (!opts.addRemaining) {
      for (const r of adding) skipped.push({ row: r.row, why: action === 'update' ? 'matches no record in the found set' : 'more rows than records in the found set' });
      adding = [];
    }
  }
  const overwrite = mapped.filter((f) => !match.includes(f));
  const touched = target.filter((id) => changes.has(id));
  const snaps = touched.length && overwrite.length ? snapshotFields(store, layout, overwrite, touched) : undefined;
  const updated: number[] = [];
  for (const id of touched) {
    const r = changes.get(id)!;
    // Every imported field is overwritten, a blank in the file too.
    const data = Object.fromEntries(overwrite.map((f) => [f, r.values[f] ?? '']));
    if (!overwrite.length) {
      updated.push(id);
      continue;
    }
    try {
      store.update(layout, id, data, undefined, write);
      updated.push(id);
    } catch (e) {
      pendingOr(e, r.row);
    }
  }
  for (const r of adding) {
    if (!Object.keys(r.values).length) continue; // a blank row past the found set's end adds nothing
    if (opts.skipDuplicates && r.duplicate) {
      skipped.push({ row: r.row, why: r.duplicate.of === 'existing' ? `same as record ${r.duplicate.recordId}` : `same as row ${r.duplicate.row}` });
      continue;
    }
    if (opts.skipIssues && r.issues.length) {
      skipped.push({ row: r.row, why: r.issues[0] });
      continue;
    }
    try {
      const made = store.create(layout, r.values, write);
      ids.push(made.recordId);
      mods.push(made.modId);
    } catch (e) {
      pendingOr(e, r.row);
    }
  }
  const batch = snaps ? journalFieldChange(store, snaps, opts.account, (n) => `Import${opts.file ? ` of ${opts.file}` : ''} ${action === 'update' ? 'updated' : 'replaced'} ${n} record${n === 1 ? '' : 's'}`) : undefined;
  const id = randomBytes(6).toString('hex');
  journal(store);
  const info = store.layout(layout);
  store.sql.prepare('INSERT INTO _fm_imports (id, at, account, layout, tbl, file, ids, mods, cleanup) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, new Date().toISOString(), opts.account ?? null, info.name, info.table, opts.file ?? null, JSON.stringify(ids), JSON.stringify(mods), batch?.id ?? null);
  skipped.sort((x, y) => x.row - y.row);
  return {
    id, foundSet: [...updated, ...ids], imported: ids.length, ...(action === 'add' ? {} : { updated: updated.length }), skipped,
    ...(pending ? { pendingApproval: pending } : {}),
    ...(updated.length && overwrite.length && !snaps ? { undoable: false as const } : {}),
  };
}

/** The match fields' values in each record of the found set, as keys (records whose match fields are all empty aren't matched). */
function targetKeys(store: Store, layout: string, match: string[], target: number[]): [string, number][] {
  const info = store.layout(layout);
  const out: [string, number][] = [];
  for (let i = 0; i < target.length; i += 500) {
    const chunk = target.slice(i, i + 500);
    const got = new Map<number, string | undefined>();
    for (const r of info.owner.sql.prepare(`SELECT _fm_record_id AS id, ${match.map((k, j) => `${q(k)} AS k${j}`).join(', ')} FROM ${q(info.table)} WHERE _fm_record_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Record<string, Cell | null>[]) {
      got.set(Number(r.id), keyOf(match.map((_, j) => r[`k${j}`])));
    }
    for (const id of chunk) {
      const k = got.get(id);
      if (k !== undefined) out.push([k, id]);
    }
  }
  return out;
}

function journal(store: Store): void {
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_imports (id TEXT PRIMARY KEY, at TEXT NOT NULL, account TEXT, layout TEXT NOT NULL, tbl TEXT NOT NULL,
    file TEXT, ids TEXT NOT NULL, mods TEXT NOT NULL, undone TEXT, cleanup TEXT)`);
  // Files from before Update and Replace: the cleanup batch that takes back the fields an import overwrote.
  if (!(store.sql.prepare('PRAGMA table_info(_fm_imports)').all() as { name: string }[]).some((c) => c.name === 'cleanup')) store.sql.exec('ALTER TABLE _fm_imports ADD COLUMN cleanup TEXT');
}

export interface ImportRecord { id: string; at: string; account?: string; layout: string; file?: string; imported: number; undone?: string }

/** Import a plain column mapping from a row iterator in bounded batches. */
export function importMappedRows(store: Store, layout: string, rows: Iterable<Cell[]>, mapping: (string | undefined)[], opts: { privileges?: Privileges; account?: string; skipFirst?: boolean }): { foundSet: number[]; imported: number; skipped: number } {
  const info = store.layout(layout);
  const types = new Map(info.fields.map((f) => [f.name, f.type]));
  const ids: number[] = [];
  let skipped = 0;
  let first = true;
  let batch: Cell[][] = [];
  const importBatch = () => {
    for (const row of batch) {
      const data: Record<string, Cell> = {};
      row.forEach((v, i) => {
        const field = mapping[i];
        if (field && v !== '') data[field] = typeof v === 'number' ? excelDate(v, types.get(field)) : stripFormulaGuard(v, types.get(field));
      });
      try {
        ids.push(store.create(layout, data, { privileges: opts.privileges, account: opts.account }).recordId);
      } catch (e) {
        if (!(e instanceof StoreError || e instanceof PrivilegeError)) throw e;
        skipped++;
      }
    }
    batch = [];
  };
  for (const row of rows) {
    if (first && opts.skipFirst) { first = false; continue; }
    first = false;
    batch.push(row);
    if (batch.length === 500) importBatch();
  }
  if (batch.length) importBatch();
  return { foundSet: ids, imported: ids.length, skipped };
}

/** Imports kept in the file, newest first. */
export function importHistory(store: Store, limit = 20): ImportRecord[] {
  journal(store);
  return (store.sql.prepare('SELECT id, at, account, layout, file, ids, undone FROM _fm_imports ORDER BY at DESC, rowid DESC LIMIT ?').all(limit) as Record<string, string | null>[])
    .map((r) => ({ id: r.id!, at: r.at!, ...(r.account ? { account: r.account } : {}), layout: r.layout!, ...(r.file ? { file: r.file } : {}), imported: (JSON.parse(r.ids!) as number[]).length, ...(r.undone ? { undone: r.undone } : {}) }));
}

/** Takes an import back: deletes the records it made, except ones changed since, which are left and named. */
function undoImportRun(store: Store, id: string, opts: { privileges?: Privileges; account?: string }): { deleted: number; restored?: number; kept: { recordId: number; why: string }[] } {
  journal(store);
  const row = store.sql.prepare('SELECT * FROM _fm_imports WHERE id = ?').get(id) as { layout: string; tbl: string; ids: string; mods: string; account: string | null; undone: string | null; cleanup: string | null } | undefined;
  if (!row) throw new ImportError('No such import');
  if (row.undone) throw new ImportError('Already undone');
  if (opts.privileges && !opts.privileges.full && row.account !== opts.account) throw new ImportError('Only the account that imported, or [Full Access], can undo an import');
  const ids = JSON.parse(row.ids) as number[];
  const mods = JSON.parse(row.mods) as number[];
  const kept: { recordId: number; why: string }[] = [];
  let deleted = 0;
  // First the fields Update or Replace overwrote (all or none) get back what they held, except ones changed again since.
  let restored = 0;
  if (row.cleanup) {
    try {
      const back = undoCleanup(store, row.cleanup, opts);
      restored = back.undone;
      for (const why of back.skipped) {
        const recordId = Number(/record (\d+)/.exec(why)?.[1] ?? 0);
        if (!kept.some((k) => k.recordId === recordId)) kept.push({ recordId, why: 'changed since it was imported' });
      }
    } catch (e) {
      if (!(e instanceof CleanupError)) throw e; // already taken back from Clean Up Data's history
    }
  }
  ids.forEach((recordId, i) => {
    const now = store.sql.prepare(`SELECT _fm_mod_id AS m FROM ${q(row.tbl)} WHERE _fm_record_id = ?`).get(recordId) as { m: number } | undefined;
    if (!now) return;
    if (now.m !== mods[i]) {
      kept.push({ recordId, why: 'changed since it was imported' });
      return;
    }
    try {
      store.delete(row.layout, recordId, { privileges: opts.privileges, account: opts.account });
      deleted++;
    } catch (e) {
      if (!(e instanceof StoreError || e instanceof PrivilegeError)) throw e;
      kept.push({ recordId, why: e.message });
    }
  });
  store.sql.prepare('UPDATE _fm_imports SET undone = ? WHERE id = ?').run(new Date().toISOString(), id);
  return { deleted, kept, ...(row.cleanup ? { restored } : {}) };
}

/** Imports rows (see applyImportRun); the record changes are logged as coming from "import", whichever way in the import was started. */
export function applyImport(...args: Parameters<typeof applyImportRun>): ReturnType<typeof applyImportRun> {
  return writer.run({ ...writer.getStore(), surface: 'import' }, () => applyImportRun(...args));
}

/** Takes an import back; the deletions and put-back values are logged as coming from "import" too. */
export function undoImport(...args: Parameters<typeof undoImportRun>): ReturnType<typeof undoImportRun> {
  return writer.run({ ...writer.getStore(), surface: 'import' }, () => undoImportRun(...args));
}
