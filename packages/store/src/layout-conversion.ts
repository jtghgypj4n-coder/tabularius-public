// Converter quality for layouts: after a file is read, which of its layout objects did not come through whole. The
// layout linter (layout-lint.ts) is about design mistakes a person made; this is about what the converter could not
// read, so a gap is found on the demo files before it is found on a customer's. An object that is wrong in the file
// itself (a field deleted after it was placed) shows up here too, but as a warning: the converter did its part.

import type { LayoutDesign, LayoutObject, Schema } from '../../fmp12/src/index.ts';
import { objectLabel } from './layout-lint.ts';

export type ConversionRule =
  | 'unknown-object' | 'unresolved-field' | 'unresolved-portal' | 'unresolved-script' | 'unresolved-layout' | 'missing-image'
  | 'empty-bounds' | 'garbled-text' | 'no-action' | 'unknown-occurrence' | 'empty-layout';

export interface ConversionFinding {
  rule: ConversionRule;
  /** error: the converter lost something. warning: probably the file's own doing. info: may be intended. */
  severity: 'error' | 'warning' | 'info';
  layout: string;
  /** The object it is about (none for a finding about the whole layout). */
  objectId?: number;
  message: string;
}

export interface ConversionQuality {
  layouts: number;
  objects: number;
  /** How many objects of each kind were read. */
  kinds: Record<string, number>;
  findings: ConversionFinding[];
}

/** Why each rule exists and how bad it is, in the order a report lists them. */
export const CONVERSION_RULES: Record<ConversionRule, { severity: ConversionFinding['severity']; what: string }> = {
  'unknown-object': { severity: 'error', what: 'an object type the converter does not know' },
  'unresolved-field': { severity: 'error', what: 'a field object whose table occurrence or field could not be named' },
  'unresolved-portal': { severity: 'error', what: 'a portal whose table occurrence could not be named' },
  'unknown-occurrence': { severity: 'warning', what: 'a layout whose table occurrence is not in the file (FileMaker keeps these for layouts of a deleted occurrence)' },
  'empty-bounds': { severity: 'error', what: 'an object with no width or height, which draws as nothing' },
  'garbled-text': { severity: 'error', what: 'text with replacement or control characters, so it was read wrongly' },
  'unresolved-script': { severity: 'warning', what: 'a Perform Script button whose script is not in the file' },
  'unresolved-layout': { severity: 'warning', what: 'a Go to Layout button whose layout is not in the file' },
  'missing-image': { severity: 'warning', what: 'a picture that is not in the file\'s image library' },
  'no-action': { severity: 'info', what: 'a button with no action read (it may be a button set to do nothing)' },
  'empty-layout': { severity: 'info', what: 'a layout with no objects' },
};

const GARBLED = /[�\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
/** A line has no height or no width on purpose. */
const FLAT = new Set(['line']);

/**
 * What did not convert on each layout. `images` are the ids in the file's image library (readImageLibrary): without
 * them, pictures are not checked.
 */
export function layoutConversion(layouts: LayoutDesign[], schema: Schema, images?: ReadonlySet<number>): ConversionQuality {
  const out: ConversionQuality = { layouts: layouts.length, objects: 0, kinds: {}, findings: [] };
  const known = new Set(schema.tableOccurrences.map((o) => o.id));
  for (const layout of layouts) {
    const add = (rule: ConversionRule, message: string, o?: LayoutObject) => out.findings.push({ rule, severity: CONVERSION_RULES[rule].severity, layout: layout.name, ...(o ? { objectId: o.id } : {}), message });
    if (layout.tableOccurrenceId !== undefined && !known.has(layout.tableOccurrenceId)) add('unknown-occurrence', `Its table occurrence (id ${layout.tableOccurrenceId}) is not in the file`);
    if (!layout.objects.length) add('empty-layout', 'It has no objects');
    const walk = (list: LayoutObject[]) => {
      for (const o of list) {
        out.objects++;
        out.kinds[o.kind] = (out.kinds[o.kind] ?? 0) + 1;
        const label = objectLabel(o);
        if (o.kind === 'unknown') add('unknown-object', `${label}: object type ${o.type} is not known`, o);
        if (o.kind === 'field' && (!o.field || !o.field.tableOccurrence || !o.field.field)) add('unresolved-field', `A field object (${o.field ? `occurrence ${o.field.tableOccurrenceId}, field ${o.field.fieldId}` : 'no field reference'}) could not be named`, o);
        if (o.kind === 'portal' && !o.portal?.tableOccurrence) add('unresolved-portal', 'A portal\'s table occurrence could not be named', o);
        if (o.kind === 'button' || o.kind === 'popover-button') {
          if (!o.action) add('no-action', `${label} has no action`, o);
          else if (o.action.scriptId !== undefined && !o.action.script) add('unresolved-script', `${label} runs script ${o.action.scriptId}, which is not in the file`, o);
          else if (o.action.layoutId !== undefined && !o.action.layout && o.action.layoutId > 0) add('unresolved-layout', `${label} goes to layout ${o.action.layoutId}, which is not in the file`, o);
        }
        if (o.kind === 'graphic' && images && o.imageId !== undefined && !images.has(o.imageId)) add('missing-image', `${label} uses image ${o.imageId}, which is not in the image library`, o);
        const w = o.bounds.right - o.bounds.left, h = o.bounds.bottom - o.bounds.top;
        if (!FLAT.has(o.kind) && (w <= 0 || h <= 0 || !Number.isFinite(w) || !Number.isFinite(h))) add('empty-bounds', `${label} is ${w} by ${h} points`, o);
        if ((o.text && GARBLED.test(o.text)) || (o.name && GARBLED.test(o.name))) add('garbled-text', `${label} has characters that were read wrongly`, o);
        if (o.children?.length) walk(o.children);
      }
    };
    walk(layout.objects);
  }
  const order = Object.keys(CONVERSION_RULES);
  out.findings.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule) || a.layout.localeCompare(b.layout) || (a.objectId ?? 0) - (b.objectId ?? 0));
  return out;
}

/** A report in plain text: the counts, then each finding by rule. */
export function conversionText(file: string, q: ConversionQuality, limit = 5): string {
  const lines = [`${file}: ${q.layouts} layouts, ${q.objects} objects, ${q.findings.length ? `${q.findings.length} finding${q.findings.length === 1 ? '' : 's'}` : 'all converted'}`];
  for (const rule of Object.keys(CONVERSION_RULES) as ConversionRule[]) {
    const mine = q.findings.filter((f) => f.rule === rule);
    if (!mine.length) continue;
    lines.push(`  ${CONVERSION_RULES[rule].severity} ${rule} (${mine.length}): ${CONVERSION_RULES[rule].what}`);
    for (const f of mine.slice(0, limit)) lines.push(`    ${f.layout}: ${f.message}`);
    if (mine.length > limit) lines.push(`    … and ${mine.length - limit} more`);
  }
  return lines.join('\n');
}
