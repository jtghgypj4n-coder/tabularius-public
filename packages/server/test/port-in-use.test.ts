// A port another program holds: the server says so plainly, and lets go of the folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';

test('serving on a port that is in use fails with a clear message', async () => {
  const other = createServer();
  await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-port-in-use-'));
  try {
    const port = (other.address() as { port: number }).port;
    await assert.rejects(serve({ dir, port, hostname: '127.0.0.1' }), new RegExp(`port ${port} is in use: another program is already listening on 127\\.0\\.0\\.1:${port}`));
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.pid')), [], 'the folder is not left claimed');
  } finally {
    other.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
