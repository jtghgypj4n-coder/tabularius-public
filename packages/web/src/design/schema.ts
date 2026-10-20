// Tables & fields: FileMaker's Manage Database tables and fields tabs, as one page.

import type { DesignField, DesignTable } from './client.ts';
import { h, button, select, field, check, toast } from './dom.ts';
import { copyForFileMaker, current, designWithAI, draftWithAI, errorText, peersAt, type Studio } from './main.ts';
import { confirmRename, impactNote, impactPanel } from './impact.ts';
import { rulesPanel } from './rules.ts';
import { formulaChecker, formulaPreview } from './formula.ts';
import type { DraftTarget } from '../assistant.ts';

const TYPES = ['text', 'number', 'date', 'time', 'timestamp', 'container'];
const nativeTypes = (studio: Studio) => studio.design.fileMode === 'native' ? [...TYPES, 'boolean', 'integer', 'decimal', 'json', 'uuid'] : TYPES;
const KINDS: [string, string][] = [['normal', 'Normal'], ['calculation', 'Calculation'], ['summary', 'Summary']];
const SUMMARIES: [string, string][] = [
  ['total', 'Total of'], ['average', 'Average of'], ['count', 'Count of'], ['minimum', 'Minimum'], ['maximum', 'Maximum'],
  ['stdDev', 'Standard deviation of'], ['stdDevP', 'Standard deviation (population)'], ['fractionOfTotal', 'Fraction of total of'], ['list', 'List of'],
];
const AUTO_VALUES: [string, string][] = [
  ['', 'None'], ['creationTimestamp', 'Creation timestamp'], ['creationDate', 'Creation date'], ['creationTime', 'Creation time'],
  ['creationAccountName', 'Creation account name'], ['creationName', 'Creation name'],
  ['modificationTimestamp', 'Modification timestamp'], ['modificationDate', 'Modification date'], ['modificationTime', 'Modification time'],
  ['modificationAccountName', 'Modification account name'], ['modificationName', 'Modification name'],
];

const STRICT_TYPES: [string, string][] = [['', 'Any value'], ['number', 'Numeric only'], ['date4', 'Date with a four-digit year'], ['time', 'Time of day']];
const NO_MATCH: [string, string][] = [['keep', 'Keep the current value'], ['lower', 'Copy the next lower value'], ['higher', 'Copy the next higher value'],
  ['empty', 'Empty the field'], ['value', 'Use this value']];
const INDEXING: [string, string][] = [['', 'None'], ['minimal', 'Minimal (values)'], ['all', 'All (values and words)']];
/** Storage › Default language, as FileMaker's XML names them (the label is the dialog's): every language Claris Pro Help's SortValues page lists, which packages/calc/src/collation.ts orders. */
const LANGUAGES: [string, string][] = [['Unicode_Raw', 'Default'], ['Unicode_Standard', 'Unicode'], ['English', 'English'], ['French', 'French'], ['German', 'German'],
  ['German_Dictionary', 'German (ä=a)'], ['Spanish', 'Spanish'], ['Italian', 'Italian'], ['Dutch', 'Dutch'], ['Portuguese', 'Portuguese'], ['Swedish', 'Swedish'],
  ['Swedish_Custom', 'Swedish (v<>w)'], ['Finnish', 'Finnish'], ['Finnish_Custom', 'Finnish (v<>w)'], ['Norwegian', 'Norwegian'], ['Danish', 'Danish'],
  ['Lithuanian', 'Lithuanian'], ['Polish', 'Polish'], ['Czech', 'Czech'], ['Greek_Mixed', 'Greek (Mixed)'], ['Serbian', 'Serbian (Latin)'],
  ['Japanese', 'Japanese'], ['Chinese', 'Chinese (Pinyin)'], ['Chinese_Stroke', 'Chinese (Stroke)'], ['Korean', 'Korean'],
  ['Arabic', 'Arabic'], ['Bengali', 'Bengali'], ['Bulgarian', 'Bulgarian'], ['Catalan', 'Catalan'], ['Catalog', 'Catalog'], ['Croatian', 'Croatian'],
  ['Estonian', 'Estonian'], ['Greek', 'Greek'], ['Gujarati', 'Gujarati'], ['Hebrew', 'Hebrew'], ['Hindi', 'Hindi'], ['Hungarian', 'Hungarian'],
  ['Icelandic', 'Icelandic'], ['Kannada', 'Kannada'], ['Latvian', 'Latvian'], ['Malayalam', 'Malayalam'], ['Marathi', 'Marathi'], ['Panjabi', 'Panjabi'],
  ['Persian', 'Persian'], ['Romanian', 'Romanian'], ['Russian', 'Russian'], ['Slovak', 'Slovak'], ['Slovenian', 'Slovenian'],
  ['Spanish_Traditional', 'Spanish (Traditional)'], ['Tamil', 'Tamil'], ['Telugu', 'Telugu'], ['Thai', 'Thai'], ['Turkish', 'Turkish'],
  ['Ukrainian', 'Ukrainian'], ['Vietnamese', 'Vietnamese']];

