import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimHistory, type ChatMessage } from '../src/assistant.ts';

const chat = (n: number, size = 10): ChatMessage[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:`.padEnd(size, 'x') }));

test('assistant history: only the latest 20 messages go to the model, starting with a question', () => {
  const kept = trimHistory(chat(31));
  assert.equal(kept.length, 19);
  assert.equal(kept[0].role, 'user');
  assert.match(kept[0].content, /^12:/);
  assert.match(kept.at(-1)!.content, /^30:/);
});

test('assistant history: long messages are cut, and old ones dropped to stay within budget', () => {
  const kept = trimHistory([...chat(4, 25_000), { role: 'user', content: 'and now?' }]);
  assert.ok(kept.every((m) => m.content.length < 20_100));
  assert.match(kept[0].content, /more characters cut/);
  assert.equal(kept.at(-1)!.content, 'and now?');
  assert.ok(kept.reduce((n, m) => n + m.content.length, 0) <= 60_000);
  assert.equal(kept[0].role, 'user');
  // The question itself always goes, even when it is long.
  const one = trimHistory([{ role: 'user', content: 'y'.repeat(90_000) }]);
  assert.equal(one.length, 1);
});

test('assistant history: two messages in a row from the same side are joined', () => {
  assert.deepEqual(trimHistory([
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
  ]), [{ role: 'user', content: 'a\n\nb' }]);
});
