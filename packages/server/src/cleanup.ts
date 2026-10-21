// Data cleanup: likely duplicate records (names a little different, the same email or phone, the same address),
// values that don't match the field's value list ("Actve" for "Active"), the same value written different ways
// ("ohio", "Ohio ", "OH" where most say "Ohio"), and malformed phone numbers and email addresses. A scan changes nothing; it lists what it found with a suggested fix. Fixes and merges are applied
// only when asked for (a click in the assistant panel or on the cleanup page), all or none, as the signed-in
// account, so its privileges apply and every change goes in the audit log. Each batch applied can be undone.
//
//   POST /tabularius/cleanup/v1/databases/{db}/scan      {layout, checks?, fields?}: what looks wrong (changes nothing)
//   POST /tabularius/cleanup/v1/databases/{db}/apply     {layout, fixes?: [{field, from, to}], merges?: [{keep, remove, fill?}]}
//   GET  /tabularius/cleanup/v1/databases/{db}/history   batches applied, newest first
//   POST /tabularius/cleanup/v1/databases/{db}/history/{id}/undo
//
// Merging duplicates keeps one record, fills its empty fields from the others, moves their related records
// (through relationships matching one key field) to it, then deletes the others. Undo puts it all back.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { endTransaction, occurrence, StoreError, writer, type FindRequest, type LayoutInfo, type Privileges, type Store, type Transaction } from '../../store/src/index.ts';
import type { SqlValue } from '../../store/src/find.ts';
import { q } from '../../store/src/import.ts';
import { ApiError, badPathError, readJson, sessionPrivileges, type DataApi } from './dataapi.ts';
import type { Host } from './host.ts';
import { layoutProfile } from './insight.ts';
import { secretName } from './ai-output.ts';
import { said } from './said.ts';

export type Check = 'duplicates' | 'valueLists' | 'consistency' | 'phones' | 'emails';
export const CHECKS: Check[] = ['duplicates', 'valueLists', 'consistency', 'phones', 'emails'];

/** One wrong value, in every record that has it, with the value to put instead when there's a likely one. */
export interface ValueFix {
  check: Exclude<Check, 'duplicates'>;
  field: string;
  from: string;
  /** The suggested value; none when a person has to decide. */
  to?: string;
  reason: string;
  count: number;
  recordIds: number[];
}

/** Records that look like one thing entered more than once. */
export interface DuplicateGroup {
  reason: string;
  /** How alike they are, 0 to 100. */
  score: number;
  records: { recordId: number; values: Record<string, SqlValue> }[];
  /** The record to keep: the one with the most filled in, else the oldest. */
  keep: number;
  /** Empty fields of the kept record that the others fill in. */
  fill: Record<string, SqlValue>;
  /** Related records that would move to the kept record. */
  related: { table: string; via: string; records: number }[];
}

export interface CleanupScan {
  layout: string;
  table: string;
  scanned: number;
  /** Fields compared for duplicates. */
  compared: string[];
  duplicates: DuplicateGroup[];
  fixes: ValueFix[];
  /** Records not scanned (more than the limit). */
  notScanned?: number;
}

const SCAN_LIMIT = 20_000;
const MAX_GROUPS = 200;
const MAX_FIXES = 500;
const lower = (s: string) => s.toLowerCase();
const str = (v: SqlValue | undefined) => (v === null || v === undefined ? '' : String(v));

// --- similarity -----------------------------------------------------------------

/** Jaro-Winkler similarity, 0 to 1: forgiving of typos and small differences in short strings like names. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k++]) t++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

const COMPANY = /\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|plc|gmbh|the)\b/g;
/** A name as compared: lower case, no punctuation or company suffixes, words in order ("Smith, John" is "john smith"). */
export function normalName(s: string): string {
  return lower(s).replace(/&/g, ' and ').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(COMPANY, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}

const STREET: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl', suite: 'ste',
  apartment: 'apt', north: 'n', south: 's', east: 'e', west: 'w', highway: 'hwy', parkway: 'pkwy', terrace: 'ter', circle: 'cir',
};
export function normalAddress(s: string): string {
  return lower(s).replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean).map((w) => STREET[w] ?? w).join(' ');
}

/** A phone number's digits, without a leading 1 on a North American number. */
export function phoneDigits(s: string): string {
  const d = s.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

// --- fields ------------------------------------------------------------------------

type Role = 'name' | 'email' | 'phone' | 'address' | 'city' | 'postal';
const ROLE: [Role, RegExp][] = [
  ['email', /e-?mail/i],
  ['phone', /phone|mobile|cell|fax|\btel\b|telephone/i],
  ['address', /address|street|addr\b/i],
  ['city', /\bcity\b|town/i],
  ['postal', /zip|postal|postcode/i],
  ['name', /name|company|organi[sz]ation|business|customer|client|contact/i],
];
const roleOf = (field: string): Role | undefined => (/\bid\b|_id$|^id|key|serial|date|time|stamp|count|total|by$|user/i.test(field) ? undefined : ROLE.find(([, re]) => re.test(field))?.[0]);

// --- phone and email -----------------------------------------------------------------

/** A phone number's layout, digits as #: "(###) ###-####". */
const shape = (s: string) => s.replace(/\d/g, '#');

/** Formats 10 digits (and an extension) in a shape like "(###) ###-####". */
function formatPhone(digits: string, pattern: string, ext: string): string {
  let i = 0;
  const out = pattern.replace(/#/g, () => digits[i++] ?? '');
  return ext ? `${out} x${ext}` : out;
}

function phoneProblem(value: string, common?: string): { to?: string; reason: string } | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const ext = /(?:x|ext\.?|extension)\s*(\d+)\s*$/i.exec(v)?.[1] ?? '';
  const core = v.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '');
  if (/[a-z]/i.test(core)) return { reason: 'has letters in it' };
  const digits = phoneDigits(v);
  if (core.startsWith('+') && !core.startsWith('+1')) {
    // An international number: 8 to 15 digits is all that can be said.
    const all = core.replace(/\D/g, '');
    return all.length < 8 || all.length > 15 ? { reason: `${all.length} digits is too ${all.length < 8 ? 'few' : 'many'} for a phone number` } : undefined;
  }
  if (digits.length !== 10) return { reason: `${digits.length} digit${digits.length === 1 ? '' : 's'}; a phone number here has 10` };
  if (common && shape(core.replace(/^\+?1[\s.-]?(?=\(?\d{3})/, '')) !== common) return { to: formatPhone(digits, common, ext), reason: `written differently from most numbers here, which look like ${common.replace(/#/g, '0')}` };
  if (v !== v.replace(/\s+/g, ' ').trim()) return { to: formatPhone(digits, common ?? '(###) ###-####', ext), reason: 'extra spaces' };
  return undefined;
}

const DOMAINS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com',
};
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

