// A folder of design text (design-text.ts), read back: what a person (or git) changed in the files becomes the
// design changes that make the hosted file match them, to look over and then apply.
//
// The text form is the file's own export, so the plan is made by comparing files, not by parsing the whole
// design: a file that reads exactly as the file's export would write it is nothing to do, and each file that
// differs is read for the object it names and turned into one DesignOp (createScript, updateCustomFunction,
// updateLayout, ...). Applying the plan and exporting again gives the folder back, which is the round trip.
//
// Careful by default: a file missing from the folder deletes nothing unless asked (`remove`), and what the
// text can't carry (a script's "full access" line, objects in other files) is named in `skipped`, not guessed.
// Tables are read back for adding a table, renaming it, and adding or changing a field's type, kind, comment, formula
// summary and Options (a field is never deleted from text). Table occurrences and relationships are read back too (relationships.txt; only relationships
// are ever deleted, and only with `remove`). Accounts and privilege sets are not
// read back (accounts and privilege sets carry access, so they stay in Manage Security): edits there are listed as skipped, so nothing in a plan is a half-applied change.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { scriptText } from '../../fmp12/src/index.ts';
import type { DesignOp, ValueListFieldSpec } from './design.ts';
import { designObjects, designText, stableJson, type DesignSource } from './design-text.ts';

export interface DesignPlan {
  /** The changes, in the order to apply them (functions and value lists before the scripts and layouts that use them). */
  ops: DesignOp[];
  /** One line for each change, for a person to read. */
  lines: string[];
  /** Files that read as the file's own export. */
  unchanged: number;
  /** Changes in the folder this can't make (and why), and files left alone. */
  skipped: string[];
}

export class DesignApplyError extends Error {}

const KINDS = ['tables/', 'scripts/', 'layouts/', 'value-lists/', 'custom-functions/', 'privilege-sets/'];
const ROOT_FILES = ['relationships.txt', 'accounts.txt', 'file.json'];

/** The design files in a folder (as designText() names them, "/" separators), read as text. Dot folders, other folders and other files are ignored. */
export function readDesignFolder(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      // .git and the like are skipped; a script's name may start with a dot, so its file can too.
      if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(full); continue; }
      if (!e.isFile() || !/\.(txt|json)$/.test(e.name)) continue;
      const rel = relative(dir, full).split(sep).join('/');
      if (ROOT_FILES.includes(rel) || KINDS.some((k) => rel.startsWith(k))) files.set(rel, readFileSync(full, 'utf8'));
    }
  };
  if (!existsSync(dir)) throw new DesignApplyError(`${dir} doesn't exist`);
  walk(dir);
  return files;
}

/** Text without the one newline every file ends with, and with Windows line ends (git on Windows) made plain. */
const body = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n$/, '');

const fail = (path: string, message: string) => new DesignApplyError(`${path}: ${message}`);

const OPTION_KEYS: Record<string, 'boolean' | 'object' | 'string' | 'integer'> = {
  global: 'boolean', unstored: 'boolean', repetitions: 'integer', evaluateWhenEmpty: 'boolean', index: 'object', noAutoIndex: 'boolean',
  indexLanguage: 'string', indexLanguageId: 'integer', autoEnter: 'object', externalStorage: 'object', validation: 'object',
};

