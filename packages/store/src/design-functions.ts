// FileMaker's design functions, answered from a file's design: the same answers in a script, a field's calculation
// and a layout's. What only a script's window knows (WindowNames, GetRecordIDsFromFoundSet, a value list's related
// values for the window's record) stays with the caller.

import { asText, text, formatNumber, type Value } from '../../calc/src/index.ts';
import type { Field, LayoutObject, Table } from '../../fmp12/src/index.ts';
import { dataSourceFile } from './import.ts';
import type { Store } from './store.ts';
import type { Privileges } from './privileges.ts';

/** Where the calculation is: its table (unqualified field names) and table occurrence. */
export interface DesignHere {
  table?: Table;
  occurrence?: string;
  privileges?: Privileges;
}

/** Design functions whose first argument isn't a file name. */
export const NO_FILE_ARGUMENT: ReadonlySet<string> = new Set(['gettableddl', 'getrecordidsfromfoundset', 'getbasetablename', 'getfieldsonlayout']);

/**
 * A design function's answer for `store` (the file its fileName argument named), or undefined when the function
 * isn't one of these or what it names doesn't exist (the calculation gives empty).
 */
export function designFunction(store: Store, name: string, args: Value[], here: DesignHere = {}): Value | undefined {
  const s = store.schema;
  const arg = (i: number) => (args[i] ? asText(args[i]) : '');
  const list = (xs: (string | number)[]) => text(xs.join('\r'));
  const pv = here.privileges?.in(store);
  const layouts = () => s.layouts.filter((l) => pv?.layout(l.name).layout !== 'none');
  const scripts = () => s.scripts.filter((x) => pv?.script(x.name) !== 'none');
  const valueLists = () => s.valueLists.filter((v) => pv?.valueList(v.name) !== 'none');
  const occurrences = () => s.tableOccurrences.filter((to) => {
    if (!here.privileges) return true;
    const t = store.calc.occurrenceTable(to.id);
    return t && visibleTable(t.store, t.table, here.privileges);
  });
  const tables = () => s.tables.filter((t) => visibleTable(store, t, here.privileges));
  switch (name.toLowerCase()) {
    case 'layoutnames': return list(layouts().map((l) => l.name));
    case 'layoutids': return list(layouts().map((l) => l.id));
    case 'scriptnames': return list(scripts().map((x) => x.name));
    case 'scriptids': return list(scripts().map((x) => x.id));
    case 'tablenames': return list(occurrences().map((t) => t.name));
    case 'tableids': return list(occurrences().map((t) => t.id));
    case 'basetablenames': return list(tables().map((t) => t.name));
    case 'basetableids': return list(tables().map((t) => t.id));
    case 'valuelistnames': return list(valueLists().map((v) => v.name));
    case 'valuelistids': return list(valueLists().map((v) => v.id));
    // A layout's fields (related ones as occurrence::field), else every field of the table or occurrence named
    // ("" is the calculation's table, or the file's first).
    case 'fieldnames': case 'fieldids': {
      const ids = name.toLowerCase() === 'fieldids';
      const placed = placedFields(store, arg(1), here.privileges);
      if (placed) return list([...new Map(placed.map((p) => [ids ? p.id : p.name, 0])).keys()]);
      const table = designTable(store, arg(1), here);
      return table ? list(table.table.fields.filter((f) => visibleField(table.store, table.table, f, here.privileges)).map((x) => (ids ? x.id : x.name))) : undefined;
    }
    // FieldType ( file ; field ): storage, type, index, repetitions, as "Standard Text Indexed 1".
    case 'fieldtype': {
      const hit = designField(store, arg(1), here);
      return hit ? text(fieldTypeText(hit.field)) : undefined;
    }
    case 'fieldcomment': {
      const hit = designField(store, arg(1), here);
      return hit ? text(hit.field.comment ?? '') : undefined;
    }
    // The value the next new record gets, without using it up.
    case 'getnextserialvalue': {
      const hit = designField(store, arg(1), here);
      return hit ? text(hit.store.calc.peekSerial(hit.table, hit.field) ?? '') : undefined;
    }
    // GetBaseTableName ( field ): the base table behind the field's occurrence (its argument is the field's name).
    case 'getbasetablename': {
      const ref = arg(0);
      if (!designField(store, ref, here)) return undefined;
      const at = ref.lastIndexOf('::');
      const occurrence = at < 0 ? here.occurrence : ref.slice(0, at);
      if (occurrence === undefined) return here.table ? text(here.table.name) : undefined;
      const to = store.calc.occurrence(occurrence);
      return to ? text(store.calc.occurrenceTable(to.id)?.table.name ?? '') : undefined;
    }
    // On a layout: FieldStyle the control and its value list, FieldRepetitions how many it shows, FieldBounds where it is.
    case 'fieldstyle': case 'fieldrepetitions': case 'fieldbounds': {
      const want = arg(2).toLowerCase();
      const hit = placedFields(store, arg(1), here.privileges)?.find((p) => p.name.toLowerCase() === want || p.field.toLowerCase() === want);
      if (!hit) return undefined;
      const o = hit.object;
      const f = o.field!;
      if (name.toLowerCase() === 'fieldbounds') return text([o.bounds.left, o.bounds.top, o.bounds.right, o.bounds.bottom, 0].map((n) => formatNumber(n)).join(' '));
      // The orientation isn't decoded from files; FileMaker's default is vertical.
      if (name.toLowerCase() === 'fieldrepetitions') return text(`${Math.max(1, f.repetitions || 1)} vertical`);
      const style = FIELD_STYLES[f.display] ?? 'Standard';
      const valueList = f.valueList ?? (f.valueListId !== undefined ? s.valueLists.find((v) => v.id === f.valueListId)?.name : undefined);
      return text(valueList && pv?.valueList(valueList) !== 'none' && style !== 'Standard' ? `${style} ${valueList}` : style);
    }
    case 'layoutobjectnames': {
      const design = arg(1) && pv?.layout(arg(1)).layout !== 'none' && s.layouts.some((l) => l.name === arg(1)) ? store.design(arg(1)) : undefined;
      return list(design ? objectNames(design.objects) : []);
    }
    case 'relationinfo': return relationInfo(store, arg(1), here.privileges);
  }
  return undefined;
}