function emailProblem(value: string): { to?: string; reason: string } | undefined {
  const v = value;
  if (!v.trim()) return undefined;
  let fixed = v.trim().replace(/^mailto:/i, '').replace(/^<(.*)>$/, '$1').replace(/\s+/g, '').replace(/@@+/g, '@').replace(/[,;]([a-z]{2,})$/i, '.$1').replace(/\.+$/, '').replace(/\.{2,}/g, '.');
  const at = fixed.lastIndexOf('@');
  if (at > 0) {
    let domain = lower(fixed.slice(at + 1)).replace(/\.c[mo]{2}$/, (m) => (m === '.com' ? m : '.com'));
    domain = DOMAINS[domain] ?? domain;
    fixed = fixed.slice(0, at + 1) + domain;
  }
  if (fixed === v) return EMAIL.test(v) ? undefined : { reason: v.includes('@') ? 'not a valid email address' : 'has no @' };
  return EMAIL.test(fixed) ? { to: fixed, reason: describeEmailFix(v, fixed) } : { reason: v.includes('@') ? 'not a valid email address' : 'has no @' };
}

function describeEmailFix(from: string, to: string): string {
  if (from.trim() === to) return 'spaces around it';
  if (/\s/.test(from.trim())) return 'spaces in it';
  if (/^mailto:/i.test(from.trim())) return 'starts with mailto:';
  const a = lower(from.slice(from.lastIndexOf('@') + 1));
  const b = to.slice(to.lastIndexOf('@') + 1);
  if (a !== b && lower(a) !== b) return `domain looks mistyped (${a})`;
  if (a !== b) return 'domain in capitals';
  return 'punctuation';
}

// --- consistency -----------------------------------------------------------------------

const US_STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'],
];
const STATE_NAME = new Map(US_STATES);
const STATE_BY_KEY = new Map(US_STATES.flatMap(([abbr, name]) => [[lower(abbr), abbr], [lower(name), abbr]] as [string, string][]));
const stateField = (field: string) => /\bstates?\b|province/i.test(field) && !/status|statement/i.test(field);
/** Fields whose values are identifiers or free text, not one value that may be written several ways. */
const NOT_NORMALISED = /\bid\b|_id$|^id|id$|key|code|sku|serial|uuid|guid|\bref|number|\bno\b|#|token|hash|url|path|note|comment|description|memo|remark|message|body|text|html|json|password|secret/i;

/** Fields of a table on either side of a relationship (match fields). */
function relationshipFields(store: Store, table: string): string[] {
  const s = store.schema;
  const t = s.tables.find((x) => x.name === table);
  if (!t) return [];
  const mine = new Set(s.tableOccurrences.filter((o) => !o.dataSourceId && o.baseTableId === t.id).map((o) => o.id));
  const ids = new Set<number>();
  for (const r of s.relationships) for (const p of r.predicates) {
    if (mine.has(r.leftTableOccurrenceId)) ids.add(p.leftFieldId);
    if (mine.has(r.rightTableOccurrenceId)) ids.add(p.rightFieldId);
  }
  return t.fields.filter((f) => ids.has(f.id)).map((f) => f.name);
}

/** The value with its spaces tidied: none at the ends, one between words. */
const tidy = (v: string) => v.trim().replace(/[ \t]{2,}/g, ' ');

/**
 * The same value written different ways in one field: capitals and spaces ("ohio", " Ohio"), and in a state field a
 * name and its abbreviation ("OH", "Ohio"). Each is put the way most records already write it.
 */
function inconsistent(field: string, rows: Map<number, Record<string, SqlValue>>): ValueFix[] {
  const state = stateField(field);
  const groups = new Map<string, Map<string, number[]>>();
  for (const [id, r] of rows) {
    const v = str(r[field]);
    // Short single-line values: a notes field's words are not one value written two ways.
    if (!v || v.length > 60 || /[\r\n]/.test(v)) continue;
    const t = tidy(v);
    const key = (state && STATE_BY_KEY.get(lower(t.replace(/\./g, '')))) || lower(t);
    const g = groups.get(key) ?? new Map<string, number[]>();
    g.set(v, [...(g.get(v) ?? []), id]);
    groups.set(key, g);
  }
  // In a state field, abbreviations or names: whichever most records use.
  let abbreviated = true;
  if (state) {
    let abbr = 0, full = 0;
    for (const g of groups.values()) for (const [v, ids] of g) {
      const t = tidy(v).replace(/\./g, '');
      if (!STATE_BY_KEY.has(lower(t))) continue;
      if (t.length === 2) abbr += ids.length;
      else full += ids.length;
    }
    abbreviated = abbr >= full;
  }
  const out: ValueFix[] = [];
  for (const [key, g] of groups) {
    const variants = [...g].sort((a, b) => b[1].length - a[1].length);
    // A state's group is keyed by its abbreviation; any other value's by its lower-case text.
    const abbr = state && STATE_NAME.has(key) ? key : undefined;
    let to: string;
    if (abbr) to = abbreviated ? abbr : STATE_NAME.get(abbr)!;
    else {
      // The way most records write it, tidied; a lone untidy value is only tidied.
      const best = variants.find(([v]) => v === tidy(v)) ?? variants[0];
      to = tidy(best[0]);
    }
    for (const [from, ids] of variants) {
      if (from === to) continue;
      const spaces = tidy(from) !== from;
      const reason = tidy(from) === to ? 'extra spaces'
        : lower(tidy(from)) !== lower(to) ? `the same state as "${to}", which most records use${spaces ? ', and has extra spaces' : ''}`
          : `written "${to}" in most records${spaces ? ', and has extra spaces' : ''}`;
      out.push({ check: 'consistency', field, from, to, reason, count: ids.length, recordIds: ids.slice(0, 500) });
    }
  }
  return out;
}

// --- scan ------------------------------------------------------------------------------