/** A field's "Options:" JSON (design-text.ts writes it): an object of known option names with values of the right kind. */
function readOptions(path: string, field: string, json: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(json); } catch (e) { throw fail(path, `the Options of "${field}" are not valid JSON (${(e as Error).message})`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(path, `the Options of "${field}" should be a JSON object`);
  for (const [k, v] of Object.entries(value)) {
    const kind = Object.hasOwn(OPTION_KEYS, k) ? OPTION_KEYS[k] : undefined;
    if (!kind) throw fail(path, `the Options of "${field}" have no "${k}" (they can hold ${Object.keys(OPTION_KEYS).join(', ')})`);
    const ok = kind === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : kind === 'integer' ? Number.isInteger(v) && (v as number) >= (k === 'repetitions' ? 1 : 0) : typeof v === kind;
    if (!ok) throw fail(path, `"${k}" in the Options of "${field}" should be ${kind === 'object' ? 'an object' : kind === 'integer' ? 'a whole number' : `a ${kind}`}`);
  }
  return value as Record<string, unknown>;
}

/** A serial number's next value is left out of the text (it moves with every record): a new field starts at 1, an old one keeps its own. */
function withSerialNext(options: Record<string, unknown>, next: string | undefined): Record<string, unknown> {
  const ae = options.autoEnter as { serial?: { next?: string } } | undefined;
  if (!ae?.serial || ae.serial.next !== undefined) return options;
  return { ...options, autoEnter: { ...ae, serial: { ...ae.serial, next: next ?? '1' } } };
}

/** What to change on a field whose Options line was edited: changed options as they are, removed ones as null. */
function optionsPatch(before: Record<string, unknown>, after: Record<string, unknown>, serialNext: string | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const defaults: Record<string, unknown> = { global: false, unstored: false, repetitions: 1 };
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k in after) { if (stableJson(after[k]) !== stableJson(before[k])) patch[k] = after[k]; }
    else patch[k] = k in defaults ? defaults[k] : null;
  }
  return withSerialNext(patch, serialNext);
}

interface Cut { head: string[]; rest: string }

/** The leading lines that start with one of `prefixes`, and the text after the blank line that follows them. */
function cut(text: string, prefixes: string[]): Cut {
  const lines = text.split('\n');
  let n = 0;
  while (n < lines.length && prefixes.some((p) => lines[n].startsWith(p))) n++;
  if (n < lines.length && lines[n] === '') n++;
  return { head: lines.slice(0, n).filter(Boolean), rest: lines.slice(n).join('\n') };
}

function scriptOp(path: string, text: string, current: DesignSource['schema']['scripts'][number] | undefined): { op?: DesignOp; note?: string; name: string; id?: number } {
  const { head, rest } = cut(text, ['# Script:', '# Run script with full access', '# Limits:']);
  const title = /^# Script: (.*?)(?: \(id (\d+)\))?$/.exec(head.find((l) => l.startsWith('# Script:')) ?? '');
  if (!title) throw fail(path, 'the first line should read "# Script: Name (id 12)"');
  const name = title[1];
  const id = title[2] === undefined ? undefined : Number(title[2]);
  const limitsLine = head.find((l) => l.startsWith('# Limits:'));
  let limits: { steps?: number; seconds?: number; loopPasses?: number } | null = null;
  if (limitsLine) {
    try { limits = JSON.parse(limitsLine.slice('# Limits:'.length)); } catch { throw fail(path, 'the Limits line should hold JSON, like {"steps": 100000}'); }
  }
  const fullAccess = head.some((l) => l.startsWith('# Run script with full access'));
  if (!current) {
    const notes = [fullAccess ? '"full access privileges" can\'t be set from text; set it in Manage Scripts' : '', limits ? 'the Limits line is applied once the script exists; run design-apply again' : ''].filter(Boolean);
    return { op: { op: 'createScript', name, text: rest }, name, id, note: notes.length ? `${path}: ${notes.join('; ')}` : undefined };
  }
  const same = scriptBody(current) === rest;
  const sameLimits = stableJson(current.limits ?? null) === stableJson(limits);
  const note = !!current.fullAccess !== fullAccess ? `${path}: "Run script with full access privileges" is changed in Manage Scripts, not from text` : undefined;
  if (same && sameLimits && name === current.name) return { name, id, note };
  const op: DesignOp = { op: 'updateScript', script: current.id, ...(name !== current.name ? { name } : {}), ...(same ? {} : { text: rest }), ...(sameLimits ? {} : { limits }) };
  return { op, name, id, note };
}

/** A script's steps as the text the export writes. */
const scriptBody = (s: DesignSource['schema']['scripts'][number]) => body(scriptText(s.steps));

export interface FieldBlock {
  name: string; type?: string; kind?: string; comment?: string; calculation?: string; context?: string;
  summary?: { type: string; field: string }; options?: string; raw: string;
}

