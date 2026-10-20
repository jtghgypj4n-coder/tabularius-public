import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import { serve, setAdminPassword } from '../src/index.ts';

let dir: string;
let server: Server;
let base: string;
let auth: Record<string, string>;
const ids: Record<string, string> = {};
const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const tasks: Record<string, Record<string, unknown>> = {
  backup: { backupType: { resourceType: 'ALL_DB', resource: '', backupTarget: '', retainBackups: 7, clone: false, verifyBackup: false } },
  message: { messageType: { resourceType: 'ALL_CLIENTS', text: 'Scheduled notice' } },
  filemakerscript: { filemakerScriptType: { resource: 'file:Shop.fmp12', fmScriptName: 'Hello', fmScriptParam: 'Original', fmScriptAccount: 'Admin' } },
};

type Reply = { status: number; body: { response: Record<string, any>; messages: { code: string; text: string }[] } };
const call = (path: string, init: RequestInit = {}): Promise<Reply> =>
  fetch(`${base}/fmi/admin/api/v2${path}`, {
    ...init, headers: { 'content-type': 'application/json', ...auth, ...(init.headers as Record<string, string>) },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

function unchunk(text: string): string {
  let out = '';
  for (let at = 0; ;) {
    const end = text.indexOf('\r\n', at);
    const size = parseInt(text.slice(at, end), 16);
    if (!size) return out;
    out += text.slice(end + 2, end + 2 + size);
    at = end + 2 + size + 2;
  }
}

function ok(reply: Reply): void {
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.messages[0].code, '0');
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-adminapi-json-types-'));
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  base = s.url;
  s.host.create('Shop').applyDesign([{ op: 'createScript', name: 'Hello', text: 'Exit Script [ Text Result: "hello" ]' }]);
  const login = await call('/user/auth', { method: 'POST', headers: { authorization: 'Basic ' + btoa('admin:secret') } });
  ok(login);
  auth = { authorization: `Bearer ${login.body.response.token}` };
  for (const [kind, task] of Object.entries(tasks)) {
    const made = await call(`/schedules/${kind}`, {
      method: 'POST', body: JSON.stringify({ name: kind, enabled: true, ...task }),
    });
    ok(made);
    ids[kind] = made.body.response.schedule.id;
  }
});
after(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function snapshot() {
  const listed = await call('/schedules');
  ok(listed);
  return {
    schedules: listed.body.response.schedules,
    saved: readFileSync(join(dir, '.openhbam-schedules.json'), 'utf8'),
  };
}

// Include values that used to coerce successfully, and falsy values that used to bypass validation.
const wrong: Record<string, unknown[]> = {
  string: [null, false, 123, {}, []],
  // a null message text means "not given", as before
  text: [false, 123, {}, []],
  boolean: [null, 'true', 'false', 0, 1, {}, []],
  number: [null, '2', true, false, {}, [], [2]],
  object: [null, 'x', '', true, false, 1, 0, []],
  days: [null, 'SUN', true, 7, {}, [0, 1, 2, 3, 4, 5, 6], ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', {}]],
};
const cases: { kind: string; field: string; type: string }[] = [];
const add = (kind: string, type: string, fields: string[]) => {
  for (const field of fields) cases.push({ kind, field, type });
};
add('backup', 'string', ['name', 'backupType.resourceType', 'backupType.resource', 'backupType.backupTarget']);
add('backup', 'boolean', ['enabled', 'backupType.clone', 'backupType.verifyBackup']);
add('backup', 'number', ['backupType.retainBackups']);
add('backup', 'object', ['backupType', 'scriptSequenceType', 'systemScriptType', 'verifyType', 'onceType', 'weeklyType', 'everyndaysType']);
add('message', 'object', ['messageType']);
add('message', 'string', ['messageType.resourceType']);
add('message', 'text', ['messageType.text', 'messageType.messageText']);
add('filemakerscript', 'object', ['filemakerScriptType']);
add('filemakerscript', 'string', ['filemakerScriptType.resource', 'filemakerScriptType.fmScriptName', 'filemakerScriptType.fmScriptParam', 'filemakerScriptType.fmScriptAccount']);
add('backup', 'days', ['weeklyType.daysOfTheWeek']);
add('backup', 'number', ['everyndaysType.dailyDays']);
for (const timing of ['weeklyType', 'everyndaysType']) {
  add('backup', 'string', [`${timing}.startTimeStamp`, `${timing}.repeatTask.repeatInterval`]);
  add('backup', 'object', [`${timing}.repeatTask`]);
  add('backup', 'number', [`${timing}.repeatTask.repeatFrequency`]);
}

for (const method of ['POST', 'PATCH']) {
  test(`${method} refuses wrong schedule JSON types without changing any schedule`, async (t) => {
    for (const { kind, field, type } of cases) {
      await t.test(field, async () => {
        const before = await snapshot();
        for (const value of wrong[type]) {
          const body: Record<string, any> = {
            name: 'Must not be applied', enabled: false, ...structuredClone(tasks[kind]),
          };
          if (field.startsWith('weeklyType.')) body.weeklyType = { daysOfTheWeek: days };
          const path = field.split('.');
          let object = body;
          for (const key of path.slice(0, -1)) object = object[key] ??= {};
          object[path.at(-1)!] = value;
          const reply = await call(`/schedules/${method === 'POST' ? kind : ids[kind]}`, {
            method, body: JSON.stringify(body),
          });
          const context = `${field}: ${JSON.stringify(value)}: ${JSON.stringify(reply.body)}`;
          assert.equal(reply.status, 400, context);
          assert.equal(reply.body.messages[0].code, '960', context);
          assert.ok(reply.body.messages[0].text.startsWith(`Parameter is invalid: ${field} `), context);
          assert.deepEqual(reply.body.response, {}, context);
          assert.deepEqual(await snapshot(), before, context);
        }
      });
    }
  });
}

test('an 11 MB PATCH preserves 413 and leaves schedules unchanged', { timeout: 10_000 }, async () => {
  const before = await snapshot();
  const body = JSON.stringify({ name: 'x'.repeat(11 * 1024 * 1024), enabled: false });
  // A raw socket, because node:http's client drops the answer when the rest of its upload fails (EPIPE).
  const url = new URL(base);
  const raw = await new Promise<string>((resolve) => {
    const parts: Buffer[] = [];
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(`PATCH /fmi/admin/api/v2/schedules/${ids.backup} HTTP/1.1\r\nHost: ${url.host}\r\n` +
        `Authorization: ${auth.authorization}\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`);
      // Send one byte over the 10 MB limit and stop: with no unread upload bytes left, closing cannot reset
      // the connection and discard the answer. Content-Length still declares the full 11 MB body.
      socket.write(Buffer.from(body).subarray(0, 10 * 1024 * 1024 + 1));
    });
    socket.on('data', (part: Buffer) => parts.push(part));
    socket.on('error', () => {});
    socket.on('close', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
  const [head, ...rest] = raw.split('\r\n\r\n');
  const text = rest.join('\r\n\r\n');
  const reply = { status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0), text: /chunked/i.test(head) ? unchunk(text) : text };
  assert.equal(reply.status, 413);
  assert.deepEqual(JSON.parse(reply.text), { response: {}, messages: [{ code: '960', text: 'Request body too large' }] });
  assert.deepEqual(await snapshot(), before);
});

test('PATCH refuses a non-string status, and a running status with a wrong type does not start the schedule', async () => {
  const before = await snapshot();
  for (const body of [{ status: ['running'] }, { status: true }, { status: 'RUNNING', enabled: 'true' }]) {
    const reply = await call(`/schedules/${ids.backup}`, { method: 'PATCH', body: JSON.stringify(body) });
    const context = `${JSON.stringify(body)}: ${JSON.stringify(reply.body)}`;
    assert.equal(reply.status, 400, context);
    assert.equal(reply.body.messages[0].code, '960', context);
    assert.deepEqual(await snapshot(), before, context);
  }
});

// A null message text keeps its earlier meaning (not given), so it is never refused as a wrong type.
test('a null message text is not refused as a wrong type', async () => {
  for (const text of ['text', 'messageText']) {
    const reply = await call(`/schedules/${ids.message}`, { method: 'PATCH', body: JSON.stringify({ messageType: { [text]: null } }) });
    assert.notEqual(reply.body.messages[0].code, '960', `${text}: ${JSON.stringify(reply.body)}`);
  }
});

test('malformed JSON still returns 400 and leaves schedules unchanged', async () => {
  const before = await snapshot();
  const reply = await call(`/schedules/${ids.backup}`, { method: 'PATCH', body: '{' });
  assert.equal(reply.status, 400);
  assert.deepEqual(reply.body, { response: {}, messages: [{ code: '960', text: 'Parameter is invalid: the body is not JSON' }] });
  assert.deepEqual(await snapshot(), before);
});

test('valid schedule types keep defaults, aliases, partial edits and timing conversions', async () => {
  const edits = [
    { kind: 'backup', body: { backupType: { retainBackups: 2 } }, check: (s: any) => assert.equal(s.backupType.retainBackups, 2) },
    { kind: 'message', body: { messageType: { resourceType: 'all_clients', messageText: 'Alias notice' } }, check: (s: any) => assert.equal(s.messageType.text, 'Alias notice') },
    { kind: 'filemakerscript', body: { filemakerScriptType: { resource: 'file:Shop', fmScriptParam: '' } }, check: (s: any) => assert.equal(s.filemakerScriptType.fmScriptParam, '') },
    { kind: 'backup', body: { everyndaysType: { dailyDays: 3, startTimeStamp: '2026-01-01T02:30:00' } }, check: (s: any) => {
      assert.equal(s.everyndaysType.dailyDays, 3);
      assert.match(s.everyndaysType.startTimeStamp, /T02:30:00$/);
    } },
    { kind: 'backup', body: { weeklyType: { daysOfTheWeek: days, repeatTask: { repeatFrequency: 2 } } }, check: (s: any) => {
      assert.equal(s.everyndaysType.repeatTask.repeatFrequency, 2);
      assert.equal(s.everyndaysType.repeatTask.repeatInterval, 'HOURS');
    } },
    { kind: 'backup', body: { everyndaysType: { repeatTask: { repeatFrequency: 15, repeatInterval: 'minutes' } } }, check: (s: any) => {
      assert.equal(s.everyndaysType.repeatTask.repeatFrequency, 15);
      assert.equal(s.everyndaysType.repeatTask.repeatInterval, 'MINUTES');
    } },
    { kind: 'backup', body: { name: '  Trimmed  ', enabled: false, backupType: {}, everyndaysType: {} }, check: (s: any) => {
      assert.equal(s.name, 'Trimmed');
      assert.equal(s.enabled, false);
      assert.equal(s.everyndaysType.dailyDays, 1);
    } },
  ];
  for (const { kind, body, check } of edits) {
    const reply = await call(`/schedules/${ids[kind]}`, { method: 'PATCH', body: JSON.stringify(body) });
    ok(reply);
    check(reply.body.response.schedule);
  }
  const made = await call('/schedules/backup', { method: 'POST', body: JSON.stringify({ name: 'Defaults', backupType: {} }) });
  ok(made);
  assert.equal(made.body.response.schedule.enabled, false);
  assert.equal(made.body.response.schedule.backupType.retainBackups, 7);
  assert.equal(made.body.response.schedule.everyndaysType.dailyDays, 1);
});
