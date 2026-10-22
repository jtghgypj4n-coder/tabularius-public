import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (path: string) => readFileSync(join(import.meta.dirname, '../../..', path), 'utf8');

test('reader overviews describe Encryption at Rest with a passphrase', () => {
  for (const path of ['README.md', 'docs/ARCHITECTURE.md']) {
    const text = read(path);
    assert.match(text, /Encryption at Rest[^.]*passphrase/);
    assert.doesNotMatch(text, /unencrypted\s+(?:`?\.fmp12`?|fmp12)/);
  }
});

test('README distinguishes source-file CLI passphrases, folder unlocking and external containers', () => {
  const text = read('README.md');
  const reader = text.split('- **Reader**:')[1].split('- **Hosting**:')[0];
  const hosting = text.split('- **Hosting**:')[1].split('- **FileMaker Data API')[0];
  assert.match(reader, /hidden\s+terminal prompt/);
  assert.match(reader, /TABULARIUS_SOURCE_PASSPHRASE/);
  assert.match(hosting, /waits[^.]*passphrase[^.]*admin\s+console[^.]*Hosted files/);
  assert.match(text, /Not yet: containers in FileMaker's secure \(encrypted\) external storage\./);
});
