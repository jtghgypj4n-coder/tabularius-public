import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceText, valueText } from '../src/record-history.ts';

test('where a change came from is said in words', () => {
  assert.equal(sourceText({ surface: 'web' }), 'the web client');
  assert.equal(sourceText({ surface: 'rest', script: 'Tidy States' }), 'the Data API, script “Tidy States”');
  assert.equal(sourceText({ surface: 'automation', by: 'the automation "Close"' }), 'an automation, the automation "Close"');
  assert.equal(sourceText({}), '');
  assert.equal(sourceText({ surface: 'newthing' }), 'newthing');
});

test('values show empty and line breaks plainly', () => {
  assert.deepEqual([valueText(''), valueText(null), valueText('a\r\nb'), valueText(5)], ['empty', 'empty', 'a¶¶b', '5']);
});
