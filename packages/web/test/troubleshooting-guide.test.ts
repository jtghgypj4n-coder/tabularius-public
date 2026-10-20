import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const guide = readFileSync(join(root, 'docs', 'troubleshooting-web-client.md'), 'utf8');
const linkedTargets = [
  ...['index', 'design', 'security', 'dataviewer', 'cleanup', 'dashboard', 'automations', 'debugger'].map((name) => join(root, 'packages', 'web', `${name}.html`)),
  join(root, 'packages', 'web', 'src', 'main.ts'),
  join(root, 'packages', 'web', 'src', 'toast.ts'),
  join(root, 'packages', 'web', 'src', 'import-dialog.ts'),
  join(root, 'packages', 'server', 'admin', 'index.html'),
];
const appText = linkedTargets.map((file) => readFileSync(file, 'utf8')).join('\n');

const topics = [
  ['the-page-is-blank-or-stays-on-loading', 'packages/web/test/boot-guard.test.ts'],
  ['sign-in-stays-on-the-sign-in-screen', 'packages/web/e2e/sign-in.e2e.ts'],
  ['the-client-looks-like-an-old-version-after-an-update', 'packages/web/test/http-problem.test.ts'],
  ['the-offline-banner-appears', 'packages/web/e2e/offline.e2e.ts'],
  ['an-import-fails-or-its-preview-will-not-load', 'packages/web/e2e/import-records.e2e.ts'],
  ['a-container-file-will-not-upload', 'packages/web/e2e/containers.e2e.ts'],
  ['a-keyboard-shortcut-does-nothing', 'packages/web/e2e/shortcuts.e2e.ts'],
  ['preview-or-printing-is-blank-incomplete-or-laid-out-incorrectly', 'packages/web/e2e/preview-columns.e2e.ts'],
  ['a-passkey-prompt-is-cancelled-missing-or-does-not-sign-in', 'packages/web/src/webauthn.ts'],
] as const;

test('each web-client failure has symptom, cause, check, fix, and existing verification evidence', () => {
  for (const [anchor, evidence] of topics) {
    const headings = [...guide.matchAll(/^## (.+)$/gm)];
    const at = headings.findIndex((m) => m[1].trim().toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-') === anchor);
    assert.notEqual(at, -1, `guide includes ${anchor}`);
    const start = headings[at].index!;
    const end = headings[at + 1]?.index ?? guide.length;
    const entry = guide.slice(start, end);
    for (const field of ['**Symptom:**', '**Cause:**', '**Check:**', '**Fix:**']) assert.ok(entry.includes(field), `${anchor} includes ${field}`);
    assert.ok(existsSync(join(root, evidence)), `${anchor} cites existing ${evidence}`);
    assert.ok(appText.includes(`/docs/troubleshooting-web-client#${anchor}`), `${anchor} is linked from the matching app message or screen`);
  }
});
