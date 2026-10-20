// A reference reader for the RFC 5545 rules a calendar feed has to meet: tests use it to check what the feed writes.
import assert from 'node:assert/strict';
import { unfold } from '../src/calendar.ts';

/** A reference check of the RFC 5545 rules a feed has to meet; returns the events as property lists. */
export function referenceParse(ics: string): { name: string; params: string; value: string }[][] {
  assert.ok(ics.endsWith('\r\n'), 'ends with CRLF');
  assert.ok(!/(^|[^\r])\n/.test(ics), 'every line break is CRLF');
  const physical = ics.slice(0, -2).split('\r\n');
  for (const line of physical) {
    assert.ok(Buffer.byteLength(line) <= 75, `a line is at most 75 octets: ${line.length}`);
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line), 'no control characters');
  }
  const lines = unfold(ics.slice(0, -2));
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-1), 'END:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.some((l) => l.startsWith('PRODID:')));
  const events: { name: string; params: string; value: string }[][] = [];
  let open: { name: string; params: string; value: string }[] | undefined;
  for (const line of lines.slice(1, -1)) {
    if (line === 'BEGIN:VEVENT') {
      assert.equal(open, undefined, 'no nested event');
      open = [];
      continue;
    }
    if (line === 'END:VEVENT') {
      assert.ok(open, 'END:VEVENT closes an open event');
      for (const need of ['UID', 'DTSTAMP', 'DTSTART']) assert.equal(open.filter((p) => p.name === need).length, 1, `exactly one ${need}`);
      assert.ok(open.filter((p) => p.name === 'DTEND' || p.name === 'DURATION').length <= 1, 'DTEND and DURATION are not both set');
      events.push(open);
      open = undefined;
      continue;
    }
    const m = /^([A-Z][A-Z0-9-]*)((?:;[^:]*)?):(.*)$/.exec(line);
    assert.ok(m, `a content line has a name and a colon: ${line}`);
    if (!open) continue; // calendar-level property
    open.push({ name: m[1], params: m[2], value: m[3] });
    if (['SUMMARY', 'DESCRIPTION', 'LOCATION'].includes(m[1])) {
      // TEXT: a backslash, comma or semicolon appears only escaped.
      assert.ok(!/(^|[^\\])(\\\\)*[;,]/.test(m[3]), `unescaped separator in ${m[1]}: ${m[3]}`);
      assert.ok(!/(^|[^\\])(\\\\)*\\[^\\;,nN]/.test(m[3]), `bad escape in ${m[1]}: ${m[3]}`);
    }
  }
  assert.equal(open, undefined, 'every event is closed');
  return events;
}
