import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, isLayoutSnippet, layoutObjectsFrom, layoutObjectsFromSnippet, layoutSnippet, parseXml, Store, StoreError, type XmlElement } from '../src/index.ts';
import { FmpDatabase, readLayoutDesigns, type LayoutObject } from '../../fmp12/src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Flicks.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-layout-snippet-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

const kids = (e: XmlElement) => e.children.filter((c): c is XmlElement => typeof c !== 'string');
const flat = (os: LayoutObject[], out: LayoutObject[] = []) => {
  for (const o of os) {
    out.push(o);
    flat(o.children ?? [], out);
  }
  return out;
};
/** Theme styles by the name FileMaker shows, from the objects that use them (as the server builds it). */
const styleNames = (layouts: { objects: LayoutObject[] }[]) => {
  const m = new Map<string, string>();
  for (const o of flat(layouts.flatMap((l) => l.objects))) if (o.style.displayName && o.style.name) m.set(o.style.displayName, o.style.name);
  return m;
};

function shop(file = 'shop.sqlite'): Store {
  const path = join(dir, file);
  createStore(path);
  const store = new Store(path, 'Shop');
  store.applyDesign([
    { op: 'createTable', name: 'Orders', fields: [{ name: 'id' }, { name: 'Customer' }, { name: 'Status' }, { name: 'Total', type: 'number' }] },
    { op: 'createTable', name: 'Lines', fields: [{ name: 'order_id' }, { name: 'Product' }, { name: 'Qty', type: 'number' }] },
    { op: 'createRelationship', left: 'Orders', right: 'Lines', predicates: [{ left: 'id', operator: '=', right: 'order_id' }] },
    { op: 'createValueList', name: 'States', values: ['Open', 'Closed'] },
    { op: 'createScript', name: 'Close Order', steps: [] },
  ]);
  return store;
}

