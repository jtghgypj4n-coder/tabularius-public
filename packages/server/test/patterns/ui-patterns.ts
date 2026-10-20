// Patterns about layouts and windows: summary reports, portals, containers, card windows, custom menus and script
// triggers. The checks that need a browser (conditional formatting, tooltips, tab controls, popovers, and what the
// web client draws for the rest) are in packages/web/e2e/solution-patterns.e2e.ts, keyed by the same ids.

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { LayoutObject } from '../../../fmp12/src/index.ts';
import type { Store } from '../../../store/src/index.ts';
import { runScript } from '../../../scripts/src/index.ts';
import { partial, pass, pdfText, unverified, type Pattern, type Workbench } from './framework.ts';

const lines = (...steps: string[]) => steps.join('\n');
const anchors = { left: true, top: true, right: false, bottom: false };
const fieldId = (s: Store, table: string, field: string): number => s.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === field)!.id;

// A 2×2 red PNG.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

export const UI_PATTERNS: Pattern[] = [
  {
    id: 'summary-report',
    title: 'Summary reports with sub-summaries',
    what: 'Records sorted by a break field print with a leading sub-summary before each group, a trailing sub-summary after it, and a grand summary at the end, each totalling a summary field.',
    claris: ['Summary fields', 'Layout parts: sub-summary and grand summary', 'Sort Records script step', 'Save Records as PDF script step'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = t.file('Sales');
        s.applyDesign([{ op: 'createTable', name: 'Sales', fields: [{ name: 'Region' }, { name: 'Amount', type: 'number' }, { name: 'Total', summary: { type: 'total', field: 'Amount' } }] }] as never);
        for (const [r, a] of [['East', 10], ['West', 5], ['East', 20], ['West', 1], ['North', 7]] as const) s.create('Sales', { Region: r, Amount: a });
        const design = s.design('Sales')!;
        const occurrence = s.schema.tableOccurrences[0];
        const ref = (name: string) => ({ tableOccurrenceId: occurrence.id, fieldId: fieldId(s, 'Sales', name), tableOccurrence: 'Sales', field: name });
        const style = design.objects.find((o) => o.kind === 'field')!.style;
        const box = (id: number, name: string, top: number, left = 20) => ({ id, kind: 'field', type: 1, anchors, style, bounds: { top, left, bottom: top + 20, right: left + 100 }, field: { ...ref(name), display: 'edit', repetitions: 1 } });
        const label = (id: number, top: number, text: string) => ({ id, kind: 'text', type: 2, anchors, style: {}, bounds: { top, left: 20, bottom: top + 20, right: 200 }, text });
        const part = (kind: string, kindId: number, top: number, extra: object = {}) => ({ kind, kindId, top, height: 30, style: {}, ...extra });
        s.applyDesign([{ op: 'updateLayout', layout: 'Sales', design: {
          parts: [
            part('sub-summary-leading', 3, 0, { breakField: ref('Region') }), part('body', 4, 30), part('sub-summary-trailing', 5, 60, { breakField: ref('Region') }), part('trailing-grand-summary', 6, 90),
          ],
          objects: [label(1, 5, 'Region'), box(2, 'Region', 5, 140), box(3, 'Region', 35), box(4, 'Amount', 35, 140), label(5, 65, 'Subtotal'), box(6, 'Total', 65, 140), label(7, 95, 'Grand'), box(8, 'Total', 95, 140)] as LayoutObject[],
        } }] as never);
        const r = await t.run(s, lines(
          'Sort Records [ Restore ; With dialog: Off ; Sales::Region ; ascending ]',
          'Save Records as PDF [ With dialog: Off ; “out.pdf” ; Records being browsed ; Create folders: Off ]',
        ), { layout: 'Sales', documents: t.path('Documents') });
        assert.equal(r.error, 0);
        const shown = pdfText(readFileSync(t.path('Documents', 'out.pdf')));
        assert.deepEqual(shown, [
          'Region', 'East', 'East', '10', 'East', '20', 'Subtotal', '30',
          'Region', 'North', 'North', '7', 'Subtotal', '7',
          'Region', 'West', 'West', '5', 'West', '1', 'Subtotal', '6',
          'Grand', '43',
        ], 'a heading before each group, its records, the subtotal after them, and the grand total once at the end');
        return pass();
      },
    },
  },
  {
    id: 'portal-filter-sort',
    title: 'Portals with a filter and a sort order',
    what: 'A portal shows the related records that pass its filter formula, in its own sort order, a few rows at a time.',
    claris: ['Portal Setup', 'Go to Portal Row script step', 'Get ( PortalRowNumber )'],
    script: {
      expected: 'unverified',
      note: 'Go to Portal Row walks every related record in the order they were created, ignoring the portal\'s sort order and filter, which the web client and the Data API apply. Whether FileMaker\'s step follows the displayed rows is not settled by the Portal Setup or Go to Portal Row pages.',
      async run(t) {
        const s = portalSolution(t);
        const r = await t.run(s, lines(
          'Go to Layout [ “Customers” ]', 'Go to Object [ Object Name: "Open" ]', 'Go to Portal Row [ First ]', 'Loop',
          'Set Variable [ $seen ; Value: List ( $seen ; Get ( PortalRowNumber ) & ":" & Orders::Item ) ]',
          'Go to Portal Row [ Next ; Exit after last ]', 'End Loop',
          'Exit Script [ Text Result: $seen ]',
        ), { layout: 'Customers' });
        assert.equal(r.result, '1:Plums\r2:Apples\r3:Cherries\r4:Bananas', 'every related record, in creation order');
        return unverified('Go to Portal Row ignores the portal sort and filter');
      },
    },
    dataApi: {
      expected: 'unverified',
      note: 'The Data API returns only the rows that pass the portal\'s filter, sorted by its sort order. The Claris Data API pages do not, as far as they were known here, say whether portal filters and sort orders apply to portalData.',
      async run(t) {
        portalSolution(t);
        const api = await t.api('Shop');
        const r = await api.get('/layouts/Customers/records');
        assert.deepEqual(r.response.data[0].portalData.Open.map((row: any) => row['Orders::Item']), ['Bananas', 'Cherries', 'Plums'], 'Apples (quantity 0) is filtered out and the rest sorted by item');
        assert.equal(r.response.data[0].portalDataInfo[0].foundCount, 3);
        return unverified('portalData applies the portal filter and sort');
      },
    },
    web: { expected: 'pass' },
    backlog: 'Decide, on a FileMaker, whether Go to Portal Row follows a portal\'s sort and filter, and make the step and the Data API agree with the answer.',
  },
  {
    id: 'container-storage',
    title: 'Container storage and thumbnails',
    what: 'A file or picture goes into a container field from a script or the Data API, and comes back as a link; the web client shows pictures as thumbnails.',
    claris: ['Insert File script step', 'GetContainerAttribute function', 'Data API: uploading container data'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = pictureSolution(t);
        const r = await t.run(s, lines(
          'Go to Record/Request/Page [ First ]', 'Insert File [ Pics::Photo ; “pic.png” ]',
          'Exit Script [ Text Result: GetContainerAttribute ( Pics::Photo ; "filename" ) & ":" & GetContainerAttribute ( Pics::Photo ; "width" ) & "x" & GetContainerAttribute ( Pics::Photo ; "height" ) ]',
        ), { layout: 'Pics', documents: t.path('Documents') });
        assert.equal(r.error, 0);
        assert.equal(r.result, 'pic.png:2x2');
        return pass();
      },
    },
    dataApi: {
      expected: 'pass',
      note: 'The thumbnail address (a thumb parameter on the container link) is Tabularius\'s own; the Claris pages describe no thumbnails for the Data API.',
      async run(t) {
        pictureSolution(t);
        const api = await t.api('Pics');
        const rec = (await api.get('/layouts/Pics/records')).response.data[0];
        const form = new FormData();
        form.append('upload', new Blob([PNG], { type: 'image/png' }), 'up.png');
        const up = await api.call('POST', `/layouts/Pics/records/${rec.recordId}/containers/Photo/1`, form);
        assert.equal(up.code, '0', up.message);
        const link = (await api.get(`/layouts/Pics/records/${rec.recordId}`)).response.data[0].fieldData.Photo as string;
        assert.match(link, /\/up\.png\?/, 'the record holds a link named for the file');
        const whole = await fetch(link);
        assert.deepEqual(Buffer.from(await whole.arrayBuffer()), PNG, 'the link gives the bytes back');
        const thumb = await fetch(`${link}&thumb=64`);
        assert.equal(thumb.headers.get('content-type'), 'image/png');
        return pass();
      },
    },
    web: { expected: 'pass' },
  },
  {
    id: 'card-windows',
    title: 'Card windows',
    what: 'A script opens a card window over the main window, with its own size and layout, and closes it again.',
    claris: ['New Window script step', 'Close Window script step', 'Get ( WindowStyle )'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = t.file('Cards');
        s.applyDesign([
          { op: 'createTable', name: 'Main', fields: [{ name: 'Name' }] },
          { op: 'createTable', name: 'Settings', fields: [{ name: 'Key' }] },
        ]);
        const r = await t.run(s, lines(
          'Set Variable [ $before ; Value: Get ( WindowStyle ) ]',
          'New Window [ Style: Card ; "Settings" ; 200 ; 300 ; 40 ; 60 ]',
          'Go to Layout [ “Settings” ]',
          'Set Variable [ $card ; Value: Get ( WindowStyle ) & "/" & Get ( WindowName ) & "/" & Get ( WindowWidth ) & "x" & Get ( WindowHeight ) & "/" & Get ( LayoutName ) ]',
          'Close Window [ Current Window ]',
          'Exit Script [ Text Result: $before & "|" & $card & "|" & Get ( WindowStyle ) & "/" & Get ( LayoutName ) ]',
        ), { layout: 'Main' });
        assert.equal(r.error, 0);
        assert.equal(r.result, '0|3/Settings/300x200/Settings|0/Main', 'a document window is style 0 and a card is style 3; closing the card returns to the window under it');
        return pass();
      },
    },
    web: { expected: 'pass' },
  },
  {
    id: 'custom-menus',
    title: 'Custom menus and menu sets',
    what: 'A menu set made of custom menus, whose items run scripts, is installed for a layout or by a script.',
    claris: ['Custom Menus', 'Install Menu Set script step', 'Set up a menu set for a layout'],
    script: {
      expected: 'partial',
      note: 'Install Menu Set reaches the client as an instruction to install the set. The step has no script-text form here, so a script is authored with the step\'s parameters, and a menu item that runs a script is exercised in the web client, not by the script engine.',
      async run(t) {
        const s = t.file('Menus');
        s.applyDesign([
          { op: 'createTable', name: 'T', fields: [{ name: 'A' }] },
          { op: 'createScript', name: 'Go Home', text: 'Exit Script [ Text Result: "home" ]' },
          { op: 'createCustomMenu', name: 'Tools', items: [{ script: 'Go Home', title: '"Home"', shortcut: { key: 'h', modifiers: 4 } }, { kind: 'separator' }, { command: 'New Record' }] },
          { op: 'createMenuSet', name: 'Kiosk', menus: ['Tools'] },
        ] as never);
        const set = s.schema.customMenuSets[0];
        s.applyDesign([{ op: 'createScript', name: 'Kiosk On', steps: [{ name: 'Install Menu Set', params: { menuSet: { id: set.id, name: 'Kiosk' } } }] }] as never);
        const r = await runScript(s, 'Kiosk On', { layout: 'T' });
        assert.equal(r.error, 0);
        assert.deepEqual(r.actions, [{ step: 'Install Menu Set', script: 'Kiosk On', menuSetId: set.id }]);
        return partial('no script-text form for Install Menu Set');
      },
    },
    web: { expected: 'pass' },
    backlog: 'Give Install Menu Set a script-text form (menu set name and Use as file default) so the step can be written and read like the others.',
  },
  {
    id: 'script-triggers',
    title: 'Script triggers on layouts and records',
    what: 'A layout runs a script when it is entered, when a record loads, and when a changed record is committed, and the commit script can veto the commit.',
    claris: ['Script triggers', 'OnLayoutEnter', 'OnRecordLoad', 'OnRecordCommit'],
    script: {
      expected: 'pass',
      async run(t) {
        const s = t.file('Triggers');
        s.applyDesign([
          { op: 'createTable', name: 'People', fields: [{ name: 'Name' }] },
          { op: 'createTable', name: 'Places', fields: [{ name: 'City' }] },
          { op: 'createScript', name: 'Note', text: 'Set Variable [ $$log ; Value: $$log & Get ( ScriptParameter ) & "@" & Get ( LayoutName ) & ":" & Get ( RecordNumber ) & ";" ]' },
          { op: 'createScript', name: 'Veto', text: 'Set Variable [ $$log ; Value: $$log & "commit?;" ]\nExit Script [ Text Result: $$allow ]' },
        ]);
        s.create('People', { Name: 'A' });
        s.create('People', { Name: 'B' });
        s.create('Places', { City: 'Leeds' });
        const id = (name: string) => s.schema.scripts.find((x) => x.name === name)!.id;
        const trigger = (event: string, script: string, parameter?: string) => ({ event, scriptId: id(script), script, ...(parameter ? { parameter } : {}) });
        s.applyDesign([
          { op: 'updateLayout', layout: 'Places', design: { triggers: [trigger('OnLayoutEnter', 'Note', '"enter"'), trigger('OnRecordLoad', 'Note', '"load"')] } },
          { op: 'updateLayout', layout: 'People', design: { triggers: [trigger('OnRecordCommit', 'Veto')] } },
        ] as never);
        const r = await t.run(s, lines(
          'Set Variable [ $$log ; Value: "" ]',
          'Go to Layout [ “Places” ]',
          'Set Variable [ $entered ; Value: $$log ]',
          'Go to Layout [ “People” ]',
          'Set Variable [ $$log ; Value: "" ]',
          'Set Variable [ $$allow ; Value: 0 ]',
          'Set Field [ People::Name ; "A2" ]',
          'Commit Records/Requests [ With dialog: Off ]',
          'Set Variable [ $vetoed ; Value: $$log & ( Get ( LastError ) ≠ 0 ) ]',
          'Set Variable [ $$allow ; Value: 1 ]',
          'Commit Records/Requests [ With dialog: Off ]',
          'Exit Script [ Text Result: $entered & "|" & $vetoed & "|" & $$log & "|" & People::Name ]',
        ), { layout: 'People' });
        assert.equal(r.result, 'enter@Places:1;load@Places:1;|commit?;1|commit?;commit?;|A2', 'entering a layout fires OnLayoutEnter then OnRecordLoad; a commit script returning 0 or false stops the commit');
        return pass();
      },
    },
    web: { expected: 'pass' },
  },
  {
    id: 'conditional-formatting-tooltips',
    title: 'Conditional formatting, tooltips and hiding',
    what: 'A field changes its look when a formula is true, shows a tooltip worked out from the record, and an object hides when its formula is true.',
    claris: ['Conditional formatting', 'Tooltips', 'Hide object when'],
    web: { expected: 'pass' },
  },
  {
    id: 'tabs-popovers',
    title: 'Tab controls and popovers',
    what: 'A tab control switches between panels of fields, and a popover button opens a popover holding more fields.',
    claris: ['Tab controls', 'Popovers'],
    web: { expected: 'pass' },
  },
];

