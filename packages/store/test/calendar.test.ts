// iCalendar for date fields: what the feed writes (checked against the RFC 5545 rules that matter, by a reference
// reader written here), how zones and the hours a clock skips or repeats are handled, and what the reader takes in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, buildCalendar, escapeText, foldLine, parseDate, parseStamp, readCalendar, unescapeText, utcToZoned, zonedToUtc, zoneName, type FeedEvent } from '../src/calendar.ts';
import { referenceParse } from './ics-reference.ts';

const stamp = new Date('2026-10-17T08:00:00Z');

const prop = (event: { name: string; params: string; value: string }[], name: string) => event.find((p) => p.name === name);

test('dates and clock readings are checked, not guessed', () => {
  assert.equal(parseDate('2026-02-28'), '2026-02-28');
  assert.equal(parseDate('2026-02-30'), undefined);
  assert.equal(parseDate('2024-02-29'), '2024-02-29');
  assert.equal(parseDate('2025-02-29'), undefined);
  assert.equal(parseDate('10/16/2026'), undefined);
  assert.equal(parseStamp('2026-10-16T09:30:00'), '2026-10-16T09:30:00');
  assert.equal(parseStamp('2026-10-16 09:30'), '2026-10-16T09:30:00');
  assert.equal(parseStamp('2026-10-16T09:30:15.750'), '2026-10-16T09:30:15');
  assert.equal(parseStamp('2026-10-16T24:00:00'), undefined);
  assert.equal(parseStamp('2026-13-16T09:30:00'), undefined);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
});

test('text is escaped, control characters dropped, and a line break cannot start a new property', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.equal(escapeText('x\r\ny\rz'), 'x\\ny\\nz');
  assert.equal(escapeText('a\u0000b\u0007c\u007fd e'), 'abcde');
  assert.equal(unescapeText(escapeText('Meet: A, B; C \\ D\nE')), 'Meet: A, B; C \\ D\nE');
  const hostile: FeedEvent = { uid: '1@x', start: { date: '2026-10-16' }, summary: 'Hi\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:evil@x', description: 'line\nBEGIN:VALARM' };
  const events = referenceParse(buildCalendar([hostile], { name: 'T', stamp }));
  assert.equal(events.length, 1, 'the text stayed inside one event');
  assert.equal(events[0].filter((p) => p.name === 'UID').length, 1);
});

test('lines fold at 75 octets and never inside a multi-byte character', () => {
  const long = 'DESCRIPTION:' + 'é'.repeat(100) + '🙂'.repeat(30) + 'x'.repeat(200);
  const lines = foldLine(long);
  assert.ok(lines.length > 3);
  for (const [i, l] of lines.entries()) {
    assert.ok(Buffer.byteLength(l) <= 75, `line ${i}`);
    if (i > 0) assert.ok(l.startsWith(' '));
  }
  assert.equal(lines.map((l, i) => (i ? l.slice(1) : l)).join(''), long, 'unfolding gives the line back');
  assert.deepEqual(foldLine('SHORT:ok'), ['SHORT:ok']);
  const exactly75 = 'X:' + 'a'.repeat(73);
  assert.deepEqual(foldLine(exactly75), [exactly75]);
  assert.equal(foldLine(exactly75 + 'b').length, 2);
});

test('all-day events: inclusive end dates, one-day events with no end, a missing or earlier end left out', () => {
  const ics = buildCalendar([
    { uid: 'a@x', start: { date: '2026-10-16' }, end: { date: '2026-10-18' }, summary: 'three days' },
    { uid: 'b@x', start: { date: '2026-10-16' }, end: { date: '2026-10-16' }, summary: 'same day' },
    { uid: 'c@x', start: { date: '2026-10-16' }, summary: 'no end' },
    { uid: 'd@x', start: { date: '2026-10-16' }, end: { date: '2026-10-10' }, summary: 'ends before it starts' },
    { uid: 'e@x', start: { date: '2026-12-31' }, end: { date: '2026-12-31' }, summary: 'new year\'s eve' },
    { uid: 'f@x', start: { date: '2026-12-30' }, end: { date: '2026-12-31' }, summary: 'over the year end' },
  ], { name: 'T', stamp });
  const [a, b, c, d, e, f] = referenceParse(ics);
  assert.equal(prop(a, 'DTSTART')!.params, ';VALUE=DATE');
  assert.equal(prop(a, 'DTSTART')!.value, '20261016');
  assert.equal(prop(a, 'DTEND')!.value, '20261019', 'the 18th is the last day, so the exclusive end is the 19th');
  for (const one of [b, c, d, e]) assert.equal(prop(one, 'DTEND'), undefined);
  assert.equal(prop(f, 'DTEND')!.value, '20270101');
});

