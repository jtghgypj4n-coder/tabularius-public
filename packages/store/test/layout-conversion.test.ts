// Converter quality (store/layout-conversion.ts): a check for each way an object can fail to convert, and the demo
// corpus (fixtures/fmp12, from `npm run fixtures`) converts without an error-level finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, readImageLibrary, readLayoutDesigns, type LayoutDesign, type LayoutObject, type Schema } from '../../fmp12/src/index.ts';
import { conversionText, layoutConversion } from '../src/index.ts';

const schema = { tableOccurrences: [{ id: 1, name: 'Orders' }] } as unknown as Schema;
const box = { top: 0, left: 0, bottom: 20, right: 100 };
const obj = (o: Partial<LayoutObject> & { kind: LayoutObject['kind'] }): LayoutObject => ({ id: 1, type: 1, bounds: box, anchors: { left: true, top: true, right: false, bottom: false }, style: {}, ...o }) as LayoutObject;
const layout = (objects: LayoutObject[], extra: Partial<LayoutDesign> = {}): LayoutDesign => ({ id: 1, name: 'Orders', tableOccurrenceId: 1, style: {}, parts: [], objects, ...extra }) as unknown as LayoutDesign;
const rules = (objects: LayoutObject[], images?: Set<number>) => layoutConversion([layout(objects)], schema, images).findings.map((f) => f.rule);

test('conversion quality: well-formed objects produce no findings and are counted', () => {
  const q = layoutConversion([layout([
    obj({ id: 1, kind: 'field', field: { tableOccurrenceId: 1, fieldId: 2, tableOccurrence: 'Orders', field: 'Total' } as LayoutObject['field'] }),
    obj({ id: 2, kind: 'text', text: 'Total' }), obj({ id: 3, kind: 'line', bounds: { top: 5, left: 0, bottom: 5, right: 100 } }),
    obj({ id: 4, kind: 'button', action: { stepId: 1, step: 'Perform Script', scriptId: 3, script: 'Go' } }),
    obj({ id: 5, kind: 'group', children: [obj({ id: 6, kind: 'rectangle' })] }),
  ])], schema);
  assert.deepEqual(q.findings, []);
  assert.deepEqual([q.layouts, q.objects, q.kinds.rectangle, q.kinds.group], [1, 6, 1, 1]);
});

test('conversion quality: each way an object fails to convert is named, with how serious it is', () => {
  assert.deepEqual(rules([obj({ kind: 'unknown', type: 77 })]), ['unknown-object']);
  assert.deepEqual(rules([obj({ kind: 'field' })]), ['unresolved-field']);
  assert.deepEqual(rules([obj({ kind: 'field', field: { tableOccurrenceId: 9, fieldId: 4 } as LayoutObject['field'] })]), ['unresolved-field']);
  assert.deepEqual(rules([obj({ kind: 'portal', portal: { tableOccurrenceId: 9, rows: 3, initialRow: 1 } })]), ['unresolved-portal']);
  assert.deepEqual(rules([obj({ kind: 'text', bounds: { top: 0, left: 0, bottom: 0, right: 50 } })]), ['empty-bounds']);
  assert.deepEqual(rules([obj({ kind: 'text', text: 'Caf�' })]), ['garbled-text']);
  assert.deepEqual(rules([obj({ kind: 'button', action: { stepId: 1, step: 'Perform Script', scriptId: 8 } })]), ['unresolved-script']);
  assert.deepEqual(rules([obj({ kind: 'button', action: { stepId: 6, step: 'Go to Layout', layoutId: 12 } })]), ['unresolved-layout']);
  assert.deepEqual(rules([obj({ kind: 'button', action: { stepId: 6, step: 'Go to Layout', layoutId: 0 } })]), [], 'layout 0 is the original layout');
  assert.deepEqual(rules([obj({ kind: 'button' })]), ['no-action']);
  // Pictures are only checked when the image library is given; children are walked.
  assert.deepEqual(rules([obj({ kind: 'graphic', imageId: 5 })]), []);
  assert.deepEqual(rules([obj({ kind: 'graphic', imageId: 5 })], new Set([6])), ['missing-image']);
  assert.deepEqual(rules([obj({ kind: 'group', children: [obj({ id: 2, kind: 'unknown', type: 3 })] })]), ['unknown-object']);
  // A layout's own problems.
  const own = layoutConversion([layout([], { tableOccurrenceId: 404 })], schema).findings;
  assert.deepEqual(own.map((f) => [f.rule, f.severity]), [['unknown-occurrence', 'warning'], ['empty-layout', 'info']]);
});

test('conversion quality: findings come most serious first, and the text report names them with a limit', () => {
  const objects = [obj({ id: 1, kind: 'button' }), obj({ id: 2, kind: 'unknown', type: 9 }), ...[3, 4, 5, 6, 7, 8].map((id) => obj({ id, kind: 'text', text: '\u0001' }))];
  const q = layoutConversion([layout(objects)], schema);
  assert.deepEqual(q.findings.map((f) => f.severity).slice(0, 2), ['error', 'error']);
  assert.equal(q.findings.at(-1)!.rule, 'no-action');
  const text = conversionText('Orders.fmp12', q);
  assert.match(text, /^Orders\.fmp12: 1 layouts, 8 objects, 8 findings/);
  assert.match(text, /error unknown-object \(1\)/);
  assert.match(text, /… and 1 more/);
  assert.match(conversionText('x', layoutConversion([], schema)), /all converted/);
});

const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.fmp12')).sort() : [];

test('conversion quality: the demo corpus converts every layout object without an error', { skip: files.length ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let objects = 0;
  for (const f of files) {
    const db = FmpDatabase.open(join(dir, f));
    const { layouts } = readLayoutDesigns(db.file, db.schema);
    const q = layoutConversion(layouts, db.schema, new Set(readImageLibrary(db.file).keys()));
    objects += q.objects;
    for (const x of q.findings) (x.severity === 'error' ? errors : x.severity === 'warning' ? warnings : []).push(`${f}: ${x.layout}: ${x.rule}: ${x.message}`);
  }
  assert.ok(objects > 500, `${objects} objects read`);
  assert.deepEqual(errors, []);
  // What the corpus is known to carry: a layout of an occurrence the file no longer has.
  assert.deepEqual(warnings, ['PortableCode39-2.fmp12: Splash: unknown-occurrence: Its table occurrence (id 130) is not in the file']);
});
