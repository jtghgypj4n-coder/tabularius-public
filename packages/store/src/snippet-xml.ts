// Writing FileMaker's clipboard format: tables, fields, scripts, steps,
// custom functions and value lists as <fmxmlsnippet type="FMObjectList"> XML,
// the inverse of snippet.ts, so what is built here can be pasted into
// FileMaker Pro. The grammar is the same (FileMaker's Design Report and
// Andrew Kear's CC BY 4.0 specifications); line breaks are FileMaker's
// carriage returns.
//
// FileMaker reads its clipboard as its own pasteboard types, not plain text,
// so the XML reaches FileMaker through a clipboard tool that converts it.

import { scriptStepName, scriptText, stepLine, undecodedOptionError, type Field, type FieldRef, type Schema, type ScriptStep, type StepParams, type Table } from '../../fmp12/src/index.ts';
import { DesignError } from './design.ts';

export interface SnippetPick {
  /** Whole tables, with their fields. */
  tables?: number[];
  /** Fields of one table. */
  fields?: { table: number; ids: number[] };
  scripts?: number[];
  /** Steps of one script, by index, or the steps on lines first..last (from 1) of the script as text. */
  steps?: { script: number; indexes?: number[]; lines?: [number, number] };
  customFunctions?: number[];
  valueLists?: number[];
}

