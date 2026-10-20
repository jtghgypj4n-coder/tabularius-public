// Personal data isolation: a per-file switch that keeps personal data away from AI models. With it on, every value
// that could identify someone (names, emails, phone numbers, addresses, ids, dates of birth, free text) is swapped
// for a stand-in such as <PERSON_3> before a prompt or a tool result leaves the server, and swapped back in what
// people see (the assistant's answer, its proposals, the records an AI client writes). Each stand-in is kept in the
// file (_fm_pii_vault, which no SQL can read), per account, so the same value always gets the same stand-in and an
// account can only turn back stand-ins it was given. Fields are worked out from their names, types and a sample of
// their values; a text field nothing says is safe counts as personal (fail closed). An administrator can mark any
// field either way. Tools whose results can't be checked field by field (SQL, free formulas, scripts, record
// history...) are refused while it is on.

import type { Store } from '../../store/src/index.ts';
import { dataSourceFile } from '../../store/src/import.ts';
import type { Field } from '../../fmp12/src/index.ts';

export type PiiKind = 'PERSON' | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'ID' | 'CARD' | 'DATE' | 'TEXT' | 'FILE';
const KINDS: PiiKind[] = ['PERSON', 'EMAIL', 'PHONE', 'ADDRESS', 'ID', 'CARD', 'DATE', 'TEXT', 'FILE'];

/** How a field is treated: personal (its values become stand-ins) or not, and why, for the admin console. */
export interface FieldClass {
  pii: boolean;
  kind?: PiiKind;
  why: string;
  /** Set by an administrator rather than worked out. */
  marked?: boolean;
}

// --- Which file's switch applies ---------------------------------------------

