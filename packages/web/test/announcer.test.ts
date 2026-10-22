import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer } from '../src/announcer.ts';

test('announcer emits one latest message for a rapid burst', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const messages: string[] = [];
  const announce = createAnnouncer((message) => messages.push(message), 15);
  announce('Record 2 of 3');
  announce('Record 3 of 3');
  announce('Record 4 of 3');
  t.mock.timers.tick(15);
  assert.deepEqual(messages, ['Record 4 of 3']);
});

test('announcer keeps separate actions outside the throttle window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const messages: string[] = [];
  const announce = createAnnouncer((message) => messages.push(message), 10);
  announce('Browse mode');
  t.mock.timers.tick(10);
  announce('Find mode');
  t.mock.timers.tick(10);
  assert.deepEqual(messages, ['Browse mode', 'Find mode']);
});
