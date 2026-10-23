import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { createStore, Store, type Privileges } from '../../store/src/index.ts';
import { WebClient } from '../src/webclient.ts';
import type { DataApi, Session } from '../src/dataapi.ts';
import type { Host } from '../src/host.ts';

test('Stop lets a backpressured export finish cleanup without drain or socket close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-stop-'));
  const path = join(dir, 'Scale.sqlite');
  createStore(path);
  const store = new Store(path, 'Scale');
  const events = new EventEmitter();
  const response = Object.assign(events, {
    destroyed: false,
    headersSent: false,
    ended: false,
    writes: 0,
    writeHead(_status: number) { this.headersSent = true; return this; },
    write(_chunk: string) { this.writes++; return false; },
    end() { this.ended = true; return this; },
    destroy() { this.destroyed = true; events.emit('close'); return this; },
  });
  let run: Promise<void> | undefined;
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    store.sql.prepare('INSERT INTO Items (Name) VALUES (?)').run('Synthetic row');
    const client = new WebClient({} as Host, { endListeners: new Set() } as unknown as DataApi);
    const internal = client as unknown as {
      streamExportRecords: (store: Store, session: Session, layout: string, body: Record<string, unknown>, privileges: Privileges, res: ServerResponse) => Promise<void>;
      running: Map<string, Set<EventTarget>>;
      runningProgress: Map<EventTarget, unknown>;
    };
    run = internal.streamExportRecords(store, { token: 'test-token' } as Session, 'Items', { fields: ['Name'], format: 'csv' }, store.privileges('Admin'), response as unknown as ServerResponse);
    assert.equal(response.writes, 1, 'the export is waiting for drain');
    assert.equal(response.listenerCount('drain'), 1);
    const key = 'test-token\u0000Scale';
    const active = [...internal.running.get(key)!][0];
    assert.ok(active, 'the running export is registered for Stop');
    active.dispatchEvent(new Event('stop'));
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; response.destroy(); }, 5_000);
    try {
      await run;
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(timedOut, false, 'Stop must release backpressure without waiting for socket close');
    assert.equal(response.destroyed, true, 'Stop closes the unfinished response');
    assert.equal(response.ended, false, 'Stop does not finish a partial export');
    assert.equal(response.listenerCount('drain'), 0, 'the pending write removes its drain listener');
    assert.equal(response.listenerCount('close'), 0, 'cleanup removes close listeners');
    assert.equal(internal.running.has(key), false, 'the run is unregistered');
    assert.equal(internal.runningProgress.size, 0, 'progress is cleared');
  } finally {
    response.destroy();
    await run;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
