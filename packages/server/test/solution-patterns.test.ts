// Runs every pattern's script and Data API checks (packages/server/test/patterns) and holds each outcome to the result the
// pattern declares. docs/solution-patterns.md is written from the declarations (npm run docs:patterns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { solutionPatternsPage } from '../../../scripts/solution-patterns.ts';
import { PATTERNS } from './patterns/index.ts';
import { SURFACES, SURFACE_NAMES, Workbench } from './patterns/framework.ts';

for (const pattern of PATTERNS) {
  for (const surface of SURFACES) {
    const check = pattern[surface];
    if (!check || !('run' in check)) continue;
    test(`${pattern.title}: ${SURFACE_NAMES[surface]} comes out ${check.expected}`, async () => {
      const t = new Workbench();
      try {
        const outcome = (await check.run(t)) ?? { status: 'pass' as const };
        assert.equal(outcome.status, check.expected, outcome.note);
        if (check.expected !== 'pass') assert.ok(check.note, 'a result other than pass says why');
      } finally {
        await t.close();
      }
    });
  }
}

test('docs/solution-patterns.md is the page the declarations make', () => {
  assert.equal(readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'solution-patterns.md'), 'utf8'), solutionPatternsPage(), 'run npm run docs:patterns');
});

test('every pattern has an id nobody else has, a title, Claris pages, and at least one check', () => {
  assert.equal(new Set(PATTERNS.map((p) => p.id)).size, PATTERNS.length);
  for (const p of PATTERNS) {
    assert.ok(p.title && p.what && p.claris.length, p.id);
    assert.ok(SURFACES.some((s) => p[s]), `${p.id} has a check`);
    for (const s of SURFACES) if (p[s] && p[s]!.expected !== 'pass') assert.ok(p[s]!.note, `${p.id}/${s} says why it is not a pass`);
  }
});
