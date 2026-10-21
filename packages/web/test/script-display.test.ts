import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { checkpointCache, refreshMatches } from '../src/refresh.ts';
import { ApiError, retryableRequest, unreachableRequest } from '../src/api.ts';

// Execute the actual session methods without starting the browser shell. Rendering and dialogs are test doubles.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const session = parsed.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'Session')!;
const errorText = parsed.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'errorText')!;
const compiled = ts.transpileModule(session.getText(parsed) + '\n' + errorText.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
function display(result: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const context = { document: { activeElement: null }, HTMLElement: class {}, setTimeout, scriptFailureMessage: () => undefined,
    ApiError, Error, retryableRequest, unreachableRequest,
    customDialog: async () => ({ button: 1 }), toast: () => undefined, ...globals };
  const Session = runInNewContext(compiled + '\nSession', context);
  const s = Object.create(Session.prototype);
  const front = { id: 'A', name: 'A', style: 'document' };
  Object.assign(s, {
    meta: { layout: { name: 'Notes', id: 1 }, design: { objects: [] } },
    content: { querySelectorAll: () => [] }, cache: new Map(), panels: new Map(), frozenWindows: new Set(), behind: [],
    states: new Map(), foundRows: new Map(), viewerStates: new Map(), displayGeneration: 0, groupsGeneration: 0, foundRowsAsked: 0,
    commit: async () => true, locks: { releaseAll: async () => undefined },
    frontWindow: () => s.front ?? front, displayPortals: () => ({}), whileRunning: (v: unknown) => v,
    api: { button: async () => result, continueRun: async () => ({ actions: [] }), answerSort: async () => ({ actions: [] }), answerDialog: async () => ({ actions: [] }) },
    renderToolbar: () => s.pausedRun?.(true), renderKeepingTyping: () => undefined,
    ensureActionDisplay: async () => undefined,
  });
  Object.defineProperty(s, 'record', { value: { recordId: '1' } });
  return s;
}

for (const outcome of ['moved', 'deleted']) test(`a shrinking portal response retains the truncated saved identity until it is ${outcome}`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.repaintObject = () => undefined;
  const got = { rows: [{ recordId: '2', Title: 'B' }, { recordId: '1', Title: 'stale A' }],
    page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  s.refetchFoundRow('1');
  assert.equal(requests[0].body.offset, 2);
  requests[0].answer({ count: 1, rows: [] });
  await requests[0].response;
  const state = s.foundRows.get('found');
  assert.equal(state.stale.has('1'), true, 'an empty old position cannot prove A disappeared');
  assert.equal(state.displaced.get('1').Title, 'stale A');
  assert.equal(requests.length, 2, 'truncated identities receive a replacement without scrolling');
  assert.equal(requests[1].body.recordId, '1');
  assert.equal(state.requests.size, 1);
  requests[1].answer(outcome === 'moved'
    ? { count: 1, offset: 1, rows: [{ recordId: '1', Title: 'fresh A' }] }
    : { count: 1, offset: 0, rows: [] });
  await requests[1].response;
  if (outcome === 'moved') {
    assert.equal(requests.length, 3, 'the displaced B identity is reconciled too');
    assert.equal(requests[2].body.recordId, '2');
    requests[2].answer({ count: 1, offset: 0, rows: [] });
    await requests[2].response;
  }
  assert.deepEqual(Array.from(got.rows, (row) => row.Title), [outcome === 'moved' ? 'fresh A' : 'B']);
  assert.equal(state.stale.size, 0);
  assert.equal(state.displaced.size, 0);
  assert.equal(state.requests.size, 0);
  assert.deepEqual([...got.asked], [0]);
  t.mock.timers.tick(1000);
  assert.equal(requests.length, outcome === 'moved' ? 3 : 2);
});

test('a sort-changing save locates displaced portal identities and stops retrying', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({});
  s.mode = 'browse';
  s.sort = [{ fieldName: 'Title', sortOrder: 'ascend' }];
  s.query = [{ Title: '*' }];
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.repaintObject = () => undefined;
  const got = { rows: [{ recordId: '1', Title: 'stale A' }, { recordId: '2', Title: 'B' }],
    page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  s.refetchFoundRow('1');
  requests[0].answer({ count: 2, rows: [{ recordId: '2', Title: 'B' }] });
  await requests[0].response;
  assert.equal(got.rows[0].Title, 'stale A', 'a different identity cannot satisfy A');
  assert.equal(requests[1].body.recordId, '1');
  assert.equal(requests[1].body.sort, s.sort);
  assert.equal(requests[1].body.query, s.query);
  requests[1].answer({ count: 2, offset: 2, rows: [{ recordId: '1', Title: 'saved Z' }] });
  await requests[1].response;
  assert.equal(requests[2].body.recordId, '2');
  requests[2].answer({ count: 2, offset: 1, rows: [{ recordId: '2', Title: 'B' }] });
  await requests[2].response;
  assert.deepEqual(Array.from(got.rows, (row) => [row.recordId, row.Title]), [['2', 'B'], ['1', 'saved Z']]);
  const state = s.foundRows.get('found');
  assert.equal(state.stale.size, 0);
  assert.equal(state.displaced.size, 0);
  assert.equal(state.requests.size, 0);
  assert.deepEqual([...got.asked].sort(), [0, 1]);
  assert.equal(got.top, 100);
  t.mock.timers.tick(30_000);
  assert.equal(requests.length, 3, 'settled sort changes must leave no autonomous retry loop');
});

for (const modId of [undefined, '1']) test(`an empty-position page cannot resurrect a twice-saved identity (modId ${modId})`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.repaintObject = () => undefined;
  const got = { rows: [{ recordId: '1', modId, Title: 'A' }, undefined, undefined], page: 1, asked: new Set([0]), top: 0 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  s.refetchFoundRow('1');
  s.fetchFoundRows('found', 1, 1); // Captures A at its first saved position, still empty in the cache.
  s.refetchFoundRow('1');
  requests[2].answer({ count: 3, rows: [{ recordId: '2', Title: 'B' }] });
  await requests[2].response;
  assert.equal(requests[3].body.recordId, '1');
  requests[3].answer({ count: 3, offset: 3, rows: [{ recordId: '1', modId: modId && '3', Title: 'fresh A' }] });
  await requests[3].response;
  requests[0].answer({ count: 3, rows: [{ recordId: '1', modId, Title: 'old A' }] });
  await requests[0].response;
  requests[1].answer({ count: 3, rows: [{ recordId: '1', modId: modId && '2', Title: 'stale A' }] });
  await requests[1].response;
  assert.equal(got.rows[1], undefined, 'the delayed copy must be dropped even though its requested position had no identity');
  assert.equal(got.rows[2]?.Title, 'fresh A');
  const selected: number[] = [];
  s.goTo = (i: number) => selected.push(i);
  s.goToRecordId('1');
  assert.deepEqual(selected, [2], 'navigation without a main-record cache uses the fresh position');
  const state = s.foundRows.get('found');
  assert.equal(state.stale.size, 0);
  assert.equal(state.requests.size, 0);
  t.mock.timers.tick(30_000);
  assert.equal(requests.length, 4);
  s.foundSetScrolled('found', 0, 1, 1);
  assert.equal(requests.length, 5, 'the dropped position remains fetchable');
  requests[4].answer({ count: 3, rows: [{ recordId: '3', Title: 'C' }, { recordId: '1', modId: modId && '3', Title: 'fresh A' }] });
  await requests[4].response;
});

test('a later page cannot replace a known record with a lower modification id', async () => {
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [];
  const got = { rows: [{ recordId: '1', modId: '10', Title: 'fresh A' }, undefined], page: 1, asked: new Set([0]), top: 0 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  s.api.foundSetPortal = async () => ({ count: 2, rows: [{ recordId: '1', modId: '9', Title: 'stale A' }] });
  s.fetchFoundRows('found', 1, 1);
  await Promise.resolve();
  assert.equal(got.rows[1], undefined);
  assert.equal(got.rows[0]?.Title, 'fresh A');
  assert.equal(s.foundRows.get('found').requests.size, 0);
});

test('saving an identity absent from the portal invalidates an earlier empty-position page', async () => {
  const s = display({});
  const got = { rows: [undefined], page: 1, asked: new Set(), top: 0 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  let answer!: (value: unknown) => void;
  const response = new Promise((resolve) => { answer = resolve; });
  s.api.foundSetPortal = () => response;
  s.fetchFoundRows('found', 0, 0);
  s.refetchFoundRow('1');
  answer({ count: 1, rows: [{ recordId: '1', modId: '1', Title: 'before save' }] });
  await response;
  assert.equal(got.rows[0], undefined);
  assert.equal(got.asked.has(0), false, 'the rejected position stays available for a later fetch');
  assert.equal(s.foundRows.get('found').requests.size, 0);
});

for (const empty of [false, true]) for (const failure of ['permission', 'missing', 'invalid', 'network', 'timeout', 'server', 'busy', 'stale']) {
  test(`a persistent ${failure} failure stops retrying a ${empty ? 'previously empty' : 'saved'} portal row`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const messages: string[] = [];
    const s = display({}, { toast: (message: string) => messages.push(message) });
    s.mode = 'browse';
    s.meta.portals = [];
    const got = { rows: [empty ? undefined : { recordId: '1', Title: 'stale' }], page: 1, asked: new Set(empty ? [] : [0]), top: 0 };
    s.foundRows.set('found', got);
    s.foundRowsKey = 'current';
    const error = failure === 'permission' ? new ApiError(9, 'Permission denied', undefined, 500)
      : failure === 'missing' ? new ApiError(101, 'Record missing', undefined, 404)
      : failure === 'invalid' ? new ApiError(105, 'Invalid request', undefined, 400)
      : failure === 'server' ? new ApiError(-1, 'Service unavailable', undefined, 503)
      : failure === 'busy' ? new ApiError(301, 'Record busy')
      : failure === 'stale' ? new ApiError(306, 'Stale modification id')
      : failure === 'timeout' ? Object.assign(new Error('Timeout'), { name: 'TimeoutError' })
      : new TypeError('Failed to fetch');
    const terminal = ['permission', 'missing', 'invalid'].includes(failure);
    let requests = 0;
    s.api.foundSetPortal = async () => { requests++; throw error; };
    s.repaintObject = () => assert.fail('failed requests cannot repaint');
    if (empty) s.fetchFoundRows('found', 0, 0);
    else s.refetchFoundRow('1');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(requests, terminal ? 1 : 2);
    if (!terminal) for (const [i, delay] of [250, 500, 1000].entries()) {
      t.mock.timers.tick(delay - 1);
      await Promise.resolve();
      assert.equal(requests, i + 2, 'each retry waits for the exponential delay');
      t.mock.timers.tick(1);
      await Promise.resolve();
      assert.equal(requests, i + 3);
    }
    const state = s.foundRows.get('found');
    assert.equal(state.requests.size, 0);
    assert.equal(state.failed.get(empty ? 0 : '1'), error);
    if (!empty) {
      assert.equal(state.stale.has('1'), true);
      assert.equal(got.rows[0]?.Title, 'stale');
    }
    assert.deepEqual(messages, [error instanceof ApiError && error.status === 503 ? 'Server busy. Try again shortly.' : error instanceof ApiError ? `${error.message} (error ${error.code})` : failure === 'network' ? "Can't reach the server. Check the connection and try again." : error.message], 'the stopped request uses the usual error toast');
    t.mock.timers.tick(60_000);
    s.foundSetScrolled('found', 0, 0, 0);
    await Promise.resolve();
    assert.equal(requests, terminal ? 1 : 5, 'timers and scrolling cannot restart a failed row');
    if (!empty) {
      s.api.foundSetPortal = async () => { requests++; return { count: 1, rows: [{ recordId: '1', Title: 'fresh' }] }; };
      s.refetchFoundRow('1');
      await Promise.resolve();
      assert.equal(got.rows[0]?.Title, 'fresh', 'a new save can recover the row');
      assert.equal(state.failed.size, 0);
      assert.equal(state.stale.size, 0);
    }
  });
}

test('a terminal failure follows its record after a checkpoint without blocking an empty replacement position', async () => {
  const s = display({}, { checkpointCache });
  s.mode = 'browse';
  s.meta.portals = [];
  s.content.querySelector = () => undefined;
  s.loadMenus = async () => undefined;
  const got = { rows: [{ recordId: '1', Title: 'stale A' }, undefined], page: 1, asked: new Set([0]), top: 0 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const error = new ApiError(9, 'Permission denied');
  s.api.foundSetPortal = async () => { throw error; };
  s.refetchFoundRow('1');
  await Promise.resolve();
  await s.showRun({ actions: [], foundSet: [2, 1], recordId: 1, mode: 'browse' }, undefined, { reload: false });
  let requests = 0;
  s.api.foundSetPortal = async () => { requests++; return { count: 2, rows: [{ recordId: '2', Title: 'fresh B' }] }; };
  s.foundSetScrolled('found', 0, 0, 0);
  await Promise.resolve();
  assert.equal(requests, 1, 'the former position of a failed record can fetch its new identity');
  assert.equal(got.rows[0]?.Title, 'fresh B');
  assert.equal(s.foundRows.get('found').failed.get('1'), error);
  assert.equal(s.foundRows.get('found').stale.has('1'), true);
});

for (const missing of ['none', 'record', 'object', 'repetition']) test(`sub-summary completion preserves the draft only in the same record, object and repetition (missing ${missing})`, async () => {
  const document: { activeElement: Input | null } = { activeElement: null };
  const events: string[] = [];
  let s: any;
  const field = { id: 102, triggers: [{ event: 'OnObjectEnter' }, { event: 'OnObjectExit' }] };
  class Input {
    dataset = { key: 'Title', shown: 'saved', replaced: '' };
    value = 'saved';
    selectionStart = 0;
    selectionEnd = 0;
    listeners = new Map<string, () => void>();
    record: string;
    id: number;
    siblings: Input[];
    constructor(record: string, id: number, siblings: Input[]) {
      this.record = record;
      this.id = id;
      this.siblings = siblings;
      siblings.push(this);
    }
    matches() { return true; }
    closest(selector: string) {
      if (selector === '[data-id]') return { dataset: { id: String(this.id) }, querySelectorAll: () => this.siblings };
      if (selector === '.fm-part[data-record]') return { dataset: { record: this.record } };
      return null;
    }
    focus() { document.activeElement = this; s.fieldEvent(field, 'OnObjectEnter'); }
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
    addEventListener(event: string, handler: () => void) { this.listeners.set(event, handler); }
    dispatchEvent(event: Event) { events.push(`${this.record}:${event.type}:${this.value}`); return true; }
  }
  s = display({}, { document, HTMLInputElement: Input, HTMLTextAreaElement: class {}, Event });
  Object.assign(s, { mode: 'browse', view: 'list', foundCount: 2, sort: [{ fieldName: 'Title' }],
    renderer: {}, breakParts: () => [{ level: 0 }], unsaved: new Map(), conflicts: new Map(),
    fieldTriggers: Promise.resolve(), fire: async (event: string) => { events.push(event); return true; } });
  delete s.renderKeepingTyping;
  const before: Input[] = [];
  new Input('B', 102, before);
  const active = new Input('B', 102, before);
  active.value = 'unsaved B';
  active.setSelectionRange(2, 6);
  document.activeElement = active;
  const after: Input[] = [];
  for (const record of ['A', 'B']) for (const id of [101, 102]) {
    if (record === 'B' && (missing === 'record' || (id === 102 && missing === 'object'))) continue;
    const siblings: Input[] = [];
    after.push(new Input(record, id, siblings));
    if (!(record === 'B' && id === 102 && missing === 'repetition')) after.push(new Input(record, id, siblings));
  }
  let drawn = before;
  s.content.contains = (box: Input) => drawn.includes(box);
  s.content.querySelectorAll = () => drawn;
  s.content.querySelector = (selector: string) => {
    const first = drawn.find((box) => String(box.id) === selector.match(/data-id="(\d+)"/)?.[1]);
    return first ? { querySelectorAll: () => first.siblings } : null;
  };
  s.render = () => {
    s.quietly(() => { s.fieldEvent(field, 'OnObjectExit'); document.activeElement = null; });
    drawn = after;
  };
  let answer!: (runs: unknown[]) => void;
  s.api.groups = () => new Promise((resolve) => { answer = resolve; });
  s.scheduleGroups();
  const pending = s.groupsPending;
  answer([[{ start: 0, count: 2, values: {} }]]);
  await pending;
  await s.fieldTriggers;
  const expected = missing === 'none' ? after.find((box) => box.record === 'B' && box.id === 102 && box.siblings.indexOf(box) === 1)! : null;
  assert.equal(document.activeElement, expected);
  assert.deepEqual(events, [], 'restoration never fires enter or exit triggers');
  for (const input of after) {
    assert.equal(input.value, input === expected ? 'unsaved B' : 'saved');
    if (input !== expected) assert.equal(input.listeners.size, 0, 'another cell must not save B’s draft on blur');
  }
  if (expected) {
    assert.deepEqual([expected.selectionStart, expected.selectionEnd], [2, 6]);
    expected.listeners.get('blur')!();
    assert.deepEqual(events, ['B:change:unsaved B']);
  }
});

test('a delayed found-set portal page repaints its portals without replacing a sibling viewer or draft', async () => {
  const s = display({});
  s.mode = 'browse';
  const portal = { id: 40, name: 'found', kind: 'portal', portal: { tableOccurrence: 'Notes' } };
  const nested = { id: 43, kind: 'portal', portal: { tableOccurrence: 'Notes' } };
  const group = { id: 42, kind: 'group', children: [nested] };
  s.meta.design.objects = [portal, { id: 20, kind: 'web-viewer' }, group,
    { id: 50, name: 'related', kind: 'portal', portal: { tableOccurrence: 'Rows' } }];
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }, { name: 'related', occurrence: 'Rows' }];
  const got = { rows: [], page: 2, asked: new Set(), top: 100 };
  s.foundRows = new Map([['found', got]]);
  s.foundRowsKey = 'current';
  let answer!: (value: unknown) => void;
  const response = new Promise((resolve) => { answer = resolve; });
  s.api.foundSetPortal = () => response;
  const viewer = { hash: '#one', retained: true };
  let shown = viewer;
  let draft = 'unsaved';
  s.renderKeepingTyping = () => { shown = { hash: '', retained: false }; draft = ''; };
  const painted: number[] = [];
  s.repaintObject = (target: { o: { id: number }; path: unknown[] }) => {
    painted.push(target.o.id);
    assert.deepEqual(Array.from(target.path), target.o.id === 43 ? [group] : []);
    assert.equal(s.foundRows.get('found').rows[1].recordId, '2');
  };
  s.fetchFoundRows('found', 1, 1);
  assert.deepEqual(painted, []);
  answer({ count: 3, rows: [{ recordId: '2', modId: '1', Title: 'second' }] });
  await response;
  assert.deepEqual(painted, [40, 43]);
  assert.equal(shown, viewer);
  assert.equal(draft, 'unsaved');
  assert.equal(got.rows.length, 3);
  assert.equal(got.top, 100);
});

for (const transition of ['checkpoint', 'window', 'navigation']) test(`a delayed portal page cannot repaint after ${transition} and leaves unfetched rows retryable`, async () => {
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  const got = { rows: [{ recordId: '1' }], page: 2, asked: new Set([0]), top: 100 };
  got.rows.length = 2;
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  let answer!: (value: unknown) => void;
  const response = new Promise((resolve) => { answer = resolve; });
  s.api.foundSetPortal = () => response;
  s.repaintObject = () => assert.fail('an old portal page must not touch the new display');
  s.fetchFoundRows('found', 1, 1);
  assert.equal(got.asked.has(1), true);
  if (transition === 'checkpoint') s.displayGeneration++;
  else if (transition === 'window') s.front = { id: 'B' };
  else s.clearDisplay();
  answer({ count: 2, rows: [{ recordId: '2' }] });
  await response;
  assert.equal(got.rows.length, 2);
  assert.equal(got.rows[1], undefined);
  assert.equal(got.rows[0].recordId, '1');
  if (transition !== 'navigation') assert.equal(got.asked.has(1), false);
  assert.equal(got.top, 100);
});

for (const checkpoint of ['none', 'same', 'reordered']) test(`a saved cached portal row discarded by unrelated Refresh Object is fetched again without scrolling (${checkpoint} checkpoint)`, async () => {
  const s = display({}, { refreshMatches, checkpointCache });
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }, { id: 20, name: 'unrelated', kind: 'text' }];
  const got = { rows: [{ recordId: '1', Title: 'first' }, { recordId: '2', Title: 'stale' }], page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  let paints = 0;
  s.repaintObject = () => { paints++; };
  s.refetchFoundRow('2');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.offset, 2);
  if (checkpoint !== 'none') {
    s.content.querySelector = () => undefined;
    s.loadMenus = async () => undefined;
    await s.showRun({ actions: [], foundSet: checkpoint === 'same' ? [1, 2] : [2, 1], recordId: 1, mode: 'browse' }, undefined, { reload: false });
  }
  await s.applyRefresh({ step: 'Refresh Object', objectId: 20, repaint: false, refresh: { records: [], states: {} } });
  requests[0].answer({ count: 2, rows: [{ recordId: '2', Title: 'discarded' }] });
  await requests[0].response;
  const saved = () => got.rows.find((row) => row.recordId === '2')!;
  assert.equal(saved().Title, 'stale');
  assert.equal(paints, 0, 'the rejected response cannot repaint');
  assert.equal(requests.length, 2, 'cached positions and moved identities share one contiguous retry');
  assert.equal(requests[1].body.offset, checkpoint === 'reordered' ? 1 : 2);
  assert.equal(requests[1].body.limit, checkpoint === 'reordered' ? 2 : 1);
  for (const request of requests.slice(1)) {
    const rows = got.rows.slice(request.body.offset - 1, request.body.offset - 1 + request.body.limit)
      .map(({ recordId }) => ({ recordId, Title: recordId === '2' ? 'fresh' : 'first' }));
    request.answer({ count: 2, rows });
  }
  await Promise.all(requests.slice(1).map((request) => request.response));
  assert.equal(saved().Title, 'fresh');
  assert.equal(got.rows.find((row) => row.recordId === '1')!.Title, 'first');
  assert.equal(got.top, 100);
  assert.equal(paints, requests.length - 1);
});