/** The fields of a table file, as fieldText() in design-text.ts writes them: a name, then indented lines. */
export function parseFields(path: string, text: string): { header: string; fields: FieldBlock[] } {
  const lines = text.split('\n');
  const blocks: string[][] = [];
  for (const l of lines.slice(1)) {
    if (l === '') continue;
    if (!l.startsWith(' ')) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
    else throw fail(path, 'a field line comes before any field name');
  }
  const fields = blocks.map((b): FieldBlock => {
    const f: FieldBlock = { name: b[0], raw: b.join('\n') };
    for (let i = 1; i < b.length; i++) {
      const l = b[i];
      const more = (): string[] => { const out: string[] = []; while (i + 1 < b.length && b[i + 1].startsWith('    ')) out.push(b[++i].slice(4)); return out; };
      let m: RegExpExecArray | null;
      if ((m = /^  Type: (\S+), (\S+)$/.exec(l))) { f.type = m[1]; f.kind = m[2]; }
      else if (l.startsWith('  Comment: ')) f.comment = [l.slice('  Comment: '.length), ...more()].join('\n');
      else if ((m = /^  Summary: (\w+) of (.*)$/.exec(l))) f.summary = { type: m[1], field: m[2] };
      else if ((m = /^  Formula(?: \(from (.*)\))?:$/.exec(l))) { f.calculation = more().join('\n'); if (m[1]) f.context = m[1]; }
      else if (l.startsWith('  Options: ')) f.options = [l.slice('  Options: '.length), ...b.slice(i + 1)].join('\n'); 
      else throw fail(path, `can't read the line "${l.trim()}" under field "${b[0]}"`);
      if (f.options !== undefined) break;
    }
    return f;
  });
  return { header: lines[0], fields };
}

function tableOp(path: string, text: string, curText: string | undefined, current: DesignSource['schema']['tables'][number] | undefined): { ops: DesignOp[]; notes: string[]; name: string } {
  const title = /^Table: (.*?)(?: \(id (\d+)\))?$/.exec(text.split('\n')[0]);
  if (!title) throw fail(path, 'the first line should read "Table: Name (id 12)"');
  const name = title[1];
  const { fields } = parseFields(path, text);
  const seen = new Set<string>();
  for (const f of fields) { if (seen.has(f.name.toLowerCase())) throw fail(path, `field "${f.name}" is written twice`); seen.add(f.name.toLowerCase()); }
  const notes: string[] = [];
  const spec = (f: FieldBlock) => {
    const options = f.options === undefined ? undefined : withSerialNext(readOptions(path, f.name, f.options), undefined);
    return {
      name: f.name, ...(options && Object.keys(options).length ? { options } : {}), ...(f.type ? { type: f.type } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.comment !== undefined ? { comment: f.comment } : {}),
      ...(f.calculation !== undefined ? { calculation: f.calculation } : {}), ...(f.context ? { calculationContext: f.context } : {}),
      ...(f.summary ? { summary: { type: f.summary.type, field: f.summary.field } } : {}),
    };
  };
  if (!current || curText === undefined) return { ops: [{ op: 'createTable', name, fields: fields.map(spec) } as DesignOp], notes, name };
  const before = new Map(parseFields(path, curText).fields.map((f) => [f.name, f]));
  const ops: DesignOp[] = [];
  if (name !== current.name) ops.push({ op: 'renameTable', table: current.id, name });
  for (const f of fields) {
    const old = before.get(f.name);
    if (!old) { ops.push({ op: 'createField', table: current.id, ...spec(f) } as DesignOp); continue; }
    if (old.raw === f.raw) continue;
    const change: Record<string, unknown> = {};
    if (old.options !== f.options) {
      const next = (current.fields.find((x) => x.name === f.name)?.options?.autoEnter?.serial as { next?: string } | undefined)?.next;
      const patch = optionsPatch(old.options === undefined ? {} : readOptions(path, f.name, old.options), f.options === undefined ? {} : readOptions(path, f.name, f.options), next);
      if (Object.keys(patch).length) change.options = patch;
    }
    if (f.type !== old.type) change.type = f.type;
    if (f.kind !== old.kind) change.kind = f.kind;
    if (f.comment !== old.comment) change.comment = f.comment ?? '';
    if (f.calculation !== old.calculation) change.calculation = f.calculation ?? '';
    if (f.context !== old.context && f.context) change.calculationContext = f.context;
    if (stableJson(f.summary ?? null) !== stableJson(old.summary ?? null) && f.summary) change.summary = f.summary;
    if (Object.keys(change).length) ops.push({ op: 'updateField', table: current.id, field: current.fields.find((x) => x.name === f.name)!.id, ...change } as DesignOp);
  }
  for (const n of before.keys()) if (!seen.has(n.toLowerCase())) notes.push(`${path}: field "${n}" is not in the file; it is left in the database (a field is never deleted from text, and a renamed one looks like a new field)`);
  return { ops, notes, name };
}