// Objects as FileMaker Pro copies them in Layout mode (shapes from Andrew Kear's specification).
const CLIP = `<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="LayoutObjectList">
  <Layout enclosingRectTop="10" enclosingRectLeft="10" enclosingRectBottom="400" enclosingRectRight="600">
    <Object type="Field" key="1" LabelKey="0" flags="1073741829" rotation="0">
      <ConditionalFormatting>
        <Item id="0" flags="7">
          <Condition op="0"><Calculation><![CDATA[Self = "Closed"]]></Calculation><RangeBegin></RangeBegin><RangeEnd/></Condition>
          <Format><Styles><LocalCSS>
self:normal .self
{
	background-color: rgba(40%,69%,19%,1);
}
</LocalCSS></Styles></Format>
        </Item>
      </ConditionalFormatting>
      <ScriptTriggers>
        <Trigger event="OnObjectModify" id="3" triggerFlags="1"><Script id="99" name="Close Order"/><TriggerText>"Close Order"</TriggerText></Trigger>
      </ScriptTriggers>
      <Bounds top="10" left="10" bottom="30" right="200"/>
      <ToolTip><Calculation><![CDATA["Where the order is"]]></Calculation></ToolTip>
      <FieldObj numOfReps="1" flags="1048612" inputMode="0" keyboardType="1" displayType="2" quickFind="1" pictFormat="5">
        <Name>Orders::Status</Name>
        <ValueList>States</ValueList>
        <Styles>
          <LocalCSS>
self:normal .self
{
	font-size: 14pt;
	color: rgba(100%,0%,0%,1);
	border-top-width: 1.5pt;
	-fm-text-vertical-align: center;
	-fm-borders-between-reps: true;
}
</LocalCSS>
          <ThemeName>com.filemaker.theme.apex_blue</ThemeName>
        </Styles>
        <DDRInfo><Field name="Status" id="3" repetition="1" maxRepetition="1" table="Orders"/><ValueList name="States" id="1"/></DDRInfo>
      </FieldObj>
      <HideCondition findMode="False"><Calculation><![CDATA[IsEmpty ( Orders::id )]]></Calculation></HideCondition>
    </Object>
    <Object type="Text" key="2" LabelKey="0" flags="10" rotation="0">
      <Bounds top="40" left="10" bottom="55" right="200"/>
      <TextObj flags="10">
        <Styles><ThemeName>com.filemaker.theme.apex_blue</ThemeName></Styles>
        <CharacterStyleVector><Style><Data><![CDATA[Order for <<Orders::Customer>>]]></Data></Style></CharacterStyleVector>
      </TextObj>
    </Object>
    <Object type="Portal" key="3" LabelKey="0" flags="0" rotation="0">
      <Bounds top="100" left="10" bottom="300" right="400"/>
      <PortalObj portalFlags="397" numOfRows="5" initialRow="1">
        <TableAliasKey>Lines</TableAliasKey>
        <SortList><Sort type="Descending"><Name>Lines::Qty</Name></Sort></SortList>
        <FilterCalc><Calculation><![CDATA[Lines::Qty > 0]]></Calculation></FilterCalc>
        <Styles><ThemeName>com.filemaker.theme.apex_blue</ThemeName></Styles>
        <Object type="Field" key="4" LabelKey="0" flags="0" rotation="0">
          <Bounds top="4" left="4" bottom="35" right="150"/>
          <FieldObj numOfReps="1" flags="36" inputMode="0" keyboardType="1" displayType="0" quickFind="1" pictFormat="5"><Name>Lines::Product</Name></FieldObj>
        </Object>
      </PortalObj>
    </Object>
    <Object type="TabControl" key="5" LabelKey="0" flags="0" rotation="0">
      <Bounds top="310" left="10" bottom="400" right="600"/>
      <TabControlObj tabHeight="20" visPanelKey="7" defaultVisPanelKey="7" visPanelIndex="1" defaultVisPanelIndex="1" tabWidthModifier="70" tabFlagSet="264">
        <Styles/>
        <Object type="TabPanel" key="6" LabelKey="0" flags="0" rotation="0">
          <Bounds top="0" left="0" bottom="90" right="590"/>
          <TitleCalc><Calculation><![CDATA["Lines"]]></Calculation></TitleCalc>
          <TabPanelObj tabLeftEdge="0" tabWidth="100" tabPanelFlagSet="1"/>
        </Object>
        <Object type="TabPanel" key="7" LabelKey="0" flags="0" rotation="0">
          <Bounds top="0" left="0" bottom="90" right="590"/>
          <TitleCalc><Calculation><![CDATA["Notes \\"etc\\""]]></Calculation></TitleCalc>
          <TabPanelObj tabLeftEdge="99" tabWidth="100" tabPanelFlagSet="0">
            <Object type="Rect" key="8" LabelKey="0" flags="0" rotation="0">
              <Bounds top="30" left="20" bottom="60" right="120"/>
              <Styles><ThemeName>com.filemaker.theme.apex_blue</ThemeName></Styles>
              <RenderFormat renderType="0"/>
            </Object>
          </TabPanelObj>
        </Object>
      </TabControlObj>
    </Object>
    <Object type="ButtonBar" key="9" LabelKey="0" flags="0" rotation="0">
      <Bounds top="0" left="300" bottom="35" right="600"/>
      <Styles><ThemeName>com.filemaker.theme.apex_blue</ThemeName></Styles>
      <ButtonBarObj flags="0" segmentKey="11">
        <Object type="Button" key="10" LabelKey="0" flags="8" rotation="0">
          <Bounds top="1" left="1" bottom="34" right="150"/>
          <TextObj flags="2"><CharacterStyleVector><Style><Data/></Style></CharacterStyleVector></TextObj>
          <ButtonObj buttonFlags="2" iconSize="16" displayType="0">
            <Step enable="True" id="1" name="Perform Script"><Calculation><![CDATA[Orders::id]]></Calculation><Script id="42" name="Close Order"/></Step>
          </ButtonObj>
          <LabelCalc><Calculation><![CDATA["Close"]]></Calculation></LabelCalc>
        </Object>
        <Object type="Button" key="11" LabelKey="0" flags="8" rotation="0">
          <Bounds top="1" left="150" bottom="34" right="299"/>
          <TextObj flags="2"><CharacterStyleVector><Style><Data/></Style></CharacterStyleVector></TextObj>
          <ButtonObj buttonFlags="3" iconSize="16" displayType="0"></ButtonObj>
          <LabelCalc><Calculation><![CDATA[Orders::Status]]></Calculation></LabelCalc>
        </Object>
      </ButtonBarObj>
    </Object>
    <Object type="ExternalObject" key="12" LabelKey="0" name="map" flags="-1073741824" rotation="0">
      <Bounds top="10" left="420" bottom="90" right="600"/>
      <ExternalObj typeID="WEBV" typeIndex="0" externalFlagSet="32865">
        <Styles><CustomStyles><Name>No Such Style</Name></CustomStyles><ThemeName>com.filemaker.theme.apex_blue</ThemeName></Styles>
        <Calculation index="0"><![CDATA["https://example.com/?q=" & Orders::Customer]]></Calculation>
      </ExternalObj>
    </Object>
    <Object type="Field" key="13" LabelKey="0" flags="0" rotation="0">
      <Bounds top="60" left="10" bottom="80" right="200"/>
      <FieldObj numOfReps="1" flags="32" inputMode="0" keyboardType="1" displayType="0" quickFind="1" pictFormat="5"><Name>Orders::Gone</Name></FieldObj>
    </Object>
    <Object type="ExternalObject" key="14" LabelKey="0" flags="0" rotation="0">
      <Bounds top="410" left="10" bottom="500" right="200"/>
      <ExternalObj typeID="CHRT" typeIndex="0" externalFlagSet="0"/>
    </Object>
  </Layout>
</fmxmlsnippet>`;