/** FieldType's four words: storage, type, index, repetitions ("Standard Text Indexed 1"), as Claris documents them. */
export function fieldTypeText(f: Field): string {
  const o = f.options;
  const storage = o?.global ? 'Global'
    : f.kind === 'summary' ? 'Summary'
    : f.kind === 'calculation' ? (o?.unstored ? 'UnstoredCalc' : 'StoredCalc')
    : o?.externalStorage ? (o.externalStorage.secure ? 'External(Secure)' : 'External(Open)')
    : 'Standard';
  const type = f.type === 'unknown' ? 'Text' : f.type[0].toUpperCase() + f.type.slice(1);
  // Globals, containers, summaries and unstored calculations are never indexed.
  const indexed = !o?.global && f.type !== 'container' && f.kind !== 'summary' && !o?.unstored && !!(o?.index?.value || o?.index?.word);
  return `${storage} ${type} ${indexed ? 'Indexed' : 'Unindexed'} ${o?.repetitions ?? 1}`;
}

/** FieldStyle's words for a field's control style. */
const FIELD_STYLES: Record<string, string> = {
  edit: 'Standard', dropdown: 'Popuplist', popup: 'Popupmenu', checkbox: 'Checkbox', radio: 'RadioButton', calendar: 'Calendar',
};

/** The table a design function names: a table occurrence, a base table, or ("") the calculation's table or the file's first. */
function designTable(store: Store, name: string, here: DesignHere): { store: Store; table: Table } | undefined {
  const s = store.schema;
  if (!name) {
    const table = here.table ?? s.tables[0];
    return table && visibleTable(store, table, here.privileges) ? { store, table } : undefined;
  }
  const to = store.calc.occurrence(name);
  if (to) {
    const t = store.calc.occurrenceTable(to.id);
    return t && visibleTable(t.store, t.table, here.privileges) ? t : undefined;
  }
  const table = s.tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return table && visibleTable(store, table, here.privileges) ? { store, table } : undefined;
}

function visibleTable(store: Store, table: Table, privileges?: Privileges): boolean {
  return privileges?.in(store).table(table.name).view !== false;
}

function visibleField(store: Store, table: Table, field: Field, privileges?: Privileges): boolean {
  return visibleTable(store, table, privileges) && privileges?.in(store).field(table.name, field.name) !== 'none';
}

/** A field a design function names, as "table::field" (an occurrence or base table) or in the calculation's table. */
function designField(store: Store, ref: string, here: DesignHere): { store: Store; table: Table; field: Field } | undefined {
  const at = ref.lastIndexOf('::');
  const t = designTable(store, at < 0 ? '' : ref.slice(0, at), here);
  const name = (at < 0 ? ref : ref.slice(at + 2)).toLowerCase();
  const field = t?.table.fields.find((x) => x.name.toLowerCase() === name);
  return t && field && visibleField(t.store, t.table, field, here.privileges) ? { ...t, field } : undefined;
}

/**
 * The fields placed on a layout, in the order its objects are stored (portals, tabs and groups included):
 * the name design functions give (occurrence::field for one from another occurrence) and the id (occurrence id::field id).
 * Undefined when there is no such layout.
 */
