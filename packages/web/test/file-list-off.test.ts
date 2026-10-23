// The sign-in page asks the server for its list of files. A server that keeps the list off (the default) answers
// that plainly, and the page then asks for the file's name; only a server that gave no answer is "unreachable".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../../server/src/index.ts';
import { STORE_EXT } from '../../server/src/host.ts';
import { createStore } from '../../store/src/index.ts';
import { ApiError, fileListOff, listDatabases, unreachableRequest } from '../src/api.ts';

type Served = Awaited<ReturnType<typeof serve>>;
const servers: Served[] = [];
const dirs: string[] = [];
const realFetch = globalThis.fetch;

const start = async (listFilesPublicly: boolean): Promise<Served> => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-list-off-'));
  dirs.push(dir);
  createStore(join(dir, 'Shop' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, ...(listFilesPublicly ? { listFilesPublicly } : {}) });
  servers.push(s);
  return s;
};

/** Runs the web client's own request against a server: its paths are relative to the page's address. */
async function listFrom(s: Served): Promise<string[]> {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => realFetch(typeof input === 'string' && input.startsWith('/') ? s.url + input : input, init)) as typeof fetch;
  try {
    return await listDatabases();
  } finally {
    globalThis.fetch = realFetch;
  }
}

after(async () => {
  for (const s of servers) await new Promise<void>((r) => { s.server.closeAllConnections(); s.server.close(() => r()); });
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

test('a server that keeps its list off answers so, and that is not "unreachable"', async () => {
  const off = await start(false);
  const e = await listFrom(off).then(() => undefined, (err: unknown) => err);
  assert.ok(e instanceof ApiError, String(e));
  assert.ok(fileListOff(e), 'the answer is recognised as "the list is off"');
  assert.ok(!unreachableRequest(e));
});

test('a server that lists its files gives them', async () => {
  const on = await start(true);
  assert.deepEqual(await listFrom(on), ['Shop']);
});

test('no answer, a proxy\'s page, a busy server and other errors are not "the list is off"', () => {
  assert.ok(!fileListOff(new TypeError('Failed to fetch')));
  assert.ok(!fileListOff(new SyntaxError('Unexpected token < in JSON')));
  assert.ok(!fileListOff(new ApiError(-1, 'The server answered 404.', undefined, 404)));
  assert.ok(!fileListOff(new ApiError(301, 'Server busy. Try again shortly.', undefined, 503)));
  assert.ok(!fileListOff(new ApiError(3, 'Command is unavailable', undefined, 500)));
});