test('layout objects copied in FileMaker paste as Tabularius objects, positioned on the layout', () => {
  const store = shop();
  assert.ok(isLayoutSnippet(CLIP));
  const theme = { id: 1, name: 'Apex Blue', defaults: {}, styles: [] };
  const r = layoutObjectsFromSnippet(CLIP, store.schema, { theme, firstId: 100 });
  const [status, merge, portal, tabs, bar, web, gone] = r.objects;
  assert.equal(r.objects.length, 7, 'the chart is left out');
  const s = store.schema;
  const to = (n: string) => s.tableOccurrences.find((t) => t.name === n)!.id;
  const fid = (t: string, f: string) => s.tables.find((x) => x.name === t)!.fields.find((x) => x.name === f)!.id;

  assert.equal(status.kind, 'field');
  assert.deepEqual(status.bounds, { top: 10, left: 10, bottom: 30, right: 200 });
  assert.deepEqual(status.anchors, { left: true, top: true, right: true, bottom: false });
  assert.deepEqual(status.field, {
    tableOccurrenceId: to('Orders'), fieldId: fid('Orders', 'Status'), tableOccurrence: 'Orders', field: 'Status', display: 'popup', repetitions: 1,
    valueListId: s.valueLists[0].id, valueList: 'States', behavior: { browse: 'view' },
  });
  assert.equal(status.style.element, 63);
  assert.deepEqual(status.style.rules, [{ part: 1, state: 1, css: { 'font-size': '14px', color: 'rgb(255 0 0)', 'border-top-width': '1.5px', '--fm-vertical-align': 'center' } }]);
  assert.equal(status.tooltip, '"Where the order is"');
  assert.deepEqual(status.hide, { formula: 'IsEmpty ( Orders::id )', inFind: false });
  assert.deepEqual(status.conditions, [{ formula: 'Self = "Closed"', rules: [{ part: 1, state: 1, css: { 'background-color': 'rgb(102 176 48)' } }] }]);
  assert.deepEqual(status.triggers, [{ event: 'OnObjectModify', scriptId: s.scripts[0].id, script: 'Close Order' }], 'scripts bind by name, not the copied id');

  assert.equal(merge.text, 'Order for <<Orders::Customer>>');

  // Portal rows are relative to the portal, inside its 1pt border.
  assert.deepEqual(portal.portal, {
    tableOccurrenceId: to('Lines'), tableOccurrence: 'Lines', rows: 5, initialRow: 1, filter: 'Lines::Qty > 0', scrolling: true, scrollBarWhenScrolling: true, allowDelete: true,
    sort: [{ field: { tableOccurrenceId: to('Lines'), fieldId: fid('Lines', 'Qty'), tableOccurrence: 'Lines', field: 'Qty' }, descending: true }],
  });
  assert.deepEqual(portal.children![0].bounds, { top: 105, left: 15, bottom: 136, right: 161 });
  assert.equal(portal.children![0].field!.behavior?.browse, 'view');

  // Tab panels and what's on them are relative to the tab control.
  assert.deepEqual(tabs.children!.map((p) => [p.kind, p.text, p.bounds.top, p.tab?.left]), [['tab-panel', 'Lines', 310, 0], ['tab-panel', 'Notes "etc"', 310, 99]]);
  assert.equal(tabs.target, tabs.children![1].id, 'the default front tab');
  assert.deepEqual(tabs.children![1].children![0].bounds, { top: 340, left: 30, bottom: 370, right: 130 });

  // Button bar segments: relative, labels from LabelCalc, the active one by key.
  const [close, state] = bar.children!;
  assert.deepEqual(close.bounds, { top: 1, left: 301, bottom: 34, right: 450 });
  assert.equal(close.style.element, 79);
  assert.equal(close.text, 'Close');
  assert.deepEqual(close.action, { stepId: 1, step: 'Perform Script', scriptId: s.scripts[0].id, param: s.scripts[0].id, script: 'Close Order', parameter: 'Orders::id' });
  assert.equal(state.label, 'Orders::Status');
  assert.equal(state.text, undefined);
  assert.equal(bar.activeSegment, state.id);

  assert.equal(web.kind, 'web-viewer');
  assert.equal(web.name, 'map');
  assert.equal(web.webUrl, '"https://example.com/?q=" & Orders::Customer');
  assert.deepEqual(web.anchors, { left: true, top: true, right: true, bottom: true });
  assert.equal(web.style.name, undefined, 'a style the theme lacks is dropped');

  assert.deepEqual(gone.field && [gone.field.fieldId, gone.field.field], [0, 'Gone']);
  assert.ok(r.objects.every((o) => o.id >= 100));
  for (const n of ['the field Orders::Gone isn\'t in this file', '"No Such Style"', 'Charts']) assert.ok(r.notes.some((x) => x.includes(n)), n);

  // Copied back out, the same objects come back.
  const out = layoutSnippet(r.objects, store.schema, { theme });
  assert.ok(isLayoutSnippet(out.xml));
  const again = layoutObjectsFromSnippet(out.xml, store.schema, { theme, firstId: 100 });
  assert.deepEqual(again.objects, r.objects);

  assert.throws(() => layoutObjectsFromSnippet('<fmxmlsnippet type="FMObjectList"/>', store.schema), (e: StoreError) => e.code === 960);
  store.close();
});

