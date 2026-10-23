import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STANDBY_STATE, serve, type StandbyState } from '../src/index.ts';

function state(names: string[], seq = 3): StandbyState {
  return {
    primary: 'http://127.0.0.1:1',
    files: Object.fromEntries(names.map((name) => [name, { run: 'r', seq, wholeAfter: 5, size: 0, mtimeMs: 0, at: 0 }])),
  };
}

for (const names of [['Charts'], ['Charts', 'Orders']]) {
  test(`takeover refuses ${names.length} unfinished copies without changing the folder, including on retry`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-takeover-'));
    const path = join(dir, STANDBY_STATE);
    const saved = JSON.stringify(state(names));
    writeFileSync(path, saved);
    // Even stale state staging files must survive a refused takeover.
    const staging = `.${STANDBY_STATE}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(join(dir, staging), 'unfinished state write');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(dir, staging), old, old);
    let running: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(async () => {
          running = await serve({ dir, port: 0, watch: false, log: () => {} });
        }, (error: unknown) => {
          assert.ok(error instanceof Error);
          for (const name of names) assert.ok(error.message.includes(name), error.message);
          assert.match(error.message, /did not reach a whole state/);
          assert.match(error.message, /mid-copy snapshot/);
          assert.match(error.message, /restore.*backup.*copy it again from the main server/i);
          assert.match(error.message, /--accept-partial-standby/);
          return true;
        });
        assert.equal(readFileSync(path, 'utf8'), saved);
        assert.deepEqual(readdirSync(dir).sort(), [STANDBY_STATE, staging].sort());
        assert.equal(readFileSync(join(dir, staging), 'utf8'), 'unfinished state write');
      }
    } finally {
      if (running) await new Promise<void>((resolve) => running!.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { name: 'explicitly accepted unfinished copy', standby: state(['Charts']), accept: true },
  { name: 'whole copy', standby: state(['Charts'], 5), accept: false },
  { name: 'empty standby state', standby: state([]), accept: false },
  { name: 'no standby state', standby: undefined, accept: false },
]) {
  test(`takeover starts with ${scenario.name}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-takeover-'));
    const path = join(dir, STANDBY_STATE);
    if (scenario.standby) writeFileSync(path, JSON.stringify(scenario.standby));
    const lines: string[] = [];
    let running: Awaited<ReturnType<typeof serve>> | undefined;
    try {
      running = await serve({
        dir, port: 0, watch: false, log: (m) => void lines.push(m),
        ...(scenario.accept ? { acceptPartialStandbyFiles: true } : {}),
      });
      assert.ok(running.server.listening);
      assert.equal(existsSync(path), false);
      const takeover = lines.find((m) => m.startsWith('taking over from '));
      assert.equal(!!takeover, !!scenario.standby);
      if (scenario.accept) {
        assert.match(takeover!, /Charts had not caught up to a whole state and may need restoring from a backup/);
        assert.match(takeover!, /accepted with --accept-partial-standby/);
      } else {
        assert.ok(!lines.some((m) => m.includes('accepted with --accept-partial-standby')));
      }
    } finally {
      if (running) await new Promise<void>((resolve) => running!.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
