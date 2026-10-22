// FileMaker's clipboard format: the <fmxmlsnippet type="FMObjectList"> XML
// that FileMaker Pro puts on the clipboard when a developer copies tables,
// fields, scripts, script steps, custom functions or value lists. Reading it
// turns a paste from real FileMaker into design ops for this file.
//
// The element and attribute grammar follows Andrew Kear's round-trip tested
// specifications (github.com/andykear, CC BY 4.0) and FileMaker's own
// Database Design Report, whose <Step> elements are the same as the
// clipboard's. As FileMaker does on paste, references resolve by name in the
// target file (ids in the XML are the source file's), and a name already in
// use gets a " 2" suffix.
//
// Layout objects (LayoutObjectList snippets) are not read yet.

import { NameTable, fieldSpans } from '../../calc/src/index.ts';
import {
  scriptStepId, scriptStepName,
  type AutoEnterValue, type FieldLookup, type FieldOptions, type FieldRef, type FieldType, type Ref as IdRef, type Schema, type SortField,
  type StepParams, type StoredFindRequest, type SummaryType, type Table,
} from '../../fmp12/src/index.ts';
import { DesignError, type DesignOp, type FieldOptionsSpec, type FieldSpec, type Ref, type StepSpec } from './design.ts';
import { ADJUST } from './snippet-xml.ts';

// ---------------------------------------------------------------- XML

export interface XmlElement { name: string; attrs: Record<string, string>; children: (XmlElement | string)[] }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] !== '#') return ENTITIES[e] ?? m;
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
  return code <= 0x10ffff ? String.fromCodePoint(code) : m;
});
/** Deeper than any FileMaker XML; readers of the tree recurse, so a hostile depth would exhaust the stack. */
const MAX_XML_DEPTH = 512;

/** A small XML reader: elements, attributes, text, CDATA and entities (no DTDs or namespaces). */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let at = 0;
  const bad = (what: string) => new DesignError(960, `The XML can't be read: ${what} (at character ${at})`);
  while (at < xml.length) {
    const lt = xml.indexOf('<', at);
    if (lt < 0) {
      top().children.push(decode(xml.slice(at)));
      break;
    }
    if (lt > at) top().children.push(decode(xml.slice(at, lt)));
    at = lt;
    if (xml.startsWith('<!--', at)) {
      const end = xml.indexOf('-->', at);
      if (end < 0) throw bad('a comment is never closed');
      at = end + 3;
    } else if (xml.startsWith('<![CDATA[', at)) {
      const end = xml.indexOf(']]>', at);
      if (end < 0) throw bad('a CDATA section is never closed');
      top().children.push(xml.slice(at + 9, end));
      at = end + 3;
    } else if (xml.startsWith('<?', at) || xml.startsWith('<!', at)) {
      const end = xml.indexOf('>', at);
      if (end < 0) throw bad('a declaration is never closed');
      at = end + 1;
    } else if (xml.startsWith('</', at)) {
      const end = xml.indexOf('>', at);
      const name = xml.slice(at + 2, end).trim();
      if (end < 0 || top().name !== name) throw bad(`</${name}> doesn't close <${top().name}>`);
      stack.pop();
      at = end + 1;
    } else {
      const m = /^<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(xml.slice(at, at + 100_000));
      if (!m) throw bad('a tag is malformed');
      if (stack.length > MAX_XML_DEPTH) throw bad(`elements are nested more than ${MAX_XML_DEPTH} deep`);
      const el: XmlElement = { name: m[1], attrs: {}, children: [] };
      for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = decode(a[2] ?? a[3]);
      top().children.push(el);
      if (!m[3]) {
        stack.push(el);
      }
      at += m[0].length;
    }
  }
  if (stack.length > 1) throw bad(`<${top().name}> is never closed`);
  return root;
}

export const kids = (el: XmlElement | undefined, name?: string) =>
  (el?.children ?? []).filter((c): c is XmlElement => typeof c !== 'string' && (name === undefined || c.name === name));
export const kid = (el: XmlElement | undefined, name: string) => kids(el, name)[0];
/** An element's text, with FileMaker's carriage returns as line feeds. */
export const text = (el: XmlElement | undefined) =>
  el ? el.children.map((c) => (typeof c === 'string' ? c : '')).join('').replace(/\r\n?/g, '\n') : undefined;
const isTrue = (v: string | undefined) => v === 'True';
const state = (el: XmlElement | undefined, name: string) => isTrue(kid(el, name)?.attrs.state);
/** The formula of <Name><Calculation>...</Calculation></Name>, or of a direct <Calculation>. */
export const calcOf = (el: XmlElement | undefined, wrapper?: string) => text(kid(wrapper ? kid(el, wrapper) : el, 'Calculation'));

// ---------------------------------------------------------------- reading a snippet

export interface SnippetOptions {
  /** Fields without a <BaseTable> go into this table. */
  table?: Ref;
  /** Script steps without a <Script> go into this script, at `at` (a step index; default the end). */
  script?: Ref;
  at?: number;
}

export interface SnippetChanges {
  /** Design ops that make the pasted objects, ready for Store.applyDesign. */
  changes: DesignOp[];
  /** What was pasted, e.g. "2 tables", "14 script steps". */
  summary: string[];
  /** What couldn't be carried over as it was (unknown references, options Tabularius doesn't keep). */
  notes: string[];
}

const lower = (s: string) => s.toLowerCase();
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A name not yet in `taken`, with FileMaker's " 2", " 3", ... suffix; adds it to `taken`. */
function freeName(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(lower(out)); n++) out = `${name} ${n}`;
  taken.add(lower(out));
  return out;
}

