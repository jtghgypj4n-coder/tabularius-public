// OData navigation: each relationship gives both occurrences a navigation property to the other,
// shown in $metadata, followed with $expand (on a list or one record) or a path
// (Customers(1)/Orders), and limited by record and field access as everything else is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { EXPAND_LIMIT } from '../src/odata.ts';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Charts.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;
let server: Server;
let root: string;
let store: Store;
const ids: Record<string, number> = {};
const auth = (who: string) => ({ authorization: 'Basic ' + btoa(`${who}:pw`) });

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'tabularius-odata-expand-'));
  copyFileSync(fixture, join(dir, 'Charts.fmp12'));
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  server = s.server;
  root = `${s.url}/fmi/odata/v4/Charts`;
  store = s.host.get('Charts')!;
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
  return { res, body: res.headers.get('content-type')?.includes('json') ? await res.json() as Record<string, any> : await res.text() as any };
};

test('$metadata lists a navigation property at both ends of a relationship', { skip }, async () => {
  const { res, body } = await get('/$metadata');
  assert.equal(res.status, 200);
  assert.match(body, /<EntityType Name="Customers">[\s\S]*?<NavigationProperty Name="Orders" Type="Collection\(Charts\.Orders\)"\/>[\s\S]*?<\/EntityType>/);
  assert.match(body, /<EntityType Name="Orders">[\s\S]*?<NavigationProperty Name="Customers" Type="Collection\(Charts\.Customers\)"\/>[\s\S]*?<\/EntityType>/);
  assert.match(body, /<EntitySet Name="Customers" EntityType="Charts\.Customers"><NavigationPropertyBinding Path="Orders" Target="Orders"\/><\/EntitySet>/);
});

test('$expand puts each record\'s related records inline, with their own $select, $top and $skip', { skip }, async () => {
  const { res, body } = await get("/Customers?$filter=CustomerID eq 'C1' or CustomerID eq 'C3'&$select=Name&$expand=Orders");
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.value.map((c: any) => [c.Name, c.Orders.map((o: any) => [o.Total, o.Note])]), [['Acme', [[100, 'big'], [5, 'small']]], ['Nobody', []]]);
  assert.match(body['@odata.context'], /#Customers\(ROWID,ROWMODID,Name,Orders\)$/);
  const some = await get("/Customers?$filter=CustomerID eq 'C1'&$expand=Orders($select=Total;$top=1;$skip=1)");
  assert.deepEqual(some.body.value[0].Orders.map((o: any) => Object.keys(o).filter((k) => !k.startsWith('@'))), [['ROWID', 'ROWMODID', 'Total']]);
  assert.equal(some.body.value[0].Orders[0].Total, 5);
  // One record, and the other way round.
  const one = await get(`/Customers(${ids.jo})?$expand=Orders`);
  assert.deepEqual(one.body.Orders.map((o: any) => o.Total), [40]);
  const back = await get('/Orders?$filter=Total eq 40&$expand=Customers($select=Name)');
  assert.deepEqual(back.body.value[0].Customers.map((c: any) => c.Name), ['Jo']);
});

test('a page whose related records pass the limit ends early, and its next link carries on', { skip }, async () => {
  const was = EXPAND_LIMIT.records;
  EXPAND_LIMIT.records = 2;
  try {
    // Acme has 2 orders, Jo 1, Nobody none: the page stops after Acme.
    const first = await get('/Customers?$expand=Orders&$count=true');
    assert.deepEqual(first.body.value.map((c: any) => c.Name), ['Acme']);
    const next = new URL(first.body['@odata.nextLink']);
    assert.equal(next.searchParams.get('$skip'), '1');
    assert.equal(next.searchParams.get('$expand'), 'Orders');
    const rest = await get(next.pathname.replace(/^.*\/Charts/, '') + next.search);
    assert.deepEqual(rest.body.value.map((c: any) => [c.Name, c.Orders.length]), [['Jo', 1], ['Nobody', 0]]);
    assert.equal(rest.body['@odata.nextLink'], undefined);
    // With $top, the next link asks for what's left of it.
    const top = await get('/Customers?$expand=Orders&$top=2');
    assert.equal(new URL(top.body['@odata.nextLink']).searchParams.get('$top'), '1');
    // $top inside $expand reads only that many, so the whole page fits.
    const few = await get('/Customers?$expand=Orders($top=0)');
    assert.equal(few.body.value.length, 3);
    assert.equal(few.body['@odata.nextLink'], undefined);
    // One record, or a navigation path, past the limit is refused.
    EXPAND_LIMIT.records = 1;
    assert.equal((await get(`/Customers(${ids.acme})?$expand=Orders`)).res.status, 400);
    assert.equal((await get(`/Customers(${ids.acme})/Orders`)).res.status, 400);
    assert.equal((await get('/Customers?$expand=Orders')).res.status, 400, 'not even the first record fits');
  } finally {
    EXPAND_LIMIT.records = was;
  }
});

