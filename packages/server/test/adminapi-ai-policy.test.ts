import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

test('admin policy toggle round-trip, invalid requests leave policy unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'admin-ai-policy-'));
  createStore(join(dir, 'New.openhbam.sqlite'));
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const call = async (body?: unknown) => {
      const r = await fetch(`${hosted.url}/tabularius/admin/v1/ai-policy/New`, body === undefined ? {} : {
        method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    };
    assert.deepEqual((await call()).body, { on: true });
    for (const on of [false, true]) { assert.deepEqual((await call({ on })).body, { on }); assert.deepEqual((await call()).body, { on }); }
    for (const invalid of [{ on: 'false' }, null, [], { on: 1 }]) assert.equal((await call(invalid)).status, 400);
    assert.deepEqual((await call()).body, { on: true });
  } finally { await new Promise<void>((r) => hosted.server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});