/** Read a FileMaker clipboard snippet into design ops for `schema`. */
export function snippetChanges(xml: string, schema: Schema, opts: SnippetOptions = {}): SnippetChanges {
  const doc = parseXml(xml.trim());
  const snippet = kid(doc, 'fmxmlsnippet');
  if (!snippet) throw new DesignError(960, 'This isn\'t FileMaker clipboard XML: it should start with <fmxmlsnippet>');
  if (snippet.attrs.type === 'LayoutObjectList') throw new DesignError(960, 'Pasting layout objects from FileMaker isn\'t supported yet: paste tables, fields, scripts, steps, custom functions or value lists');
  const notes: string[] = [];
  const summary: string[] = [];
  const changes: DesignOp[] = [];
  const all = kids(snippet);
  const tables = all.filter((e) => e.name === 'BaseTable');
  const fields = all.filter((e) => e.name === 'Field');
  const functions = all.filter((e) => e.name === 'CustomFunction');
  const valueLists = all.filter((e) => e.name === 'ValueList');
  // Script folders (<Group>) paste as their scripts; the folder itself isn't recreated.
  const scripts: XmlElement[] = [];
  const flatten = (list: XmlElement[]) => {
    for (const e of list) {
      if (e.name === 'Script') scripts.push(e);
      else if (e.name === 'Group') flatten(kids(e));
    }
  };
  flatten(all);
  if (all.some((e) => e.name === 'Group')) notes.push('Script folders paste as their scripts, without the folder');
  const steps = all.filter((e) => e.name === 'Step');
  const known = new Set(['BaseTable', 'Field', 'CustomFunction', 'ValueList', 'Script', 'Group', 'Step']);
  for (const name of new Set(all.filter((e) => !known.has(e.name)).map((e) => e.name))) notes.push(`<${name}> elements aren't read and were skipped`);

  // Custom functions and value lists first: fields and scripts may use them.
  const cfNames = new Set(schema.customFunctions.map((c) => lower(c.name)));
  for (const cf of functions) {
    const want = cf.attrs.name ?? 'Untitled';
    const name = freeName(want, cfNames);
    if (name !== want) notes.push(`Custom function "${want}" already exists: pasted as "${name}"`);
    const parameters = (cf.attrs.parameters ?? '').split(';').map((p) => p.trim()).filter(Boolean);
    changes.push({ op: 'createCustomFunction', name, parameters, formula: calcOf(cf) ?? '' });
  }
  if (functions.length) summary.push(plural(functions.length, 'custom function'));

  const vlNames = new Set(schema.valueLists.map((v) => lower(v.name)));
  for (const vl of valueLists) {
    const want = vl.attrs.name ?? 'Untitled';
    const name = freeName(want, vlNames);
    if (name !== want) notes.push(`Value list "${want}" already exists: pasted as "${name}"`);
    const source = kid(vl, 'Source')?.attrs.value;
    if (source === 'Field') {
      const primary = kid(kid(vl, 'PrimaryField'), 'Field');
      const second = kid(vl, 'SecondaryField');
      const related = kid(kid(vl, 'ShowRelated'), 'Table');
      const occ = primary && toByName(schema, primary.attrs.table);
      if (!occ || !primary) {
        notes.push(`Value list "${name}": its field ${primary?.attrs.table ?? ''}::${primary?.attrs.name ?? ''} isn't in this file, so it has no values`);
        changes.push({ op: 'createValueList', name, values: [] });
        continue;
      }
      changes.push({
        op: 'createValueList', name,
        field: {
          occurrence: occ.name, field: primary.attrs.name,
          ...(second ? { second: kid(second, 'Field')?.attrs.name ?? null, showSecondOnly: isTrue(second.attrs.show), sortBySecond: isTrue(second.attrs.sort) } : {}),
          ...(related && isTrue(kid(vl, 'ShowRelated')?.attrs.value) ? { related: related.attrs.name } : {}),
        },
      });
    } else {
      if (source && source !== 'Custom') notes.push(`Value list "${name}": values from ${source === 'External' ? 'another file' : source} aren't supported, so it was pasted empty`);
      const values = (text(kid(kid(vl, 'CustomValues'), 'Text')) ?? '').split('\n').filter((v) => v !== '');
      changes.push({ op: 'createValueList', name, values });
    }
  }
  if (valueLists.length) summary.push(plural(valueLists.length, 'value list'));

  // Tables: each with its fields, an occurrence and a layout, as FileMaker's Tables tab paste makes.
  const tableNames = new Set(schema.tables.map((t) => lower(t.name)));
  for (const bt of tables) {
    const want = bt.attrs.name ?? 'Untitled';
    const name = freeName(want, tableNames);
    if (name !== want) notes.push(`Table "${want}" already exists: pasted as "${name}"`);
    const specs = fieldSpecs(kids(bt, 'Field'), schema, undefined, notes, `${name}::`);
    changes.push({ op: 'createTable', name, fields: specs });
    if (bt.attrs.comment) notes.push(`Table "${name}": table comments aren't kept`);
  }
  if (tables.length) summary.push(plural(tables.length, 'table'));

  if (fields.length) {
    if (opts.table === undefined) throw new DesignError(960, 'Pick a table to paste these fields into');
    const table = typeof opts.table === 'number' ? schema.tables.find((t) => t.id === opts.table) : schema.tables.find((t) => lower(t.name) === lower(String(opts.table)));
    if (!table) throw new DesignError(960, `There's no table "${opts.table}"`);
    for (const spec of fieldSpecs(fields, schema, table, notes, `${table.name}::`)) changes.push({ op: 'createField', table: table.id, ...spec });
    summary.push(plural(fields.length, 'field'));
  }

  if (scripts.length || steps.length) {
    // Pasted scripts get their ids up front, so Perform Script steps between them resolve.
    const scriptNames = new Set(schema.scripts.map((s) => lower(s.name)));
    let next = Math.max(0, ...schema.scripts.map((s) => s.id)) + 1;
    const pasted = scripts.map((sc) => {
      const want = sc.attrs.name ?? 'New Script';
      const name = freeName(want, scriptNames);
      if (name !== want) notes.push(`Script "${want}" already exists: pasted as "${name}"`);
      return { el: sc, id: next++, name, want };
    });
    const ctx: StepContext = { schema, notes, scripts: new Map(pasted.map((p) => [lower(p.want), { id: p.id, name: p.name }])) };
    for (const p of pasted) {
      const list = kid(p.el, 'StepList') ? kids(kid(p.el, 'StepList'), 'Step') : kids(p.el, 'Step');
      changes.push({ op: 'createScript', id: p.id, name: p.name, steps: list.map((s) => stepSpec(s, ctx)) });
    }
    if (scripts.length) summary.push(plural(scripts.length, 'script'));
    if (steps.length) {
      const specs = steps.map((s) => stepSpec(s, ctx));
      const target = opts.script === undefined ? undefined
        : typeof opts.script === 'number' ? schema.scripts.find((s) => s.id === opts.script) : schema.scripts.find((s) => lower(s.name) === lower(String(opts.script)));
      if (opts.script !== undefined && !target) throw new DesignError(960, `There's no script "${opts.script}"`);
      if (target) {
        const current: StepSpec[] = target.steps.map((s) => ({ ...s }));
        const at = Math.max(0, Math.min(current.length, opts.at ?? current.length));
        current.splice(at, 0, ...specs);
        changes.push({ op: 'updateScript', script: target.id, steps: current });
      } else {
        changes.push({ op: 'createScript', name: freeName('Pasted Steps', scriptNames), steps: specs });
      }
      summary.push(plural(steps.length, 'script step'));
    }
  }

  if (!changes.length) throw new DesignError(960, 'The snippet has nothing to paste');
  return { changes, summary, notes };
}

