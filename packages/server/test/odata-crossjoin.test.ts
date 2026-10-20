// OData $crossjoin: pairs of records from two sets that a $filter across them keeps, each set read as the
// account sees it, and capped so a join can't hold the server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import { CROSSJOIN_LIMIT, conjuncts } from '../src/odata-crossjoin.ts';
import { filterTokens } from '../src/odata.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
const ids: Record<string, number> = {};
const auth = (who: string) => ({ authorization: 'Basic ' + btoa(`${who}:pw`) });

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-crossjoin-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  const store = s.host.get('Charts')!;
  store.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'CustomerID', type: 'text' }, { name: 'Name', type: 'text' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerID', type: 'text' }, { name: 'Total', type: 'number' }, { name: 'Note', type: 'text' }] },
    { op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'CustomerID', right: 'CustomerID' }] },
  ] as never);
  ids.acme = store.create('Customers', { CustomerID: 'C1', Name: 'Acme' }).recordId;
  ids.jo = store.create('Customers', { CustomerID: 'C2', Name: 'Jo' }).recordId;
  ids.none = store.create('Customers', { CustomerID: 'C3', Name: 'Nobody' }).recordId;
  for (const [c, total, note] of [['C1', 100, 'big'], ['C1', 5, 'small'], ['C2', 40, 'mid']] as const) store.create('Orders', { CustomerID: c, Total: total, Note: note });
  const full = store.privilegeSets().find((p) => p.id === 1)!;
  store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmodata'] });
  store.setPassword('Ann', 'pw', full.name);
  // Sees orders under 50 only, and not their notes.
  store.savePrivilegeSet({
    name: 'Small orders', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false },
    tables: { Orders: { view: 'Total < 50', edit: false, create: false, delete: false, fields: { Note: 'none' } } },
  } as never);
  store.setPassword('Cy', 'pw', 'Small orders');
  // Can't read the customers' key: following the relationship would show it through their orders.
  store.savePrivilegeSet({
    name: 'No keys', extendedPrivileges: ['fmodata'], layouts: 'viewOnly', scripts: 'none', valueLists: 'viewOnly',
    records: { view: true, edit: false, create: false, delete: false },
    tables: { Customers: { view: true, edit: false, create: false, delete: false, fields: { CustomerID: 'none' } } },
  } as never);
  store.setPassword('Kim', 'pw', 'No keys');
});
after(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string, who = 'Ann') => {
  const res = await fetch(root + path, { headers: auth(who) });
  return { res, body: (await res.json()) as Record<string, any> };
};
const join_ = encodeURIComponent('Customers/CustomerID eq Orders/CustomerID');

