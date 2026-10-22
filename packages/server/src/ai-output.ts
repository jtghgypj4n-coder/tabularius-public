// What AI tools hand a model: no secrets, and nothing so long it pushes the rest of an answer out of
// the model's context. People see the real values in the web client; a model gets a note instead.

import { CredentialRedactor } from '../../scripts/src/redaction.ts';

import type { AuditEntry, Store } from '../../store/src/index.ts';
import type { Widget, WidgetData } from './dashboards.ts';
import type { SummaryResult } from './summarize.ts';
import { foldConfusables } from './ai-confusables.ts';
import { sqlMayReadSecret as scriptSqlMayReadSecret } from '../../scripts/src/credentials.ts';

/** Field/variable names for credentials and sensitive identifiers (English plus ES/FR/DE/NL/IT/PT,
 * SV/DA/NO/FI/PL/JA/ZH/KO/RU and password terms in TR/CS/HU/EL/HE/AR).
 * Delimiters also accept concatenated UI/database names. */
const SECRET_NAME = new RegExp([
  String.raw`pass[_-]?(?:word|wd|phrase)`, String.raw`passcode`, String.raw`(?:smtp|sender|mail)[\s_-]?user`, String.raw`pwd(?!\p{L})`, String.raw`secret(?!ar(?:y|ies))`,
  String.raw`api_?key`, String.raw`(?<!\p{L})api[\s-]keys?(?!\p{L})`, String.raw`(?:access|auth|private|secret|signing|encryption|licen[sc]e|activation|ssh|wallet|priv)[\s_-]?keys?(?!\p{L})`, String.raw`(?:access|login|pass)[\s_-]?codes?(?!\p{L})`, String.raw`passwort|kennwort`, String.raw`routing[\s_-]?number`,
  String.raw`(?:(?<!\p{L})|api|access|auth|refresh|session|reset|bearer|csrf|id)[\s_-]?tokens?(?!\p{L})`, String.raw`(?<!\p{L})jwt(?!\p{L})`, String.raw`credential`,
  String.raw`(?<!\p{L})(?:pin|ssn|cvv2?|cvc2?|iban|otp|totp)(?!\p{L})`, String.raw`pin[\s_-]?codes?(?!\p{L})`, String.raw`(?:user|card|bank|login|security|account)pin(?!\p{L})`,
  String.raw`social[\s_-]?security`, String.raw`(?:card|cc)[\s_-]?(?:number|num|no)(?!\p{L})`, String.raw`credit[\s_-]?card`, String.raw`security[\s_-]?answer`,
  String.raw`(?:one[\s_-]?time|verification|recovery|backup|reset|mfa|2fa)[\s_-]?(?:codes?|pass)(?!\p{L})`, String.raw`(?:recovery|seed)[\s_-]?phrase`,
  // Romance languages: passwords, secrets, tokens, API keys, identifiers and cards.
  String.raw`contrase[ñn]a|mot[\s_'-]*de[\s_'-]*passe|parola[\s_'’]*d[\s_'’]*(?:ordine|accesso)|senha|palavra[\s_-]*passe`,
  String.raw`secreto|segret[oa]|segredo|jeton|gettone[\s_-]*(?:di[\s_-]*)?accesso`,
  String.raw`(?:clave|cl[eé]f?|chiave|chave)[\s_-]*(?:d['’])?(?:api|acc[eè]s|acceso|acesso|priv[eé]e?|privad[ao]|secr[eè]t[ae]?|segreta)`,
  String.raw`api[\s_-]*(?:clave|cl[eé]f?|chiave|chave)`,
  String.raw`(?:num[eé]ro|n[uú]mero)[\s_-]*(?:de[\s_-]*)?(?:s[eé]curit[eé][\s_-]*sociale|seguridad[\s_-]*social|seguran[çc]a[\s_-]*social|identidad|identifica[çc][aã]o)`,
  String.raw`s[eé]curit[eé][\s_-]*sociale|codice[\s_-]*fiscale|c[oó]digo[\s_-]*(?:secreto|pin)|(?:tarjeta|carte|carta|cart[aã]o)[\s_-]*(?:(?:de|di)[\s_-]*)?cr[eé]dito?`,
  // Germanic/Nordic languages and Finnish/Polish.
  String.raw`geheim(?:nis|zahl)?|wachtwoord|l[oö]senord|adgangskode|passord|salasana|has[łl]o|hemlighet|hemmelighe[dt]|salaisuus|sekret|tajemnica`,
  String.raw`(?:zugriffs|toegangs|[aå]tkomst|adgangs|tilgangs)[\s_-]*token|k[aä]ytt[oö]oikeus(?:tunnus|tietue)|p[äa][äa]sytunniste`,
  String.raw`api[\s_-]*(?:schl[uü]ssel|sleutel|nyckel|n[oø]gle|n[oø]kkel|avain|klucz)|(?:schl[uü]ssel|sleutel|nyckel|n[oø]gle|n[oø]kkel|avain|klucz)[\s_-]*api`,
  String.raw`pin[\s_-]*(?:kod[ei]?|koodi)|(?:kod|code|codice)[\s_-]*pin`,
  String.raw`(?:sozialversicherungs|rentenversicherungs|steueridentifikations|personalausweis)nummer|burgerservicenummer|personnummer|f[oø]dselsnummer|henkil[oö]tunnus|sosiaaliturvatunnus`,
  String.raw`kreditkarte|creditcard|kreditkort|kredittkort|luottokort(?:ti|in)|kart[ay][\s_-]*kredytow(?:a|ej)`,
  // Local identifier abbreviations need Unicode letter boundaries (e.g. Épinard isn't a PIN).
  String.raw`(?<!\p{L})(?:dni|nie|nif|niss|nir|hetu|cpf|cnpj|bsn|cpr|pesel|nip)(?!\p{L})`,
  // Japanese, simplified/traditional Chinese, Korean and Russian.
  String.raw`パスワード|パスコード|暗証番号|秘密|シークレット|トークン|pin[\s_-]*コード|社会保障番号|(?:api|認証)[\s_-]*キー|マイナンバー|個人番号|クレジットカード`,
  String.raw`密[码碼钥鑰]|口令|机密|機密|令牌|权杖|權杖|金鑰|个人识别码|個人識別碼|身份[证證](?:号|號)?|身分證(?:號)?|信用卡|pin[\s_-]*[码碼]|社[会會]保障[号號]`,
  String.raw`비밀번호|암호|비밀|시크릿|토큰|pin[\s_-]*코드|(?:api|인증)[\s_-]*키|핀[\s_-]*번호|주민[\s_-]*등록[\s_-]*번호|신용[\s_-]*카드`,
  String.raw`пароль|секрет(?!ар)|тайна|токен|жетон[\s_-]*доступа|(?:api[\s_-]*ключ|ключ[\s_-]*api)|(?<!\p{L})пин(?!\p{L})|снилс|(?<!\p{L})инн(?!\p{L})|кредитн(?:ая|ой)[\s_-]*карт`,
  // Password terms; per-language public sources are recorded in ai-output-languages.test.ts.
  String.raw`şifre|heslo|jelszó|κωδικός[\s_-]*πρόσβασης|סיסמה|كلمة[\s_-]*المرور`,
].join('|'), 'iu');
const HIDDEN = '‹hidden from AI tools›';
export const HIDDEN_VALUE = HIDDEN;
/** Values longer than this are cut (a "List of" summary, a JSON blob, a whole HTML page). */
const VALUE_CHARS = 500;