test('timed events: floating by default, UTC with Z, an end of another kind or before the start left out', () => {
  const ics = buildCalendar([
    { uid: 'a@x', start: { floating: '2026-10-16T09:30:00' }, end: { floating: '2026-10-16T10:45:30' }, summary: 'floating' },
    { uid: 'b@x', start: { utc: '2026-10-16T09:30:00' }, end: { utc: '2026-10-16T10:00:00' }, summary: 'utc' },
    { uid: 'c@x', start: { floating: '2026-10-16T09:30:00' }, end: { floating: '2026-10-16T09:30:00' }, summary: 'zero length' },
    { uid: 'd@x', start: { floating: '2026-10-16T09:30:00' }, end: { floating: '2026-10-16T08:00:00' }, summary: 'backwards' },
    { uid: 'e@x', start: { floating: '2026-10-16T09:30:00' }, end: { date: '2026-10-20' }, summary: 'mixed' },
  ], { name: 'T', stamp });
  const [a, b, c, d, e] = referenceParse(ics);
  assert.equal(prop(a, 'DTSTART')!.value, '20261016T093000', 'no Z and no zone: floating');
  assert.equal(prop(a, 'DTEND')!.value, '20261016T104530');
  assert.equal(prop(b, 'DTSTART')!.value, '20261016T093000Z');
  assert.equal(prop(b, 'DTEND')!.value, '20261016T100000Z');
  assert.equal(prop(c, 'DTEND')!.value, '20261016T093000');
  assert.equal(prop(d, 'DTEND'), undefined);
  assert.equal(prop(e, 'DTEND'), undefined);
});

test('the calendar carries its name, stamp and refresh hint, with CRLF endings', () => {
  const ics = buildCalendar([], { name: 'Staff, rota; 2026', stamp, refreshHours: 2 });
  referenceParse(ics);
  assert.match(ics, /X-WR-CALNAME:Staff\\, rota\\; 2026\r\n/);
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT2H\r\n/);
  const one = buildCalendar([{ uid: 'a@x', start: { date: '2026-10-16' }, summary: 's', sequence: 3 }], { name: 'T', stamp });
  assert.match(one, /DTSTAMP:20261017T080000Z\r\n/);
  assert.match(one, /SEQUENCE:3\r\n/);
});

test('zones: daylight saving edges are resolved the same way every time', () => {
  assert.equal(zoneName('europe/london'), 'Europe/London');
  assert.equal(zoneName('Not/AZone'), undefined);
  // Ordinary readings.
  assert.equal(zonedToUtc('2026-07-01T12:00:00', 'Europe/London'), '2026-07-01T11:00:00');
  assert.equal(zonedToUtc('2026-01-01T12:00:00', 'Europe/London'), '2026-01-01T12:00:00');
  assert.equal(zonedToUtc('2026-07-01T12:00:00', 'Asia/Kolkata'), '2026-07-01T06:30:00');
  assert.equal(zonedToUtc('2026-07-01T12:00:00', 'UTC'), '2026-07-01T12:00:00');
  // US spring forward 2026-03-08: 02:00 to 03:00 does not exist in New York; 02:30 moves forward to 03:30 EDT.
  assert.equal(zonedToUtc('2026-03-08T01:59:59', 'America/New_York'), '2026-03-08T06:59:59');
  assert.equal(zonedToUtc('2026-03-08T02:30:00', 'America/New_York'), '2026-03-08T07:30:00');
  assert.equal(zonedToUtc('2026-03-08T03:00:00', 'America/New_York'), '2026-03-08T07:00:00');
  // US fall back 2026-11-01: 01:30 happens twice; the first (EDT) is taken.
  assert.equal(zonedToUtc('2026-11-01T01:30:00', 'America/New_York'), '2026-11-01T05:30:00');
  assert.equal(zonedToUtc('2026-11-01T02:30:00', 'America/New_York'), '2026-11-01T07:30:00');
  // The southern hemisphere and a half-hour skip (Lord Howe Island, 30 minutes).
  assert.equal(zonedToUtc('2026-10-04T02:15:00', 'Australia/Lord_Howe'), '2026-10-03T15:45:00');
  // And back.
  assert.equal(utcToZoned('2026-07-01T11:00:00', 'Europe/London'), '2026-07-01T12:00:00');
  assert.equal(utcToZoned('2026-11-01T06:30:00', 'America/New_York'), '2026-11-01T01:30:00');
  assert.equal(utcToZoned('2026-03-08T07:00:00', 'America/New_York'), '2026-03-08T03:00:00');
  // The date changes across midnight.
  assert.equal(zonedToUtc('2026-12-31T23:30:00', 'America/Los_Angeles'), '2027-01-01T07:30:00');
  assert.equal(utcToZoned('2027-01-01T07:30:00', 'America/Los_Angeles'), '2026-12-31T23:30:00');
});

