import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host } from '../src/host.ts';
import { BATCH_LIMIT, batchRequests } from '../src/odata-batch.ts';

// OData $batch: several requests in one, as Excel, Power BI and the OData
// client libraries send them, with change sets done all or nothing.
const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
let host: Host;
const basic = (who: string) => ({ authorization: 'Basic ' + btoa(`${who}:pw`) });

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-batch-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  copyFileSync(fixture, join(dir, 'Other.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4`;
  host = s.host;
  const store = host.get('Charts')!;
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  store.savePrivilegeSet({ ...full, id: undefined, name: 'No OData', extendedPrivileges: ['fmrest'] });
  store.setPassword('Bo', 'pw', 'No OData');
  store.savePrivilegeSet({
    name: 'Reports', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false }, tables: { Congress: { view: true, edit: false, create: false, delete: false, fields: { Party: 'none' } } },
  });
  store.setPassword('Cy', 'pw', 'Reports');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const count = () => host.get('Charts')!.findIds('Congress').length;

/** A multipart/mixed body: each item a request, or a list of them (a change set). */
function multipart(items: (string | string[])[]): string {
  const part = (req: string, id?: number) => `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n${id ? `Content-ID: ${id}\r\n` : ''}\r\n${req}\r\n`;
  let n = 0;
  let out = '';
  for (const item of items) {
    out += '--batch_b\r\n';
    if (typeof item === 'string') out += part(item);
    else {
      out += 'Content-Type: multipart/mixed; boundary=changeset_c\r\n\r\n';
      for (const req of item) out += `--changeset_c\r\n${part(req, ++n)}`;
      out += '--changeset_c--\r\n';
    }
  }
  return `${out}--batch_b--\r\n`;
}

const post = (path: string, body: unknown) => `POST ${path} HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;
const patch = (path: string, body: unknown) => `PATCH ${path} HTTP/1.1\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;

async function batch(body: string, headers: Record<string, string> = basic('Ann'), file = 'Charts') {
  const res = await fetch(`${root}/${file}/$batch`, { method: 'POST', headers: { 'content-type': 'multipart/mixed; boundary=batch_b', ...headers }, body });
  const text = await res.text();
  // Each answer's status and body, in order (change set answers included).
  const answers = [...text.matchAll(/HTTP\/1\.1 (\d+)[^\r\n]*\r\n([\s\S]*?)\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => ({
    status: Number(m[1]), headers: m[2], body: m[3] ? JSON.parse(m[3]) as Record<string, any> : undefined,
  }));
  return { res, text, answers };
}

test('a multipart $batch answers each request, and a change set can use what an earlier request created', { skip }, async () => {
  const before = count();
  const { res, text, answers } = await batch(multipart([
    'GET Congress(1)?$select=Name HTTP/1.1\r\nAccept: application/json\r\n',
    [post('Congress', { Name: 'Batch One', District: 3 }), patch('$1', { State: 'Batchland' })],
    'GET Congress/$count HTTP/1.1\r\n',
  ]));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /^multipart\/mixed; boundary=batchresponse_/);
  assert.match(text, /Content-Type: multipart\/mixed; boundary=changesetresponse_/);
  assert.deepEqual(answers.map((a) => a.status), [200, 201, 204, 200]);
  assert.equal(answers[0].body!.ROWID, 1);
  assert.ok('Name' in answers[0].body!);
  assert.deepEqual(Object.keys(answers[0].body!).filter((k) => !k.startsWith('@') && !['ROWID', 'ROWMODID', 'Name'].includes(k)), [], '$select=Name leaves every other property out');
  const made = answers[1].body!;
  assert.equal(made.Name, 'Batch One');
  assert.match(answers[1].headers, new RegExp(`location: ${root}/Charts/Congress\\(${made.ROWID}\\)`));
  assert.equal(count(), before + 1);
  const row = await (await fetch(`${root}/Charts/Congress(${made.ROWID})`, { headers: basic('Ann') })).json() as Record<string, unknown>;
  assert.equal(row.State, 'Batchland');
  // $count's answer is plain text.
  assert.match(text, new RegExp(`\r\n\r\n${before + 1}\r\n--`));
});

test('a change set that fails keeps none of its changes, and the batch stops there unless asked to go on', { skip }, async () => {
  const before = count();
  const failing = [post('Congress', { Name: 'Rolled Back' }), patch('$1', { Nope: 1 })];
  const stopped = await batch(multipart([failing, 'GET Congress(1) HTTP/1.1\r\n']));
  assert.equal(stopped.res.status, 200);
  // One answer for the whole change set: the error that failed it. The GET after it isn't run.
  assert.deepEqual(stopped.answers.map((a) => a.status), [400]);
  assert.match(stopped.answers[0].body!.error.message, /no property "Nope"/);
  assert.equal(count(), before);
  const named = await fetch(`${root}/Charts/Congress/$count?$filter=${encodeURIComponent("Name eq 'Rolled Back'")}`, { headers: basic('Ann') });
  assert.equal(await named.text(), '0');

  const going = await batch(multipart([failing, 'GET Congress(1) HTTP/1.1\r\n']), { ...basic('Ann'), prefer: 'odata.continue-on-error' });
  assert.equal(going.res.headers.get('preference-applied'), 'odata.continue-on-error');
  assert.deepEqual(going.answers.map((a) => a.status), [400, 200]);
  assert.equal(count(), before);
});

test('a JSON $batch: atomicity groups are all or nothing, and dependsOn waits on success', { skip }, async () => {
  const before = count();
  const send = async (requests: unknown[], prefer?: string) => {
    const res = await fetch(`${root}/Charts/$batch`, { method: 'POST', headers: { ...basic('Ann'), 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: JSON.stringify({ requests }) });
    return { res, body: await res.json() as { responses: { id: string; atomicityGroup?: string; status: number; headers: Record<string, string>; body?: any }[]; error?: { message: string } } };
  };
  const ok = await send([
    { id: 'a', method: 'post', url: 'Congress', atomicityGroup: 'g', body: { Name: 'Json One' } },
    { id: 'b', method: 'patch', url: '$a', atomicityGroup: 'g', body: { State: 'Jsonia' } },
    { id: 'c', method: 'get', url: '$a', dependsOn: ['g'] },
  ]);
  assert.equal(ok.res.status, 200);
  assert.deepEqual(ok.body.responses.map((r) => [r.id, r.status]), [['a', 201], ['b', 204], ['c', 200]]);
  assert.equal(ok.body.responses[2].body.State, 'Jsonia');
  assert.equal(ok.body.responses[0].atomicityGroup, 'g');
  assert.equal(count(), before + 1);

  const failed = await send([
    { id: 'a', method: 'post', url: 'Congress', atomicityGroup: 'g', body: { Name: 'Json Two' } },
    { id: 'b', method: 'patch', url: '$a', atomicityGroup: 'g', body: { Nope: 1 } },
    { id: 'c', method: 'get', url: 'Congress(1)', dependsOn: ['b'] },
    { id: 'd', method: 'get', url: 'Congress(1)' },
  ], 'odata.continue-on-error');
  assert.deepEqual(failed.body.responses.map((r) => [r.id, r.status]), [['a', 424], ['b', 400], ['c', 424], ['d', 200]]);
  assert.equal(count(), before + 1);

  // Bodies that can't be read refuse the whole batch.
  assert.equal((await send([{ id: 'a', method: 'get', url: 'Congress(1)' }, { id: 'a', method: 'get', url: 'Congress(2)' }])).res.status, 400);
  assert.equal((await send([{ id: 'a', method: 'get', url: 'Congress(1)', dependsOn: ['z'] }])).res.status, 400);
  assert.equal((await send([{ id: 'a', method: 'get', url: 'Congress(1)', atomicityGroup: 'g' }, { id: 'b', method: 'get', url: 'Congress(1)' }, { id: 'c', method: 'get', url: 'Congress(1)', atomicityGroup: 'g' }])).res.status, 400);
});

test('each request in a $batch has exactly the access of the batch\'s sign-in', { skip }, async () => {
  const before = count();
  // A view-only account reads, but its writes are refused, the hidden field included.
  const cy = await batch(multipart(['GET Congress(1) HTTP/1.1\r\n', post('Congress', { Name: 'Nope' })]), { ...basic('Cy'), prefer: 'odata.continue-on-error' });
  assert.deepEqual(cy.answers.map((a) => a.status), [200, 403]);
  assert.equal('Party' in cy.answers[0].body!, false);
  // A read-only API token likewise.
  const token = host.get('Charts')!.createApiToken('Ann', { readOnly: true });
  const ro = await batch(multipart([patch('Congress(1)', { State: 'x' }), 'GET Congress(1) HTTP/1.1\r\n']), { authorization: `Bearer ${token}`, prefer: 'odata.continue-on-error' });
  assert.deepEqual(ro.answers.map((a) => a.status), [403, 200]);
  assert.equal(count(), before);

  // No sign-in, or an account without OData, is refused before anything runs.
  assert.equal((await batch(multipart(['GET Congress(1) HTTP/1.1\r\n']), {})).res.status, 401);
  const bo = await batch(multipart(['GET Congress(1) HTTP/1.1\r\n']), basic('Bo'));
  assert.equal(bo.res.status, 403);
  assert.match(bo.text, /fmodata/);

  // Requests reach only the file the batch went to; no batch inside a batch; container files on their own.
  const elsewhere = await batch(multipart([
    `GET ${root}/Other/Congress(1) HTTP/1.1\r\n`, 'GET /fmi/odata/v4/Other/Congress(1) HTTP/1.1\r\n', 'GET ../Other/Congress(1) HTTP/1.1\r\n',
    'GET /tabularius/admin/v1/metrics HTTP/1.1\r\n', 'POST $batch HTTP/1.1\r\n', `GET ${root}/Charts/Congress(1) HTTP/1.1\r\n`,
  ]), { ...basic('Ann'), prefer: 'odata.continue-on-error' });
  assert.deepEqual(elsewhere.answers.map((a) => a.status), [400, 400, 400, 400, 400, 200]);
});

test('a batch stops running requests once its answers are large, and a change set past that keeps nothing', { skip }, async () => {
  const before = count();
  const saved = BATCH_LIMIT.responseBytes;
  BATCH_LIMIT.responseBytes = 50_000;
  try {
    const big = 'GET Congress?$top=200 HTTP/1.1\r\n';
    const set = await batch(multipart([[post('Congress', { Name: 'Too Big' }), big, big, big]]));
    // The answers' messages go with a failure, so a run elsewhere says what went wrong.
    assert.deepEqual(set.answers.map((a) => a.status), [400], JSON.stringify(set.answers.map((a) => a.body)));
    assert.match(set.answers[0].body!.error.message, /none of it was kept/);
    assert.equal(count(), before);
    const loose = await batch(multipart([big, big, big, 'GET Congress(1) HTTP/1.1\r\n']), { ...basic('Ann'), prefer: 'odata.continue-on-error' });
    assert.deepEqual(loose.answers.map((a) => a.status), [200, 400, 400, 400]);
  } finally {
    BATCH_LIMIT.responseBytes = saved;
  }
});

test('$batch bodies that aren\'t a batch are refused', { skip }, async () => {
  const send = (type: string, body: string, method = 'POST') => fetch(`${root}/Charts/$batch`, { method, headers: { ...basic('Ann'), 'content-type': type }, ...(method === 'GET' ? {} : { body }) });
  assert.equal((await send('multipart/mixed', multipart(['GET Congress(1) HTTP/1.1\r\n']))).status, 400);
  assert.equal((await send('text/plain', 'GET Congress(1)')).status, 400);
  assert.equal((await send('multipart/mixed; boundary=batch_b', '--batch_b\r\nContent-Type: application/http\r\n\r\nGET Congress(1) HTTP/1.1\r\n\r\n')).status, 400);
  assert.equal((await send('application/json', '{"requests":', 'POST')).status, 400);
  assert.equal((await send('application/json', '', 'GET')).status, 405);
  // Content-IDs: unique, and no control characters.
  const two = '--batch_b\r\nContent-Type: application/http\r\nContent-ID: 1\r\n\r\nGET Congress(1) HTTP/1.1\r\n\r\n';
  assert.equal((await send('multipart/mixed; boundary=batch_b', `${two}${two}--batch_b--\r\n`)).status, 400);
  assert.equal((await send('multipart/mixed; boundary=batch_b', '--batch_b\r\nContent-Type: application/http\r\nContent-ID: 1\rX\r\n\r\nGET Congress(1) HTTP/1.1\r\n\r\n--batch_b--\r\n')).status, 400);
  const many = { requests: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), method: 'get', url: 'Congress(1)' })) };
  assert.equal((await send('application/json', JSON.stringify(many))).status, 400);
});

