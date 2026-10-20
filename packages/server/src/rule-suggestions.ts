// Rules a table's data already follows, suggested as field options the developer accepts one at a time: a field
// that only ever holds a handful of values (a value list to check against), one that is never empty, an id-like
// field whose values are all different, a text field that only holds numbers, a number that counts up with each
// record (a serial number), and a value nearly every record has (a default). Each comes with the design change
// that adds it, built on the field's options as they are now, applied as one change or not at all.
//
// Read-only: counts and the few values a value list would hold, for [Full Access] (design) only. Fields named
// like passwords, tokens or keys are skipped.
//
//   GET /tabularius/design/v1/databases/<db>/suggest-rules?table=     (design.ts)
//   MCP tool suggest_rules                                           ([Full Access])

import type { DesignOp, Store } from '../../store/src/index.ts';
import { secretName } from './ai-output.ts';

export type RuleKind = 'valueList' | 'notEmpty' | 'unique' | 'number' | 'serial' | 'default';

export interface RuleSuggestion {
  table: string;
  field: string;
  kind: RuleKind;
  /** The rule, in a sentence. */
  title: string;
  /** What in the data shows it. */
  evidence: string;
  /** The design change that adds it. */
  changes: DesignOp[];
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fields the solution keeps for itself: who and when created or changed, and copies a script keeps up to date. */
const HOUSEKEEPING = /^(creation|modification|created|modified|z_|_z)|(created|modified|creation|modification)[ _]?(by|at|on|date|time|timestamp|account|accountname|user|userid|name)?$|(account ?name|user ?id)$|^g[A-Z_]/;
/** Names that read as an identifier or code, where every value being different is a rule, not a coincidence. */
const ID_LIKE = /(^|[\s_])(id|key|code|sku|number|no|num|email|e-mail|ref|reference|serial|invoice ?#?)$|^(id|key|code|sku|email)([\s_]|$)/i;
/** Names of what a record is called. */
const NAMING = /(^|[\s_])(name|title|customer|company|subject|email)([\s_]|$)/i;
const fmt = (n: number) => n.toLocaleString('en-US');

export function suggestRules(store: Store, opts: { table?: string; minRecords?: number; limit?: number } = {}): {
  suggestions: RuleSuggestion[];
  /** Other fields filled in on every record, not suggested one by one (a name or key field is). */
  alsoAlwaysFilled: { table: string; fields: string[] }[];
  tablesChecked: string[];
} {
  const minRecords = opts.minRecords ?? 20;
  const tables = store.schema.tables.filter((t) => !opts.table || t.name.toLowerCase() === opts.table.toLowerCase());
  if (opts.table && !tables.length) throw new Error(`No table named "${opts.table}"`);
  const out: RuleSuggestion[] = [];
  const moreFilled: { table: string; fields: string[] }[] = [];
  const takenLists = new Set(store.schema.valueLists.map((v) => v.name.toLowerCase()));
  for (const t of tables) {
    const alwaysFilled: RuleSuggestion[] = [];
    let total: number;
    try {
      total = Number(store.query(`SELECT count(*) AS n FROM ${q(t.name)}`)[0]?.n ?? 0);
    } catch {
      continue; // no rows table (external data)
    }
    if (total < minRecords) continue;
    for (const f of t.fields) {
      if (f.kind !== 'normal' || f.options?.global || f.type === 'container' || secretName(f.name) || HOUSEKEEPING.test(f.name) || /cached$/i.test(f.name)) continue;
      if ((f.options?.repetitions ?? 1) > 1) continue;
      const col = q(f.name);
      const filled = `coalesce(CAST(${col} AS TEXT), '') <> ''`;
      let stats: Record<string, unknown>;
      try {
        stats = store.query(`SELECT count(*) AS n, count(DISTINCT ${col}) AS d, max(length(CAST(${col} AS TEXT))) AS w FROM ${q(t.name)} WHERE ${filled}`)[0];
      } catch {
        continue;
      }
      const nonEmpty = Number(stats.n);
      const distinct = Number(stats.d);
      if (nonEmpty < minRecords) continue;
      const ae = f.options?.autoEnter;
      const val = f.options?.validation ?? {};
      const autoFilled = !!(ae?.serial || ae?.value || ae?.calculation || ae?.lookup || ae?.data !== undefined);
      const withValidation = (patch: Record<string, unknown>): DesignOp =>
        ({ op: 'updateField', table: t.name, field: f.name, options: { validation: { ...val, ...patch } } }) as DesignOp;
      const where = (n: number) => n === total ? `all ${fmt(total)} records` : `${fmt(n)} of ${fmt(total)} records`;

      // A handful of values: a value list to pick from and check against. Spellings that differ only in case
      // count as one value (the commonest spelling), and are named so they can be cleaned up first.
      if (f.type === 'text' && val.valueList === undefined && distinct >= 2 && distinct <= 16 && Number(stats.w) <= 40) {
        const rows = store.query(`SELECT CAST(${col} AS TEXT) AS v, count(*) AS c FROM ${q(t.name)} WHERE ${filled} GROUP BY ${col} ORDER BY c DESC, v`, 17)
          .map((r) => ({ v: String(r.v), c: Number(r.c) }));
        const byCase = new Map<string, { v: string; c: number; also: string[] }>();
        for (const r of rows) {
          const k = r.v.trim().toLowerCase();
          const had = byCase.get(k);
          if (had) {
            had.c += r.c;
            had.also.push(r.v);
          } else byCase.set(k, { ...r, also: [] });
        }
        const values = [...byCase.values()];
        const codes = values.every((x) => NUMBER.test(x.v) || UUID.test(x.v));
        if (values.length >= 2 && values.length <= 12 && values.length / nonEmpty <= 0.2 && !codes) {
          let name = `${f.name} Values`;
          for (let i = 2; takenLists.has(name.toLowerCase()); i++) name = `${f.name} Values ${i}`;
          takenLists.add(name.toLowerCase());
          const variants = values.filter((x) => x.also.length);
          out.push({
            table: t.name, field: f.name, kind: 'valueList',
            title: `${t.name}::${f.name} only ever holds one of ${values.length} values (${values.map((x) => x.v).join(', ')}): make a value list "${name}" and check entries against it.`,
            evidence: `${fmt(nonEmpty)} filled in, ${values.length} different values.` + (variants.length
              ? ` Also spelled ${variants.map((x) => x.also.map((a) => `"${a}"`).join(', ')).join('; ')}: tidy those first (Data cleanup), or they will fail the check when edited.`
              : ''),
            changes: [{ op: 'createValueList', name, values: values.map((x) => x.v) } as DesignOp, withValidation({ valueList: name })],
          });
        }
      }
      // Never empty.
      if (nonEmpty === total && !val.notEmpty && !autoFilled) {
        alwaysFilled.push({
          table: t.name, field: f.name, kind: 'notEmpty',
          title: `${t.name}::${f.name} is filled in on every record: require a value.`,
          evidence: `Filled in on ${where(nonEmpty)}.`,
          changes: [withValidation({ notEmpty: true })],
        });
      }
      // Every value different, on a field named like an identifier: unique, and required (it is always filled in).
      if (distinct === nonEmpty && nonEmpty === total && !val.unique && ID_LIKE.test(f.name) && !ae?.serial) {
        const required = !val.notEmpty && !autoFilled;
        if (required) alwaysFilled.splice(alwaysFilled.findIndex((x) => x.field === f.name), 1);
        out.push({
          table: t.name, field: f.name, kind: 'unique',
          title: `${t.name}::${f.name} is different on every record: require ${required ? 'a value, and ' : ''}unique values.`,
          evidence: `${fmt(distinct)} different values in ${where(nonEmpty)}.`,
          changes: [withValidation({ unique: true, ...(required ? { notEmpty: true } : {}) })],
        });
      }
      // A text field holding only numbers.
      if (f.type === 'text' && !val.type) {
        const notNumber = Number(store.query(`SELECT count(*) AS n FROM ${q(t.name)} WHERE ${filled} AND NOT (trim(CAST(${col} AS TEXT)) GLOB '[0-9]*' OR trim(CAST(${col} AS TEXT)) GLOB '-[0-9]*')`)[0]?.n ?? 0);
        if (!notNumber) {
          const sample = store.query(`SELECT CAST(${col} AS TEXT) AS v FROM ${q(t.name)} WHERE ${filled} LIMIT 200`, 200).map((r) => String(r.v).trim());
          const leadingZero = sample.some((v) => /^0\d/.test(v));
          if (sample.every((v) => NUMBER.test(v)) && !leadingZero && !ID_LIKE.test(f.name)) {
            out.push({
              table: t.name, field: f.name, kind: 'number',
              title: `${t.name}::${f.name} is a text field that only holds numbers: only accept numbers.`,
              evidence: `Every one of ${fmt(nonEmpty)} values is a number.`,
              changes: [withValidation({ type: 'number' })],
            });
          }
        }
      }
      // A number that goes up with each new record: a serial number.
      if (f.type === 'number' && !ae?.serial && !autoFilled && distinct === nonEmpty && nonEmpty === total) {
        const r = store.query(`SELECT min(${col}) AS lo, max(${col}) AS hi, sum(${col} = CAST(${col} AS INTEGER)) AS ints FROM ${q(t.name)}`)[0];
        const rows = store.query(`SELECT ${col} AS v FROM ${q(t.name)} ORDER BY _fm_record_id`, 5000).map((x) => Number(x.v));
        const rising = rows.every((v, i) => i === 0 || v > rows[i - 1]);
        // Close to one apart (a few deleted records leave gaps), not a year every ten or a running total.
        const dense = Number(r.hi) - Number(r.lo) + 1 <= total * 1.25;
        if (Number(r.ints) === total && rising && dense) {
          const next = String(Number(r.hi) + 1);
          out.push({
            table: t.name, field: f.name, kind: 'serial',
            title: `${t.name}::${f.name} counts up with each new record (${fmt(Number(r.lo))} to ${fmt(Number(r.hi))}): give new records the next serial number.`,
            evidence: `Every value is a whole number, all different, rising in the order records were created.`,
            changes: [{ op: 'updateField', table: t.name, field: f.name, options: { autoEnter: { ...(ae ?? {}), serial: { next, increment: 1 } } } } as DesignOp],
          });
        }
      }
      // One value on nearly every record: enter it for new ones.
      if (f.type === 'text' && !autoFilled && distinct >= 1) {
        const top = store.query(`SELECT CAST(${col} AS TEXT) AS v, count(*) AS c FROM ${q(t.name)} WHERE ${filled} GROUP BY ${col} ORDER BY c DESC LIMIT 1`)[0];
        const share = Number(top?.c ?? 0) / total;
        if (top && share >= 0.9 && String(top.v).length <= 40 && distinct > 1) {
          out.push({
            table: t.name, field: f.name, kind: 'default',
            title: `${t.name}::${f.name} is "${top.v}" on ${Math.floor(share * 100)}% of records: enter "${top.v}" on new records.`,
            evidence: `"${top.v}" on ${where(Number(top.c))}.`,
            changes: [{ op: 'updateField', table: t.name, field: f.name, options: { autoEnter: { ...(ae ?? {}), data: String(top.v) } } } as DesignOp],
          });
        }
      }
    }
    // Many fields are filled in on every record; the ones that name or identify a record matter most.
    const rank = (x: RuleSuggestion) => (ID_LIKE.test(x.field) ? 0 : NAMING.test(x.field) ? 1 : 2);
    const picked = alwaysFilled.filter((x) => rank(x) < 2).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
    out.push(...picked);
    if (alwaysFilled.length > picked.length) moreFilled.push({ table: t.name, fields: alwaysFilled.filter((x) => !picked.includes(x)).map((x) => x.field) });
  }
  const order: RuleKind[] = ['valueList', 'unique', 'serial', 'notEmpty', 'number', 'default'];
  out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { suggestions: out.slice(0, opts.limit ?? 50), alsoAlwaysFilled: moreFilled, tablesChecked: tables.map((t) => t.name) };
}