/** Customers with four orders and a portal "Open" that sorts by item and shows only orders with a quantity. */
export function portalSolution(t: Workbench): Store {
  const s = t.file('Shop');
  s.applyDesign([
    { op: 'createTable', name: 'Customers', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }] },
    { op: 'createTable', name: 'Orders', fields: [{ name: 'CustomerId', type: 'number' }, { name: 'Item' }, { name: 'Qty', type: 'number' }] },
  ]);
  s.applyDesign([{ op: 'createRelationship', left: 'Customers', right: 'Orders', predicates: [{ left: 'Id', right: 'CustomerId' }] }] as never);
  s.create('Customers', { Id: 1, Name: 'Ann' });
  for (const [item, qty] of [['Plums', 3], ['Apples', 0], ['Cherries', 5], ['Bananas', 2]] as const) s.create('Orders', { CustomerId: 1, Item: item, Qty: qty });
  const orders = s.schema.tableOccurrences.find((o) => o.name === 'Orders')!;
  const ref = (name: string) => ({ tableOccurrenceId: orders.id, fieldId: fieldId(s, 'Orders', name), tableOccurrence: 'Orders', field: name });
  const design = s.design('Customers')!;
  s.applyDesign([{ op: 'updateLayout', layout: 'Customers', design: { objects: [...design.objects, {
    id: 900, kind: 'portal', type: 9, name: 'Open', anchors, style: {}, bounds: { top: 150, left: 160, bottom: 224, right: 520 },
    portal: { tableOccurrenceId: orders.id, tableOccurrence: 'Orders', rows: 3, initialRow: 1, sort: [{ field: ref('Item') }], filter: 'Orders::Qty > 0' },
    children: [{ id: 901, kind: 'field', type: 1, anchors, style: design.objects.find((o) => o.kind === 'field')!.style, bounds: { top: 152, left: 162, bottom: 174, right: 400 }, field: { ...ref('Item'), display: 'edit', repetitions: 1 } }],
  }] as LayoutObject[] } }] as never);
  return s;
}

/** A table with a container field and one record, and a picture in the documents folder. */
export function pictureSolution(t: Workbench): Store {
  const s = t.file('Pics');
  s.applyDesign([{ op: 'createTable', name: 'Pics', fields: [{ name: 'Name' }, { name: 'Photo', type: 'container' }] }]);
  s.create('Pics', { Name: 'a' });
  mkdirSync(t.path('Documents'), { recursive: true });
  writeFileSync(t.path('Documents', 'pic.png'), PNG);
  return s;
}
