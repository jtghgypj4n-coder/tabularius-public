import assert from 'node:assert/strict';
import test from 'node:test';
import { addsHistoryEntry, pageTitle, readUrlState, writeAddress, writeUrlState, type UrlState } from '../src/url-state.ts';

test('web-client URL state percent-encodes visible names and round trips screen metadata', () => {
  const address = writeUrlState('/app/', '?script=Go&param=x', '', {
    db: 'Quarterly sales', layout: 'Résumé / Q4', record: '123', mode: 'browse', view: 'list', found: 19, total: 40,
  });
  assert.match(address, /layout=R%C3%A9sum%C3%A9\+%2F\+Q4/);
  assert.deepEqual(readUrlState(address.slice(address.indexOf('?'))), {
    db: 'Quarterly sales', layout: 'Résumé / Q4', record: '123', mode: 'browse', view: 'list', found: 19, total: 40,
  });
  assert.match(address, /script=Go/);
});

test('URL state rejects malformed IDs, counts and dialog names and never stores supplied record values', () => {
  const parsed = readUrlState('?record=1%2F2&found=-3&total=99999999999999&dialog=bad%20dialog&find=1');
  assert.deepEqual(parsed, { find: true });
  const address = writeUrlState('/app/', '', '', { layout: 'Orders', mode: 'find', find: true, Name: 'secret value' } as UrlState);
  assert.equal(address.includes('secret'), false);
  assert.equal(address.includes('Name'), false);
  assert.equal(readUrlState(address.slice(address.indexOf('?'))).find, true);
});

test('a script run replaces the address, a person\'s move adds an entry, and an opening file adds none', () => {
  assert.equal(addsHistoryEntry({ push: true, ready: true, scripting: false }), true);
  assert.equal(addsHistoryEntry({ push: true, ready: true, scripting: true }), false);
  assert.equal(addsHistoryEntry({ push: true, ready: false, scripting: false }), false);
  assert.equal(addsHistoryEntry({ push: false, ready: true, scripting: false }), false);
});

test('writeAddress pushes or replaces, and falls back to replacing where the browser refuses a new entry', () => {
  const calls: string[] = [];
  const ok = { pushState: (_: unknown, __: string, url: string) => calls.push(`push ${url}`), replaceState: (_: unknown, __: string, url: string) => calls.push(`replace ${url}`) };
  writeAddress(ok as unknown as History, '/a', true);
  writeAddress(ok as unknown as History, '/b', false);
  assert.deepEqual(calls, ['push /a', 'replace /b']);

  const full: string[] = [];
  const limited = { pushState: () => { throw new Error('SecurityError'); }, replaceState: (_: unknown, __: string, url: string) => full.push(url) };
  writeAddress(limited as unknown as History, '/c', true);
  assert.deepEqual(full, ['/c'], 'a refused push still leaves the address right');

  const broken = { pushState: () => { throw new Error('x'); }, replaceState: () => { throw new Error('y'); } };
  assert.doesNotThrow(() => writeAddress(broken as unknown as History, '/d', true));
});

test('the tab title follows the pattern, drops empty parts and falls back to the parts joined', () => {
  assert.equal(pageTitle(undefined, { file: 'Links', layout: 'People', record: 3 }), 'Links - People - Record 3');
  assert.equal(pageTitle(null, { file: 'Links', layout: 'People' }), 'Links - People');
  assert.equal(pageTitle('{record} / {file}', { file: 'Links', record: 7 }), 'Record 7 / Links');
  assert.equal(pageTitle('{layout}', { file: 'Links' }), 'Links', 'an empty result falls back to the parts');
  assert.equal(pageTitle('Sales {file}', { file: 'Q4' }), 'Sales Q4');
});