export interface RelBlock { key: string; left: string; right: string; predicates: string[]; options: string; raw: string }

/** relationships.txt as designText() writes it: the occurrences (name to base table), then the relationships. */
export function parseRelationships(path: string, text: string): { occurrences: Map<string, string>; relationships: RelBlock[] } {
  const lines = text.split('\n');
  const rel = lines.indexOf('Relationships');
  if (lines[0] !== 'Table occurrences' || rel < 0) throw fail(path, 'should start with "Table occurrences" and have a "Relationships" heading');
  const occurrences = new Map<string, string>();
  for (const l of lines.slice(1, rel)) {
    if (l === '') continue;
    const at = l.lastIndexOf(' → ');
    if (at < 0) throw fail(path, `can't read the occurrence line "${l}" (it should read "Name → Table")`);
    const name = l.slice(0, at);
    if (occurrences.has(name.toLowerCase())) throw fail(path, `table occurrence "${name}" is written twice`);
    occurrences.set(name.toLowerCase(), l);
  }
  const blocks: string[][] = [];
  for (const l of lines.slice(rel + 1)) {
    if (l === '') continue;
    if (!l.startsWith(' ')) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
    else throw fail(path, 'a line is indented before any relationship');
  }
  const seen = new Map<string, number>();
  const relationships = blocks.map((b): RelBlock => {
    const at = b[0].indexOf(' ↔ ');
    if (at < 0) throw fail(path, `can't read the relationship "${b[0]}" (it should read "Left ↔ Right")`);
    const n = (seen.get(b[0]) ?? 0) + 1;
    seen.set(b[0], n);
    const options = b.find((l) => l.startsWith('  Options: '))?.slice('  Options: '.length) ?? '';
    return { key: `${b[0]}#${n}`, left: b[0].slice(0, at), right: b[0].slice(at + 3), predicates: b.slice(1).filter((l) => !l.startsWith('  Options: ')).map((l) => l.slice(2)), options, raw: b.join('\n') };
  });
  return { occurrences, relationships };
}

const JOIN_OPERATORS = ['=', '≠', '<', '≤', '>', '≥', '×'];

function predicateOf(path: string, line: string, left: string, right: string) {
  if (!line.startsWith(`${left}::`)) throw fail(path, `the match "${line}" should start with "${left}::"`);
  const rest = line.slice(left.length + 2);
  for (const op of JOIN_OPERATORS) {
    const sep = ` ${op} ${right}::`;
    const at = rest.indexOf(sep);
    if (at > 0) return { left: rest.slice(0, at), operator: op as '=', right: rest.slice(at + sep.length) };
  }
  throw fail(path, `can't read the match "${line}" (it should read "${left}::Field = ${right}::Field")`);
}

function relationshipOptions(path: string, text: string, left: string, right: string): { create: [boolean, boolean]; remove: [boolean, boolean]; sorted: boolean } {
  const out = { create: [false, false] as [boolean, boolean], remove: [false, false] as [boolean, boolean], sorted: false };
  for (const t of text.split(', ').filter(Boolean)) {
    let m: RegExpExecArray | null;
    if (t === 'sorted') out.sorted = true;
    else if ((m = /^(create|delete) in (.*)$/.exec(t))) {
      const kind = m[1] === 'create' ? out.create : out.remove;
      if (m[2] === left && !kind[0]) kind[0] = true;
      else if (m[2] === right) kind[1] = true;
      else throw fail(path, `the option "${t}" names neither side of the relationship`);
    } else throw fail(path, `can't read the option "${t}"`);
  }
  return out;
}