/** Manage Database's Indexing setting: All is both indexes for text, the value index for other types. */
const indexing = (f: DesignField): '' | 'minimal' | 'all' => {
  const i = f.options?.index;
  return !i ? '' : i.value && (i.word || f.type !== 'text') ? 'all' : 'minimal';
};

/** One line describing a field's options, like the Options column in Manage Database. */
export function optionSummary(f: DesignField): string {
  const o = f.options;
  const out: string[] = [];
  if (f.kind === 'calculation') out.push(`= ${f.calculation ?? ''}`);
  if (f.kind === 'summary' && f.summary) out.push(`${SUMMARIES.find(([k]) => k === f.summary!.type)?.[1] ?? f.summary.type} ${f.summary.field ?? ''}`);
  if (o?.global) out.push('Global');
  if (o?.unstored) out.push('Unstored');
  if ((o?.repetitions ?? 1) > 1) out.push(`${o!.repetitions} repetitions`);
  if (o?.index) out.push(`Indexed (${indexing(f)})`);
  const ae = o?.autoEnter;
  if (ae?.serial) out.push(`Serial from ${ae.serial.next}${ae.serial.onCommit ? ' on commit' : ''}`);
  if (ae?.value) out.push(AUTO_VALUES.find(([k]) => k === ae.value)?.[1] ?? ae.value);
  if (ae?.lastVisited) out.push('Value from last visited record');
  if (ae?.data !== undefined) out.push(`Data "${ae.data}"`);
  if (ae?.calculation && f.kind === 'normal') out.push(`Auto-enter = ${f.calculation ?? ''}`);
  if (ae?.lookup) out.push('Looked-up value');
  if (ae?.prohibitModification) out.push('Can\'t be changed by people');
  const v = o?.validation;
  if (v?.notEmpty) out.push('Not empty');
  if (v?.unique) out.push('Unique');
  if (v?.range) out.push(`Range ${v.range.min}…${v.range.max}`);
  if (v?.maxLength) out.push(`Max ${v.maxLength} chars`);
  if (v?.type) out.push(STRICT_TYPES.find(([k]) => k === v.type)?.[1] ?? v.type);
  if (v?.existing) out.push('Existing value');
  if (v?.valueList !== undefined) out.push('In value list');
  if (v?.calculation) out.push('Validated by calculation');
  return out.join(', ');
}

export function tablesTab(studio: Studio): HTMLElement {
  const { design } = studio;
  let table = design.tables.find((t) => t.id === studio.selected.table) ?? design.tables[0];
  studio.selected.table = table?.id;
  // Others in design mode see who is on which table, and the field picked there.
  if (table) studio.together?.go('table', table.id, studio.selected.field !== undefined ? [studio.selected.field] : []);

  const list = h('ul', { class: 'd-list' });
  for (const t of design.tables) {
    const item = h('li', { class: t === table ? 'selected' : '' },
      h('button', { type: 'button' }, h('span', {}, t.name), peersAt(studio, 'table', t.id), h('span', { class: 'd-count' }, `${t.fields.length} fields · ${t.records ?? '?'} records`)));
    item.querySelector('button')!.addEventListener('click', () => {
      studio.selected.table = t.id;
      studio.selected.field = undefined;
      studio.render();
    });
    list.append(item);
  }
  const newName = h('input', { placeholder: 'New table name', 'aria-label': 'New table name' });
  const addTable = h('form', { class: 'd-inline-form' }, newName, h('button', { type: 'submit', class: 'primary' }, 'Create'));
  addTable.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newName.value.trim();
    if (!name) return;
    if (await studio.apply([{ op: 'createTable', name }], `Created table ${name}, with a layout for it`)) {
      studio.selected.table = studio.design.tables.find((t) => t.name === name)?.id;
      studio.render();
    }
  });

  const side = h('aside', { class: 'd-side' }, h('h2', {}, 'Tables'), list, addTable,
    ...designWithAI(studio, 'Describe tables to add…', (want) => `Design new tables for this file: ${want}. ` +
      'Give each its fields (with types, auto-enter serial keys and calculations where they fit), relate them to the tables already here where it makes sense, ' +
      'and propose it as one change.'),
    ...recentlyDeleted(studio));
  const main = h('section', { class: 'd-main' });
  if (!table) main.append(h('p', { class: 'd-muted' }, 'No tables yet. Create one to start.'));
  else main.append(...tableDetail(studio, table));
  return h('div', { class: 'd-split' }, side, main);
}