const toByName = (s: Schema, name: string | undefined) =>
  name === undefined ? undefined : s.tableOccurrences.find((t) => lower(t.name) === lower(name));
const tableOf = (s: Schema, toId: number): Table | undefined => {
  const to = s.tableOccurrences.find((t) => t.id === toId);
  return to && !to.dataSourceId ? s.tables.find((t) => t.id === to.baseTableId) : undefined;
};

// ---------------------------------------------------------------- fields

const DATA_TYPES: Record<string, FieldType> = { Text: 'text', Number: 'number', Date: 'date', Time: 'time', TimeStamp: 'timestamp', Binary: 'container' };
const AUTO_VALUES: Record<string, AutoEnterValue> = {
  CreationDate: 'creationDate', CreationTime: 'creationTime', CreationTimeStamp: 'creationTimestamp', CreationName: 'creationName', CreationAccountName: 'creationAccountName',
  ModificationDate: 'modificationDate', ModificationTime: 'modificationTime', ModificationTimeStamp: 'modificationTimestamp', ModificationName: 'modificationName', ModificationAccountName: 'modificationAccountName',
};
/** Summary operations; the running, weighted and subtotalled variants keep their base operation. */
const SUMMARY_OPS: Record<string, SummaryType> = {
  Total: 'total', RunningTotal: 'total', Average: 'average', WeightedAverage: 'average', Count: 'count', RunningCount: 'count',
  Minimum: 'minimum', Maximum: 'maximum', StdDeviation: 'stdDev', StdDeviationByPopulation: 'stdDevP',
  Fractional: 'fractionOfTotal', FractionalSubtotal: 'fractionOfTotal', List: 'list',
};
const BASE_SUMMARY_OPS = new Set(['Total', 'Average', 'Count', 'Minimum', 'Maximum', 'StdDeviation', 'StdDeviationByPopulation', 'Fractional', 'List']);
const STRICT_TYPES = { Numeric: 'number', FourDigitYear: 'date4', TimeOfDay: 'time' } as const;

/**
 * Field specs for <Field> elements, pasted into `table` (an existing table)
 * or a new one (undefined). Names already in the table get a suffix, and the
 * pasted formulas follow the renamed copies, as FileMaker's paste does.
 * Summary fields go last, since they name fields of the same paste.
 */
function fieldSpecs(els: XmlElement[], schema: Schema, table: Table | undefined, notes: string[], where: string): FieldSpec[] {
  const taken = new Set((table?.fields ?? []).map((f) => lower(f.name)));
  const renamed = new Map<string, string>();
  const named = els.map((el) => {
    const want = el.attrs.name ?? 'Untitled';
    const name = freeName(want, taken);
    if (name !== want) {
      renamed.set(lower(want), name);
      notes.push(`Field ${where}${want} already exists: pasted as "${name}"`);
    }
    return { el, name };
  });
  const allNames = [...(table?.fields ?? []).map((f) => f.name), ...named.map((n) => n.el.attrs.name ?? '')];
  const ownTos = table ? schema.tableOccurrences.filter((t) => !t.dataSourceId && t.baseTableId === table.id).map((t) => lower(t.name)) : [];
  const follow = (formula: string | undefined) => {
    if (formula === undefined || !renamed.size) return formula;
    let spans;
    try {
      spans = fieldSpans(formula, new NameTable({ fields: allNames }));
    } catch {
      return formula;
    }
    let out = '';
    let last = 0;
    for (const sp of spans) {
      const to = renamed.get(lower(sp.name));
      if (!to || (sp.occurrence !== undefined && !ownTos.includes(lower(sp.occurrence)))) continue;
      out += formula.slice(last, sp.at) + (sp.occurrence !== undefined ? `${sp.occurrence}::${to}` : to);
      last = sp.end;
    }
    return last ? out + formula.slice(last) : formula;
  };
  const specs = named.map(({ el, name }) => fieldSpec(el, name, schema, table, notes, where, follow, (n) => renamed.get(lower(n)) ?? n));
  return [...specs.filter((s) => s.kind !== 'summary'), ...specs.filter((s) => s.kind === 'summary')];
}

