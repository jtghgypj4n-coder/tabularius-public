import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { addsHistoryEntry, pageTitle, readUrlState, writeAddress, writeUrlState } from '../src/url-state.ts';

// Executes the real Session methods that keep the address and the tab title; the browser, rendering and the server are test doubles.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const session = parsed.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'Session')!;
const compiled = ts.transpileModule(session.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;

function setup(start = '?db=Links&layout=People&record=1&mode=browse&view=form') {
  const location = { pathname: '/app/', search: start, hash: '', reload: () => { reloads++; } };
  let reloads = 0;
  const writes: string[] = [];
  const set = (url: string, how: string) => { writes.push(`${how} ${url}`); const i = url.indexOf('?'); location.search = i < 0 ? '' : url.slice(i); };
  const history = { pushState: (_: unknown, __: string, url: string) => set(url, 'push'), replaceState: (_: unknown, __: string, url: string) => set(url, 'replace') };
  const listeners: Record<string, (() => void)[]> = {};
  const posted: unknown[] = [];
  class Channel { onmessage: unknown; postMessage(m: unknown) { posted.push(m); } }
  const document = { title: 'Typed by a script' };
  const context = {
    location, history, document, readUrlState, writeUrlState, writeAddress, addsHistoryEntry, pageTitle,
    localStorageGet: () => undefined, BroadcastChannel: Channel, addEventListener: () => undefined,
    window: { addEventListener: (type: string, fn: () => void) => { (listeners[type] ??= []).push(fn); } },
    h: (...args: unknown[]) => args, Map, Set, Promise,
  };
  const Session = runInNewContext(compiled + '\nSession', context);
  const s = Object.create(Session.prototype);
  Object.assign(s, {
    api: { db: 'Links' }, meta: { layout: { name: 'People' } }, mode: 'browse', view: 'form', preview: false, foundCount: 6, totalCount: 6, index: 0,
    urlReady: true, scripting: false, restoringUrlState: false, popDuringOpen: false,
    windows: new Map(), windowId: 'w1', windowName: 'Links', menuItems: [{ open: true, name: 'People' }, { open: true, name: 'Orders' }],
    content: { replaceChildren: () => undefined }, render: () => undefined, allows: () => true, reload: async () => undefined,
    commit: async () => true, showMissingRecord: () => undefined, goToLayout: async () => undefined, enterBrowse: async () => undefined, enterFind: async () => undefined, enterPreview: async () => undefined,
  });
  // `record` is derived from the cache in the app; the double lets a test set it.
  let record: { recordId: string } | undefined = { recordId: '1' };
  Object.defineProperty(s, 'record', { get: () => record, set: (v) => { record = v; }, configurable: true });
  return { s, location, history, document, writes, listeners, posted, reloads: () => reloads };
}

test('a person\'s move adds a history entry; a script, an opening file or a restore only replace or write nothing', () => {
  const t = setup();
  t.s.index = 1; t.s.record = { recordId: '2' };
  t.s.writeScreenUrl();
  assert.deepEqual(t.writes, ['push /app/?db=Links&layout=People&record=2&mode=browse&view=form&found=6&total=6']);

  const scripted = setup();
  scripted.s.scripting = true; scripted.s.record = { recordId: '2' };
  scripted.s.writeScreenUrl();
  assert.match(scripted.writes[0], /^replace /, 'a script\'s moves must not flood the history');

  const opening = setup();
  opening.s.urlReady = false; opening.s.record = { recordId: '2' };
  opening.s.writeScreenUrl();
  assert.deepEqual(opening.writes, [], 'the steps of an opening write nothing: an entry would hold a half-drawn screen');
  opening.s.writeScreenUrl(false, true);
  assert.match(opening.writes[0], /^replace /, 'the end of the opening replaces the address, so the first Back leaves the app');

  for (const flag of ['restoringUrlState', 'popDuringOpen']) {
    const quiet = setup();
    quiet.s[flag] = true; quiet.s.record = { recordId: '2' };
    quiet.s.writeScreenUrl();
    assert.deepEqual(quiet.writes, [], `no address write while ${flag}`);
  }
});

test('where pushState throws the address is replaced instead', () => {
  const t = setup();
  t.history.pushState = () => { throw new Error('SecurityError'); };
  t.s.record = { recordId: '2' };
  t.s.writeScreenUrl();
  assert.deepEqual(t.writes, ['replace /app/?db=Links&layout=People&record=2&mode=browse&view=form&found=6&total=6']);
});

test('the tab title shows the layout and record; a script cannot change what Select Window or a window list calls the window', () => {
  const t = setup();
  t.s.index = 2; t.s.record = { recordId: '3' };
  t.s.writeScreenUrl();
  assert.equal(t.document.title, 'Links - People - Record 3');
  t.s.secondary = 2;
  t.s.writeScreenUrl();
  assert.equal(t.document.title, 'Links - People - Record 3 - 2');

  t.s.windowName = 'Links';
  t.s.joinWindows();
  assert.equal(t.s.windows.get('w1').title, 'Links', 'the window list uses the window name, not the tab title');
  assert.deepEqual({ ...(t.posted.at(-1) as object) }, { type: 'here', id: 'w1', title: 'Links', number: 2 });
  assert.equal(t.s.frontWindow().name, 'Links');
});

test('a restore that is refused, fails or is overtaken leaves the address alone; a drawn one writes it once', async () => {
  const drawn = setup('?db=Links&layout=Orders&record=4&mode=browse&view=list');
  let wrote = 0;
  drawn.s.reload = async (id: string) => { drawn.s.record = { recordId: id }; };
  drawn.s.writeScreenUrl = (push: boolean) => { wrote++; assert.equal(push, false); };
  await drawn.s.restoreUrlState();
  assert.equal(wrote, 1);

  const refused = setup('?db=Links&layout=Secret&record=4');
  refused.s.writeScreenUrl = () => { throw new Error('must not write'); };
  await refused.s.restoreUrlState();
  assert.equal(refused.s.restoringUrlState, false);

  const failed = setup('?db=Links&layout=Orders');
  failed.s.writeScreenUrl = () => { throw new Error('must not write'); };
  failed.s.goToLayout = async () => { throw new Error('offline'); };
  await assert.rejects(failed.s.restoreUrlState(), /offline/);
  assert.equal(failed.s.restoringUrlState, false, 'a failed restore must not leave the address frozen');

  const overtaken = setup('?db=Links&layout=Orders');
  overtaken.s.writeScreenUrl = () => { throw new Error('must not write'); };
  overtaken.s.goToLayout = async () => { overtaken.location.search = '?db=Links&layout=People&record=2'; };
  await overtaken.s.restoreUrlState();

  const refusedMode = setup('?db=Links&layout=People&record=2&mode=find&find=1');
  let entered = 0;
  refusedMode.s.enterFind = async () => { entered++; };
  refusedMode.s.writeScreenUrl = () => { throw new Error('must not write'); };
  await refusedMode.s.restoreUrlState();
  assert.equal(entered, 1, 'the mode changes go through the same steps as a person\'s');
  assert.equal(refusedMode.s.mode, 'browse', 'the restore does not force the mode where the step refuses');

  const allowedMode = setup('?db=Links&layout=People&record=2&mode=find&find=1');
  allowedMode.s.enterFind = async () => { allowedMode.s.mode = 'find'; };
  allowedMode.s.reload = async (id: string) => { allowedMode.s.record = { recordId: id }; };
  let wroteAfter = 0;
  allowedMode.s.writeScreenUrl = () => { wroteAfter++; };
  await allowedMode.s.restoreUrlState();
  assert.equal(wroteAfter, 1);
});

test('Back to a record that is gone says so and leaves the address; Back to an every-record entry shows every record again', async () => {
  const gone = setup('?db=Links&layout=People&record=9&mode=browse&view=form&found=6&total=6');
  gone.s.index = 2;
  let missing = 0;
  let rendered = 0;
  gone.s.showMissingRecord = () => { missing++; };
  gone.s.render = () => { rendered++; };
  gone.s.writeScreenUrl = () => { throw new Error('must not write'); };
  await gone.s.restoreUrlState();
  assert.equal(missing, 1);
  assert.equal(rendered, 0, 'the message is not drawn over');
  assert.equal(gone.document.title, 'Links - People - Record 3', 'the title says what is on screen');
  assert.equal(gone.s.index, 2, 'the place the person left is kept');

  const typing = setup('?db=Links&layout=People&record=2&mode=browse&view=form&found=6&total=6');
  const order: string[] = [];
  typing.s.commit = async () => { order.push('commit'); return true; };
  typing.s.reload = async (id: string) => { order.push('reload'); typing.s.record = { recordId: id }; };
  typing.s.writeScreenUrl = () => undefined;
  await typing.s.restoreUrlState();
  assert.deepEqual(order, ['commit', 'reload'], 'an edit is saved to its own record before the screen moves');

  const trigger = setup('?db=Links&layout=People&record=2&mode=browse&view=form&found=6&total=6');
  let guarded: boolean | undefined;
  trigger.s.commit = async () => { guarded = trigger.s.restoringUrlState; return true; };
  trigger.s.reload = async (id: string) => { trigger.s.record = { recordId: id }; };
  trigger.s.writeScreenUrl = () => undefined;
  await trigger.s.restoreUrlState();
  assert.equal(guarded, true, 'a commit trigger\'s script ends while the address is guarded, so it cannot put the old address back');
  assert.equal(trigger.s.restoringUrlState, false);

  const leftAlone = setup('?db=Links&layout=People&record=2&mode=browse&view=form&found=2&total=6');
  leftAlone.s.index = 4; leftAlone.s.record = { recordId: '5' };
  leftAlone.s.reload = async (id: string) => { leftAlone.s.record = { recordId: id }; leftAlone.s.index = 1; };
  leftAlone.s.writeScreenUrl = () => { throw new Error('must not write'); };
  await leftAlone.s.restoreUrlState();
  assert.equal(leftAlone.document.title, 'Links - People - Record 2', 'the title follows the screen when the entry is left alone');

  const refusedLink = setup('?db=Links&layout=Secret&record=4');
  refusedLink.s.writeScreenUrl = () => { throw new Error('must not write'); };
  await refusedLink.s.restoreUrlState();
  assert.equal(refusedLink.document.title, 'Links', 'a refused link does not keep the title of the screen before it');

  const cancelled = setup('?db=Links&layout=People&record=2&mode=browse&view=form&found=6&total=6');
  cancelled.s.commit = async () => false;
  cancelled.s.reload = async () => { throw new Error('must not move'); };
  await cancelled.s.restoreUrlState();
  assert.equal(cancelled.s.restoringUrlState, false);

  const all = setup('?db=Links&layout=People&record=3&mode=browse&view=form&found=6&total=6');
  all.s.foundCount = 1; all.s.query = [{ Name: 'Grace' }]; all.s.ids = ['3'];
  all.s.reload = async (id: string) => { all.s.foundCount = all.s.query || all.s.ids ? 1 : 6; all.s.record = { recordId: id }; };
  let wrote = 0;
  all.s.writeScreenUrl = () => { wrote++; };
  await all.s.restoreUrlState();
  assert.equal(all.s.query, undefined);
  assert.equal(all.s.ids, undefined);
  assert.equal(all.s.foundCount, 6);
  assert.equal(wrote, 1);

  const smaller = setup('?db=Links&layout=People&record=3&mode=browse&view=form&found=2&total=6');
  smaller.s.foundCount = 1; smaller.s.ids = ['3'];
  smaller.s.reload = async (id: string) => { smaller.s.record = { recordId: id }; };
  smaller.s.writeScreenUrl = () => { throw new Error('a smaller set cannot be rebuilt; the entry keeps what it says'); };
  await smaller.s.restoreUrlState();
  assert.deepEqual(smaller.s.ids, ['3']);
});

test('Back pressed while the file opens waits for the opening, then restores in order', async () => {
  const t = setup();
  t.s.urlReady = false;
  t.s.urlRestores = new Promise<void>((resolve) => { t.s.openDone = resolve; });
  const order: string[] = [];
  let finish!: () => void;
  t.s.openFile = () => new Promise<void>((resolve) => { finish = resolve; });
  t.s.restoreUrlState = async () => { order.push(`restore ${t.s.popDuringOpen}`); };
  const opening = t.s.open();
  assert.equal(t.listeners.popstate.length, 1, 'popstate is heard from the start of the opening');
  t.listeners.popstate[0]();
  t.listeners.popstate[0]();
  assert.equal(t.s.popDuringOpen, true, 'the opening must not write over the address Back moved');
  await Promise.resolve();
  assert.deepEqual(order, [], 'no restore starts before the file has opened');
  finish();
  await opening;
  await t.s.urlRestores;
  assert.equal(order.length, 2);
});

test('a script that moves through records leaves one history entry, so Back returns to where it started', async () => {
  const t = setup();
  t.s.content = { setAttribute: () => undefined, removeAttribute: () => undefined };
  t.s.frozenWindows = new Set();
  t.s.runScriptCall = async () => {
    for (const id of ['2', '3', '4']) { t.s.record = { recordId: id }; t.s.writeScreenUrl(); }
    return {};
  };
  await t.s.runButton(undefined);
  assert.deepEqual(t.writes.map((w) => w.split(' ')[0]), ['replace', 'replace', 'replace', 'replace', 'push']);
  assert.match(t.writes[3], /record=1&/, 'the entry before the script is put back');
  assert.match(t.writes[4], /record=4&/, 'and the script\'s result is the one new entry');
});

test('a script that moves the screen without writing the address (as a script run applies its result) still leaves its end state and one entry', async () => {
  const t = setup();
  t.s.content = { setAttribute: () => undefined, removeAttribute: () => undefined };
  t.s.frozenWindows = new Set();
  t.s.runScriptCall = async () => { t.s.record = { recordId: '5' }; t.s.index = 4; return {}; };
  await t.s.runButton(undefined);
  assert.deepEqual(t.writes.map((w) => w.split(' ')[0]), ['replace', 'replace', 'push']);
  assert.match(t.writes[2], /record=5&/);
  assert.equal(t.document.title, 'Links - People - Record 5');
});

test('Back pressed while a script runs waits for the script to end and the script does not write over it', async () => {
  const t = setup();
  t.s.content = { setAttribute: () => undefined, removeAttribute: () => undefined };
  t.s.frozenWindows = new Set();
  t.s.openFile = async () => undefined;
  t.s.urlRestores = new Promise<void>((resolve) => { t.s.openDone = resolve; });
  t.s.scriptEnded = Promise.resolve();
  await t.s.open();
  let release!: () => void;
  t.s.runScriptCall = () => new Promise((resolve) => { release = () => { t.s.record = { recordId: '5' }; resolve({}); }; });
  let restores = 0;
  t.s.restoreUrlState = async () => { restores++; };
  const run = t.s.runButton(undefined);
  await Promise.resolve();
  t.location.search = '?db=Links&layout=People&record=1&mode=browse&view=form'; // the browser moved to the Back target
  t.listeners.popstate[0]();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(restores, 0, 'no restore while the script runs');
  release();
  await run;
  assert.deepEqual(t.writes, [], 'the script end leaves the address the browser moved');
  await t.s.urlRestores;
  assert.equal(restores, 1);
});

test('an unavailable link ends the opening early but later moves still add history entries', async () => {
  const t = setup();
  t.s.urlReady = false;
  t.s.urlRestores = new Promise<void>((resolve) => { t.s.openDone = resolve; });
  t.s.openFile = async () => undefined; // returns without reaching its own urlReady = true
  await t.s.open();
  assert.equal(t.s.urlReady, true);
  t.s.record = { recordId: '2' };
  t.s.writeScreenUrl();
  assert.match(t.writes[0], /^push /);
});
