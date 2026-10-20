// Calendar feeds and .ics import for date fields: what the feed carries, who may open it (and how a link in a
// calendar app stays harmless), the cap, and the import.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type PrivilegeDefinition, type Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { MAX_EVENTS, createFeed } from '../src/calendar.ts';
import { unfold } from '../../store/src/calendar.ts';
import { referenceParse } from '../../store/test/ics-reference.ts';
import type { Host } from '../src/host.ts';

const OPEN = { view: true, edit: true, create: true, delete: true };
const FIELDS = [
  { name: 'Title' }, { name: 'Day', type: 'date' }, { name: 'DayEnd', type: 'date' }, { name: 'Starts', type: 'timestamp' },
  { name: 'Ends', type: 'timestamp' }, { name: 'Notes' }, { name: 'Place' }, { name: 'Code' },
];

interface Running { url: string; store: Store; host: Host; dir: string; logs: string[]; get: (path: string, headers?: Record<string, string>) => Promise<{ status: number; headers: Headers; text: string }>; post: (path: string, body: string, headers?: Record<string, string>) => Promise<{ status: number; text: string; json: any }> }

async function start(t: TestContext, mode: 'native' | 'compat' = 'native'): Promise<Running> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-calendar-'));
  createStore(join(dir, 'Planner.openhbam.sqlite'), mode === 'native' ? { mode: 'native' } : undefined);
  const logs: string[] = [];
  const running = await serve({ dir, port: 0, log: (m) => { logs.push(m); } });
  t.after(async () => {
    await new Promise<void>((resolve) => running.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const store = running.host.get('Planner')!;
  store.setAiPolicy(false);
  store.applyDesign([{ op: 'createTable', name: 'Events', fields: FIELDS as never }]);
  store.savePrivilegeSet({ name: 'Planner', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  store.setPassword('ann', 'pw', 'Planner');
  const session = await fetch(`${running.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('ann:pw'), 'content-type': 'application/json' }, body: '{}' });
  const bearer = { authorization: `Bearer ${((await session.json()) as any).response.token}` };
  return {
    url: running.url, store, host: running.host, dir, logs,
    get: async (path, headers = bearer) => {
      const r = await fetch(running.url + path, { headers });
      return { status: r.status, headers: r.headers, text: await r.text() };
    },
    post: async (path, body, headers = bearer) => {
      const r = await fetch(running.url + path, { method: 'POST', headers: { ...headers, 'content-type': 'text/calendar' }, body });
      const text = await r.text();
      return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
    },
  };
}

const feed = (layout = 'Events', query = '') => `/tabularius/calendar/v1/databases/Planner/layouts/${layout}/calendar.ics${query}`;
const importer = (layout = 'Events', query = '') => `/tabularius/calendar/v1/databases/Planner/layouts/${layout}/calendar-import${query}`;
const prop = (event: { name: string; params: string; value: string }[], name: string) => event.find((p) => p.name === name);

for (const mode of ['native', 'compat'] as const) {
  test(`${mode} file: a feed of all-day events and one of timed events, valid iCalendar`, async (t) => {
    const s = await start(t, mode);
    s.store.create('Events', { Title: 'Conference, day 1; "main" hall', Day: '2026-10-16', DayEnd: '2026-10-18', Notes: 'Bring ID\nBadge at desk', Place: 'Hall 2' });
    s.store.create('Events', { Title: 'Standup', Day: '2026-10-19' });
    s.store.create('Events', { Title: 'No date at all' });

    const days = await s.get(feed('Events', '?start=Day&end=DayEnd&title=Title&description=Notes&location=Place'));
    assert.equal(days.status, 200, days.text);
    assert.match(days.headers.get('content-type')!, /^text\/calendar; charset=utf-8$/);
    assert.equal(days.headers.get('x-tabularius-events'), '2');
    assert.equal(days.headers.get('x-tabularius-skipped'), '1');
    assert.equal(days.headers.get('cache-control'), 'private, no-store');
    assert.equal(days.headers.get('referrer-policy'), 'no-referrer');
    const [conf, standup] = referenceParse(days.text);
    assert.equal(prop(conf, 'DTSTART')!.value, '20261016');
    assert.equal(prop(conf, 'DTEND')!.value, '20261019');
    assert.equal(prop(conf, 'SUMMARY')!.value, 'Conference\\, day 1\\; "main" hall');
    assert.equal(prop(conf, 'DESCRIPTION')!.value, 'Bring ID\\nBadge at desk');
    assert.equal(prop(conf, 'LOCATION')!.value, 'Hall 2');
    assert.equal(prop(standup, 'DTSTART')!.value, '20261019');
    assert.equal(prop(standup, 'DTEND'), undefined);
    assert.match(days.text, /X-WR-CALNAME:Events\r\n/);

    s.store.create('Events', { Title: 'Dentist', Starts: '2026-10-20T09:30:00', Ends: '2026-10-20T10:15:00' });
    const timed = await s.get(feed('Events', '?start=Starts&end=Ends&title=Title'));
    const [dentist] = referenceParse(timed.text);
    assert.equal(prop(dentist, 'DTSTART')!.value, '20261020T093000', 'no zone given: a floating time');
    assert.equal(prop(dentist, 'DTEND')!.value, '20261020T101500');
    const utc = referenceParse((await s.get(feed('Events', '?start=Starts&zone=UTC'))).text)[0];
    assert.equal(prop(utc, 'DTSTART')!.value, '20261020T093000Z');
    const london = referenceParse((await s.get(feed('Events', '?start=Starts&zone=Europe/London'))).text)[0];
    assert.equal(prop(london, 'DTSTART')!.value, '20261020T083000Z', 'British Summer Time is one hour ahead');
    assert.equal((await s.get(feed('Events', '?start=Starts&zone=Nowhere/Land'))).status, 400);
  });
}

test('a record keeps its UID across reads and edits, and its SEQUENCE counts the changes', async (t) => {
  const s = await start(t);
  const { recordId } = s.store.create('Events', { Title: 'A', Day: '2026-10-16' });
  const first = referenceParse((await s.get(feed('Events', '?start=Day&title=Title'))).text)[0];
  s.store.update('Events', recordId, { Title: 'A, renamed' });
  s.store.create('Events', { Title: 'Another', Day: '2026-10-17' });
  const events = referenceParse((await s.get(feed('Events', '?start=Day&title=Title'))).text);
  assert.equal(prop(events[0], 'UID')!.value, prop(first, 'UID')!.value);
  assert.notEqual(prop(events[1], 'UID')!.value, prop(events[0], 'UID')!.value);
  assert.match(prop(events[0], 'UID')!.value, /^\d+\.[0-9a-f]{12}@tabularius$/);
  assert.ok(Number(prop(events[0], 'SEQUENCE')?.value ?? 0) > Number(prop(first, 'SEQUENCE')?.value ?? 0));
  assert.equal(prop(events[0], 'SUMMARY')!.value, 'A\\, renamed');
});

test('text from a record cannot add properties or events to the feed', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'Hi\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:evil@x\r\nSUMMARY:injected', Day: '2026-10-16', Notes: 'a\r\nBEGIN:VALARM\r\nACTION:EMAIL\r\nEND:VALARM', Place: 'x\u0007y\u2028z' });
  const out = await s.get(feed('Events', '?start=Day&title=Title&description=Notes&location=Place'));
  const events = referenceParse(out.text);
  assert.equal(events.length, 1);
  assert.ok(!unfold(out.text).some((l) => /^(BEGIN:VALARM|ACTION:)/.test(l)), 'the text did not become properties');
  assert.equal(events[0].filter((p) => p.name === 'UID').length, 1);
  assert.equal(prop(events[0], 'LOCATION')!.value, 'xyz');
});

test('long and non-ASCII text folds at 75 octets and reads back whole', async (t) => {
  const s = await start(t);
  const title = ('Ünïcödé 🙂 '.repeat(30)).trim();
  s.store.create('Events', { Title: title, Day: '2026-10-16' });
  const out = await s.get(feed('Events', '?start=Day&title=Title'));
  const [event] = referenceParse(out.text);
  assert.ok(out.text.split('\r\n').some((l) => l.startsWith(' ')), 'it did fold');
  assert.equal(prop(event, 'SUMMARY')!.value.replace(/\\,/g, ',').replace(/\\;/g, ';'), title);
});

test('daylight saving: timed events either side of the change keep their local clock time', async (t) => {
  const s = await start(t);
  for (const [i, at] of ['2026-03-08T01:30:00', '2026-03-08T02:30:00', '2026-03-08T03:30:00', '2026-11-01T01:30:00', '2026-11-01T02:30:00'].entries()) s.store.create('Events', { Title: String(i), Starts: at });
  const out = referenceParse((await s.get(feed('Events', '?start=Starts&title=Title&zone=America/New_York'))).text);
  assert.deepEqual(out.map((e) => prop(e, 'DTSTART')!.value), [
    '20260308T063000Z', // 01:30 EST
    '20260308T073000Z', // 02:30 does not exist: moved forward to 03:30 EDT
    '20260308T073000Z', // 03:30 EDT
    '20261101T053000Z', // 01:30 happens twice: the first (EDT)
    '20261101T073000Z', // 02:30 EST
  ]);
});

test('repeating field values and odd dates are skipped, not guessed', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'ok', Starts: '2026-10-16T09:00:00' });
  s.store.create('Events', { Title: 'blank' });
  const out = await s.get(feed('Events', '?start=Starts&title=Title'));
  assert.equal(out.headers.get('x-tabularius-events'), '1');
  assert.equal(out.headers.get('x-tabularius-skipped'), '1');
});

test('start and end must be date or timestamp fields of the same kind, on the layout', async (t) => {
  const s = await start(t);
  const code = async (q: string) => (await s.get(feed('Events', q))).status;
  assert.equal(await code(''), 400, 'start is required');
  assert.equal(await code('?start=Title'), 400);
  assert.equal(await code('?start=Day&end=Starts'), 400);
  assert.equal(await code('?start=Nope'), 400);
  assert.equal(await code('?start=Day&title=Nope'), 400);
  assert.equal(await code('?start=Day&query=%5B%22x%22%5D'), 400);
  assert.equal(await code('?start=Day&query=%7Bbad'), 400);
  assert.equal(await code('?start=Day&limit=0'), 400);
  assert.equal(await code(`?start=Day&limit=${MAX_EVENTS + 1}`), 400);
  assert.equal(await code('?start=Day'), 200);
  assert.equal((await s.get(feed('Missing', '?start=Day'))).status, 404);
  const post = await fetch(s.url + feed('Events', '?start=Day'), { method: 'POST' });
  assert.equal(post.status, 405);
});

test('the cap is an error naming the count, never a feed missing events; query and limit work within it', async (t) => {
  const s = await start(t);
  for (let i = 0; i < 12; i++) s.store.create('Events', { Title: i < 4 ? 'keep' : 'drop', Day: '2026-10-16', Code: String(i) });
  const capped = await s.get(feed('Events', '?start=Day&limit=10'));
  assert.equal(capped.status, 413);
  assert.match(JSON.parse(capped.text).messages[0].message, /12 events, more than the 10 it may hold: narrow it with query or raise limit/);
  assert.ok(!capped.text.includes('BEGIN:VCALENDAR'));
  const narrowed = await s.get(feed('Events', `?start=Day&limit=10&title=Title&query=${encodeURIComponent(JSON.stringify([{ Title: '==keep' }]))}`));
  assert.equal(narrowed.status, 200, narrowed.text);
  assert.equal(narrowed.headers.get('x-tabularius-events'), '4');
  const all = await s.get(feed('Events', '?start=Day'));
  assert.equal(all.headers.get('x-tabularius-events'), '12');
});

// --- who may open it ----------------------------------------------------------------------------------------------------

test('a feed needs a sign-in; a link token must be read-only and scoped to this one layout', async (t) => {
  const s = await start(t);
  s.store.applyDesign([{ op: 'createLayout', name: 'Other', occurrence: 'Events' }]);
  s.store.create('Events', { Title: 'A', Day: '2026-10-16' });
  const q = '?start=Day&title=Title';
  assert.equal((await s.get(feed('Events', q), {})).status, 401, 'no credentials');
  assert.equal((await s.get(feed('Events', q), { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await s.get(feed('Events', q), { authorization: 'Basic ' + btoa('ann:pw') })).status, 401, 'password sign-in is not offered here');

  const link = s.store.createApiToken('ann', { readOnly: true, layouts: ['Events'], label: 'phone calendar' });
  const ok = await s.get(feed('Events', `${q}&token=${encodeURIComponent(link)}`), {});
  assert.equal(ok.status, 200, ok.text);
  assert.equal(referenceParse(ok.text).length, 1);
  assert.equal(ok.text.includes(link), false, 'the token is not echoed');

  const refused = async (token: string, layout = 'Events') => (await s.get(feed(layout, `${q}&token=${encodeURIComponent(token)}`), {}));
  const writable = s.store.createApiToken('ann', { layouts: ['Events'] });
  const unscoped = s.store.createApiToken('ann', { readOnly: true });
  const twoLayouts = s.store.createApiToken('ann', { readOnly: true, layouts: ['Events', 'Other'] });
  const elsewhere = s.store.createApiToken('ann', { readOnly: true, layouts: ['Other'] });
  for (const [what, token] of [['a token that can write', writable], ['one with no layout scope', unscoped], ['one scoped to two layouts', twoLayouts]] as const) {
    const r = await refused(token);
    assert.equal(r.status, 403, what);
    assert.ok(!r.text.includes(token));
    assert.ok(!r.text.includes('BEGIN:VCALENDAR'));
  }
  assert.equal((await refused(elsewhere)).status, 403, 'a token for another layout');
  const sessionToken = (await (await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('ann:pw'), 'content-type': 'application/json' }, body: '{}' })).json() as any).response.token;
  assert.equal((await refused(sessionToken)).status, 403, 'a sign-in session is never accepted in the address');
  // The same tokens work in the header, where they are not written to access logs by anything in front of the server.
  assert.equal((await s.get(feed('Events', q), { authorization: `Bearer ${writable}` })).status, 200);

  // Revoking the token ends the link at once.
  s.store.revokeApiToken(link.slice(5, link.indexOf('.')));
  assert.equal((await refused(link)).status, 401);
});

test('the link token is redacted in the server log', async (t) => {
  const s = await start(t);
  const link = s.store.createApiToken('ann', { readOnly: true, layouts: ['Events'] });
  await s.get(feed('Events', `?start=Day&token=${encodeURIComponent(link)}`), {});
  await new Promise((r) => setTimeout(r, 1500));
  s.host.logs?.flush?.();
  const logDir = join(s.dir, 'Logs');
  let text = '';
  try { for (const f of readdirSync(logDir)) text += readFileSync(join(logDir, f), 'utf8'); } catch { /* logs are written lazily */ }
  assert.ok(!text.includes(link.slice(5)), 'no log line holds the token');
  assert.ok(!s.logs.some((l) => l.includes(link.slice(5))));
});

test('an account sees only the records and fields it may: the feed cannot widen what the Data API shows', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'Public', Day: '2026-10-16', Notes: 'for everyone', Code: 'S-1' });
  s.store.create('Events', { Title: 'Private', Day: '2026-10-17', Notes: 'staff only', Code: 'S-2' });
  const limited: PrivilegeDefinition = {
    name: 'Limited', records: { view: false, edit: false, create: false, delete: false },
    tables: { Events: { view: 'Title = "Public"', edit: false, create: false, delete: false, fields: { Code: 'none', Notes: 'masked' } as never } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
  };
  s.store.savePrivilegeSet(limited);
  s.store.setPassword('lim', 'pw', 'Limited');
  const token = s.store.createApiToken('lim', { readOnly: true, layouts: ['Events'] });
  const auth = { authorization: `Bearer ${token}` };
  const out = await s.get(feed('Events', '?start=Day&title=Title&description=Notes'), auth);
  assert.equal(out.status, 200, out.text);
  const events = referenceParse(out.text);
  assert.equal(events.length, 1, 'the record the account may not view is not in the feed');
  assert.ok(!out.text.includes('Private') && !out.text.includes('staff only'));
  assert.ok(!out.text.includes('for everyone'), 'a masked field shows its mask, not its value');
  // A field the account cannot see is as if it were not there: no way to read it, or to search by it.
  assert.equal((await s.get(feed('Events', '?start=Day&title=Code'), auth)).status, 400);
  const probe = await s.get(feed('Events', `?start=Day&query=${encodeURIComponent(JSON.stringify([{ Code: 'S-2' }]))}`), auth);
  assert.notEqual(probe.status, 200, 'finding by a hidden field is refused');
  // A layout the account has no access to.
  s.store.savePrivilegeSet({ ...limited, layoutAccess: { Events: { layout: 'none', records: 'none' } } });
  assert.equal((await s.get(feed('Events', '?start=Day'), auth)).status, 401, 'the changed authority revoked the token');
  const renewed = { authorization: `Bearer ${s.store.createApiToken('lim', { readOnly: true, layouts: ['Events'] })}` };
  assert.equal((await s.get(feed('Events', '?start=Day'), renewed)).status, 404);
});

// --- import -------------------------------------------------------------------------------------------------------------

const ics = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//t//EN', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.split('\n'), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n') + '\r\n';

for (const mode of ['native', 'compat'] as const) {
  test(`${mode} file: import reads all-day, floating, UTC and zoned events into the mapped fields`, async (t) => {
    const s = await start(t, mode);
    const body = ics(
      'UID:a@x\nDTSTART;VALUE=DATE:20261016\nDTEND;VALUE=DATE:20261019\nSUMMARY:Away\\, back Monday\nDESCRIPTION:Line one\\nLine two\nLOCATION:Lisbon',
      'UID:b@x\nDTSTART:20261020T093000\nDTEND:20261020T101500\nSUMMARY:Floating',
      'UID:c@x\nDTSTART:20261021T093000Z\nSUMMARY:Utc',
      'UID:d@x\nDTSTART;TZID=America/New_York:20261022T090000\nSUMMARY:Zoned',
    );
    const timed = await s.post(importer('Events', '?start=Starts&end=Ends&title=Title&description=Notes&location=Place&uid=Code'), body);
    assert.equal(timed.status, 200, timed.text);
    assert.equal(timed.json.imported, 4);
    assert.ok(timed.json.notes.some((n: string) => /UTC clock reading/.test(n)));
    const rows = s.store.find('Events', { dateFormat: 'iso', limit: 50 }).records.map((r) => r.fieldData);
    const by = (title: string) => rows.find((r) => r.Title === title)!;
    assert.equal(by('Away, back Monday').Starts, '2026-10-16T00:00:00');
    assert.equal(by('Away, back Monday').Ends, '2026-10-19T00:00:00', 'an all-day end read into a timestamp is the exclusive end the file gave');
    assert.equal(by('Away, back Monday').Notes, 'Line one\nLine two');
    assert.equal(by('Away, back Monday').Place, 'Lisbon');
    assert.equal(by('Away, back Monday').Code, 'a@x');
    assert.equal(by('Floating').Starts, '2026-10-20T09:30:00');
    assert.equal(by('Floating').Ends, '2026-10-20T10:15:00');
    assert.equal(by('Utc').Starts, '2026-10-21T09:30:00');
    assert.equal(by('Zoned').Starts, '2026-10-22T09:00:00');
  });
}

test('import into a date field: inclusive end dates, zone conversion, and the report says what it did', async (t) => {
  const s = await start(t);
  const body = ics(
    'UID:a@x\nDTSTART;VALUE=DATE:20261016\nDTEND;VALUE=DATE:20261019\nSUMMARY:Three days',
    'UID:b@x\nDTSTART;VALUE=DATE:20261020\nDTEND;VALUE=DATE:20261021\nSUMMARY:One day',
    'UID:c@x\nDTSTART:20261021T233000Z\nSUMMARY:Late UTC',
    'DTSTART:garbage\nSUMMARY:No start',
  );
  const r = await s.post(importer('Events', '?start=Day&end=DayEnd&title=Title&zone=Asia/Tokyo'), body);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.imported, 3);
  assert.ok(r.json.notes.some((n: string) => /no readable start was skipped \(1\)/.test(n)));
  assert.ok(!r.json.notes.some((n: string) => /UTC clock reading/.test(n)), 'a zone was given, so no warning');
  const rows = s.store.find('Events', { dateFormat: 'iso', limit: 50 }).records.map((x) => x.fieldData);
  const by = (title: string) => rows.find((x) => x.Title === title)!;
  assert.equal(by('Three days').Day, '2026-10-16');
  assert.equal(by('Three days').DayEnd, '2026-10-18', 'the file\'s exclusive end is the 19th; the last day is the 18th');
  assert.equal(by('One day').DayEnd, '2026-10-20');
  assert.equal(by('Late UTC').Day, '2026-10-22', '23:30 UTC is already the 22nd in Tokyo');
  // The report holds counts and reasons only, none of the file's text.
  assert.ok(!JSON.stringify(r.json).includes('Three days'));
});

test('importing a repeating event makes one record per occurrence, up to a cap, and says so', async (t) => {
  const s = await start(t);
  const r = await s.post(importer('Events', '?start=Starts&title=Title'), ics(
    'UID:w@x\nDTSTART:20261005T090000\nRRULE:FREQ=WEEKLY;COUNT=4\nSUMMARY:Weekly',
    'UID:e@x\nDTSTART:20261005T100000\nRRULE:FREQ=DAILY\nSUMMARY:Endless',
    'UID:u@x\nDTSTART:20261005T110000\nRRULE:FREQ=MONTHLY;BYDAY=2TU\nSUMMARY:Unread rule',
  ));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.imported, 4 + 366 + 1);
  assert.ok(r.json.notes.some((n: string) => /cut at 366/.test(n)));
  assert.ok(r.json.notes.some((n: string) => /first occurrence was imported/.test(n)));
});

test('import is all or nothing, and follows the account\'s create and field privileges', async (t) => {
  const s = await start(t);
  s.store.savePrivilegeSet({ name: 'Reader', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] });
  s.store.setPassword('rae', 'pw', 'Reader');
  const session = await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('rae:pw'), 'content-type': 'application/json' }, body: '{}' });
  const reader = { authorization: `Bearer ${((await session.json()) as any).response.token}` };
  const before = s.store.find('Events', {}).foundCount;
  const refused = await s.post(importer('Events', '?start=Starts&title=Title'), ics('DTSTART:20261005T090000\nSUMMARY:x'), reader);
  assert.equal(refused.status, 403, refused.text);
  assert.equal(s.store.find('Events', {}).foundCount, before, 'nothing was made');

  // A failure part way through leaves none of the earlier events behind.
  s.store.savePrivilegeSet({ name: 'Planner', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
    tables: { Events: { view: true, edit: true, create: true, delete: true, fields: { Place: 'none' } as never } } });
  const stale = await s.post(importer('Events', '?start=Starts&title=Title'), ics('DTSTART:20261005T090000\nSUMMARY:x'));
  assert.equal(stale.status, 401, 'the changed authority ended the first sign-in');
  const planner = await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('ann:pw'), 'content-type': 'application/json' }, body: '{}' });
  const signedIn = { authorization: `Bearer ${((await planner.json()) as any).response.token}` };
  const half = await s.post(importer('Events', '?start=Starts&title=Title'), ics('DTSTART:20261005T090000\nSUMMARY:one', 'DTSTART:20261006T090000\nSUMMARY:two'), signedIn);
  assert.equal(half.status, 200, half.text);
  const hidden = await s.post(importer('Events', '?start=Starts&location=Place'), ics('DTSTART:20261005T090000\nLOCATION:x'), signedIn);
  assert.equal(hidden.status, 400, 'a field the account cannot see cannot be mapped');
  assert.equal(s.store.find('Events', {}).foundCount, before + 2);
});

test('import needs a header sign-in with a writable token, a real .ics body and a start field', async (t) => {
  const s = await start(t);
  const q = '?start=Starts&title=Title';
  assert.equal((await s.post(importer('Events', q), ics('DTSTART:20261005T090000\nSUMMARY:x'), {})).status, 401);
  const link = s.store.createApiToken('ann', { readOnly: true, layouts: ['Events'] });
  assert.equal((await s.post(importer('Events', `${q}&token=${encodeURIComponent(link)}`), ics('DTSTART:20261005T090000\nSUMMARY:x'), {})).status, 403, 'the address token opens feeds only');
  assert.equal((await s.post(importer('Events', q), ics('DTSTART:20261005T090000\nSUMMARY:x'), { authorization: `Bearer ${link}` })).status, 403, 'a read-only token cannot import');
  assert.equal((await s.post(importer('Events', q), 'not a calendar')).status, 400);
  assert.equal((await s.post(importer('Events', ''), ics('DTSTART:20261005T090000\nSUMMARY:x'))).status, 400);
  assert.equal(s.store.find('Events', {}).foundCount, 0);
  const get = await fetch(s.url + importer('Events', q));
  assert.equal(get.status, 405);
});

test('a feed read back through the import makes the same events', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'One, two; three', Starts: '2026-10-16T09:00:00', Ends: '2026-10-16T10:30:00', Notes: 'a\nb', Place: 'Room 1' });
  s.store.create('Events', { Title: 'Second', Starts: '2026-10-17T14:00:00' });
  const out = await s.get(feed('Events', '?start=Starts&end=Ends&title=Title&description=Notes&location=Place'));
  const other = await start(t);
  const r = await other.post(importer('Events', '?start=Starts&end=Ends&title=Title&description=Notes&location=Place'), out.text);
  assert.equal(r.json.imported, 2, r.text);
  const rows = other.store.find('Events', { dateFormat: 'iso', limit: 10, sort: [{ fieldName: 'Starts' }] }).records.map((x) => x.fieldData);
  assert.equal(rows[0].Title, 'One, two; three');
  assert.equal(rows[0].Ends, '2026-10-16T10:30:00');
  assert.equal(rows[0].Notes, 'a\nb');
  assert.equal(rows[1].Starts, '2026-10-17T14:00:00');
});

test('a hostile .ics (huge intervals and durations, the last day of the calendar) is answered, never a server error', async (t) => {
  const s = await start(t);
  const body = ics(
    'UID:a@x\nDTSTART:99991231T230000\nDURATION:P99999999W\nRRULE:FREQ=DAILY;INTERVAL=1000000000;COUNT=9\nSUMMARY:far',
    'UID:b@x\nDTSTART;VALUE=DATE:99991231\nDTEND;VALUE=DATE:99991231\nRRULE:FREQ=YEARLY;COUNT=3\nSUMMARY:end',
    'UID:c@x\nDTSTART:00010101T000000\nSUMMARY:before the calendar starts',
  );
  const r = await s.post(importer('Events', '?start=Starts&end=Ends&title=Title'), body);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.imported, 2);
  assert.ok(r.json.notes.some((n: string) => /no readable start was skipped \(1\)/.test(n)));
  const rows = s.store.find('Events', { dateFormat: 'iso', limit: 10, sort: [{ fieldName: 'Starts' }] }).records.map((x) => x.fieldData);
  assert.equal(rows[0].Starts, '9999-12-31T00:00:00');
  assert.equal(rows[1].Starts, '9999-12-31T23:00:00');
  assert.equal(rows[1].Ends, '', 'an end past year 9999 is not stored');
  const out = await s.get(feed('Events', '?start=Starts&end=Ends'));
  assert.equal(out.status, 200);
  referenceParse(out.text);
});

test('a login session or a broader token in a feed address is refused without being used', async (t) => {
  const s = await start(t);
  const used = t.mock.method(s.store, 'recordUsage');
  const q = '?start=Day&token=';
  const session = (await (await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('ann:pw'), 'content-type': 'application/json' }, body: '{}' })).json() as any).response.token;
  const before = used.mock.callCount();
  assert.equal((await s.get(feed('Events', q + session), {})).status, 403);
  const writable = s.store.createApiToken('ann', { layouts: ['Events'] });
  const unscoped = s.store.createApiToken('ann', { readOnly: true });
  assert.equal((await s.get(feed('Events', q + writable), {})).status, 403);
  assert.equal((await s.get(feed('Events', q + unscoped), {})).status, 403);
  assert.equal(used.mock.callCount(), before, 'nothing signed in with them, so no session was refreshed');
  const link = s.store.createApiToken('ann', { readOnly: true, layouts: ['Events'] });
  assert.equal((await s.get(feed('Events', q + link), {})).status, 200);
  assert.ok(used.mock.callCount() > before, 'the proper link does sign in');
});

test('the token is cut from the log however its name is written', async (t) => {
  const s = await start(t);
  const link = s.store.createApiToken('ann', { readOnly: true, layouts: ['Events'] });
  const encoded = await s.get(feed('Events', `?start=Day&tok%65n=${encodeURIComponent(link)}`), {});
  assert.equal(encoded.status, 200, 'the encoded name is the same parameter');
  await s.get(feed('Events', `?start=Day&%74oken=${encodeURIComponent(link)}x`), {});
  await new Promise((r) => setTimeout(r, 1500));
  let text = '';
  try { for (const f of readdirSync(join(s.dir, 'Logs'))) text += readFileSync(join(s.dir, 'Logs', f), 'utf8'); } catch { /* logs are written lazily */ }
  assert.ok(text.includes('calendar.ics'), 'the request was logged');
  assert.ok(!text.includes(link.slice(5)), 'but not the token');
});

test('a masked field cannot be a date or an import target: 400, never a server error', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'x', Day: '2026-10-16', Notes: 'hello' });
  s.store.savePrivilegeSet({ name: 'Masker', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'],
    tables: { Events: { view: true, edit: true, create: true, delete: true, fields: { Day: 'masked', Notes: 'masked' } as never } } });
  s.store.setPassword('mia', 'pw', 'Masker');
  const session = await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('mia:pw'), 'content-type': 'application/json' }, body: '{}' });
  const auth = { authorization: `Bearer ${((await session.json()) as any).response.token}` };
  assert.equal((await s.get(feed('Events', '?start=Day'), auth)).status, 400);
  const shown = await s.get(feed('Events', '?start=Starts&title=Notes'), auth);
  assert.equal(shown.status, 200, 'a feed\'s title may show the mask, as the Data API does');
  assert.ok(!shown.text.includes('hello'));
  assert.equal((await s.post(importer('Events', '?start=Starts&title=Notes'), ics('DTSTART:20261005T090000\nSUMMARY:x'), auth)).status, 400);
});

test('the operator\'s Data API limit caps a feed too', async (t) => {
  const s = await start(t);
  for (let i = 0; i < 4; i++) s.store.create('Events', { Day: '2026-10-16' });
  t.after(() => { delete process.env.TABULARIUS_DATA_API_MAX_LIMIT; });
  process.env.TABULARIUS_DATA_API_MAX_LIMIT = '3';
  const over = await s.get(feed('Events', '?start=Day'));
  assert.equal(over.status, 413);
  assert.match(JSON.parse(over.text).messages[0].message, /4 events, more than the 3 it may hold/);
  assert.equal((await s.get(feed('Events', '?start=Day&limit=4'))).status, 400);
  assert.equal((await s.get(feed('Events', '?start=Day&limit=3'))).status, 413);
});

test('a year-9999 reading is skipped, not written as a malformed date, and the rest of the import goes through', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'last', Starts: '9999-12-31T22:00:00' });
  s.store.create('Events', { Title: 'ordinary', Starts: '2026-10-16T09:00:00' });
  const out = await s.get(feed('Events', '?start=Starts&title=Title&zone=America/New_York'));
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('x-tabularius-skipped'), '1');
  assert.ok(!/DTSTART:\d{9,}/.test(out.text));
  referenceParse(out.text);
  const r = await s.post(importer('Events', '?start=Day&zone=Asia/Tokyo'), ics('DTSTART:99991231T200000Z\nSUMMARY:far', 'DTSTART:20261016T090000Z\nSUMMARY:near'));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.imported, 1);
  assert.equal(r.json.skipped, 1);
});

// --- Making and ending feeds ---------------------------------------------------------------------------------------

async function boss(s: Running): Promise<Record<string, string>> {
  s.store.setPassword('boss', 'pw', '[Full Access]');
  const r = await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('boss:pw'), 'content-type': 'application/json' }, body: '{}' });
  return { authorization: `Bearer ${((await r.json()) as any).response.token}`, 'content-type': 'application/json' };
}
const feedsPath = '/tabularius/calendar/v1/databases/Planner/feeds';
const call = async (s: Running, method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const r = await fetch(s.url + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
};

test('a feed is made once, its address works, the list never shows it, and revoking ends the link', async (t) => {
  const s = await start(t);
  s.store.create('Events', { Title: 'Standup', Day: '2026-10-19' });
  const headers = await boss(s);
  const made = await call(s, 'POST', feedsPath, headers, { layout: 'Events', start: 'Day', title: 'Title', label: 'Team calendar' });
  assert.equal(made.status, 200, made.text);
  assert.match(made.json.address, /^\/tabularius\/calendar\/v1\/databases\/Planner\/layouts\/Events\/calendar\.ics\?start=Day&title=Title&token=ohbt_/);
  assert.match(made.json.url, /^http:\/\/.+\/tabularius\/calendar\/v1\/databases\/Planner\/layouts\/Events\/calendar\.ics\?/);
  // The address opens with no header, as a calendar app opens it.
  const opened = await fetch(s.url + made.json.address);
  assert.equal(opened.status, 200);
  assert.match(await opened.text(), /SUMMARY:Standup/);
  // The list says what exists, never how to open it.
  const list = await call(s, 'GET', feedsPath, headers);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.feeds.map((f: any) => [f.id, f.label, f.layout, f.account]), [[made.json.id, 'Team calendar', 'Events', 'boss']]);
  assert.ok(!list.text.includes('ohbt_'), 'the list shows no token');
  assert.ok(!list.text.includes(made.json.address.split('token=')[1]));
  // Making it is in the security log.
  assert.ok(s.store.securityEvents({ kind: 'api-token-issued', limit: 20 }).length > 0, 'the security log has the issue');
  // Revoking ends the link for good.
  assert.equal((await call(s, 'DELETE', `${feedsPath}/${made.json.id}`, headers)).status, 200);
  assert.equal((await fetch(s.url + made.json.address)).status, 401);
  assert.deepEqual((await call(s, 'GET', feedsPath, headers)).json.feeds, []);
  assert.equal((await call(s, 'DELETE', `${feedsPath}/${made.json.id}`, headers)).status, 404);
  assert.ok(s.store.securityEvents({ kind: 'api-token-revoked', limit: 20 }).length > 0, 'the security log has the revoke');
});

test('only Full Access makes, lists or ends a feed; a read-only or layout token cannot; another kind of token is never touched', async (t) => {
  const s = await start(t);
  const headers = await boss(s);
  const made = await call(s, 'POST', feedsPath, headers, { layout: 'Events', start: 'Day' });
  assert.equal(made.status, 200, made.text);
  // ann has records and the Data API, but not Full Access.
  const annSession = await fetch(`${s.url}/fmi/data/vLatest/databases/Planner/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('ann:pw'), 'content-type': 'application/json' }, body: '{}' });
  const annHeaders = { authorization: `Bearer ${((await annSession.json()) as any).response.token}`, 'content-type': 'application/json' };
  for (const [method, path, body] of [['GET', feedsPath], ['POST', feedsPath, { layout: 'Events', start: 'Day' }], ['DELETE', `${feedsPath}/${made.json.id}`]] as const) {
    const r = await call(s, method, path, annHeaders, body);
    assert.equal(r.status, 403, `${method}: ${r.text}`);
    assert.match(r.text, /full access/);
  }
  assert.equal((await call(s, 'GET', feedsPath, headers)).json.feeds.length, 1, 'the refused calls changed nothing');
  // The feed's own token (read-only, one layout) cannot manage feeds, and a token in the address is not a sign-in for it.
  const link = made.json.address.split('token=')[1];
  assert.equal((await call(s, 'GET', feedsPath, { authorization: `Bearer ${link}` })).status, 403);
  assert.equal((await call(s, 'GET', `${feedsPath}?token=${link}`, {})).status, 401);
  // Not for a sign-in-less caller either.
  assert.equal((await call(s, 'POST', feedsPath, {}, { layout: 'Events', start: 'Day' })).status, 401);
  // An ordinary API token is not a feed: it is not listed and cannot be revoked here.
  const plain = s.store.createApiToken('ann', { label: 'Zapier' });
  const id = s.store.apiTokens().find((x) => x.label === 'Zapier')!.id;
  assert.equal((await call(s, 'DELETE', `${feedsPath}/${id}`, headers)).status, 404);
  assert.ok(s.store.apiToken(plain), 'the token still works');
  assert.deepEqual((await call(s, 'GET', feedsPath, headers)).json.feeds.map((f: any) => f.id), [made.json.id]);
});

test('a feed that could never open is not made: unknown layout or field, wrong kind, no Data API privilege, bad zone, query or limit', async (t) => {
  const s = await start(t);
  const headers = await boss(s);
  const before = s.store.apiTokens().length;
  for (const [body, status] of [
    [{ layout: 'Nowhere', start: 'Day' }, 404], [{ layout: 'Events', start: 'Nope' }, 400], [{ layout: 'Events', start: 'Title' }, 400], [{ layout: 'Events', start: 'Day', end: 'Starts' }, 400],
    [{ layout: 'Events' }, 400], [{ layout: 'Events', start: 'Day', zone: 'Nowhere/Land' }, 400], [{ layout: 'Events', start: 'Day', query: '[1]' }, 400],
    [{ layout: 'Events', start: 'Day', limit: 0 }, 400], [{ layout: 'Events', start: 'Day', expiresDays: -1 }, 400],
  ] as const) {
    const r = await call(s, 'POST', feedsPath, headers, body);
    assert.equal(r.status, status, `${JSON.stringify(body)}: ${r.text}`);
  }
  assert.equal(s.store.apiTokens().length, before, 'no token was made');
  // A privilege set without the Data API could not open the link.
  s.store.savePrivilegeSet({ name: 'NoApi', records: { ...OPEN }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: [] });
  assert.throws(() => createFeed(s.store, 'ann', s.store.privilegesForSet('NoApi'), { layout: 'Events', start: 'Day' }), /fmrest/);
});

test('a feed cannot be made with a limit the operator\'s Data API limit would refuse when it opens', async (t) => {
  const s = await start(t);
  const headers = await boss(s);
  t.after(() => { delete process.env.TABULARIUS_DATA_API_MAX_LIMIT; });
  process.env.TABULARIUS_DATA_API_MAX_LIMIT = '3';
  const body = { layout: 'Events', start: 'Day' };
  assert.equal((await call(s, 'POST', feedsPath, headers, { ...body, limit: 4 })).status, 400);
  assert.equal((await call(s, 'POST', feedsPath, headers, { ...body, limit: 3 })).status, 200);
});

test('a feed made with an expiry lists it', async (t) => {
  const s = await start(t);
  const headers = await boss(s);
  s.store.create('Events', { Title: 'Visible', Day: '2026-10-19' });
  const made = await call(s, 'POST', feedsPath, headers, { layout: 'Events', start: 'Day', title: 'Title', expiresDays: 1 });
  assert.equal(made.status, 200, made.text);
  const listed = (await call(s, 'GET', feedsPath, headers)).json.feeds[0];
  assert.ok(listed.expires, 'the expiry is listed');
});