/** What looks wrong in a layout's records, as the account sees them. Changes nothing. */
export function scanData(store: Store, req: { layout: string; checks?: Check[]; fields?: string[] }, privileges?: Privileges): CleanupScan {
  const info = store.layout(req.layout);
  const owner = info.owner;
  const table = owner.schema.tables.find((t) => t.name === info.table)!;
  const checks = new Set((req.checks?.length ? req.checks : CHECKS).filter((c) => CHECKS.includes(c)));
  const pv = privileges?.in(owner);
  // Stored text and number fields of the layout's table the account can see.
  const usable = table.fields.filter((f) => (f.type === 'text' || f.type === 'number') && f.kind === 'normal' && !f.options?.global && (!pv || pv.field(table.name, f.name) !== 'none'));
  const pick = req.fields?.length
    ? req.fields.map((n) => {
      const f = usable.find((x) => lower(x.name) === lower(n));
      if (!f) throw new StoreError(102, `Field "${n}" is missing, or isn't a text or number field this account can see`);
      return f;
    })
    : usable;
  const ids = store.findIds(info, { privileges });
  const scannedIds = ids.slice(0, SCAN_LIMIT);
  const cols = [...new Set([...pick, ...usable.filter((f) => roleOf(f.name))].map((f) => f.name))];
  const rows = new Map<number, Record<string, SqlValue>>();
  for (let i = 0; i < scannedIds.length; i += 5000) {
    const chunk = scannedIds.slice(i, i + 5000);
    const r = owner.select(`SELECT _fm_record_id, ${cols.map(q).join(', ') || 'NULL'} FROM ${q(table.name)} WHERE _fm_record_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(chunk)], chunk.length);
    for (const row of r.rows) rows.set(Number(row[0]), Object.fromEntries(cols.map((c, j) => [c, row[j + 1]])));
  }
  const out: CleanupScan = { layout: info.name, table: table.name, scanned: rows.size, compared: [], duplicates: [], fixes: [] };
  if (ids.length > scannedIds.length) out.notScanned = ids.length - scannedIds.length;
  const picked = new Set(pick.map((f) => f.name));

  // Values against value lists: custom-value lists attached to the field (on the layout, or by validation).
  if (checks.has('valueLists')) {
    const profile = layoutProfile(store, info.name, { sample: false, privileges });
    for (const p of profile.fields) {
      if (!p.values?.length || p.name.includes('::') || !picked.has(p.name) || !rows.size) continue;
      const allowed = p.values;
      const byLower = new Map(allowed.map((v) => [lower(v.trim()), v]));
      const seen = new Map<string, number[]>();
      for (const [id, r] of rows) {
        const v = str(r[p.name]);
        if (!v || allowed.includes(v)) continue;
        // A field can hold several values from a list (checkboxes), one per line.
        if (v.includes('\r') || v.includes('\n')) {
          if (v.split(/\r\n?|\n/).every((x) => !x || allowed.includes(x))) continue;
        }
        seen.set(v, [...(seen.get(v) ?? []), id]);
      }
      for (const [v, recordIds] of seen) {
        const exact = byLower.get(lower(v.trim()));
        let to = exact;
        let reason = exact ? 'differs from the value list only in capitals or spaces' : '';
        if (!to) {
          const scored = allowed.map((a) => ({ a, s: jaroWinkler(lower(v.trim()), lower(a)) })).sort((x, y) => y.s - x.s);
          if (scored[0] && scored[0].s >= 0.88 && (scored.length < 2 || scored[0].s - scored[1].s > 0.03)) {
            to = scored[0].a;
            reason = `not in the value list ${p.valueList}; looks like a typo for "${to}"`;
          } else reason = `not in the value list ${p.valueList}`;
        }
        out.fixes.push({ check: 'valueLists', field: p.name, from: v, ...(to ? { to } : {}), reason, count: recordIds.length, recordIds: recordIds.slice(0, 500) });
      }
    }
  }

  // The same value written different ways, in text fields with no value list (checked above) and not phones or emails.
  if (checks.has('consistency') && rows.size) {
    const listed = new Set(out.fixes.map((x) => x.field));
    const profile = layoutProfile(store, info.name, { sample: false, privileges });
    const withList = new Set(profile.fields.filter((p) => p.values?.length).map((p) => p.name));
    // Not keys and codes, where a different case may be a different thing (and changing one strands related records),
    // nor notes or secrets.
    const keys = new Set(relationshipFields(owner, table.name).map(lower));
    for (const f of pick) {
      const role = roleOf(f.name);
      if (f.type !== 'text' || withList.has(f.name) || listed.has(f.name) || role === 'phone' || role === 'email') continue;
      // Only names, places and states: elsewhere a different case may mean a different thing (MB and Mb, user names).
      if (!role && !stateField(f.name)) continue;
      if (keys.has(lower(f.name)) || f.options?.validation?.unique || f.options?.autoEnter?.serial || NOT_NORMALISED.test(f.name) || secretName(f.name)) continue;
      out.fixes.push(...inconsistent(f.name, rows));
    }
  }

  // Phone numbers and email addresses, in fields named for them.
  for (const f of pick) {
    const role = roleOf(f.name);
    const check = role === 'phone' ? 'phones' : role === 'email' ? 'emails' : undefined;
    if (!check || !checks.has(check)) continue;
    let common: string | undefined;
    if (role === 'phone') {
      // The way most numbers in the field are written ("(###) ###-####") is the one to match.
      const shapes = new Map<string, number>();
      for (const r of rows.values()) {
        const v = str(r[f.name]).trim().replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '');
        if (phoneDigits(v).length === 10 && !/[a-z]/i.test(v) && !v.startsWith('+')) shapes.set(shape(v), (shapes.get(shape(v)) ?? 0) + 1);
      }
      const best = [...shapes].sort((a, b) => b[1] - a[1])[0];
      if (best && best[0].replace(/[^#]/g, '').length === 10) common = best[0];
    }
    const found = new Map<string, { to?: string; reason: string; ids: number[] }>();
    for (const [id, r] of rows) {
      const v = str(r[f.name]);
      const problem = role === 'phone' ? phoneProblem(v, common) : emailProblem(v);
      if (!problem) continue;
      const hit = found.get(v) ?? { ...problem, ids: [] };
      hit.ids.push(id);
      found.set(v, hit);
    }
    for (const [from, x] of found) out.fixes.push({ check, field: f.name, from, ...(x.to !== undefined ? { to: x.to } : {}), reason: x.reason, count: x.ids.length, recordIds: x.ids.slice(0, 500) });
  }
  out.fixes = out.fixes.sort((a, b) => b.count - a.count).slice(0, MAX_FIXES);

  if (checks.has('duplicates')) {
    const r = findDuplicates(owner, table.name, rows, pick.filter((f) => roleOf(f.name)).map((f) => f.name), privileges);
    out.compared = r.compared;
    out.duplicates = r.groups;
  }
  return out;
}

/** Likely duplicates: the same email or phone, or names nearly alike (with the same address or city when there is one). */
function findDuplicates(owner: Store, table: string, rows: Map<number, Record<string, SqlValue>>, fields: string[], privileges?: Privileges): { compared: string[]; groups: DuplicateGroup[] } {
  const by = (role: Role) => fields.filter((f) => roleOf(f) === role);
  const names = by('name');
  const emails = by('email');
  const phones = by('phone');
  const addresses = [...by('address'), ...by('postal')];
  const compared = [...names, ...emails, ...phones, ...addresses];
  if (!compared.length) return { compared, groups: [] };
  // Pairs found, with why and how alike; merged into groups after.
  const pairs: { a: number; b: number; score: number; reason: string }[] = [];
  const exact = (cols: string[], norm: (s: string) => string, what: string, score: number) => {
    const seen = new Map<string, number[]>();
    for (const [id, r] of rows) {
      for (const c of cols) {
        const k = norm(str(r[c]));
        if (k.length < 5) continue;
        seen.set(k, [...(seen.get(k) ?? []), id]);
      }
    }
    for (const [k, ids] of seen) {
      const unique = [...new Set(ids)];
      // A value shared by very many records (a switchboard number, info@) isn't one person.
      if (unique.length < 2 || unique.length > 10) continue;
      for (let i = 1; i < unique.length; i++) pairs.push({ a: unique[0], b: unique[i], score, reason: `same ${what} (${k})` });
    }
  };
  exact(emails, (s) => lower(s.trim()), 'email', 95);
  exact(phones, (s) => {
    const d = phoneDigits(s);
    return d.length >= 7 ? d : '';
  }, 'phone', 85);
  if (names.length) {
    const nameOf = (r: Record<string, SqlValue>) => normalName(names.map((n) => str(r[n])).join(' '));
    const addressOf = (r: Record<string, SqlValue>) => normalAddress(addresses.map((n) => str(r[n])).join(' '));
    const blocks = new Map<string, number[]>();
    const keyed = new Map<number, { name: string; address: string }>();
    for (const [id, r] of rows) {
      const name = nameOf(r);
      if (name.length < 3) continue;
      keyed.set(id, { name, address: addressOf(r) });
      // Compared only within a block: names starting with the same two letters, after sorting their words.
      const words = name.split(' ');
      for (const w of new Set(words.map((x) => x.slice(0, 2)))) blocks.set(w, [...(blocks.get(w) ?? []), id]);
    }
    const done = new Set<string>();
    for (const ids of blocks.values()) {
      if (ids.length > 2000) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const pair = `${Math.min(ids[i], ids[j])}:${Math.max(ids[i], ids[j])}`;
          if (done.has(pair)) continue;
          done.add(pair);
          const x = keyed.get(ids[i])!;
          const y = keyed.get(ids[j])!;
          const s = x.name === y.name ? 1 : jaroWinkler(x.name, y.name);
          const sameAddress = !!x.address && x.address === y.address;
          const otherAddress = !!x.address && !!y.address && !sameAddress && jaroWinkler(x.address, y.address) < 0.9;
          if (otherAddress) continue;
          if (s >= 0.97 || (s >= 0.9 && sameAddress)) {
            pairs.push({ a: ids[i], b: ids[j], score: Math.round(s * (sameAddress ? 100 : 92)), reason: `${x.name === y.name ? 'same name' : 'names nearly alike'}${sameAddress ? ' and address' : ''}` });
          }
        }
      }
    }
  }
  // Groups: records joined by any pair.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    while (parent.get(x) !== undefined && parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  for (const p of pairs) {
    if (!parent.has(p.a)) parent.set(p.a, p.a);
    if (!parent.has(p.b)) parent.set(p.b, p.b);
    parent.set(find(p.a), find(p.b));
  }
  const groups = new Map<number, { ids: Set<number>; score: number; reasons: Set<string> }>();
  for (const p of pairs) {
    const root = find(p.a);
    const g = groups.get(root) ?? { ids: new Set<number>(), score: 0, reasons: new Set<string>() };
    g.ids.add(p.a).add(p.b);
    g.score = Math.max(g.score, p.score);
    g.reasons.add(p.reason);
    groups.set(root, g);
  }
  const shownFields = [...new Set([...compared, ...[...rows.values()][0] ? Object.keys([...rows.values()][0]) : []])];
  const pv = privileges?.in(owner);
  const keys = mergeKeys(owner, table).filter((k) => !pv || pv.full ||
    (pv.table(k.child).view !== false && pv.field(table, k.parentField) !== 'none' && pv.field(k.child, k.childField) !== 'none'));
  const visibleChildren = new Map<string, Set<number>>();
  if (pv && !pv.full) for (const k of keys) if (!visibleChildren.has(k.child)) {
    // The child is a table, reached through the occurrence the key carries: it need not have a layout of its own name.
    const occ = occurrenceNamed(owner, k.occurrence);
    if (!occ) { visibleChildren.set(k.child, new Set()); continue; }
    visibleChildren.set(k.child, new Set(owner.findIds(owner.occurrenceInfo(occ), { privileges })));
  }
  const out = [...groups.values()].filter((g) => g.ids.size <= 20).sort((a, b) => b.score - a.score).slice(0, MAX_GROUPS).map((g) => {
    const recs = [...g.ids].sort((a, b) => a - b).map((id) => ({ recordId: id, values: rows.get(id)! }));
    const filled = (r: Record<string, SqlValue>) => Object.values(r).filter((v) => str(v).trim() !== '').length;
    const keep = [...recs].sort((a, b) => filled(b.values) - filled(a.values) || a.recordId - b.recordId)[0].recordId;
    const kept = rows.get(keep)!;
    const fill: Record<string, SqlValue> = {};
    for (const f of shownFields) {
      if (str(kept[f]).trim() !== '') continue;
      const counts = new Map<string, { v: SqlValue; n: number }>();
      for (const r of recs) {
        const v = r.values[f];
        if (str(v).trim() === '') continue;
        const c = counts.get(str(v)) ?? { v, n: 0 };
        c.n++;
        counts.set(str(v), c);
      }
      const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
      if (best) fill[f] = best.v;
    }
    const related = keys.map((k) => ({
      table: k.child, via: `${k.childField} = ${table}::${k.parentField}`,
      records: recs.filter((r) => r.recordId !== keep).reduce((n, r) => n + relatedCount(owner, k, r.recordId, keep, visibleChildren.get(k.child)), 0),
    })).filter((x) => x.records > 0);
    return { reason: [...g.reasons].join('; '), score: Math.min(100, g.score), records: recs.map((r) => ({ recordId: r.recordId, values: Object.fromEntries(compared.map((c) => [c, r.values[c] ?? null])) })), keep, fill, related };
  });
  return { compared, groups: out };
}

// --- related records ---------------------------------------------------------------

/** A relationship from the table to a child table on one key field, through which a merge moves related records. */
interface MergeKey { parent: string; parentField: string; child: string; childField: string; occurrence: string; cascade: boolean }

function mergeKeys(store: Store, table: string): MergeKey[] {
  const s = store.schema;
  const base = (toId: number) => {
    const to = s.tableOccurrences.find((t) => t.id === toId);
    return to && !to.dataSourceId ? { to, table: s.tables.find((t) => t.id === to.baseTableId) } : undefined;
  };
  const out = new Map<string, MergeKey>();
  for (const r of s.relationships) {
    if (r.predicates.length !== 1 || r.predicates[0].operator !== '=') continue;
    const p = r.predicates[0];
    for (const [mine, other, myField, otherField, cascade] of [
      [r.leftTableOccurrenceId, r.rightTableOccurrenceId, p.leftFieldId, p.rightFieldId, !!r.rightDelete],
      [r.rightTableOccurrenceId, r.leftTableOccurrenceId, p.rightFieldId, p.leftFieldId, !!r.leftDelete],
    ] as const) {
      const a = base(mine);
      const b = base(other);
      if (!a?.table || !b?.table || a.table.name !== table || b.table.name === table) continue;
      const pf = a.table.fields.find((f) => f.id === myField);
      const cf = b.table.fields.find((f) => f.id === otherField);
      if (!pf || !cf || cf.kind !== 'normal') continue;
      const key = `${b.table.name}\0${cf.name}\0${pf.name}`;
      const prev = out.get(key);
      out.set(key, { parent: table, parentField: pf.name, child: b.table.name, childField: cf.name, occurrence: b.to.name, cascade: cascade || !!prev?.cascade });
    }
  }
  return [...out.values()];
}

function unsupportedCascade(store: Store, table: string): boolean {
  const s = store.schema;
  for (const r of s.relationships) {
    for (const [mine, other, cascade] of [
      [r.leftTableOccurrenceId, r.rightTableOccurrenceId, r.rightDelete],
      [r.rightTableOccurrenceId, r.leftTableOccurrenceId, r.leftDelete],
    ] as const) {
      if (!cascade) continue;
      const parent = s.tableOccurrences.find((o) => o.id === mine);
      const child = s.tableOccurrences.find((o) => o.id === other);
      if (!parent || s.tables.find((t) => t.id === parent.baseTableId)?.name !== table) continue;
      const parentTable = s.tables.find((t) => t.id === parent.baseTableId);
      const childTable = s.tables.find((t) => t.id === child?.baseTableId);
      if (!child || parent.dataSourceId || child.dataSourceId || !childTable || childTable.name === table || r.predicates.length !== 1 || r.predicates[0].operator !== '=') return true;
      const p = r.predicates[0];
      const childField = childTable.fields.find((f) => f.id === (mine === r.leftTableOccurrenceId ? p.rightFieldId : p.leftFieldId));
      const parentField = parentTable?.fields.find((f) => f.id === (mine === r.leftTableOccurrenceId ? p.leftFieldId : p.rightFieldId));
      if (!parentField || !childField || childField.kind !== 'normal') return true;
    }
  }
  return false;
}

const occurrenceNamed = (store: Store, name: string) => {
  const to = store.schema.tableOccurrences.find((t) => t.name === name);
  return to ? occurrence(store, to.id) : undefined;
};

// Read on the file's own connection, so changes made earlier in the same transaction are seen.
const keyValue = (store: Store, table: string, field: string, id: number) =>
  (store.sql.prepare(`SELECT ${q(field)} AS v FROM ${q(table)} WHERE _fm_record_id = ?`).get(id) as { v: SqlValue } | undefined)?.v ?? null;

function relatedIds(store: Store, k: MergeKey, value: SqlValue): number[] {
  if (str(value) === '') return [];
  return (store.sql.prepare(`SELECT _fm_record_id AS id FROM ${q(k.child)} WHERE ${q(k.childField)} = ?`).all(value) as { id: number }[]).map((r) => Number(r.id));
}

function relatedCount(store: Store, k: MergeKey, from: number, to: number, visible?: Set<number>): number {
  const a = keyValue(store, k.parent, k.parentField, from);
  const b = keyValue(store, k.parent, k.parentField, to);
  return str(a) === str(b) ? 0 : relatedIds(store, k, a).filter((id) => !visible || visible.has(id)).length;
}

// --- apply and undo ---------------------------------------------------------------------

/** What takes one change back: a field set back, a deleted record put back, or a created record taken away. */
export type UndoOp =
  | { op: 'set'; occurrence: string; table: string; recordId: number; field: string; before: SqlValue; after: SqlValue }
  | { op: 'restore'; table: string; row: Record<string, SqlValue> }
  | { op: 'remove'; occurrence: string; table: string; recordId: number; values: Record<string, SqlValue> };

export interface CleanupBatch {
  id: string;
  at: string;
  account?: string;
  layout: string;
  summary: string;
  changes: number;
  undone?: string;
}

export class CleanupError extends Error {}
/** Thrown at the end of a dry run so everything it did is rolled back. */
class DryRun extends Error {}

/** What applying would do, worked out by applying and rolling back: nothing is kept, nothing journalled. */
export interface CleanupPreview {
  dryRun: true;
  summary: string;
  fixed: number;
  merged: number;
  /** Each value that would change, and each record that would be deleted (the first 200). */
  changes: ({ table: string; recordId: number; field: string; from: SqlValue; to: SqlValue } | { table: string; recordId: number; delete: true })[];
  /** How many changes in all. */
  total: number;
}

/** Runs fn as one transaction in every file it touches: all of it, or none. */
function atomically<T>(fn: () => T, quiet = false): T {
  const tx: Transaction = { files: new Map(), ...(quiet ? { quiet: true } : {}) };
  const outer = writer.getStore() ?? {};
  try {
    const r = writer.run({ ...outer, transaction: { open: tx } }, fn);
    endTransaction(tx, true);
    return r;
  } catch (e) {
    endTransaction(tx, false);
    throw e;
  }
}

export interface ApplyRequest {
  layout: string;
  /** Work out what would change, and change nothing. */
  dryRun?: boolean;
  fixes?: { field: string; from: string; to: string; recordIds?: number[] }[];
  merges?: { keep: number; remove: number[]; fill?: Record<string, SqlValue> }[];
}

/** Applies fixes and merges as the account, all or none; returns the batch, which can be undone. */
export function applyCleanup(store: Store, req: ApplyRequest & { dryRun: true }, opts: { account?: string; privileges?: Privileges }): CleanupPreview;
export function applyCleanup(store: Store, req: ApplyRequest, opts: { account?: string; privileges?: Privileges }): (CleanupBatch & { fixed: number; merged: number }) | CleanupPreview;
export function applyCleanup(store: Store, req: ApplyRequest, opts: { account?: string; privileges?: Privileges }): (CleanupBatch & { fixed: number; merged: number }) | CleanupPreview {
  const info = store.layout(req.layout);
  const owner = info.owner;
  const table = info.table;
  const fixes = Array.isArray(req.fixes) ? req.fixes : [];
  const merges = Array.isArray(req.merges) ? req.merges : [];
  if (!fixes.length && !merges.length) throw new CleanupError('Nothing to apply: pick fixes or merges');
  if (fixes.length > MAX_FIXES || merges.length > MAX_GROUPS) throw new CleanupError('Too many at once; apply them in smaller batches');
  if (merges.length && unsupportedCascade(owner, table)) throw new CleanupError('This table has a cascading relationship that cannot be safely reparented; no records were changed');
  const write = { account: opts.account, privileges: opts.privileges };
  const undo: UndoOp[] = [];
  let fixed = 0;
  let merged = 0;
  let batch: CleanupBatch | undefined;
  const current = (t: string, field: string, id: number) => keyValue(owner, t, field, id);
  // A field the account has no access to is missing to it, as in a find.
  const pv = opts.privileges?.in(owner);
  const fieldNamed = (name: string) => {
    const found = info.fields.find((x) => lower(x.name) === lower(name))?.name;
    if (!found || (pv && !pv.full && pv.field(table, found) === 'none')) throw new CleanupError(`Field "${name}" is missing`);
    return found;
  };
  const set = (occurrence: string, layoutInfo: LayoutInfo, t: string, id: number, field: string, value: SqlValue) => {
    const before = current(t, field, id);
    if (str(before) === str(value)) return false;
    owner.update(layoutInfo, id, { [field]: value === null ? '' : value as string | number }, undefined, write);
    undo.push({ op: 'set', occurrence, table: t, recordId: id, field, before, after: current(t, field, id) });
    return true;
  };
  try {
    atomically(() => {
      apply();
      // The same checks and writes as applying, as the account, then all of it rolled back.
      if (req.dryRun === true) throw new DryRun();
      const summary = [fixed ? `${fixed} value${fixed === 1 ? '' : 's'} fixed` : '', merged ? `${merged} set${merged === 1 ? '' : 's'} of duplicates merged` : ''].filter(Boolean).join(', ') || 'nothing changed';
      batch = new CleanupJournal(owner).add({ account: opts.account, layout: info.name, summary, undo });
    }, req.dryRun === true);
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  const summary = [fixed ? `${fixed} value${fixed === 1 ? '' : 's'} fixed` : '', merged ? `${merged} set${merged === 1 ? '' : 's'} of duplicates merged` : ''].filter(Boolean).join(', ') || 'nothing changed';
  if (req.dryRun === true) {
    const changes = undo.map((u) => (u.op === 'set' ? { table: u.table, recordId: u.recordId, field: u.field, from: u.before, to: u.after } : { table: u.table, recordId: u.op === 'restore' ? Number(u.row._fm_record_id) : u.recordId, delete: true as const }));
    return { dryRun: true, summary: summary.replace(/ fixed/, ' to fix').replace(/ merged/, ' to merge'), fixed, merged, changes: changes.slice(0, 200), total: changes.length };
  }
  return { ...batch!, fixed, merged };

  function apply(): void {
    for (const f of fixes) {
      if (typeof f.field !== 'string' || typeof f.from !== 'string' || typeof f.to !== 'string') throw new CleanupError('Each fix needs field, from and to');
      const field = fieldNamed(f.field);
      // Only records that still have the value found (and the account may see).
      const ids = new Set(store.findIds(info, { privileges: opts.privileges }));
      const having = (owner.sql.prepare(`SELECT _fm_record_id AS id FROM ${q(table)} WHERE ${q(field)} = ?`).all(f.from) as { id: number }[]).map((r) => Number(r.id))
        .filter((id) => ids.has(id) && (!f.recordIds?.length || f.recordIds.includes(id)));
      for (const id of having) if (set(info.occurrence, info, table, id, field, f.to)) fixed++;
    }
    const keys = mergeKeys(owner, table);
    for (const m of merges) {
      const keep = Number(m.keep);
      const remove = (Array.isArray(m.remove) ? m.remove : []).map(Number).filter((id) => id !== keep);
      if (!Number.isInteger(keep) || !remove.length) throw new CleanupError('Each merge needs keep and the records to remove');
      const viewable = new Set(store.findIds(info, { privileges: opts.privileges }));
      for (const id of [keep, ...remove]) if (!viewable.has(id)) throw new CleanupError(`Record ${id} is missing`);
      // Related records move to the kept record first, so deleting the others takes none of them along.
      for (const k of keys) {
        // The key's values go into the preview and the error messages, so an account that can't read the key (hidden or masked) can't merge through it.
        if (pv && !pv.full && pv.field(table, k.parentField) === 'none') throw new CleanupError(`Field "${table}::${k.parentField}" is missing, and the related ${k.child} records move by it`);
        const to = keyValue(owner, table, k.parentField, keep);
        for (const id of remove) {
          const from = keyValue(owner, table, k.parentField, id);
          if (str(from) === '') continue;
          if (str(from) === str(to)) {
            if (k.cascade && relatedIds(owner, k, from).length) {
              throw new CleanupError(`Records ${keep} and ${id} share the key ${k.parentField} = ${str(from)}, and deleting ${id} would delete their ${k.child} records; change one key first`);
            }
            continue;
          }
          if (str(to) === '') throw new CleanupError(`Record ${keep} has no ${k.parentField}, so record ${id}'s ${k.child} records can't move to it`);
          const occ = occurrenceNamed(owner, k.occurrence);
          if (!occ) continue;
          const childInfo = owner.occurrenceInfo(occ);
          for (const child of relatedIds(owner, k, from)) set(k.occurrence, childInfo, k.child, child, k.childField, to);
        }
      }
      for (const [field, value] of Object.entries(m.fill && typeof m.fill === 'object' ? m.fill : {})) {
        const name = fieldNamed(field);
        if (str(current(table, name, keep)).trim() === '') set(info.occurrence, info, table, keep, name, value);
      }
      for (const id of remove) {
        const values = owner.sql.prepare(`SELECT * FROM ${q(table)} WHERE _fm_record_id = ?`).get(id) as Record<string, SqlValue>;
        owner.delete(info, id, write);
        undo.push({ op: 'restore', table, row: values });
      }
      merged++;
    }
  }
}

/** At most this many records' values are kept to undo a bulk change; a larger one can't be undone. */
const MAX_UNDO_RECORDS = 50_000;

/** A field's values in records before a bulk change (Replace Field Contents), to journal it so it can be undone. */
export interface FieldSnapshot { layout: string; occurrence: string; table: string; field: string; before: Map<number, SqlValue> }

/**
 * The values of a field of the layout's own table in the given records, or undefined
 * when the change couldn't be undone (a related or unstored field, or too many records).
 */
export function snapshotField(store: Store, layout: string, field: string, ids: number[]): FieldSnapshot | undefined {
  if (!ids.length || ids.length > MAX_UNDO_RECORDS) return undefined;
  const info = store.layout(layout);
  if (info.owner !== store) return undefined;
  const at = field.indexOf('::');
  if (at >= 0 && field.slice(0, at) !== info.occurrence) return undefined;
  const name = info.fields.find((x) => lower(x.name) === lower(at >= 0 ? field.slice(at + 2) : field))?.name;
  if (!name) return undefined;
  const before = new Map<number, SqlValue>();
  try {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = store.sql.prepare(`SELECT _fm_record_id AS id, ${q(name)} AS v FROM ${q(info.table)} WHERE _fm_record_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as { id: number; v: SqlValue }[];
      for (const r of rows) before.set(Number(r.id), r.v);
    }
  } catch {
    return undefined; // not a stored column (a calculation or summary)
  }
  return { layout: info.name, occurrence: info.occurrence, table: info.table, field: name, before };
}

