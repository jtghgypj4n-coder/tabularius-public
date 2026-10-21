import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreError } from '../src/index.ts';
import { IDENTITIES, IDENTITY, SECRET, context, identityText, openSynthetic } from '../../scripts/test/privilege-inheritance-model.ts';

test('a mapped login keeps the person name and resolves the mapped account privilege set', (t) => {
  const s = openSynthetic(); t.after(s.close);
  const account = 'generated-person@example.invalid';
  const privileges = s.store.privileges(account, 'Reader');
  assert.equal(s.store.evaluate('Items', IDENTITY, 1, { account, privileges }).value, `${account}|Restricted|Restricted`);
});

test('custom functions and display calculations use the viewer, not the record writer', (t) => {
  const s = openSynthetic(); t.after(s.close);
  s.store.applyDesign([{ op: 'createCustomFunction', name: 'Who', parameters: [], formula: IDENTITY }]);
  for (const who of IDENTITIES) {
    const opts = { account: who.account, privileges: s.store.privileges(who.account) };
    const expected = identityText(context(who, { ownFull: false, edge: 'local' }, 0));
    // evaluateEach is the web client's shared path for conditional formats, labels and tooltips.
    const formulas = ['Who ( )', 'Viewer', `Evaluate ( ${JSON.stringify(IDENTITY)} )`,
      `Get ( AccountName ) = "${who.account}" and Get ( CurrentPrivilegeSetName ) = "${who.set}"`,
      `Secret = "${SECRET}"`];
    assert.deepEqual(s.store.evaluateEach('Items', formulas, 1, opts).map((v) => v?.value), [expected, expected, expected, 1, who.read ? 1 : 0]);
  }
});

test('relationship record rules and portal filters evaluate under the viewing account', (t) => {
  const s = openSynthetic(); t.after(s.close);
  s.store.applyDesign([
    { op: 'createTable', name: 'Children', fields: [{ name: 'Link' }, { name: 'Owner' }, { name: 'Value' }] },
    { op: 'createRelationship', left: 'Items', right: 'Children', predicates: [{ left: 'Public', right: 'Link' }] },
  ]);
  for (const who of IDENTITIES) s.store.create('Children', { Link: 'visible', Owner: who.account, Value: 'generated' }, { account: 'Admin' });
  for (const who of IDENTITIES.filter((who) => !who.full)) s.store.savePrivilegeSet({ ...s.store.privilegeSet(who.set)!,
    tables: { Children: { view: 'Owner = Get ( AccountName )', edit: false, create: false, delete: false } },
  });
  const occurrence = s.store.schema.tableOccurrences.find((o) => o.name === 'Children')!;
  const design = s.store.design('Items')!;
  s.store.applyDesign([{ op: 'updateLayout', layout: 'Items', design: { objects: [...design.objects, {
    id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 200, left: 20, bottom: 300, right: 300 }, style: {},
    portal: { tableOccurrenceId: occurrence.id, tableOccurrence: 'Children', rows: 10, initialRow: 1,
      filter: 'Owner = Get ( AccountName ) and Get ( CurrentPrivilegeSetName ) = Get ( AccountPrivilegeSetName )' }, children: [],
  }] } }]);
  for (const who of IDENTITIES) {
    const privileges = s.store.privileges(who.account);
    // The portal filter compares the two getters, so also pin each to its literal: equal-but-wrong would pass the filter.
    assert.equal(s.store.evaluate('Items', 'Get ( AccountPrivilegeSetName ) & "|" & Get ( CurrentPrivilegeSetName )', 1, { account: who.account, privileges }).value, `${who.set}|${who.set}`);
    const owners = s.store.evaluate('Items', 'List ( Children::Owner )', 1, { account: who.account, privileges }).value;
    assert.equal(owners, who.full ? IDENTITIES.map((i) => i.account).join('\r') : who.account);
    const rows = s.store.get('Items', 1, 'us', { Children: { limit: 10 } }, privileges).portalData!.Children;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['Children::Owner'], who.account);
  }
});

test('stored and auto-enter results retain writer-time values; unstored values use the reader', (t) => {
  const s = openSynthetic(); t.after(s.close);
  s.store.applyDesign([
    { op: 'createField', table: 'Items', name: 'Stored', kind: 'calculation', type: 'text', calculation: 'Secret & ":saved"' },
    { op: 'createField', table: 'Items', name: 'Auto', type: 'text', calculation: `${IDENTITY} & "|" & Secret & Public`, options: { autoEnter: { calculation: true, replaceExisting: true } } },
  ]);
  s.store.update('Items', 1, { Public: 'edited' }, undefined, { account: 'Editor', privileges: s.store.privileges('Editor') });
  const reader = s.store.get('Items', 1, 'us', undefined, s.store.privileges('Reader')).fieldData;
  // Retained policy, NOT a claim of documented Claris non-disclosure/parity.
  assert.equal(reader.Stored, `${SECRET}:saved`);
  assert.equal(reader.Auto, `Editor|Editing|Editing|${SECRET}edited`);
  assert.equal(reader.Viewer, 'Reader|Restricted|Restricted');
  assert.ok(!Object.hasOwn(reader, 'Secret'));
});

test('validation identity is the writer; hidden-value validation remains an explicit oracle', (t) => {
  const s = openSynthetic(); t.after(s.close);
  s.store.savePrivilegeSet({ ...s.store.privilegeSet('Editing')!, records: {
    view: true, edit: true, create: false, delete: false, fields: { Secret: 'none' },
  } });
  s.store.applyDesign([{ op: 'updateField', table: 'Items', field: 'Public', options: { validation: {
    calculation: `Get ( AccountName ) = "Editor" and Get ( AccountPrivilegeSetName ) = "Editing" and Get ( CurrentPrivilegeSetName ) = "Editing" and Secret = Public`, always: true,
  } } }]);
  const opts = { account: 'Editor', privileges: s.store.privileges('Editor') };
  assert.doesNotThrow(() => s.store.update('Items', 1, { Public: SECRET }, undefined, opts));
  assert.throws(() => s.store.update('Items', 1, { Public: 'different' }, undefined, opts), (e) => e instanceof StoreError && e.code === 507);
  assert.equal(s.store.get('Items', 1).fieldData.Public, SECRET, 'a rejected write is not committed');
  // Internal write-time full-data evaluation is retained; FileMaker parity for this oracle is unverified.
  assert.equal(s.store.evaluate('Items', 'Secret', 1, opts).value, '');
});