/** The file whose isolation applies to this one: itself, or a hosted file it uses (whose fields can show here). */
export function piiFile(store: Store): Store | undefined {
  const seen = new Set<Store>();
  const visit = (s: Store): Store | undefined => {
    if (seen.has(s)) return undefined;
    seen.add(s);
    if (s.piiIsolation) return s;
    for (const d of s.schema.dataSources) {
      let other: Store | undefined;
      try {
        other = s.resolveFile(dataSourceFile(d.paths) ?? d.name) as Store | undefined;
      } catch {
        other = undefined;
      }
      const hit = other && other !== s ? visit(other) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return visit(store);
}

// --- Field classification ------------------------------------------------------

const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.#/]+/g, ' ').toLowerCase();

/** Names that say what personal data a field holds, most specific first. */
const NAME_KINDS: [RegExp, PiiKind][] = [
  [/e ?mail/, 'EMAIL'],
  [/\b(?:phone|telephone|tel|mobile|cell|fax|whats ?app)\b/, 'PHONE'],
  [/\b(?:ssn|social security|national (?:id|insurance)|nin|passport|licen[cs]e|tax ?id|tin|ein|nhs|medicare|medicaid|insurance (?:no|number|id)|policy (?:no|number))\b/, 'ID'],
  [/\b(?:iban|swift|bic|routing|sort code|acct|account (?:no|num|number)|bank)\b/, 'ID'],
  [/\b(?:card|credit|cvv|cvc|expiry)\b/, 'CARD'],
  [/\b(?:dob|birth|birthday|bday|born)\b/, 'DATE'],
  [/\b(?:address|addr|street|st(?:reet)? (?:no|number)|city|town|suburb|county|zip|zip ?code|post ?code|postal|apt|suite|lat|latitude|lon|lng|longitude|geo|location|ip)\b/, 'ADDRESS'],
  [/\b(?:name|first|last|middle|given|surname|family|nick|maiden|full ?name|contact|customer|client|patient|employee|staff|person|people|owner|manager|salesperson|rep|spouse|guardian|parent|recipient|sender|attn|attention|signed|signature|user|login|account)\b|person|name/, 'PERSON'],
  [/\b(?:salary|wage|income|pay|gender|sex|ethnic|ethnicity|race|religion|medical|diagnosis|health|allerg\w*|medication|disability|hiv|blood|icd|condition|symptoms?|treatment|prescription|pregnan\w*|therapy|note|notes|comment|comments|memo|remark|remarks|message|body|bio|description|details?|reason)\b/, 'TEXT'],
];

/** Names of fields that hold codes and categories rather than anything about a person. */
const SAFE_NAME = /\b(?:id|ids|key|keys|pk|fk|kp|kf|uuid|guid|serial|code|sku|status|state|type|kind|category|stage|flag|priority|level|currency|unit|units|color|colour|size|language|format|mode|source|channel|tag|tags|version|year|month|day|quarter|count|qty|quantity|amount|total|price|cost|rate|percent|sort|order|seq|sequence|active|enabled|deleted|archived)\b/;

const KEY_NAME = /\b(?:id|key|uuid|guid|serial|pk|fk)\s*$|^\s*(?:kp|kf|pk|fk|zk|k)\s/;

const PATTERNS: [RegExp, PiiKind][] = [
  // The lookbehind starts a match only where an address can start, so a long run with no @ is scanned once, not once per character.
  [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, 'EMAIL'],
  [/(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])/g, 'ID'],
  [/(?<![\w-])(?:\d[ -]?){12,18}\d(?![\w-])/g, 'CARD'],
  [/(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)\s?|\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}(?![\w])/g, 'PHONE'],
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** A pattern match that really is that kind of value (a card number passes its check digit; a phone has 7 to 15 digits). */
function patternHit(kind: PiiKind, text: string): boolean {
  const digits = text.replace(/\D/g, '');
  if (kind === 'CARD') return digits.length >= 13 && digits.length <= 19 && luhn(digits);
  if (kind === 'PHONE') return digits.length >= 7 && digits.length <= 15;
  return true;
}

/** The kind of personal data a value looks like, by pattern; undefined when nothing matches it whole. */
export function valueKind(v: string): PiiKind | undefined {
  const t = v.trim();
  for (const [re, kind] of PATTERNS) {
    const whole = new RegExp(`^(?:${re.source})$`);
    if (whole.test(t) && patternHit(kind, t)) return kind;
  }
  return undefined;
}

const nameKind = (name: string): PiiKind | undefined => NAME_KINDS.find(([re]) => re.test(words(name)))?.[1];

const SAMPLE = 200;

/** One field, worked out from its name, type and (for text nothing else decides) a sample of its values. */
function classifyField(store: Store, table: string, f: Field, valueListFields: Set<number>): FieldClass {
  const byName = nameKind(f.name);
  const auto = f.options?.autoEnter?.value;
  if (auto === 'creationName' || auto === 'modificationName' || auto === 'creationAccountName' || auto === 'modificationAccountName') {
    return { pii: true, kind: 'PERSON', why: 'holds who made or changed the record' };
  }
  if (f.type === 'container') return { pii: true, kind: 'FILE', why: 'a container: files and pictures can show anyone' };
  const named = (k: PiiKind): FieldClass => ({ pii: true, kind: k, why: `its name says it holds ${KIND_WORDS[k]}` });
  if (byName && byName !== 'PERSON' && byName !== 'ADDRESS' && byName !== 'TEXT') return named(byName);
  // A record's key (Customer ID, kf_ContactID): a number the file makes up, not anything about the person. A text
  // "key" can be made from a name (Sort Key, Match Key), so text is judged by its values below.
  if (f.type === 'number' && KEY_NAME.test(words(f.name))) return { pii: false, why: 'its name says it is a key or serial number' };
  if (byName) return named(byName);
  // A looked-up value copies another record's field, which may be personal.
  if (f.options?.autoEnter?.lookup && f.type === 'text') return { pii: true, kind: 'TEXT', why: 'a looked-up value from another record: counted as personal to be safe' };
  if (f.kind === 'summary') {
    return f.summary?.type === 'list' ? { pii: true, kind: 'TEXT', why: 'a List of summary: it repeats other fields\' values' } : { pii: false, why: 'a summary of numbers' };
  }
  if (f.type === 'number' || f.type === 'date' || f.type === 'time' || f.type === 'timestamp') return { pii: false, why: `a ${f.type} field whose name says nothing personal` };
  if (valueListFields.has(f.id)) return { pii: false, why: 'it must be one of a value list\'s values' };
  const safeName = SAFE_NAME.test(words(f.name)) || KEY_NAME.test(words(f.name));
  // Text nothing above decides: look at what it holds.
  let values: string[] = [];
  try {
    if (!f.options?.global && !(f.kind === 'calculation' && f.options?.unstored)) {
      const q = `"${f.name.replace(/"/g, '""')}"`;
      values = store.query(`SELECT ${q} AS v FROM "${table.replace(/"/g, '""')}" WHERE ${q} IS NOT NULL AND ${q} <> '' LIMIT ${SAMPLE}`, SAMPLE)
        .map((r) => String(r.v ?? '')).filter(Boolean);
    }
  } catch {
    values = [];
  }
  if (!values.length) return { pii: true, kind: 'TEXT', why: 'text with no values to check: counted as personal to be safe' };
  const hits = new Map<PiiKind, number>();
  for (const v of values) {
    const k = valueKind(v);
    if (k) hits.set(k, (hits.get(k) ?? 0) + 1);
  }
  const top = [...hits].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= Math.max(1, values.length * 0.2)) return { pii: true, kind: top[0], why: `its values look like ${KIND_WORDS[top[0]]}` };
  const distinct = new Set(values.map((v) => v.trim().toLowerCase())).size;
  if (values.length >= 20 && distinct <= Math.min(12, values.length / 5) && values.every((v) => v.length <= 40)) {
    return { pii: false, why: `it holds a few repeated values (${distinct}), like a category` };
  }
  // A code, key or category by name, holding codes (no spaces, no words of a name): INV-0042, AB12, red.
  if (safeName && values.every((v) => v.length <= 40 && /^[\p{L}\p{N}._#/-]+$/u.test(v.trim()))) return { pii: false, why: 'its name and values say it holds codes' };
  return { pii: true, kind: 'TEXT', why: 'free text: counted as personal to be safe' };
}

const KIND_WORDS: Record<PiiKind, string> = {
  PERSON: 'names', EMAIL: 'email addresses', PHONE: 'phone numbers', ADDRESS: 'addresses or locations', ID: 'id or account numbers',
  CARD: 'card numbers', DATE: 'dates of birth', TEXT: 'personal or free text', FILE: 'files',
};

interface Classes { schema: unknown; marks: string; at: number; tables: Map<string, Map<string, FieldClass>> }
const cache = new WeakMap<Store, Classes>();
/** Sampled classes are worked out again after this long, as data changes. */
const CLASS_MS = 10 * 60_000;

/** Every field of every table in the file, worked out (marks applied); cached until the design, a mark or ten minutes changes it. */
export function fieldClasses(store: Store): Map<string, Map<string, FieldClass>> {
  const marks = store.piiFieldMarks();
  const marksKey = JSON.stringify(marks);
  const hit = cache.get(store);
  if (hit && hit.schema === store.schema && hit.marks === marksKey && performance.now() - hit.at < CLASS_MS) return hit.tables;
  const valueListFields = new Set<number>();
  for (const t of store.schema.tables) for (const f of t.fields) if (f.options?.validation?.valueList !== undefined) valueListFields.add(f.id);
  const marked = new Map(Object.entries(marks).map(([k, v]) => [k.toLowerCase(), v]));
  const tables = new Map<string, Map<string, FieldClass>>();
  for (const t of store.schema.tables) {
    const m = new Map<string, FieldClass>();
    for (const f of t.fields) {
      const mark = marked.get(`${t.name}::${f.name}`.toLowerCase());
      const worked = classifyField(store, t.name, f, valueListFields);
      m.set(f.name.toLowerCase(), mark === undefined ? worked
        : { pii: mark, ...(mark ? { kind: worked.kind ?? nameKind(f.name) ?? 'TEXT' } : {}), why: mark ? 'marked as personal data by an administrator' : 'marked as not personal data by an administrator', marked: true });
    }
    tables.set(t.name.toLowerCase(), m);
  }
  // A calculation (or auto-enter calculation) that reads a personal field is personal itself, whatever its name:
  // Substitute ( Full Name ; " " ; "_" ) still shows the name. Repeated so a calculation of such a calculation follows.
  const personalNames = () => [...tables].flatMap(([, m]) => [...m].filter(([, c]) => c.pii).map(([n]) => n));
  for (let changed = true, round = 0; changed && round < 10; round++) {
    changed = false;
    const names = personalNames();
    for (const t of store.schema.tables) {
      const m = tables.get(t.name.toLowerCase())!;
      for (const f of t.fields) {
        const c = m.get(f.name.toLowerCase())!;
        if (c.pii || c.marked || !f.calculation) continue;
        const formula = f.calculation.toLowerCase();
        const read = names.find((n) => new RegExp(`(?:^|[^\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u').test(formula));
        if (read) {
          m.set(f.name.toLowerCase(), { pii: true, kind: 'TEXT', why: `a calculation that reads a personal field (${read})` });
          changed = true;
        }
      }
    }
  }
  cache.set(store, { schema: store.schema, marks: marksKey, at: performance.now(), tables });
  return tables;
}

/** Forget worked-out classes (after a mark, or in tests after seeding data). */
export function forgetClasses(store: Store): void {
  cache.delete(store);
}

const PERSONAL: FieldClass = { pii: true, kind: 'TEXT', why: 'not found: counted as personal to be safe' };

/**
 * How a field shown through `occurrence` is treated: the field of its base table (in this file or the hosted file a
 * data source names). Anything that can't be traced counts as personal.
 */
export function classOf(store: Store, occurrence: string | undefined, field: string): FieldClass {
  const name = field.replace(/\(\d+\)$/, '').toLowerCase();
  if (!occurrence) {
    // A bare name: personal if any table's field of that name is, or none has it.
    let found = false;
    for (const t of fieldClasses(store).values()) {
      const c = t.get(name);
      if (!c) continue;
      if (c.pii) return c;
      found = true;
    }
    return found ? { pii: false, why: 'not personal in any table that has it' } : PERSONAL;
  }
  const to = store.schema.tableOccurrences.find((o) => o.name.toLowerCase() === occurrence.toLowerCase());
  if (!to) return PERSONAL;
  let file: Store | undefined = store;
  if (to.dataSourceId !== undefined) {
    const d = store.schema.dataSources.find((x) => x.id === to.dataSourceId);
    try {
      file = d ? store.resolveFile(dataSourceFile(d.paths) ?? d.name) as Store | undefined : undefined;
    } catch {
      file = undefined;
    }
  }
  const table = file?.schema.tables.find((t) => t.id === to.baseTableId);
  if (!file || !table) return PERSONAL;
  return fieldClasses(file).get(table.name.toLowerCase())?.get(name) ?? PERSONAL;
}

/** The table occurrence a layout shows records from. */
export function layoutOccurrence(store: Store, layout: unknown): string | undefined {
  if (typeof layout !== 'string') return undefined;
  const l = store.schema.layouts.find((x) => x.name.toLowerCase() === layout.toLowerCase());
  return store.schema.tableOccurrences.find((o) => o.id === l?.tableOccurrenceId)?.name;
}

// --- Stand-ins ------------------------------------------------------------------

const KIND_ALT = KINDS.join('|');
/** A stand-in on its own, not run into other letters: "<PERSON_3>x" is not turned back, so no value comes back glued to text. */
const TOKEN = new RegExp(`(?<![\\p{L}\\p{N}_])<(${KIND_ALT})_(\\d+)>(?![\\p{L}\\p{N}_])`, 'gu');
const WHOLE_TOKEN = new RegExp(`^<(?:${KIND_ALT})_\\d+>$`);
const ANY_TOKEN = new RegExp(`<(?:${KIND_ALT})_\\d+>`);

/** Is this the whole of a stand-in? */
export const isToken = (s: unknown): s is string => typeof s === 'string' && WHOLE_TOKEN.test(s);

/** The internal names stand-ins are kept under when no account asks: they can't clash with a real account's name. */
export const PII_ADMIN = '\u0001administrator';
const PREVIEW = '\u0001preview';

/** Values longer than this are swapped only where they are the whole text (a long note), not looked for inside other text. */
const MATCH_CHARS = 200;
/** Text longer than this isn't sent while isolation is on: it can't be checked quickly. */
const TEXT_CHARS = 200_000;

interface Candidate { folded: string; offset: number; token: string }
interface Vault { lastId: number; byValue: Map<string, string>; byId: Map<number, { kind: string; value: string }>; words: Map<string, Candidate[]> }
const vaults = new WeakMap<Store, Map<string, Vault>>();

function vaultTable(store: Store): void {
  store.sql.exec(`CREATE TABLE IF NOT EXISTS _fm_pii_vault (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL, value TEXT NOT NULL, UNIQUE (account, value))`);
  // Deleting a record takes its values out of the vault by value (see Store.delete).
  store.sql.exec('CREATE INDEX IF NOT EXISTS _fm_pii_vault_value ON _fm_pii_vault (value)');
}

/** Forgets every stand-in in the file (when isolation is turned off): nothing personal is kept for AI any more. */
export function forgetVault(store: Store): void {
  vaultTable(store);
  store.sql.exec('DELETE FROM _fm_pii_vault');
  vaults.delete(store);
}

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (c: string | undefined) => !!c && WORD.test(c);
const WORDS = /[\p{L}\p{N}_]+/gu;

/** Lower case, one UTF-16 unit at a time, so positions stay those of the original ("İ" lower-cases to two units and is kept). */
function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const l = s[i].toLowerCase();
    out += l.length === 1 ? l : s[i];
  }
  return out;
}

/**
 * Swaps personal data for stand-ins (on the way to a model) and back (on the way to a person), for one account in
 * one file. Counts what it swapped, by kind, for the security log.
 */
export class PiiMasker {
  readonly counts: Record<string, number> = {};
  private vault: Vault;
  private readonly account: string;
  readonly store: Store;

  constructor(store: Store, account: string | null | undefined) {
    this.store = store;
    this.account = account ?? PII_ADMIN;
    vaultTable(store);
    let byAccount = vaults.get(store);
    if (!byAccount) vaults.set(store, (byAccount = new Map()));
    const key = this.account.toLowerCase();
    let v = byAccount.get(key);
    // Rows the file no longer has (the account was deleted, or its stand-ins were forgotten) mean what this process
    // remembers is out of date: start again from what the file holds.
    if (v && v.lastId > 0) {
      const held = (store.sql.prepare('SELECT count(*) AS n FROM _fm_pii_vault WHERE id <= ? AND account = ?').get(v.lastId, this.account) as { n: number }).n;
      if (held !== v.byId.size) v = undefined;
    }
    if (!v) byAccount.set(key, (v = { lastId: 0, byValue: new Map(), byId: new Map(), words: new Map() }));
    this.vault = v;
    this.refresh();
  }

  /** Picks up stand-ins other workers gave this account since. */
  private refresh(): void {
    const rows = this.store.sql.prepare('SELECT id, kind, value FROM _fm_pii_vault WHERE id > ? AND account = ? ORDER BY id').all(this.vault.lastId, this.account) as { id: number; kind: string; value: string }[];
    for (const r of rows) this.remember(r.id, r.kind, r.value);
  }

  private remember(id: number, kind: string, value: string): string {
    const token = `<${kind}_${id}>`;
    this.vault.byId.set(id, { kind, value });
    if (!this.vault.byValue.has(value)) {
      this.vault.byValue.set(value, token);
      const folded = fold(value.trim());
      // Indexed by its first word, to be found inside other text; a single letter or a long note only as a whole value.
      const first = /[\p{L}\p{N}_]+/u.exec(folded);
      if (first && folded.length >= 2 && folded.length <= MATCH_CHARS) {
        const list = this.vault.words.get(first[0]) ?? [];
        list.push({ folded, offset: first.index, token });
        this.vault.words.set(first[0], list);
      }
    }
    if (id > this.vault.lastId) this.vault.lastId = id;
    return token;
  }

  private count(kind: string): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  /** The stand-in for one value (the same one every time for this account). */
  token(value: string, kind: PiiKind): string {
    this.count(kind);
    const known = this.vault.byValue.get(value);
    if (known) return known;
    this.store.sql.prepare('INSERT OR IGNORE INTO _fm_pii_vault (account, kind, value) VALUES (?, ?, ?)').run(this.account, kind, value);
    const row = this.store.sql.prepare('SELECT id, kind FROM _fm_pii_vault WHERE account = ? AND value = ?').get(this.account, value) as { id: number; kind: string };
    return this.remember(row.id, row.kind, value);
  }

  /** Total values swapped so far. */
  get total(): number {
    return Object.values(this.counts).reduce((a, b) => a + b, 0);
  }

  /** Free text with every value this account was given a stand-in for, and anything that looks like an email, phone, card or SSN, swapped. */
  text(s: string): string {
    if (!s) return s;
    if (s.length > TEXT_CHARS) return LONG;
    this.refresh();
    const whole = this.vault.byValue.get(s);
    if (whole) {
      this.count(whole.slice(1, whole.indexOf('_')));
      return whole;
    }
    return this.patterns(this.known(s));
  }

  /** Text with only emails, phones, card and social security numbers swapped (design text, the system prompt). */
  patterns(s: string): string {
    if (!s) return s;
    if (s.length > TEXT_CHARS) return LONG;
    let out = s;
    for (const [re, kind] of PATTERNS) {
      if (kind === 'EMAIL' ? !out.includes('@') : !/\d/.test(out)) continue;
      out = out.replace(re, (m) => (patternHit(kind, m) && !WHOLE_TOKEN.test(m) ? this.token(m, kind) : m));
    }
    return out;
  }

  /** Values already in the vault, wherever they appear as whole words (case aside). */
  private known(s: string): string {
    if (!this.vault.words.size) return s;
    const f = fold(s);
    const hits: { start: number; end: number; token: string }[] = [];
    for (const w of f.matchAll(WORDS)) {
      for (const c of this.vault.words.get(w[0]) ?? []) {
        const start = w.index - c.offset;
        const end = start + c.folded.length;
        if (start < 0 || isWord(f[start - 1]) && isWord(f[start]) || isWord(f[end - 1]) && isWord(f[end])) continue;
        if (f.startsWith(c.folded, start)) hits.push({ start, end, token: c.token });
      }
    }
    if (!hits.length) return s;
    // Never inside a stand-in already there: a value "Person_7" is not the PERSON_7 of <PERSON_7>.
    const tokens = [...s.matchAll(new RegExp(ANY_TOKEN.source, 'g'))].map((t) => [t.index, t.index + t[0].length]);
    if (tokens.length) for (let i = hits.length - 1; i >= 0; i--) if (tokens.some(([a, b]) => hits[i].start < b && hits[i].end > a)) hits.splice(i, 1);
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '';
    let at = 0;
    for (const h of hits) {
      if (h.start < at) continue;
      out += s.slice(at, h.start) + h.token;
      this.count(h.token.slice(1, h.token.indexOf('_')));
      at = h.end;
    }
    return out + s.slice(at);
  }

  /** Stand-ins this account was given, turned back into their values; any other stand-in is left as it is. */
  unmask(s: string): string {
    if (!s || !s.includes('<')) return s;
    if (!this.vault.byId.size) this.refresh();
    return s.replace(TOKEN, (m, kind: string, id: string) => {
      let v = this.vault.byId.get(Number(id));
      if (!v) {
        this.refresh();
        v = this.vault.byId.get(Number(id));
      }
      return v && v.kind === kind ? v.value : m;
    });
  }

  /**
   * Find requests a model wrote, ready to run: a personal field can only be found by a whole stand-in it was given
   * (==<PERSON_3>), as empty ("=") or as any value ("*"), so it can't be worked out letter by letter ("J*", "Jo*").
   * Stand-ins elsewhere are left as they are. Throws, saying why, otherwise.
   */
  criteria(occurrence: string | undefined, query: unknown): unknown {
    if (!Array.isArray(query)) return query;
    return query.map((r) => {
      if (!r || typeof r !== 'object') return r;
      return Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => {
        if (k === 'omit') return [k, v];
        const at = k.indexOf('::');
        const c = at >= 0 ? classOf(this.store, k.slice(0, at), k.slice(at + 2)) : classOf(this.store, occurrence, k);
        if (!c.pii) return [k, v];
        const t = typeof v === 'string' ? v.trim() : v;
        if (t === '=' || t === '*' || t === '' || t === null || t === undefined) return [k, v];
        const m = typeof t === 'string' ? /^(==?)?(<[A-Z]+_\d+>)$/.exec(t) : null;
        const value = m && isToken(m[2]) ? this.unmask(m[2]) : undefined;
        if (m && value !== undefined && value !== m[2]) return [k, `==${value}`];
        throw new Error(`${k} holds personal data, and personal data isolation is on: find it only by a stand-in you were given ("==<PERSON_3>"), "=" for empty or "*" for any value`);
      }));
    });
  }

  /**
   * Values a model wants written, ready to write: a stand-in goes back to its value only when it is the whole value
   * of a personal field, so a value can't be copied into a field that isn't personal (or glued to other text) and
   * read back. Throws, saying why, otherwise.
   */
  write(occurrence: string | undefined, data: unknown): unknown {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => {
      if (typeof v !== 'string' || !ANY_TOKEN.test(v)) return [k, v];
      const at = k.indexOf('::');
      const c = at >= 0 ? classOf(this.store, k.slice(0, at), k.slice(at + 2)) : classOf(this.store, occurrence, k);
      const value = c.pii && isToken(v.trim()) ? this.unmask(v.trim()) : undefined;
      if (value !== undefined && value !== v.trim()) return [k, value];
      throw new Error(`A stand-in can only be written on its own into a field that holds personal data, and ${k} ${c.pii ? 'was given more than a stand-in it knows' : 'doesn\'t hold personal data'}`);
    }));
  }

  /**
   * A tool's JSON result for a model: record fields (fieldData, portalData, and {field, value} pairs) by how each
   * field is treated; every other string is design or a message, with emails, phones and card numbers swapped.
   * `occurrence` is the table occurrence bare field names belong to (the layout's).
   */
  json<T>(v: T, occurrence?: string): T {
    this.refresh();
    const value = (x: unknown, c: FieldClass): unknown => {
      if (x === null || x === undefined || x === '' || isToken(x)) return x;
      if (c.pii && (typeof x === 'string' || typeof x === 'number')) return this.token(String(x), c.kind ?? valueKind(String(x)) ?? 'TEXT');
      if (Array.isArray(x)) return x.map((y) => value(y, c));
      if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, value(y, c)]));
      // A value of a field that isn't personal can still hold a value that is (typed or copied in): swapped too.
      return typeof x === 'string' ? this.text(x) : x;
    };
    const fields = (data: Record<string, unknown>, to: string | undefined) => Object.fromEntries(Object.entries(data).map(([k, x]) => {
      if (k === 'recordId' || k === 'modId') return [k, x];
      const at = k.indexOf('::');
      return [k, value(x, at >= 0 ? classOf(this.store, k.slice(0, at), k.slice(at + 2)) : classOf(this.store, to, k))];
    }));
    const walk = (x: unknown): unknown => {
      if (typeof x === 'string') return isToken(x) ? x : this.patterns(x);
      if (Array.isArray(x)) return x.map(walk);
      if (!x || typeof x !== 'object') return x;
      const o = x as Record<string, unknown>;
      const ref = typeof o.field === 'string' ? o.field : undefined;
      const pair = ref !== undefined ? (ref.includes('::') ? classOf(this.store, ref.slice(0, ref.indexOf('::')), ref.slice(ref.indexOf('::') + 2)) : classOf(this.store, occurrence, ref)) : undefined;
      return Object.fromEntries(Object.entries(o).map(([k, y]) => {
        if (k === 'fieldData' && y && typeof y === 'object' && !Array.isArray(y)) return [k, fields(y as Record<string, unknown>, occurrence)];
        if (k === 'portalData' && y && typeof y === 'object' && !Array.isArray(y)) {
          return [k, Object.fromEntries(Object.entries(y as Record<string, unknown>).map(([portal, rows]) => [portal,
            Array.isArray(rows) ? rows.map((r) => (r && typeof r === 'object' ? fields(r as Record<string, unknown>, portal) : walk(r))) : walk(rows)]))];
        }
        if (pair && PAIR_VALUES.has(k)) return [k, value(y, pair)];
        return [k, walk(y)];
      }));
    };
    return walk(v) as T;
  }
}

const LONG = '(text left out: personal data isolation can\'t check text this long)';

/** Keys that hold a field's values next to a "field" naming it. */
const PAIR_VALUES = new Set(['value', 'values', 'before', 'after', 'now', 'was', 'current', 'previous', 'old', 'new', 'common', 'commonValues', 'examples', 'example', 'sample', 'samples', 'min', 'max', 'top', 'criteria']);

/** A text stream from a model with its stand-ins turned back, holding back a stand-in cut across two pieces. */
export function unmaskStream(m: PiiMasker, onText: (text: string) => void): { push: (t: string) => void; flush: () => void } {
  let held = '';
  return {
    push: (t) => {
      held += t;
      const open = held.lastIndexOf('<');
      const cut = open >= 0 && held.length - open < 24 && !held.slice(open).includes('>') ? open : held.length;
      const out = held.slice(0, cut);
      held = held.slice(cut);
      if (out) onText(m.unmask(out));
    },
    flush: () => {
      if (held) onText(m.unmask(held));
      held = '';
    },
  };
}

/**
 * A sample value from a spreadsheet column, for AI import matching: the kind it looks like (<EMAIL_4>), or kept
 * when it can't identify anyone (a short number, a yes or no), in a column whose header says nothing personal.
 */
export function maskSample(m: PiiMasker, v: string, header = ''): string {
  const k = valueKind(v);
  if (k) return m.token(v, k);
  const t = v.trim();
  const named = nameKind(header);
  if (!t || (!named && (/^-?[$€£¥]?\d{1,6}(?:[.,]\d{1,4})?%?$/.test(t) || /^(?:yes|no|y|n|true|false)$/i.test(t)))) return v;
  return m.token(v, named ?? 'TEXT');
}

// --- Tools ----------------------------------------------------------------------

/**
 * MCP tools that may run while isolation is on: design only (no record values), or records whose fields are each
 * checked. Every other tool (SQL, free formulas, scripts, record history, data checks, imports, containers...) is
 * refused, so a tool added later is refused until it is put here.
 */
export const PII_TOOLS = new Set([
  'list_databases', 'describe_database', 'explain_access', 'who_can_access', 'preview_privilege_set', 'get_script',
  'find_records', 'get_record', 'create_record', 'update_record', 'delete_record', 'describe_layout',
  'explain_solution', 'solution_map', 'document_solution', 'where_used', 'search_solution', 'check_calculation', 'lint_formulas',
  'check_script', 'list_dashboards', 'conversion_report', 'conversion_guide', 'migration_plan',
  'compare_solutions', 'get_design', 'get_theme', 'get_layout_design', 'lint_script', 'lint_layout', 'check_solution',
  'review_graph', 'check_formula', 'design_history', 'get_security', 'review_privileges', 'check_change_impact', 'suggest_indexes',
  'copy_for_filemaker', 'list_images', 'list_connections', 'draft_connection',
]);
// Not here on purpose: tools that change the design or security (a new calculation or a renamed field could show a
// personal value under a name that says nothing personal), and list_automations (its run messages can hold values).

/** Arguments a tool runs with while isolation is on: describe_layout without values from the data, check_calculation on no records. */
export function piiArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (tool === 'describe_layout') return { ...args, sample: false };
  if (tool === 'check_calculation') return { ...args, sampleRecords: 0 };
  return args;
}

export const piiRefusal = (file: string, what: string) =>
  `Personal data isolation is on for ${file}, so ${what} isn't available to AI: its results can't be checked for personal data. ` +
  'Read records with find_records or get_record, where personal fields come back as stand-ins like <PERSON_3>';

// --- Preview --------------------------------------------------------------------

/** What an administrator sees: each field's treatment, and a few records of a layout as a model would get them. */
export function piiPreview(store: Store, layout?: string): { on: boolean; through?: string; tables: { table: string; fields: ({ field: string } & FieldClass)[] }[]; sample?: { layout: string; records: unknown[] } } {
  const file = piiFile(store);
  const classes = fieldClasses(store);
  const tables = store.schema.tables.map((t) => ({
    table: t.name,
    fields: t.fields.map((f) => ({ field: f.name, ...(classes.get(t.name.toLowerCase())?.get(f.name.toLowerCase()) ?? PERSONAL) })),
  }));
  let sample: { layout: string; records: unknown[] } | undefined;
  const name = layout ?? store.schema.layouts.find((l) => l.tableOccurrenceId !== undefined)?.name;
  if (name) {
    try {
      const found = store.find(name, { limit: 3 });
      // The preview's stand-ins are its own, and are forgotten once it is drawn.
      const m = new PiiMasker(store, PREVIEW);
      sample = { layout: name, records: m.json(found.records.map((r) => ({ recordId: r.recordId, fieldData: r.fieldData, ...(r.portalData ? { portalData: r.portalData } : {}) })), layoutOccurrence(store, name)) };
    } catch {
      sample = undefined;
    } finally {
      store.sql.prepare('DELETE FROM _fm_pii_vault WHERE account = ?').run(PREVIEW);
      vaults.get(store)?.delete(PREVIEW);
    }
  }
  return { on: !!file, ...(file && file !== store ? { through: file.name } : {}), tables, ...(sample ? { sample } : {}) };
}