/** Is this field (Table::Field, or a bare name) one whose values look like secrets? */
export function secretName(name: string): boolean {
  return matchesSecret(normalizeSecretName(name).replace(/^.*::/, '').replace(/\(\d+\)$/, ''));
}

function normalizeSecretName(text: string): string {
  // Compatibility forms (e.g. fullwidth letters), invisible separators and Turkish dotted I.
  return text.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '').toLowerCase().replace(/i\u0307/g, 'i');
}

const DIGIT_LETTERS: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };
const foldMarks = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC');
const FOLDED_SECRET_NAME = new RegExp(foldMarks(SECRET_NAME.source), 'iu');
function matchesSecret(text: string): boolean {
  // Keep native-language spellings, boundaries and meaningful digits (PIN code, CVV2, 2FA).
  // Folding is an additional match, so Latin look-alikes cannot break Cyrillic/Greek terms.
  if (SECRET_NAME.test(text)) return true;
  const folded = foldMarks(text);
  const confusable = foldConfusables(folded);
  for (const form of [folded, confusable]) {
    // Both l and i are common substitutions for 1; retain the earlier i coverage too.
    for (const letters of [form, ...['l', 'i'].map((one) => form.replace(/[01345789]/g, (digit) => digit === '1' ? one : DIGIT_LETTERS[digit]))]) {
      if (FOLDED_SECRET_NAME.test(letters) || matchesJoined(letters)) return true;
    }
  }
  return false;
}

