// The admin console puts a record back as it was at a point in its history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';

test('POST /tabularius/admin/v1/records/restore puts a record back and logs who did it', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-restore-admin-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, log: () => {} });
  try {
    const store = s.host.get('Charts')!;
    const { recordId } = store.create('Congress', { Name: 'Ann Example', State: 'Oregon' });
    store.update('Congress', recordId, { State: 'Utah' });
    const seq = store.auditLog({ table: 'Congress', recordId })[0].seq;
    const post = (body: unknown) => fetch(`${s.url}/tabularius/admin/v1/records/restore`, { method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const r = await post({ database: 'Charts', table: 'Congress', recordId, seq });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { action: 'updated', fields: ['State'] });
    assert.equal(store.get('Congress', recordId).fieldData.State, 'Oregon');
    assert.equal(store.auditLog({ table: 'Congress', recordId }).at(-1)!.account, 'admin console');

    assert.equal((await post({ database: 'Charts', table: 'Nope', recordId, seq })).status, 400);
    assert.equal((await post({ database: 'Charts' })).status, 400);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