/** Characters XML 1.0 can't hold, even as references (a few formulas in real files carry them). */
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export const esc = (s: string) => s.replace(ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#13;');
export const cdata = (s: string) => `<![CDATA[${s.replace(ILLEGAL, '').replace(/\r?\n/g, '\r').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
export const tf = (b: boolean | undefined) => (b ? 'True' : 'False');
/** Whether a layout or script has "Include in menu" unchecked. */
export const hidden = (order: Schema['layoutOrder'], id: number) => order.some((o) => o.id === id && o.hidden);
const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
export const el = (name: string, a: Record<string, string | number | undefined> = {}, body = '') => (body ? `<${name}${attrs(a)}>${body}</${name}>` : `<${name}${attrs(a)}/>`);
export const calc = (formula: string | undefined, table?: string) => (formula === undefined ? '' : `<Calculation${table !== undefined ? attrs({ table }) : ''}>${cdata(formula)}</Calculation>`);
export const wrap = (name: string, formula: string | undefined) => (formula === undefined ? '' : el(name, {}, calc(formula)));

/** Indexes of the steps on lines first..last of the script's text (a step whose text runs over several lines takes them all). */
function stepsOnLines(steps: ScriptStep[], [first, last]: [number, number]): number[] {
  const out: number[] = [];
  let line = 1;
  steps.forEach((s, i) => {
    const n = scriptText([s]).split('\n').length;
    if (line + n - 1 >= first && line <= last) out.push(i);
    line += n;
  });
  return out;
}

/** The XML FileMaker Pro puts on the clipboard for these objects, and notes on what it can't carry. */
export function designSnippet(schema: Schema, pick: SnippetPick): { xml: string; notes: string[] } {
  const bad = (k: string) => new DesignError(960, `"${k}" should be a list of ids`);
  for (const k of ['tables', 'scripts', 'customFunctions', 'valueLists'] as const) {
    if (pick[k] !== undefined && (!Array.isArray(pick[k]) || !pick[k]!.every(Number.isInteger))) throw bad(k);
  }
  if (pick.fields !== undefined && (!Number.isInteger(pick.fields?.table) || !Array.isArray(pick.fields.ids) || !pick.fields.ids.every(Number.isInteger))) throw bad('fields.ids');
  if (pick.steps !== undefined && (!Number.isInteger(pick.steps?.script)
    || (pick.steps.lines !== undefined ? !Array.isArray(pick.steps.lines) || pick.steps.lines.length !== 2 || !pick.steps.lines.every(Number.isInteger) : !Array.isArray(pick.steps.indexes) || !pick.steps.indexes.every(Number.isInteger)))) {
    throw bad(pick.steps?.lines !== undefined ? 'steps.lines' : 'steps.indexes');
  }
  const notes: string[] = [];
  const out: string[] = [];
  const find = <T extends { id: number }>(list: T[], id: number, what: string): T => {
    const hit = list.find((x) => x.id === id);
    if (!hit) throw new DesignError(105, `There's no ${what} with id ${id}`);
    return hit;
  };
  for (const id of pick.customFunctions ?? []) {
    const cf = find(schema.customFunctions, id, 'custom function');
    // FileMaker's custom functions are calculations: one written in JavaScript has nothing to paste as.
    if (cf.language === 'javascript') {
      notes.push(`${cf.name} is written in JavaScript, which FileMaker can't run: left out`);
      continue;
    }
    out.push(el('CustomFunction', { id: cf.id, functionArity: cf.parameters.length, visible: 'True', parameters: cf.parameters.join(';'), name: cf.name }, calc(cf.formula ?? '')));
  }
  for (const id of pick.valueLists ?? []) out.push(valueListXml(schema, find(schema.valueLists, id, 'value list'), notes));
  for (const id of pick.tables ?? []) {
    const t = find(schema.tables, id, 'table');
    out.push(el('BaseTable', { comment: '', name: t.name }, t.fields.map((f) => fieldXml(schema, t, f, notes)).join('')));
  }
  if (pick.fields) {
    const t = find(schema.tables, pick.fields.table, 'table');
    for (const id of pick.fields.ids) out.push(fieldXml(schema, t, find(t.fields, id, `field in ${t.name}`), notes));
  }
  for (const id of pick.scripts ?? []) {
    const sc = find(schema.scripts, id, 'script');
    out.push(el('Script', { includeInMenu: tf(!hidden(schema.scriptOrder, sc.id)), runFullAccess: tf(sc.fullAccess), id: sc.id, name: sc.name }, sc.steps.map((s) => stepXml(schema, s, notes)).join('')));
  }
  if (pick.steps) {
    const sc = find(schema.scripts, pick.steps.script, 'script');
    for (const i of pick.steps.indexes ?? stepsOnLines(sc.steps, pick.steps.lines!)) {
      const s = sc.steps[i];
      if (!s) throw new DesignError(960, `Script "${sc.name}" has no step ${i + 1}`);
      out.push(stepXml(schema, s, notes));
    }
  }
  if (!out.length) throw new DesignError(960, 'Pick something to copy');
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">${out.join('')}</fmxmlsnippet>`, notes };
}

const toName = (s: Schema, id: number | undefined) => (id === undefined ? undefined : s.tableOccurrences.find((t) => t.id === id)?.name);
const fieldName = (s: Schema, toId: number, fieldId: number) => {
  const to = s.tableOccurrences.find((t) => t.id === toId);
  return s.tables.find((t) => t.id === to?.baseTableId)?.fields.find((f) => f.id === fieldId)?.name;
};

export function valueListXml(s: Schema, vl: Schema['valueLists'][number], notes: string[]): string {
  if (vl.field) {
    const f = vl.field;
    const to = toName(s, f.occurrenceId) ?? '';
    const parts = [
      el('Source', { value: 'Field' }),
      el('PrimaryField', { show: tf(false), sort: tf(!f.sortBySecond) }, el('Field', { table: to, id: f.fieldId, name: fieldName(s, f.occurrenceId, f.fieldId) ?? '' })),
      f.secondFieldId !== undefined ? el('SecondaryField', { show: tf(f.showSecondOnly), sort: tf(f.sortBySecond) }, el('Field', { table: to, id: f.secondFieldId, name: fieldName(s, f.occurrenceId, f.secondFieldId) ?? '' })) : '',
      f.relatedFromId !== undefined ? el('ShowRelated', { value: 'True' }, el('Table', { id: f.relatedFromId, name: toName(s, f.relatedFromId) ?? '' })) : '',
    ];
    return el('ValueList', { id: vl.id, name: vl.name }, parts.join(''));
  }
  if (vl.external) notes.push(`Value list "${vl.name}" takes its values from another file: copied without them`);
  return el('ValueList', { id: vl.id, name: vl.name }, el('Source', { value: 'Custom' }) + el('CustomValues', {}, el('Text', {}, esc((vl.values ?? []).join('\n')))));
}

