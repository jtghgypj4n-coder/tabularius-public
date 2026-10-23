import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebClient } from '../src/webclient.ts';

type TestRun = {
  id: string;
  db: string;
  token: string;
  script: string;
  sent: number;
  answer: (value: unknown) => void;
  next: () => Promise<never>;
  timer: NodeJS.Timeout;
  abandoned?: boolean;
};

function setup() {
  const client = new WebClient({} as never, { alive: () => true, endListeners: new Set() } as never);
  let serial = 0;
  const answers = new Map<TestRun, unknown[]>();
  const ask = (token: string, waiting: 'Pause' | 'Insert File' = 'Pause'): TestRun => {
    const run: TestRun = {
      id: '', db: 'synthetic', token, script: `run ${++serial}`, sent: 0,
      answer: (value) => answers.get(run)!.push(value),
      next: async () => { throw new Error('No continuation in this test'); },
      timer: undefined as never,
    };
    answers.set(run, []);
    const step = waiting === 'Pause'
      ? { pause: { actions: [], state: {} } }
      : { ask: { actions: [] } };
    client['outcome'](run as never, step as never);
    return run;
  };
  return { client, answers, ask };
}

test('one session keeps eight paused runs and cancels its oldest Pause', () => {
  const { client, answers, ask } = setup();
  try {
    const runs = Array.from({ length: 9 }, () => ask('one'));
    assert.equal(client['paused'].size, 8);
    assert.equal(client['paused'].has(runs[0].id), false);
    assert.equal(runs[0].abandoned, true);
    assert.deepEqual(answers.get(runs[0]), [false]);
    for (const run of runs.slice(1)) {
      assert.equal(client['paused'].has(run.id), true);
      assert.deepEqual(answers.get(run), []);
    }
  } finally {
    client.stop();
  }
});

test('one session filling its cap leaves another session\'s paused run alone', () => {
  const { client, answers, ask } = setup();
  try {
    const other = ask('other');
    const runs = Array.from({ length: 9 }, () => ask('one'));
    assert.equal(client['paused'].size, 9);
    assert.equal(client['paused'].has(other.id), true);
    assert.deepEqual(answers.get(other), []);
    assert.equal(client['paused'].has(runs[0].id), false);
    assert.deepEqual(answers.get(runs[0]), [false]);
  } finally {
    client.stop();
  }
});

test('at the shared cap, a quiet session evicts the oldest run of a busiest session', () => {
  const { client, answers, ask } = setup();
  try {
    const quiet = ask('quiet'); // Globally oldest: FIFO eviction would cancel this run.
    const busy = Array.from({ length: 8 }, () => ask('busy', 'Insert File'));
    for (let session = 0; session < 30; session++) {
      for (let run = 0; run < 8; run++) ask(`full-${session}`);
    }
    for (let run = 0; run < 7; run++) ask('almost-full');
    assert.equal(client['paused'].size, 256);

    const newcomer = ask('quiet');
    assert.equal(client['paused'].size, 256);
    assert.equal(client['paused'].has(quiet.id), true);
    assert.deepEqual(answers.get(quiet), []);
    assert.equal(client['paused'].has(newcomer.id), true);
    assert.equal(client['paused'].has(busy[0].id), false);
    assert.equal(busy[0].abandoned, true);
    assert.deepEqual(answers.get(busy[0]), [undefined]);
    for (const run of busy.slice(1)) assert.equal(client['paused'].has(run.id), true);
  } finally {
    client.stop();
  }
});
