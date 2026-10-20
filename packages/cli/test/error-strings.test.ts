// The messages a person can be shown (npm run docs:error-strings lists them all): none reads like a fault. A message that
// does is rewritten to say what happened and what to try; one that has to stay is named in KEPT with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEPT, collect, faults, problems } from '../../../scripts/error-strings-lib.ts';

test('the extractor finds the messages of every surface', () => {
  const rows = collect();
  assert.ok(rows.length > 2500, `${rows.length} messages`);
  for (const surface of ['web client', 'admin console', 'command line', 'API, MCP and SQL callers', 'script engine', 'conversion']) {
    assert.ok(rows.some((r) => r.surface === surface), `no message for the ${surface}`);
  }
  assert.ok(rows.some((r) => r.via === 'toast' && /^Layout saved/.test(r.text)), 'a toast of the web client');
  assert.ok(rows.some((r) => r.via === 'StoreError' && r.built), 'a message built from values');
});

test('no message reads like a fault', () => {
  assert.deepEqual(faults().map((f) => `${f.row.file}:${f.row.line} "${f.row.text}": ${f.why.join(', ')}`), []);
});

test('every message kept for a reason is still in the source', () => {
  const rows = collect();
  for (const k of KEPT) assert.ok(rows.some((r) => r.text === k.text && r.file === k.file), `"${k.text}" in ${k.file} is no longer there; remove it from KEPT`);
});

test('the patterns catch what they are for, and let a sentence through', () => {
  const caught: [string, string][] = [
    ['    at Object.<anonymous> (/srv/app/main.js:12:5)', 'a stack frame'],
    ['Could not save [object Object]', '[object Object]'],
    ['The record is undefined', '"undefined" or "NaN" in the text'],
    ['Could not read /home/ann/Documents/Invoices.fmp12', 'an absolute path'],
    ['Could not read C:\\Users\\ann\\Invoices.fmp12', 'an absolute path'],
    ['ENOENT: no such file or directory', 'a system error code'],
    ['connect ECONNREFUSED 127.0.0.1:8080', 'a system error code'],
    ['SQLITE_CONSTRAINT: UNIQUE constraint failed: records.id', 'a SQLite error name'],
    ['UNIQUE constraint failed: records.id', 'a SQL fragment'],
    ['SELECT name FROM accounts failed', 'a SQL fragment'],
    ['HTTP 500', 'an HTTP status or code alone'],
    ['HTTP {res.status}', 'an HTTP status or code alone'],
    ['Upload failed', '"failed" with no reason'],
    ['{cmd} failed', '"failed" with no reason'],
    ['TypeError: x is not a function', 'a JavaScript error name'],
    ['Cannot read properties of undefined (reading \'id\')', 'a JavaScript error name'],
    ['Copied the session cmsg_01ABC', 'an internal id'],
    ['Invalid input', 'wording that blames the person'],
  ];
  for (const [text, why] of caught) assert.ok(problems(text).includes(why), `"${text}" should be caught as ${why}, got ${problems(text).join(', ') || 'nothing'}`);
  const fine = [
    'Layout "Nope" is missing',
    'The address answered HTTP 404, which --fail counts as an error',
    'Upload failed: the file is larger than the 2 GB limit',
    'That address was not found; check the spelling of the host name',
    'Another restore is under way',
    'to is an email address, or empty to turn notifications off',
    'Pick a field to take the values from',
    'port {o.port} is in use by another program (`lsof -nP -iTCP:{o.port} -sTCP:LISTEN` shows which)',
  ];
  for (const text of fine) assert.deepEqual(problems(text), [], text);
});
