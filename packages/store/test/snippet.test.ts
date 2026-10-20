import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, snippetChanges, designSnippet, parseXml, Store, StoreError } from '../src/index.ts';
import { FmpDatabase, stepLine, scriptText, undecodedOptionError } from '../../fmp12/src/index.ts';

const fixtures = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const skip = existsSync(join(fixtures, 'Flicks.fmp12')) ? false : 'fixtures missing: run npm run fixtures';
let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-snippet-'));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true });
});

function blank(name: string): Store {
  const path = join(dir, `${name}.sqlite`);
  createStore(path);
  return new Store(path, name);
}

const paste = (store: Store, xml: string, opts = {}) => {
  const r = snippetChanges(xml, store.schema, opts);
  store.applyDesign(r.changes);
  return r;
};

test('XML element depth limit includes self-closing leaves', () => {
  const ancestors = '<a>'.repeat(511);
  assert.doesNotThrow(() => parseXml(`${ancestors}<leaf/>${'</a>'.repeat(511)}`));
  const tooDeep = '<a>'.repeat(512);
  for (const leaf of ['<leaf/>', '<leaf></leaf>']) {
    assert.throws(() => parseXml(`${tooDeep}${leaf}${'</a>'.repeat(512)}`), /nested more than 512 deep/);
  }
});

test('refresh and viewer XML retain flush flags, calculated targets/URLs and absent versus zero/one repetition', () => {
  const store = blank('Refresh');
  try {
    store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name' }] }]);
    const text = [
      'Refresh Window', 'Refresh Window [ Flush cached join results ]', 'Refresh Window [ Flush cached external data ]',
      'Refresh Window [ Flush cached join results ; Flush cached external data ]', 'Refresh Portal',
      'Refresh Portal [ Object Name: "port" & "al" ]', 'Refresh Object [ Object Name: "name" ]',
      'Refresh Object [ Object Name: "name" ; Repetition: 1 ]', 'Refresh Object [ Object Name: "name" ; Repetition: 1 - 1 ]',
      ...['Reset', 'Reload', 'Go Back', 'Go Forward'].map((action) => `Set Web Viewer [ Object Name: "viewer" ; ${action} ]`),
      'Set Web Viewer [ Object Name: "view" & "er" ; URL: "data:text/html," & Items::Name ]',
    ].join('\n');
    store.applyDesign([{ op: 'createScript', name: 'Refresh', text }]);
    const script = store.schema.scripts.find((s) => s.name === 'Refresh')!;
    const xml = designSnippet(store.schema, { scripts: [script.id] });
    assert.deepEqual(xml.notes, []);
    const changes = snippetChanges(xml.xml, store.schema);
    const steps = (changes.changes[0] as { steps: { stepId: number; params?: object }[] }).steps;
    assert.deepEqual(steps.map((s) => s.params ?? {}), script.steps.map((s) => s.params ?? {}));
    // The GoToURL tag and its wrappers are verified against Flicks' FileMaker-generated DDR.
    const generated = `<fmxmlsnippet type="FMObjectList"><Step enable="True" id="146" name="Set Web Viewer"><Action value="GoToURL"/><ObjectName><Calculation><![CDATA[$_object_name]]></Calculation></ObjectName><URL custom="False"><Calculation><![CDATA[$_url]]></Calculation></URL></Step></fmxmlsnippet>`;
    const imported = snippetChanges(generated, store.schema).changes[0] as { steps: { params?: object }[] };
    assert.deepEqual(imported.steps[0].params, { viewerAction: 'Go to URL', objectName: '$_object_name', viewerUrl: '$_url' });
  } finally { store.close(); }
});