const FOLDED_SECRET_NAME_ALL = new RegExp(FOLDED_SECRET_NAME.source, 'giu');
/**
 * The name with the separators between letters removed (so "p a s s w o r d" and "api-key" are found), but only a match that
 * starts where a word of the name starts: "Okapi Key" joins to "okapikey", and "api key" inside it is not a key name.
 */
function matchesJoined(letters: string): boolean {
  let joined = '';
  const starts = new Set<number>();
  for (const word of letters.split(/(?<=\p{L})[\s\p{P}\p{S}]+(?=\p{L})/u)) {
    starts.add(joined.length);
    joined += word;
  }
  for (const m of joined.matchAll(FOLDED_SECRET_NAME_ALL)) if (starts.has(m.index)) return true;
  return false;
}

/** Audit entries with secret-looking field values hidden, as in record reads. */
export function auditForModel(entries: AuditEntry[]): AuditEntry[] {
  return entries.map((e) => (e.changes
    ? { ...e, changes: values(e.changes, undefined, Infinity) }
    : e));
}

/** Does this text name a password, key or token field anywhere? */
export function secretText(text: string): boolean {
  return matchesSecret(normalizeSecretName(text));
}

/** Could this ExecuteSQL query return a secret field: it names one, or selects every column (COUNT ( * ) aside)? */
export function sqlMayReadSecret(query: string): boolean {
  return scriptSqlMayReadSecret(query, secretText);
}

/** A value asked for by name (or a single SQL row) may be this long before it is cut. */
const ASKED_CHARS = 20_000;

function clipValue(v: unknown, max = VALUE_CHARS): unknown {
  if (typeof v !== 'string' || v.length <= max) return v;
  return max < ASKED_CHARS
    ? `${v.slice(0, max)}… (${v.length - max} more characters cut; ask for this field by name with fields: [...] to read up to ${ASKED_CHARS.toLocaleString('en-US')})`
    : `${v.slice(0, max)}… (${v.length - max} more characters cut; read the rest with sql_query and substr ( field, ${max + 1}, ${max} ))`;
}

/** A secret shorter than this is not matched at all: matching it would hide ordinary text. */
export const SECRET_MIN_CHARS = 4;
/** A secret this long or longer is also found inside a longer value. A shorter one (a PIN, "True") only when it is the whole value. */
export const SECRET_EMBEDDED_CHARS = 8;

/** Secret values from the unfiltered record (trimmed; values under SECRET_MIN_CHARS are left out). */
export function secretValues(data: Record<string, unknown>): string[] {
  const leaves = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(leaves)
    : value && typeof value === 'object' ? Object.values(value).flatMap(leaves)
    : value == null ? [] : [String(value).trim()];
  return Object.entries(data).filter(([name]) => secretName(name)).flatMap(([, value]) => leaves(value))
    .filter((value) => value.length >= SECRET_MIN_CHARS);
}

/**
 * The values of every secret-named field stored in the file (up to 20,000 rows a table, and a secret-named global
 * field), so a copy of one made somewhere ordinary can be told.
 */
export function storedSecretValues(copy: Store): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { for (const x of secretValues({ password: v })) out.add(x); };
  for (const t of copy.schema.tables) {
    const secret = t.fields.filter((f) => secretName(f.name));
    for (const f of secret) {
      if (!f.options?.global) continue;
      try { add(copy.calc.globalValue(t, f)); } catch { /* no value kept */ }
    }
    const names = secret.filter((f) => !f.options?.global).map((f) => `"${f.name.replace(/"/g, '""')}"`);
    if (!names.length) continue;
    try {
      const r = copy.select(`SELECT ${names.join(', ')} FROM "${t.name.replace(/"/g, '""')}"`, [], 20_000);
      for (const row of r.rows) for (const v of row) add(v);
    } catch {
      // a column that can't be read plainly (an unstored calculation) holds no stored secret
    }
  }
  return [...out];
}

/**
 * Hide a copied secret, ignoring case: the whole value, or (for a secret of SECRET_EMBEDDED_CHARS or more) a part
 * of a longer calculation or search result.
 */