test('$crossjoin pairs records where $filter holds, with links, $expand, $orderby, paging and $count', { skip }, async () => {
  const all = await get('/$crossjoin(Customers,Orders)?$count=true');
  assert.equal(all.res.status, 200, JSON.stringify(all.body));
  assert.equal(all.body['@odata.count'], 9);
  assert.match(all.body['@odata.context'], /\$metadata#Collection\(Edm\.ComplexType\)$/);

  const joined = await get(`/$crossjoin(Customers,Orders)?$filter=${join_}&$orderby=Orders/Total desc&$count=true`);
  assert.equal(joined.res.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body['@odata.count'], 3);
  assert.deepEqual(joined.body.value.map((r: any) => r['Customers@odata.navigationLink']), [`Customers(${ids.acme})`, `Customers(${ids.jo})`, `Customers(${ids.acme})`]);

  const expanded = await get(`/$crossjoin(Customers,Orders)?$filter=${join_} and Orders/Total gt 10&$orderby=Customers/Name&$expand=Customers($select=Name),Orders`);
  assert.equal(expanded.res.status, 200, JSON.stringify(expanded.body));
  assert.deepEqual(expanded.body.value.map((r: any) => [r.Customers.Name, r.Orders.Total, r.Orders.Note]), [['Acme', 100, 'big'], ['Jo', 40, 'mid']]);
  assert.equal(expanded.body.value[0].Customers.CustomerID, undefined);
  assert.equal(expanded.body.value[0].Customers.ROWID, ids.acme);

  const first = await fetch(`${root}/$crossjoin(Customers,Orders)?$filter=${join_}&$orderby=Orders/Total`, { headers: { ...auth('Ann'), prefer: 'odata.maxpagesize=2' } });
  const page = (await first.json()) as Record<string, any>;
  assert.equal(page.value.length, 2);
  const rest = await fetch(page['@odata.nextLink'], { headers: auth('Ann') });
  assert.equal(((await rest.json()) as Record<string, any>).value.length, 1);

  const byRowid = await get(`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent(`Customers/ROWID eq ${ids.jo}`)} and ${join_}`);
  assert.equal(byRowid.body.value.length, 1);
  const orFilter = await get(`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent("Customers/Name eq 'Nobody' or Orders/Total eq 5")}&$count=true`);
  assert.equal(orFilter.body['@odata.count'], 5);
});

test('$crossjoin reads each set as the account sees it', { skip }, async () => {
  const cy = await get(`/$crossjoin(Customers,Orders)?$filter=${join_}&$expand=Orders`, 'Cy');
  assert.equal(cy.res.status, 200, JSON.stringify(cy.body));
  assert.deepEqual(cy.body.value.map((r: any) => r.Orders.Total).sort(), [40, 5]);
  assert.equal(cy.body.value[0].Orders.Note, undefined);
  const note = await get(`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent("Orders/Note eq 'big'")}`, 'Cy');
  assert.equal(note.res.status, 400);
  const key = await get(`/$crossjoin(Customers,Orders)?$filter=${join_}`, 'Kim');
  assert.equal(key.res.status, 400);
  assert.match(key.body.error.message, /no property "Customers\/CustomerID"/);
  const sorted = await get('/$crossjoin(Customers,Orders)?$orderby=Customers/CustomerID', 'Kim');
  assert.equal(sorted.res.status, 400);
});

test('$crossjoin refuses what it can\'t do, and caps its work', { skip }, async () => {
  for (const [path, status, why] of [
    ['/$crossjoin(Customers)', 400, /2 to 3 entity sets/],
    ['/$crossjoin(Customers,Customers)', 400, /each entity set once/],
    ['/$crossjoin(Customers,Nope)', 404, /no entity set "Nope"/],
    ['/$crossjoin(Customers,Orders)?$select=Customers/Name', 400, /\$select is not supported/],
    ['/$crossjoin(Customers,Orders)?$expand=Orders($filter=Total gt 1)', 400, /only \$select/],
    ['/$crossjoin(Customers,Orders)?$filter=ROWID eq 1', 400, /Set\/ROWID/],
    ['/$crossjoin(Customers,Orders)?$filter=Nope/Name eq 1', 400, /no property "Nope\/Name"/],
    [`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent("Customers/Name eq 'x' or ROWID eq 2")}`, 400, /Set\/ROWID/],
    [`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent("Customers/Name eq 'Nobody' and Customers/Name eq 'x') or (Customers/Name ne 'zz'")}`, 400, /\$filter/],
    [`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent('and and Orders/Total eq 5 and')}`, 400, /\$filter/],
    ['/$crossjoin(Customers,Orders)?$expand=Customers,customers($select=Name)', 400, /more than once/],
    ['/$crossjoin(Customers,Orders)?$expand=Orders($select=Total;$select=Note)', 400, /one \$select/],
  ] as const) {
    const r = await get(path);
    assert.equal(r.res.status, status, path);
    assert.match(r.body.error.message, why, path);
  }
  const was = { ...CROSSJOIN_LIMIT };
  try {
    CROSSJOIN_LIMIT.pairs = 8;
    const many = await get('/$crossjoin(Customers,Orders)');
    assert.equal(many.res.status, 400);
    assert.match(many.body.error.message, /at most 8 combinations/);
    // A condition on one set alone narrows it before the join.
    assert.equal((await get(`/$crossjoin(Customers,Orders)?$filter=${encodeURIComponent("Customers/Name ne 'Nobody'")}`)).res.status, 200);
    CROSSJOIN_LIMIT.pairs = was.pairs;
    // The join runs in a worker, stopped past its time limit.
    CROSSJOIN_LIMIT.ms = 1;
    const slow = await get('/$crossjoin(Customers,Orders)');
    assert.equal(slow.res.status, 400);
    assert.match(slow.body.error.message, /took longer than/);
    CROSSJOIN_LIMIT.ms = was.ms;
    // Sorted by each set's own order, then by the next set's.
    const sorted = await get(`/$crossjoin(Customers,Orders)?$filter=${join_}&$orderby=Customers/Name desc,Orders/Total&$expand=*`);
    assert.deepEqual(sorted.body.value.map((r: any) => [r.Customers.Name, r.Orders.Total]), [['Jo', 40], ['Acme', 5], ['Acme', 100]]);
    CROSSJOIN_LIMIT.bytes = 5;
    const text = await get('/$crossjoin(Customers,Orders)?$orderby=Customers/Name');
    assert.equal(text.res.status, 400);
    assert.match(text.body.error.message, /MB of text/);
    CROSSJOIN_LIMIT.bytes = was.bytes;
    CROSSJOIN_LIMIT.records = 2;
    const big = await get('/$crossjoin(Customers,Orders)');
    assert.equal(big.res.status, 400);
    assert.match(big.body.error.message, /at most 2 records of each set and Customers has more/);
  } finally {
    Object.assign(CROSSJOIN_LIMIT, was);
  }
});

test('conjuncts splits at "and" only where that keeps the meaning', () => {
  const split = (text: string) => conjuncts(filterTokens(text)).map((x) => x.join(' '));
  assert.deepEqual(split("A/x eq 1 and (B/y eq 2 or B/y eq 3) and not A/z eq 'and'"), ['A / x eq 1', '( B / y eq 2 or B / y eq 3 )', "not A / z eq 'and'"]);
  assert.equal(split('A/x eq 1 or A/x eq 2 and B/y eq 3').length, 1);
  assert.equal(split("A/x eq 1 and A/x eq 2) or (A/x eq 3").length, 1);
  assert.equal(split('and A/x eq 1').length, 1);
  assert.deepEqual(split('A/And eq A/Or and B/y eq 1'), ['A / And eq A / Or', 'B / y eq 1']);
});