// A table as FileMaker Pro copies it from Manage Database's Tables tab.
const TABLE = `<?xml version="1.0" encoding="UTF-8"?>
<fmxmlsnippet type="FMObjectList">
  <BaseTable comment="" name="Invoices">
    <Field id="1" dataType="Text" fieldType="Normal" name="id">
      <Comment>Primary key</Comment>
      <AutoEnter allowEditing="False" overwriteExistingValue="True" alwaysEvaluate="False" constant="False" furigana="False" lookup="False" calculation="True">
        <ConstantData/>
        <Calculation table="Invoices"><![CDATA[Get ( UUID )]]></Calculation>
      </AutoEnter>
      <Validation messageCalc="False" message="False" maxLength="False" valuelist="False" calculation="False" alwaysValidateCalculation="False" type="OnlyDuringDataEntry">
        <NotEmpty value="True"/><Unique value="True"/><Existing value="False"/><StrictValidation value="True"/>
      </Validation>
      <Storage autoIndex="True" index="Minimal" indexLanguage="English" global="False" maxRepetition="1"/>
    </Field>
    <Field id="2" dataType="Number" fieldType="Normal" name="number">
      <Comment/>
      <AutoEnter allowEditing="True" constant="False" furigana="False" lookup="False" calculation="False">
        <Serial increment="5" nextValue="1001" generate="OnCreation"/>
        <ConstantData/>
      </AutoEnter>
      <Storage autoIndex="True" index="None" indexLanguage="English" global="False" maxRepetition="1"/>
    </Field>
    <Field id="5" dataType="Number" fieldType="Summary" name="Total amount">
      <SummaryInfo restartForEachSortedGroup="False" summarizeRepetition="Together" operation="Total">
        <SummaryField><Field id="3" name="amount"/></SummaryField>
      </SummaryInfo>
      <Comment/>
    </Field>
    <Field id="3" dataType="Number" fieldType="Normal" name="amount">
      <Comment/>
      <AutoEnter allowEditing="True" value="ConstantData" constant="True" furigana="False" lookup="False" calculation="False">
        <ConstantData>0</ConstantData>
      </AutoEnter>
      <Validation messageCalc="False" message="True" maxLength="False" valuelist="False" calculation="False" alwaysValidateCalculation="False" type="Always">
        <StrictDataType value="Numeric"/><NotEmpty value="False"/><Unique value="False"/><Existing value="False"/>
        <Range from="0" to="100000"/><StrictValidation value="False"/>
        <ErrorMessage>Amount must be&#13;between 0 and 100,000</ErrorMessage>
      </Validation>
      <Storage autoIndex="True" index="None" indexLanguage="English" global="False" maxRepetition="1"/>
    </Field>
    <Field id="4" dataType="Number" fieldType="Calculated" name="with tax">
      <Calculation table="Invoices"><![CDATA[amount * 1.2]]></Calculation>
      <Comment/>
      <AutoEnter alwaysEvaluate="False"/>
      <Storage storeCalculationResults="False" indexLanguage="English" global="False" maxRepetition="1"/>
    </Field>
    <Field id="6" dataType="TimeStamp" fieldType="Normal" name="created">
      <Comment/>
      <AutoEnter allowEditing="False" value="CreationTimeStamp" constant="False" furigana="False" lookup="False" calculation="False"><ConstantData/></AutoEnter>
      <Storage autoIndex="True" index="None" indexLanguage="English" global="False" maxRepetition="3"/>
    </Field>
  </BaseTable>
</fmxmlsnippet>`;

test('a table pasted from FileMaker: fields, auto-enter, validation, summary; records follow them', () => {
  const store = blank('Tables');
  const r = paste(store, TABLE);
  assert.deepEqual(r.summary, ['1 table']);
  assert.deepEqual(r.notes, []);
  const t = store.schema.tables.find((x) => x.name === 'Invoices')!;
  // The summary goes after the field it totals.
  assert.deepEqual(t.fields.map((f) => f.name), ['id', 'number', 'amount', 'with tax', 'created', 'Total amount']);
  const f = (n: string) => t.fields.find((x) => x.name === n)!;
  assert.equal(f('id').comment, 'Primary key');
  assert.deepEqual(f('id').options?.autoEnter, { prohibitModification: true, calculation: true, replaceExisting: true });
  assert.deepEqual(f('id').options?.validation, { notEmpty: true, unique: true, strict: true });
  assert.deepEqual(f('number').options?.autoEnter, { serial: { next: '1001', increment: 5 } });
  assert.deepEqual(f('amount').options?.validation, { always: true, type: 'number', range: { min: '0', max: '100000' }, message: 'Amount must be\nbetween 0 and 100,000' });
  assert.equal(f('with tax').kind, 'calculation');
  assert.equal(f('with tax').options?.unstored, true);
  assert.equal(f('created').options?.repetitions, 3);
  assert.deepEqual(f('Total amount').summary, { type: 'total', fieldId: f('amount').id, field: 'amount' });
  // FileMaker's table paste also makes an occurrence and a layout.
  assert.ok(store.schema.tableOccurrences.some((o) => o.name === 'Invoices'));
  assert.ok(store.layouts().some((l) => l.name === 'Invoices'));

  const a = store.get('Invoices', store.create('Invoices', { amount: '10' }).recordId).fieldData;
  const b = store.get('Invoices', store.create('Invoices', { amount: '30' }).recordId).fieldData;
  assert.match(String(a.id), /^[0-9A-F-]{36}$/i);
  assert.notEqual(a.id, b.id);
  assert.equal(a.number, 1001);
  assert.equal(b.number, 1006);
  assert.equal(a['with tax'], 12);

  // Pasting it again makes "Invoices 2", as FileMaker does.
  const again = paste(store, TABLE);
  assert.deepEqual(again.notes, ['Table "Invoices" already exists: pasted as "Invoices 2"']);
  assert.equal(store.schema.tables.find((x) => x.name === 'Invoices 2')?.fields.length, 6);
});

