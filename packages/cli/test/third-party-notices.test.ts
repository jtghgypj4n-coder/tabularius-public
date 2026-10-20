// scripts/third-party-notices.ts: the licence texts that ship with a release build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectNotices, renderNotices } from '../../../scripts/third-party-notices.ts';

const temp = () => mkdtempSync(join(tmpdir(), 'tabularius-notices-'));

test('the notices file holds each package\'s licence text once, nested and scoped packages included, and skips workspace links', () => {
  const dir = temp();
  try {
    const pkg = (at: string, manifest: object, files: Record<string, string> = {}) => {
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
      for (const [f, text] of Object.entries(files)) writeFileSync(join(at, f), text);
    };
    const nm = join(dir, 'node_modules');
    pkg(join(nm, 'alpha'), { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'Copyright (c) Alpha authors\nMIT text' });
    pkg(join(nm, 'alpha', 'node_modules', 'beta'), { name: 'beta', version: '2.0.0', license: 'ISC' }, { 'LICENSE.md': 'ISC text for beta' });
    pkg(join(nm, '@scope', 'gamma'), { name: '@scope/gamma', version: '3.1.0', license: 'BSD-3-Clause' }, { 'LICENCE': 'BSD text', 'README.md': 'not a licence' });
    pkg(join(nm, 'delta'), { name: 'delta', version: '0.1.0' });
    pkg(join(nm, 'dup', 'node_modules', 'alpha'), { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'Copyright (c) Alpha authors\nMIT text' });
    pkg(join(nm, 'dup'), { name: 'dup', version: '1.0.0', license: 'MIT' }, { COPYING: 'dup text' });
    mkdirSync(join(dir, 'packages', 'mine'), { recursive: true });
    mkdirSync(join(nm, '@tabularius'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'mine', 'package.json'), JSON.stringify({ name: '@tabularius/mine', version: '0.1.0', license: 'MIT' }));
    symlinkSync(join(dir, 'packages', 'mine'), join(nm, '@tabularius', 'mine'), 'dir');
    mkdirSync(join(nm, '.bin'));

    const notices = collectNotices(dir);
    assert.deepEqual(notices.map((n) => `${n.name}@${n.version}`), ['@scope/gamma@3.1.0', 'alpha@1.0.0', 'beta@2.0.0', 'delta@0.1.0', 'dup@1.0.0']);
    const md = renderNotices(notices, 'Node licence text', 'v22.0.0');
    assert.match(md, /## Node\.js v22\.0\.0/);
    assert.match(md, /Node licence text/);
    assert.equal(md.match(/Copyright \(c\) Alpha authors/g)?.length, 1);
    assert.match(md, /## @scope\/gamma 3\.1\.0\n\nLicence: BSD-3-Clause\n\n```\nBSD text\n```/);
    assert.ok(!md.includes('not a licence'));
    assert.match(md, /## delta 0\.1\.0\n\nLicence: \(none declared\)\n\nThe package ships no licence file/);
    assert.ok(!md.includes('mine'));
    assert.match(renderNotices([], undefined), /could not find the Node\.js licence file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