const DATA_TYPES = { text: 'Text', number: 'Number', date: 'Date', time: 'Time', timestamp: 'TimeStamp', container: 'Binary', unknown: 'Text' } as const;
const AUTO_VALUES: Record<string, string> = {
  creationDate: 'CreationDate', creationTime: 'CreationTime', creationTimestamp: 'CreationTimeStamp', creationName: 'CreationName', creationAccountName: 'CreationAccountName',
  modificationDate: 'ModificationDate', modificationTime: 'ModificationTime', modificationTimestamp: 'ModificationTimeStamp', modificationName: 'ModificationName', modificationAccountName: 'ModificationAccountName',
};
const SUMMARY_OPS = { total: 'Total', average: 'Average', count: 'Count', minimum: 'Minimum', maximum: 'Maximum', stdDev: 'StdDeviation', stdDevP: 'StdDeviationByPopulation', fractionOfTotal: 'Fractional', list: 'List' } as const;
const STRICT_TYPES = { number: 'Numeric', date4: 'FourDigitYear', time: 'TimeOfDay' } as const;

export function fieldXml(s: Schema, t: Table, f: Field, notes: string[]): string {
  const o = f.options;
  const context = toName(s, f.calculationContextId) ?? t.name;
  const type = (DATA_TYPES as Partial<Record<Field['type'], string>>)[f.type] ?? (f.type === 'boolean' || f.type === 'integer' || f.type === 'decimal' ? 'Number' : 'Text');
  // FileMaker leaves out autoIndex at index All, and the index settings on globals, containers and unstored calculations.
  const index = !o?.index ? 'None' : o.index.value && (o.index.word || f.type !== 'text') ? 'All' : 'Minimal';
  const language = o?.indexLanguage ?? 'English';
  if (o?.indexLanguageId !== undefined && !o.indexLanguage) notes.push(`Field ${t.name}::${f.name}: its index language (number ${o.indexLanguageId}) has no known name, so it's copied as English`);
  // Container data stored externally, as the Design Report grammar writes it: <Remote type relativeTo> with the open storage path.
  const ext = f.type === 'container' && !o?.global ? o?.externalStorage : undefined;
  if (ext?.fewerFolders) notes.push(`Field ${t.name}::${f.name}: "with fewer folders" has no XML, so it's left out`);
  const remote = ext ? el('Remote', { type: ext.secure ? 'Secure' : 'Open', relativeTo: ext.directoryId }, !ext.secure && ext.path ? el('Location', {}, calc(ext.path, context)) : '') : '';
  const storage = (extra: Record<string, string | undefined>, indexed = true) => el('Storage', {
    ...extra,
    ...(o?.global || f.type === 'container' || !indexed ? {} : { ...(index === 'All' ? {} : { autoIndex: tf(!o?.noAutoIndex) }), index }),
    ...(f.type !== 'container' ? { indexLanguage: language } : {}),
    global: tf(o?.global), maxRepetition: o?.repetitions ?? 1,
  }, remote);
  const comment = el('Comment', {}, f.comment ? esc(f.comment) : '');
  if (f.kind === 'calculation') {
    return el('Field', { id: f.id, dataType: type, fieldType: 'Calculated', name: f.name },
      calc(f.calculation ?? '', context) + comment + el('AutoEnter', { alwaysEvaluate: tf(o?.evaluateWhenEmpty) })
      + storage(o?.global ? {} : { storeCalculationResults: tf(!o?.unstored) }, !o?.unstored));
  }
  if (f.kind === 'summary') {
    const sm = f.summary;
    return el('Field', { id: f.id, dataType: type, fieldType: 'Summary', name: f.name },
      el('SummaryInfo', { restartForEachSortedGroup: 'False', summarizeRepetition: 'Together', operation: sm ? SUMMARY_OPS[sm.type] : 'Total' },
        el('SummaryField', {}, el('Field', { id: sm?.fieldId ?? 0, name: sm?.field ?? t.fields.find((x) => x.id === sm?.fieldId)?.name ?? '' })))
      + comment + el('AutoEnter', { allowEditing: 'True', constant: 'False', furigana: 'False', lookup: 'False', calculation: 'False' }, '<ConstantData/>'));
  }
  if (f.kind !== 'normal') notes.push(`Field ${t.name}::${f.name}: its kind isn't known, so it's copied as a normal field`);
  const ae = o?.autoEnter ?? {};
  const lookup = ae.lookup;
  const lookupTo = lookup && toName(s, lookup.occurrenceId);
  const autoEnter = el('AutoEnter', {
    allowEditing: tf(!ae.prohibitModification),
    ...(ae.calculation ? { overwriteExistingValue: tf(ae.replaceExisting), alwaysEvaluate: tf(ae.evaluateWhenEmpty) } : {}),
    value: ae.value ? AUTO_VALUES[ae.value] : ae.lastVisited ? 'PreviousRecord' : ae.data !== undefined ? 'ConstantData' : undefined,
    constant: tf(ae.data !== undefined), furigana: 'False', lookup: tf(!!lookupTo), calculation: tf(ae.calculation),
  }, [
    ae.serial ? el('Serial', { increment: ae.serial.increment, nextValue: ae.serial.next, generate: ae.serial.onCommit ? 'OnCommit' : 'OnCreation' }) : '',
    el('ConstantData', {}, ae.data ? esc(ae.data) : ''),
    ae.calculation ? calc(f.calculation ?? '', context) : '',
    lookup && lookupTo ? el('Lookup', {}, [
      el('Table', { id: f.calculationContextId ?? 0, name: context }),
      el('Field', { table: lookupTo, id: lookup.fieldId, name: fieldName(s, lookup.occurrenceId, lookup.fieldId) ?? '' }),
      el('NoMatchCopyOption', { value: ({ value: 'CopyConstant', lower: 'CopyNextLower', higher: 'CopyNextHigher' } as Record<string, string>)[lookup.noMatch ?? ''] ?? 'DoNotCopy' }),
      lookup.noMatch === 'value' ? el('CopyConstantValue', {}, esc(lookup.value ?? '')) : '',
      el('CopyEmptyContent', { value: tf(lookup.copyEmpty) }),
    ].join('')) : '',
  ].join(''));
  if (lookup?.noMatch === 'empty') notes.push(`Field ${t.name}::${f.name}: its lookup empties the field when nothing matches, which FileMaker's XML can't say; copied as "do not copy"`);
  const v = o?.validation ?? {};
  const list = v.valueList !== undefined ? s.valueLists.find((l) => l.id === v.valueList) : undefined;
  const validation = el('Validation', {
    messageCalc: tf(!!v.message && v.messageCalculation), message: tf(!!v.message), maxLength: tf(!!v.maxLength), valuelist: tf(!!list), calculation: tf(v.calculation !== undefined),
    alwaysValidateCalculation: tf(v.calculation !== undefined && v.calculationAlways), type: v.always ? 'Always' : 'OnlyDuringDataEntry',
  }, [
    v.type ? el('StrictDataType', { value: STRICT_TYPES[v.type] }) : '',
    el('NotEmpty', { value: tf(v.notEmpty) }), el('Unique', { value: tf(v.unique) }), el('Existing', { value: tf(v.existing) }),
    list ? el('ValueList', { id: list.id, name: list.name }) : '',
    v.range ? el('Range', { from: v.range.min, to: v.range.max }) : '',
    v.calculation !== undefined ? calc(v.calculation, context) : '',
    v.maxLength ? el('MaxDataLength', { value: v.maxLength }) : '',
    el('StrictValidation', { value: tf(v.strict) }),
    v.message ? el('ErrorMessage', {}, esc(v.message)) : '',
    v.message && v.messageCalculation ? el('MessageCalculation', {}, calc(v.message, context)) : '',
  ].join(''));
  return el('Field', { id: f.id, dataType: type, fieldType: 'Normal', name: f.name }, comment + autoEnter + validation + storage({}));
}