/**
 * Several fields' values (Find/Replace's Replace All), or undefined when any of them can't be
 * snapshot: a related or unstored field, or too many records. Undo would otherwise be partial.
 */
export function snapshotFields(store: Store, layout: string, fields: string[], ids: number[]): FieldSnapshot[] | undefined {
  const out: FieldSnapshot[] = [];
  for (const f of new Set(fields.map((x) => x.replace(/\(\d+\)$/, '')))) {
    const s = snapshotField(store, layout, f, ids);
    if (!s) return undefined;
    if (!out.some((x) => x.field === s.field)) out.push(s);
  }
  return out.length ? out : undefined;
}

/**
 * Journals what changed since the snapshot (or snapshots) as one batch that can be undone;
 * undefined when nothing changed. The summary gets the number of records changed.
 */
export function journalFieldChange(store: Store, snaps: FieldSnapshot | FieldSnapshot[], account: string | undefined, summary: (changed: number) => string): CleanupBatch | undefined {
  const undo: UndoOp[] = [];
  const list = Array.isArray(snaps) ? snaps : [snaps];
  for (const snap of list) {
    for (const [id, before] of snap.before) {
      const after = keyValue(store, snap.table, snap.field, id);
      if (str(after) !== str(before)) undo.push({ op: 'set', occurrence: snap.occurrence, table: snap.table, recordId: id, field: snap.field, before, after });
    }
  }
  const records = new Set(undo.map((x) => (x as { recordId?: number }).recordId)).size;
  return undo.length ? new CleanupJournal(store).add({ account, layout: list[0].layout, summary: summary(records), undo }) : undefined;
}

