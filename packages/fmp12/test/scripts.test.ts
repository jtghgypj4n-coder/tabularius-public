import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, scriptText } from '../src/index.ts';
import type { ScriptStep } from '../src/index.ts';

const dir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12');
const flicks = join(dir, 'Flicks.fmp12');
const ddr = join(dir, 'Flicks_ddr.xml');
const charts = join(dir, 'Charts.fmp12');
const skip = existsSync(flicks) && existsSync(ddr) ? false : 'fixtures missing: run npm run fixtures';
const skipCharts = existsSync(charts) ? false : 'fixtures missing: run npm run fixtures';

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const attr = (xml: string, tag: string, name: string) => {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`).exec(xml);
  return m ? unescape(m[1]) : undefined;
};

// Flicks ships with FileMaker's own Database Design Report: every step's
// targets and options must decode to what FileMaker reports.
test('script steps: Flicks parameters match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr)).replace(/\r\n?/g, '\n');
  const schema = FmpDatabase.open(flicks).schema;
  const byId = new Map(schema.scripts.map((s) => [s.id, s]));
  const counts = new Map<string, number>();
  const check = (what: string, got: unknown, want: unknown, where: string) => {
    if (want === undefined) return;
    assert.deepEqual(got, want, `${where}: ${what}`);
    counts.set(what, (counts.get(what) ?? 0) + 1);
  };
  let scripts = 0;
  for (const m of xml.matchAll(/<Script [^>]*?id="(\d+)"[^>]*>\s*<StepList>([\s\S]*?)<\/StepList>/g)) {
    const script = byId.get(+m[1]);
    if (!script) continue;
    const steps = [...m[2].matchAll(/<Step [^>]*>[\s\S]*?<\/Step>/g)].map((s) =>
      s[0].replace(/<DisplayCalculation>[\s\S]*?<\/DisplayCalculation>/g, ''));
    // The report predates a few edits to the file: skip scripts whose steps changed since.
    const ids = steps.map((x) => +attr(x, 'Step', 'id')!).join();
    if (ids !== script.steps.map((s) => s.stepId).join()) continue;
    scripts++;
    steps.forEach((x, i) => {
      const step: ScriptStep = script.steps[i];
      const p = step.params ?? {};
      const where = `${script.name} #${i + 1} ${step.name}`;
      check('id', step.stepId, +attr(x, 'Step', 'id')!, where);
      check('enabled', step.enabled, attr(x, 'Step', 'enable') === 'True', where);
      const body = x.replace(/^<Step [^>]*>/, '');
      if (step.name === 'Perform Script') check('script', p.script?.name, attr(body, 'Script', 'name'), where);
      if (/^Go to Layout/.test(step.name) && /SelectedLayout/.test(body)) check('layout', p.layout?.name, attr(body, 'Layout', 'name'), where);
      const name = /<Name>([\s\S]*?)<\/Name>/.exec(body);
      if (step.name === 'Set Variable' && name) check('variable', p.variable, unescape(name[1]), where);
      if (/^Set (Error Capture|Allow User Abort)/.test(step.name)) check('on', p.on, attr(body, 'Set', 'state') === 'True', where);
      const noInteract = attr(body, 'NoInteract', 'state');
      if (noInteract && p.noDialog !== undefined) check('noDialog', p.noDialog, noInteract === 'True', where);
      const location = attr(body, 'RowPageLocation', 'value');
      if (location && location !== 'ByCalculation') check('location', p.location, location.toLowerCase(), where);
      const restore = attr(body, 'Restore', 'state');
      if (restore && /^(Sort Records|Perform Find)/.test(step.name)) check('restore', !!p.restore, restore === 'True', where);
      if (step.name === 'Set Field' && /<Field /.test(body)) {
        check('field', p.field && `${p.field.tableOccurrence.name}::${p.field.field.name}`,
          `${attr(body, 'Field', 'table')}::${attr(body, 'Field', 'name')}`, where);
      }
      if (step.name === 'Sort Records' && /<SortList/.test(body)) {
        const want = [...body.matchAll(/<Sort type="(\w+)">\s*<PrimaryField>\s*<Field table="([^"]*)" id="\d+" name="([^"]*)"/g)]
          .map((s) => `${s[2]}::${s[3]} ${s[1].toLowerCase()}`);
        check('sort', (p.sort ?? []).map((s) => `${s.field.tableOccurrence.name}::${s.field.field.name} ${s.order}`), want, where);
      }
      if (/^(If|Else If|Exit Loop If|Exit Script)$/.test(step.name)) {
        const calc = /<Calculation><!\[CDATA\[([\s\S]*?)\]\]><\/Calculation>/.exec(body);
        if (calc) check('calculation', p.calculation, calc[1], where);
      }
    });
  }
  assert.ok(scripts >= 8, `checked ${scripts} scripts`);
  for (const what of ['script', 'layout', 'variable', 'field', 'sort', 'calculation']) {
    assert.ok((counts.get(what) ?? 0) > 0, `no ${what} checked`);
  }
});

