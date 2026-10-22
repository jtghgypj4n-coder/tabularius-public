import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const topics = [
  ['finds and reports', 'docs/guides/running/finds-and-reports.md'],
  ['accounts and privilege sets', 'docs/guides/running/accounts-and-privilege-sets.md'],
  ['masking', 'docs/guides/running/masking.md'],
  ['hosting and HTTPS', 'docs/guides/running/hosting-and-https.md'],
  ['backup and restore', 'docs/tutorials/backup-and-restore.md'],
  ['sync', 'docs/guides/running/sync.md'],
  ['the Data API', 'docs/tutorials/data-api-client.md'],
  ['plug-in replacements', 'docs/guides/running/plugin-replacements.md'],
  ['dashboards and charts', 'docs/guides/running/dashboards-and-charts.md'],
  ['AI features and the AI-visible policy', 'docs/tutorials/let-an-ai-use-your-file-safely.md'],
] as const;
const newGuides = topics.filter(([, path]) => path.startsWith('docs/guides/running/'));

test('the ten running guides are discoverable and follow the task-guide structure', () => {
  const contents = JSON.parse(readFileSync(join(root, 'docs/contents.json'), 'utf8')) as { sections: { pages: string[] }[] };
  const menu = new Set(contents.sections.flatMap((section) => section.pages));
  const readme = readFileSync(join(root, 'docs/README.md'), 'utf8');
  assert.equal(topics.length, 10);
  for (const [, path] of topics) {
    const markdown = readFileSync(join(root, path), 'utf8');
    assert.ok(markdown.startsWith('# '), `${path} has a title`);
    assert.ok(menu.has(path), `${path} is in docs/contents.json`);
    assert.match(markdown, /```(?:sh run|sh)\n|<!-- docs-example: run -->\n```sh\n/, `${path} includes a worked command example`);
  }
  for (const [topic, path] of newGuides) {
    const markdown = readFileSync(join(root, path), 'utf8');
    assert.match(markdown, /\n## 1\./, `${path} has numbered task steps`);
    assert.match(markdown, /\n## Check afterwards\n/, `${path} has post-task checks`);
    assert.match(markdown, /\n## References and differences\n/, `${path} links references and known differences`);
    assert.ok(readme.includes(path.replace('docs/', '')), `docs/README.md links the running guide set (${topic})`);
  }
});
