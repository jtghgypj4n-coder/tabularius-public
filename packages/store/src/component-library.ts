// Layout components shared across files (not in FileMaker): a component saved
// to the server's library carries its objects with every reference named, so
// another file can place it and point each field, value list, script and
// layout at its own of the same name. Pure functions; the library itself is
// packages/server/src/component-library.ts.

import { stepLine, type LayoutObject, type Schema } from '../../fmp12/src/index.ts';
import type { FieldRef } from '../../fmp12/src/layouts.ts';

type Fields = (occurrenceId: number) => { id: number; name: string }[] | undefined;

function each(objects: LayoutObject[], fn: (o: LayoutObject) => void): void {
  for (const o of objects) {
    fn(o);
    if (o.children) each(o.children, fn);
  }
}

/** Every image library id the objects show: graphics and button icons. */
export function imageIds(objects: LayoutObject[]): number[] {
  const out = new Set<number>();
  each(objects, (o) => {
    if (o.imageId !== undefined) out.add(o.imageId);
    if (o.icon) out.add(o.icon.imageId);
  });
  return [...out];
}

/**
 * The objects as they travel to other files: a copy in which every field,
 * occurrence, value list, script and layout a reference points at carries
 * its name as this file has it now (a name kept on the reference can be from
 * before a rename), and each button's one step its script line.
 */
export function portableObjects(objects: LayoutObject[], schema: Schema, fields: Fields): LayoutObject[] {
  const out = structuredClone(objects);
  const to = (id: number) => schema.tableOccurrences.find((t) => t.id === id)?.name;
  const field = (r: FieldRef) => {
    r.tableOccurrence = to(r.tableOccurrenceId) ?? r.tableOccurrence;
    r.field = fields(r.tableOccurrenceId)?.find((f) => f.id === r.fieldId)?.name ?? r.field;
  };
  const list = (id: number | undefined, kept: string | undefined) => (id === undefined ? kept : schema.valueLists.find((v) => v.id === id)?.name ?? kept);
  const script = (id: number | undefined, kept: string | undefined) => (id === undefined ? kept : schema.scripts.find((s) => s.id === id)?.name ?? kept);
  each(out, (o) => {
    if (o.field) {
      field(o.field);
      if (o.field.valueListId !== undefined) o.field.valueList = list(o.field.valueListId, o.field.valueList);
    }
    if (o.portal) {
      o.portal.tableOccurrence = to(o.portal.tableOccurrenceId) ?? o.portal.tableOccurrence;
      for (const s of o.portal.sort ?? []) {
        field(s.field);
        if (s.valueListId !== undefined) s.valueList = list(s.valueListId, s.valueList);
      }
    }
    if (o.action) {
      if (o.action.scriptId !== undefined && !o.action.file) o.action.script = script(o.action.scriptId, o.action.script);
      if (o.action.layoutId !== undefined) o.action.layout = schema.layouts.find((l) => l.id === o.action!.layoutId)?.name ?? o.action.layout;
      // Steps read from a .fmp12 hold ids in their options: the line names them, for the other file to read by name.
      if (o.action.stepId !== 1 && o.action.line === undefined) o.action.line = stepLine(o.action.step, o.action.params);
    }
    for (const t of o.triggers ?? []) t.script = script(t.scriptId, t.script);
  });
  return out;
}

/**
 * Objects from another file pointed at this file's own occurrences, fields,
 * value lists, scripts and layouts, found by name (ignoring case, as
 * FileMaker does). What this file has no match for is listed in `missing`
 * (by the name it had there) and left as FileMaker leaves a reference to
 * something deleted: the field shows <Field Missing>, a button runs nothing.
 * `image` gives this file's image library id for the other file's; `step`
 * reads a button's one step (other than Perform Script) from its script line
 * in this file, undefined when it names something this file lacks.
 */
