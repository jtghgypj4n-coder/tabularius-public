// What the calendar dialog asks the server for, worked out without a page: which fields it offers, what a request holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFields, calendarWhen, feedRequest, importSummary } from '../src/calendar-dialog.ts';
import type { LayoutMeta } from '../src/types.ts';

const field = (name: string, type: string, extra: object = {}) => ({ name, type, calculated: false, summary: false, ...extra });
const meta = {
  layout: { name: 'Events', id: 1, occurrence: 'Events', table: 'Events' },
  fields: {
    Events: [field('Title', 'text'), field('Day', 'date'), field('Starts', 'timestamp'), field('Total', 'number', { summary: true }), field('Scan', 'container'), field('Customers::Due', 'date')],
    Customers: [field('Due', 'date')],
  },
} as unknown as LayoutMeta;

test('the date pickers offer the layout\'s own date and timestamp fields, never related, summary or container ones', () => {
  const { dates, text } = calendarFields(meta);
  assert.deepEqual(dates.map((f) => f.name), ['Day', 'Starts']);
  assert.deepEqual(text.map((f) => f.name), ['Title', 'Day', 'Starts']);
});

test('a feed request leaves out what is blank and keeps what is chosen', () => {
  const blank = { layout: 'Events', start: 'Day', end: '', title: '', description: '', location: '', zone: '', label: '', expiresDays: '' };
  assert.deepEqual(feedRequest(blank), { layout: 'Events', start: 'Day' });
  assert.deepEqual(feedRequest({ ...blank, end: 'Starts', title: 'Title', zone: ' UTC ', label: ' Team ', expiresDays: '30' }),
    { layout: 'Events', start: 'Day', end: 'Starts', title: 'Title', zone: 'UTC', label: 'Team', expiresDays: 30 });
  assert.equal(feedRequest({ ...blank, expiresDays: '0' }).expiresDays, 0, '0 asks for an address that never expires');
  assert.equal('expiresDays' in feedRequest({ ...blank, expiresDays: '-4' }), false);
  assert.equal('expiresDays' in feedRequest({ ...blank, expiresDays: 'soon' }), false);
});

test('the import summary says what was made and what was left out', () => {
  assert.equal(importSummary({ imported: 1, skipped: 0, notes: [] }), 'Imported 1 event.');
  assert.equal(importSummary({ imported: 3, skipped: 2, notes: ['times written in UTC were stored as their UTC clock reading: add zone= to convert them'] }),
    'Imported 3 events, skipped 2. times written in UTC were stored as their UTC clock reading: add zone= to convert them');
});

test('calendar feed stamps distinguish both occurrences of a fall-back hour', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const first = calendarWhen('2026-11-01T05:30:00Z', 'en-US');
    const second = calendarWhen('2026-11-01T06:30:00Z', 'en-US');
    assert.match(first, /1:30:00 AM EDT/);
    assert.match(second, /1:30:00 AM EST/);
    assert.notEqual(first, second);
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});
