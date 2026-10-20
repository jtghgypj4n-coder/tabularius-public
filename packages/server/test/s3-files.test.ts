import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3 } from '../src/s3.ts';

test('S3 downloads keep the normal umask-derived file permissions', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-s3-mode-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s3 = new S3({ url: 's3://backups/test', accessKey: 'test', secretKey: 'test', fetch: async () => new Response('download') });
  const file = join(dir, 'backup.sqlite');
  await s3.get('backup.sqlite', file);
  assert.equal(statSync(file).mode & 0o777, 0o666 & ~process.umask());
});
