import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, parseScriptText, Store } from '../../store/src/index.ts';
import { runScript } from '../src/index.ts';
import { NAME_LOOKUP, guardedFetcher } from '../src/net-guard.ts';
import { TEST_ONLY_CUSTOM_FETCH } from '../src/test-only.ts';

const server = createServer((_req, res) => {
  if (_req.url === '/bad') res.writeHead(600);
  else res.writeHead(200);
  res.end(_req.url === '/bad' ? 'bad' : 'ok');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const dir = mkdtempSync(join(tmpdir(), 'tabularius-curl-status-'));
const file = join(dir, 'test.sqlite');
createStore(file);
const store = new Store(file, 'test');
try {
  const port = server.address().port;
  NAME_LOOKUP.lookup = async () => [{ address: '127.0.0.1' }];
  const fake = guardedFetcher({ policy: { private: true } });
  const run = (path) => {
    const lines = [
      'Set Variable [ $h ; Value: MBS("CURL.New") ]',
      `Set Variable [ $url ; Value: MBS("CURL.SetOptionURL"; $h; "http://status.invalid:${port}${path}") ]`,
      'Exit Script [ Text Result: MBS("CURL.Perform"; $h) ]',
    ];
    const steps = parseScriptText(lines.join('\n'), store.schema).map((s, i) => ({
      stepId: s.stepId, name: s.name, enabled: true, params: s.params, line: lines[i],
    }));
    return runScript(store, { id: 601, name: 'status probe', steps }, { network: fake, [TEST_ONLY_CUSTOM_FETCH]: true });
  };
  const bad = await run('/bad');
  assert.match(bad.result ?? '', /^\[MBS\] ERROR: CURL\.Perform:/);
  const good = await run('/good');
  assert.equal(good.result, '0');
  console.log('handled MBS error and completed another request');
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
