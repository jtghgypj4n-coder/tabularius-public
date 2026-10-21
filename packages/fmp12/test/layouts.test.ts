// Layout designs, checked against FileMaker's own Database Design Report for
// the "Flicks" sample (fixtures/fmp12/Flicks_ddr.xml); run `npm run fixtures` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, buttonFile, readLayoutDesigns, readImageLibrary, readFieldBehavior, webViewerFlags, webViewerOptions, type LayoutObject } from '../src/index.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const path = (f: string) => join(dir, f);
const skip = existsSync(path('Flicks_ddr.xml')) ? false : 'fixtures missing: run npm run fixtures';

function flatten(objs: LayoutObject[], out = new Map<number, LayoutObject>()): Map<number, LayoutObject> {
  for (const o of objs) {
    out.set(o.id, o);
    if (o.children) flatten(o.children, out);
  }
  return out;
}

const DDR_TYPES: Record<string, string> = {
  Text: 'text', Field: 'field', Button: 'button', Portal: 'portal', Rect: 'rectangle', ExternalObject: 'web-viewer',
};

test('layout objects: kind and position match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(path('Flicks_ddr.xml')));
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  let checked = 0;
  for (const m of xml.matchAll(/<Layout width="(\d+)"[^>]* id="(\d+)" name="[^"]*">\s*<Table id="(\d+)" name="([^"]*)"\/>([\s\S]*?)<\/Layout>/g)) {
    const [, width, id, , table, body] = m;
    const layout = layouts.find((l) => l.id === Number(id))!;
    assert.equal(layout.width, Number(width));
    assert.equal(db.schema.tableOccurrences.find((t) => t.id === layout.tableOccurrenceId)?.name, table);
    const objects = flatten(layout.objects);
    for (const o of body.matchAll(/<Object type="(\w+)" key="(\d+)"[^>]*>\s*<Bounds top="([\d.]+)" left="([\d.]+)" bottom="([\d.]+)" right="([\d.]+)"/g)) {
      const obj = objects.get(Number(o[2]));
      // The DDR also lists Table View objects (ids can collide with form objects);
      // those live in the layout's tableView.
      if (!obj || (o[1] === 'Field' && obj.kind !== 'field' && layout.tableView)) continue;
      assert.equal(obj.kind, DDR_TYPES[o[1]], `layout ${id} object ${o[2]}`);
      const want = [o[3], o[4], o[5], o[6]].map((x) => Math.round(Number(x) * 100) / 100);
      assert.deepEqual([obj.bounds.top, obj.bounds.left, obj.bounds.bottom, obj.bounds.right], want, `layout ${id} object ${o[2]}`);
      checked++;
    }
  }
  assert.ok(checked > 120, `checked ${checked}`);
});

test('layout objects: fields, text, portals, buttons and styles', { skip }, () => {
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const { layouts, themes } = readLayoutDesigns(db.file, db.schema);
  const modules = layouts.find((l) => l.name === 'WV Framework - Modules')!;
  const objs = flatten(modules.objects);
  assert.equal(objs.get(37)!.text, 'Index');
  assert.deepEqual(
    { to: objs.get(36)!.field!.tableOccurrence, field: objs.get(36)!.field!.field, display: objs.get(36)!.field!.display, vl: objs.get(36)!.field!.valueList },
    { to: 'LIBRARY_CODE', field: 'enabled', display: 'checkbox', vl: 'boolean' },
  );
  const portal = objs.get(215)!;
  assert.equal(portal.portal!.tableOccurrence, 'LIBRARY_CODE');
  assert.equal(portal.portal!.rows, 16);
  assert.deepEqual(portal.children!.map((c) => c.id), [216, 217, 218, 219]);
  assert.deepEqual(objs.get(220)!.action, { stepId: 1, step: 'Perform Script', param: 492, scriptId: 492, script: 'WV__Demo_Rebuild_Library' });
  assert.equal(objs.get(217)!.action!.stepId, 9); // Delete Record/Request
  assert.deepEqual(modules.parts.map((p) => [p.kind, p.top, p.height]), [['header', 0, 50], ['body', 50, 521]]);

  // Styles: the layout's theme defines the named style the label uses.
  assert.equal(themes.find((t) => t.id === modules.themeId)!.name, 'decon.dark');
  const label = objs.get(37)!.style;
  assert.equal(label.displayName, 'fieldLabel');
  assert.ok(themes.find((t) => t.id === modules.themeId)!.styles.some((s) => s.name === label.name));
  // Local style from the DDR: "text-align: right; -fm-text-vertical-align: center".
  const demo = flatten(layouts.find((l) => l.id === 31)!.objects);
  assert.deepEqual(demo.get(20)!.style.rules![0].css, { 'text-align': 'right', '--fm-vertical-align': 'center' });
  assert.equal(modules.tableView![0].field.field, 'name');
});

