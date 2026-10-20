// A real engine run and real HTTP on 127.0.0.1; no fixtures, corpus or child processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { runScript } from '../src/engine.ts';
import { generatedStore, localServer, network, script } from './outbound-engine-helpers.ts';

test('a stop-enabled run makes 1k sequential outbound calls with event-loop lag below 100 ms', { timeout: 150_000 }, async (t) => {
  const store = generatedStore(t);
  const stop = new AbortController();
  t.after(() => stop.abort());
  let hits = 0;
  let maxListeners = 0;
  const base = await localServer(t, (_req, res) => {
    hits++;
    maxListeners = Math.max(maxListeners, getEventListeners(stop.signal, 'abort').length);
    res.end('ok');
  });
  const request = script(store, `Insert from URL [ $answer ; "${base}/" ]`).steps[0];
  // Each guarded request deliberately gets a fresh socket/DNS check. Stay below the ephemeral-port
  // budget when another test file is running, while exercising a thousand stop-listener lifetimes.
  const generated = { id: 999, name: 'Sequential outbound', steps: Array.from({ length: 1000 }, () => request) };
  // Warm the engine, fetch and HTTP paths before sampling: startup/JIT work is not steady-state lag.
  const warm = await runScript(store, { ...generated, steps: generated.steps.slice(0, 100) }, { ...network, stop: stop.signal, timeoutMs: 5000 });
  assert.equal(warm.error, 0);
  assert.equal(warm.halted, false);
  assert.equal(hits, 100);
  assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
  // A busy machine (other test files sharing its cores) can stall this whole process for hundreds of
  // milliseconds whatever the code does. A blocking regression stalls every attempt, so the bound has to
  // hold in at least one of three; every other assertion must hold in each.
  const lags: number[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    hits = 0;
    let maxLag = 0;
    let maxLagAt = 0;
    let samples = 0;
    let previous = performance.now();
    const interval = 5;
    const timer = setInterval(() => {
      const now = performance.now();
      const lag = now - previous - interval;
      if (lag > maxLag) { maxLag = lag; maxLagAt = hits; }
      previous = now;
      samples++;
    }, interval);
    const started = performance.now();
    try {
      const result = await runScript(store, generated, { ...network, stop: stop.signal, timeoutMs: 50_000 });
      t.diagnostic(`1k requests: ${(performance.now() - started).toFixed(0)} ms; maximum event-loop lag: ${maxLag.toFixed(2)} ms at request ${maxLagAt}; maximum stop listeners: ${maxListeners}`);
      assert.equal(result.error, 0);
      assert.equal(result.halted, false);
      assert.equal(hits, 1000);
      // The timer ticks every `interval` ms, so a fast machine that finishes the 1k requests in ~370 ms sees only ~70 ticks.
      // Require that it ticked through at least half of the run, up to 100 ticks, instead of a fixed 100.
      const elapsed = performance.now() - started;
      assert.ok(samples >= Math.min(100, Math.floor(elapsed / interval / 2)), `the timer kept running throughout the real requests (${samples} ticks in ${elapsed.toFixed(0)} ms)`);
      assert.ok(maxListeners <= 2, `stop listeners stayed bounded: ${maxListeners}`);
      assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
    } finally { clearInterval(timer); }
    lags.push(maxLag);
    if (maxLag < 100) break;
  }
  stop.abort();
  assert.ok(Math.min(...lags) < 100, `event-loop lag ${lags.map((l) => l.toFixed(2)).join(', ')} ms must remain under 100 ms in at least one attempt`);
});
