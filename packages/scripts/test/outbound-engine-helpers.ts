import { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';

export function generatedStore(t: TestContext, name = 'Outbound'): Store {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-outbound-'));
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  const store = new Store(path, name);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

export function script(store: Store, text: string): Script {
  return {
    id: 999, name: 'Generated request',
    steps: parseScriptText(text, store.schema).map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params })),
  };
}

export async function localServer(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

export const network = { network: true, networkAllow: ['127.0.0.1'] } as const;