/** At most this many deleted records are kept to undo a delete; a larger one can't be undone. */
const MAX_UNDO_DELETES = 10_000;

/** Records about to be deleted (Delete All Records), whole, to journal the delete so it can be undone. */
export interface RowsSnapshot { layout: string; table: string; rows: Map<number, Record<string, SqlValue>> }

/**
 * The records' rows, or undefined when a delete couldn't be undone: too many records, a table
 * in another file, or a relationship that deletes related records with them (those wouldn't come back).
 */
export function snapshotRows(store: Store, layout: string, ids: number[]): RowsSnapshot | undefined {
  if (!ids.length || ids.length > MAX_UNDO_DELETES) return undefined;
  const info = store.layout(layout);
  if (info.owner !== store) return undefined;
  const s = store.schema;
  const mine = new Set(s.tableOccurrences.filter((t) => !t.dataSourceId && s.tables.find((x) => x.id === t.baseTableId)?.name === info.table).map((t) => t.id));
  if (s.relationships.some((r) => (r.rightDelete && mine.has(r.leftTableOccurrenceId)) || (r.leftDelete && mine.has(r.rightTableOccurrenceId)))) return undefined;
  const rows = new Map<number, Record<string, SqlValue>>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of store.sql.prepare(`SELECT * FROM ${q(info.table)} WHERE _fm_record_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Record<string, SqlValue>[]) rows.set(Number(r._fm_record_id), r);
  }
  return { layout: info.name, table: info.table, rows };
}

/** Journals the records of the snapshot that are gone now as one batch that can be undone; undefined when none went. */
export function journalDeletes(store: Store, snap: RowsSnapshot, account: string | undefined, summary: (deleted: number) => string): CleanupBatch | undefined {
  const undo: UndoOp[] = [];
  for (const [id, row] of snap.rows) {
    if (!store.sql.prepare(`SELECT 1 FROM ${q(snap.table)} WHERE _fm_record_id = ?`).get(id)) undo.push({ op: 'restore', table: snap.table, row });
  }
  return undo.length ? new CleanupJournal(store).add({ account, layout: snap.layout, summary: summary(undo.length), undo }) : undefined;
}

/** Most records one bulk update changes. */
export const MAX_UPDATE_MANY = 1000;

export interface UpdateManyRequest {
  layout: string;
  /** The find that picks the records. Left out, every record, and expectCount is then required. */
  query?: FindRequest[];
  /** Field -> new value (null empties it), for fields of the layout's own table. */
  fieldData: Record<string, string | number | null>;
  /** Work out what would change, and change nothing. */
  dryRun?: boolean;
  /** Refuse unless the find gives exactly this many records. */
  expectCount?: number;
}

export interface UpdateManyPreview {
  dryRun: true;
  summary: string;
  matched: number;
  records: number;
  /** Each value that would change (the first 200). */
  changes: { recordId: number; field: string; from: SqlValue; to: SqlValue }[];
  total: number;
}

/** Sets the same fields on every record a find gives, as the account, all or none; returns the batch, which undo_data_fix takes back. */
export function updateMany(store: Store, req: UpdateManyRequest & { dryRun: true }, opts: { account?: string; privileges?: Privileges }): UpdateManyPreview;
export function updateMany(store: Store, req: UpdateManyRequest, opts: { account?: string; privileges?: Privileges }): (CleanupBatch & { matched: number; records: number }) | UpdateManyPreview;
export function updateMany(store: Store, req: UpdateManyRequest, opts: { account?: string; privileges?: Privileges }): (CleanupBatch & { matched: number; records: number }) | UpdateManyPreview {
  const info = store.layout(req.layout);
  const owner = info.owner;
  const table = info.table;
  const entries = Object.entries(req.fieldData && typeof req.fieldData === 'object' ? req.fieldData : {});
  if (!entries.length) throw new CleanupError('Nothing to set: give fieldData');
  const hasQuery = Array.isArray(req.query) && req.query.length > 0;
  if (!hasQuery && req.expectCount === undefined) throw new CleanupError('Give a query, or expectCount (the number of records in the table) to change every record');
  const pv = opts.privileges?.in(owner);
  const values = new Map<string, string | number>();
  for (const [key, value] of entries) {
    const name = key.includes('::') ? (key.split('::')[0] === info.occurrence ? key.slice(key.indexOf('::') + 2) : '') : key;
    if (!name && key.includes('::')) throw new CleanupError(`Field "${key}" is not in this layout's own table; only ${info.occurrence}'s fields can be set here`);
    const found = info.fields.find((x) => lower(x.name) === lower(name))?.name;
    if (!found || (pv && !pv.full && pv.field(table, found) === 'none')) throw new StoreError(201, `Field "${key}" is missing or cannot be modified`);
    values.set(found, value === null ? '' : value);
  }
  const ids = store.findIds(info, { query: hasQuery ? req.query : undefined, privileges: opts.privileges });
  if (req.expectCount !== undefined && ids.length !== req.expectCount) throw new CleanupError(`The find gives ${ids.length} records, not the ${req.expectCount} expected; nothing changed`);
  if (ids.length > MAX_UPDATE_MANY) throw new CleanupError(`The find gives ${ids.length} records; at most ${MAX_UPDATE_MANY} can change at once, so narrow the find`);
  const write = { account: opts.account, privileges: opts.privileges, dataEntry: true };
  const undo: UndoOp[] = [];
  const changes: UpdateManyPreview['changes'] = [];
  const touched = new Set<number>();
  let batch: CleanupBatch | undefined;
  const apply = () => {
    for (const id of ids) {
      const before = new Map([...values.keys()].map((f) => [f, keyValue(owner, table, f, id)]));
      try {
        owner.update(info, id, Object.fromEntries(values), undefined, write);
      } catch (e) {
        if (e instanceof StoreError) throw new StoreError(e.code, `Record ${id}: ${e.message}; nothing changed`, e.denial);
        throw new CleanupError(`Record ${id}: ${e instanceof Error ? e.message : String(e)}; nothing changed`);
      }
      for (const [f, was] of before) {
        const now = keyValue(owner, table, f, id);
        if (str(was) === str(now)) continue;
        undo.push({ op: 'set', occurrence: info.occurrence, table, recordId: id, field: f, before: was, after: now });
        changes.push({ recordId: id, field: f, from: was, to: now });
        touched.add(id);
      }
    }
  };
  try {
    atomically(() => {
      apply();
      if (req.dryRun === true) throw new DryRun();
      if (undo.length) batch = new CleanupJournal(owner).add({ account: opts.account, layout: info.name,
        summary: `${touched.size} of ${ids.length} record${ids.length === 1 ? '' : 's'} changed`, undo });
    }, req.dryRun === true);
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  const summary = `${touched.size} of ${ids.length} record${ids.length === 1 ? '' : 's'} changed`;
  if (req.dryRun === true) {
    return {
      dryRun: true, summary: summary.replace(/ changed$/, ' to change'), matched: ids.length, records: touched.size,
      changes: changes.slice(0, 200), total: changes.length,
    };
  }
  if (!undo.length) return { id: '', at: new Date().toISOString(), layout: info.name, summary, changes: 0, matched: ids.length, records: 0 };
  return { ...batch!, matched: ids.length, records: touched.size };
}

/** Takes an applied batch back, all or none. Fields changed again since are left alone and listed. */
export function undoCleanup(store: Store, id: string, opts: { account?: string; privileges?: Privileges }): { undone: number; skipped: string[] } {
  const journal = new CleanupJournal(store);
  const batch = journal.get(id);
  if (!batch) throw new CleanupError('No such cleanup');
  if (batch.undone) throw new CleanupError('Already undone');
  // A batch is undone by whoever made it, or by [Full Access]: no one takes back another account's changes.
  if (opts.privileges && !opts.privileges.full && (batch.account ?? '').toLowerCase() !== (opts.account ?? '').toLowerCase()) throw new CleanupError('Only the account that made these changes, or a full-access account, can undo them');
  const write = { account: opts.account, privileges: opts.privileges };
  let undone = 0;
  const skipped: string[] = [];
  atomically(() => {
    for (const op of [...batch.undo].reverse()) {
      if (op.op === 'remove') {
        // A record the batch made goes again, unless someone has changed it since.
        const now = store.sql.prepare(`SELECT * FROM ${q(op.table)} WHERE _fm_record_id = ?`).get(op.recordId) as Record<string, SqlValue> | undefined;
        if (!now) continue;
        const occ = occurrenceNamed(store, op.occurrence);
        if (!occ || Object.entries(op.values).some(([k, v]) => k in now && str(now[k]) !== str(v))) {
          skipped.push(`record ${op.recordId} of ${op.table} (${occ ? 'changed since' : 'its table occurrence is gone'})`);
          continue;
        }
        store.delete(store.occurrenceInfo(occ), op.recordId, write);
        undone++;
        continue;
      }
      if (op.op === 'restore') {
        store.restoreDeletedRow(op.table, op.row, write);
        undone++;
        continue;
      }
      const now = store.sql.prepare(`SELECT ${q(op.field)} AS v FROM ${q(op.table)} WHERE _fm_record_id = ?`).get(op.recordId) as { v: SqlValue } | undefined;
      if (!now || str(now.v) !== str(op.after)) {
        skipped.push(`${op.table}::${op.field} of record ${op.recordId} (changed since)`);
        continue;
      }
      const occ = occurrenceNamed(store, op.occurrence);
      if (!occ) {
        skipped.push(`${op.table}::${op.field} of record ${op.recordId} (its table occurrence is gone)`);
        continue;
      }
      store.update(store.occurrenceInfo(occ), op.recordId, { [op.field]: op.before === null ? '' : op.before as string | number }, undefined, { ...write, restoring: true });
      undone++;
    }
    journal.markUndone(id);
  });
  return { undone, skipped };
}

/** Batches applied, with what takes each back, kept in the file. */
class CleanupJournal {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
    this.store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_cleanup (id TEXT PRIMARY KEY, at TEXT NOT NULL, account TEXT, layout TEXT NOT NULL,
      summary TEXT NOT NULL, changes INTEGER NOT NULL, undo TEXT NOT NULL, undone TEXT)`);
  }

  /** More to take back in a batch already kept (a run whose steps are approved one at a time), with its summary now. */
  append(id: string, undo: UndoOp[], summary: string): void {
    const b = this.get(id);
    if (!b || b.undone) throw new CleanupError('No such batch to add to');
    const all = [...b.undo, ...undo];
    this.store.sql.prepare('UPDATE _fm_cleanup SET undo = ?, changes = ?, summary = ? WHERE id = ?').run(JSON.stringify(all), all.length, summary, id);
  }

  add(b: { account?: string; layout: string; summary: string; undo: UndoOp[] }): CleanupBatch {
    const batch: CleanupBatch = { id: randomBytes(6).toString('hex'), at: new Date().toISOString(), ...(b.account ? { account: b.account } : {}), layout: b.layout, summary: b.summary, changes: b.undo.length };
    this.store.sql.prepare('INSERT INTO _fm_cleanup (id, at, account, layout, summary, changes, undo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(batch.id, batch.at, batch.account ?? null, batch.layout, batch.summary, batch.changes, JSON.stringify(b.undo));
    return batch;
  }

  get(id: string): (CleanupBatch & { undo: UndoOp[] }) | undefined {
    const r = this.store.sql.prepare('SELECT * FROM _fm_cleanup WHERE id = ?').get(id) as unknown as Row | undefined;
    return r ? { ...fromRow(r), undo: JSON.parse(r.undo) } : undefined;
  }

  list(limit = 50): CleanupBatch[] {
    return (this.store.sql.prepare('SELECT * FROM _fm_cleanup ORDER BY at DESC, rowid DESC LIMIT ?').all(limit) as unknown as Row[]).map(fromRow);
  }

  markUndone(id: string): void {
    this.store.sql.prepare('UPDATE _fm_cleanup SET undone = ? WHERE id = ?').run(new Date().toISOString(), id);
  }
}