test('field controls and behavior match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(path('Flicks_ddr.xml')));
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  const displays = ['edit', 'dropdown', 'popup', 'checkbox', 'radio', , 'calendar'];
  let checked = 0;
  for (const m of xml.matchAll(/<Layout width="\d+"[^>]* id="(\d+)" name="[^"]*">([\s\S]*?)<\/Layout>/g)) {
    const objects = flatten(layouts.find((l) => l.id === Number(m[1]))!.objects);
    for (const o of m[2].matchAll(/<Object type="Field" key="(\d+)"[^>]*>[\s\S]*?<FieldObj [^>]*flags="(\d+)"[^>]*displayType="(\d+)"/g)) {
      const field = objects.get(Number(o[1]))?.field;
      if (!field) continue; // a Table View object
      assert.equal(field.display, displays[Number(o[3])], `layout ${m[1]} object ${o[1]}`);
      assert.deepEqual(field.behavior, readFieldBehavior(Number(o[2])), `layout ${m[1]} object ${o[1]}`);
      checked++;
    }
  }
  assert.ok(checked > 40, `checked ${checked}`);
  // The Modules list: index is View Only in both modes and Tab skips it, the
  // MIME type is a pop-up menu, and both stay out of Quick Find.
  const modules = flatten(layouts.find((l) => l.name === 'WV Framework - Modules')!.objects);
  const fields = [...modules.values()].filter((o) => o.field);
  assert.ok(fields.some((o) => o.field!.field === 'index' && o.field!.behavior?.browse === 'view' && o.field!.behavior.find === 'view' && o.field!.behavior.noTab));
  assert.ok(fields.some((o) => o.field!.field === 'payload_mime' && o.field!.display === 'popup' && o.field!.behavior?.quickFindOff));
});

test('field behavior flags', () => {
  assert.equal(readFieldBehavior(32), undefined);
  assert.equal(readFieldBehavior(1048608), undefined);
  assert.deepEqual(readFieldBehavior(1048612), { browse: 'view' });
  assert.deepEqual(readFieldBehavior(17825824), { browse: 'select' });
  assert.deepEqual(readFieldBehavior(17825828), { browse: 'calculation' });
  assert.deepEqual(readFieldBehavior(1048624), { find: 'view' });
  assert.deepEqual(readFieldBehavior(34603040), { find: 'select' });
  assert.deepEqual(readFieldBehavior(1048610), { selectOnEntry: true });
  assert.deepEqual(readFieldBehavior(525344), { calendarIcon: true });
  assert.deepEqual(readFieldBehavior(20), { browse: 'view', find: 'view', noTab: true });
  assert.deepEqual(readFieldBehavior(32800 | 2048 | 1), { quickFindOff: true, autoComplete: true, otherValue: true });
  // Inferred from private samples: bit21 concealed (Password, API Key fields), bit8 scroll bar, bits 6 and 7 Return and Enter.
  assert.deepEqual(readFieldBehavior(32 | 2 ** 21 | 2 ** 8 | 2 ** 6 | 2 ** 7), { concealed: true, scrollBar: true, returnKey: true, enterKey: true });
});

