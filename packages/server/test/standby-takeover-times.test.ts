import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STANDBY_STATE, STORE_EXT, serve } from '../src/index.ts';
import { createStore, Store } from '../../store/src/index.ts';

for (const times of [{ at: 1e20 }, { at: 'yesterday' }, { at: 0, taken: 1e20 }, { at: 0, taken: 'yesterday' }, null]) {
  test(`takeover tolerates malformed saved timestamps: ${JSON.stringify(times)}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-takeover-times-'));
    let running: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      const path = join(dir, 'Tasks' + STORE_EXT);
      createStore(path);
      const store = new Store(path, 'Tasks');
      let token: string;
      try {
        store.setPassword('svc', 'service-password-1');
        token = store.createApiToken('svc', { label: 'integration' });
      } finally { store.close(); }
      const note = join(dir, STANDBY_STATE);
      writeFileSync(note, JSON.stringify({ primary: 'http://primary.invalid', files: {
        Tasks: times && { run: 'r', seq: 1, wholeAfter: 1, size: 0, mtimeMs: 0, ...times },
      } }));
      const lines: string[] = [];
      running = await serve({ dir, port: 0, watch: false, log: (line) => {
        lines.push(line);
        if (line.startsWith('Tasks:')) assert.ok(existsSync(note), 'keep the note until takeover cleanup finishes');
      } });
      assert.equal(running.host.get('Tasks')!.apiToken(token), undefined);
      assert.equal(existsSync(note), false);
      assert.ok(lines.some((line) => line.startsWith('Tasks:') && line.includes('at an unknown time')));
    } finally {
      if (running) await new Promise<void>((resolve) => running!.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