/** The changes that make the table occurrences and relationships match relationships.txt. Nothing is deleted without `remove`. */
function relationshipsPlan(path: string, text: string, curText: string, src: DesignSource, newTables: Set<string>, remove: boolean): { occurrence: DesignOp[]; relationship: DesignOp[]; lines: string[]; notes: string[] } {
  const { schema } = src;
  const want = parseRelationships(path, text);
  const have = parseRelationships(path, curText);
  const out = { occurrence: [] as DesignOp[], relationship: [] as DesignOp[], lines: [] as string[], notes: [] as string[] };
  const tableNames = new Set(schema.tables.map((t) => t.name.toLowerCase()));
  for (const [key, line] of want.occurrences) {
    const old = have.occurrences.get(key);
    if (old === line) continue;
    const at = line.lastIndexOf(' → ');
    const name = line.slice(0, at);
    const base = line.slice(at + 3);
    if (!tableNames.has(base.toLowerCase()) && !newTables.has(base.toLowerCase())) { out.notes.push(`${path}: "${line}" names no table of this file (a table in another file can't be set from text)`); continue; }
    if (!old) {
      if (newTables.has(name.toLowerCase()) && name === base) continue; // the occurrence a new table brings with it
      out.occurrence.push({ op: 'createOccurrence', name, table: base });
      out.lines.push(`Add table occurrence "${name}" of ${base} (${path})`);
    } else {
      out.occurrence.push({ op: 'updateOccurrence', occurrence: name, table: base });
      out.lines.push(`Change table occurrence "${name}" to ${base} (${path})`);
    }
  }
  for (const [key, line] of have.occurrences) if (!want.occurrences.has(key)) out.notes.push(`${path}: table occurrence "${line.slice(0, line.lastIndexOf(' → '))}" is not in the file; it stays (an occurrence is never deleted from text, and a renamed one looks like a new one)`);

  const sorted = [...schema.relationships].sort((a, b) => a.id - b.id);
  const byKey = new Map(have.relationships.map((r, i) => [r.key, { r, id: sorted[i]?.id }]));
  const wantKeys = new Set<string>();
  for (const r of want.relationships) {
    wantKeys.add(r.key);
    const preds = r.predicates.map((l) => predicateOf(path, l, r.left, r.right));
    if (!preds.length) throw fail(path, `the relationship "${r.left} ↔ ${r.right}" needs at least one match`);
    const o = relationshipOptions(path, r.options, r.left, r.right);
    const opts = { leftCreate: o.create[0], rightCreate: o.create[1], leftDelete: o.remove[0], rightDelete: o.remove[1] };
    const old = byKey.get(r.key);
    if (!old) {
      out.relationship.push({ op: 'createRelationship', left: r.left, right: r.right, predicates: preds, ...opts });
      out.lines.push(`Add relationship ${r.left} ↔ ${r.right} (${path})`);
      if (o.sorted) out.notes.push(`${path}: "sorted" on ${r.left} ↔ ${r.right} is set in Manage Database, not from text`);
    } else if (old.r.raw !== r.raw) {
      if (old.id === undefined) continue;
      if (relationshipOptions(path, old.r.options, old.r.left, old.r.right).sorted !== o.sorted) out.notes.push(`${path}: "sorted" on ${r.left} ↔ ${r.right} is set in Manage Database, not from text`);
      out.relationship.push({ op: 'updateRelationship', relationship: old.id, predicates: preds, ...opts });
      out.lines.push(`Change relationship ${r.left} ↔ ${r.right} (${path})`);
    }
  }
  for (const [key, { r, id }] of byKey) {
    if (wantKeys.has(key) || id === undefined) continue;
    if (!remove) { out.notes.push(`${path}: relationship ${r.left} ↔ ${r.right} is not in the file; left in the file (remove it with --remove)`); continue; }
    out.relationship.push({ op: 'deleteRelationship', relationship: id });
    out.lines.push(`Remove relationship ${r.left} ↔ ${r.right} (${path})`);
  }
  return out;
}