interface Row { id: string; at: string; account: string | null; layout: string; summary: string; changes: number; undo: string; undone: string | null }
const fromRow = (r: Row): CleanupBatch => ({ id: r.id, at: r.at, ...(r.account ? { account: r.account } : {}), layout: r.layout, summary: r.summary, changes: r.changes, ...(r.undone ? { undone: r.undone } : {}) });

export const cleanupHistory = (store: Store) => new CleanupJournal(store).list();
/** Keeps a batch of changes made elsewhere (an assistant's run), so it shows in the history and can be undone like a cleanup. */
export const journalBatch = (store: Store, b: { account?: string; layout: string; summary: string; undo: UndoOp[] }) => new CleanupJournal(store).add(b);
export const appendToBatch = (store: Store, id: string, undo: UndoOp[], summary: string) => new CleanupJournal(store).append(id, undo, summary);

// --- HTTP --------------------------------------------------------------------------------

export class CleanupApi {
  private readonly host: Host;
  private readonly api: DataApi;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/cleanup\/v1\/databases\/([^/]+)\/(scan|apply|history)(?:\/([0-9a-f]{12})\/undo)?$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const db = decodeURIComponent(m[1]);
      const session = this.api.authorize(req, db);
      const store = this.host.get(db);
      if (!store) throw new ApiError(802, 'Unable to open file', 404);
      const privileges = sessionPrivileges(store, session);
      const who = { account: session.account, privileges };
      if (m[2] === 'scan' && req.method === 'POST') {
        const body = await readJson(req);
        const checks = Array.isArray(body.checks) ? body.checks.filter((c: unknown): c is Check => CHECKS.includes(c as Check)) : undefined;
        const fields = Array.isArray(body.fields) ? body.fields.filter((f: unknown): f is string => typeof f === 'string') : undefined;
        send(200, scanData(store, { layout: said(body.layout), checks, fields }, privileges));
      } else if (m[2] === 'apply' && req.method === 'POST') {
        send(200, applyCleanup(store, await readJson(req) as unknown as ApplyRequest, who));
      } else if (m[2] === 'history' && !m[3] && req.method === 'GET') {
        send(200, { history: cleanupHistory(store) });
      } else if (m[2] === 'history' && m[3] && req.method === 'POST') {
        send(200, undoCleanup(store, m[3], who));
      } else throw new ApiError(3, 'Not supported', 405);
    } catch (e) {
      const err = e instanceof ApiError ? e : e instanceof URIError ? badPathError() : e instanceof CleanupError ? new ApiError(960, e.message, 400) : e instanceof StoreError ? new ApiError(e.code, e.message, e.code === 200 || e.code === 201 ? 403 : 400) : new ApiError(-1, 'Unknown error');
      if (!(e instanceof URIError) && !(e instanceof ApiError) && !(e instanceof CleanupError) && !(e instanceof StoreError)) console.error(e);
      send(err.status, { error: { code: err.code, message: err.message } });
    }
    return true;
  }
}
/** One cleanup batch with what it changed (its undo list), for record histories. */
export const cleanupBatchById = (store: Store, id: string) => new CleanupJournal(store).get(id);
