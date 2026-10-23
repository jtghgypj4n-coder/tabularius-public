import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asText, evaluate, type CalcContext } from '../src/index.ts';
import { APPLICATION_VERSION } from '../src/get.ts';

test('unknown Get names answer empty and notice once per name per context', () => {
  const notices: string[] = [];
  const ctx: CalcContext = { notice: (message) => notices.push(message) };
  assert.equal(asText(evaluate('Get ( NewerOption ) & Get ( neweroption ) & Get ( OtherOption )', ctx)), '');
  assert.equal(asText(evaluate('Get ( NewerOption )', ctx)), '');
  assert.deepEqual(notices, [
    'Get ( NewerOption ) is not a Get parameter this build knows; it answered empty',
    'Get ( OtherOption ) is not a Get parameter this build knows; it answered empty',
  ]);
  assert.equal(asText(evaluate('Get ( NewerOption )', { notice: (message) => notices.push(message) })), '');
  assert.equal(notices.length, 3);
});

test('a host answer suppresses the unknown-name notice; reader placeholders retain their notice', () => {
  const notices: string[] = [];
  assert.equal(asText(evaluate('Get ( NewerOption )', { get: () => ({ type: 'text', value: 'known by host' }), notice: (m) => notices.push(m) })), 'known by host');
  assert.equal(asText(evaluate('Get ( ⟨get:73⟩ )', { notice: (m) => notices.push(m) })), '?');
  assert.deepEqual(notices, ['Unknown Get option ⟨get:73⟩: skipped; returns ?']);
});

test('calculation version defaults share the script version constant', () => {
  assert.equal(APPLICATION_VERSION, 'Tabularius Server 0.1');
  assert.equal(asText(evaluate('Get ( ApplicationVersion )')), APPLICATION_VERSION);
  assert.equal(asText(evaluate('Get ( HostApplicationVersion )')), APPLICATION_VERSION);
});