test('fields pasted into a table: names in use get a suffix and the pasted formulas follow them', () => {
  const store = blank('Fields');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'price', type: 'number' }, { name: 'Status' }] }]);
  store.applyDesign([{ op: 'createValueList', name: 'States', values: ['Open', 'Closed'] }]);
  const xml = `<fmxmlsnippet type="FMObjectList">
    <Field id="1" dataType="Number" fieldType="Normal" name="price"><Comment/><Storage global="False" maxRepetition="1"/></Field>
    <Field id="2" dataType="Number" fieldType="Normal" name="qty"><Comment/></Field>
    <Field id="3" dataType="Number" fieldType="Calculated" name="line"><Calculation table="Items"><![CDATA[price * qty]]></Calculation><Comment/></Field>
    <Field id="4" dataType="Text" fieldType="Normal" name="state"><Comment/>
      <Validation messageCalc="False" message="False" maxLength="True" valuelist="True" calculation="True" type="OnlyDuringDataEntry">
        <ValueList id="99" name="States"/><Calculation table="Items"><![CDATA[not IsEmpty ( state )]]></Calculation><MaxDataLength value="20"/>
      </Validation>
    </Field>
    <Field id="5" dataType="Text" fieldType="Normal" name="kind"><Comment/>
      <AutoEnter allowEditing="True" value="PreviousRecord" constant="False" furigana="False" lookup="False" calculation="False"><ConstantData/></AutoEnter>
      <Validation messageCalc="False" message="False" maxLength="False" valuelist="True" calculation="False" type="OnlyDuringDataEntry"><ValueList id="7" name="Kinds"/></Validation>
    </Field>
  </fmxmlsnippet>`;
  assert.throws(() => snippetChanges(xml, store.schema), (e: StoreError) => /Pick a table/.test(e.message));
  const r = paste(store, xml, { table: 'Items' });
  assert.deepEqual(r.summary, ['5 fields']);
  assert.deepEqual(r.notes, [
    'Field Items::price already exists: pasted as "price 2"',
    'Field Items::kind: its value list "Kinds" isn\'t in this file, so that check was left out',
  ]);
  const t = store.schema.tables.find((x) => x.name === 'Items')!;
  assert.deepEqual(t.fields.map((f) => f.name), ['price', 'Status', 'price 2', 'qty', 'line', 'state', 'kind']);
  assert.equal(t.fields.find((f) => f.name === 'line')!.calculation, 'price 2 * qty');
  assert.equal(t.fields.find((f) => f.name === 'kind')!.options?.autoEnter?.lastVisited, true);
  // And it copies back out as FileMaker writes it.
  assert.match(designSnippet(store.schema, { fields: { table: t.id, ids: [t.fields.find((f) => f.name === 'kind')!.id] } }).xml, /<AutoEnter [^>]*value="PreviousRecord"/);
  const vl = store.schema.valueLists.find((v) => v.name === 'States')!;
  assert.deepEqual(t.fields.find((f) => f.name === 'state')!.options?.validation, { valueList: vl.id, calculation: 'not IsEmpty ( state )', maxLength: 20 });
});