/** A sentence on what uses something about to be deleted, from the server's where-used index. */
async function usedBy(studio: Studio, name: string, kind: string): Promise<string> {
  try {
    const uses = await studio.client.used(name, kind);
    if (!uses.length) return 'Nothing in the file uses it.';
    const shown = uses.slice(0, 8).map((u) => `  • ${u.where}`).join('\n');
    return `It is used in ${uses.length} ${uses.length === 1 ? 'place' : 'places'}, which will show it missing until it is restored:\n${shown}${uses.length > 8 ? `\n  • and ${uses.length - 8} more` : ''}`;
  } catch {
    return '';
  }
}

/** Deleted tables and fields whose data is still kept: restore them, or let them go for good. */
function recentlyDeleted(studio: Studio): HTMLElement[] {
  const gone = studio.design.deleted ?? [];
  if (!gone.length) return [];
  const items = gone.map((d) => {
    const what = d.kind === 'table' ? `Table, ${d.records} ${d.records === 1 ? 'record' : 'records'}` : `Field of ${d.table}, ${d.records} ${d.records === 1 ? 'value' : 'values'}`;
    const restore = button('Restore', () => void studio.apply([{ op: 'restoreDeleted', deleted: d.id }], `Restored ${d.name}`), { title: 'Bring it back with its data, and put back the formulas and relationships that used it' });
    const forget = button('Delete for good…', async () => {
      if (!confirm(`Delete "${d.name}" for good? Its data can't be restored after this.`)) return;
      try {
        studio.design = (await studio.client.emptyDeleted(d.id)).design;
        studio.render();
      } catch (e) {
        toast(errorText(e));
      }
    }, { class: 'quiet danger' });
    return h('li', { class: 'd-deleted-item' },
      h('div', {}, h('strong', {}, d.name), h('span', { class: 'd-count' }, `${what} · ${new Date(d.at).toLocaleString()}${d.account ? ` · ${d.account}` : ''}`)),
      h('div', { class: 'd-actions' }, restore, forget));
  });
  return [h('details', { class: 'd-deleted', open: '' }, h('summary', {}, `Recently deleted (${gone.length})`), h('ul', { class: 'd-list' }, ...items))];
}

const copyButton = (studio: Studio, pick: Parameters<typeof copyForFileMaker>[1], what: string) =>
  button('Copy for FileMaker', () => void copyForFileMaker(studio, pick, what), { title: 'Copy as FileMaker clipboard XML, to paste into FileMaker Pro or another Tabularius file' });

