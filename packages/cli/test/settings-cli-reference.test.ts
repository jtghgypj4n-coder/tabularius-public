import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from './cli-run.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages/cli/src/main.ts');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/reference/settings-cli-metadata.json'), 'utf8')) as {
  intro: string;
  clientExampleNote: string;
  environment: Record<string, { default: string; accepted: string; restart: string; explainedBy: string }>;
  serveFlags: Record<string, { default: string; accepted: string; explainedBy: string }>;
  commands: Record<string, { example: string; exitCodes: string }>;
};

test('generated settings and CLI pages cover the current metadata and are current', () => {
  const result = spawnSync(process.execPath, ['--no-warnings', 'scripts/docs-settings-cli.ts', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.includes(`${Object.keys(manifest.environment).length} variables, ${Object.keys(manifest.serveFlags).length} serve flags, ${Object.keys(manifest.commands).length} commands`));
  const index = readFileSync(join(root, 'docs/environment-variables.md'), 'utf8');
  assert.ok(index.includes(manifest.intro));
  assert.ok(index.includes(manifest.clientExampleNote));
  assert.ok(readFileSync(join(root, 'docs/reference/settings/environment/tabularius_drain_seconds.md'), 'utf8').includes('](../../../upgrading.md)'));
  for (const [name, entry] of Object.entries(manifest.environment)) {
    const page = readFileSync(join(root, `docs/reference/settings/environment/${name.toLowerCase()}.md`), 'utf8');
    assert.ok(page.includes(entry.default) && page.includes(entry.accepted) && page.includes(entry.restart), name);
    assert.ok(page.includes(entry.explainedBy), name);
    assert.doesNotMatch(page, /see source for|Configuration read by the program/);
  }
  for (const [name, entry] of Object.entries(manifest.serveFlags)) {
    const page = readFileSync(join(root, `docs/reference/settings/serve/${name.slice(2)}.md`), 'utf8');
    assert.ok(page.includes(entry.default) && page.includes(entry.accepted) && page.includes(entry.explainedBy), name);
  }
});

test('each command page includes live help and its tested CLI example succeeds', async () => {
  const failures: string[] = [];
  const commands = Object.entries(manifest.commands);
  for (let i = 0; i < commands.length; i += 8) {
    const batch = commands.slice(i, i + 8);
    const results = await Promise.all(batch.map(async ([name, entry]) => {
      const example = entry.example.split(' ');
      const tested = await runCli(main, example.slice(1), { timeout: 20_000 });
      return { name, tested, page: readFileSync(join(root, `docs/reference/cli/${name}.md`), 'utf8') };
    }));
    for (const { name, tested, page } of results) {
      if (tested.status !== 0 || !page.includes(tested.stdout.trimEnd()) || !page.includes(`tabularius ${name} --help`)) failures.push(name);
    }
  }
  assert.deepEqual(failures, []);
});