test('layout objects: the padlock and Sliding & Visibility carry over in the object flags', () => {
  const store = shop('flags.sqlite');
  // flags 2 + 16 + 64 + 512: locked, slide up, shrink the part, hide when printing (Kear §2.1).
  const xml = `<fmxmlsnippet type="LayoutObjectList"><Layout enclosingRectTop="0" enclosingRectLeft="0" enclosingRectBottom="40" enclosingRectRight="40">
    <Object type="Rect" key="1" LabelKey="0" flags="594" rotation="0"><Bounds top="0" left="0" bottom="40" right="40"/><RectObj flags="0"/></Object>
    <Object type="Oval" key="2" LabelKey="0" flags="32" rotation="0"><Bounds top="0" left="50" bottom="40" right="90"/></Object>
  </Layout></fmxmlsnippet>`;
  const [rect, oval] = layoutObjectsFromSnippet(xml, store.schema).objects;
  assert.equal(rect.locked, true);
  assert.deepEqual(rect.sliding, { up: true, resizePart: true });
  assert.equal(rect.hideWhenPrinting, true);
  assert.equal(oval.locked, undefined);
  assert.deepEqual(oval.sliding, { left: true });
  const out = layoutSnippet([rect, oval], store.schema).xml;
  assert.match(out, /type="Rect"[^>]*flags="594"/);
  assert.match(out, /type="Oval"[^>]*flags="32"/);
  store.close();
});

