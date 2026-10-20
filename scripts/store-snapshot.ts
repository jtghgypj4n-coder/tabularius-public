// Writes packages/store/test/snapshots/store-<date>.sql: a store as this build makes it, kept so
// later builds are tested against stores an older build wrote (see forward-compat.test.ts).
//   npm run store:snapshot            writes today's snapshot
// Never edit a snapshot after it is committed; add a new one when the format changes.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSampleStore, dumpStore } from '../packages/store/test/snapshots/sample-store.ts';

const dir = mkdtempSync(join(tmpdir(), 'tabularius-snapshot-'));
try {
  const path = join(dir, 'Sample.sqlite');
  buildSampleStore(path);
  const out = join(import.meta.dirname, '..', 'packages', 'store', 'test', 'snapshots', `store-${new Date().toISOString().slice(0, 10)}.sql`);
  writeFileSync(out, dumpStore(path));
  console.log(`wrote ${out}`);
} finally {
  rmSync(dir, { recursive: true });
}
