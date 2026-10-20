import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { serve } from '../src/index.ts';
import { unzip } from '../../scripts/src/xlsx.ts';

test('native field values round trip through Data API and OData with typed shapes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-native-surfaces-'));
  const path = join(dir, 'Native.openhbam.sqlite');
  createStore(path, { mode: 'native' });
  const store = new Store(path, 'Native');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [
      { name: 'Flag', type: 'boolean' }, { name: 'Count', type: 'integer' }, { name: 'Price', type: 'decimal' },
      { name: 'Payload', type: 'json' }, { name: 'Key', type: 'uuid' },
    ] }]);
    const full = store.privilegeSets().find((p) => p.id === 1)!;
    store.savePrivilegeSet({ ...full, extendedPrivileges: [...full.extendedPrivileges, 'fmrest', 'fmodata', 'fmxdbc'] });
    store.setPassword('Admin', 'pw', full.name);
  } finally { store.close(); }
  const hosted = await serve({ dir, port: 0, log: () => {} });
  try {
    const api = `${hosted.url}/fmi/data/vLatest/databases/Native`;
    const login = await fetch(`${api}/sessions`, { method: 'POST', headers: { authorization: `Basic ${btoa('Admin:pw')}` } });
    assert.equal(login.status, 200);
    const token = (await login.json() as { response: { token: string } }).response.token;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const fields = { Flag: true, Count: -12, Price: '900719925474099312345.01', Payload: { z: [2, 1], a: true }, Key: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' };
    const write = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: JSON.stringify({ fieldData: fields }) });
    assert.equal(write.status, 200, await write.text());
    const read = await fetch(`${api}/layouts/Items/records`, { headers });
    assert.equal(read.status, 200);
    const record = (await read.json() as { response: { data: { fieldData: Record<string, unknown> }[] } }).response.data[0].fieldData;
    assert.deepEqual(record, { Flag: true, Count: -12, Price: fields.Price, Payload: { a: true, z: [2, 1] }, Key: fields.Key.toLowerCase() });
    const layout = await (await fetch(`${api}/layouts/Items`, { headers })).json() as { response: { fieldMetaData: { name: string; result: string }[] } };
    assert.deepEqual(Object.fromEntries(layout.response.fieldMetaData.map((f) => [f.name, f.result])), { Flag: 'boolean', Count: 'integer', Price: 'decimal', Payload: 'json', Key: 'uuid' });
    const decimalNumber = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: JSON.stringify({ fieldData: { Price: 0.12345678901234566 } }) });
    assert.match(JSON.stringify(await decimalNumber.json()), /decimal string/);
    const hugeInteger = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: '{"fieldData":{"Count":9007199254740993}}' });
    assert.match(JSON.stringify(await hugeInteger.json()), /9007199254740993/);
    const bigJson = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: '{"fieldData":{"Payload":{"big":900719925474099312345678901}}}' });
    assert.equal(bigJson.status, 200);
    assert.equal(hosted.host.get('Native')!.get('Items', 2).fieldData.Payload, '{"big":900719925474099312345678901}');
    const duplicate = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: '{"fieldData":{"Payload":{"a":1,"a":2}}}' });
    assert.equal(duplicate.status, 400);
    const deep = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: '{"fieldData":{"Payload":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}}' });
    assert.equal(deep.status, 400);
    assert.match(await deep.text(), /depth|nesting/i);
    const empty = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: JSON.stringify({ fieldData: { Flag: '', Count: '', Price: '', Payload: '', Key: '' } }) });
    assert.equal(empty.status, 200);
    const emptyId = (await empty.json() as { response: { recordId: string } }).response.recordId;
    const emptyRead = await (await fetch(`${api}/layouts/Items/records/${emptyId}`, { headers })).json() as { response: { data: { fieldData: Record<string, unknown> }[] } };
    assert.deepEqual(emptyRead.response.data[0].fieldData, { Flag: null, Count: null, Price: null, Payload: null, Key: null });
    const invalidDecimal = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: '{"fieldData":{"Price":"bad"}}' });
    assert.equal(invalidDecimal.status, 400);

    const odata = `${hosted.url}/fmi/odata/v4/Native`;
    const auth = { authorization: `Basic ${btoa('Admin:pw')}` };
    const metadata = await (await fetch(`${odata}/$metadata`, { headers: auth })).text();
    for (const [field, edm] of [['Flag', 'Edm.Boolean'], ['Count', 'Edm.Int64'], ['Price', 'Edm.Decimal'], ['Payload', 'Edm.String'], ['Key', 'Edm.Guid']]) {
      assert.match(metadata, new RegExp(`<Property Name="${field}" Type="${edm}"`));
    }
    const oread = await fetch(`${odata}/Items(1)`, { headers: auth });
    assert.equal(oread.status, 200, await oread.text());
    const item = await (await fetch(`${odata}/Items(1)`, { headers: auth })).json() as Record<string, unknown>;
    assert.deepEqual([item.Flag, item.Count, item.Price, item.Payload, item.Key], [true, -12, fields.Price, '{"a":true,"z":[2,1]}', fields.Key.toLowerCase()]);
    const owrite = await fetch(`${odata}/Items`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ Flag: false, Count: 3, Price: '0.1', Payload: { b: 1 }, Key: '00000000-0000-0000-0000-000000000001' }) });
    assert.equal(owrite.status, 201, await owrite.text());
    const oduplicate = await fetch(`${odata}/Items`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"Payload":{"a":1,"a":2}}' });
    assert.equal(oduplicate.status, 400);
    const ids = hosted.host.get('Native')!.findIds('Items', { query: [{ Price: '0.1' }] });
    assert.equal(ids.length, 1);
    const guid = await fetch(`${odata}/Items?$filter=${encodeURIComponent('Key eq AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')}`, { headers: auth });
    assert.equal(guid.status, 200);
    assert.deepEqual((await guid.json() as { value: { Key: string }[] }).value.map((r) => r.Key), [fields.Key.toLowerCase()]);
    const quotedGuid = await fetch(`${odata}/Items?$filter=${encodeURIComponent("Key eq 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'")}`, { headers: auth });
    assert.deepEqual((await quotedGuid.json() as { value: { Key: string }[] }).value.map((r) => r.Key), [fields.Key.toLowerCase()]);
    const exponent = await fetch(`${odata}/Items?$filter=${encodeURIComponent('Price gt 1e0')}`, { headers: auth });
    assert.match(JSON.stringify(await exponent.json()), /exponent literals are unsupported/);
    const compatible = await fetch(`${odata}/Items(1)`, { headers: { ...auth, accept: 'application/json;IEEE754Compatible=true' } });
    assert.match(compatible.headers.get('content-type') ?? '', /IEEE754Compatible=true/);
    assert.equal((await compatible.json() as { Price: string }).Price, fields.Price);
    const compatibleInteger = await fetch(`${odata}/Items(1)`, { headers: { ...auth, accept: 'application/json;IEEE754Compatible=true' } });
    const compatibleValues = await compatibleInteger.json() as { Count: unknown; ROWID: unknown; ROWMODID: unknown };
    assert.equal(compatibleValues.Count, '-12');
    assert.equal(compatibleValues.ROWID, '1');
    assert.equal(typeof compatibleValues.ROWMODID, 'string');
    const compatibleCount = await fetch(`${odata}/Items?$count=true&$top=0`, { headers: { ...auth, accept: 'application/json;IEEE754Compatible=true' } });
    assert.equal(typeof (await compatibleCount.json() as { '@odata.count': unknown })['@odata.count'], 'string');
    const integerApply = await fetch(`${odata}/Items?$apply=${encodeURIComponent('aggregate(Count with sum as NS,Count with average as NA)')}`, { headers: auth });
    assert.equal(integerApply.status, 200, await integerApply.clone().text());
    assert.deepEqual((await integerApply.json() as { value: { NS: number; NA: number }[] }).value[0], { '@odata.id': null, NS: -9, NA: -4.5 });
    const badDecimalFilter = await fetch(`${odata}/Items?$filter=${encodeURIComponent("Price eq 'abc'")}`, { headers: auth });
    assert.deepEqual((await badDecimalFilter.json() as { value?: unknown[] }).value ?? [], []);
    const notNine = await fetch(`${odata}/Items?$filter=${encodeURIComponent('Price ne 9')}`, { headers: auth });
    assert.equal(notNine.status, 200, await notNine.clone().text());
    assert.ok((await notNine.json() as { value: { Price: string | null }[] }).value.some((row) => row.Price === null));
    const applied = await fetch(`${odata}/Items?$apply=${encodeURIComponent('filter(Price lt 1)/aggregate(Price with sum as Total,Price with average as Mean,Price with min as Low,Price with max as High)')}`, { headers: auth });
    assert.equal(applied.status, 200, await applied.clone().text());
    assert.deepEqual((await applied.json() as { value: { Total: string; Mean: string; Low: string; High: string }[] }).value[0], { '@odata.id': null, Total: '0.1', Mean: '0.1', Low: '0.1', High: '0.1' });
    const sql = await fetch(`${hosted.url}/tabularius/sql/v1/databases/Native`, { method: 'POST', headers, body: JSON.stringify({ sql: 'SELECT Price FROM Items WHERE Price > 1 ORDER BY Price' }) });
    assert.equal(sql.status, 200, await sql.clone().text());
    assert.deepEqual((await sql.json() as { rows: number[][] }).rows, [[Number(fields.Price)]]);
    const filtered = await fetch(`${odata}/Items?$filter=${encodeURIComponent('Price gt 900719925474099312345.00')}`, { headers: auth });
    assert.equal(filtered.status, 200);
    assert.deepEqual((await filtered.json() as { value: { Price: string }[] }).value.map((r) => r.Price), [fields.Price]);
    const sorted = await fetch(`${odata}/Items?$filter=${encodeURIComponent('Price ne null')}&$orderby=Price desc`, { headers: auth });
    assert.equal(sorted.status, 200);
    assert.deepEqual((await sorted.json() as { value: { Price: string }[] }).value.map((r) => r.Price), [fields.Price, '0.1']);
    const high = await fetch(`${api}/layouts/Items/records`, { method: 'POST', headers, body: '{"fieldData":{"Price":"900719925474099312345.02"}}' });
    assert.equal(high.status, 200);
    const extrema = await fetch(`${odata}/Items?$apply=${encodeURIComponent('aggregate(Price with min as Low,Price with max as High)')}`, { headers: auth });
    assert.deepEqual((await extrema.json() as { value: { Low: string; High: string }[] }).value[0], { '@odata.id': null, Low: '0.1', High: '900719925474099312345.02' });
    const exportFile = (format: string) => fetch(`${hosted.url}/tabularius/app/v1/databases/Native/layouts/Items/export`, {
      method: 'POST', headers, body: JSON.stringify({ fields: ['Flag', 'Count', 'Price', 'Payload', 'Key'], format, ids: [1] }),
    });
    const csv = await exportFile('csv');
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    assert.match(csvText, /"1","-12","900719925474099312345\.01"/);
    assert.match(csvText, /"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"/);
    const xml = await exportFile('xml');
    assert.equal(xml.status, 200);
    const xmlText = await xml.text();
    assert.match(xmlText, /NAME="Price" TYPE="NUMBER"/);
    assert.match(xmlText, /NAME="Payload" TYPE="TEXT"/);
    assert.match(xmlText, /900719925474099312345\.01/);
    const xl = await exportFile('xlsx');
    assert.equal(xl.status, 200);
    const sheet = new TextDecoder().decode(unzip(new Uint8Array(await xl.arrayBuffer())).get('xl/worksheets/sheet1.xml'));
    assert.match(sheet, /<c r="C1" t="inlineStr"><is><t xml:space="preserve">900719925474099312345\.01<\/t><\/is><\/c>/);
    const schema = await fetch(`${odata}/FileMaker_Tables`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ tableName: 'NativeDDL', fields: [{ name: 'A', type: 'NUMERIC' }, { name: 'B', type: 'INT' }, { name: 'C', type: 'BIGINT' }] }) });
    assert.equal(schema.status, 201, await schema.text());
    assert.deepEqual(hosted.host.get('Native')!.schema.tables.find((t) => t.name === 'NativeDDL')?.fields.map((f) => f.type), ['decimal', 'integer', 'integer']);
    const live = hosted.host.get('Native')!;
    live.applyDesign([
      { op: 'createTable', name: 'Links', fields: [{ name: 'ParentKey', type: 'uuid' }, { name: 'Payload', type: 'json' }, { name: 'Flag', type: 'boolean' }, { name: 'Amount', type: 'decimal' }, { name: 'Count', type: 'integer' }] },
      { op: 'createRelationship', left: 'Items', right: 'Links', predicates: [{ left: 'Key', right: 'ParentKey' }] },
    ]);
    live.create('Links', { ParentKey: fields.Key, Payload: '{"nested":12345678901234567890}', Flag: 'true' });
    const occ = live.schema.tableOccurrences.find((t) => t.name === 'Links')!;
    const linkTable = live.schema.tables.find((t) => t.name === 'Links')!;
    const field = (name: string, id: number) => ({
      id, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      bounds: { left: 10, top: 10, right: 200, bottom: 30 },
      field: { tableOccurrenceId: occ.id, fieldId: linkTable.fields.find((f) => f.name === name)!.id, tableOccurrence: 'Links', field: name, display: 'edit', repetitions: 1 },
    });
    live.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [field('Payload', 501), field('Amount', 504), field('Count', 505), {
      id: 502, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, style: {},
      bounds: { left: 10, top: 40, right: 200, bottom: 140 },
      portal: { tableOccurrenceId: occ.id, tableOccurrence: 'Links', rows: 2, initialRow: 1 }, children: [field('Flag', 503), field('Amount', 506), field('Count', 507)],
    }] as any, tableView: [] } }]);
    const relatedResponse = await fetch(`${api}/layouts/Items/records/1`, { headers });
    const relatedText = await relatedResponse.text();
    assert.match(relatedText, /12345678901234567890/);
    const related = JSON.parse(relatedText) as { response: { data: { fieldData: Record<string, unknown>; portalData: Record<string, Record<string, unknown>[]> }[] } };
    assert.deepEqual(related.response.data[0].fieldData['Links::Payload'], { nested: 12345678901234567000 });
    assert.equal(related.response.data[0].portalData.Links[0]['Links::Flag'], true);
    const relatedWrite = await fetch(`${api}/layouts/Items/records/1`, { method: 'PATCH', headers, body: '{"fieldData":{"Links::Payload":{"z":900719925474099312345678901}}}' });
    assert.equal(relatedWrite.status, 200, await relatedWrite.text());
    assert.equal(live.get('Links', 1).fieldData.Payload, '{"z":900719925474099312345678901}');
    const portalWrite = await fetch(`${api}/layouts/Items/records/1`, { method: 'PATCH', headers, body: '{"portalData":{"Links":[{"recordId":"1","Links::Payload":{"a":1}}]}}' });
    assert.equal(portalWrite.status, 200, await portalWrite.text());
    assert.equal(live.get('Links', 1).fieldData.Payload, '{"a":1}');
    const exact = await fetch(`${api}/layouts/Items/records/1`, { method: 'PATCH', headers, body: '{"fieldData":{"Links::Amount":"900719925474099312345.0123456789"},"portalData":{"Links":[{"recordId":"1","Links::Count":123}]}}' });
    assert.equal(exact.status, 200, await exact.text());
    assert.equal(live.get('Links', 1).fieldData.Amount, '900719925474099312345.0123456789');
    assert.equal(live.get('Links', 1).fieldData.Count, 123);
    const unsafeRelated = await fetch(`${api}/layouts/Items/records/1`, { method: 'PATCH', headers, body: '{"fieldData":{"Links::Count":9007199254740993}}' });
    assert.equal(unsafeRelated.status, 400);
    assert.match(await unsafeRelated.text(), /9007199254740993/);
    const unsafePortal = await fetch(`${api}/layouts/Items/records/1`, { method: 'PATCH', headers, body: '{"portalData":{"Links":[{"recordId":"1","Links::Amount":0.12345678901234566}]}}' });
    assert.equal(unsafePortal.status, 400);
    assert.match(await unsafePortal.text(), /decimal string/);
  } finally {
    await new Promise<void>((resolve) => hosted.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