test('custom functions and value lists pasted from FileMaker', () => {
  const store = blank('Functions');
  store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'id' }, { name: 'name' }] }]);
  const r = paste(store, `<fmxmlsnippet type="FMObjectList">
    <CustomFunction id="1" functionArity="2" visible="True" parameters="a;b" name="Hypot"><Calculation><![CDATA[Sqrt ( a^2 + b^2 )]]></Calculation></CustomFunction>
    <ValueList id="1" name="Sizes"><Source value="Custom"/><CustomValues><Text>Small&#13;Medium&#13;Large</Text></CustomValues></ValueList>
    <ValueList id="2" name="Names"><Source value="Field"/>
      <PrimaryField show="False" sort="False"><Field table="People" id="9" name="id"/></PrimaryField>
      <SecondaryField show="True" sort="True"><Field table="People" id="8" name="name"/></SecondaryField>
    </ValueList>
  </fmxmlsnippet>`);
  assert.deepEqual(r.summary, ['1 custom function', '2 value lists']);
  const cf = store.schema.customFunctions.find((c) => c.name === 'Hypot')!;
  assert.deepEqual(cf.parameters, ['a', 'b']);
  assert.equal(cf.formula, 'Sqrt ( a^2 + b^2 )');
  assert.deepEqual(store.schema.valueLists.find((v) => v.name === 'Sizes')!.values, ['Small', 'Medium', 'Large']);
  const names = store.schema.valueLists.find((v) => v.name === 'Names')!.field!;
  const people = store.schema.tables.find((t) => t.name === 'People')!;
  assert.equal(names.fieldId, people.fields[0].id);
  assert.equal(names.secondFieldId, people.fields[1].id);
  assert.equal(names.showSecondOnly, true);
});

test('scripts and steps pasted from FileMaker resolve their references by name', () => {
  const store = blank('Scripts');
  store.applyDesign([{ op: 'createTable', name: 'Tasks', fields: [{ name: 'Title' }, { name: 'Done', type: 'number' }] }]);
  const r = paste(store, `<fmxmlsnippet type="FMObjectList">
    <Script includeInMenu="True" runFullAccess="False" id="40" name="Close task">
      <Step enable="True" id="89" name="# (comment)"><Text>Marks the current task done</Text></Step>
      <Step enable="True" id="86" name="Set Error Capture"><Set state="True"/></Step>
      <Step enable="True" id="141" name="Set Variable"><Value><Calculation><![CDATA[Get ( ScriptParameter )]]></Calculation></Value><Repetition><Calculation><![CDATA[1]]></Calculation></Repetition><Name>$title</Name></Step>
      <Step enable="True" id="6" name="Go to Layout"><LayoutDestination value="SelectedLayout"/><Layout id="12" name="Tasks"/></Step>
      <Step enable="True" id="28" name="Perform Find"><Restore state="True"/><Query><RequestRow operation="Include"><Criteria><Field table="Tasks" id="1" name="Title"/><Text>==$title</Text></Criteria></RequestRow></Query></Step>
      <Step enable="True" id="68" name="If"><Calculation><![CDATA[Get ( FoundCount ) = 1]]></Calculation></Step>
      <Step enable="True" id="76" name="Set Field"><Calculation><![CDATA[1]]></Calculation><Field table="Tasks" id="2" name="Done"/></Step>
      <Step enable="False" id="75" name="Commit Records/Requests"><NoInteract state="True"/><Option state="False"/></Step>
      <Step enable="True" id="1" name="Perform Script"><Calculation><![CDATA[$title]]></Calculation><Script id="41" name="Log"/></Step>
      <Step enable="True" id="70" name="End If"/>
      <Step enable="True" id="39" name="Sort Records"><NoInteract state="True"/><Restore state="True"/><SortList Maintain="True" value="True"><Sort type="Descending"><PrimaryField><Field table="Tasks" id="1" name="Title"/></PrimaryField></Sort></SortList></Step>
      <Step enable="True" id="1" name="Perform Script"><Script id="77" name="Gone"/></Step>
      <Step enable="True" id="999" name="Fly to the Moon"/>
    </Script>
    <Script includeInMenu="True" runFullAccess="False" id="41" name="Log">
      <Step enable="True" id="103" name="Exit Script"><Calculation><![CDATA["logged " & Get ( ScriptParameter )]]></Calculation></Step>
    </Script>
  </fmxmlsnippet>`);
  assert.deepEqual(r.summary, ['2 scripts']);
  assert.deepEqual(r.notes, [
    'Perform Script: the script "Gone" isn\'t in this file',
    '"Fly to the Moon" isn\'t a script step Tabularius knows: pasted as a comment',
  ]);
  const close = store.schema.scripts.find((s) => s.name === 'Close task')!;
  assert.equal(scriptText(close.steps), [
    '# Marks the current task done',
    'Set Error Capture [ On ]',
    'Set Variable [ $title ; Value: Get ( ScriptParameter ) ]',
    'Go to Layout [ “Tasks” ]',
    'Perform Find [ Restore; Find: Tasks::Title: “==$title” ]',
    'If [ Get ( FoundCount ) = 1 ]',
    '\tSet Field [ Tasks::Done ; 1 ]',
    '\t// Commit Records/Requests [ With dialog: Off ]',
    '\tPerform Script [ “Log” ; Parameter: $title ]',
    'End If',
    'Sort Records [ Restore; Tasks::Title; descending ; With dialog: Off ]',
    'Perform Script [ “Gone” ]',
    '// # Fly to the Moon (pasted from FileMaker; not supported)',
  ].join('\n'));
  const log = store.schema.scripts.find((s) => s.name === 'Log')!;
  assert.equal(close.steps[8].params?.script?.id, log.id);

  // Bare steps go into the chosen script at the chosen place.
  const steps = paste(store, `<fmxmlsnippet type="FMObjectList"><Step enable="True" id="85" name="Allow User Abort"><Set state="False"/></Step><Step enable="True" id="17" name="Go to Field"><SelectAll state="False"/><Field table="Tasks" id="1" name="Title"/></Step></fmxmlsnippet>`, { script: 'Log', at: 0 });
  assert.deepEqual(steps.summary, ['2 script steps']);
  assert.equal(scriptText(store.schema.scripts.find((s) => s.name === 'Log')!.steps), 'Allow User Abort [ Off ]\nGo to Field [ Tasks::Title ]\nExit Script [ Result: "logged " & Get ( ScriptParameter ) ]');
  // Without a script, they make a new one.
  paste(store, '<fmxmlsnippet type="FMObjectList"><Step enable="True" id="7" name="New Record/Request"/></fmxmlsnippet>');
  assert.ok(store.schema.scripts.some((s) => s.name === 'Pasted Steps'));
});

