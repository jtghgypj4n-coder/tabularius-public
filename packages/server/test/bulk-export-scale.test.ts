import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore } from '../../store/src/index.ts';
import * as trace from '../../store/src/trace.ts';

test('20,000 row CSV and XML exports stream with bounded RSS, statements and no WAL growth', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-export-scale-'));
  const path = join(dir, 'Scale' + STORE_EXT);
  createStore(path);
  process.env.TABULARIUS_COUNT_SQL = '1';
  let server: Server | undefined;
  try {
    const hosted = await serve({ dir, port: 0, watch: false, log: () => {} });
    server = hosted.server;
    const store = hosted.host.get('Scale')!;
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    store.sql.exec('BEGIN');
    const insert = store.sql.prepare('INSERT INTO Items (Name) VALUES (?)');
    for (let i = 0; i < 20_000; i++) insert.run(`Synthetic ${String(i).padStart(5, '0')}`);
    store.sql.exec('COMMIT');
    store.checkpoint();
    store.setPassword('Admin', 'pw', '[Full Access]');
    const login = await fetch(`${hosted.url}/fmi/data/vLatest/databases/Scale/sessions`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json' }, body: '{}',
    });
    const token = (await login.json()).response.token as string;
    const wal = () => existsSync(path + '-wal') ? statSync(path + '-wal').size : 0;
    const before = { statements: trace.statements, rows: trace.rowsWritten, rss: process.memoryUsage().rss, wal: wal() };
    for (const format of ['csv', 'xml']) {
      const r = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/layouts/Items/export`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: ['Name'], format, name: 'items' }),
      });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-length'), null, 'the server did not buffer the whole file');
      const body = await r.text();
      if (format === 'csv') {
        assert.equal(body.split('\r\n').length - 1, 20_000);
        assert.ok(body.startsWith('"Synthetic 00000"\r\n'));
        assert.ok(body.endsWith('"Synthetic 19999"\r\n'));
      } else {
        assert.match(body, /<RESULTSET FOUND="20000">/);
        assert.equal(body.split('<ROW MODID=').length - 1, 20_000);
        assert.ok(body.endsWith('</RESULTSET></FMPXMLRESULT>'));
      }
    }
    const used = { statements: trace.statements - before.statements, rowsWritten: trace.rowsWritten - before.rows,
      rss: Math.max(0, process.memoryUsage().rss - before.rss), walGrowth: Math.max(0, wal() - before.wal) };
    assert.ok(used.statements < 120_000, JSON.stringify(used));
    assert.ok(used.rowsWritten < 1_000, JSON.stringify(used));
    assert.ok(used.rss < 192 * 1024 * 1024, JSON.stringify(used));
    assert.ok(used.walGrowth < 16 * 1024 * 1024, JSON.stringify(used));
    t.diagnostic(JSON.stringify(used));

    const stoppedExport = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/layouts/Items/export`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: ['Name'], format: 'xml' }),
    });
    assert.equal(stoppedExport.status, 200);
    let active = false;
    for (let i = 0; i < 50 && !active; i++) {
      const r = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/runs/progress`, { headers: { authorization: `Bearer ${token}` } });
      active = (await r.json()).runs.some((run: { operation: string }) => run.operation === 'Export Records');
      if (!active) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(active, true);
    const stop = await fetch(`${hosted.url}/tabularius/app/v1/databases/Scale/runs/stop`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    });
    assert.equal((await stop.json()).stopped, 1);
    const partial = await stoppedExport.text().catch(() => '');
    assert.ok(!partial.endsWith('</RESULTSET></FMPXMLRESULT>'), 'Stop must not finish the export');
  } finally {
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
    delete process.env.TABULARIUS_COUNT_SQL;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
