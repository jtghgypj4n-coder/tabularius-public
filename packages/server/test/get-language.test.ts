import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverLanguage } from '../src/get-language.ts';

test('server language uses the first available locale variable', () => {
  assert.equal(serverLanguage({ LC_ALL: 'fr_CA.UTF-8', LC_MESSAGES: 'de_DE', LANG: 'es_ES' }), 'French');
  assert.equal(serverLanguage({ LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'es_ES' }), 'Japanese');
  assert.equal(serverLanguage({ LANG: 'pt_BR' }), 'Portuguese');
});

test('server language falls back to English for unknown or missing locales', () => {
  assert.equal(serverLanguage({}), 'English');
  assert.equal(serverLanguage({ LC_ALL: 'C.UTF-8', LANG: 'fr_FR' }), 'English');
  assert.equal(serverLanguage({ LANG: 'xx_XX' }), 'English');
});