test('image library', { skip }, () => {
  const images = readImageLibrary(FmpDatabase.open(path('Flicks.fmp12')).file);
  const png = images.get(2)!;
  assert.equal(png.mime, 'image/png');
  assert.equal(png.filename, 'quarryheader.png');
  assert.deepEqual([...png.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('field data formatting: currency with fixed decimals', { skip: existsSync(path('Charts.fmp12')) ? false : 'fixtures missing' }, () => {
  const db = FmpDatabase.open(path('Charts.fmp12'));
  const layout = readLayoutDesigns(db.file, db.schema).layouts.find((l) => l.name === 'Related records • Pie')!;
  const total = [...flatten(layout.objects).values()].find((o) => o.field?.field === 'Total Sales')!;
  assert.deepEqual(total.field!.format, { number: { decimalPoint: '.', decimals: 2, notation: '$', leading: true } });
  // Fields left at General have no format.
  assert.ok([...flatten(layout.objects).values()].filter((o) => o.field && o.field.field !== 'Total Sales').every((o) => !o.field!.format));
});

test('sub-summary parts: the field they break on', { skip: existsSync(path('FMburgh_2012_11_07_Database.fmp12')) ? false : 'fixtures missing' }, () => {
  const db = FmpDatabase.open(path('FMburgh_2012_11_07_Database.fmp12'));
  const layout = readLayoutDesigns(db.file, db.schema).layouts.find((l) => l.name === 'Normalized Comics Report')!;
  assert.deepEqual(layout.parts.map((p) => [p.kind, p.breakField?.field]), [
    ['header', undefined],
    ['sub-summary-leading', 'Type'],
    ['sub-summary-leading', 'Publisher'],
    ['body', undefined],
    ['sub-summary-trailing', 'Publisher'],
    ['sub-summary-trailing', 'Type'],
  ]);
});

test('layout default view', { skip: existsSync(path('FMburgh_2012_11_07_Database.fmp12')) ? false : 'fixtures missing' }, () => {
  const db = FmpDatabase.open(path('FMburgh_2012_11_07_Database.fmp12'));
  const view = (name: string) => readLayoutDesigns(db.file, db.schema).layouts.find((l) => l.name === name)?.view;
  assert.equal(view('Comics_Normalized'), 'table');
  assert.equal(view('Normalized Comics Report'), 'list');
  assert.equal(view('Main Menu'), 'form');
});

test('button bar segment labels', { skip: existsSync(path('DEMO_drawers.fmp12')) ? false : 'fixtures missing' }, () => {
  const db = FmpDatabase.open(path('DEMO_drawers.fmp12'));
  const layout = readLayoutDesigns(db.file, db.schema).layouts.find((l) => l.name === 'LAYOUT')!;
  const all = (objs: LayoutObject[]): LayoutObject[] => objs.flatMap((o) => [o, ...all(o.children ?? [])]);
  const bar = all(layout.objects).find((o) => o.id === 99)!;
  assert.equal(bar.kind, 'button-bar');
  assert.deepEqual(bar.children!.slice(0, 2).map((s) => [s.text, s.label]), [
    [undefined, 'LAYOUT::layout_display_rep[1]'],
    [undefined, 'LAYOUT::layout_display_rep[2]'],
  ]);
});

test('script triggers match the Design Report', { skip }, () => {
  // Flicks_ddr.xml: two fields on "WV Framework - Sample Data" run script 367 OnObjectSave and OnObjectModify.
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  const objs = flatten(layouts.find((l) => l.name === 'WV Framework - Sample Data')!.objects);
  assert.deepEqual(objs.get(29)?.triggers, [{ event: 'OnObjectSave', scriptId: 367 }]);
  assert.deepEqual(objs.get(40)?.triggers, [{ event: 'OnObjectModify', scriptId: 367 }]);
});

test('script trigger modes', async () => {
  const { readTriggers } = await import('../src/layouts.ts');
  // A private sample's find layout: OnModeExit runs script 803 in Find mode only (mask 02); mask 01 is Browse only.
  const trigger = (mask: number) => ({ kv: new Map([[1, Uint8Array.from([0, 0x6b, 4, 3, 0xd0, 0x02, 0xa3, 0, 0, 0, 0, mask, 0])]]), child: () => undefined });
  const node = (...ts: unknown[]) => ({ child: (k: number) => (k === 5 ? { children: new Map(ts.map((t, i) => [i + 1, t])) } : undefined) });
  const read = (mask: number) => readTriggers(node(trigger(mask)) as never, undefined, () => undefined);
  assert.deepEqual(read(2), [{ event: 'OnModeExit', scriptId: 803, modes: ['find'] }]);
  assert.deepEqual(read(7), [{ event: 'OnModeExit', scriptId: 803, modes: ['browse', 'find', 'preview'] }]);
  assert.deepEqual(read(1), [{ event: 'OnModeExit', scriptId: 803 }]);
});

test('charts: type, data source and formulas, against the Charts sample layouts named for them', { skip: existsSync(path('Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const db = FmpDatabase.open(path('Charts.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  const charts = (name: string) => [...flatten(layouts.find((l) => l.name === name)!.objects).values()].flatMap((o) => (o.chart ? [o.chart] : []));
  const types = (name: string) => [...new Set(charts(name).map((c) => c.type))];
  assert.deepEqual(types('Chart Types • Column'), ['column', 'stacked-column']);
  assert.deepEqual(types('Chart Types • Bar'), ['bar', 'stacked-bar']);
  assert.deepEqual(types('Chart Types • Line'), ['line']);
  assert.deepEqual(types('Chart Types • Area'), ['area']);
  assert.deepEqual(types('Chart Types • Pie'), ['pie']);
  assert.deepEqual(types('Chart Types • Scatter'), ['scatter']);
  assert.deepEqual(types('Chart Types • Bubble'), ['bubble']);
  const [stacked] = charts('Delimited data • Stacked');
  assert.equal(stacked.source, 'record');
  assert.equal(stacked.title, 'Demo::ChartTitle');
  assert.equal(stacked.categories, 'Demo::SeriesX');
  assert.deepEqual(stacked.series, [
    { data: 'Demo::SeriesY1', name: '"East"' }, { data: 'Demo::SeriesY2', name: '"North"' }, { data: 'Demo::SeriesY3', name: '"South"' },
  ]);
  const [found] = charts('Found Set • US Population');
  assert.equal(found.source, 'found-set');
  assert.equal(found.grouped, undefined);
  const [summarized] = charts('Found Set Summarized • Congress');
  assert.deepEqual([summarized.source, summarized.grouped, summarized.xTitle, summarized.yTitle], ['found-set', true, '"State"', '"Score"']);
  const [related] = charts('Related records • Pie');
  assert.deepEqual([related.source, related.occurrence], ['related', 'NW SalespersonCustomers']);
  // Four series, though a fifth formula slot holds a leftover.
  assert.equal(charts('Chart Types • Bar').find((c) => c.type === 'stacked-bar')!.series.length, 4);
  const consoles = charts('Chart Types • Bubble').find((c) => c.title === '"Game Consoles"')!;
  assert.deepEqual(consoles.series[0], { data: '450', name: '"PlayStation"', x: '100', sizes: '25' });
  assert.deepEqual(stacked.text?.title, { size: 19, color: 'rgb(114 103 78)' });
});

test('one-step buttons: their step options decode as in a script', { skip }, () => {
  const buttons = (file: string, layout: string) => {
    const db = FmpDatabase.open(path(file));
    const l = readLayoutDesigns(db.file, db.schema).layouts.find((x) => x.name === layout)!;
    return [...flatten(l.objects).values()].filter((o) => o.action);
  };
  const set = buttons('Flicks.fmp12', 'WV Framework - Modules').find((o) => o.action!.step === 'Set Field')!;
  assert.deepEqual(set.action!.params!.field, { tableOccurrence: { id: set.action!.params!.field!.tableOccurrence.id, name: 'LIBRARY_CODE' }, field: { id: set.action!.params!.field!.field.id, name: 'payload_name' } });
  assert.match(set.action!.params!.calculation!, /GetContainerAttribute \( LIBRARY_CODE::container ; "filename" \)/);
  const go = buttons('DEMO_drawers.fmp12', 'Admin Detail | Desktop').find((o) => o.action!.step === 'Go to Object')!;
  assert.equal(go.action!.params!.objectName, '"popover_nav"');
});

test('tab order: the objects Tab visits, in order', { skip }, () => {
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const layout = readLayoutDesigns(db.file, db.schema).layouts.find((l) => l.name === 'WV Framework - Modules')!;
  const objs = flatten(layout.objects);
  assert.deepEqual(layout.tabOrder?.slice(0, 4), [198, 50, 219, 218]);
  assert.equal(layout.tabOrder?.length, 13);
  assert.deepEqual(layout.tabOrder!.slice(0, 4).map((id) => objs.get(id)?.field?.field), ['name', 'name', 'index', 'name']);
});

test('charts: value axis bounds Chart Setup fixes', { skip: existsSync(path('Charts.fmp12')) ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const db = FmpDatabase.open(path('Charts.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  const charts = (name: string) => [...flatten(layouts.find((l) => l.name === name)!.objects).values()].flatMap((o) => (o.chart ? [o.chart] : []));
  // Congress scores run 0-100; the random 1-10 produce inventory is fixed at 0-10.
  const [congress] = charts('Found Set Summarized • Congress');
  assert.deepEqual([congress.yMin, congress.yMax], ['0', '100']);
  const produce = charts('Chart Types • Line').find((c) => c.title === '"Produce Inventory"')!;
  assert.deepEqual([produce.yMin, produce.yMax], ['0', '10']);
  // Charts left to scale themselves have neither.
  assert.ok(charts('Chart Types • Column').every((c) => c.yMin === undefined && c.yMax === undefined));
});

test('portal setup: scrolling, deletion, and sort and filter only when ticked', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(path('Flicks_ddr.xml')));
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  let checked = 0;
  for (const m of xml.matchAll(/<Layout width="\d+"[^>]* id="(\d+)" name="[^"]*">([\s\S]*?)<\/Layout>/g)) {
    const objects = flatten(layouts.find((l) => l.id === Number(m[1]))!.objects);
    for (const o of m[2].matchAll(/<Object type="Portal" key="(\d+)"[^>]*>[\s\S]*?<PortalObj portalFlags="(\d+)"/g)) {
      const portal = objects.get(Number(o[1]))!.portal!;
      const flags = Number(o[2]);
      assert.equal(!!portal.scrolling, !!(flags & 1));
      assert.equal(!!portal.allowDelete, !!(flags & 4));
      if (!(flags & 8)) assert.equal(portal.sort, undefined);
      if (!(flags & 0x80)) assert.equal(portal.filter, undefined);
      checked++;
    }
  }
  assert.ok(checked >= 1);
  const portal = flatten(layouts.find((l) => l.name === 'WV Framework - Modules')!.objects).get(215)!.portal!;
  assert.deepEqual([portal.scrolling, portal.scrollBarWhenScrolling, portal.allowDelete], [true, true, true]);
});

test('hide conditions apply in Find mode as the Design Report says', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(path('Flicks_ddr.xml')));
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const { layouts } = readLayoutDesigns(db.file, db.schema);
  let checked = 0;
  for (const l of xml.matchAll(/<Layout width="\d+"[^>]* id="(\d+)" name="[^"]*">([\s\S]*?)<\/Layout>/g)) {
    const objects = flatten(layouts.find((x) => x.id === Number(l[1]))!.objects);
    for (const m of l[2].matchAll(/<Object type="\w+" key="(\d+)"[^>]*>(?:(?!<Object )[\s\S])*?<HideCondition findMode="(\w+)">/g)) {
      assert.equal(objects.get(Number(m[1]))!.hide!.inFind, m[2] === 'True', `layout ${l[1]} object ${m[1]}`);
      checked++;
    }
  }
  assert.equal(checked, 3);
});

test('slide controls: hidden navigation dots', { skip: existsSync(path('DEMO_drawers.fmp12')) ? false : 'fixtures missing' }, () => {
  const db = FmpDatabase.open(path('DEMO_drawers.fmp12'));
  const slides = readLayoutDesigns(db.file, db.schema).layouts.flatMap((l) => [...flatten(l.objects).values()]).filter((o) => o.kind === 'slide-control');
  assert.ok(slides.length > 0 && slides.every((o) => o.noDots && !o.noSwipe));
});

test('popovers: title bars hidden in DEMO_drawers', { skip: existsSync(path('DEMO_drawers.fmp12')) ? false : 'fixtures missing' }, () => {
  const db = FmpDatabase.open(path('DEMO_drawers.fmp12'));
  const popovers = readLayoutDesigns(db.file, db.schema).layouts.flatMap((l) => [...flatten(l.objects).values()]).filter((o) => o.kind === 'popover');
  assert.ok(popovers.length > 0 && popovers.every((o) => !o.titleBar && o.text === undefined && o.label === undefined));
});

test('web viewers: Web Viewer Setup options are the Design Report\'s externalFlagSet', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(path('Flicks_ddr.xml')));
  const db = FmpDatabase.open(path('Flicks.fmp12'));
  const viewers = readLayoutDesigns(db.file, db.schema).layouts.flatMap((l) => [...flatten(l.objects).values()].filter((o) => o.external === 'WEBV'));
  const flags = [...xml.matchAll(/<ExternalObj typeID="WEBV"[^>]*externalFlagSet="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(flags, [32845]);
  assert.equal(viewers.length, 1);
  // 32845: interaction, progress bar, status messages and the JavaScript bridge; URL encoding on, Find mode off.
  assert.deepEqual(viewers[0].webOptions, { interaction: true, findMode: false, progressBar: true, statusMessages: true, encodeUrl: true, jsBridge: true });
  assert.equal(webViewerFlags(viewers[0].webOptions!), 32845);
  // Objects made before FileMaker 26 have no 0x8000 marker: the low bits read the same.
  assert.deepEqual(webViewerOptions(13), webViewerOptions(32781));
});

// CI-runnable (no fixtures): the merge-field decoder, including the repeating
// field form. A merge field is <<[ctrl bytes][hex]>>: u16 TO length, the TO
// path, then u8 payload length and the field-reference payload. A repeating
// field stores [field id][repetition]; a plain field a single id. Bytes below
// are the ones FileMaker wrote for fmIDE's Home layout (TO 163 fmIDE.NavSections,
// field 33 NavObjectName, which has 3 repetitions): "0003 d00023" = TO 163.
import { decodeMergeFields } from '../src/index.ts';

test('merge fields: plain, repeating, large-id fallback and unresolvable', () => {
  const mf = (hex: string) => `<<\x01\x02\x0e${hex}>>`;
  const to163 = '0003d00023'; // u16 len 3, path d0 00 23 -> TO id 163
  const names = (to: number, field: number): string | undefined =>
    to === 163 && field === 33 ? 'NavSections::NavObjectName'
    : to === 163 && field === 6 ? 'NavSections::Note'
    : to === 163 && field === 8578 ? 'Far::External' // only the whole-payload id resolves
    : undefined;

  // Plain single-byte field (payload 01 06 -> field 6).
  assert.equal(decodeMergeFields(mf(`${to163}0106`), names), '<<NavSections::Note>>');
  // Repeating field (payload 02 21 02 -> field 0x21=33, repetition 2).
  assert.equal(decodeMergeFields(mf(`${to163}022102`), names), '<<NavSections::NavObjectName[2]>>');
  // Repetition 1 carries no suffix (payload 02 21 01).
  assert.equal(decodeMergeFields(mf(`${to163}022101`), names), '<<NavSections::NavObjectName>>');
  // When the leading byte names no field, fall back to the whole payload as one
  // id (a large or another-file id): here only (163, 8578) resolves.
  assert.equal(
    decodeMergeFields(mf(`${to163}022102`), (to, f) => (to === 163 && f === 8578 ? 'Far::External' : undefined)),
    '<<Far::External>>',
  );
  // Unresolvable on every reading: the raw marker is kept.
  assert.equal(decodeMergeFields(mf(`${to163}022102`), () => undefined), '<<⟨field:163.8578⟩>>');
});

test('a button\'s Perform Script names its file by data source id, only when the file has that source', () => {
  const schema = { dataSources: [{ id: 2, name: 'Data', paths: ['file:Data'] }] } as never;
  assert.deepEqual(buttonFile(Uint8Array.of(1, 2), schema), { id: 2, name: 'Data' });
  // A data source the file doesn't have, or no reference at all, leaves the button as a script of this file.
  assert.equal(buttonFile(Uint8Array.of(1, 1), schema), undefined);
  assert.equal(buttonFile(undefined, schema), undefined);
  assert.equal(buttonFile(Uint8Array.of(0), schema), undefined);
});
