import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer } from '../src/announcer.ts';

test('announcer emits one latest message for a rapid burst', async () => {
  const messages: string[] = [];
  const announce = createAnnouncer((message) => messages.push(message), 15);
  announce('Record 2 of 3');
  announce('Record 3 of 3');
  announce('Record 4 of 3');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(messages, ['Record 4 of 3']);
});

test('announcer keeps separate actions outside the throttle window', async () => {
  const messages: string[] = [];
  const announce = createAnnouncer((message) => messages.push(message), 10);
  announce('Browse mode');
  await new Promise((resolve) => setTimeout(resolve, 40));
  announce('Find mode');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(messages, ['Browse mode', 'Find mode']);
});