test('a saved portal row moved by a checkpoint is retried after another row finishes at its old position', async () => {
  const s = display({}, { checkpointCache });
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.content.querySelector = () => undefined;
  s.loadMenus = async () => undefined;
  const got = { rows: [{ recordId: '1', Title: 'stale A' }, { recordId: '2', Title: 'stale B' }], page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  let paints = 0;
  s.repaintObject = () => { paints++; };
  // A's save starts at position 0; the checkpoint moves it to position 1.
  s.refetchFoundRow('1');
  await s.showRun({ actions: [], foundSet: [2, 1], recordId: 1, mode: 'browse' }, undefined, { reload: false });
  // B takes over A's former position and completes before A's old response arrives.
  s.refetchFoundRow('2');
  requests[1].answer({ count: 2, rows: [{ recordId: '2', Title: 'fresh B' }] });
  await requests[1].response;
  requests[0].answer({ count: 2, rows: [{ recordId: '1', Title: 'discarded A' }] });
  await requests[0].response;
  assert.equal(got.rows[0].Title, 'fresh B');
  assert.equal(got.rows[1].Title, 'stale A');
  assert.equal(paints, 1, 'the response for the old position cannot repaint');
  assert.equal(requests.length, 3, 'A is retried by identity even though its old position has another owner');
  assert.equal(requests[2].body.offset, 2);
  assert.equal(requests[2].body.limit, 1);
  requests[2].answer({ count: 2, rows: [{ recordId: '1', Title: 'fresh A' }] });
  await requests[2].response;
  assert.deepEqual(Array.from(got.rows, (row) => row.Title), ['fresh B', 'fresh A']);
  assert.equal(s.foundRows.get('found').requests.size, 0);
  assert.equal(s.foundRows.get('found').stale.size, 0);
  assert.equal(got.asked.size, 2);
  assert.equal(got.top, 100);
  assert.equal(paints, 2);
});

test('saved rows stay stale through the five-step reorder race with another record pending at their new position', async () => {
  const s = display({}, { checkpointCache });
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.content.querySelector = () => undefined;
  s.loadMenus = async () => undefined;
  s.repaintObject = () => undefined;
  const got = { rows: [{ recordId: '1', Title: 'stale A' }, { recordId: '2', Title: 'stale B' }], page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  // Start B, then A, in [A, B].
  s.refetchFoundRow('2');
  s.refetchFoundRow('1');
  await s.showRun({ actions: [], foundSet: [2, 1], recordId: 1, mode: 'browse' }, undefined, { reload: false });
  requests[1].answer({ count: 2, rows: [{ recordId: '1', Title: 'discarded A' }] });
  await requests[1].response;
  const state = s.foundRows.get('found');
  assert.equal(state.stale.has('1'), true, 'rejecting A cannot discharge its refresh');
  assert.equal(requests.length, 3, 'the pending B request cannot suppress a request for A');
  assert.equal(requests[2].body.offset, 2, 'the retry covers A at its new position');
  assert.equal(requests[2].body.limit, 1);
  // Finish the replacement at its requested position before returning to [A, B].
  requests[2].answer({ count: 2, rows: [{ recordId: '1', Title: 'fresh A' }] });
  await requests[2].response;
  assert.equal(state.stale.has('1'), false);
  assert.equal(state.stale.has('2'), true, 'accepting A cannot discharge B');
  await s.showRun({ actions: [], foundSet: [1, 2], recordId: 1, mode: 'browse' }, undefined, { reload: false });
  requests[0].answer({ count: 2, rows: [{ recordId: '2', Title: 'discarded B' }] });
  await requests[0].response;
  assert.equal(state.stale.has('2'), true);
  assert.equal(requests.length, 4);
  assert.equal(requests[3].body.offset, 2);
  requests[3].answer({ count: 2, rows: [{ recordId: '2', Title: 'fresh B' }] });
  await requests[3].response;
  assert.deepEqual(Array.from(got.rows, (row) => row.Title), ['fresh A', 'fresh B']);
  assert.equal(state.stale.size, 0);
  assert.equal(state.requests.size, 0);
  assert.deepEqual([...got.asked], [0, 1]);
});

test('a rejected cached portal page batches its retry and keeps an existing replacement request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  const rows = Array.from({ length: 60 }, (_, i) => ({ recordId: String(i + 1), Title: 'old' }));
  const got = { rows, page: 60, asked: new Set(), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  s.renderKeepingTyping = s.closePopover = s.focusObject = () => assert.fail('retrying a page cannot change sibling UI');
  let paints = 0;
  s.repaintObject = () => { paints++; };
  s.fetchFoundRows('found', 0, 59);
  s.displayGeneration++;
  requests[0].answer({ count: 60, rows });
  await requests[0].response;
  assert.equal(requests.length, 2, 'sixty cached positions share one replacement request');
  assert.equal(requests[1].body.offset, 1);
  assert.equal(requests[1].body.limit, 60);
  assert.equal(paints, 0);
  s.foundSetScrolled('found', 100, 0, 59);
  assert.equal(requests.length, 2, 'scrolling does not duplicate pending rows');
  // Another save owns its row while the replacement page is still in flight.
  s.refetchFoundRow('60');
  assert.equal(requests.length, 3);
  s.displayGeneration++;
  requests[1].answer({ count: 60, rows });
  await requests[1].response;
  assert.equal(requests.length, 3, 'repeated invalidation backs off without starting another request');
  t.mock.timers.tick(25);
  assert.equal(requests.length, 4);
  assert.equal(requests[3].body.limit, 59, 'the older page must leave the saved row to its newer request');
  requests[3].answer({ count: 60, rows: rows.slice(0, 59) });
  await requests[3].response;
  requests[2].answer({ count: 60, rows: [{ recordId: '60', Title: 'discarded' }] });
  await requests[2].response;
  assert.equal(requests.length, 5, 'the saved row is retried once for the new generation');
  requests[4].answer({ count: 60, rows: [{ recordId: '60', Title: 'saved' }] });
  await requests[4].response;
  assert.equal(got.rows[59].Title, 'saved');
  assert.equal(got.asked.size, 60);
  assert.equal(got.top, 100);
  assert.equal(paints, 2, 'only accepted replies repaint the portal');
});

test('a checkpoint replacement row gets an immediate first retry while the moved row keeps its own backoff', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({}, { checkpointCache });
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.content.querySelector = () => undefined;
  s.loadMenus = async () => undefined;
  const got = { rows: [{ recordId: '1', Title: 'stale A' }, { recordId: '2', Title: 'stale B' }], page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  let paints = 0;
  s.repaintObject = () => { paints++; };
  s.refetchFoundRow('1');
  s.displayGeneration++;
  requests[0].answer({ count: 2, rows: [{ recordId: '1', Title: 'discarded A' }] });
  await requests[0].response;
  assert.equal(requests.length, 2, 'A gets its first retry immediately');
  await s.showRun({ actions: [], foundSet: [2, 1], recordId: 1, mode: 'browse' }, undefined, { reload: false });
  requests[1].answer({ count: 2, rows: [{ recordId: '1', Title: 'discarded A again' }] });
  await requests[1].response;
  assert.equal(requests.length, 3, 'B cannot inherit the backoff of A at its old position');
  assert.equal(requests[2].body.offset, 1);
  assert.equal(requests[2].body.limit, 1);
  s.displayGeneration++;
  requests[2].answer({ count: 2, rows: [{ recordId: '2', Title: 'discarded B' }] });
  await requests[2].response;
  assert.equal(requests.length, 4, 'B gets an immediate first retry even while A is backing off');
  assert.equal(requests[3].body.offset, 1);
  assert.equal(requests[3].body.limit, 1);
  requests[3].answer({ count: 2, rows: [{ recordId: '2', Title: 'fresh B' }] });
  await requests[3].response;
  t.mock.timers.tick(24);
  assert.equal(requests.length, 4);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 5, 'A waits only for its own backoff despite the newer generation');
  assert.equal(requests[4].body.offset, 2);
  assert.equal(requests[4].body.limit, 1);
  requests[4].answer({ count: 2, rows: [{ recordId: '1', Title: 'fresh A' }] });
  await requests[4].response;
  assert.deepEqual(Array.from(got.rows, (row) => row.Title), ['fresh B', 'fresh A']);
  assert.equal(got.top, 100);
  assert.equal(got.asked.size, 2);
  assert.equal(s.foundRows.get('found').requests.size, 0);
  assert.equal(s.foundRows.get('found').stale.size, 0);
  assert.equal(paints, 2);
  t.mock.timers.tick(1000);
  assert.equal(requests.length, 5);
});

test('repeated portal invalidation backs off after the first retry, caps the delay and recovers without scrolling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  const got = { rows: [{ recordId: '1', Title: 'stale' }], page: 1, asked: new Set([0]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  let active = 0;
  s.api.foundSetPortal = () => {
    assert.equal(++active, 1, 'invalidation cannot create concurrent retries');
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = (value) => { active--; resolve(value); }; });
    requests.push({ answer, response });
    return response;
  };
  let paints = 0;
  s.repaintObject = () => { paints++; };
  s.refetchFoundRow('1');
  const delays = Array.from({ length: 100 }, (_, i) => i ? Math.min(250, 25 * 2 ** Math.min(i - 1, 4)) : 0);
  for (const [i, delay] of delays.entries()) {
    s.displayGeneration++;
    requests[i].answer({ count: 1, rows: [{ recordId: '1', Title: 'discarded' }] });
    await requests[i].response;
    assert.equal(got.rows[0].Title, 'stale');
    assert.equal(paints, 0);
    assert.equal(got.asked.has(0), true, 'backoff reserves the retry against scrolling');
    if (delay) {
      assert.equal(requests.length, i + 1);
      s.foundSetScrolled('found', 100, 0, 0);
      assert.equal(requests.length, i + 1);
      t.mock.timers.tick(delay - 1);
      assert.equal(requests.length, i + 1, 'the next retry waits for its backoff');
      t.mock.timers.tick(1);
    }
    assert.equal(requests.length, i + 2, 'the first retry is immediate; subsequent retries respect the delay');
  }
  requests.at(-1)!.answer({ count: 1, rows: [{ recordId: '1', Title: 'fresh' }] });
  await requests.at(-1)!.response;
  assert.equal(got.rows[0].Title, 'fresh');
  assert.equal(paints, 1);
  assert.equal(active, 0);
  assert.equal(s.foundRows.get('found').requests.size, 0);
  assert.equal(s.foundRows.get('found').stale.size, 0);
  s.refetchFoundRow('1');
  s.displayGeneration++;
  requests.at(-1)!.answer({ count: 1, rows: [{ recordId: '1', Title: 'discarded again' }] });
  await requests.at(-1)!.response;
  assert.equal(requests.length, delays.length + 3, 'a new save starts with an immediate first retry');
  requests.at(-1)!.answer({ count: 1, rows: [{ recordId: '1', Title: 'saved again' }] });
  await requests.at(-1)!.response;
  assert.equal(got.rows[0].Title, 'saved again');
  assert.equal(paints, 2);
  t.mock.timers.tick(1000);
  assert.equal(requests.length, delays.length + 3, 'accepted replies leave no autonomous retry loop');
});

