import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestGate } from '../src/request-gate.ts';
import { Warmer } from '../src/warmer.ts';
import { PgServer } from '../src/pgwire.ts';
import type { Host } from '../src/host.ts';

for (const [name, create] of [
  ['TABULARIUS_REQUEST_LIMIT', () => new RequestGate()],
  ['TABULARIUS_WARM_HEAP_MB', () => new Warmer()],
  ['TABULARIUS_PGWIRE_MAX_BUFFERED_ROWS', () => new PgServer({} as Host, { port: 0 })],
] as const) {
  test(`${name} refuses ambiguous numbers before starting work`, (t) => {
    const saved = process.env[name];
    t.after(() => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; });
    for (const value of ['', '1e9', '0x200', '-1', '1.5', 'abc', 'Infinity', '9007199254740992', '0']) {
      process.env[name] = value;
      assert.throws(create, new RegExp(`${name}.*whole number.*decimal digits`), value);
    }
    process.env[name] = '512';
    const valid = create();
    if (valid instanceof RequestGate) assert.equal(valid.limit, 512);
    if (valid instanceof PgServer) valid.close();
  });
}

test('upload aggregate quota rejects numeric shorthand and retains its safe default', async (t) => {
  const name = 'TABULARIUS_MAX_UPLOAD_IN_PROGRESS';
  const saved = process.env[name];
  t.after(() => { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; });
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  let sequence = 0;
  for (const value of ['1e3', '0x200', '-1', '1.5', 'abc', '', '0', '512']) {
    process.env[name] = value;
    const before = warnings.length;
    const module = await import(`../src/uploads.ts?settings-test=${sequence++}`);
    assert.equal(module.MAX_UPLOAD_IN_PROGRESS, value === '512' ? 512 : 20 * 1024 * 1024 * 1024, value);
    assert.equal(warnings.length - before, value === '512' ? 0 : 1);
    if (value !== '512') assert.match(warnings.at(-1)!, /TABULARIUS_MAX_UPLOAD_IN_PROGRESS.*decimal digits/);
  }
});
