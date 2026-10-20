import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptStepName, type Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

let dir: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-user-abort-'));
  createStore(join(dir, 'Abort.sqlite'));
  store = new Store(join(dir, 'Abort.sqlite'), 'Abort');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Text', type: 'text' }] }]);
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

/** Runs the script; the person asks to stop it after each of `ms`. */
const run = (source: string, ...ms: number[]) => {
  const userStop = new EventTarget();
  for (const t of ms) setTimeout(() => userStop.dispatchEvent(new Event('stop')), t);
  return runScript(store, {
    id: 9999, name: 'test',
    steps: parseScriptText(source.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
      .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })),
  } as Script, { layout: 'Notes', userStop });
};

/** Fails if a prompt stop does not finish within its original wall-clock budget. */
async function beforeDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test('the person stopping a script halts it at once, even in the middle of a pause', async () => {
  const r = await beforeDeadline(run(`
    Set Variable [ $step ; 1 ]
    Pause/Resume Script [ Duration (seconds): 5 ]
    Set Variable [ $step ; 2 ]
    Exit Script [ Result: "finished" ]
  `, 30), 2000, 'the script did not stop within 2 seconds');
  assert.notEqual(r.result, 'finished');
  assert.ok(r.actions.some((a) => a.step === 'Halt Script' && (a as { reason?: string }).reason === 'canceled by the user'));
});

test('with Allow User Abort off an ask is ignored, and a later one counts once it is back on', async () => {
  const ignored = await run(`
    Allow User Abort [ Off ]
    Pause/Resume Script [ Duration (seconds): .1 ]
    Allow User Abort [ On ]
    Pause/Resume Script [ Duration (seconds): .1 ]
    Exit Script [ Result: "finished" ]
  `, 20);
  // The ask came during the guarded part: forgotten, not saved for later.
  assert.equal(ignored.result, 'finished');
  assert.ok(!ignored.actions.some((a) => a.step === 'Halt Script'));
  const again = await run(`
    Allow User Abort [ Off ]
    Pause/Resume Script [ Duration (seconds): .1 ]
    Allow User Abort [ On ]
    Pause/Resume Script [ Duration (seconds): 5 ]
    Exit Script [ Result: "finished" ]
  `, 20, 200);
  assert.notEqual(again.result, 'finished');
  assert.ok(again.actions.some((a) => (a as { reason?: string }).reason === 'canceled by the user'));
});

test('a long loop is stopped too', async () => {
  const r = await run(`
    Set Variable [ $i ; 0 ]
    Loop
      Set Variable [ $i ; $i + 1 ]
      Exit Loop If [ $i > 10000000 ]
    End Loop
    Exit Script [ Result: "finished" ]
  `, 50);
  assert.notEqual(r.result, 'finished');
  assert.ok(r.actions.some((a) => (a as { reason?: string }).reason === 'canceled by the user'));
});

test('an ask while the script waits on the person (a dialog) is ignored: their answer decides', async () => {
  const userStop = new EventTarget();
  const r = await runScript(store, {
    id: 9999, name: 'test',
    steps: parseScriptText('Show Custom Dialog [ "Go on?" ; "Sure?" ]\nExit Script [ Result: "finished " & Get ( LastMessageChoice ) ]', store.schema)
      .map((s) => ({ stepId: s.stepId!, name: scriptStepName(s.stepId!), enabled: true, params: s.params })),
  } as Script, { layout: 'Notes', userStop, dialog: async () => {
    userStop.dispatchEvent(new Event('stop'));
    return { button: 1 };
  } });
  assert.equal(r.result, 'finished 1');
});