test('a navigation path lists the related records', { skip }, async () => {
  const { res, body } = await get(`/Customers(${ids.acme})/Orders?$select=Note&$top=1`);
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(body['@odata.context'], /#Orders$/);
  assert.deepEqual(body.value.map((o: any) => o.Note), ['big']);
  assert.equal((await get('/Customers(999999)/Orders')).res.status, 404);
});

test('a related collection of more than 1,000 records is refused, and says how to page it', { skip }, async () => {
  const parent = store.create('Customers', { CustomerID: 'MANY', Name: 'Many' }).recordId;
  const children: number[] = [];
  try {
    for (let i = 0; i < 1001; i++) children.push(store.create('Orders', { CustomerID: 'MANY', Total: i }).recordId);
    for (const path of [
      `/Customers(${parent})/Orders?$count=true`,
      `/Customers(${parent})/Orders/$ref?$count=true`,
      `/Customers(${parent})?$expand=Orders`,
    ]) {
      const { res, body } = await get(path);
      assert.equal(res.status, 400, `${path}: ${JSON.stringify(body).slice(0, 250)}`);
    }
    const unpaged = await get(`/Customers(${parent})/Orders`);
    assert.equal(unpaged.res.status, 400);
    assert.match(JSON.stringify(unpaged.body), /more than 1,000 records: page it with \$top \(at most 1,000\) and \$skip/);
    // A $top over the limit says so, where it used to be cut to 1,000 without a word; a small collection still takes it.
    const tooBig = await get(`/Customers(${parent})/Orders?$top=5000`);
    assert.equal(tooBig.res.status, 400);
    assert.match(JSON.stringify(tooBig.body), /\$top must be at most 1,000 for related records/);
    assert.equal((await get(`/Customers(${ids.acme})/Orders?$top=5000`)).res.status, 200);
    const first = await get(`/Customers(${parent})/Orders?$top=1000`);
    const last = await get(`/Customers(${parent})/Orders?$skip=1000&$top=1`);
    assert.equal(first.res.status, 200);
    assert.equal(last.res.status, 200);
    assert.equal(first.body.value.length + last.body.value.length, 1001);
  } finally {
    for (const child of children) store.delete('Orders', child);
    store.delete('Customers', parent);
  }
});

test('related records follow record and field access', { skip }, async () => {
  const { body } = await get(`/Customers(${ids.acme})?$expand=Orders`, 'Cy');
  assert.deepEqual(body.Orders.map((o: any) => o.Total), [5], 'the order over 50 is left out');
  assert.equal('Note' in body.Orders[0], false, 'a field the account can\'t see is left out');
  const path = await get(`/Customers(${ids.acme})/Orders`, 'Cy');
  assert.deepEqual(path.body.value.map((o: any) => o.Total), [5]);
  assert.equal((await get(`/Customers(${ids.acme})?$expand=Orders($select=Note)`, 'Cy')).res.status, 400);
});

test('a relationship whose match fields the account can\'t read is not offered', { skip }, async () => {
  const { body } = await get('/$metadata', 'Kim');
  assert.doesNotMatch(body, /NavigationProperty Name="(Orders|Customers)"/);
  assert.match(body, /<EntityType Name="Customers">/);
  const r = await get('/Orders?$expand=Customers', 'Kim');
  assert.equal(r.res.status, 400);
  assert.equal((await get(`/Customers(${ids.acme})/Orders`, 'Kim')).res.status, 404);
  assert.equal((await get(`/Customers(${ids.acme})/Orders/$ref`, 'Kim')).res.status, 404, '$ref reaches no relationship the records don\'t');
});

test('$filter and $orderby inside $expand, and on a navigation path, narrow and order the related records', { skip }, async () => {
  const q = (expand: string) => get(`/Customers?$filter=CustomerID eq 'C1'&$select=Name&$expand=${encodeURIComponent(expand)}`);
  const big = await q('Orders($filter=Total gt 50)');
  assert.equal(big.res.status, 200, JSON.stringify(big.body));
  assert.deepEqual(big.body.value[0].Orders.map((o: any) => o.Total), [100]);
  const ordered = await q('Orders($orderby=Total;$select=Total)');
  assert.deepEqual(ordered.body.value[0].Orders.map((o: any) => o.Total), [5, 100]);
  const top = await q('Orders($orderby=Total desc;$top=1)');
  assert.deepEqual(top.body.value[0].Orders.map((o: any) => o.Total), [100]);
  // Quotes may hold ; ( and ) inside $expand.
  const quoted = await q("Orders($filter=Note eq 'a;b(c)' or Note eq 'small')");
  assert.deepEqual(quoted.body.value[0].Orders.map((o: any) => o.Note), ['small']);

  const path = await get(`/Customers(${ids.acme})/Orders?$filter=${encodeURIComponent('Total lt 50')}&$orderby=Total`);
  assert.deepEqual(path.body.value.map((o: any) => o.Total), [5]);
  // Record and field access still hold: Cy can't see orders of 50 or more, nor filter on their notes.
  const cy = await get(`/Customers(${ids.acme})/Orders?$orderby=${encodeURIComponent('Total desc')}`, 'Cy');
  assert.deepEqual(cy.body.value.map((o: any) => o.Total), [5]);
  assert.equal((await get(`/Customers(${ids.acme})/Orders?$filter=${encodeURIComponent("Note eq 'big'")}`, 'Cy')).res.status, 400);
});

test('bad $expand requests are refused clearly', { skip }, async () => {
  const nope = await get('/Customers?$expand=Nope');
  assert.equal(nope.res.status, 400);
  assert.match(nope.body.error.message, /no navigation property "Nope"/);
  const opt = await get('/Customers?$expand=Orders($count=true)');
  assert.equal(opt.res.status, 501);
  assert.equal((await get('/Customers?$expand=Orders($filter=Nope gt 1)')).res.status, 400);
  assert.equal((await get("/Customers?$expand=Orders($filter=Note eq 'x)")).res.status, 400);
  assert.equal((await get('/Customers?$expand=Orders($top=1;$top=2)')).res.status, 400);
  assert.equal((await get('/Customers?$expand=Orders($top=1')).res.status, 400);
  const twice = await get('/Customers?$expand=Orders,orders');
  assert.equal(twice.res.status, 400);
  assert.match(twice.body.error.message, /named twice/);
  assert.equal((await get('/Customers?$expand=Orders,*')).res.status, 200, '* adds only what is not named yet');
});

test('a $filter in $expand or on a navigation path past SQLite\'s limits is a 400', { skip }, async () => {
  const deep = Array.from({ length: 1_500 }, (_, i) => `Total eq ${i}`).join(' or ');
  const res = await fetch(`${root}/$batch`, {
    method: 'POST', headers: { ...auth('Ann'), 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [
      { id: '1', method: 'GET', url: `Customers?$filter=CustomerID eq 'C1'&$expand=Orders($filter=${encodeURIComponent(deep)})` },
      { id: '2', method: 'GET', url: `Customers(${ids.acme})/Orders?$filter=${encodeURIComponent(deep)}` },
    ] }),
  });
  for (const answer of ((await res.json()) as { responses: { status: number; body: any }[] }).responses) {
    assert.equal(answer.status, 400, JSON.stringify(answer.body));
    assert.match(JSON.stringify(answer.body), /too complex/);
  }
});

