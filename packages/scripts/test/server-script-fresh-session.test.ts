// A script run with Perform Script on Server starts with a fresh session on the file's open layout: none of the caller's
// windows, found set, record or local variables, even when the caller's run was seeded from the person's browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '@tabularius/store';
import { runScript } from '../src/index.ts';

test('a server script sees none of the caller\'s windows, found set or local variables', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-psos-fresh-'));
  createStore(join(dir, 'F.sqlite'));
  const store = new Store(join(dir, 'F.sqlite'), 'F');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
    const ids = ['a', 'b', 'c'].map((Name) => store.create('Items', { Name }).recordId);
    store.applyDesign([
      { op: 'createScript', name: 'Report', text: 'Exit Script [ Text Result: Get ( FoundCount ) & "|" & Get ( WindowNames ) & "|" & $x & "|" & Get ( WindowName ) ]' },
      { op: 'createScript', name: 'Ask', text: 'Perform Script on Server [ Specified: By name ; "Report" ; Wait for completion: On ]\nExit Script [ Text Result: Get ( ScriptResult ) ]' },
    ]);
    const front = { id: 'A', name: 'Front', layout: 'Items' };
    const side = { id: 'B', name: 'Side', layout: 'Items', foundSet: ids.slice(0, 2), recordId: ids[1] };
    const r = await runScript(store, 'Ask', {
      layout: 'Items', foundSet: ids.slice(0, 2), recordId: ids[0], variables: { $x: 'mine' }, startWindow: front, openWindows: [side, front],
    });
    assert.equal(r.error, 0);
    // All three records, no $x, and the file's own window rather than the caller's "Front".
    assert.equal(r.result, '3|||F');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a server script cannot reach the caller\'s device, clipboard, window or downloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-psos-fresh-'));
  createStore(join(dir, 'F.sqlite'));
  const store = new Store(join(dir, 'F.sqlite'), 'F');
  const documents = join(dir, 'documents');
  mkdirSync(documents);
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }, { name: 'Note', type: 'text' }] }]);
    store.create('Items', { Name: 'a' });
    store.applyDesign([
      { op: 'createScript', name: 'Report', text: [
        'Set Error Capture [ On ]',
        'Set Variable [ $width ; Value: Get ( WindowWidth ) ]',
        'Set Variable [ $where ; Value: Location ( 10 ; 60 ) ]',
        'Paste [ Select ; Items::Note ]',
        'Insert from Device [ Items::Name ; Camera ]',
        'Set Variable [ $device ; Value: Get ( LastError ) ]',
        'Export Field Contents [ Items::Name ; "out.txt" ]',
        'Exit Script [ Text Result: $width & "/" & $where & "|" & Items::Note & "|" & $device ]',
      ].join('\n') },
      { op: 'createScript', name: 'Ask', text: 'Perform Script on Server [ Specified: By name ; "Report" ; Wait for completion: On ]\nExit Script [ Text Result: Get ( ScriptResult ) ]' },
    ]);
    const asked: string[] = [];
    const window = { device: 1, width: 1234, height: 800, contentWidth: 1234, contentHeight: 800, screenWidth: 1600, screenHeight: 900, scale: 1, orientation: 1 };
    const r = await runScript(store, 'Ask', {
      layout: 'Items', window, documents, downloads: true,
      location: async () => { asked.push('location'); return { latitude: 1, longitude: 2 } as never; },
      clipboard: async () => { asked.push('clipboard'); return 'CLIPBOARD-SECRET'; },
      device: async () => { asked.push('device'); return { text: 'device' }; },
      checkpoint: async () => { asked.push('checkpoint'); },
    });
    assert.equal(r.error, 0);
    assert.deepEqual(asked, [], 'no hook of the caller\'s client was asked');
    assert.doesNotMatch(String(r.result), /1234|CLIPBOARD-SECRET/);
    // The export went to the server's Documents folder, not to the caller's browser.
    assert.ok(existsSync(join(documents, 'out.txt')));
    assert.deepEqual(r.actions.filter((a) => 'download' in a), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