export function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (value === null || value === undefined || value === '') return false;
  const text = String(value).trim().toLowerCase();
  return secrets.some((secret) => {
    const s = secret.trim().toLowerCase();
    return s.length >= SECRET_MIN_CHARS && (text === s || (s.length >= SECRET_EMBEDDED_CHARS && text.includes(s)));
  });
}

function values(data: Record<string, unknown>, only?: Set<string>, max = only ? ASKED_CHARS : VALUE_CHARS, secrets = secretValues(data)): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (only && !only.has(k.toLowerCase()) && !only.has(k.replace(/\(\d+\)$/, '').toLowerCase())) continue;
    out[k] = ((secretName(k) && v !== '' && v !== null) || containsSecret(v, secrets)) ? HIDDEN : clipValue(v, max);
  }
  return out;
}

/** A named field value in a derived AI result (group key, chart label, or search snippet). */
export function fieldValueForModel(name: string, value: unknown): unknown {
  return values({ [name]: value })[name];
}

/** Keep summary counts while hiding group keys and measures named after secret fields. */
export function summaryForModel(result: SummaryResult): SummaryResult {
  const named = <T>(data: Record<string, T>): Record<string, T> => Object.fromEntries(
    Object.entries(data).map(([name, value]) => [name, fieldValueForModel(name, value) as T]));
  return {
    ...result,
    totals: named(result.totals),
    ...(result.groups ? { groups: result.groups.map((g) => ({ ...g, values: named(g.values), measures: named(g.measures) })) } : {}),
  };
}

/** Dashboard data is derived from summaries, but its group keys have become chart labels or table cells. */
export function dashboardForModel(widgets: Widget[], data: WidgetData[]): WidgetData[] {
  return data.map((item, i) => {
    const widget = widgets[i];
    if (!widget) return item;
    const first = widget.groupBy?.[0] ?? '';
    const second = widget.groupBy?.[1] ?? '';
    const secretMeasure = !!widget.measure && secretName(widget.measure.field);
    return {
      ...item,
      ...(item.value !== undefined && widget.measure ? { value: fieldValueForModel(widget.measure.field, item.value) as WidgetData['value'] } : {}),
      ...(item.categories ? { categories: item.categories.map((v) => fieldValueForModel(first, v) as string) } : {}),
      ...(item.series ? { series: item.series.map((s) => ({ name: fieldValueForModel(second, s.name) as string, values: secretMeasure ? s.values.map(() => null) : s.values })) } : {}),
      ...(item.rows ? { rows: item.rows.map((row) => row.map((v, at) => fieldValueForModel(item.columns?.[at] ?? '', v) as string | number | null)) } : {}),
      ...(item.top ? { top: { ...item.top, values: item.top.values.map((v) => fieldValueForModel(item.top!.field, v) as string) } } : {}),
    };
  });
}

interface RecordLike {
  fieldData: Record<string, unknown>;
  portalData?: Record<string, Record<string, unknown>[]>;
}

/**
 * A record for a model: only `fields` when given (field names, or "TO::Field" for portal rows; portals
 * are left out unless one of their fields is named), secret-looking values hidden, long values cut.
 */
export function recordForModel<R extends RecordLike>(r: R, fields?: string[]): R {
  const only = fields?.length ? new Set(fields.map((f) => f.toLowerCase())) : undefined;
  // Collect before projecting fields or truncating portals: a related secret can
  // be copied onto the parent or a different portal row. Keep this record-local.
  const secrets = [...new Set([...secretValues(r.fieldData),
    ...Object.values(r.portalData ?? {}).flatMap((rows) => rows.flatMap(secretValues))])];
  const portalData = r.portalData && Object.fromEntries(Object.entries(r.portalData)
    .map(([name, rows]) => [name, rows.map((row) => values(row, only && new Set([...only, 'recordid', 'modid']), only ? ASKED_CHARS : VALUE_CHARS, secrets))] as const)
    .filter(([, rows]) => !only || rows.some((row) => Object.keys(row).some((k) => k !== 'recordId' && k !== 'modId'))));
  return {
    ...r,
    fieldData: values(r.fieldData, only, only ? ASKED_CHARS : VALUE_CHARS, secrets),
    ...(r.portalData ? { portalData } : {}),
  };
}

/** Portal rows a record keeps in find_records unless more are asked for (a record's related rows can outweigh the record). */
export const PORTAL_ROWS = 5;

/**
 * A record with each portal cut to its first `rows` rows, the cut ones counted in `portalTotals` ("PROJECT": 15), and the
 * rows' modId left out. A model that wants every row asks with portalRows, or names the portal's fields.
 */