export function adaptObjects(objects: LayoutObject[], schema: Schema, fields: Fields, image: (id: number) => number | undefined, step?: (line: string) => LayoutObject['action'] | undefined): { objects: LayoutObject[]; missing: string[] } {
  const out = structuredClone(objects);
  const missing = new Set<string>();
  const same = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
  const to = (name: string | undefined) => schema.tableOccurrences.find((t) => same(t.name, name));
  const field = (r: FieldRef) => {
    const occurrence = to(r.tableOccurrence);
    const f = occurrence && fields(occurrence.id)?.find((x) => same(x.name, r.field));
    if (!occurrence) missing.add(`table occurrence ${r.tableOccurrence ?? '?'}`);
    else if (!f) missing.add(`field ${occurrence.name}::${r.field ?? '?'}`);
    // Ids that name nothing here: drawn as <Table Missing> or <Field Missing>.
    r.tableOccurrenceId = occurrence?.id ?? 0;
    r.fieldId = f?.id ?? 0;
    if (occurrence) r.tableOccurrence = occurrence.name;
    if (f) r.field = f.name;
  };
  const valueList = (name: string | undefined) => {
    const v = schema.valueLists.find((x) => same(x.name, name));
    if (!v) missing.add(`value list ${name ?? '?'}`);
    return v;
  };
  const script = (name: string | undefined) => {
    const s = schema.scripts.find((x) => same(x.name, name));
    if (!s) missing.add(`script ${name ?? '?'}`);
    return s;
  };
  const drop: LayoutObject[] = [];
  each(out, (o) => {
    if (o.field) {
      field(o.field);
      if (o.field.valueListId !== undefined || o.field.valueList !== undefined) {
        const v = valueList(o.field.valueList);
        if (v) Object.assign(o.field, { valueListId: v.id, valueList: v.name });
        else delete o.field.valueListId;
      }
    }
    if (o.portal) {
      const occurrence = to(o.portal.tableOccurrence);
      if (!occurrence) missing.add(`table occurrence ${o.portal.tableOccurrence ?? '?'}`);
      o.portal.tableOccurrenceId = occurrence?.id ?? 0;
      for (const s of o.portal.sort ?? []) {
        field(s.field);
        if (s.valueListId !== undefined || s.valueList !== undefined) {
          const v = valueList(s.valueList);
          if (v) Object.assign(s, { valueListId: v.id, valueList: v.name });
          else delete s.valueListId;
        }
      }
    }
    if (o.action?.stepId === 1) {
      const s = script(o.action.script);
      if (s) Object.assign(o.action, { scriptId: s.id, script: s.name });
      else drop.push(o);
    } else if (o.action?.line !== undefined && step) {
      const a = step(o.action.line);
      if (a) o.action = a;
      else {
        missing.add(`button step "${o.action.line}"`);
        drop.push(o);
      }
    } else if (o.action?.layoutId !== undefined) {
      const l = schema.layouts.find((x) => same(x.name, o.action!.layout));
      if (l) Object.assign(o.action, { layoutId: l.id, layout: l.name });
      else {
        missing.add(`layout ${o.action.layout ?? '?'}`);
        drop.push(o);
      }
    }
    if (o.triggers) {
      o.triggers = o.triggers.flatMap((t) => {
        const s = script(t.script);
        return s ? [{ ...t, scriptId: s.id, script: s.name }] : [];
      });
      if (!o.triggers.length) delete o.triggers;
    }
    if (o.imageId !== undefined) {
      const id = image(o.imageId);
      if (id === undefined) delete o.imageId;
      else o.imageId = id;
    }
    if (o.icon) {
      const id = image(o.icon.imageId);
      if (id === undefined) delete o.icon;
      else o.icon.imageId = id;
    }
  });
  // A button whose script or layout isn't here does nothing, as in FileMaker when it's deleted.
  for (const o of drop) delete o.action;
  return { objects: out, missing: [...missing].sort() };
}
