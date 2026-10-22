import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { serve, setAdminPassword, type ServeOptions } from '../src/index.ts';

export const FROM = '198.51.100.8';
export const basic = (name: string, password = 'wrong') => `Basic ${Buffer.from(`${name}:${password}`).toString('base64')}`;
/** The header a trusted proxy would add for a client address, in the form the server's proxy setting reads. */
export const forwarding = (header: string, ip: string): Record<string, string> => ({ [header]: header === 'forwarded' ? `for="${ip}"` : ip });
export const REDIRECT = 'https://client.example/callback';
export const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
export async function setup(t: TestContext, opts: Partial<ServeOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-route-matrix-'));
  setAdminPassword(dir, 'console-secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, proxyHeader: 'x-forwarded-for', trustedProxies: ['127.0.0.1', '::1'], ...opts });
  t.after(async () => {
    s.server.closeAllConnections();
    await new Promise<void>(r => s.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const store = s.host.create('Synthetic');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Title' }] }]);
  const full = store.privilegeSets().find(p => p.name === '[Full Access]')!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...new Set([...full.extendedPrivileges, 'fmxdbc', 'fmrest', 'fmapp', 'fmodata', 'fmmcp', 'fmxml'])] });
  store.setPassword('Alice', 'correct', '[Full Access]');
  const registration = await fetch(`${s.url}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...forwarding(opts.proxyHeader ?? 'x-forwarded-for', FROM) }, body: JSON.stringify({ client_name: 'Synthetic', redirect_uris: [REDIRECT] }) });
  assert.equal(registration.status, 201);
  const { client_id } = await registration.json();
  const call = (path: string, init: RequestInit = {}, from = FROM) => fetch(s.url + path, { ...init, redirect: 'manual', headers: { 'x-forwarded-for': from, ...init.headers } });
  const json = (path: string, body: object, headers = {}, from = FROM) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, from);
  const form = (path: string, body: Record<string, string>, from = FROM) => call(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }, from);
  const authorize = (account: string, password: string, from = FROM) => form('/oauth/authorize', { client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', database: 'Synthetic', account, password }, from);
  const routes = {
    'Data API': (name: string, password = 'wrong', from = FROM) => json('/fmi/data/vLatest/databases/Synthetic/sessions', {}, { authorization: basic(name, password) }, from),
    web: (name: string, password = 'wrong', from = FROM) => json('/fmi/data/vLatest/databases/Synthetic/sessions', {}, { authorization: basic(name, password), 'x-tabularius-client': 'web' }, from),
    OData: (name: string, password = 'wrong', from = FROM) => call('/fmi/odata/v4/Synthetic', { headers: { authorization: basic(name, password) } }, from),
    XML: (name: string, password = 'wrong', from = FROM) => call('/fmi/xml/fmresultset.xml?-db=Synthetic&-lay=Items&-findall', { headers: { authorization: basic(name, password) } }, from),
    SQL: (name: string, password = 'wrong', from = FROM) => call('/tabularius/sql/v1/databases/Synthetic/tables', { headers: { authorization: basic(name, password) } }, from),
    MCP: (name: string, password = 'wrong', from = FROM) => json('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_record', arguments: { database: 'Synthetic', layout: 'Items', recordId: 1 } } }, { authorization: basic(name, password), accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, from),
    OAuth: (name: string, password = 'wrong', from = FROM) => authorize(name, password, from),
    'passkey second factor': (name: string, password = 'wrong', from = FROM) => json('/fmi/data/vLatest/databases/Synthetic/sessions/passkey-2fa', {}, { authorization: basic(name, password) }, from),
  };
  return { ...s, store, call, json, form, authorize, client_id, routes };
}
export const names = ['Data API', 'web', 'OData', 'SQL', 'MCP', 'OAuth', 'passkey second factor', 'XML'] as const;
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export async function snapshot(r: Response, typedName: string) {
  const headers = Object.fromEntries([...r.headers].filter(([key]) => key !== 'date'));
  // OAuth reflects the submitted form value; this is caller-controlled, not account existence.
  const body = (await r.text()).replace(`value="${typedName}"`, 'value="NAME"');
  return { status: r.status, headers, body };
}