// --- reading ---------------------------------------------------------------------------------------------------------

const wrap = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//t//EN', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e.split('\n'), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n') + '\r\n';

test('the reader takes back what the feed writes', () => {
  const events: FeedEvent[] = [
    { uid: '1@x', start: { date: '2026-10-16' }, end: { date: '2026-10-18' }, summary: 'Away, "back" Monday; ok', description: 'Line one\nLine two\\' , location: 'Room 4' },
    { uid: '2@x', start: { floating: '2026-10-16T09:30:00' }, end: { floating: '2026-10-16T10:00:00' }, summary: 'é🙂 ' + 'long '.repeat(40) },
    { uid: '3@x', start: { utc: '2026-10-16T09:30:00' }, summary: 'utc' },
  ];
  const { events: back, notes } = readCalendar(buildCalendar(events, { name: 'T', stamp }));
  assert.deepEqual(notes, []);
  assert.equal(back.length, 3);
  assert.deepEqual(back[0].start, { date: '2026-10-16' });
  assert.deepEqual(back[0].end, { date: '2026-10-19' }, 'the file\'s own end is exclusive');
  assert.equal(back[0].summary, events[0].summary);
  assert.equal(back[0].description, events[0].description);
  assert.equal(back[0].location, 'Room 4');
  assert.deepEqual(back[1].start, { floating: '2026-10-16T09:30:00' });
  assert.equal(back[1].summary, events[1].summary, 'a folded multi-byte summary reads back whole');
  assert.deepEqual(back[2].start, { utc: '2026-10-16T09:30:00' });
});

test('the reader copes with the odd files calendar apps write', () => {
  const messy = '﻿BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:a\nDTSTART;TZID=Europe/London:20260716T090000\nDTEND;TZID=Europe/London:20260716T100000\nSUMMARY:Folded \n summary\nBEGIN:VALARM\nTRIGGER:-PT15M\nDESCRIPTION:Reminder text\nEND:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20260717\nDURATION:P2D\nSUMMARY:Duration\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:not a date\nSUMMARY:Broken\nEND:VEVENT\nEND:VCALENDAR\n';
  const { events, notes } = readCalendar(messy);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].start, { floating: '2026-07-16T09:00:00', tzid: 'Europe/London' });
  assert.equal(events[0].summary, 'Folded summary');
  assert.equal(events[0].description, undefined, 'the alarm\'s description is not the event\'s');
  assert.deepEqual(events[1].end, { date: '2026-07-19' });
  assert.ok(notes.some((n) => /no readable start was skipped \(1\)/.test(n)));
});