// Flicks ships with the report FileMaker 26 wrote for it, in the same object grammar as the clipboard.
test('layout objects: Flicks\' Design Report reads as the objects decoded from the file', { skip }, () => {
  const db = FmpDatabase.open(join(fixtures, 'Flicks.fmp12'));
  const designs = readLayoutDesigns(db.file, db.schema);
  const names = styleNames(designs.layouts);
  const report = parseXml(new TextDecoder('utf-16le').decode(readFileSync(join(fixtures, 'Flicks_ddr.xml'))).replace(/^﻿/, ''));
  const find = (e: XmlElement, n: string): XmlElement | undefined => {
    for (const c of kids(e)) {
      if (c.name === n) return c;
      const r = find(c, n);
      if (r) return r;
    }
  };
  const sig = (o: LayoutObject) => JSON.stringify([
    o.kind, [o.bounds.top, o.bounds.left, o.bounds.bottom, o.bounds.right].map(Math.round), o.name,
    o.field && [o.field.tableOccurrence, o.field.field, o.field.display, o.field.repetitions, o.field.valueList, o.field.behavior],
    o.kind === 'text' || o.kind === 'button' ? o.text ?? '' : undefined, o.action && [o.action.stepId, o.action.script, o.action.parameter],
    o.tooltip, o.hide, o.conditions, o.portal && [o.portal.tableOccurrence, o.portal.rows, o.portal.scrolling, o.portal.allowDelete, o.portal.filter],
    o.webUrl, o.style.name, o.style.rules ?? [], o.triggers?.map((t) => t.event), o.placeholder, o.children?.length,
  ]);
  let compared = 0;
  let anchors = 0;
  for (const l of kids(find(report, 'LayoutCatalog')!)) {
    const ours = designs.layouts.find((d) => d.id === Number(l.attrs.id));
    const objects = kids(l).filter((k) => k.name === 'Object');
    if (!ours || !objects.length) continue;
    const got = flat(layoutObjectsFrom(objects, db.schema, { positions: 'layout', styleNames: names, theme: designs.themes.find((t) => t.id === ours.themeId) }).objects);
    const want = flat(ours.objects);
    // One layout gained a field after the report was made.
    if (l.attrs.name === 'WV Framework - Sample Data') assert.equal(got.length, want.length + 1);
    else assert.equal(got.length, want.length, l.attrs.name);
    for (let i = 0; i < want.length; i++) {
      assert.equal(sig(got[i]), sig(want[i]), `${l.attrs.name} object ${i}`);
      if (JSON.stringify(got[i].anchors) !== JSON.stringify(want[i].anchors)) anchors++;
      compared++;
    }
  }
  assert.ok(compared > 130, `${compared} objects`);
  // Two fields off to the right of one layout were anchored differently after the report.
  assert.ok(anchors <= 2, `${anchors} anchors differ`);
});