test('script text: Charts finds and sorts read like FileMaker', { skip: skipCharts }, () => {
  const schema = FmpDatabase.open(charts).schema;
  const text = (name: string) => scriptText(schema.scripts.find((s) => s.name === name)!.steps);
  assert.equal(text('Show Senate'), [
    'Perform Find [ Restore; Find: Congress::Chamber: “Senate” ]',
    'Sort Records [ Restore; Congress::Liberal_Rank; ascending; Congress::Name; ascending ; With dialog: Off ]',
  ].join('\n'));
  const house = schema.scripts.find((s) => s.name === 'Show House')!.steps;
  assert.deepEqual(house[0].params?.requests, [{
    omit: false,
    criteria: [{ field: { tableOccurrence: { id: house[0].params!.requests![0].criteria[0].field.tableOccurrence.id, name: 'Congress' },
      field: { id: house[0].params!.requests![0].criteria[0].field.field.id, name: 'Chamber' } }, criteria: 'House' }],
  }]);
  assert.deepEqual(house[1].params, { variable: '$sort', value: 'Get (ScriptParameter)' });
});

// "Include in menu" (key 240 bit 3) for layouts and scripts, against the
// Design Report: only the SOLUTION layout is left out of the menus.
test('include in menu: Flicks layouts and scripts match the Design Report', { skip }, () => {
  const xml = new TextDecoder('utf-16le').decode(readFileSync(ddr));
  const schema = FmpDatabase.open(flicks).schema;
  let checked = 0;
  for (const [order, tag] of [[schema.layoutOrder, 'Layout'], [schema.scriptOrder, 'Script']] as const) {
    for (const m of xml.matchAll(new RegExp(`<${tag} [^>]*includeInMenu="(True|False)"[^>]*\\bid="(\\d+)"`, 'g'))) {
      const item = order.find((o) => (o.kind === 'item' || o.kind === 'unknown') && o.id === +m[2]);
      assert.ok(item, `${tag} ${m[2]} is in the order`);
      assert.equal(!item.hidden, m[1] === 'True', `${tag} ${item.name}`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `checked ${checked}`);
  assert.deepEqual(schema.layoutOrder.filter((o) => o.hidden).map((o) => o.name), ['SOLUTION']);
});

const drawers = join(dir, 'DEMO_drawers.fmp12');
test('script steps: View As and Set Zoom Level read their options', { skip: existsSync(drawers) ? false : 'fixtures missing: run npm run fixtures' }, () => {
  const lines = FmpDatabase.open(drawers).schema.scripts.flatMap((s) => s.steps).filter((s) => s.stepId === 30 || s.stepId === 97).map((s) => s.line);
  assert.ok(lines.includes('View As [ View as Form ]'), lines.join('\n'));
  assert.ok(lines.includes('Set Zoom Level [ 100% ]'), lines.join('\n'));
});