function placedFields(store: Store, layout: string, privileges?: Privileges): { name: string; id: string; field: string; object: LayoutObject }[] | undefined {
  if (!layout || !store.schema.layouts.some((l) => l.name === layout)) return undefined;
  if (privileges?.in(store).layout(layout).layout === 'none') return [];
  const design = store.design(layout);
  if (!design) return [];
  const own = design.tableOccurrenceId;
  const out: { name: string; id: string; field: string; object: LayoutObject }[] = [];
  const walk = (objects: LayoutObject[]) => {
    for (const o of objects) {
      const ref = o.field;
      if (o.kind === 'field' && ref) {
        const home = store.calc.occurrenceTable(ref.tableOccurrenceId);
        const schemaField = home?.table.fields.find((f) => f.id === ref.fieldId);
        if (privileges && (!home || !schemaField || !visibleField(home.store, home.table, schemaField, privileges))) continue;
        const field = ref.field ?? store.calc.occurrenceTable(ref.tableOccurrenceId)?.table.fields.find((x) => x.id === ref.fieldId)?.name ?? '';
        const mine = ref.tableOccurrenceId === own;
        const toName = ref.tableOccurrence ?? store.schema.tableOccurrences.find((t) => t.id === ref.tableOccurrenceId)?.name ?? '';
        if (field) out.push({ name: mine ? field : `${toName}::${field}`, id: mine ? String(ref.fieldId) : `${ref.tableOccurrenceId}::${ref.fieldId}`, field, object: o });
      }
      if (o.children) walk(o.children);
    }
  };
  walk(design.objects);
  return out;
}

/**
 * LayoutObjectNames: named objects in stored order; a named tab control, slide control, group, portal or popover is
 * followed by the names inside it between "<" and ">" lines (Claris: even when it holds none); a named panel the same
 * way. An unnamed one's named objects are listed in its place (inferred: Claris doesn't say).
 */
export function objectNames(objects: LayoutObject[]): string[] {
  const out: string[] = [];
  for (const o of objects) {
    const inner = o.children ? objectNames(o.children) : [];
    if (o.name && CONTAINERS.has(o.kind)) out.push(o.name, '<', ...inner, '>');
    else {
      if (o.name) out.push(o.name);
      out.push(...inner);
    }
  }
  return out;
}
const CONTAINERS = new Set(['tab-control', 'tab-panel', 'slide-control', 'slide-panel', 'group', 'portal', 'popover-button', 'popover', 'button-bar']);

/** Join operators as RelationInfo writes them (Claris's example shows ≥ as >=; the others are inferred to match). */
const JOIN_TEXT: Record<string, string> = { '≤': '<=', '≥': '>=' };
const FLIP_JOIN: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

/**
 * RelationInfo ( file ; table occurrence ): a block for each relationship of the occurrence, "Source:", "Table:",
 * "Options:" (Delete, Create, Sorted, for the related table) and the match fields, related table first as Claris's
 * example reads; blocks are separated by an empty line.
 */
function relationInfo(store: Store, name: string, privileges?: Privileges): Value | undefined {
  const s = store.schema;
  const to = store.calc.occurrence(name);
  if (!to) return undefined;
  const toName = (id: number) => s.tableOccurrences.find((t) => t.id === id)?.name ?? '';
  const fieldOf = (toId: number, fieldId: number, given: string | undefined) =>
    given ?? store.calc.occurrenceTable(toId)?.table.fields.find((x) => x.id === fieldId)?.name ?? '';
  const blocks = s.relationships.filter((r) => r.leftTableOccurrenceId === to.id || r.rightTableOccurrenceId === to.id).filter((r) => {
    if (!privileges) return true;
    const left = store.calc.occurrenceTable(r.leftTableOccurrenceId);
    const right = store.calc.occurrenceTable(r.rightTableOccurrenceId);
    if (!left || !right || !visibleTable(left.store, left.table, privileges) || !visibleTable(right.store, right.table, privileges)) return false;
    return r.predicates.every((p) => {
      if (p.operator === '×') return true;
      const lf = left.table.fields.find((f) => f.id === p.leftFieldId);
      const rf = right.table.fields.find((f) => f.id === p.rightFieldId);
      return lf && rf && visibleField(left.store, left.table, lf, privileges) && visibleField(right.store, right.table, rf, privileges);
    });
  }).map((r) => {
    const mineLeft = r.leftTableOccurrenceId === to.id;
    const other = mineLeft ? r.rightTableOccurrenceId : r.leftTableOccurrenceId;
    const source = s.tableOccurrences.find((t) => t.id === other)?.dataSourceId;
    const file = source === undefined ? store.name : dataSourceFile(s.dataSources.find((d) => d.id === source)?.paths ?? []) ?? store.name;
    const options = [
      (mineLeft ? r.rightDelete : r.leftDelete) ? 'Delete' : '',
      (mineLeft ? r.rightCreate : r.leftCreate) ? 'Create' : '',
      r.sorted ? 'Sorted' : '',
    ].filter(Boolean).join(' ');
    const preds = r.predicates.map((p) => {
      const l = `${toName(r.leftTableOccurrenceId)}::${fieldOf(r.leftTableOccurrenceId, p.leftFieldId, p.leftField)}`;
      const rr = `${toName(r.rightTableOccurrenceId)}::${fieldOf(r.rightTableOccurrenceId, p.rightFieldId, p.rightField)}`;
      const op = JOIN_TEXT[p.operator] ?? p.operator;
      return mineLeft ? `${rr} ${FLIP_JOIN[op] ?? op} ${l}` : `${l} ${op} ${rr}`;
    });
    return [`Source: ${file}`, `Table: ${toName(other)}`, `Options: ${options}`, ...preds].join('\r');
  });
  return text(blocks.join('\r\r'));
}