export function compactPortals<R extends RecordLike>(r: R, rows = PORTAL_ROWS): R & { portalTotals?: Record<string, number> } {
  if (!r.portalData) return r;
  const totals: Record<string, number> = {};
  const portalData = Object.fromEntries(Object.entries(r.portalData).map(([name, all]) => {
    if (all.length > rows) totals[name] = all.length;
    return [name, all.slice(0, rows).map(({ modId: _, ...row }) => row)] as const;
  }));
  return { ...r, portalData, ...(Object.keys(totals).length ? { portalTotals: totals } : {}) };
}

/** What a SQL query read and returned (Store.queryWithOrigins): each result column's source and the tables it opened. */
export interface SqlOrigins {
  columns: { name: string; origin: string | null }[];
  tables: { table: string; columns: string[] }[];
  virtual: boolean;
}

/** Can this query read a secret-looking column? It names one, or it opens a table that has one and could expand `*`. */
function mayReadSecret(sql: string, o: SqlOrigins): boolean {
  if (secretText(sql)) return true;
  return o.tables.some((t) => t.columns.some(secretName)) && /\*/.test(sql.replace(/count\s*\(\s*\*\s*\)/gi, ''));
}

/**
 * SQL result rows for a model: secret-looking columns hidden, long values cut. A column is judged by the table column
 * it reads, not the name the query gave it (`SELECT "Password" AS x`). When the query may read a secret column,
 * only a plain column of a table is shown: an expression (`substr("Password", 1, 50)`), and anything from a
 * UNION or a table-valued function (json_each), whose source cannot be told, is hidden.
 */
export function rowsForModel(rows: Record<string, unknown>[], origins?: SqlOrigins, sql = ''): Record<string, unknown>[] {
  const hidden = new Set<string>();
  if (origins) {
    const risky = mayReadSecret(sql, origins);
    const unclear = origins.virtual || /\b(?:union|intersect|except)\b/i.test(sql);
    for (const c of origins.columns) {
      if (secretName(c.name) || (c.origin !== null && secretName(c.origin)) || (risky && (c.origin === null || unclear))) hidden.add(c.name);
    }
  }
  // One row is a value asked for: up to 20,000 characters of each column.
  const max = rows.length === 1 ? ASKED_CHARS : VALUE_CHARS;
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, hidden.has(k) && v !== '' && v !== null ? HIDDEN : values({ [k]: v }, undefined, max)[k]])));
}

const STRING = /"(?:[^"\\]|\\.)*"|“[^”]*”/g;

/**
 * Script text (or any design text) with secrets hidden: string literals on a line that names a password,
 * key or token (Set Variable [ $Password ; Value: "..." ], Re-Login, Send Mail via SMTP), AWS access keys, API keys with a known prefix,
 * credentials in URLs and cURL options, and bearer tokens.
 */
export function redactSecrets(text: string, force = false): string {
  return text.split('\n').map((line) => {
    let out = line
      .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, HIDDEN)
      // API keys with a well-known prefix (Anthropic, OpenAI, GitHub, Slack), wherever they appear.
      // (a key's body is long and has digits; "sk-customer-detail-layout" isn't one).
      .replace(/(?<![A-Za-z0-9_-])(?:sk[-_](?:ant-|proj-|live_|test_)?|github_pat_|gh[pousr]_|AIza|xox[abeoprs]-)(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/g, HIDDEN)
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@"]+:[^\n/@"]+@/gi, `$1${HIDDEN}@`)
      .replace(/(--user|-u)(\s+)([^\s"]+|"[^"]*")/g, `$1$2${HIDDEN}`)
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, `$1${HIDDEN}`);
    if (force || secretText(out)) out = out.replace(STRING, (s) => (s.length <= 2 ? s : s[0] === '“' ? `“${HIDDEN}”` : `"${HIDDEN}"`));
    return out;
  }).join('\n');
}

/** A script step's decoded options with the same secrets hidden: every literal, when the step names a password, key or token. */
export function redactStep<T>(step: T): T {
  const force = secretText(JSON.stringify(step) ?? '');
  const walk = (v: unknown): unknown => typeof v === 'string' ? redactSecrets(v, force)
    : Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  // Text that merely names a field ("Okapi Key") is judged by redactSecrets above; this pass hides values under secret-named keys and their copies.
  return new CredentialRedactor().data(walk(step), undefined, false) as T;
}