test('snippets that can\'t be pasted say why', () => {
  const store = blank('Errors');
  assert.throws(() => snippetChanges('<Layout/>', store.schema), /should start with <fmxmlsnippet>/);
  assert.throws(() => snippetChanges('<fmxmlsnippet type="LayoutObjectList"><Layout/></fmxmlsnippet>', store.schema), /layout objects/);
  assert.throws(() => snippetChanges('<fmxmlsnippet type="FMObjectList"><Step name="If">', store.schema), /never closed/);
  assert.throws(() => snippetChanges('<fmxmlsnippet type="FMObjectList"></fmxmlsnippet>', store.schema), /nothing to paste/);
  assert.deepEqual(parseXml('<a x="1 &amp; 2">t&#13;<![CDATA[<b>]]><!-- c --><b/></a>').children[0], {
    name: 'a', attrs: { x: '1 & 2' }, children: ['t\r', '<b>', { name: 'b', attrs: {}, children: [] }],
  });
});

// FileMaker's Database Design Report writes steps in the clipboard's grammar.
// Each Flicks step read from the report must match the same step decoded
// from the .fmp12 itself.
test('Flicks: steps read from FileMaker\'s XML match the steps decoded from the file', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(join(fixtures, 'Flicks_ddr.xml')));
  const schema = FmpDatabase.open(join(fixtures, 'Flicks.fmp12')).schema;
  const byId = new Map(schema.scripts.map((s) => [s.id, s]));
  let checked = 0;
  for (const m of xml.matchAll(/<Script [^>]*?id="(\d+)"[^>]*>\s*<StepList>([\s\S]*?)<\/StepList>/g)) {
    const script = byId.get(+m[1]);
    if (!script) continue;
    const steps = [...m[2].matchAll(/<Step [^>]*>[\s\S]*?<\/Step>/g)].map((s) => s[0]);
    // The report predates a few edits to the file: skip scripts whose steps changed since.
    if (steps.map((s) => /id="(\d+)"/.exec(s)![1]).join() !== script.steps.map((s) => s.stepId).join()) continue;
    const r = snippetChanges(`<fmxmlsnippet type="FMObjectList">${steps.join('')}</fmxmlsnippet>`, schema);
    const got = (r.changes[0] as { steps: { stepId: number; enabled?: boolean; text?: string; params?: object }[] }).steps;
    got.forEach((g, i) => {
      const want = script.steps[i];
      const where = `${script.name} #${i + 1} ${want.name}`;
      assert.equal(g.stepId, want.stepId, where);
      assert.equal(g.enabled !== false, want.enabled, where);
      if (want.stepId === 89) {
        // The reader doesn't decode some long comments yet; the XML has them.
        if (want.text) assert.equal(g.text, want.text, where);
        return;
      }
      if (want.stepId === 146) {
        // XML's action is known; the binary choice is deliberately undecoded. Compare every verified formula.
        assert.deepEqual(g.params, { viewerAction: 'Go to URL', objectName: want.params?.objectName, viewerUrl: want.params?.viewerUrl }, where);
        assert.equal(want.params?.viewerAction, undefined, where);
        checked++;
        return;
      }
      // A New Window whose layout the report shows as <unknown>.
      if (want.params?.layout?.id === 0) return;
      const xmlWindowStyle = /<NewWndStyles\b[^>]*\bStyle="(Document|Floating|Dialog|Card)"/.exec(steps[i])?.[1];
      const expectedParams = xmlWindowStyle
        ? { ...want.params, windowStyle: ({ Document: 'document', Floating: 'floating', Dialog: 'dialog', Card: 'card' } as const)[xmlWindowStyle as 'Document' | 'Floating' | 'Dialog' | 'Card'] }
        : want.params;
      assert.equal(stepLine(want.name, g.params), stepLine(want.name, expectedParams, want.text), where);
      checked++;
    });
  }
  assert.ok(checked > 350, `checked ${checked} steps`);
});