test('layout objects: every layout in the sample files copies out and pastes back the same', { skip }, () => {
  // What FileMaker's clipboard XML can't carry, or Tabularius keeps outside it, is left out of the comparison.
  const strip = (o: LayoutObject): unknown => {
    // (Where a popover's title bar setting lives in the clipboard isn't known.)
    const { id: _i, type: _t, target: _g, activeSegment: _a, activeSegmentFormula: _f, icon: _c, imageId: _m, chart: _h, external: _e, titleBar: _b, children, ...rest } = o;
    const r = structuredClone(rest) as Record<string, any>;
    delete r.style.element;
    if (r.action) delete r.action.param;
    if (r.field) delete r.field.format;
    // Value lists the reader found no definition for have only an id, which the clipboard names by name.
    if (r.field && r.field.valueList === undefined) delete r.field.valueListId;
    // A segment's literal label and its text are the same thing.
    if (r.label !== undefined && r.label === `"${r.text}"`) delete r.label;
    // Rules on parts Tabularius has no FileMaker selector for, and gradients, aren't written.
    r.style.rules = (r.style.rules ?? []).flatMap((x: any) => {
      if (![1, 2, 3, 4, 6, 8, 22].includes(x.part) || ![1, 2, 3, 4, 7, 18].includes(x.state)) return [];
      const css = Object.fromEntries(Object.entries(x.css).filter(([k, v]) => !(k === 'background-image' && v !== 'none') && !(k.startsWith('--') && k !== '--fm-icon-color' && k !== '--fm-vertical-align')));
      return Object.keys(css).length ? [{ ...x, css }] : [];
    });
    if (!r.style.rules.length) delete r.style.rules;
    if (r.conditions) r.conditions = r.conditions.map((c: any) => ({ formula: c.formula }));
    if (r.triggers) r.triggers = r.triggers.map((t: any) => [t.event, t.script, t.parameter]);
    return { ...r, children: (children ?? []).filter((c) => !['chart', 'graphic', 'unknown'].includes(c.kind) && !(c.kind === 'field' && !c.field)).map(strip) };
  };
  let objects = 0;
  for (const f of readdirSync(fixtures).filter((x) => x.endsWith('.fmp12'))) {
    const db = FmpDatabase.open(join(fixtures, f));
    const designs = readLayoutDesigns(db.file, db.schema);
    for (const l of designs.layouts) {
      const theme = designs.themes.find((t) => t.id === l.themeId);
      const objs = l.objects.filter((o) => !['chart', 'graphic', 'unknown'].includes(o.kind));
      if (!objs.length) continue;
      const names = styleNames(designs.layouts.filter((x) => x.themeId === l.themeId));
      const back = layoutObjectsFromSnippet(layoutSnippet(objs, db.schema, { theme }).xml, db.schema, { theme, styleNames: names });
      assert.deepEqual(back.objects.map(strip), objs.map(strip), `${f} layout ${l.id}`);
      objects += flat(objs).length;
    }
  }
  assert.ok(objects > 1500, `${objects} objects`);
});

test('layout objects: web viewer options and portal row states carry over', () => {
  const store = shop('wv.sqlite');
  const xml = `<fmxmlsnippet type="LayoutObjectList"><Layout enclosingRectTop="0" enclosingRectLeft="0" enclosingRectBottom="200" enclosingRectRight="500">
    <Object type="ExternalObject" key="1" LabelKey="0" name="wv1" flags="0" rotation="0"><Bounds top="10" left="10" bottom="200" right="500"/>
      <ExternalObj typeID="WEBV" typeIndex="0" externalFlagSet="32865"><Calculation index="0"><![CDATA["data:text/html,<p>hi</p>"]]></Calculation></ExternalObj></Object>
  </Layout></fmxmlsnippet>`;
  const [wv] = layoutObjectsFromSnippet(xml, store.schema).objects;
  // 32865: interaction and the JavaScript bridge, URL encoding off (Kear §15.1).
  assert.deepEqual(wv.webOptions, { interaction: true, findMode: false, progressBar: false, statusMessages: false, encodeUrl: false, jsBridge: true });
  assert.match(layoutSnippet([wv], store.schema).xml, /externalFlagSet="32865"/);
  const portal = { id: 2, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 0, left: 0, bottom: 100, right: 200 },
    style: { rules: [{ part: 1, state: 1, css: { '-fm-portal-alt-background': 'false' } }] }, portal: { tableOccurrenceId: store.schema.tableOccurrences[0].id, rows: 4, initialRow: 1 }, children: [] } as unknown as LayoutObject;
  const out = layoutSnippet([portal], store.schema).xml;
  assert.match(out, /-fm-portal-alt-background: false/);
  const [back] = layoutObjectsFromSnippet(out, store.schema).objects;
  assert.equal(back.style.rules?.find((r) => r.part === 1 && r.state === 1)?.css['-fm-portal-alt-background'], 'false');
  // Concealed edit box, scroll bar and the Return and Enter keys go out as FieldObj flags and come back.
  const to = store.schema.tableOccurrences[0];
  const fieldId = store.schema.tables.find((t) => t.id === to.baseTableId)!.fields[0].id;
  const fld = { ...portal, id: 3, kind: 'field', type: 1, style: {}, portal: undefined, children: undefined,
    field: { tableOccurrenceId: to.id, fieldId, display: 'edit', repetitions: 1, behavior: { concealed: true, scrollBar: true, returnKey: true, enterKey: true } } } as unknown as LayoutObject;
  const fx = layoutSnippet([fld], store.schema).xml;
  assert.match(fx, new RegExp(`FieldObj [^>]*flags="${32 + 2 ** 21 + 2 ** 8 + 2 ** 6 + 2 ** 7}"`));
  assert.deepEqual(layoutObjectsFromSnippet(fx, store.schema).objects[0].field?.behavior, { concealed: true, scrollBar: true, returnKey: true, enterKey: true });
  // The container format is FieldObj pictFormat (Kear §5.4): 4 crop, 5 reduce (the default), 6 enlarge, 7 reduce or enlarge.
  const pict = { ...fld, field: { ...fld.field!, behavior: undefined, format: { container: 'fit' } } } as LayoutObject;
  const px = layoutSnippet([pict], store.schema).xml;
  assert.match(px, /pictFormat="7"/);
  assert.deepEqual(layoutObjectsFromSnippet(px, store.schema).objects[0].field?.format, { container: 'fit' });
  assert.equal(layoutObjectsFromSnippet(fx, store.schema).objects[0].field?.format, undefined);
  store.close();
});