for (const transition of ['checkpoint', 'save', 'navigation']) test(`a portal retry waiting for backoff respects a newer ${transition}`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = display({}, { checkpointCache });
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  s.content.querySelector = () => undefined;
  s.loadMenus = async () => undefined;
  const got = { rows: [{ recordId: '1', Title: 'stale A' }, { recordId: '2', Title: 'stale B' }], page: 2, asked: new Set([0, 1]), top: 100 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { body: any; answer: (value: unknown) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = (_layout: string, body: unknown) => {
    let answer!: (value: unknown) => void;
    const response = new Promise((resolve) => { answer = resolve; });
    requests.push({ body, answer, response });
    return response;
  };
  s.repaintObject = () => undefined;
  s.refetchFoundRow('1');
  for (let i = 0; i < 2; i++) {
    s.displayGeneration++;
    requests[i].answer({ count: 2, rows: [{ recordId: '1', Title: 'discarded A' }] });
    await requests[i].response;
  }
  assert.equal(requests.length, 2, 'the second retry waits for backoff');
  if (transition === 'checkpoint') {
    await s.showRun({ actions: [], foundSet: [2, 1], recordId: 1, mode: 'browse' }, undefined, { reload: false });
    s.refetchFoundRow('2');
  } else if (transition === 'save') s.refetchFoundRow('1');
  else s.clearDisplay();
  if (transition !== 'navigation') {
    requests[2].answer({ count: 2, rows: [{ recordId: transition === 'checkpoint' ? '2' : '1', Title: 'newer save' }] });
    await requests[2].response;
  }
  t.mock.timers.tick(25);
  if (transition === 'checkpoint') {
    assert.equal(requests.length, 4, 'the obsolete timer requeues at the new position without another backoff');
    assert.equal(requests[3].body.offset, 2);
    assert.equal(requests[3].body.limit, 1);
    requests[3].answer({ count: 2, rows: [{ recordId: '1', Title: 'fresh A' }] });
    await requests[3].response;
    assert.deepEqual(Array.from(got.rows, (row) => row.Title), ['newer save', 'fresh A']);
  } else if (transition === 'save') assert.equal(got.rows[0].Title, 'newer save');
  else assert.equal(s.foundRows.size, 0);
  t.mock.timers.tick(1000);
  assert.equal(requests.length, transition === 'checkpoint' ? 4 : transition === 'save' ? 3 : 2);
});

for (const outcome of ['resolve', 'empty', 'reject']) test(`an old portal request cannot overwrite or release a saved row after its replacement (${outcome})`, async () => {
  const s = display({});
  s.mode = 'browse';
  s.meta.portals = [{ name: 'found', occurrence: 'Notes', foundSet: true }];
  s.meta.design.objects = [{ id: 40, name: 'found', kind: 'portal' }];
  const got = { rows: [{ recordId: '1', Title: 'old' }], page: 1, asked: new Set([0]), top: 0 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { answer: (value: unknown) => void; fail: (error: Error) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = () => {
    let answer!: (value: unknown) => void, fail!: (error: Error) => void;
    const response = new Promise((resolve, reject) => { answer = resolve; fail = reject; });
    requests.push({ answer, fail, response });
    return response;
  };
  let paints = 0;
  s.repaintObject = () => { paints++; };
  s.refetchFoundRow('1');
  s.refetchFoundRow('1');
  requests[1].answer({ count: 1, rows: [{ recordId: '1', Title: 'saved' }] });
  await requests[1].response;
  if (outcome === 'reject') requests[0].fail(new Error('disconnected'));
  else requests[0].answer(outcome === 'empty' ? { count: 0, rows: [] } : { count: 1, rows: [{ recordId: '1', Title: 'old' }] });
  await requests[0].response.catch(() => undefined);
  assert.equal(got.rows[0].Title, 'saved');
  assert.equal(got.asked.has(0), true);
  assert.equal(requests.length, 2);
  assert.equal(paints, 1);
});

for (const rejection of ['different record', 'network']) test(`a ${rejection} response leaves the requested saved record stale until its own response is accepted`, async () => {
  const s = display({});
  const got = { rows: [{ recordId: '1', Title: 'stale' }], page: 1, asked: new Set([0]), top: 0 };
  s.foundRows.set('found', got);
  s.foundRowsKey = 'current';
  const requests: { answer: (value: unknown) => void; fail: (error: Error) => void; response: Promise<unknown> }[] = [];
  s.api.foundSetPortal = () => {
    let answer!: (value: unknown) => void, fail!: (error: Error) => void;
    const response = new Promise((resolve, reject) => { answer = resolve; fail = reject; });
    requests.push({ answer, fail, response });
    return response;
  };
  s.refetchFoundRow('1');
  if (rejection === 'network') requests[0].fail(new Error('disconnected'));
  else requests[0].answer({ count: 1, rows: [{ recordId: '2', Title: 'wrong record' }] });
  await requests[0].response.catch(() => undefined);
  const state = s.foundRows.get('found');
  assert.equal(state.stale.has('1'), true);
  assert.equal(got.rows[0].Title, 'stale');
  assert.equal(requests.length, 2, 'the first retry is immediate');
  requests[1].answer({ count: 1, rows: [{ recordId: '1', Title: 'fresh' }] });
  await requests[1].response;
  assert.equal(got.rows[0].Title, 'fresh');
  assert.equal(state.stale.size, 0);
  assert.equal(state.requests.size, 0);
});

for (const missing of ['none', 'row', 'object', 'repetition']) test(`portal repaint restores only the same row, field and repetition (missing ${missing})`, async () => {
  const document: { activeElement: Input | null } = { activeElement: null };
  const events: string[] = [];
  const field = (id: number) => ({ id, triggers: ['OnObjectEnter', 'OnObjectExit', 'OnObjectModify', 'OnObjectValidate', 'OnObjectSave'].map((event) => ({ event })) });
  const fields = new Map([101, 102].map((id) => [id, field(id)]));
  let s: any;
  class Input {
    selectionStart = 2;
    selectionEnd = 4;
    id: number;
    row: string;
    siblings: Input[];
    constructor(id: number, row: string, siblings: Input[]) {
      this.id = id;
      this.row = row;
      this.siblings = siblings;
      siblings.push(this);
    }
    closest(selector: string) {
      return selector === '[data-id]' ? { dataset: { id: String(this.id) }, querySelectorAll: () => this.siblings }
        : { dataset: { row: this.row } };
    }
    focus() {
      document.activeElement = this;
      s.fieldEvent(fields.get(this.id), 'OnObjectEnter');
    }
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  }
  s = display({}, { document, HTMLInputElement: Input, HTMLTextAreaElement: class {} });
  s.fieldTriggers = Promise.resolve();
  s.fire = async (event: string) => { events.push(event); return true; };
  const before: Input[] = [];
  new Input(102, 'B', before);
  const active = new Input(102, 'B', before);
  document.activeElement = active;
  const after: Input[] = [];
  for (const row of ['A', 'B']) for (const id of [101, 102]) {
    if (row === 'B' && (missing === 'row' || (id === 102 && missing === 'object'))) continue;
    const siblings: Input[] = [];
    after.push(new Input(id, row, siblings));
    if (!(row === 'B' && id === 102 && missing === 'repetition')) after.push(new Input(id, row, siblings));
  }
  for (const input of after) { input.selectionStart = 0; input.selectionEnd = 0; }
  const scroll = { scrollTop: 100 };
  const old = {
    contains: (input: Input) => before.includes(input), querySelector: () => scroll,
    remove: () => { s.fieldEvent(fields.get(102), 'OnObjectExit'); document.activeElement = null; },
  };
  const fresh = { querySelector: () => scroll, querySelectorAll: () => after };
  const scope = { dataset: { record: '1' }, querySelector: () => old, insertBefore: () => undefined };
  s.cache.set(0, { recordId: '1' });
  s.content.querySelectorAll = () => [scope];
  s.renderer = { parts: [{ top: 0 }], renderObject: () => fresh };
  s.hostFor = () => ({});
  s.styles = s.keepWebViewers = () => undefined;
  s.repaintObject({ o: { id: 40, kind: 'portal', bounds: { top: 0 } }, path: [] });
  await s.fieldTriggers;
  const expected = missing === 'none' ? after.find((input) => input.row === 'B' && input.id === 102 && input.siblings.indexOf(input) === 1)! : null;
  assert.equal(document.activeElement, expected, 'another row, field or repetition must never receive focus');
  if (expected) assert.deepEqual([expected.selectionStart, expected.selectionEnd], [2, 4]);
  assert.deepEqual(events, [], 'removal and restoration do not run field triggers');
  assert.equal(s.quietFocus, false);
  // Subsequent user events still dispatch, including validation before save.
  for (const event of ['OnObjectModify', 'OnObjectSave', 'OnObjectExit', 'OnObjectEnter']) s.fieldEvent(fields.get(102), event);
  await s.fieldTriggers;
  assert.deepEqual(events, ['OnObjectModify', 'OnObjectValidate', 'OnObjectSave', 'OnObjectExit', 'OnObjectEnter']);
});

for (const kind of ['states', 'groups']) test(`a superseded ${kind} completion cannot redraw a viewer or clear its replacement request`, async () => {
  const s = display({}, { SCOPE: 'fm-layout', h: () => ({ style: { setProperty: () => undefined } }), tellPages: () => undefined });
  Object.assign(s, {
    mode: 'browse', view: kind === 'states' ? 'form' : 'list', renderer: {},
    sizeWindow: () => undefined, fitLayout: () => undefined, allows: () => true, noteVisit: () => undefined,
    publishWindow: () => undefined, closePopover: () => undefined, effectiveZoom: () => 1,
    renderForm: () => undefined, renderList: () => undefined, keepWebViewers: () => undefined,
    quietly: (f: () => void) => f(), styles: () => undefined, markRows: () => undefined,
    shown: () => kind === 'states' ? [{ id: '1', number: 1 }] : [], hasFormulas: () => kind === 'states',
  });
  s.content.children = [];
  s.content.append = () => undefined;
  let finish!: () => void;
  const response = new Promise<void>((resolve) => { finish = resolve; });
  s.loadStates = s.loadGroups = () => response;
  s.render();
  const key = kind === 'states' ? 'statesPending' : 'groupsPending';
  const pending = s[key];
  assert.ok(pending);
  s.displayGeneration++;
  s.render = () => assert.fail('old display work must not replace the viewer after navigation or a checkpoint');
  finish();
  await pending;
  assert.equal(s[key], undefined);

  let finishNext!: () => void;
  s.loadStates = s.loadGroups = () => new Promise<void>((resolve) => { finishNext = resolve; });
  // Run the original renderer again to schedule another real completion.
  Object.getPrototypeOf(s).render.call(s);
  const old = s[key];
  s.clearDisplay();
  const replacement = Promise.resolve();
  s[key] = replacement;
  finishNext();
  await old;
  assert.equal(s[key], replacement, 'an obsolete completion cannot clear newer pending work');
});

test('a rejected script thaws all its windows before the next script starts', async () => {
  const failure = new Error('connection closed');
  const s = display({ waiting: { step: 'Checkpoint', run: 'run' }, actions: [{ step: 'Freeze Window', windowId: 'A' }] });
  s.content.setAttribute = s.content.removeAttribute = () => undefined;
  s.showRun = async () => undefined;
  s.api.continueRun = async () => { throw failure; };
  let paints = 0;
  s.renderKeepingTyping = () => { paints++; assert.equal(s.frozenWindows.size, 0); };
  await assert.rejects(s.runButton(undefined), (error) => error === failure);
  assert.equal(s.scripting, false);
  assert.equal(s.frozenWindows.size, 0);
  assert.equal(paints, 1);
  s.api.button = async () => ({ actions: [] });
  await s.runButton(undefined);
  assert.equal(paints, 1, 'the next script does not inherit a deferred thaw');
});

test('restoring a window discards portal requests, formula state and focus from the closed window', () => {
  const s = display({});
  s.activeObjectId = 20;
  s.lastInput = {};
  s.portalRow = {};
  s.focusedField = 'Notes::Title';
  s.states.set('1', { web: { 20: 'old' } });
  s.foundRows.set('found', { rows: [{ recordId: '2' }] });
  s.foundRowsKey = 'old';
  s.statesPending = s.groupsPending = Promise.resolve();
  const panels = new Map([[100, 102]]);
  s.restoreWindow({ cache: new Map(), panels, scroll: 42 });
  assert.equal(s.displayGeneration, 1);
  assert.equal(s.states.size, 0);
  assert.equal(s.foundRows.size, 0);
  assert.equal(s.foundRowsKey, '');
  for (const key of ['activeObjectId', 'lastInput', 'portalRow', 'focusedField', 'statesPending', 'groupsPending']) assert.equal(s[key], undefined, key);
  assert.equal(s.panels, panels);
  assert.equal(s.pendingScroll, 42);
});

test('a late group response cannot repopulate the restored windows summary state', async () => {
  const s = display({});
  s.renderer = {};
  s.breakParts = () => [{ level: 0 }];
  s.sort = [{ fieldName: 'Title' }];
  s.foundCount = 1;
  let finish!: (runs: unknown[]) => void;
  s.api.groups = () => new Promise((resolve) => { finish = resolve; });
  const pending = s.loadGroups();
  s.clearDisplay();
  s.groups = { fields: ['Other'], runs: [] };
  const current = s.groups;
  finish([{ value: 'old' }]);
  await pending;
  assert.equal(s.groups, current);
});

function groupedList() {
  const s = display({}, { SCOPE: 'fm-layout', PAGE: 50, h: () => ({ style: { setProperty: () => undefined } }), tellPages: () => undefined, refreshMatches });
  Object.assign(s, {
    mode: 'browse', view: 'list', renderer: {}, sort: [{ fieldName: 'Title' }], foundCount: 2, index: 0,
    sizeWindow: () => undefined, fitLayout: () => undefined, allows: () => true, noteVisit: () => undefined,
    publishWindow: () => undefined, closePopover: () => undefined, effectiveZoom: () => 1,
    renderList: () => undefined, keepWebViewers: () => undefined, quietly: (f: () => void) => f(),
    styles: () => undefined, markRows: () => undefined, shown: () => [], breakParts: () => [{ level: 0 }],
    loadStates: async () => undefined, select: () => undefined, fire: async () => true,
    conflicts: new Map(), fetch: async () => undefined,
  });
  s.content.children = [];
  s.content.append = () => undefined;
  s.cache.set(0, { recordId: '1' });
  s.cache.set(1, { recordId: '2' });
  const requests: { layout: string; body: any; answer: (value: unknown) => void }[] = [];
  s.api.groups = (layout: string, body: unknown) => new Promise((answer) => { requests.push({ layout, body, answer }); });
  let paints = 0;
  s.renderKeepingTyping = () => { paints++; s.render(); };
  return { s, requests, paints: () => paints };
}

test('empty grouping work cannot redraw a form, reopen a popover or disturb script focus', async () => {
  const { s, requests, paints } = groupedList();
  s.breakParts = () => [];
  s.scheduleGroups();
  const pending = s.groupsPending;
  assert.ok(pending);
  s.view = 'form';
  s.focusObject = s.closePopover = s.render = () => assert.fail('empty grouping work must leave the current display alone');
  await pending;
  assert.equal(s.groups, null);
  assert.equal(s.groupsPending, undefined);
  assert.equal(requests.length, 0);
  assert.equal(paints(), 0);
});

test('replacement grouping starts without repainting a retained viewer, draft or popover', async () => {
  const { s, requests, paints } = groupedList();
  s.scheduleGroups();
  const pending = s.groupsPending;
  s.query = [{ Title: 'fresh*' }];
  s.render = s.focusObject = s.closePopover = () => assert.fail('scheduling replacement groups must not change the current display');
  requests[0].answer([]);
  await pending;
  assert.equal(requests.length, 2);
  assert.equal(paints(), 0);
  assert.ok(s.groupsPending);
  const replacement = s.groupsPending;
  // Switching to a form before completion must leave its viewer, popover and script focus untouched too.
  s.view = 'form';
  requests[1].answer([]);
  await replacement;
  assert.equal(s.groupsPending, undefined);
  assert.equal(requests.length, 2);
  assert.equal(paints(), 0);
});

test('Next Record within the sorted found set retains pending sub-summaries and repaints on completion', async () => {
  const { s, requests, paints } = groupedList();
  s.render();
  const pending = s.groupsPending;
  assert.ok(pending);
  await s.goTo(1);
  assert.equal(s.index, 1);
  assert.equal(s.displayGeneration, 1, 'exercise ordinary navigation through the actual method');
  assert.equal(s.groupsPending, pending);
  const runs = [[{ start: 0, count: 2, values: { Title: 'group' } }]];
  requests[0].answer(runs);
  await pending;
  assert.equal(s.groups.runs, runs);
  assert.equal(s.groupsPending, undefined);
  assert.equal(requests.length, 1, 'record navigation does not invalidate grouping');
  assert.equal(paints(), 1, 'the summaries appear without another user action');
});

test('unrelated Refresh Object retains still-valid pending sub-summaries', async () => {
  const { s, requests, paints } = groupedList();
  s.meta.design.objects = [{ id: 20, name: 'unrelated', kind: 'text' }];
  s.render();
  const pending = s.groupsPending;
  await s.applyRefresh({ step: 'Refresh Object', objectId: 20, repaint: false, refresh: { records: [], states: {} } });
  assert.equal(s.displayGeneration, 1);
  const runs = [[{ start: 0, count: 2, values: {} }]];
  requests[0].answer(runs);
  await pending;
  assert.equal(s.groups.runs, runs);
  assert.equal(requests.length, 1);
  assert.equal(paints(), 1);
});

for (const transition of ['window', 'layout', 'query', 'ids', 'sort', 'count', 'refresh', 'reload']) test(`superseded sub-summaries after ${transition} automatically request replacement groups`, async () => {
  const { s, requests, paints } = groupedList();
  s.render();
  const pending = s.groupsPending;
  if (transition === 'window') s.front = { id: 'B' };
  else if (transition === 'layout') s.meta = { ...s.meta, layout: { name: 'Other', id: 2 } };
  else if (transition === 'query') s.query = [{ Title: 'fresh*' }];
  else if (transition === 'ids') s.ids = [2, 1];
  else if (transition === 'sort') s.sort = [{ fieldName: 'Title', sortOrder: 'descend' }];
  else if (transition === 'count') s.foundCount = 3;
  else if (transition === 'refresh') await s.applyRefresh({ step: 'Refresh Window', refresh: { records: [], states: {} } });
  else await s.reload();
  requests[0].answer([[{ start: 0, count: 2, values: { Title: 'stale' } }]]);
  await pending;
  assert.equal(s.groups, undefined, 'the stale response cannot populate the current summaries');
  assert.equal(requests.length, 2, 'replacement work starts without another user action');
  assert.ok(s.groupsPending);
  assert.notEqual(s.groupsPending, pending);
  assert.equal(requests[1].layout, s.meta.layout.name);
  assert.equal(requests[1].body.query, s.query);
  assert.equal(requests[1].body.ids, s.ids);
  assert.equal(requests[1].body.sort, s.sort);
  const replacement = s.groupsPending;
  const runs = [[{ start: 0, count: s.foundCount, values: { Title: 'fresh' } }]];
  requests[1].answer(runs);
  await replacement;
  assert.equal(s.groups.runs, runs);
  assert.equal(s.groupsPending, undefined);
  assert.equal(paints(), transition === 'refresh' ? 2 : 1, 'scheduling replacement work never redraws');
});

test('an obsolete group completion cannot clear a replacement request or repaint its window', async () => {
  const { s, requests, paints } = groupedList();
  s.render();
  const old = s.groupsPending;
  s.clearDisplay();
  s.groups = undefined;
  s.render();
  const replacement = s.groupsPending;
  requests[0].answer([]);
  await old;
  assert.equal(s.groups, undefined);
  assert.equal(s.groupsPending, replacement);
  assert.equal(paints(), 0);
  const runs = [[{ start: 0, count: 2, values: {} }]];
  requests[1].answer(runs);
  await replacement;
  assert.equal(s.groups.runs, runs);
  assert.equal(paints(), 1);
});

test('closing a background window removes only its freeze and viewer history', () => {
  const s = display({});
  s.frozenWindows = new Set(['A', 'B']);
  const keyA = '["A",1,"1",20,""]';
  const keyB = '["B",1,"1",20,""]';
  s.viewerStates.set(keyA, {});
  s.viewerStates.set(keyB, {});
  let removed = false;
  s.behind = [{ win: { id: 'B' }, backdrop: { remove: () => { removed = true; } } }];
  s.followWindows({ closed: ['B'] });
  assert.equal(removed, true);
  assert.equal(s.behind.length, 0);
  assert.deepEqual([...s.frozenWindows], ['A']);
  assert.deepEqual([...s.viewerStates.keys()], [keyA]);
});

test('script requests include the background windows own layout, full found-set request and current record', async () => {
  for (const ids of [undefined, [7, 2]]) {
    const s = display({ actions: [] });
    s.behind = [{ win: { id: 'B', name: 'B', style: 'document' }, state: {
      meta: { layout: { name: 'Other' } }, cache: new Map([[1, { recordId: '2' }]]), index: 1,
      ids, query: [{ Title: 'record*' }], sort: [{ fieldName: 'Title', sortOrder: 'descend' }],
    } }];
    let asked: any;
    s.api.button = async (_layout: string, body: unknown) => { asked = body; return { actions: [] }; };
    s.showRun = async () => undefined;
    await s.runScriptCall(undefined);
    const background = asked.windows[0];
    assert.equal(background.id, 'B');
    assert.equal(background.layout, 'Other');
    assert.equal(background.recordId, 2);
    assert.equal(background.sort, s.behind[0].state.sort);
    if (ids) assert.equal(background.ids, ids, 'use the entire found set, not just cached positions');
    else assert.equal(background.query, s.behind[0].state.query, 'the server resolves the uncached portion of a query');
  }
});

for (const step of ['Pause', 'Sort']) test(`${step} thaws the script window before repainting, retaining another window's freeze`, async () => {
  const s = display({ waiting: { step, run: 'run' }, window: { id: 'B' }, actions: [{ step: 'Freeze Window', windowId: 'B' }] });
  s.frozenWindows.add('A');
  let paints = 0;
  s.showRun = async (r: { waiting?: unknown; window?: { id: string } }) => {
    if (!r.waiting) return;
    paints++;
    assert.equal(s.frozenWindows.has('B'), false);
    assert.equal(s.frozenWindows.has('A'), true);
    assert.equal(r.window?.id, 'B');
  };
  s.sortFields = () => [];
  s.openSortDialog = (_fields: unknown, _initial: unknown, answer: (v: unknown[]) => void) => answer([]);
  await s.runScriptCall(undefined);
  assert.equal(paints, 1);
});

test('dialog gating uses the script window after Select Window, while the displayed window stays frozen', async () => {
  const s = display({ waiting: { step: 'Dialog', run: 'run' }, window: { id: 'B' }, actions: [{ step: 'Freeze Window', windowId: 'A' }] });
  let shown = false;
  s.showRun = async (r: { waiting?: unknown; window?: { id: string } }) => {
    if (r.waiting) {
      shown = true;
      assert.equal(r.window?.id, 'B');
      assert.equal(s.frozenWindows.has('A'), true);
    }
  };
  await s.runScriptCall(undefined);
  assert.equal(shown, true);
});

test('Resize to Fit replaces card state, clearing omitted dimensions and preserving supplied placement', () => {
  const s = display({});
  s.front = { id: 'card', style: 'card', width: 400, height: 300, top: 25, left: 30 };
  s.followWindows({ window: { id: 'card', style: 'card', top: 25, left: 30 } });
  assert.equal(s.front.width, undefined);
  assert.equal(s.front.height, undefined);
  assert.equal(s.front.top, 25);
  assert.equal(s.front.left, 30);
});

for (const found of ['query', 'ids']) test(`Cancel redraws the restored window before its deleted layout fails to reload with ${found}`, async () => {
  const parent = { id: 'A', name: 'A', style: 'document' };
  const card = { id: 'C', name: 'Card', style: 'card' };
  const s = display({ actions: [], closed: ['C'], window: parent, layout: 'Removed', foundSet: [1], recordId: 1 }, { checkpointCache });
  const meta = { layout: { name: 'Removed', id: 2 }, design: { objects: [] } };
  const record = { recordId: '1', fieldData: { Title: 'parent record' } };
  let removed = false;
  s.windowId = 'A';
  s.front = card;
  s.foundRows = new Map();
  s.content.setAttribute = () => undefined;
  s.content.removeAttribute = () => undefined;
  s.frame = { className: 'window-frame window-card', style: { cssText: 'width: 400px; height: 300px;' } };
  s.behind = [{ win: parent, state: { meta, cache: new Map([[0, record]]), index: 0, panels: new Map(),
    foundCount: 1, scroll: 0, ...(found === 'query' ? { query: [{}] } : { ids: [1] }) },
    backdrop: { remove: () => { removed = true; } } }];
  s.closePopover = () => undefined;
  s.syncWindowChrome = () => undefined;
  let shown: unknown;
  s.render = () => { s.sizeWindow(); shown = s.cache.get(0); };
  const missing = new Error('Layout is missing');
  s.reload = async () => {
    assert.equal(s.meta, meta);
    assert.equal(s.behind.length, 0);
    assert.equal(removed, true);
    assert.equal(s.frame.className, 'window-frame', 'the closed card is gone before fetching the stale layout');
    assert.equal(s.frame.style.cssText, '');
    assert.equal(shown, record, 'the parent is visible even when its next fetch fails');
    throw missing;
  };
  await assert.rejects(s.runButton(undefined), (error) => error === missing);
  assert.equal(s.scripting, false);
});

function objects(s: any) {
  const viewer = { id: 953, name: 'viewer', kind: 'web-viewer' };
  const popover = { id: 960, kind: 'popover', children: [viewer] };
  s.meta.design.objects = [popover, { id: 961, kind: 'popover-button', target: 960 }, { id: 970, name: 'outside', kind: 'field' }];
  return { viewer, popover };
}
for (const last of [{ step: 'Go to Object', objectName: 'outside' }, { step: 'Close Popover' }]) {
  test(`${last.step} supersedes the popover viewer's pending focus`, async () => {
    const s = display({ actions: [{ step: 'Go to Object', objectName: 'viewer' },
      { step: 'Perform JavaScript in Web Viewer', objectName: 'viewer', functionName: 'probe' }, last] });
    objects(s);
    let called = false;
    s.togglePopover = (id: number) => { s.popover = { id }; };
    s.closePopover = () => { s.popover = undefined; };
    s.performJavaScript = async () => { assert.equal(s.popover?.id, 960); called = true; };
    s.showRun = async (_r: unknown, goTo?: string) => {
      assert.equal(s.popover, undefined);
      assert.equal(goTo, last.step === 'Close Popover' ? undefined : 'outside');
    };
    await s.runScriptCall(undefined);
    assert.equal(called, true);
  });
}

for (const frozen of [false, true]) test(`Go to Object retains every ancestor panel${frozen ? ' while frozen and switches its DOM after thaw' : ' in the existing DOM and map'}`, () => {
  const s = display({});
  const { viewer, popover } = objects(s);
  const inner = { id: 200, kind: 'tab-control', children: [{ id: 201, kind: 'tab-panel' }, { id: 202, kind: 'tab-panel', children: [viewer] }] };
  const outer = { id: 100, kind: 'tab-control', children: [{ id: 101, kind: 'tab-panel' }, { id: 102, kind: 'tab-panel', children: [inner] }] };
  popover.children = [outer] as any;
  const controls = new Map([100, 200].map((id) => {
    const panels = [1, 2].map((n) => ({ dataset: { panel: String(id + n) }, hidden: n === 2 }));
    const tabs = [1, 2].map((n) => ({ pressed: String(n === 1), attribute: 'aria-selected', checked: n === 1,
      classList: { toggle(_name: string, value: boolean) { tabs[n - 1].checked = value; }, contains: (name: string) => name === 'fm-tab' },
      // A tab says it is selected (aria-selected); `pressed` records that, whatever the attribute is called.
      setAttribute(name: string, value: string) { if (name === 'aria-selected' || name === 'aria-pressed') { this.pressed = value; this.attribute = name; } } }));
    return [id, { panels, tabs, querySelectorAll: (selector: string) => selector.includes('.fm-panel') ? panels : tabs }];
  }));
  s.content.querySelectorAll = (selector: string) => [controls.get(Number(selector.match(/\d+/)![0]))];
  if (frozen) s.frozenWindows.add('A');
  s.showObject('viewer');
  if (frozen) {
    for (const id of [100, 200]) {
      assert.equal(s.panels.get(id), id + 2, 'pending panel navigation is retained');
      assert.deepEqual(controls.get(id)!.panels.map((p) => p.hidden), [false, true]);
      assert.deepEqual(controls.get(id)!.tabs.map((t) => [t.pressed, t.checked]), [['true', true], ['false', false]]);
    }
    s.frozenWindows.clear();
    s.showObject('viewer');
  }
  for (const id of [100, 200]) {
    assert.equal(s.panels.get(id), id + 2);
    assert.deepEqual(controls.get(id)!.panels.map((p) => p.hidden), [true, false]);
    assert.deepEqual(controls.get(id)!.tabs.map((t) => [t.pressed, t.checked]), [['false', false], ['true', true]]);
    // Tabs are tabs for a screen reader: selected, not pressed.
    assert.deepEqual(controls.get(id)!.tabs.map((t) => t.attribute), ['aria-selected', 'aria-selected']);
  }
});

test('nested popover ancestry opens outer to inner and is not toggled closed when already open', () => {
  const s = display({});
  const { viewer, popover } = objects(s);
  popover.children = [{ id: 962, kind: 'popover-button', target: 963 }, { id: 963, kind: 'popover', children: [viewer] }] as any;
  const opened: number[] = [];
  s.togglePopover = (id: number, button: number) => { opened.push(id); s.popover = { id, button, parent: s.popover }; };
  s.openPopoverOf(s.findObject('viewer'));
  s.openPopoverOf(s.findObject('viewer'));
  assert.deepEqual(opened, [960, 963]);
  assert.equal(s.popover.button, 962);
  assert.equal(s.popover.parent.button, 961);
});

test('a checkpoint without repaint retains the open popover and its viewer DOM', async () => {
  const s = display({});
  objects(s);
  const open = { id: 960, button: 961 };
  s.popover = open;
  s.followWindows = () => undefined;
  s.content.querySelector = () => undefined;
  s.loadMenus = async () => undefined;
  s.closePopover = () => assert.fail('a preserved popover must not close without a repaint');
  s.togglePopover = () => assert.fail('a preserved popover must not open a duplicate DOM');
  await s.showRun({ actions: [], mode: 'browse' }, undefined, { keepPopover: true, reload: false });
  assert.equal(s.popover, open);
});

for (const last of [{ step: 'Go to Object', objectName: 'outside' }, { step: 'Close Popover' }]) {
  test(`a JavaScript checkpoint dispatches to the popover iframe before ${last.step} in the next response`, async () => {
    const frame = {};
    let calls = 0;
    const s = display({ waiting: { step: 'Checkpoint', run: 'run' }, syncVersion: 1, actions: [
      { step: 'Go to Object', objectName: 'viewer' },
      { step: 'Perform JavaScript in Web Viewer', objectName: 'viewer', functionName: 'probe', parameters: [] },
    ] }, { callWebViewer: async (got: unknown, fn: string) => {
      assert.equal(got, frame);
      assert.equal(fn, 'probe');
      assert.equal(s.popover?.id, 960, 'the viewer is open when the call is dispatched');
      calls++;
    } });
    objects(s);
    s.content.querySelector = (selector: string) => selector.includes('iframe') && s.popover ? frame : undefined;
    s.togglePopover = (id: number) => { s.popover = { id }; };
    s.closePopover = () => { s.popover = undefined; };
    s.loadMenus = async () => undefined;
    s.api.continueRun = async () => {
      assert.equal(calls, 1, 'the server continues only after the call');
      return { syncVersion: 1, actions: [last] };
    };
    s.focusObject = (name: string) => assert.equal(name, 'outside', 'final focus must not reopen the viewer');
    await s.runScriptCall(undefined);
    assert.equal(calls, 1);
    assert.equal(s.popover, undefined);
  });
}

test('Close Popover retains pending focus on a field outside the popover', async () => {
  const s = display({ actions: [{ step: 'Go to Object', objectName: 'outside' }, { step: 'Close Popover' }] });
  objects(s);
  s.closePopover = () => { s.popover = undefined; };
  let target: string | undefined;
  s.showRun = async (_r: unknown, goTo?: string) => { target = goTo; };
  await s.runScriptCall(undefined);
  assert.equal(target, 'outside');
});

test('nested popover rendering retains both ancestors and closing collapses both openers', () => {
  const s = display({});
  const { viewer, popover } = objects(s);
  popover.children = [{ id: 962, kind: 'popover-button', target: 963 }, { id: 963, kind: 'popover', children: [viewer] }] as any;
  const buttons = new Map([961, 962].map((id) => [id, { expanded: 'false',
    setAttribute(_name: string, value: string) { this.expanded = value; } }]));
  const rendered: { id: number; removed: boolean }[] = [];
  s.content.querySelector = (selector: string) => {
    if (selector.includes('.fm-part-')) return { append: () => undefined };
    const id = Number(selector.match(/\d+/)?.[0]);
    return selector.includes('button') ? buttons.get(id) : { id };
  };
  s.content.getBoundingClientRect = () => ({ top: 0, bottom: 450 });
  s.styles = () => undefined;
  s.renderer = {
    partOf: () => ({ kind: 'body', top: 0 }),
    renderPopover: (id: number) => {
      const el = { id, removed: false, style: { top: '60px' }, offsetHeight: 100,
        contains: (opener: { id: number }) => id === 960 && opener.id === 962,
        querySelector: () => undefined, setAttribute: () => undefined,
        getBoundingClientRect: () => ({ top: 60, bottom: 160, height: 100 }),
        remove() { this.removed = true; } };
      rendered.push(el);
      return el;
    },
  };
  s.openPopoverOf(s.findObject('viewer'));
  assert.deepEqual(rendered.map((el) => [el.id, el.removed]), [[960, false], [963, false]]);
  assert.equal(s.popover.parent.id, 960);
  assert.deepEqual([...buttons.values()].map((b) => b.expanded), ['true', 'true']);
  s.closePopover();
  assert.equal(s.popover, undefined);
  assert.deepEqual(rendered.map((el) => el.removed), [true, true]);
  assert.deepEqual([...buttons.values()].map((b) => b.expanded), ['false', 'false']);
});

for (const checkpoint of [false, true]) test(`frozen Go to Object keeps the popover until completion${checkpoint ? ' across a JavaScript checkpoint' : ''}`, async () => {
  let dialogs = 0;
  const s = display({ waiting: { step: checkpoint ? 'Checkpoint' : 'Dialog', run: 'run' }, actions: [
    { step: 'Freeze Window', windowId: 'A' }, { step: 'Go to Object', objectName: 'outside' },
    ...(checkpoint ? [{ step: 'Perform JavaScript in Web Viewer', objectName: 'viewer', functionName: 'probe' }] : []),
  ] }, { customDialog: async () => {
    dialogs++;
    assert.equal(s.popover, open, 'the frozen popover remains beneath the dialog');
    assert.equal(s.frozenWindows.has('A'), true);
    return { button: 1 };
  } });
  objects(s);
  const open = { id: 960 };
  s.popover = open;
  s.closePopover = () => { assert.equal(s.frozenWindows.has('A'), false); s.popover = undefined; };
  s.followWindows = () => undefined;
  s.content.querySelector = () => undefined;
  s.reload = async () => undefined;
  s.loadMenus = async () => undefined;
  let focusCalls = 0;
  s.focusObject = (name: string) => { focusCalls++; assert.equal(name, 'outside'); assert.equal(s.frozenWindows.has('A'), false); };
  let calls = 0;
  s.performJavaScript = async () => { calls++; assert.equal(s.popover, open); };
  let checkpoints = 0;
  s.applyRefresh = async () => undefined;
  s.api.continueRun = async () => ++checkpoints === 1
    ? { waiting: { step: 'Checkpoint', run: 'run' }, actions: [{ step: 'Refresh Object', objectId: 970 }] }
    : { waiting: { step: 'Dialog', run: 'run' }, actions: [] };
  await s.runScriptCall(undefined);
  assert.equal(dialogs, 1);
  assert.equal(calls, checkpoint ? 1 : 0);
  assert.equal(focusCalls, 1, 'pending focus survives every frozen checkpoint');
  assert.equal(s.popover, undefined, 'pending navigation closes the popover after thaw');
});

// Install the constructor's actual pointer listener on a session with DOM doubles.
const constructor = session.members.find(ts.isConstructorDeclaration)!;
const pointer = constructor.body!.statements.find((s) => s.getText(parsed).startsWith("this.content.addEventListener('pointerdown'"))!;
const pointerCode = ts.transpileModule(`(function () { ${pointer.getText(parsed)} }).call(display);`,
  { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
for (const target of ['outer', 'inner', 'outside', 'inner opener', 'outer opener']) test(`pointer in ${target} closes only popovers outside its ancestor chain`, () => {
  const s = display({});
  const removed: number[] = [];
  const collapsed: number[] = [];
  const el = (id: number, contains: string) => ({ contains: (t: { name: string }) => t.name === contains, remove: () => removed.push(id) });
  const outer = { id: 960, button: 961, el: el(960, 'outer') };
  const inner = { id: 963, button: 962, el: el(963, 'inner'), parent: outer };
  s.popover = inner;
  s.content.querySelector = (selector: string) => ({ setAttribute: () => collapsed.push(Number(selector.match(/\d+/)![0])) });
  let listener: (event: unknown) => void = () => assert.fail('pointer listener was not installed');
  s.content.addEventListener = (_name: string, fn: typeof listener) => { listener = fn; };
  runInNewContext(pointerCode, { display: s, setTimeout: () => undefined });
  listener({ target: { name: target, closest: (selector: string) => (target === 'inner opener' && selector === '[data-id="962"]') || (target === 'outer opener' && selector === '[data-id="961"]') } });
  const inOuter = target === 'outer' || target === 'outer opener';
  assert.deepEqual(removed, inOuter ? [963] : target === 'outside' ? [963, 960] : []);
  assert.deepEqual(collapsed, inOuter ? [962] : target === 'outside' ? [962, 961] : []);
  assert.equal(s.popover, inOuter ? outer : target === 'outside' ? undefined : inner);
  if (target === 'inner opener') {
    s.togglePopover(963, 962);
    assert.deepEqual(removed, [963]);
    assert.deepEqual(collapsed, [962]);
    assert.equal(s.popover, outer, 'toggling the child closed retains its parent');
  }
});
