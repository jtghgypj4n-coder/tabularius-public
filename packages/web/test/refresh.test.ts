import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObjectState, mergeFieldValues, mergeObjectRecord, refreshMatches, checkpointCache, foundPortalPage, foundPortalRange, mergeFoundObjectRows } from '../src/refresh.ts';
import type { LayoutObject, DataRecord, ViewState } from '../src/types.ts';

test('refresh responses reject changed window/layout/record identity', () => {
  const action = { windowId: 'window', layoutId: 1, recordId: 10 };
  assert.equal(refreshMatches(action, 'window', 1, '10'), true);
  assert.equal(refreshMatches(action, 'other', 1, '10'), false);
  assert.equal(refreshMatches(action, 'window', 2, '10'), false);
  assert.equal(refreshMatches(action, 'window', 1, '11'), false);
});

test('a repetition patch changes only the selected repetition; absent/zero refresh all', () => {
  const fresh = { Field: 'new 1', 'Field(2)': 'new 2', 'Field(3)': 'new 3', Sibling: 'new sibling' };
  const old = { Field: 'old 1', 'Field(2)': 'old 2', 'Field(3)': 'old 3', Sibling: 'old sibling' };
  mergeFieldValues(old, fresh, 'Field', 2);
  assert.deepEqual(old, { Field: 'old 1', 'Field(2)': 'new 2', 'Field(3)': 'old 3', Sibling: 'old sibling' });
  for (const repetition of [undefined, 0]) {
    const all = { ...old };
    mergeFieldValues(all, fresh, 'Field', repetition);
    assert.deepEqual(all, { ...fresh, Sibling: 'old sibling' });
  }
});

test('object visibility/format patches clear old state and preserve sibling formulas', () => {
  const object = { id: 1, text: '<<Value>>' } as LayoutObject;
  const old: ViewState = { hidden: [1, 2], styles: { 1: [0], 2: [1] }, tooltips: { 1: 'old', 2: 'sibling' }, placeholders: {}, web: { 2: 'unchanged' }, merges: { Value: 'old', Sibling: 'untouched' } };
  const fresh: ViewState = { hidden: [], tooltips: { 1: 'new' }, placeholders: {}, merges: { Value: 'new', Sibling: 'changed' } };
  const state = mergeObjectState(old, fresh, object);
  assert.deepEqual(state.hidden, [2]);
  assert.deepEqual(state.styles, { 2: [1] });
  assert.deepEqual(state.tooltips, { 1: 'new', 2: 'sibling' });
  assert.deepEqual(state.web, { 2: 'unchanged' });
  assert.deepEqual(state.merges, { Value: 'new', Sibling: 'untouched' });
});

test('portal-child patches follow child identities without replacing membership or sibling values', () => {
  const old: DataRecord = { recordId: '1', modId: '1', fieldData: {}, portalData: { Rows: [
    { recordId: '7', modId: '1', 'Rows::Field': 'seven', 'Rows::Sibling': 'untouched' },
    { recordId: '8', modId: '1', 'Rows::Field': 'eight' },
  ] } };
  const fresh: DataRecord = { recordId: '1', modId: '2', fieldData: {}, portalData: { Rows: [
    { recordId: '8', modId: '2', 'Rows::Field': 'new eight' },
    { recordId: '7', modId: '2', 'Rows::Field': 'new seven', 'Rows::Sibling': 'changed' },
    { recordId: '9', modId: '2', 'Rows::Field': 'nine' },
  ] } };
  mergeObjectRecord(old, fresh, 'Rows::Field', undefined, 'Rows');
  assert.deepEqual(old.portalData.Rows.map((r) => [r.recordId, r['Rows::Field']]), [['7', 'new seven'], ['8', 'new eight']]);
  assert.equal(old.portalData.Rows[0]['Rows::Sibling'], 'untouched');
});