// ---------------------------------------------------------------- script steps

const LOCATIONS = { first: 'First', last: 'Last', previous: 'Previous', next: 'Next', calculation: 'ByCalculation' } as const;
const TARGET_STEPS = new Set(['Set Field', 'Set Next Serial Value', 'Insert Calculated Result', 'Replace Field Contents', 'Insert from URL', 'Go to Field',
  'Insert Text', 'Copy', 'Cut', 'Paste', 'Clear', 'Insert File', 'Export Field Contents']);
const DIALOG_STEPS = new Set(['Delete Record/Request', 'Delete Portal Row', 'Omit Multiple Records', 'Delete All Records', 'Commit Records/Requests', 'Revert Record/Request', 'Truncate Table',
  'Go to Record/Request/Page', 'Go to Portal Row', 'Sort Records', 'Replace Field Contents', 'Re-Login']);
/** Steps whose options this writes in full; others carry their formulas and are noted. */
/** Adjust Window's options as FileMaker's XML names them. */
export const ADJUST = { 'resize to fit': 'ResizeToFit', maximize: 'Maximize', minimize: 'Minimize', restore: 'Restore', hide: 'Hide' } as const;

const WRITTEN = new Set(['Set Variable', 'Set Field By Name', 'Perform Script', 'Perform Script on Server', 'Install OnTimer Script', 'Go to Layout',
  'Go to Record/Request/Page', 'Go to Portal Row', 'Set Error Capture', 'Allow User Abort', 'Perform Find', 'Enter Find Mode', 'Constrain Found Set', 'Extend Found Set',
  'Sort Records', 'Show Custom Dialog', 'Install Menu Set', 'Truncate Table', 'Go to Related Record', 'Go to Object', 'Refresh Object', 'Refresh Portal', 'Refresh Window', 'Set Web Viewer', 'If', 'Else If', 'Exit Loop If',
  'Exit Script', 'Pause/Resume Script', 'Open URL', 'Omit Multiple Records', 'Insert from URL', 'New Window', 'Open File', 'Close File',
  'Adjust Window', 'Show/Hide Toolbars', 'Show/Hide Menubar', 'Commit Records/Requests']);