function fieldSpec(
  el: XmlElement, name: string, schema: Schema, table: Table | undefined, notes: string[], where: string,
  follow: (f: string | undefined) => string | undefined, fieldName: (n: string) => string,
): FieldSpec {
  const label = `${where}${name}`;
  const type = DATA_TYPES[el.attrs.dataType ?? 'Text'];
  if (!type) notes.push(`Field ${label}: data type "${el.attrs.dataType}" isn't known, so it's text`);
  const kind = el.attrs.fieldType === 'Calculated' ? 'calculation' : el.attrs.fieldType === 'Summary' ? 'summary' : 'normal';
  const spec: FieldSpec = { name, type: type ?? 'text', kind };
  const comment = text(kid(el, 'Comment'));
  if (comment) spec.comment = comment;
  const options: FieldOptionsSpec = {};
  const storage = kid(el, 'Storage');
  if (isTrue(storage?.attrs.global)) options.global = true;
  const reps = Number(storage?.attrs.maxRepetition ?? 1);
  if (reps > 1) options.repetitions = reps;
  // Indexing: None (the default), Minimal or All; automatic indexing; the index language by name.
  if (storage?.attrs.index === 'Minimal') options.index = 'minimal';
  else if (storage?.attrs.index === 'All') options.index = 'all';
  if (storage?.attrs.autoIndex === 'False') options.noAutoIndex = true;
  const language = storage?.attrs.indexLanguage;
  if (language && /^[A-Za-z_]+$/.test(language)) options.indexLanguage = language;
  // Container data stored externally: secure, or open under a path calculation, in a base directory of this file.
  const remote = kid(storage, 'Remote');
  if (remote && type === 'container') {
    let directory = Number(remote.attrs.relativeTo ?? 0);
    if (directory !== 0 && !schema.containerDirectories?.some((d) => d.id === directory)) {
      notes.push(`Field ${label}: base directory ${directory} isn't one of this file's, so it uses the default`);
      directory = 0;
    }
    const path = text(kid(kid(remote, 'Location'), 'Calculation'));
    options.externalStorage = remote.attrs.type === 'Secure' || !path ? { directory, secure: true } : { directory, path };
  }
  const auto = kid(el, 'AutoEnter');
  // A context occurrence is kept only when it is one of the field's own table's (new tables use their own).
  const context = (calc: XmlElement | undefined) => {
    const to = table && toByName(schema, calc?.attrs.table);
    return to && !to.dataSourceId && to.baseTableId === table.id ? { calculationContext: to.id } : {};
  };

  if (kind === 'calculation') {
    const calc = kid(el, 'Calculation');
    spec.calculation = follow(text(calc)) ?? '';
    Object.assign(spec, context(calc));
    if (storage?.attrs.storeCalculationResults === 'False') options.unstored = true;
    if (isTrue(auto?.attrs.alwaysEvaluate)) options.evaluateWhenEmpty = true;
  } else if (kind === 'summary') {
    const info = kid(el, 'SummaryInfo');
    const op = info?.attrs.operation ?? 'Total';
    const of = kid(kid(info, 'SummaryField'), 'Field')?.attrs.name;
    spec.summary = { type: SUMMARY_OPS[op] ?? 'total', field: of ? fieldName(of) : '' };
    if (!BASE_SUMMARY_OPS.has(op)) notes.push(`Field ${label}: the "${op}" summary is pasted as ${spec.summary.type}`);
    if (isTrue(info?.attrs.restartForEachSortedGroup)) notes.push(`Field ${label}: "restart summary for each sorted group" isn't kept`);
  } else {
    const ae: NonNullable<FieldOptions['autoEnter']> = {};
    if (auto) {
      if (auto.attrs.allowEditing === 'False') ae.prohibitModification = true;
      const value = auto.attrs.value;
      if (value && AUTO_VALUES[value]) ae.value = AUTO_VALUES[value];
      else if (value === 'PreviousRecord') ae.lastVisited = true;
      if (value === 'ConstantData' || isTrue(auto.attrs.constant)) {
        const data = text(kid(auto, 'ConstantData'));
        if (data) ae.data = data;
      }
      const serial = kid(auto, 'Serial');
      if (serial) {
        ae.serial = { next: serial.attrs.nextValue ?? '1', increment: Number(serial.attrs.increment ?? 1) || 1 };
        if (serial.attrs.generate === 'OnCommit') ae.serial.onCommit = true;
      }
      const calc = kid(auto, 'Calculation');
      if (isTrue(auto.attrs.calculation) && calc) {
        spec.calculation = follow(text(calc)) ?? '';
        Object.assign(spec, context(calc));
        ae.calculation = true;
        if (isTrue(auto.attrs.overwriteExistingValue)) ae.replaceExisting = true;
        if (isTrue(auto.attrs.alwaysEvaluate)) ae.evaluateWhenEmpty = true;
      }
      const lookup = kid(auto, 'Lookup');
      if (isTrue(auto.attrs.lookup) && lookup) {
        const resolved = lookupOf(lookup, schema, table);
        if (resolved) ae.lookup = resolved;
        else notes.push(`Field ${label}: its lookup from ${kid(lookup, 'Field')?.attrs.table ?? '?'}::${kid(lookup, 'Field')?.attrs.name ?? '?'} doesn't resolve in this file, so it was left out`);
      }
    }
    if (Object.keys(ae).length) options.autoEnter = ae;
    const v = kid(el, 'Validation');
    if (v) {
      const val: NonNullable<FieldOptions['validation']> = {};
      if (v.attrs.type === 'Always') val.always = true;
      const strictType = kid(v, 'StrictDataType')?.attrs.value as keyof typeof STRICT_TYPES | undefined;
      if (strictType && STRICT_TYPES[strictType]) val.type = STRICT_TYPES[strictType];
      if (isTrue(kid(v, 'NotEmpty')?.attrs.value)) val.notEmpty = true;
      if (isTrue(kid(v, 'Unique')?.attrs.value)) val.unique = true;
      if (isTrue(kid(v, 'Existing')?.attrs.value)) val.existing = true;
      if (isTrue(v.attrs.valuelist)) {
        const listName = kid(v, 'ValueList')?.attrs.name;
        const list = listName !== undefined ? schema.valueLists.find((l) => lower(l.name) === lower(listName)) : undefined;
        if (list) val.valueList = list.id;
        else notes.push(`Field ${label}: its value list ${listName ? `"${listName}" ` : ''}isn't in this file, so that check was left out`);
      }
      const range = kid(v, 'Range');
      if (range) val.range = { min: range.attrs.from ?? '', max: range.attrs.to ?? '' };
      const vc = kid(v, 'Calculation');
      if (isTrue(v.attrs.calculation) && vc) val.calculation = follow(text(vc));
      if (val.calculation !== undefined && isTrue(v.attrs.alwaysValidateCalculation)) val.calculationAlways = true;
      const max = Number(kid(v, 'MaxDataLength')?.attrs.value);
      if (isTrue(v.attrs.maxLength) && max > 0) val.maxLength = max;
      if (isTrue(kid(v, 'StrictValidation')?.attrs.value)) val.strict = true;
      const message = text(kid(v, 'ErrorMessage'));
      const messageCalc = isTrue(v.attrs.messageCalc) ? follow(text(kid(kid(v, 'MessageCalculation'), 'Calculation'))) : undefined;
      if (messageCalc !== undefined) {
        val.message = messageCalc;
        val.messageCalculation = true;
      } else if (isTrue(v.attrs.message) && message) val.message = message;
      if (Object.keys(val).length) options.validation = val;
    }
  }
  if (Object.keys(options).length) spec.options = options;
  return spec;
}