test('repeating events become separate occurrences, up to a cap, and the rules not read say so', () => {
  const daily = readCalendar(wrap('UID:d\nDTSTART:20260101T090000\nDTEND:20260101T100000\nRRULE:FREQ=DAILY;COUNT=5\nEXDATE:20260103T090000\nSUMMARY:Daily')).events;
  assert.deepEqual(daily.map((e) => (e.start as { floating: string }).floating.slice(0, 10)), ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05'], 'COUNT counts the excluded one');
  assert.deepEqual(daily.map((e) => e.uid), ['d#1', 'd#2', 'd#3', 'd#4']);
  assert.deepEqual(daily[0].end, { floating: '2026-01-01T10:00:00' });

  const weekly = readCalendar(wrap('UID:w\nDTSTART:20260105T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260116T235959\nSUMMARY:W')).events;
  assert.deepEqual(weekly.map((e) => (e.start as { floating: string }).floating.slice(0, 10)), ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16']);

  const every2 = readCalendar(wrap('UID:i\nDTSTART;VALUE=DATE:20260101\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3\nSUMMARY:W')).events;
  assert.deepEqual(every2.map((e) => (e.start as { date: string }).date), ['2026-01-01', '2026-01-15', '2026-01-29']);

  const monthly = readCalendar(wrap('UID:m\nDTSTART;VALUE=DATE:20260131\nRRULE:FREQ=MONTHLY;COUNT=4\nSUMMARY:M')).events;
  assert.deepEqual(monthly.map((e) => (e.start as { date: string }).date), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'], 'a month with no 31st has no occurrence');

  const leap = readCalendar(wrap('UID:y\nDTSTART;VALUE=DATE:20240229\nRRULE:FREQ=YEARLY;COUNT=2\nSUMMARY:Y')).events;
  assert.deepEqual(leap.map((e) => (e.start as { date: string }).date), ['2024-02-29', '2028-02-29']);

  const endless = readCalendar(wrap('UID:e\nDTSTART:20260101T090000\nRRULE:FREQ=DAILY\nSUMMARY:E'));
  assert.equal(endless.events.length, 366);
  assert.ok(endless.notes.some((n) => /more than 366 occurrences was cut at 366/.test(n)));

  const allExcluded = readCalendar(wrap('UID:x\nDTSTART:20260101T090000\nRRULE:FREQ=DAILY;COUNT=1\nEXDATE:20260101T090000\nSUMMARY:X'));
  assert.equal(allExcluded.events.length, 0);

  const unsupported = readCalendar(wrap('UID:u\nDTSTART:20260101T090000\nRRULE:FREQ=MONTHLY;BYDAY=2TU\nSUMMARY:U\n'));
  assert.equal(unsupported.events.length, 1, 'the first occurrence only');
  assert.ok(unsupported.notes.some((n) => /named days is not read: its first occurrence was imported/.test(n)));
  const hourly = readCalendar(wrap('UID:h\nDTSTART:20260101T090000\nRRULE:FREQ=HOURLY\nSUMMARY:H'));
  assert.equal(hourly.events.length, 1);
  assert.ok(hourly.notes.some((n) => /HOURLY repeat is not read/.test(n)));
});

test('weekly repeats use Monday weeks by default and honor WKST', () => {
  const dates = (wkst = '') => readCalendar(wrap(`UID:w\nDTSTART:20260105T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=MO,SU${wkst}\nSUMMARY:W`))
    .events.map((e) => (e.start as { floating: string }).floating.slice(0, 10));
  assert.deepEqual(dates(), ['2026-01-05', '2026-01-11', '2026-01-19', '2026-01-25']);
  assert.deepEqual(dates(';WKST=SU'), ['2026-01-05', '2026-01-18', '2026-01-19', '2026-02-01']);
  const everyWeek = readCalendar(wrap('UID:e\nDTSTART:20260105T090000\nRRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=6;BYDAY=MO,WE,FR\nSUMMARY:W'));
  assert.deepEqual(everyWeek.events.map((e) => (e.start as { floating: string }).floating.slice(0, 10)),
    ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16']);
  const invalid = readCalendar(wrap('UID:x\nDTSTART:20260105T090000\nRRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,SU;WKST=XX\nSUMMARY:W'));
  assert.equal(invalid.events.length, 1);
  assert.ok(invalid.notes.some((note) => /invalid WKST is not read/.test(note)));
});

test('the reader is bounded: a flood of events stops at the cap', () => {
  const one = 'BEGIN:VEVENT\r\nDTSTART:20260101T090000\r\nSUMMARY:x\r\nEND:VEVENT\r\n';
  const r = readCalendar('BEGIN:VCALENDAR\r\n' + one.repeat(5050) + 'END:VCALENDAR\r\n');
  assert.equal(r.events.length, 5000);
  assert.ok(r.notes.some((n) => /only the first 5000 events were read/.test(n)));
});

test('hostile numbers in a file cannot throw, loop or run past the calendar\'s years', () => {
  const huge = readCalendar(wrap('UID:h\nDTSTART:20260101T090000\nRRULE:FREQ=DAILY;INTERVAL=1000000000;COUNT=3\nSUMMARY:H'));
  assert.equal(huge.events.length, 1, 'an interval past 1000 is not read: the first occurrence only');
  assert.ok(huge.notes.some((n) => /invalid INTERVAL/.test(n)));
  const monthly = readCalendar(wrap('UID:m\nDTSTART:20260101T090000\nRRULE:FREQ=MONTHLY;INTERVAL=1000;COUNT=3\nSUMMARY:M')).events;
  assert.deepEqual(monthly.map((e) => (e.start as { floating: string }).floating.slice(0, 4)), ['2026', '2109', '2192']);
  const yearly = readCalendar(wrap('UID:y\nDTSTART:99990101T090000\nRRULE:FREQ=YEARLY;INTERVAL=1;COUNT=5\nSUMMARY:Y')).events;
  assert.equal(yearly.length, 1, 'there is no year 10000');
  const endOfTime = readCalendar(wrap('UID:d\nDTSTART:99991230T090000\nDTEND:99991231T100000\nRRULE:FREQ=DAILY;COUNT=10\nSUMMARY:D')).events;
  assert.deepEqual(endOfTime.map((e) => (e.start as { floating: string }).floating.slice(0, 10)), ['9999-12-30', '9999-12-31']);
  assert.ok(endOfTime.every((e) => /^\d{4}-\d\d-\d\dT/.test((e.end as { floating: string } | undefined)?.floating ?? '9999-01-01T')));
  const longEvent = readCalendar(wrap('UID:l\nDTSTART:99991231T090000\nDURATION:P99999999W\nSUMMARY:L')).events;
  assert.equal(longEvent.length, 1);
  assert.equal(longEvent[0].end, undefined, 'an end past year 9999 is left out, not written as NaN');
  const days = readCalendar(wrap('UID:s\nDTSTART;VALUE=DATE:99991231\nDURATION:P5D\nSUMMARY:S')).events;
  assert.deepEqual(days[0].end, { date: '9999-12-31' });
  assert.equal(addDays('9999-12-31', 1), '9999-12-31');
  assert.equal(addDays('1000-01-01', -1), '1000-01-01');
  assert.equal(parseDate('0999-12-31'), undefined);
  // Parameters without a value, an empty rule and a prototype-looking key are just not rules.
  for (const rule of ['FREQ', '', 'FREQ=DAILY;__proto__=x', 'FREQ=DAILY;COUNT=abc', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=DAILY;UNTIL=garbage']) {
    const r = readCalendar(wrap(`UID:r\nDTSTART:20260101T090000\nRRULE:${rule}\nSUMMARY:R`));
    assert.equal(r.events.length, 1, rule);
  }
});

test('a file of repeating events cannot keep the reader busy: work is bounded across the whole file', () => {
  const started = performance.now();
  const flood = (rule: string, start: string, n: number) => 'BEGIN:VCALENDAR\r\n' + `BEGIN:VEVENT\r\nDTSTART:${start}\r\nRRULE:${rule}\r\nSUMMARY:x\r\nEND:VEVENT\r\n`.repeat(n) + 'END:VCALENDAR\r\n';
  // Each of these took tens of seconds before the reader kept one budget for the file and stopped at the cap.
  const monthly = readCalendar(flood('FREQ=MONTHLY;INTERVAL=1000', '20260131T090000', 8000));
  const yearly = readCalendar(flood('FREQ=YEARLY;INTERVAL=1000', '20000229T090000', 30_000));
  const daily = readCalendar(flood('FREQ=DAILY', '20260101T090000', 30_000));
  assert.ok(performance.now() - started < 8000, `took ${Math.round(performance.now() - started)} ms`);
  assert.ok(monthly.events.length <= 5000 && yearly.events.length <= 5000 && daily.events.length === 5000);
  assert.ok(daily.notes.some((n) => /only the first 5000 events were read/.test(n)));
  assert.ok(monthly.notes.some((n) => /too much work/.test(n)) || monthly.events.length > 0);
});

test('a reading that lands past the last year of the calendar is no reading, not a malformed date', () => {
  assert.equal(zonedToUtc('9999-12-31T22:00:00', 'America/New_York'), undefined);
  assert.equal(utcToZoned('9999-12-31T20:00:00', 'Asia/Tokyo'), undefined);
  assert.equal(zonedToUtc('9999-12-31T12:00:00', 'UTC'), '9999-12-31T12:00:00');
  assert.equal(utcToZoned('1000-01-01T00:00:00', 'America/New_York'), undefined);
});
