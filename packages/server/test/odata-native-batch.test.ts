import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';

test('native writes agree across standalone, multipart and JSON batch requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-native-batch-'));
  const path = join(dir, 'Native.openhbam.sqlite');
  createStore(path, { mode: 'native' });
  const setup = new Store(path, 'Native');
  try {
    setup.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Payload', type: 'json' }] }]);
    const full = setup.privilegeSets().find((p) => p.id === 1)!;
    setup.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
    setup.setPassword('Ann', 'pw', full.name);
  } finally { setup.close(); }
  const hosted = await serve({ dir, port: 0, watch: false, log: () => {} });
  try {
    const url = `${hosted.url}/fmi/odata/v4/Native`;
    const auth = { authorization: `Basic ${btoa('Ann:pw')}` };
    const exact = '{"Payload":{"big":9007199254740993}}';
    const duplicate = '{"Payload":{"x":1,"x":2}}';
    const standalone = (body: string) => fetch(`${url}/Items`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body });
    const jsonBatch = async (body: string) => {
      const raw = `{"requests":[{"id":"1","method":"POST","url":"Items","body":${body}}]}`;
      const res = await fetch(`${url}/$batch`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: raw });
      assert.equal(res.status, 200);
      return (await res.json() as { responses: { status: number }[] }).responses[0].status;
    };
    const multipart = async (body: string) => {
      const raw = `--b\r\nContent-Type: application/http\r\n\r\nPOST Items HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${body}\r\n--b--\r\n`;
      const res = await fetch(`${url}/$batch`, { method: 'POST', headers: { ...auth, 'content-type': 'multipart/mixed; boundary=b' }, body: raw });
      assert.equal(res.status, 200);
      return Number(/HTTP\/1\.1 (\d+)/.exec(await res.text())?.[1]);
    };
    assert.equal((await standalone(exact)).status, 201);
    assert.equal(await jsonBatch(exact), 201);
    assert.equal(await multipart(exact), 201);
    const live = hosted.host.get('Native')!;
    assert.deepEqual(live.findIds('Items').map((id) => live.get('Items', id).fieldData.Payload), [
      '{"big":9007199254740993}', '{"big":9007199254740993}', '{"big":9007199254740993}',
    ]);
    assert.equal((await standalone(duplicate)).status, 400);
    assert.equal(await jsonBatch(duplicate), 400);
    assert.equal(await multipart(duplicate), 400);
    assert.equal(live.findIds('Items').length, 3);
  } finally {
    await new Promise<void>((resolve) => hosted.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