test('multipart bodies with bare line feeds and quoted boundaries are read', () => {
  const body = '--"b 1"\nContent-Type: application/http\nContent-ID: x\n\nGET Congress(1) HTTP/1.1\nAccept: application/json\n\n\n--"b 1"--\n'.replaceAll('"b 1"', 'b 1');
  const { units } = batchRequests('multipart/mixed; boundary="b 1"', Buffer.from(body));
  assert.equal(units.length, 1);
  assert.deepEqual({ ...units[0].requests[0], body: units[0].requests[0].body.toString() }, { id: 'x', method: 'GET', url: 'Congress(1)', headers: { accept: 'application/json' }, body: '' });
});

test('a $batch holds 1000 requests, not 1001, and at most BATCH_LIMIT.crossjoins of them are $crossjoin', { skip }, async () => {
  const send = (requests: unknown[]) => fetch(`${root}/Charts/$batch`, { method: 'POST', headers: { ...basic('Ann'), 'content-type': 'application/json', prefer: 'odata.continue-on-error' }, body: JSON.stringify({ requests }) });
  const gets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), method: 'get', url: 'Congress(1)' }));
  const ok = await send(gets(1000));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { responses: unknown[] }).responses.length, 1000);
  const over = await send(gets(1001));
  assert.equal(over.status, 400);
  assert.match(((await over.json()) as { error: { message: string } }).error.message, /at most 1000 requests/);

  // Each $crossjoin runs a worker for up to its time limit: past the cap the rest are refused, whatever they name.
  // Spelled every way: the cap counts the address after it is resolved and decoded.
  const spellings = ['$crossjoin(Congress,Nope)', '%24crossjoin(Congress,Nope)', '$CrossJoin(Congress,Nope)', `${root}/Charts/$crossjoin(Congress,Nope)`, `/fmi/odata/v4/Charts/$crossjoin(Congress,Nope)`, '$crossjoin(Nope,Congress)'];
  const joins = Array.from({ length: BATCH_LIMIT.crossjoins + 2 }, (_, i) => ({ id: `j${i}`, method: 'get', url: spellings[i % spellings.length] }));
  const r = await send([...joins, { id: 'after', method: 'get', url: 'Congress(1)' }]);
  const answers = ((await r.json()) as { responses: { id: string; status: number; body?: { error?: { message: string } } }[] }).responses;
  const capped = answers.filter((a) => /at most \d+ \$crossjoin requests/.test(a.body?.error?.message ?? ''));
  assert.deepEqual(capped.map((a) => a.id), [`j${BATCH_LIMIT.crossjoins}`, `j${BATCH_LIMIT.crossjoins + 1}`]);
  assert.equal(capped[0]!.status, 400);
  // Other requests are not counted.
  assert.equal(answers.find((a) => a.id === 'after')!.status, 200);
});

test('$metadata and the service root of a file need a sign-in, as the records do', { skip }, async () => {
  for (const path of ['/Charts/$metadata', '/Charts', '/Charts/Congress']) {
    const none = await fetch(`${root}${path}`);
    assert.equal(none.status, 401, `${path} without a sign-in`);
    assert.doesNotMatch(await none.text(), /EntityType|Congress|Schema/, `${path} says nothing of the file`);
    assert.equal((await fetch(`${root}${path}`, { headers: { authorization: 'Basic ' + btoa('Ann:wrong') } })).status, 401, `${path} with a wrong password`);
    // Signed in, but the privilege set has no OData access.
    assert.equal((await fetch(`${root}${path}`, { headers: basic('Bo') })).status, 403, `${path} without the fmodata privilege`);
  }
  const meta = await fetch(`${root}/Charts/$metadata`, { headers: basic('Ann') });
  assert.equal(meta.status, 200);
  assert.match(await meta.text(), /EntityType/);
  // What the account may not see is not named.
  const limited = await (await fetch(`${root}/Charts/$metadata`, { headers: basic('Cy') })).text();
  assert.match(limited, /Congress/);
  assert.doesNotMatch(limited, /"Party"/);
});