/** A lookup's related occurrence and field, by name; none when the field's table is new (it has no relationships yet). */
function lookupOf(el: XmlElement, schema: Schema, table: Table | undefined): FieldLookup | undefined {
  if (!table) return undefined;
  const f = kid(el, 'Field');
  const to = toByName(schema, f?.attrs.table);
  const source = to && tableOf(schema, to.id);
  const field = source?.fields.find((x) => lower(x.name) === lower(f?.attrs.name ?? ''));
  if (!to || !field) return undefined;
  const out: FieldLookup = { occurrenceId: to.id, fieldId: field.id };
  const noMatch = kid(el, 'NoMatchCopyOption')?.attrs.value;
  if (noMatch === 'CopyConstant') {
    out.noMatch = 'value';
    out.value = text(kid(el, 'CopyConstantValue')) ?? '';
  } else if (noMatch === 'CopyNextLower') out.noMatch = 'lower';
  else if (noMatch === 'CopyNextHigher') out.noMatch = 'higher';
  if (isTrue(kid(el, 'CopyEmptyContent')?.attrs.value)) out.copyEmpty = true;
  return out;
}

// ---------------------------------------------------------------- script steps

export interface StepContext {
  schema: Schema;
  notes: string[];
  /** Scripts of this paste, by the name they had in the copied file. */
  scripts: Map<string, IdRef>;
}

const LOCATIONS = { First: 'first', Last: 'last', Previous: 'previous', Next: 'next', ByCalculation: 'calculation' } as const;
/** Steps whose options are a target field or variable and a formula. */
const TARGET_STEPS = new Set(['Set Field', 'Set Next Serial Value', 'Insert Calculated Result', 'Replace Field Contents', 'Insert from URL', 'Go to Field',
  'Insert Text', 'Copy', 'Cut', 'Paste', 'Clear', 'Insert File', 'Export Field Contents']);
/** Target steps with FileMaker's Select entire contents option (<SelectAll state="True"/>). */
const SELECT_STEPS = new Set(['Insert Calculated Result', 'Insert Text', 'Insert from URL', 'Execute FileMaker Data API',
  'Copy', 'Cut', 'Paste', 'Clear', 'Check Selection']);
const DIALOG_STEPS = new Set(['Delete Record/Request', 'Delete Portal Row', 'Omit Multiple Records', 'Delete All Records', 'Commit Records/Requests', 'Revert Record/Request', 'Truncate Table',
  'Go to Record/Request/Page', 'Go to Portal Row', 'Sort Records', 'Replace Field Contents', 'Re-Login']);
/** Child elements that hold no option Tabularius keeps, so they aren't worth a note. */
const QUIET = new Set(['StepText', 'DisplayCalculation', 'DisableStepCollapsed', 'NoInteract', 'Restore', 'Option', 'ESSForceCommit', 'SelectAll', 'CurrentScript', 'FlushType',
  'Pause', 'PauseTime', 'LayoutDestination', 'RowPageLocation', 'Set', 'Exit', 'UseAsFileDefault', 'Animation', 'DontEncodeURL', 'VerifySSLCertificates', 'Collapsed']);

