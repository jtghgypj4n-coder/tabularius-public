import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerFiles } from '../src/containers.ts';

test('a worker slot retries after its five minute failure cool-down', () => {
  let attempts = 0;
  const files = new ContainerFiles({ createWorker: () => { attempts++; throw new Error('worker unavailable'); } });
  const internals = files as unknown as { ensureWorker(slot: number): unknown; workerRetryAt: number[] };
  try {
    for (let i = 0; i < 3; i++) {
      internals.workerRetryAt[0] = 0;
      assert.equal(internals.ensureWorker(0), undefined);
    }
    assert.equal(attempts, 3);
    assert.ok(internals.workerRetryAt[0]! > performance.now());
    internals.workerRetryAt[0] = performance.now() - 1; // elapse the configured cool-down
    assert.equal(internals.ensureWorker(0), undefined);
    assert.equal(attempts, 4);
  } finally {
    files.stop();
  }
});