function tableDetail(studio: Studio, table: DesignTable): HTMLElement[] {
  const name = h('input', { value: table.name, 'aria-label': 'Table name', class: 'd-title-input' });
  const rename = button('Rename', async () => {
    const to = name.value.trim();
    if (!to || to === table.name || !(await confirmRename(studio, 'table', table.name, to))) return;
    void studio.apply([{ op: 'renameTable', table: table.id, name: to }], 'Table renamed');
  });
  const del = button('Delete table…', async () => {
    const uses = (await impactNote(studio, 'table', table.name, 'delete')) || (await usedBy(studio, table.name, 'table'));
    if (confirm(`Delete table "${table.name}" and its ${table.records ?? ''} records? Its table occurrences and relationships go too.\n\n${uses}\n\nThe records are kept under Recently deleted, where you can restore the table with everything that used it.`)) {
      studio.selected.table = undefined;
      void studio.apply([{ op: 'deleteTable', table: table.id }], `Deleted ${table.name}`);
    }
  }, { class: 'danger' });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') rename.click();
  });

  const rows = h('tbody');
  for (const f of table.fields) {
    const tr = h('tr', { class: studio.selected.field === f.id ? 'selected' : '', tabindex: '0' },
      h('td', {}, f.name, peersAt(studio, 'table', table.id, f.id)),
      h('td', {}, f.type),
      h('td', {}, f.kind === 'normal' ? '' : f.kind),
      h('td', { class: 'd-options' }, optionSummary(f)),
      h('td', { class: 'd-muted' }, f.comment ?? ''),
    );
    const pick = () => {
      studio.selected.field = studio.selected.field === f.id ? undefined : f.id;
      studio.render();
    };
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pick();
    });
    rows.append(tr);
    if (studio.selected.field === f.id) rows.append(h('tr', { class: 'd-editor-row' }, h('td', { colspan: '5' }, fieldEditor(studio, table, f))));
  }

  const fname = h('input', { placeholder: 'Field name', 'aria-label': 'New field name' });
  const ftype = select(nativeTypes(studio), 'text', { 'aria-label': 'Type' });
  const fkind = select(KINDS, 'normal', { 'aria-label': 'Kind' });
  const add = h('form', { class: 'd-inline-form' }, fname, ftype, fkind, h('button', { type: 'submit', class: 'primary' }, 'Add field'));
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = fname.value.trim();
    if (!n) return;
    const change: Record<string, unknown> = { op: 'createField', table: table.id, name: n, type: ftype.value, kind: fkind.value };
    if (fkind.value === 'calculation') change.calculation = '""';
    if (fkind.value === 'summary') {
      const of = table.fields.find((x) => x.type === 'number') ?? table.fields[0];
      if (!of) return void alert('A summary field needs another field to summarize.');
      change.summary = { type: 'count', field: of.id };
    }
    if (await studio.apply([change as never])) {
      const created = studio.design.tables.find((t) => t.id === table.id)?.fields.find((x) => x.name === n);
      // New calculation and summary fields open so their formula can be set.
      if (created && fkind.value !== 'normal') studio.selected.field = created.id;
      studio.render();
    }
  });

  return [
    h('div', { class: 'd-heading' }, name, rename, h('span', { class: 'd-spacer' }), h('span', { class: 'd-muted' }, `${table.records ?? '?'} records`),
      ...(studio.ask ? [button('Explain with AI', () => studio.ask!(`Explain the table "${table.name}": what each record stands for, its key fields, how it relates to other tables, and which layouts and scripts use it.`), { title: 'Ask the assistant what this table is for' })] : []),
      copyButton(studio, { tables: [table.id] }, table.name),
      del),
    impactPanel(studio, 'table', table.name),
    rulesPanel(studio, table.name),
    add,
    h('table', { class: 'd-grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Type'), h('th', {}, 'Kind'), h('th', {}, 'Options'), h('th', {}, 'Comment'))),
      rows),
  ];
}