test('LocalCSS parts: .text is the text box (part 3), .inner_border part 2, both ways', async () => {
  const { cssRules, localCss } = await import('../src/layout-snippet.ts');
  const rules = cssRules('self:normal .text\n{\n\tmargin-top: 4pt;\n\tmargin-left: 3pt;\n}\nself:focus .inner_border\n{\n\tbox-shadow: none;\n}\n');
  assert.deepEqual(rules.map((r) => [r.part, r.state, Object.keys(r.css)]), [[3, 1, ['margin-top', 'margin-left']], [2, 4, ['box-shadow']]]);
  const back = localCss(rules);
  assert.match(back, /self:normal \.text\n\{\n\tmargin-top: 4pt;\n\tmargin-left: 3pt;/);
  assert.match(back, /self:focus \.inner_border/);
});

test('layout objects: rotation is degrees clockwise in the snippet (SNIPPET_ROTATION_SIGN pins the assumption)', async () => {
  const { SNIPPET_ROTATION_SIGN } = await import('../src/layout-snippet.ts');
  const store = shop('rot.sqlite');
  const to = store.schema.tableOccurrences[0];
  const fieldId = store.schema.tables.find((t) => t.id === to.baseTableId)!.fields[0].id;
  const fld = { id: 1, kind: 'field', type: 1, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 0, left: 0, bottom: 40, right: 100 }, style: {},
    field: { tableOccurrenceId: to.id, fieldId, display: 'edit', repetitions: 1 } } as unknown as LayoutObject;
  // If a sample copied from FileMaker proves it counts the other way, flip SNIPPET_ROTATION_SIGN to -1 and change these two lines.
  assert.equal(SNIPPET_ROTATION_SIGN, 1);
  const turned = layoutSnippet([{ ...fld, rotation: 90 }], store.schema).xml;
  assert.match(turned, /rotation="90"/);
  assert.equal(layoutObjectsFromSnippet(turned, store.schema).objects[0].rotation, 90);
  for (const turn of [180, 270] as const) {
    assert.equal(layoutObjectsFromSnippet(layoutSnippet([{ ...fld, rotation: turn }], store.schema).xml, store.schema).objects[0].rotation, turn);
  }
  assert.match(layoutSnippet([fld], store.schema).xml, /rotation="0"/);
  assert.equal(layoutObjectsFromSnippet(layoutSnippet([fld], store.schema).xml, store.schema).objects[0].rotation, undefined);
  // Turns that aren't quarter turns stay upright, and the paste says so.
  const odd = layoutObjectsFromSnippet(turned.replace('rotation="90"', 'rotation="45"'), store.schema);
  assert.equal(odd.objects[0].rotation, undefined);
  assert.ok(odd.notes.some((n) => /45/.test(n)));
  store.close();
});