export function stepSpec(el: XmlElement, ctx: StepContext): StepSpec {
  const want = el.attrs.name ?? '';
  const stepId = scriptStepId(want) ?? (el.attrs.id !== undefined && !scriptStepName(+el.attrs.id).startsWith('Unknown step') ? +el.attrs.id : undefined);
  const enabled = el.attrs.enable !== 'False';
  if (stepId === undefined) {
    ctx.notes.push(`"${want}" isn't a script step Tabularius knows: pasted as a comment`);
    return { stepId: 89, enabled: false, text: `${want} (pasted from FileMaker; not supported)` };
  }
  const name = scriptStepName(stepId);
  if (stepId === 89) {
    const t = text(kid(el, 'Text'));
    return { stepId, enabled, ...(t ? { text: t } : {}) };
  }
  const p = stepParams(name, el, ctx);
  // Open File and Close File with no file named act on the current file ("Current File").
  const keep = p && (Object.keys(p).length || name === 'Open File' || name === 'Close File');
  return { stepId, enabled, ...(keep ? { params: p } : {}) };
}

function fieldRef(el: XmlElement, ctx: StepContext, step: string): FieldRef {
  const toName = el.attrs.table ?? '';
  const fName = el.attrs.name ?? '';
  const to = toByName(ctx.schema, toName);
  const field = to && tableOf(ctx.schema, to.id)?.fields.find((f) => lower(f.name) === lower(fName));
  if (!field) ctx.notes.push(`${step}: the field ${toName}::${fName} isn't in this file`);
  const out: FieldRef = { tableOccurrence: { id: to?.id ?? 0, name: to?.name ?? toName }, field: { id: field?.id ?? 0, name: field?.name ?? fName } };
  const rep = Number(el.attrs.repetition);
  if (rep > 1) out.repetition = rep;
  return out;
}

function byName(list: { id: number; name: string }[], el: XmlElement | undefined, ctx: StepContext, what: string, step: string): IdRef | undefined {
  if (!el) return undefined;
  const name = el.attrs.name ?? '';
  const hit = list.find((x) => lower(x.name) === lower(name));
  if (!hit) ctx.notes.push(`${step}: the ${what} "${name}" isn't in this file`);
  return hit ? { id: hit.id, name: hit.name } : { id: 0, name };
}

