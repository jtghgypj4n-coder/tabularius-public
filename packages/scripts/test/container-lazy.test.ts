// Scripts read a container field's file only when something needs its bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, ScriptSession } from '../src/index.ts';

test('a script names a big file without reading it, and reads it once to copy it or encode it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-script-container-'));
  const path = join(dir, 'Media.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Media');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Clip', fields: [{ name: 'File', type: 'container' }, { name: 'Copy', type: 'container' }, { name: 'Gone', type: 'container' }] }] as never);
    const id = Number(store.create('Clip', {}).recordId);
    const video = Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42'), Buffer.alloc(2 << 20, 7)]);
    store.setContainer('Clip', id, 'File', 1, { filename: 'clip.mp4', mime: 'video/mp4', data: new Uint8Array(video) });
    // A file stored outside that isn't there.
    const sql = (store as unknown as { sql: DatabaseSync }).sql;
    sql.prepare("INSERT INTO _fm_containers (id, filename, mime, kind, data, external) VALUES (900, 'gone.pdf', 'application/pdf', 'file', x'', 'Clip/gone.pdf')").run();
    sql.prepare('UPDATE Clip SET Gone = 900 WHERE ROWID = ?').run(id);

    const reads: number[] = [];
    const container = store.container.bind(store);
    store.container = (cid: number) => (reads.push(cid), container(cid));
    const session = new ScriptSession();
    const run = async (text: string) => {
      const steps = parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: true, params: s.params }));
      return (await runScript(store, { id: 9999, name: 'test', steps } as Script, { layout: 'Clip', foundSet: [id], recordId: id, session })).result;
    };

    assert.equal(await run('Exit Script [ Text Result: GetAsText ( Clip::File ) & "|" & GetContainerAttribute ( Clip::File ; "fileSize" ) & "|" & GetWidth ( Clip::File ) ]'), `clip.mp4|${video.length}|0`);
    assert.equal(reads.length, 0, 'naming and sizing a file reads none of it');

    await run('Set Field [ Clip::Copy ; Clip::File ]\nCommit Records/Requests [ With dialog: Off ]');
    assert.equal(reads.length, 1);
    assert.deepEqual(Buffer.from(container(store.containerId('Clip', id, 'Copy')!)!.data), video, 'Set Field copies every byte');

    // A missing file encodes as nothing, not as its name.
    assert.equal(await run('Exit Script [ Text Result: Base64Encode ( Clip::Gone ) & "|" & VerifyContainer ( Clip::Gone ) ]'), '|0');
    // ...and copies as an empty file of its name, as before, rather than failing.
    assert.equal(await run('Set Error Capture [ On ]\nSet Field [ Clip::Copy ; Clip::Gone ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( LastError ) & "|" & GetAsText ( Clip::Copy ) ]'), '0|gone.pdf');

    // A global variable keeps the file's bytes, though the file it came from is gone before it is used.
    await run('Set Variable [ $$clip ; Value: Clip::File ]');
    sql.prepare('DELETE FROM _fm_containers WHERE id = ?').run(store.containerId('Clip', id, 'File')!);
    assert.equal(await run('Exit Script [ Text Result: GetContainerAttribute ( $$clip ; "fileSize" ) & "|" & Length ( Base64Encode ( $$clip ) ) ]'), `${video.length}|${Buffer.from(video).toString('base64').replace(/(.{76})(?=.)/g, '$1\r').length}`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
