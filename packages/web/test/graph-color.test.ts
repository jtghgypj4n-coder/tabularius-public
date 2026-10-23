import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceFill } from '../src/design/graph-color.ts';

test('web-a-8: occurrence colours cannot add CSS declarations or URLs', () => {
  for (const color of ['red;cursor:url(https://evil.example/beacon.png),auto', 'url(x)', 'red;x', '', '#abcd0', '#1234567', 'ab']) {
    assert.equal(occurrenceFill(color), undefined, color);
  }
  for (const color of ['#c7d7ee', '#abc', '#abcd', '#12345678', 'rgb(1, 2, 3)', 'rgba(0,0,0,.5)', 'tomato']) {
    assert.equal(occurrenceFill(` ${color} `), color);
  }
});