test('copying out: tables, custom functions and value lists written as FileMaker XML paste back the same', () => {
  const a = blank('CopyA');
  paste(a, TABLE);
  a.applyDesign([
    { op: 'createCustomFunction', name: 'Clamp', parameters: ['x', 'lo', 'hi'], formula: 'Min ( hi ; Max ( lo ; x ) )\n// keeps x in range' },
    { op: 'createValueList', name: 'Grades', values: ['A', 'B & C', '<D>'] },
    // Storage, serial on commit, nearest lookups and calculated validation messages survive the trip.
    { op: 'createField', table: 'Invoices', name: 'Ref', options: { index: 'minimal', noAutoIndex: true, indexLanguage: 'German_Dictionary', autoEnter: { serial: { next: '7', increment: 1, onCommit: true } },
      validation: { calculation: 'Length ( Ref ) < 9', calculationAlways: true, message: '"Too long: " & Ref', messageCalculation: true } } },
    { op: 'createField', table: 'Invoices', name: 'Scan', type: 'container', options: { externalStorage: { path: '"Invoices/" & Ref & "/"' } } },
    { op: 'createField', table: 'Invoices', name: 'Signed', type: 'container', options: { externalStorage: { secure: true } } },
  ]);
  const t = a.schema.tables.find((x) => x.name === 'Invoices')!;
  const { xml, notes } = designSnippet(a.schema, { tables: [t.id], customFunctions: [a.schema.customFunctions[0].id], valueLists: [a.schema.valueLists[0].id] });
  assert.deepEqual(notes, []);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<fmxmlsnippet type="FMObjectList"><CustomFunction id="1" functionArity="3" visible="True" parameters="x;lo;hi" name="Clamp">/);
  assert.ok(xml.includes('<Text>A&#13;B &amp; C&#13;&lt;D&gt;</Text>'));
  assert.ok(xml.includes('<Serial increment="5" nextValue="1001" generate="OnCreation"/>'));
  assert.ok(xml.includes('<Remote type="Open" relativeTo="0"><Location><Calculation table="Invoices"><![CDATA["Invoices/" & Ref & "/"]]></Calculation></Location></Remote>'));
  assert.ok(xml.includes('<Remote type="Secure" relativeTo="0"/>'));

  const b = blank('CopyB');
  const r = paste(b, xml);
  assert.deepEqual(r.notes, []);
  const strip = (s: Store) => s.schema.tables.find((x) => x.name === 'Invoices')!.fields.map((f) => ({ name: f.name, kind: f.kind, type: f.type, calculation: f.calculation, comment: f.comment, options: f.options, summary: f.summary?.field })).sort((x, y) => x.name.localeCompare(y.name));
  assert.deepEqual(strip(b), strip(a));
  assert.deepEqual(b.schema.customFunctions.map((c) => [c.name, c.parameters, c.formula]), a.schema.customFunctions.map((c) => [c.name, c.parameters, c.formula]));
  assert.deepEqual(b.schema.valueLists.map((v) => [v.name, v.values]), [['Grades', ['A', 'B & C', '<D>']]]);

  // Fields and steps on their own.
  const f = designSnippet(a.schema, { fields: { table: t.id, ids: [t.fields[0].id] } }).xml;
  assert.match(f, /<fmxmlsnippet type="FMObjectList"><Field id="1" dataType="Text" fieldType="Normal" name="id"><Comment>Primary key<\/Comment>/);
  assert.throws(() => designSnippet(a.schema, {}), /Pick something/);
  assert.throws(() => designSnippet(a.schema, { scripts: [99] }), /no script with id 99/);

  // Steps picked by the lines selected in the script's text: a comment over two lines is one step.
  a.applyDesign([{ op: 'createScript', name: 'Lines', steps: [{ name: 'Beep' }, { name: '# (comment)', text: 'two\rlines' }, { name: 'Halt Script' }] }]);
  const sc = a.schema.scripts.find((x) => x.name === 'Lines')!;
  const names = (xml: string) => [...xml.matchAll(/<Step [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names(designSnippet(a.schema, { steps: { script: sc.id, lines: [3, 4] } }).xml), ['# (comment)', 'Halt Script']);
  assert.deepEqual(names(designSnippet(a.schema, { steps: { script: sc.id, lines: [1, 1] } }).xml), ['Beep']);
  assert.throws(() => designSnippet(a.schema, { steps: { script: sc.id, lines: [1] as never } }), /steps.lines/);
});

// Steps FileMaker's XML holds options of that Tabularius keeps only as unnamed formulas.
const UNNAMED = new Set(['Close Window', 'Select Window', 'Set Window Title', 'Move/Resize Window', 'Set Web Viewer', 'Perform JavaScript in Web Viewer', 'Save a Copy as']);

test('copying out: every sample script written as FileMaker XML reads back as the same steps', { skip }, () => {
  let checked = 0;
  for (const file of ['Flicks', 'Charts', 'Standards', 'FMburgh_2012_11_07_Database', 'DEMO_drawers']) {
    const schema = FmpDatabase.open(join(fixtures, `${file}.fmp12`)).schema;
    for (const sc of schema.scripts) {
      const { xml, notes } = designSnippet(schema, { scripts: [sc.id] });
      for (const n of notes) assert.ok(UNNAMED.has(n.slice(0, n.indexOf(':'))), `${file} ${sc.name}: ${n}`);
      const got = (snippetChanges(xml, schema).changes[0] as { steps: { stepId: number; enabled?: boolean; text?: string; params?: object }[] }).steps;
      sc.steps.forEach((want, i) => {
        const g = got[i];
        const where = `${file} ${sc.name} #${i + 1} ${want.name}`;
        assert.equal(g.stepId, want.stepId, where);
        assert.equal(g.enabled !== false, want.enabled, where);
        if (want.stepId === 89) return assert.equal(g.text ?? '', want.text ?? '', where);
        if (UNNAMED.has(want.name)) return;
        // A script that performs itself performs its pasted copy (" 2" here, the same name in another file).
        assert.equal(stepLine(want.name, g.params).replace(`“${sc.name} 2”`, `“${sc.name}”`), stepLine(want.name, want.params, want.text), where);
        checked++;
      });
    }
  }
  assert.ok(checked > 1000, `checked ${checked} steps`);
});

test('Insert from Last Visited, Insert from Index and Insert Current Date keep their field and Select option both ways', () => {
  const store = blank('Inserts');
  store.applyDesign([{ op: 'createTable', name: 'Notes', fields: [{ name: 'Text' }, { name: 'Day', type: 'date' }] }]);
  paste(store, `<fmxmlsnippet type="FMObjectList"><Script includeInMenu="True" runFullAccess="False" id="1" name="Copy down">
    <Step enable="True" id="12" name="Insert from Last Visited"><SelectAll state="True"/><Field table="Notes" id="1" name="Text"/></Step>
    <Step enable="True" id="11" name="Insert from Index"><SelectAll state="False"/><Field table="Notes" id="1" name="Text"/></Step>
    <Step enable="True" id="13" name="Insert Current Date"><SelectAll state="True"/><Field table="Notes" id="2" name="Day"/></Step>
  </Script></fmxmlsnippet>`);
  const script = store.schema.scripts.find((s) => s.name === 'Copy down')!;
  const text = 'Insert from Last Visited [ Select ; Notes::Text ]\nInsert from Index [ Notes::Text ]\nInsert Current Date [ Select ; Notes::Day ]';
  assert.equal(scriptText(script.steps), text);
  const xml = designSnippet(store.schema, { scripts: [script.id] }).xml;
  assert.match(xml, /name="Insert from Last Visited"><SelectAll state="True"\/><Field table="Notes" [^>]*name="Text"\/>/);
  assert.match(xml, /name="Insert from Index"><SelectAll state="False"\/><Field table="Notes"/);
});

test('Data API and URL clipboard XML retain Select when imported and exported', () => {
  const store = blank('Select clipboard');
  try {
    paste(store, `<fmxmlsnippet type="FMObjectList"><Script name="Select options">
      <Step enable="True" id="203" name="Execute FileMaker Data API"><SelectAll state="False"/><Field>$r</Field><Calculation><![CDATA["{}"]]></Calculation></Step>
      <Step enable="True" id="160" name="Insert from URL"><SelectAll state="True"/><Field>$url</Field><Calculation><![CDATA["https://example.com"]]></Calculation></Step>
    </Script></fmxmlsnippet>`);
    const script = store.schema.scripts.find((s) => s.name === 'Select options')!;
    assert.deepEqual(script.steps.map((s) => s.params?.selectEntireContents), [false, true]);
    const xml = designSnippet(store.schema, { scripts: [script.id] }).xml;
    assert.match(xml, /name="Execute FileMaker Data API"><SelectAll state="False"\/>/);
    assert.match(xml, /name="Insert from URL"><SelectAll state="True"\/>/);
  } finally { store.close(); }
});

test('clipboard Import Records mode tags and StepText do not establish a decoded mode', () => {
  const store = blank('Clipboard import mode');
  try {
    const result = paste(store, '<fmxmlsnippet type="FMObjectList"><Script name="Pasted"><Step enable="True" id="35" name="Import Records"><StepText>Import Records [ Update ]</StepText><ImportAction value="Update"/><Mode value="Replace"/><Restore state="True"/><Options value="123"/></Step></Script></fmxmlsnippet>');
    const step = store.schema.scripts[0].steps[0];
    assert.equal(step.params?.importAction, undefined);
    assert.equal(step.params?.undecodedOptions, undefined, 'clipboard XML is not binary decoder provenance');
    assert.equal(undecodedOptionError(35, step.params), undefined, 'authored structured steps retain implicit Add');
    assert.match(result.notes.join('\n'), /clipboard options do not establish an Add\/Update\/Replace mode/);
    assert.match(result.notes.join('\n'), /match fields, add-remaining and auto-enter/);
  } finally { store.close(); }
});

test('clipboard export refuses unresolved targeted steps rather than dropping diagnostics', () => {
  const store = blank('Diagnostic export');
  try {
    for (const spec of [
      { name: 'Revert Transaction', params: { undecodedOptions: ['Condition'] } },
      { name: 'Revert Transaction', params: { slots: { 128: '0' } } },
      { name: 'Set Revert Transaction on Error' },
      { name: 'Set Revert Transaction on Error', params: { undecodedOptions: ['On/Off'] } },
      { name: 'Import Records', params: { undecodedOptions: ['Import mode'] } },
    ]) {
      store.applyDesign([{ op: 'createScript', name: 'Export ' + store.schema.scripts.length, steps: [spec] }]);
      assert.throws(() => designSnippet(store.schema, { scripts: [store.schema.scripts.at(-1)!.id] }), (e: StoreError) => e.code === 960 && /Cannot export.*Specify|Cannot export.*Re-enter/.test(e.message));
    }
  } finally { store.close(); }
});