function stepParams(name: string, el: XmlElement, ctx: StepContext): StepParams | undefined {
  const s = ctx.schema;
  const p: StepParams = {};
  const used = new Set<string>(QUIET);
  const take = (n: string) => {
    used.add(n);
    return kid(el, n);
  };
  const ownCalc = () => {
    used.add('Calculation');
    return calcOf(el);
  };
  const noDialog = kid(el, 'NoInteract');
  if (noDialog && DIALOG_STEPS.has(name)) p.noDialog = isTrue(noDialog.attrs.state);
  const target = () => {
    const f = take('Field');
    if (!f) return;
    if (f.attrs.table === undefined && f.attrs.name === undefined) {
      const v = text(f)?.trim();
      if (v) p.variable = v;
    } else p.field = fieldRef(f, ctx, name);
    const rep = calcOf(take('Repetition'));
    if (rep !== undefined && rep.trim() !== '1') p.repetitionCalculation = rep;
  };
  const scriptRef = () => {
    const sc = take('Script');
    if (!sc) return;
    const file = take('FileReference');
    if (file) {
      ctx.notes.push(`${name}: "${sc.attrs.name}" is in another file ("${file.attrs.name}"), which Tabularius can't call`);
      p.script = { id: 0, name: sc.attrs.name ?? '', file: { id: 0, name: file.attrs.name ?? '' } };
      return;
    }
    const own = ctx.scripts.get(lower(sc.attrs.name ?? ''));
    p.script = own ?? byName(s.scripts, sc, ctx, 'script', name);
  };
  switch (name) {
    case 'Commit Records/Requests':
      // <Option> is Skip data entry validation: the step's only other option, Override ESS locking conflicts, is <ESSForceCommit>.
      if (isTrue(take('Option')?.attrs.state)) p.skipValidation = true;
      break;
    case 'Set Variable': {
      const v = text(take('Name'))?.trim();
      if (v) p.variable = v;
      p.value = calcOf(take('Value')) ?? '';
      const rep = calcOf(take('Repetition'));
      if (rep !== undefined && rep.trim() !== '1') p.repetition = rep;
      break;
    }
    case 'Set Field By Name':
      p.fieldName = calcOf(take('TargetName'));
      p.calculation = calcOf(take('Result'));
      break;
    case 'Perform Script':
    case 'Perform Script on Server':
      scriptRef();
      p.parameter = ownCalc();
      if (name === 'Perform Script on Server' && kid(el, 'WaitForCompletion')) {
        used.add('WaitForCompletion');
        if (!state(el, 'WaitForCompletion')) p.wait = false;
      }
      break;
    case 'Install OnTimer Script':
      scriptRef();
      p.calculation = calcOf(take('Interval'));
      p.parameter = ownCalc();
      break;
    case 'Go to Layout':
    case 'New Window': {
      const dest = take('LayoutDestination')?.attrs.value;
      if (name === 'New Window') {
        let slot = 128;
        for (const n of ['Name', 'Height', 'Width', 'DistanceFromTop', 'DistanceFromLeft']) {
          const c = calcOf(take(n));
          if (c !== undefined) (p.slots ??= {})[slot] = c;
          slot++;
        }
        const windowStyle = kid(el, 'NewWndStyles')?.attrs.Style;
        const styles = { Document: 'document', Floating: 'floating', Dialog: 'dialog', Card: 'card' } as const;
        if (windowStyle && Object.hasOwn(styles, windowStyle)) p.windowStyle = styles[windowStyle as keyof typeof styles];
        else if (windowStyle) ctx.notes.push(`New Window: window style "${windowStyle}" isn't kept`);
        const styleElement = kid(el, 'NewWndStyles');
        const dropped = styleElement && ['Close', 'Minimize', 'Maximize', 'Resize', 'MenuBar', 'DimParentWindow', 'Styles', 'Toolbars'].filter((n) => styleElement.attrs[n] !== undefined);
        if (dropped?.length) ctx.notes.push(`New Window: NewWndStyles attributes ${dropped.join(', ')} aren't kept`);
        used.add('NewWndStyles');
      }
      if (dest === 'OriginalLayout') p.layoutDestination = 'original';
      else if (dest === 'LayoutNameByCalc' || dest === 'LayoutNumberByCalc') {
        p.layoutDestination = dest === 'LayoutNameByCalc' ? 'name' : 'number';
        p.layoutCalculation = calcOf(take('Layout') ?? el);
      } else if (kid(el, 'Layout')) {
        p.layoutDestination = 'named';
        p.layout = byName(s.layouts, take('Layout'), ctx, 'layout', name);
      }
      break;
    }
    case 'Go to Record/Request/Page':
    case 'Go to Portal Row': {
      const loc = kid(el, 'RowPageLocation')?.attrs.value as keyof typeof LOCATIONS | undefined;
      if (loc && LOCATIONS[loc]) p.location = LOCATIONS[loc];
      if (state(el, 'Exit')) p.exitAfterLast = true;
      if (p.location === 'calculation') p.calculation = ownCalc();
      break;
    }
    case 'Set Error Capture':
    case 'Allow User Abort':
      p.on = state(el, 'Set');
      break;
    case 'Perform Find':
    case 'Enter Find Mode':
    case 'Constrain Found Set':
    case 'Extend Found Set': {
      const query = take('Query');
      if (state(el, 'Restore')) p.restore = true;
      if (state(el, 'Restore') && query) {
        p.requests = kids(query, 'RequestRow').map((r): StoredFindRequest => ({
          omit: r.attrs.operation === 'Exclude',
          criteria: kids(r, 'Criteria').map((c) => ({ field: fieldRef(kid(c, 'Field') ?? { name: 'Field', attrs: {}, children: [] }, ctx, name), criteria: text(kid(c, 'Text')) ?? '' })),
        }));
      }
      break;
    }
    case 'Sort Records': {
      const list = take('SortList');
      p.restore = state(el, 'Restore');
      if (list) {
        p.sort = kids(list, 'Sort').map((so): SortField => ({
          field: fieldRef(kid(kid(so, 'PrimaryField'), 'Field') ?? { name: 'Field', attrs: {}, children: [] }, ctx, name),
          order: so.attrs.type === 'Descending' ? 'descending' : so.attrs.type === 'Ascending' ? 'ascending' : 'custom',
          ...(so.attrs.type === 'Custom' && kid(so, 'ValueList') ? { valueList: byName(s.valueLists, kid(so, 'ValueList'), ctx, 'value list', name)! } : {}),
        }));
      }
      break;
    }
    case 'Show Custom Dialog': {
      p.title = calcOf(take('Title'));
      p.message = calcOf(take('Message'));
      const list = kids(take('Buttons'), 'Button');
      const buttons = list.map((b) => calcOf(b)).filter((b): b is string => b !== undefined);
      if (buttons.length) p.buttons = buttons;
      const commit = [0, 1, 2].map((i) => (list[i] ? list[i].attrs.CommitState === 'True' : i !== 1));
      if (commit.some((c, i) => c !== (i !== 1))) p.commit = commit;
      used.add('InputFields');
      if (kid(el, 'InputFields')) ctx.notes.push('Show Custom Dialog: input fields aren\'t kept');
      break;
    }
    case 'Open File':
    case 'Close File': {
      const file = take('FileReference');
      if (file) p.dataSource = byName(s.dataSources, file, ctx, 'file reference', name);
      break;
    }
    case 'Install Menu Set': {
      const set = take('CustomMenuSet');
      if (set) p.menuSet = set.attrs.id === '1' || set.attrs.name === '[Standard FileMaker Menus]' ? { id: 1, name: '[Standard FileMaker Menus]' } : byName(s.customMenuSets, set, ctx, 'menu set', name);
      if (state(el, 'UseAsFileDefault')) p.fileDefault = true;
      break;
    }
    case 'Truncate Table': {
      const t = take('BaseTable');
      if (t && t.attrs.id !== '-1') p.table = byName(s.tables, t, ctx, 'table', name);
      break;
    }
    case 'Go to Related Record': {
      p.tableOccurrence = byName(s.tableOccurrences, take('Table'), ctx, 'table occurrence', name);
      const layout = take('Layout');
      p.useLayout = !!layout && kid(el, 'LayoutDestination')?.attrs.value === 'SelectedLayout';
      if (p.useLayout) p.layout = byName(s.layouts, layout, ctx, 'layout', name);
      for (const n of ['ShowInNewWindow', 'MatchAllRecords', 'NewWndStyles']) used.add(n);
      if (state(el, 'ShowInNewWindow') || state(el, 'MatchAllRecords')) ctx.notes.push('Go to Related Record: "show in new window" and "match all records" aren\'t kept');
      break;
    }
    case 'Go to Object': {
      p.objectName = calcOf(take('ObjectName'));
      const repetition = calcOf(take('Repetition'));
      if (repetition !== undefined) p.repetitionCalculation = repetition;
      break;
    }
    case 'Refresh Portal':
    case 'Refresh Object':
      p.objectName = calcOf(take('ObjectName'));
      if (name === 'Refresh Object') p.objectRepetition = calcOf(take('Repetition'));
      break;
    case 'Close Window':
    case 'Select Window': {
      const window = take('Window')?.attrs.value;
      const name = take('Name');
      if (window === 'ByName') p.calculation = calcOf(name);
      break;
    }
    case 'Refresh Window':
      if (kid(el, 'FlushCachedJoinResults')) p.flushJoinResults = state(el, 'FlushCachedJoinResults');
      if (kid(el, 'FlushCachedExternalData')) p.flushExternalData = state(el, 'FlushCachedExternalData');
      used.add('FlushCachedJoinResults');
      used.add('FlushCachedExternalData');
      break;
    case 'Set Web Viewer': {
      // Action=GoToURL, ObjectName and URL are present in Flicks' generated DDR.
      const action = take('Action')?.attrs.value;
      p.viewerAction = ({ Reset: 'Reset', Reload: 'Reload', GoBack: 'Go Back', GoForward: 'Go Forward', GoToURL: 'Go to URL' } as const)[action as 'Reset'];
      if (action && !p.viewerAction) ctx.notes.push(`Set Web Viewer: unknown action "${action}"`);
      p.objectName = calcOf(take('ObjectName'));
      p.viewerUrl = calcOf(take('URL'));
      break;
    }
    case 'Insert Text':
      if (kid(el, 'SelectAll')) p.selectEntireContents = isTrue(kid(el, 'SelectAll')?.attrs.state);
      target();
      p.text = text(take('Text'));
      break;
    case 'Insert Current Date':
    case 'Insert Current Time':
    case 'Insert Current User Name':
    case 'Insert from Last Visited':
    case 'Insert from Index':
      target();
      if (isTrue(kid(el, 'SelectAll')?.attrs.state)) p.selectEntireContents = true;
      break;
    case 'Adjust Window': {
      const v = take('WindowState')?.attrs.value;
      const adjust = (Object.keys(ADJUST) as (keyof typeof ADJUST)[]).find((k) => ADJUST[k] === v);
      if (adjust) p.adjust = adjust;
      break;
    }
    case 'View As': {
      const v = take('View')?.attrs.value?.toLowerCase();
      if (v === 'form' || v === 'list' || v === 'table' || v === 'cycle') p.view = v;
      break;
    }
    case 'Set Zoom Level': {
      if (state(el, 'Lock')) p.lock = true;
      used.add('Lock');
      const v = take('Zoom')?.attrs.value ?? '';
      if (/^byCalculation$/i.test(v)) {
        const c = ownCalc();
        if (c !== undefined) p.zoomCalculation = c;
      } else if (/^zoomIn$/i.test(v)) p.zoom = 'in';
      else if (/^zoomOut$/i.test(v)) p.zoom = 'out';
      else if (/^\d+$/.test(v)) p.zoom = Number(v);
      break;
    }
    case 'Set Selection': {
      target();
      const start = calcOf(take('StartPosition'));
      if (start !== undefined) p.selectionStart = start;
      const end = calcOf(take('EndPosition'));
      if (end !== undefined) p.selectionEnd = end;
      break;
    }
    case 'Show/Hide Toolbars':
    case 'Show/Hide Menubar': {
      if (state(el, 'Lock')) p.lock = true;
      used.add('Lock');
      const v = take('ShowHide')?.attrs.value?.toLowerCase();
      if (v === 'show' || v === 'hide' || v === 'toggle') p.showHide = v;
      break;
    }
    case 'Import Records':
      ctx.notes.push('Import Records: clipboard options do not establish an Add/Update/Replace mode; review and author the mode, match fields, add-remaining and auto-enter options.');
      break;
    case 'Insert from URL':
      if (kid(el, 'SelectAll')) p.selectEntireContents = isTrue(kid(el, 'SelectAll')?.attrs.state);
      target();
      p.calculation = ownCalc();
      if (kid(el, 'CURLOptions')) p.slots = { 129: calcOf(take('CURLOptions')) ?? '' };
      break;
    case 'Execute FileMaker Data API':
    case 'Check Selection':
      if (kid(el, 'SelectAll')) p.selectEntireContents = isTrue(kid(el, 'SelectAll')?.attrs.state);
      target();
      if (name === 'Execute FileMaker Data API') p.calculation = ownCalc();
      break;
    default:
      if (TARGET_STEPS.has(name)) {
        if (SELECT_STEPS.has(name) && kid(el, 'SelectAll')) p.selectEntireContents = isTrue(kid(el, 'SelectAll')?.attrs.state);
        target();
        const c = ownCalc();
        if (c !== undefined) p.calculation = c;
        break;
      }
      {
        // Any other step: its formula, then other formulas by slot in document order, as decoded files keep them.
        const c = ownCalc();
        if (c !== undefined) p.calculation = c;
        let slot = 128 + (c !== undefined ? 1 : 0);
        // A wrapper of several formulas (Perform JavaScript's <Parameters><P>...) gives one slot each.
        const formulas = (e: XmlElement): string[] => kids(e).flatMap((k) => (k.name === 'Calculation' ? [text(k) ?? ''] : formulas(k)));
        for (const k of kids(el)) {
          if (used.has(k.name)) continue;
          const fs = formulas(k);
          for (const f of fs) (p.slots ??= {})[slot++] = f;
          if (fs.length) used.add(k.name);
        }
      }
  }
  const skipped = [...new Set(kids(el).map((k) => k.name).filter((n) => !used.has(n) && !(kid(el, n)?.attrs.state === 'False')))];
  if (skipped.length) ctx.notes.push(`${name}: ${skipped.map((n) => `<${n}>`).join(', ')} ${skipped.length === 1 ? 'isn\'t' : 'aren\'t'} kept`);
  for (const k of Object.keys(p) as (keyof StepParams)[]) if (p[k] === undefined) delete p[k];
  return p;
}