test('a navigation path counts its records, and reads one of them by ROWID', { skip }, async () => {
  const text = async (path: string, who = 'Ann') => {
    const res = await fetch(root + path, { headers: auth(who) });
    return { status: res.status, body: await res.text() };
  };
  assert.deepEqual(await text(`/Customers(${ids.acme})/Orders/$count`), { status: 200, body: '2' });
  assert.deepEqual(await text(`/Customers(${ids.acme})/Orders/$count?$filter=${encodeURIComponent('Total gt 50')}`), { status: 200, body: '1' });
  assert.deepEqual(await text(`/Customers(${ids.acme})/Orders/$count`, 'Cy'), { status: 200, body: '1' }, 'records the account can\'t view aren\'t counted');
  assert.deepEqual(await text(`/Customers(${ids.none})/Orders/$count`), { status: 200, body: '0' });
  const counted = await get(`/Customers(${ids.acme})/Orders?$count=true&$top=1&$skip=1`);
  assert.equal(counted.body['@odata.count'], 2);
  assert.equal(counted.body.value.length, 1);

  const orders = (await get(`/Customers(${ids.acme})/Orders?$orderby=Total`)).body.value as { ROWID: number; Total: number }[];
  const small = orders[0];
  const one = await get(`/Customers(${ids.acme})/Orders(${small.ROWID})`);
  assert.equal(one.res.status, 200, JSON.stringify(one.body));
  assert.match(one.body['@odata.context'], /#Orders\/\$entity$/);
  assert.equal(one.body.Total, 5);
  assert.equal(one.res.headers.get('etag'), one.body['@odata.etag']);
  const picked = await get(`/Customers(${ids.acme})/Orders(${small.ROWID})?$select=Note&$expand=Customers($select=Name)`);
  assert.equal(picked.body.Total, undefined);
  assert.equal(picked.body.Note, 'small');
  assert.deepEqual(picked.body.Customers.map((c: any) => c.Name), ['Acme']);
  // Another customer's order is not related to this one.
  const jo = (await get(`/Customers(${ids.jo})/Orders`)).body.value[0] as { ROWID: number };
  assert.equal((await get(`/Customers(${ids.acme})/Orders(${jo.ROWID})`)).res.status, 404);
  // Nor is one the account can't view, even though it is related.
  assert.equal((await get(`/Customers(${ids.acme})/Orders(${orders[1].ROWID})`, 'Cy')).res.status, 404);
  assert.equal((await get(`/Customers(${ids.acme})/Orders(${small.ROWID})`, 'Cy')).body.Note, undefined);
  assert.equal((await get(`/Customers(${ids.acme})/Orders(x)`)).res.status, 400);
  assert.equal((await get(`/Customers(${ids.acme})/Orders/Total`)).res.status, 404);
});

const names = async (filter: string, who = 'Ann', set = 'Customers') => {
  const r = await get(`/${set}?$select=${set === 'Customers' ? 'Name' : 'Note'}&$filter=${encodeURIComponent(filter)}&$orderby=${set === 'Customers' ? 'Name' : 'Note'}`, who);
  return { status: r.res.status, names: r.body.value?.map((c: any) => c.Name ?? c.Note), body: r.body };
};

test('$filter any() and all() test a customer\'s related orders', { skip }, async () => {
  assert.deepEqual((await names('Orders/any(o: o/Total gt 50)')).names, ['Acme']);
  assert.deepEqual((await names('Orders/any(o: o/Total lt 50)')).names, ['Acme', 'Jo']);
  // all() passes for a customer with no orders at all.
  assert.deepEqual((await names('Orders/all(o: o/Total gt 10)')).names, ['Jo', 'Nobody']);
  assert.deepEqual((await names('not Orders/any(o: o/Total gt 0)')).names, ['Nobody']);
  assert.deepEqual((await names("Orders/any(o: o/Total gt 1) and Name ne 'Acme'")).names, ['Jo']);
  assert.deepEqual((await names("Orders/any(o: contains(o/Note, 'mid') or o/Total eq 100)")).names, ['Acme', 'Jo']);
});

test('any() and all() see only the related records the account may view', { skip }, async () => {
  // Cy sees orders under 50, so the 100 order is not there to match.
  assert.deepEqual((await names('Orders/any(o: o/Total gt 50)', 'Cy')).names, []);
  assert.deepEqual((await names('Orders/all(o: o/Total gt 10)', 'Cy')).names, ['Jo', 'Nobody']);
  // Nor can a hidden field be tested through the lambda.
  assert.equal((await names("Orders/any(o: o/Note eq 'small')", 'Cy')).status, 400);
});

test('any() and all() give clear errors where they cannot work', { skip }, async () => {
  assert.equal((await names('Orders/all()')).status, 400);
  assert.equal((await names('Nothing/any(o: o/Total gt 1)')).status, 400);
  assert.equal((await names('Orders/any(o: o/Missing gt 1)')).status, 400);
  const r = await names('Orders/any(o: o/Total gt 1)', 'Ann', 'Orders');
  assert.equal(r.status, 400);
});

test('any() and all() nest only a few deep and only so many times in one $filter', { skip }, async () => {
  const deep = (n: number): string => n === 0 ? 'o/Total gt 1' : `Customers/any(c: Orders/any(o: ${deep(n - 1)}))`;
  const one = await names(deep(1), 'Ann', 'Orders'); assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal((await names(deep(40), 'Ann', 'Orders')).status, 400);
  assert.equal((await names(Array.from({ length: 25 }, () => 'Orders/any(o: o/Total gt 1)').join(' or '))).status, 400);
});

test('$ref gives links to the related records, not the records', { skip }, async () => {
  const orders = (await get(`/Customers(${ids.acme})/Orders?$orderby=Total`)).body.value as { ROWID: number }[];
  const refs = await get(`/Customers(${ids.acme})/Orders/$ref?$orderby=Total&$count=true`);
  assert.equal(refs.res.status, 200, JSON.stringify(refs.body));
  assert.match(refs.body['@odata.context'], /#Collection\(\$ref\)$/);
  assert.equal(refs.body['@odata.count'], 2);
  assert.deepEqual(refs.body.value, orders.map((o) => ({ '@odata.id': `${root}/Orders(${o.ROWID})` })));
  // The same paging and $filter as the records, and nothing of what is in them.
  const page = await get(`/Customers(${ids.acme})/Orders/$ref?$orderby=Total&$top=1&$skip=1`);
  assert.deepEqual(page.body.value, [{ '@odata.id': `${root}/Orders(${orders[1].ROWID})` }]);
  const big = await get(`/Customers(${ids.acme})/Orders/$ref?$filter=${encodeURIComponent('Total gt 50')}`);
  assert.equal(big.body.value.length, 1);
  assert.equal(JSON.stringify(refs.body).includes('Total'), false);
  // Only records the account may view.
  assert.equal((await get(`/Customers(${ids.acme})/Orders/$ref`, 'Cy')).body.value.length, 1);
  assert.deepEqual((await get(`/Customers(${ids.none})/Orders/$ref`)).body.value, []);
  // One related record.
  const one = await get(`/Customers(${ids.acme})/Orders(${orders[0].ROWID})/$ref`);
  assert.equal(one.res.status, 200, JSON.stringify(one.body));
  assert.deepEqual(one.body, { '@odata.context': `${root}/$metadata#$ref`, '@odata.id': `${root}/Orders(${orders[0].ROWID})` });
  const jo = (await get(`/Customers(${ids.jo})/Orders`)).body.value[0] as { ROWID: number };
  assert.equal((await get(`/Customers(${ids.acme})/Orders(${jo.ROWID})/$ref`)).res.status, 404);
  assert.equal((await get(`/Customers(${ids.acme})/Orders(${orders[1].ROWID})/$ref`, 'Cy')).res.status, 404, 'a record the account can\'t view');
  assert.equal((await get(`/Customers(${ids.acme})/Orders/$ref/x`)).res.status, 404);
  // Links are read, not written.
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const r = await fetch(`${root}/Customers(${ids.acme})/Orders/$ref`, { method, headers: { ...auth('Ann'), 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
    assert.equal(r.status < 500 && r.status >= 400, true, `${method}: ${r.status}`);
    await r.text();
  }
  assert.equal((await get(`/Customers(${ids.acme})/Orders/$ref?$count=true`)).body['@odata.count'], 2, 'nothing was changed');
});