test('scrolling related-portal refresh preserves offscreen cache and clears only requested deleted or denied rows', () => {
  for (const repetition of [undefined, 2]) {
    const row = (id: number) => ({ recordId: String(id), modId: '1', 'Rows::Value': `old ${id}`,
      'Rows::Value(2)': `old second ${id}`, 'Rows::Sibling': 'keep' });
    const old: DataRecord = { recordId: '1', modId: '1', fieldData: {}, portalData: { Rows: [7, 8, 9, 10].map(row) } };
    const fresh: DataRecord = { recordId: '1', modId: '2', fieldData: {}, portalData: { Rows: [
      { ...row(7), 'Rows::Value': 'fresh visible', 'Rows::Value(2)': 'fresh second', 'Rows::Sibling': 'changed' },
    ] } };
    const requested = [7, 9, 10]; // Visible, deleted and denied; row 8 is cached offscreen.
    mergeObjectRecord(old, fresh, 'Rows::Value', repetition, 'Rows', requested);
    assert.deepEqual(old.portalData.Rows.map((r) => r.recordId), ['7', '8', '9', '10'], 'membership and order stay fixed');
    assert.deepEqual(old.portalData.Rows[0], { ...row(7),
      'Rows::Value': repetition ? 'old 7' : 'fresh visible', 'Rows::Value(2)': 'fresh second' });
    assert.deepEqual(old.portalData.Rows[1], row(8), 'unrequested offscreen values and repetitions survive');
    for (const [i, reason] of [[2, 'deleted'], [3, 'denied']] as const) {
      assert.equal(old.portalData.Rows[i]['Rows::Value'], repetition ? `old ${i + 7}` : undefined, reason);
      assert.equal(old.portalData.Rows[i]['Rows::Value(2)'], undefined, reason);
      assert.equal(old.portalData.Rows[i]['Rows::Sibling'], 'keep', reason);
    }
    const after = structuredClone(old);
    mergeObjectRecord(old, fresh, 'Rows::Value', repetition, 'Rows', []);
    assert.deepEqual(old, after, 'an empty requested set cannot change cached values');
    fresh.portalData.Rows = [{ ...row(8), 'Rows::Value': 'fresh scrolled', 'Rows::Value(2)': 'scrolled second' }];
    mergeObjectRecord(old, fresh, 'Rows::Value', repetition, 'Rows', [8]);
    assert.deepEqual(old.portalData.Rows[0], after.portalData.Rows[0], 'scrolling preserves the previously visible row');
    assert.equal(old.portalData.Rows[1]['Rows::Value'], repetition ? 'old 8' : 'fresh scrolled');
    assert.equal(old.portalData.Rows[1]['Rows::Value(2)'], 'scrolled second');
  }
});

test('a portal patch without request metadata merges returned identities and preserves absent cached rows', () => {
  const old: DataRecord = { recordId: '1', modId: '1', fieldData: {}, portalData: { Rows: [
    { recordId: '7', modId: '1', 'Rows::Value': 'seven' }, { recordId: '8', modId: '1', 'Rows::Value': 'eight' },
  ] } };
  const fresh: DataRecord = { recordId: '1', modId: '2', fieldData: {}, portalData: { Rows: [
    { recordId: '7', modId: '2', 'Rows::Value': 'fresh' },
  ] } };
  mergeObjectRecord(old, fresh, 'Rows::Value', undefined, 'Rows');
  assert.deepEqual(old.portalData.Rows.map((r) => r['Rows::Value']), ['fresh', 'eight']);
});


test('find, sort and omit checkpoint identities reindex cached positions before refreshing', () => {
  const record = (id: number): DataRecord => ({ recordId: String(id), modId: '1', fieldData: {}, portalData: {} });
  const cache = new Map([[0, record(1)], [1, record(2)], [2, record(3)]]);
  for (const ids of [[2], [2, 1, 3], [2, 3]]) {
    const next = checkpointCache(cache, ids);
    assert.equal(next.get(0)?.recordId, '2');
    assert.equal(next.size, ids.length);
    if (ids.length === 3) assert.equal(refreshMatches({ recordId: 1 }, 'window', 1, next.get(1)?.recordId), true, 'sort preserves the current identity at its new position');
    assert.equal(refreshMatches({ recordId: 2 }, 'window', 1, next.get(0)?.recordId), true);
  }
  assert.equal(checkpointCache(cache, [4]).get(0), undefined, 'an uncached record cannot inherit the old position');
});

test('a refreshed found-set page beyond 1000 retains the full sparse count and paging ceiling', () => {
  const rows = [{ recordId: '1051', modId: '1', 'Items::Name': 'fresh' }];
  const page = foundPortalPage(rows, 1500, 1051);
  assert.equal(page.length, 1500);
  assert.equal(page[1050]?.['Items::Name'], 'fresh');
  assert.equal(0 in page, false);
  assert.equal(1499 in page, false);
  assert.deepEqual(foundPortalRange([1051], undefined, page), { offset: 1051, limit: 1 }, 'a query-based found set supplies the scrolled range before it has explicit ids');
  assert.deepEqual(foundPortalRange([1051], [1051, 1052], page), { offset: 1, limit: 1 });
});


test('Refresh Object patches noncurrent found-set child repetitions without replacing membership', () => {
  const rows = [{ recordId: '1', modId: '1', 'Items::Field': 'old one', 'Items::Field(2)': 'old two', 'Items::Sibling': 'keep' },
    { recordId: '2', modId: '1', 'Items::Field': 'other one', 'Items::Field(2)': 'other two', 'Items::Sibling': 'keep' }];
  const fresh: DataRecord['portalData'][string] = [{ recordId: '2', modId: '2', 'Items::Field': 'new one', 'Items::Field(2)': 'new two' },
    { recordId: '1', modId: '2', 'Items::Field': 'new first' }];
  mergeFoundObjectRows(rows, fresh, { id: 1, field: { tableOccurrence: 'Items', field: 'Field' } } as LayoutObject, 2);
  assert.deepEqual(rows.map((r) => [r.recordId, r['Items::Field'], r['Items::Field(2)'], r['Items::Sibling']]),
    [['1', 'old one', undefined, 'keep'], ['2', 'other one', 'new two', 'keep']]);
});
