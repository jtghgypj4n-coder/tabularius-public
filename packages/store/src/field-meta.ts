// A field as the Data API's layout metadata describes it (fieldMetaData and
// portalMetaData entries), from the field's definition: shared by the Data
// API and the Execute FileMaker Data API script step.

import type { LayoutObject } from '../../fmp12/src/layouts.ts';
import type { Field } from '../../fmp12/src/schema.ts';

/** fieldMetaData "result" names for field types. */
const RESULT: Record<string, string> = { text: 'text', number: 'number', date: 'date', time: 'time', timestamp: 'timeStamp', container: 'container', boolean: 'boolean', integer: 'integer', decimal: 'decimal', json: 'json', uuid: 'uuid' };

/** One fieldMetaData entry; `displayType` is how the layout shows the field (editText when it doesn't). */
export function fieldMetaData(name: string, def: Field | undefined, displayType = 'editText'): Record<string, unknown> {
  const o = def?.options;
  const reps = o?.repetitions ?? 1;
  return {
    name, type: def?.kind === 'calculation' || def?.kind === 'summary' ? def.kind : 'normal', displayType,
    result: def ? RESULT[def.type] ?? 'text' : 'text', global: !!o?.global,
    autoEnter: !!(o?.autoEnter && (o.autoEnter.value || o.autoEnter.serial || o.autoEnter.data !== undefined || o.autoEnter.calculation || o.autoEnter.lookup)),
    fourDigitYear: o?.validation?.type === 'date4', maxRepeat: reps, maxCharacters: o?.validation?.maxLength ?? 0,
    notEmpty: !!o?.validation?.notEmpty, numeric: o?.validation?.type === 'number', timeOfDay: o?.validation?.type === 'time',
    repetitionStart: 1, repetitionEnd: reps, repetitions: reps,
  };
}

/** fieldMetaData "displayType" names for how a field is shown on the layout. */
const DISPLAY_TYPE: Record<string, string> = { edit: 'editText', dropdown: 'popupList', popup: 'popupMenu', checkbox: 'checkBox', radio: 'radioButtons', calendar: 'calendar' };

/**
 * How each field is shown on a layout (its first object there), named as fieldMetaData names it, by field name in
 * lower case: the layout's own fields by name, others as "occurrence::field".
 */
export function fieldDisplayTypes(objects: LayoutObject[], occurrence: string): Map<string, string> {
  const shownAs = new Map<string, string>();
  const show = (objs: LayoutObject[]) => {
    for (const o of objs) {
      const f = o.field;
      if (f?.field) {
        const own = f.tableOccurrence === undefined || f.tableOccurrence.toLowerCase() === occurrence.toLowerCase();
        const key = (own ? f.field : `${f.tableOccurrence}::${f.field}`).toLowerCase();
        if (!shownAs.has(key)) shownAs.set(key, f.behavior?.concealed && f.display === 'edit' ? 'secureText' : DISPLAY_TYPE[f.display] ?? 'editText');
      }
      if (o.children) show(o.children);
    }
  };
  show(objects);
  return shownAs;
}
