import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, basic, openMatrix, request, check, snapshot, session } from './privilege-matrix.ts';

const ROOT = '/fmi/admin/api/v2';
const serverCredential = 'Basic ' + Buffer.from('admin:server-admin-password').toString('base64');
for (const row of SHAPES) test(`Admin API matrix: ${row.name}`, async (t) => {
  const m = await openMatrix(row);
  try {
    const login = await request(m, ROOT + '/user/auth', 'POST', {}, serverCredential);
    check(login, 0, 'server administrator login');
    const admin = 'Bearer ' + login.body.response.token;
    const listed = await request(m, ROOT + '/databases', 'GET', undefined, admin);
    check(listed, 0, 'server administrator sees file');
    const id = listed.body.response.databases[0].id;
    const fileToken = await session(m);
    // A file account, even one with all record permissions, is not the server administrator.
    check(await request(m, ROOT + '/user/auth', 'POST', {}, basic), 212, 'file password cannot mint admin token');
    const operations = [
      ['list files', '/databases', 'GET', undefined],
      ['list clients', '/clients', 'GET', undefined],
      ['pause file', `/databases/${id}`, 'PATCH', { status: 'PAUSED' }],
      ['resume file', `/databases/${id}`, 'PATCH', { status: 'RESUMED' }],
      ['close file', `/databases/${id}`, 'PATCH', { status: 'CLOSED' }],
      ['open file', `/databases/${id}`, 'PATCH', { status: 'OPENED' }],
      ['all files status', '/databases', 'PATCH', { status: 'OPENED' }],
      ['remove file unsupported', `/databases/${id}`, 'DELETE', undefined],
    ] as const;
    for (const [name, path, method, body] of operations) await t.test(name, async () => {
      const before = snapshot(m.store);
      for (const auth of [basic, fileToken ?? 'Bearer unavailable']) {
        check(await request(m, ROOT + path, method, body, auth), 9, 'file credential denied');
        assert.equal(m.host.files()[0].status, 'open');
        assert.deepEqual(snapshot(m.store), before);
      }
    });
    // Separate server authority is the documented exception to cross-surface parity.
    for (const [name, path, method, body] of operations) {
      check(await request(m, ROOT + path, method, body, admin), method === 'DELETE' ? 21 : 0, name);
    }
    assert.equal(m.host.files()[0].status, 'open');
    assert.equal(m.host.get('Matrix')!.find('Items').records.length, 2);
  } finally { await m.close(); }
});

test('a Full Access file account still has no server-administrator authority', async () => {
  const m = await openMatrix(SHAPES[0]);
  try {
    m.store.setPassword('Caller', 'matrix-password', '[Full Access]');
    assert.equal(m.store.privileges('Caller').full, true);
    const token = await session(m);
    for (const auth of [basic, token]) check(await request(m, ROOT + '/databases', 'GET', undefined, auth), 9, 'full file access is not server authority');
  } finally { await m.close(); }
});