const fieldEl = (f: FieldRef) => el('Field', { table: f.tableOccurrence.name, id: f.field.id, name: f.field.name, ...(f.repetition ? { repetition: f.repetition } : {}) });

/** A step as FileMaker's clipboard writes it; `withText` adds the Design Report's <StepText> (the line the script workspace shows). */
export function stepXml(s: Schema, step: ScriptStep, notes: string[], withText = false): string {
  const name = scriptStepName(step.stepId);
  const unresolved = undecodedOptionError(step.stepId, step.params, step.calculations);
  if (unresolved) throw new DesignError(960, `Cannot export ${name}. ${unresolved}`);
  const head = { enable: tf(step.enabled), id: step.stepId, name };
  const line = withText ? el('StepText', {}, esc(step.line ?? stepLine(name, step.params, step.text))) : '';
  if (step.stepId === 89) return el('Step', head, line + (step.text ? el('Text', {}, esc(step.text)) : ''));
  const p: StepParams = step.params ?? {};
  const body: string[] = [line];
  if (p.noDialog !== undefined && DIALOG_STEPS.has(name)) body.push(el('NoInteract', { state: tf(p.noDialog) }));
  const target = () => {
    if (p.field) body.push(fieldEl(p.field));
    else if (p.variable) body.push(el('Field', {}, esc(p.variable)));
    if (p.repetitionCalculation !== undefined) body.push(wrap('Repetition', p.repetitionCalculation));
  };
  switch (name) {
    case 'Set Variable':
      body.push(wrap('Value', p.value ?? ''), wrap('Repetition', p.repetition ?? '1'), el('Name', {}, esc(p.variable ?? '')));
      break;
    case 'Set Field By Name':
      body.push(wrap('Result', p.calculation), wrap('TargetName', p.fieldName));
      break;
    case 'Perform Script':
    case 'Perform Script on Server':
    case 'Install OnTimer Script':
      if (name === 'Perform Script on Server') body.push(el('WaitForCompletion', { state: tf(p.wait !== false) }));
      if (p.script?.file) body.push(el('FileReference', { id: p.script.file.id, name: p.script.file.name }, el('UniversalPathList', {}, esc(`file:${p.script.file.name}`))));
      body.push(calc(p.parameter));
      if (name === 'Install OnTimer Script') body.push(wrap('Interval', p.calculation));
      if (p.script) body.push(el('Script', { id: p.script.id, name: p.script.name }));
      break;
    case 'Go to Layout':
      if (p.layoutDestination === 'original') body.push(el('LayoutDestination', { value: 'OriginalLayout' }));
      else if (p.layoutDestination === 'name' || p.layoutDestination === 'number') {
        // Inferred: FileMaker's layout-by-calculation destinations, with the formula as the step's calculation.
        body.push(el('LayoutDestination', { value: p.layoutDestination === 'name' ? 'LayoutNameByCalc' : 'LayoutNumberByCalc' }), calc(p.layoutCalculation));
      } else if (p.layout) body.push(el('LayoutDestination', { value: 'SelectedLayout' }), el('Layout', { id: p.layout.id, name: p.layout.name }));
      break;
    case 'Go to Record/Request/Page':
    case 'Go to Portal Row':
      if (p.exitAfterLast) body.push(el('Exit', { state: 'True' }));
      if (p.location) body.push(el('RowPageLocation', { value: LOCATIONS[p.location] }));
      if (p.location === 'calculation') body.push(calc(p.calculation));
      break;
    case 'Set Error Capture':
    case 'Allow User Abort':
      body.push(el('Set', { state: tf(p.on) }));
      break;
    case 'Perform Find':
    case 'Enter Find Mode':
    case 'Constrain Found Set':
    case 'Extend Found Set':
      body.push(el('Restore', { state: tf(p.restore) }));
      if (p.requests?.length) {
        body.push(el('Query', {}, p.requests.map((r) => el('RequestRow', { operation: r.omit ? 'Exclude' : 'Include' },
          r.criteria.map((c) => el('Criteria', {}, fieldEl(c.field) + el('Text', {}, esc(c.criteria)))).join(''))).join('')));
      }
      break;
    case 'Sort Records':
      body.push(el('Restore', { state: tf(p.restore) }));
      if (p.sort?.length) {
        body.push(el('SortList', { Maintain: 'True', value: 'True' }, p.sort.map((so) => {
          const sourceList = so.valueList && !so.valueList.name ? s.valueLists.find((list) => list.id === so.valueList!.id) : undefined;
          // If the source ID is absent, preserve the empty name as before.
          const valueList = so.order === 'custom' && so.valueList ? el('ValueList', { id: so.valueList.id, name: so.valueList.name || sourceList?.name }) : '';
          return el('Sort', { type: so.order === 'descending' ? 'Descending' : so.order === 'custom' ? 'Custom' : 'Ascending' }, el('PrimaryField', {}, fieldEl(so.field)) + valueList);
        }).join('')));
      }
      break;
    case 'Show Custom Dialog':
      body.push(wrap('Title', p.title), wrap('Message', p.message));
      if (p.buttons?.length || p.commit) body.push(el('Buttons', {}, [0, 1, 2].map((i) => (p.buttons?.[i] !== undefined ? el('Button', { CommitState: tf(p.commit?.[i] ?? i !== 1) }, calc(p.buttons[i])) : el('Button', { CommitState: tf(p.commit?.[i] ?? i !== 1) }))).join('')));
      break;
    case 'Open File':
    case 'Close File':
      if (p.dataSource) body.push(el('FileReference', { id: p.dataSource.id, name: p.dataSource.name }, el('UniversalPathList', {}, esc(`file:${p.dataSource.name}`))));
      break;
    case 'Install Menu Set':
      body.push(el('UseAsFileDefault', { state: tf(p.fileDefault) }));
      if (p.menuSet) body.push(el('CustomMenuSet', { id: p.menuSet.id, name: p.menuSet.name }));
      break;
    case 'Commit Records/Requests':
      body.push(el('Option', { state: tf(!!p.skipValidation) }), el('ESSForceCommit', { state: 'False' }));
      break;
    case 'Truncate Table':
      body.push(p.table ? el('BaseTable', { id: p.table.id, name: p.table.name }) : el('BaseTable', { id: -1, name: '<Current Table>' }));
      break;
    case 'Go to Related Record':
      body.push(el('LayoutDestination', { value: p.useLayout ? 'SelectedLayout' : 'CurrentLayout' }));
      if (p.tableOccurrence) body.push(el('Table', { id: p.tableOccurrence.id, name: p.tableOccurrence.name }));
      if (p.useLayout && p.layout) body.push(el('Layout', { id: p.layout.id, name: p.layout.name }));
      break;
    case 'Go to Object':
      body.push(wrap('ObjectName', p.objectName));
      if (p.repetitionCalculation !== undefined) body.push(wrap('Repetition', p.repetitionCalculation));
      break;
    case 'Refresh Portal':
    case 'Refresh Object':
      body.push(wrap('ObjectName', p.objectName));
      if (name === 'Refresh Object' && p.objectRepetition !== undefined) body.push(wrap('Repetition', p.objectRepetition));
      break;
    case 'Refresh Window':
      if (p.flushJoinResults !== undefined) body.push(el('FlushCachedJoinResults', { state: tf(p.flushJoinResults) }));
      if (p.flushExternalData !== undefined) body.push(el('FlushCachedExternalData', { state: tf(p.flushExternalData) }));
      break;
    case 'Set Web Viewer':
      body.push(wrap('ObjectName', p.objectName));
      if (p.viewerAction) body.push(el('Action', { value: ({ Reset: 'Reset', Reload: 'Reload', 'Go Back': 'GoBack', 'Go Forward': 'GoForward', 'Go to URL': 'GoToURL' } as const)[p.viewerAction] }));
      if (p.viewerUrl !== undefined) body.push(wrap('URL', p.viewerUrl));
      break;
    case 'Close Window':
    case 'Select Window': {
      const window = p.calculation ?? p.slots?.[128];
      body.push(el('Window', { value: window !== undefined ? 'ByName' : 'Current' }));
      if (window !== undefined) body.push(wrap('Name', window));
      break;
    }
    case 'Insert from URL':
      body.push(el('SelectAll', { state: tf(p.selectEntireContents !== false) }));
      body.push(calc(p.calculation));
      target();
      if (p.slots?.[129] !== undefined) body.push(wrap('CURLOptions', p.slots[129]));
      break;
    case 'Execute FileMaker Data API':
    case 'Check Selection':
      body.push(el('SelectAll', { state: tf(p.selectEntireContents !== false) }));
      if (name === 'Execute FileMaker Data API') body.push(calc(p.calculation));
      target();
      break;
    case 'New Window':
      ['Name', 'Height', 'Width', 'DistanceFromTop', 'DistanceFromLeft'].forEach((n, i) => body.push(wrap(n, p.slots?.[128 + i])));
      if (p.windowStyle) {
        const styles = { document: 'Document', floating: 'Floating', dialog: 'Dialog', card: 'Card' } as const;
        body.push(el('NewWndStyles', { Style: styles[p.windowStyle] }));
      }
      if (p.layoutDestination === 'name' || p.layoutDestination === 'number') {
        body.push(el('LayoutDestination', { value: p.layoutDestination === 'name' ? 'LayoutNameByCalc' : 'LayoutNumberByCalc' }), calc(p.layoutCalculation));
      } else if (p.layout) body.push(el('LayoutDestination', { value: 'SelectedLayout' }), el('Layout', { id: p.layout.id, name: p.layout.name }));
      else body.push(el('LayoutDestination', { value: 'CurrentLayout' }));
      break;
    case 'Insert Text':
      body.push(el('SelectAll', { state: p.selectEntireContents !== false ? 'True' : 'False' }));
      target();
      if (p.text !== undefined) body.push(el('Text', {}, esc(p.text)));
      break;
    case 'Insert Current Date':
    case 'Insert Current Time':
    case 'Insert Current User Name':
    case 'Insert from Last Visited':
    case 'Insert from Index':
      body.push(el('SelectAll', { state: p.selectEntireContents ? 'True' : 'False' }));
      target();
      break;
    case 'Adjust Window':
      if (p.adjust) body.push(el('WindowState', { value: ADJUST[p.adjust] }));
      break;
    case 'View As':
      if (p.view) body.push(el('View', { value: p.view[0].toUpperCase() + p.view.slice(1) }));
      break;
    case 'Set Zoom Level':
      // As the ai2fm bug suite's clipboard XML has it: 25 to 400, ZoomIn, ZoomOut or ByCalculation with its formula.
      body.push(el('Lock', { state: p.lock ? 'True' : 'False' }));
      if (p.zoomCalculation !== undefined) body.push(el('Zoom', { value: 'ByCalculation' }), calc(p.zoomCalculation));
      else if (p.zoom !== undefined) body.push(el('Zoom', { value: p.zoom === 'in' ? 'ZoomIn' : p.zoom === 'out' ? 'ZoomOut' : p.zoom }));
      break;
    case 'Set Selection':
      target();
      if (p.selectionStart !== undefined) body.push(wrap('StartPosition', p.selectionStart));
      if (p.selectionEnd !== undefined) body.push(wrap('EndPosition', p.selectionEnd));
      break;
    case 'Show/Hide Toolbars':
    case 'Show/Hide Menubar':
      body.push(el('Lock', { state: p.lock ? 'True' : 'False' }));
      if (p.showHide) body.push(el('ShowHide', { value: p.showHide[0].toUpperCase() + p.showHide.slice(1) }));
      break;
    default:
      if (TARGET_STEPS.has(name)) {
        if (['Insert Calculated Result', 'Copy', 'Cut', 'Paste', 'Clear'].includes(name)) body.push(el('SelectAll', { state: p.selectEntireContents !== false ? 'True' : 'False' }));
        body.push(calc(p.calculation));
        target();
        break;
      }
      body.push(calc(p.calculation));
      if (p.slots && Object.keys(p.slots).length) {
        notes.push(`${name}: its options other than the main formula aren't written yet, so check the step after pasting`);
      } else if (!WRITTEN.has(name) && Object.keys(p).some((k) => k !== 'calculation' && k !== 'noDialog')) {
        notes.push(`${name}: some options aren't written yet, so check the step after pasting`);
      }
  }
  return el('Step', head, body.join(''));
}
