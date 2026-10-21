// Bounded chart and renderer regressions that need no sample file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ticks } from '../src/chart.ts';
import { StyleSheet } from '../src/styles.ts';
import { SessionLifetime } from '../src/session-lifetime.ts';

test('large chart bounds finish in a watchdog-bounded child process', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { ticks } from ${JSON.stringify(new URL('../src/chart.ts', import.meta.url).href)};
    process.stdout.write(JSON.stringify(ticks(1e16, 1e16 + 2)));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
    const watchdog = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, timedOut: true }); }, 10_000);
    child.once('exit', (code) => { clearTimeout(watchdog); resolve({ code, timedOut: false }); });
  });
  assert.equal(result.timedOut, false, 'chart tick generation exceeded its watchdog');
  assert.equal(result.code, 0, stderr);
  const values = JSON.parse(stdout) as number[];
  assert.ok(values.length <= 7);
  assert.ok(values.every(Number.isFinite));
});

test('re-rendering one styled object keeps one rule in the sheet', () => {
  const sheet = new StyleSheet('.layout', undefined);
  const element = { classList: { add() {}, remove() {} }, style: { setProperty() {} } } as unknown as HTMLElement;
  const style = { rules: [{ part: 1, state: 2, css: { color: 'red' } }] };
  for (let i = 0; i < 1000; i++) sheet.apply(element, style, 61, 'o1');
  assert.equal(sheet.text().match(/\.layout \.fm\.o1:hover\{color:red\}/g)?.length, 1);
});

test('disposing a session stops its recurring timer and detaches its listeners', async () => {
  const lifetime = new SessionLifetime();
  const target = new EventTarget();
  let events = 0;
  let ticks = 0;
  target.addEventListener('session-event', () => events++, { signal: lifetime.signal });
  lifetime.setInterval(() => ticks++, 5);
  target.dispatchEvent(new Event('session-event'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events, 1);
  assert.ok(ticks > 0);
  lifetime.dispose();
  const stoppedAt = ticks;
  target.dispatchEvent(new Event('session-event'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events, 1);
  assert.equal(ticks, stoppedAt);
});