function customFunctionOp(path: string, text: string, current: DesignSource['schema']['customFunctions'][number] | undefined): { op?: DesignOp; name: string } {
  const lines = text.split('\n');
  const sig = /^(.+?)(?: \( (.*) \))?( {2}\[JavaScript\])?$/.exec(lines[0]);
  if (!sig) throw fail(path, 'the first line should read "Name ( a ; b )"');
  const name = sig[1].trim();
  const parameters = sig[2] === undefined ? [] : sig[2].split(' ; ').map((p) => p.trim()).filter(Boolean);
  const language = sig[3] ? 'javascript' : 'calculation';
  if (lines[1] !== undefined && lines[1] !== '') throw fail(path, 'a blank line should follow the first line, then the formula');
  const formula = lines.slice(2).join('\n');
  if (!current) return { op: { op: 'createCustomFunction', name, parameters, formula, language }, name };
  const sameLanguage = (current.language ?? 'calculation') === language;
  if (name === current.name && sameLanguage && stableJson(parameters) === stableJson(current.parameters) && formula === (current.formula ?? '')) return { name };
  return { op: { op: 'updateCustomFunction', customFunction: current.id, name, parameters, formula, language }, name };
}

function valueListOp(path: string, text: string, current: DesignSource['schema']['valueLists'][number] | undefined): { op?: DesignOp; name: string; id?: number; note?: string } {
  const lines = text.split('\n');
  const title = /^Value list: (.*?)(?: \(id (\d+)\))?$/.exec(lines[0]);
  if (!title) throw fail(path, 'the first line should read "Value list: Name (id 12)"');
  const name = title[1];
  const id = title[2] === undefined ? undefined : Number(title[2]);
  const keyed = (l: string) => /^(From field: |Also show: |Only related values, from: |Sorted by the second field$|From another file: )/.test(l);
  const rest = lines.slice(lines[1] === '' ? 2 : 1);
  const at = rest.findIndex(keyed);
  const values = at < 0 ? rest : rest.slice(0, at);
  const keys = at < 0 ? [] : rest.slice(at);
  if (current?.values?.some(keyed)) return { name, id, note: `${path}: a typed value reads like a "From field:" line, so this list can't be changed from text; edit it in design mode` };
  if (keys.some((l) => l !== '' && !keyed(l))) throw fail(path, 'a value follows the "From field:" lines, so the file is ambiguous; a list is either typed values or taken from a field');
  if (at >= 0 && values.length) throw fail(path, 'a list is either typed values or taken from a field, not both');
  if (keys.some((l) => l.startsWith('From another file: '))) return { name, id, note: `${path}: a list from another file can't be changed from text` };
  let field: ValueListFieldSpec | undefined;
  const from = keys.find((l) => l.startsWith('From field: '));
  if (from) {
    const m = /^From field: (.*?)::(.*)$/.exec(from);
    if (!m) throw fail(path, '"From field:" should read "From field: Occurrence::Field"');
    field = { occurrence: m[1], field: m[2] };
    const also = keys.find((l) => l.startsWith('Also show: '));
    if (also) {
      const only = also.endsWith(' (only)');
      field.second = also.slice('Also show: '.length, only ? -' (only)'.length : undefined);
      if (only) field.showSecondOnly = true;
    }
    const related = keys.find((l) => l.startsWith('Only related values, from: '));
    if (related) field.related = related.slice('Only related values, from: '.length);
    if (keys.includes('Sorted by the second field')) field.sortBySecond = true;
  }
  if (!current) return { op: { op: 'createValueList', name, ...(field ? { field } : { values }) }, name, id };
  if (current.external) return { name, id, note: `${path}: a list from another file can't be changed from text` };
  const sameName = name === current.name;
  const sameValues = !field && !current.field && stableJson(values) === stableJson(current.values ?? []);
  if (sameName && sameValues) return { name, id };
  return { op: { op: 'updateValueList', valueList: current.id, ...(sameName ? {} : { name }), ...(field ? { field } : { values }) }, name, id };
}

