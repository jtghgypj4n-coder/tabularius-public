import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { evaluate, asText } from '../src/index.ts';
import { encodingOf } from '../src/mbs-text.ts';

for (const [platform, value] of [['win32', '-2'], ['darwin', '1'], ['linux', '5']] as const) {
  test(`calculation platform is injectable: ${platform}`, () => {
    assert.equal(asText(evaluate('Get ( SystemPlatform )', { platform })), value);
    const plugins = JSON.parse(asText(evaluate('Get ( InstalledFMPluginsAsJSON )', { platform })));
    assert.equal(plugins.environment.platform, Number(value));
  });
}
test('temporary folder defaults use the OS folder', () => {
  assert.equal(asText(evaluate('MBS ( "Folders.SystemTemporary" )')), tmpdir());
  assert.equal(asText(evaluate('Get ( TemporaryPath )')), tmpdir().replace(/\\/g, '/').replace(/\/$/, '') + '/');
});
test('native text encoding selection is injectable', () => {
  assert.equal(encodingOf('native', 'win32'), 'windows');
  assert.equal(encodingOf('native', 'darwin'), 'mac');
  assert.equal(encodingOf('native', 'linux'), 'utf8');
});