function fieldEditor(studio: Studio, table: DesignTable, f: DesignField): HTMLElement {
  const o = f.options ?? { global: false, unstored: false, repetitions: 1 };
  const ae = o.autoEnter ?? {};
  const v = o.validation ?? {};
  const occurrences = studio.design.tableOccurrences.filter((t) => t.baseTableId !== undefined);
  const defaultTo = occurrences.find((t) => !t.dataSourceId && t.baseTableId === table.id);

  const name = h('input', { value: f.name });
  const type = select(nativeTypes(studio), f.type);
  const kind = select(KINDS, f.kind === 'unknown' ? 'normal' : f.kind);
  const comment = h('input', { value: f.comment ?? '' });
  const formula = h('textarea', { rows: '4', spellcheck: 'false', class: 'd-code' }, f.calculation ?? '');
  const context = select(occurrences.map((t) => [String(t.id), t.name] as [string, string]), String(f.calculationContextId ?? defaultTo?.id ?? ''));
  const global = check('Global storage (one value for all records)', o.global);
  const unstored = check('Do not store the result (compute when shown)', o.unstored);
  const reps = h('input', { type: 'number', min: '1', max: '32000', value: String(o.repetitions ?? 1), class: 'd-narrow' });
  // Storage › Indexing. An unknown language id read from the file shows as itself and is kept unless changed.
  const index = select(INDEXING, indexing(f), { 'aria-label': 'Indexing' });
  const autoIndex = check('Automatically create indexes as needed', !o.noAutoIndex);
  const langs: [string, string][] = o.indexLanguage && !LANGUAGES.some(([k]) => k === o.indexLanguage) ? [...LANGUAGES, [o.indexLanguage, o.indexLanguage]]
    : o.indexLanguage === undefined && o.indexLanguageId !== undefined ? [['', `Language ${o.indexLanguageId} (from the file)`], ...LANGUAGES] : LANGUAGES;
  const language = select(langs, o.indexLanguage ?? (o.indexLanguageId !== undefined ? '' : 'English'), { 'aria-label': 'Default language' });
  const storageBox = h('div', { class: 'd-stack' }, field('Indexing', index), autoIndex.el, field('Default language', language));
  // Container storage, as FileMaker sets it (Tabularius keeps the data in the database either way).
  const ext = o.externalStorage;
  const external = check('Store container data externally (for FileMaker)', !!ext);
  const dirs = studio.design.containerDirectories ?? [{ id: 0, path: `Files/${studio.design.database}/`, fields: [] }];
  const directory = select(dirs.map((d) => [String(d.id), `[database location]/${d.path}`] as [string, string]), String(ext?.directoryId ?? 0), { 'aria-label': 'Base directory' });
  const storageKind = select([['secure', 'Secure storage'], ['open', 'Open storage']], ext && !ext.secure ? 'open' : 'secure', { 'aria-label': 'Secure or open storage' });
  const fewerFolders = check('With fewer folders', !!ext?.fewerFolders);
  const openPath = h('textarea', { rows: '2', spellcheck: 'false', class: 'd-code', 'aria-label': 'Open storage path' }, ext?.path ?? `"${table.name}/${f.name}/"`);
  const containerBox = h('div', { class: 'd-stack' }, external.el,
    h('div', { class: 'd-stack d-indent' }, field('Relative to', directory), storageKind, fewerFolders.el, field('Path below the base directory', openPath, 'A calculation; FileMaker\'s default is "Table/Field/"')),
    h('p', { class: 'd-muted' }, 'Tabularius keeps every container file in the database; this setting is kept for FileMaker.'));
  const syncContainer = () => {
    (containerBox.children[1] as HTMLElement).hidden = !external.input.checked;
    fewerFolders.el.hidden = storageKind.value !== 'secure';
    (openPath.closest('label, .d-field') as HTMLElement | null ?? openPath).hidden = storageKind.value !== 'open';
  };
  external.input.addEventListener('change', syncContainer);
  storageKind.addEventListener('change', syncContainer);
  syncContainer();

  const sumType = select(SUMMARIES, f.summary?.type ?? 'count');
  const sumField = select(table.fields.filter((x) => x.id !== f.id).map((x) => [String(x.id), x.name] as [string, string]), String(f.summary?.fieldId ?? ''));

  const serial = check('Serial number', !!ae.serial);
  const serialNext = h('input', { value: ae.serial?.next ?? '1', class: 'd-narrow', 'aria-label': 'Next value' });
  const serialInc = h('input', { type: 'number', value: String(ae.serial?.increment ?? 1), class: 'd-narrow', 'aria-label': 'Increment' });
  const serialOnCommit = check('Generate on commit (not on creation)', !!ae.serial?.onCommit);
  const autoValue = select(AUTO_VALUES, ae.value ?? '');
  const lastVisited = check('Value from last visited record', !!ae.lastVisited);
  const hasData = check('Data', ae.data !== undefined);
  const data = h('input', { value: ae.data ?? '' });
  const autoCalc = check('Calculated value (the formula above)', !!ae.calculation);
  const replace = check('Replace an existing value when the inputs change', !!ae.replaceExisting);
  const prohibit = check('Prohibit modification of the value by people (scripts still can)', !!ae.prohibitModification);
  // Looked-up value: from an occurrence related to this table's, copy one of its fields.
  const lk = ae.lookup;
  const related = occurrences.filter((t) => !(t.baseTableId === table.id && !t.dataSourceId));
  const hasLookup = check('Looked-up value', !!lk);
  const lookupTo = select(related.map((t) => [String(t.id), t.name] as [string, string]), String(lk?.occurrenceId ?? related[0]?.id ?? ''), { 'aria-label': 'Look up from' });
  const lookupField = select([], '', { 'aria-label': 'Copy field' });
  const fillLookupFields = () => {
    const to = occurrences.find((t) => t.id === Number(lookupTo.value));
    const fields = studio.design.tables.find((t) => !to?.dataSourceId && t.id === to?.baseTableId)?.fields ?? [];
    lookupField.replaceChildren(...fields.map((x) => h('option', { value: String(x.id) }, x.name)));
    if (lk && lk.occurrenceId === Number(lookupTo.value)) lookupField.value = String(lk.fieldId);
  };
  lookupTo.addEventListener('change', fillLookupFields);
  fillLookupFields();
  const noMatch = select(NO_MATCH, lk?.noMatch ?? 'keep', { 'aria-label': 'If no related record' });
  const noMatchValue = h('input', { value: lk?.value ?? '', class: 'd-narrow', 'aria-label': 'Value when there is no match' });
  const copyEmpty = check('Copy an empty related value too', !!lk?.copyEmpty);
  const lookupBox = h('div', { class: 'd-stack d-indent' }, field('From', lookupTo), field('Copy field', lookupField),
    h('div', { class: 'd-row' }, field('If no related record', noMatch), noMatchValue), copyEmpty.el);
  const syncLookup = () => {
    lookupBox.hidden = !hasLookup.input.checked;
    noMatchValue.hidden = noMatch.value !== 'value';
  };
  hasLookup.input.addEventListener('change', syncLookup);
  noMatch.addEventListener('change', syncLookup);
  syncLookup();

  const notEmpty = check('Not empty', !!v.notEmpty);
  const unique = check('Unique value', !!v.unique);
  const hasRange = check('In range', !!v.range);
  const min = h('input', { value: v.range?.min ?? '', class: 'd-narrow', 'aria-label': 'From' });
  const max = h('input', { value: v.range?.max ?? '', class: 'd-narrow', 'aria-label': 'To' });
  const maxLength = h('input', { type: 'number', min: '0', value: v.maxLength ? String(v.maxLength) : '', class: 'd-narrow' });
  const valCalc = h('textarea', { rows: '2', spellcheck: 'false', class: 'd-code' }, v.calculation ?? '');
  const message = h('input', { value: v.message ?? '' });
  const messageCalc = check('The message is a calculation', !!v.messageCalculation);
  const onlyModified = check('Validate the calculation only if the field has been modified', !v.calculationAlways);
  const strict = check('Users can\'t override', !!v.strict);
  const strictType = select(STRICT_TYPES, v.type ?? '', { 'aria-label': 'Strict data type' });
  const existing = check('Existing value (another record already has it)', !!v.existing);
  const memberOf = select([['', 'Any value'], ...studio.design.valueLists.map((l) => [String(l.id), l.name] as [string, string])], v.valueList !== undefined ? String(v.valueList) : '', { 'aria-label': 'Member of value list' });

  const skipEmpty = check('Do not evaluate if all referenced fields are empty', !(f.kind === 'calculation' ? o.evaluateWhenEmpty : ae.evaluateWhenEmpty));
  const calcTarget = (): DraftTarget => ({ kind: 'calculation', for: `${table.name}::${f.name}`, ...(Number(context.value) ? { contextTo: Number(context.value) } : {}) });
  const useCalc = (text: string) => {
    formula.value = text;
    formula.dispatchEvent(new Event('input'));
    formula.focus();
  };
  const formulaCheck = formulaChecker(studio, formula, () => ({ occurrence: Number(context.value) || undefined, table: table.id }),
    (error) => void studio.ask?.(`Fix the formula of the field ${table.name}::${f.name}. It is ${current(formula.value)}, and checking it says: ${error}. ` +
      'Keep what it is meant to work out; change only what is wrong.', { target: calcTarget(), use: useCalc }));
  const formulaShown = formulaPreview(studio, formula, () => ({ occurrence: Number(context.value) || undefined, table: table.id }));
  const valCheck = formulaChecker(studio, valCalc, () => ({ occurrence: defaultTo?.id, table: table.id }));
  const calcBox = h('div', { class: 'd-group' }, field('Formula', formula, 'FileMaker calculation syntax'), formulaCheck.message, formulaShown, field('Evaluate from', context), skipEmpty.el,
    h('div', { class: 'd-actions' }, formulaCheck.button,
      ...(studio.ask ? [...draftWithAI(studio, calcTarget,
        (want) => `Draft the formula for the field ${table.name}::${f.name}${want ? `: ${want}` : ', from its name and the table\'s fields'}.` +
          (formula.value.trim() && formula.value.trim() !== '""' ? ` It now has ${current(formula.value)}.` : ''),
        useCalc),
      button('Explain formula with AI', () => studio.ask!(`Explain the calculation of the field ${table.name}::${f.name}: what it works out, field by field, and anything that looks wrong.`))] : [])));
  const sumBox = h('div', { class: 'd-group' }, field('Summary', sumType), field('of field', sumField));
  const normalBox = h('div', { class: 'd-columns' },
    h('fieldset', {}, h('legend', {}, 'Auto-enter'),
      h('div', { class: 'd-row' }, serial.el, serialNext, h('span', { class: 'd-muted' }, 'increment'), serialInc), serialOnCommit.el,
      field('Creation / modification', autoValue),
      lastVisited.el,
      h('div', { class: 'd-row' }, hasData.el, data),
      autoCalc.el, replace.el, hasLookup.el, lookupBox, prohibit.el),
    h('fieldset', {}, h('legend', {}, 'Validation'),
      field('Strict data type', strictType),
      notEmpty.el, unique.el, existing.el,
      field('Member of value list', memberOf),
      h('div', { class: 'd-row' }, hasRange.el, min, h('span', { class: 'd-muted' }, 'to'), max),
      field('Maximum characters', maxLength),
      field('Validation calculation', valCalc),
      valCheck.message, onlyModified.el,
      h('div', { class: 'd-actions' }, valCheck.button, ...(studio.ask ? draftWithAI(studio,
        () => ({ kind: 'calculation', for: `${table.name}::${f.name} (validation)`, ...(defaultTo ? { contextTo: defaultTo.id } : {}) }),
        (want) => `Draft a validation calculation for the field ${table.name}::${f.name}: true when the value is valid${want ? `, ${want}` : ''}.`,
        (text) => {
          valCalc.value = text;
          valCalc.focus();
        }) : [])),
      field('Message when it fails', message), messageCalc.el,
      strict.el),
  );
  const sync = () => {
    const k = kind.value;
    calcBox.hidden = !(k === 'calculation' || (k === 'normal' && autoCalc.input.checked));
    sumBox.hidden = k !== 'summary';
    normalBox.hidden = k !== 'normal';
    unstored.el.hidden = k !== 'calculation';
    // Globals, summaries and unstored calculations have no index.
    storageBox.hidden = k === 'summary' || global.input.checked || (k === 'calculation' && unstored.input.checked) || type.value === 'container';
    containerBox.hidden = type.value !== 'container' || k !== 'normal' || global.input.checked;
  };
  type.addEventListener('change', () => sync());
  global.input.addEventListener('change', () => sync());
  unstored.input.addEventListener('change', () => sync());
  kind.addEventListener('change', sync);
  autoCalc.input.addEventListener('change', sync);
  sync();

  const save = async () => {
    const change: Record<string, unknown> = { op: 'updateField', table: table.id, field: f.id };
    if (name.value.trim() !== f.name) {
      if (!(await confirmRename(studio, 'field', `${table.name}::${f.name}`, name.value.trim()))) return;
      change.name = name.value.trim();
    }
    if (type.value !== f.type) change.type = type.value;
    if (kind.value !== f.kind) change.kind = kind.value;
    if (comment.value !== (f.comment ?? '')) change.comment = comment.value;
    const usesFormula = kind.value === 'calculation' || (kind.value === 'normal' && autoCalc.input.checked);
    if (usesFormula && formula.value !== (f.calculation ?? '')) {
      if (!await formulaCheck.confirmSave()) return;
      change.calculation = formula.value;
    }
    if (!usesFormula && f.calculation !== undefined && kind.value === 'normal') change.calculation = '';
    if (usesFormula && context.value && Number(context.value) !== (f.calculationContextId ?? defaultTo?.id)) change.calculationContext = Number(context.value);
    if (kind.value === 'summary') change.summary = { type: sumType.value, field: Number(sumField.value) };
    const options: Record<string, unknown> = {
      global: global.input.checked,
      unstored: kind.value === 'calculation' && unstored.input.checked,
      repetitions: Math.max(1, Number(reps.value) || 1),
    };
    if (kind.value === 'calculation' && skipEmpty.input.checked === !!o.evaluateWhenEmpty) options.evaluateWhenEmpty = skipEmpty.input.checked ? null : true;
    if (!containerBox.hidden) {
      const want = external.input.checked ? {
        directory: Number(directory.value),
        ...(storageKind.value === 'secure' ? { secure: true, ...(fewerFolders.input.checked ? { fewerFolders: true } : {}) } : { path: openPath.value }),
      } : null;
      const had = ext ? { directory: ext.directoryId, ...(ext.secure ? { secure: true, ...(ext.fewerFolders ? { fewerFolders: true } : {}) } : { path: ext.path }) } : null;
      if (JSON.stringify(want) !== JSON.stringify(had)) options.externalStorage = want;
    }
    if (!storageBox.hidden) {
      if (index.value !== indexing(f)) options.index = index.value || null;
      if (autoIndex.input.checked === !!o.noAutoIndex) options.noAutoIndex = autoIndex.input.checked ? null : true;
      if (language.value && language.value !== o.indexLanguage) options.indexLanguage = language.value;
    }
    if (kind.value === 'normal') {
      const auto: Record<string, unknown> = autoCalc.input.checked && !skipEmpty.input.checked ? { evaluateWhenEmpty: true } : {};
      if (serial.input.checked) auto.serial = { next: serialNext.value || '1', increment: Number(serialInc.value) || 1, ...(serialOnCommit.input.checked ? { onCommit: true } : {}) };
      if (autoValue.value) auto.value = autoValue.value;
      if (lastVisited.input.checked) auto.lastVisited = true;
      if (hasData.input.checked) auto.data = data.value;
      if (autoCalc.input.checked) {
        auto.calculation = true;
        auto.replaceExisting = replace.input.checked;
      }
      if (hasLookup.input.checked && lookupTo.value && lookupField.value) {
        auto.lookup = {
          occurrence: Number(lookupTo.value), field: Number(lookupField.value), ...(lk?.fromId !== undefined ? { from: lk.fromId } : {}),
          ...(noMatch.value !== 'keep' ? { noMatch: noMatch.value } : {}), ...(noMatch.value === 'value' ? { value: noMatchValue.value } : {}),
          ...(copyEmpty.input.checked ? { copyEmpty: true } : {}),
        };
      }
      if (prohibit.input.checked) auto.prohibitModification = true;
      options.autoEnter = Object.keys(auto).length ? auto : null;
      // Options this form doesn't show are kept.
      const val: Record<string, unknown> = { ...(v.always ? { always: true } : {}) };
      if (memberOf.value) val.valueList = Number(memberOf.value);
      if (strictType.value) val.type = strictType.value;
      if (existing.input.checked) val.existing = true;
      if (notEmpty.input.checked) val.notEmpty = true;
      if (unique.input.checked) val.unique = true;
      if (hasRange.input.checked) val.range = { min: min.value, max: max.value };
      if (Number(maxLength.value) > 0) val.maxLength = Number(maxLength.value);
      if (valCalc.value.trim()) {
        if (valCalc.value !== (v.calculation ?? '') && !await valCheck.confirmSave()) return;
        val.calculation = valCalc.value;
        if (!onlyModified.input.checked) val.calculationAlways = true;
      }
      if (message.value) val.message = message.value;
      if (message.value && messageCalc.input.checked) val.messageCalculation = true;
      if (strict.input.checked) val.strict = true;
      options.validation = Object.keys(val).length ? val : null;
    }
    change.options = options;
    if (await studio.apply([change as never], 'Field saved')) {
      const renamed = studio.design.tables.find((t) => t.id === table.id)?.fields.find((x) => x.id === f.id);
      studio.selected.field = renamed?.id;
    }
  };

  const del = button('Delete field…', async () => {
    const uses = (await impactNote(studio, 'field', `${table.name}::${f.name}`, 'delete')) || (await usedBy(studio, `${table.name}::${f.name}`, 'field'));
    if (confirm(`Delete field "${f.name}"?\n\n${uses}\n\nIts data is kept under Recently deleted, where you can restore it with everything that used it.`)) {
      studio.selected.field = undefined;
      void studio.apply([{ op: 'deleteField', table: table.id, field: f.id }], `Deleted ${f.name}`);
    }
  }, { class: 'danger' });

  const form = h('form', { class: 'd-editor' },
    h('div', { class: 'd-columns' },
      h('div', { class: 'd-group' }, field('Name', name), field('Type', type), field('Kind', kind), field('Comment', comment)),
      h('div', { class: 'd-group' }, global.el, unstored.el, field('Repetitions', reps)),
      h('div', { class: 'd-group' }, storageBox, containerBox),
    ),
    calcBox, sumBox, normalBox,
    impactPanel(studio, 'field', `${table.name}::${f.name}`),
    h('div', { class: 'd-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Save field'),
      button('Cancel', () => {
        studio.selected.field = undefined;
        studio.render();
      }),
      h('span', { class: 'd-spacer' }),
      ...(studio.ask ? [button('Explain with AI', () => studio.ask!(`Explain the field ${table.name}::${f.name}: what it holds, where its value comes from, and which layouts, scripts and formulas use it.`), { title: 'Ask the assistant about this field' })] : []),
      copyButton(studio, { fields: { table: table.id, ids: [f.id] } }, `${table.name}::${f.name}`),
      del),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });
  form.addEventListener('click', (e) => e.stopPropagation());
  return form;
}
