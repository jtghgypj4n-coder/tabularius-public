import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentLibrary } from '../src/component-library.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

test('two library instances keep each other’s additions when saving', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-library-race-'));
  try {
    const a = new ComponentLibrary(dir);
    const b = new ComponentLibrary(dir);
    a.list();
    b.list();
    const input = (name: string, from: string) => ({ name, width: 10, height: 10, objects: [{ id: 1 } as LayoutObject], images: {}, from });
    a.save(input('One', 'Sales'));
    b.save(input('Two', 'Stock'));
    assert.deepEqual(new ComponentLibrary(dir).list().map((entry) => entry.name).sort(), ['One', 'Two']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
