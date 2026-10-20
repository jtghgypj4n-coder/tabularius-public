// A container link made for an account stops working when that account is blocked or removed, and no one else's does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

test('container links are tied to the account they were made for', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-link-account-'));
  const served = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(async () => { await new Promise<void>((r) => served.server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });
  const store = served.host.create('Files');
  for (const name of ['Admin', 'Alice', 'Bob']) store.setPassword(name, 'pw', '[Full Access]');
  store.applyDesign([{ op: 'createTable', name: 'T', fields: [{ name: 'Doc', type: 'container' }] }]);
  const recordId = Number(store.create('T', {}).recordId);
  store.setContainer('T', recordId, 'Doc', 1, { filename: 'note.txt', mime: 'text/plain', data: new TextEncoder().encode('hello') });

  // A container field in a portal row gets a link made for the account too.
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Docs', fields: [{ name: 'ContactId', type: 'number' }, { name: 'File', type: 'container' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Docs', predicates: [{ left: 'Id', right: 'ContactId' }], allowCreation: true },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((x) => x.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((x) => x.name === table)!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  const objects = [{
    id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 100, left: 20, bottom: 200, right: 300 },
    portal: { tableOccurrenceId: occ('Docs').id, tableOccurrence: 'Docs', rows: 4, initialRow: 1 },
    children: [{ id: 901, kind: 'field', type: 1, anchors, style: {}, bounds: { top: 100, left: 20, bottom: 120, right: 300 }, field: { tableOccurrenceId: occ('Docs').id, fieldId: fieldId('Docs', 'File'), tableOccurrence: 'Docs', field: 'File', display: 'edit', repetitions: 1 } }],
  } as unknown as LayoutObject];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  const contact = Number(store.create('Contacts', { Id: 1, Name: 'a' }).recordId);
  const doc = Number(store.create('Docs', { ContactId: 1 }).recordId);
  store.setContainer('Docs', doc, 'File', 1, { filename: 'p.txt', mime: 'text/plain', data: new TextEncoder().encode('portal') });

  const linkFor = async (account: string) => {
    const login = await fetch(`${served.url}/fmi/data/vLatest/databases/Files/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}' });
    const token = (await login.json()).response.token;
    const read = await fetch(`${served.url}/fmi/data/vLatest/databases/Files/layouts/T/records/${recordId}`, { headers: { authorization: `Bearer ${token}` } });
    return (await read.json()).response.data[0].fieldData.Doc as string;
  };
  const portalLinkFor = async (account: string) => {
    const login = await fetch(`${served.url}/fmi/data/vLatest/databases/Files/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`) }, body: '{}' });
    const token = (await login.json()).response.token;
    const read = await fetch(`${served.url}/fmi/data/vLatest/databases/Files/layouts/Contacts/records/${contact}`, { headers: { authorization: `Bearer ${token}` } });
    return (await read.json()).response.data[0].portalData.Docs[0]['Docs::File'] as string;
  };
  const alice = await linkFor('Alice');
  const bob = await linkFor('Bob');
  const alicePortal = await portalLinkFor('Alice');
  assert.match(alicePortal, /[?&]as=Alice(&|$)/, 'a portal row\'s container link is made for the account too');
  assert.match(alice, /[?&]as=Alice(&|$)/);
  assert.match(bob, /[?&]as=Bob(&|$)/);
  assert.equal((await fetch(alice)).status, 200);
  assert.equal(await (await fetch(bob)).text(), 'hello');

  // The account name cannot be dropped or swapped: the signature covers it.
  assert.equal((await fetch(alice.replace(/&as=Alice/, ''))).status, 404);
  assert.equal((await fetch(alice.replace(/as=Alice/, 'as=Bob'))).status, 404);

  // Blocked: Alice's link ends, Bob's does not.
  store.setAccountActive('Alice', false);
  assert.equal((await fetch(alice)).status, 404);
  assert.equal((await fetch(alicePortal)).status, 404);
  assert.equal((await fetch(bob)).status, 200);

  // Active again: deactivation replaced the account's identity, so the old link stays dead and a link made now works.
  store.setAccountActive('Alice', true);
  assert.equal((await fetch(alice)).status, 404);
  assert.equal((await fetch(alicePortal)).status, 404);
  const reactivated = await linkFor('Alice');
  assert.equal((await fetch(reactivated)).status, 200);

  // Removed: gone for good.
  store.deleteAccount('Alice');
  assert.equal((await fetch(alice)).status, 404);
  assert.equal((await fetch(reactivated)).status, 404);
  assert.equal((await fetch(bob)).status, 200);

  // A different person given the same name does not get the old links back.
  store.setPassword('Alice', 'pw', '[Full Access]');
  const again = await linkFor('Alice');
  assert.equal((await fetch(alice)).status, 404);
  assert.equal((await fetch(again)).status, 200);

  // A sign-in through an external mapping has its links tied to the mapping's account, which has a row.
  assert.equal(store.privileges('jsmith', 'Bob').linkPrincipal, 'Bob');
  assert.equal(store.privileges('Bob').linkPrincipal, 'Bob');
});