function layoutOp(path: string, text: string, current: DesignSource['schema']['layouts'][number] | undefined): { op?: DesignOp; name: string; id?: number } {
  let design: Record<string, unknown>;
  try { design = JSON.parse(text); } catch (e) { throw fail(path, `isn't valid JSON (${(e as Error).message})`); }
  if (!design || typeof design !== 'object' || Array.isArray(design)) throw fail(path, 'a layout file holds one JSON object');
  const name = typeof design.name === 'string' ? design.name : current?.name;
  if (!name) throw fail(path, 'the layout needs a "name"');
  const id = typeof design.id === 'number' ? design.id : undefined;
  if (!current) {
    const { id: _i, name: _n, tableOccurrenceId, ...rest } = design;
    return { op: { op: 'createLayout', name, ...(tableOccurrenceId !== undefined ? { occurrence: tableOccurrenceId as number } : {}), design: rest }, name, id };
  }
  return { op: { op: 'updateLayout', layout: current.id, ...(name !== current.name ? { name } : {}), design: design as never }, name, id };
}

/**
 * The changes that make the design in `src` match the files in a design folder.
 * `remove`: also delete the scripts, functions, value lists and layouts that have no file.
 */
export function planDesignApply(files: Map<string, string>, src: DesignSource, opts: { remove?: boolean } = {}): DesignPlan {
  const { schema } = src;
  const current = designText(src);
  const objects = designObjects(src);
  const plan: DesignPlan = { ops: [], lines: [], unchanged: 0, skipped: [] };
  const claimed = new Set<string>();
  const named = new Map<string, string>();
  let relText: string | undefined;
  const exportedPathOf = (o: { kind: string; id: number }) => [...objects].find(([, x]) => x.kind === o.kind && x.id === o.id)![0];
  if (opts.remove && !files.has('file.json') && ![...files.keys()].some((p) => KINDS.some((k) => p.startsWith(k)))) throw new DesignApplyError('--remove needs a design folder; this one has no design files, and everything would be deleted');
  const byKind: Record<string, DesignOp[]> = { table: [], occurrence: [], relationship: [], customFunction: [], valueList: [], script: [], layout: [] };
  const push = (kind: string, op: DesignOp, line: string) => { byKind[kind].push(op); plan.lines.push(line); };

  for (const [path, raw] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const text = raw.replace(/\r\n?/g, '\n');
    if (current.get(path) === text) { plan.unchanged++; claimed.add(path); continue; }
    const here = objects.get(path);
    const kindOf = path.startsWith('tables/') ? 'table' : path.startsWith('scripts/') ? 'script' : path.startsWith('layouts/') ? 'layout' : path.startsWith('value-lists/') ? 'valueList' : path.startsWith('custom-functions/') ? 'customFunction' : undefined;
    if (!kindOf) {
      if (path === 'relationships.txt') { claimed.add(path); relText = body(text); continue; }
      if (path === 'accounts.txt' || path === 'file.json' || path.startsWith('privilege-sets/')) plan.skipped.push(`${path}: changed, but ${path.split('/')[0].replace(/\.\w+$/, '')} aren't read back from text yet`);
      continue;
    }
    const idIn = (re: RegExp, from = text) => { const m = re.exec(from); return m?.[1] === undefined ? undefined : Number(m[1]); };
    // The object a file names: by the id in it (so renaming a file or an object keeps it), else the object that had this path.
    const wantId = kindOf === 'table' ? idIn(/^Table: .*? \(id (\d+)\)$/, text.split('\n')[0]) : kindOf === 'script' ? idIn(/^# Script: .*? \(id (\d+)\)$/, text.split('\n')[0])
      : kindOf === 'valueList' ? idIn(/^Value list: .*? \(id (\d+)\)$/)
        : kindOf === 'layout' ? (() => { try { const j = JSON.parse(text); return typeof j?.id === 'number' ? j.id : undefined; } catch { return undefined; } })()
          : undefined;
    const target = (() => {
      if (wantId !== undefined) {
        const o = [...objects.values()].find((x) => x.kind === kindOf && x.id === wantId);
        if (o) return o;
      }
      return here?.kind === kindOf ? here : undefined;
    })();
    if (target) {
      const exportedPath = [...objects].find(([, o]) => o.kind === kindOf && o.id === target.id)?.[0];
      if (exportedPath) claimed.add(exportedPath);
      if (exportedPath && exportedPath !== path && wantId === target.id) plan.skipped.push(`${path}: names ${target.kind === 'valueList' ? 'value list' : target.kind} "${target.name}" (id ${target.id}), which was exported as ${exportedPath}; that one is changed`);
      if (named.has(`${target.kind}:${target.id}`)) throw fail(path, `names the same ${target.kind} (id ${target.id}) as ${named.get(`${target.kind}:${target.id}`)}`);
      named.set(`${target.kind}:${target.id}`, path);
    }
    claimed.add(path);
    const label = `${path}`;
    if (kindOf === 'table') {
      const cur = target && schema.tables.find((t) => t.id === target.id);
      const r = tableOp(path, body(text), target ? current.get(exportedPathOf(target)) : undefined, cur);
      plan.skipped.push(...r.notes);
      if (r.ops.length) { byKind.table.push(...r.ops); plan.lines.push(`${r.ops[0].op === 'createTable' ? 'Add' : 'Change'} table "${r.name}" (${label})`); }
      else plan.unchanged++;
    } else if (kindOf === 'script') {
      const cur = target && schema.scripts.find((s) => s.id === target.id);
      const r = scriptOp(path, body(text), cur);
      if (r.note) plan.skipped.push(r.note);
      if (r.op) push('script', r.op, `${r.op.op === 'createScript' ? 'Add' : 'Change'} script "${r.name}" (${label})`);
      else plan.unchanged++;
    } else if (kindOf === 'customFunction') {
      const cur = target && schema.customFunctions.find((c) => c.id === target.id);
      const r = customFunctionOp(path, body(text), cur);
      if (r.op) push('customFunction', r.op, `${r.op.op === 'createCustomFunction' ? 'Add' : 'Change'} custom function "${r.name}" (${label})`);
      else plan.unchanged++;
    } else if (kindOf === 'valueList') {
      const cur = target && schema.valueLists.find((v) => v.id === target.id);
      const r = valueListOp(path, body(text), cur);
      if (r.note) plan.skipped.push(r.note);
      if (r.op) push('valueList', r.op, `${r.op.op === 'createValueList' ? 'Add' : 'Change'} value list "${r.name}" (${label})`);
      else if (!r.note) plan.unchanged++;
    } else {
      const cur = target && schema.layouts.find((l) => l.id === target.id);
      const r = layoutOp(path, body(text), cur);
      if (r.op) push('layout', r.op, `${r.op.op === 'createLayout' ? 'Add' : 'Change'} layout "${r.name}" (${label})`);
    }
  }

  // Occurrences and relationships, after the tables, so a new table's own occurrence is known.
  if (relText !== undefined) {
    const newTables = new Set(byKind.table.filter((o) => o.op === 'createTable').map((o) => (o as { name: string }).name.toLowerCase()));
    const r = relationshipsPlan('relationships.txt', relText, body(current.get('relationships.txt') ?? ''), src, newTables, !!opts.remove);
    byKind.occurrence.push(...r.occurrence);
    byKind.relationship.push(...r.relationship);
    plan.lines.push(...r.lines);
    plan.skipped.push(...r.notes);
    if (!r.lines.length) plan.unchanged++;
  }

  // Objects whose files are gone.
  for (const [path, o] of objects) {
    if (claimed.has(path)) continue;
    if (o.kind === 'table') { plan.skipped.push(`${path}: not in the folder; the table stays (a table is never deleted from text)`); continue; }
    if (!opts.remove) { plan.skipped.push(`${path}: not in the folder; left in the file (remove it with --remove)`); continue; }
    const ops: Record<string, DesignOp> = {
      script: { op: 'deleteScript', script: o.id }, layout: { op: 'deleteLayout', layout: o.id },
      valueList: { op: 'deleteValueList', valueList: o.id }, customFunction: { op: 'deleteCustomFunction', customFunction: o.id },
    };
    byKind[o.kind].push(ops[o.kind]);
    plan.lines.push(`Remove ${o.kind === 'customFunction' ? 'custom function' : o.kind === 'valueList' ? 'value list' : o.kind} "${o.name}" (${path})`);
  }

  plan.ops = [...byKind.table, ...byKind.occurrence, ...byKind.relationship, ...byKind.customFunction, ...byKind.valueList, ...byKind.script, ...byKind.layout];
  return plan;
}
