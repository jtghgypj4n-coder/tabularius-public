// Guides and examples must be discoverable from the main README through the indexes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

test('every guide and example is reachable from the README or its indexes', () => {
  const indexes = ['README.md', 'docs/README.md', 'examples/README.md'];
  const pages = ['docs', 'docs/tutorials', 'docs/reference', 'docs/research'].flatMap((dir) =>
    readdirSync(join(root, dir)).filter((name) => name.endsWith('.md')).map((name) => `${dir}/${name}`));
  const examples = readdirSync(join(root, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, 'examples', entry.name, 'README.md')))
    .map((entry) => `examples/${entry.name}/README.md`);
  const plugins = readdirSync(join(root, 'examples/plugins'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => `examples/plugins/${entry.name}`);
  const reachable = new Set<string>(['README.md']);
  const pending = ['README.md'];
  while (pending.length) {
    const source = pending.pop()!;
    if (!existsSync(join(root, source))) continue;
    const markdown = readFileSync(join(root, source), 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
    for (const match of markdown.matchAll(/(?<!!)\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
      const target = resolve(root, dirname(source), decodeURIComponent(href.split(/[?#]/)[0]));
      const paths = [relative(root, target)];
      if (existsSync(join(target, 'README.md'))) paths.push(relative(root, join(target, 'README.md')));
      for (const path of paths) {
        if (reachable.has(path)) continue;
        reachable.add(path);
        if (indexes.includes(path)) pending.push(path);
      }
    }
  }
  const unreachable = [...new Set([...indexes, ...pages, ...examples, ...plugins])]
    .filter((path) => !reachable.has(path)).sort();
  assert.deepEqual(unreachable, [], `Unreachable documentation and examples:\n${unreachable.join('\n')}`);
});
