// The first building-guide set is deliberately ten separate, task-sized pages. Keep each page in the docs menu and
// keep its task, steps, runnable example, after-checks and references visible to a reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fences, root } from './docs-examples.ts';

const guides = [
  'docs/guides/building/tables-and-fields.md',
  'docs/guides/building/relationships.md',
  'docs/guides/building/layouts-and-web-client.md',
  'docs/guides/building/calculations.md',
  'docs/guides/building/scripts-and-triggers.md',
  'docs/guides/building/value-lists.md',
  'docs/guides/building/containers.md',
  'docs/guides/building/custom-functions.md',
  'docs/guides/building/debugger-and-design-history.md',
  'docs/guides/building/starter-solutions.md',
];

test('building guides are listed and each has the task, steps, runnable example, checks and references', () => {
  const contents = JSON.parse(readFileSync(join(root, 'docs/contents.json'), 'utf8')) as { sections: { pages: string[] }[] };
  const listed = contents.sections.flatMap((section) => section.pages);
  for (const guide of guides) {
    const text = readFileSync(join(root, guide), 'utf8');
    assert.equal(listed.filter((page) => page === guide).length, 1, `${guide} must appear once in docs/contents.json`);
    assert.match(text, /^# .+/m, `${guide} needs a title`);
    assert.match(text, /^1\. /m, `${guide} needs numbered steps`);
    assert.match(text, /^## Worked example$/m, `${guide} needs a worked example`);
    assert.match(text, /^## Check afterwards$/m, `${guide} needs a post-task check`);
    assert.match(text, /\]\([^)]*\)/, `${guide} needs links to reference or known differences`);
    const examples = fences(guide).filter((block) => block.lang === 'sh');
    assert.ok(examples.length > 0, `${guide} needs a shell example`);
    assert.ok(examples.every((block) => block.mark === 'run'), `${guide} examples must be marked runnable`);
  }
  assert.equal(guides.length, 10);
});
