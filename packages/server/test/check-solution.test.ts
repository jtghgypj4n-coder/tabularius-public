// checkSolution: deliberately broken synthetic solutions, one finding kind each, and clean ones that report nothing.
// The breakage is made the way a person makes it: delete the thing something else still points at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, createStore, type DesignOp } from '../../store/src/index.ts';
import { checkSolution, checkSolutionText, type FindingKind } from '../src/check-solution.ts';

/** A small invoicing solution that is whole: nothing to report but what nothing uses. */
const BASE: DesignOp[] = [
  { op: 'createTable', name: 'Customers', fields: [{ name: 'Name' }, { name: 'City' }] },
  { op: 'createTable', name: 'Invoices', fields: [{ name: 'Number' }, { name: 'Total', type: 'number' }, { name: 'Customer' }, { name: 'Double', kind: 'calculation', calculation: 'Total * 2' }] },
  { op: 'createRelationship', left: 'Invoices', right: 'Customers', predicates: [{ left: 'Customer', right: 'Name', operator: '=' }] },
  { op: 'createValueList', name: 'Cities', values: ['Paris', 'Lyon'] },
  { op: 'createScript', name: 'Helper', text: 'Set Variable [ $x ; 1 ]' },
  { op: 'createScript', name: 'Main', text: 'Perform Script [ "Helper" ]\nGo to Layout [ "Customers" ]\nSet Field [ Customers::City ; "Paris" ]' },
];

function withSolution(ops: DesignOp[], fn: (s: Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-check-solution-'));
  const file = join(dir, 'App.openhbam.sqlite');
  createStore(file, { mode: 'native' });
  const s = new Store(file, 'App');
  try {
    s.applyDesign([...BASE, ...ops]);
    fn(s);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const kinds = (s: Store, opts?: { account?: string }) => new Set(checkSolution(s, opts).findings.map((f) => f.kind));
/** The kinds a solution reports other than the information the base solution always has (Main, Cities and Helper's callers). */
const problems = (s: Store, opts?: { account?: string }) => checkSolution(s, opts).findings.filter((f) => f.severity !== 'info');

test('a whole solution reports problems of no kind; unused objects are information', () => {
  withSolution([], (s) => {
    const r = checkSolution(s);
    assert.deepEqual(r.findings.filter((f) => f.severity !== 'info'), []);
    assert.deepEqual([...kinds(s)].sort(), ['unused-script', 'unused-value-list']);
    assert.deepEqual(r.counts, { error: 0, warning: 0, info: 2 });
    assert.match(checkSolutionText(r), /Cities.*\n\s+fix:/);
  });
});

test('every finding says where, what, and how to put it right', () => {
  withSolution([{ op: 'deleteScript', script: 'Helper' }, { op: 'deleteField', table: 'Customers', field: 'City' }], (s) => {
    const r = checkSolution(s);
    assert.ok(r.findings.length > 0);
    for (const f of r.findings) {
      assert.ok(f.where && f.message && f.hint, JSON.stringify(f));
      assert.ok(['error', 'warning', 'info'].includes(f.severity));
    }
    // Errors come first.
    const order = r.findings.map((f) => f.severity);
    assert.deepEqual(order, [...order].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  });
});

const broken: [FindingKind, DesignOp[], (s: Store) => void][] = [
  ['missing-script', [{ op: 'deleteScript', script: 'Helper' }], () => {}],
  ['missing-layout', [{ op: 'deleteLayout', layout: 'Customers' }], () => {}],
  ['missing-field', [{ op: 'deleteField', table: 'Customers', field: 'City' }], () => {}],
  ['missing-table-occurrence', [{ op: 'deleteOccurrence', occurrence: 'Customers' }], () => {}],
  ['missing-value-list', [
    { op: 'createLayout', name: 'Pick', occurrence: 'Customers', design: { objects: [{ id: 1, kind: 'field', bounds: { top: 0, left: 0, width: 100, height: 20 }, field: { tableOccurrenceId: 0, fieldId: 0, tableOccurrence: 'Customers', field: 'City', valueList: 'Gone' } } as never] } },
  ], () => {}],
  ['unknown-function', [{ op: 'createField', table: 'Customers', name: 'Odd', kind: 'calculation', calculation: 'Frobnicate ( City )' }], () => {}],
  ['plugin-not-installed', [{ op: 'createScript', name: 'Mail', text: 'Set Variable [ $v ; EmailVersion ]' }], () => {}],
  ['formula-problem', [{ op: 'deleteField', table: 'Invoices', field: 'Total' }], () => {}],
  // Deleting a match field takes its match out of the relationship; a file from FileMaker can still hold an id nothing has.
  ['relationship-no-match-fields', [{ op: 'deleteField', table: 'Customers', field: 'Name' }], () => {}],
  ['relationship-field-missing', [], (s) => { s.schema.relationships[0].predicates[0].rightFieldId = 9999; }],
  ['step-unavailable', [{ op: 'createScript', name: 'Folder', text: 'Get Folder Path [ $path ]' }], () => {}],
  ['step-needs-setup', [{ op: 'createScript', name: 'Notify', text: 'Send Mail [ To: "a@example.test" ; Subject: "Hi" ; Message: "Hello" ]' }], () => {}],
  ['script-lint', [{ op: 'createScript', name: 'Spin', text: 'Loop\n  Set Variable [ $i ; 1 ]\nEnd Loop' }], () => {}],
  ['value-list-source-missing', [{ op: 'createValueList', name: 'FromCities', field: { occurrence: 'Customers', field: 'City' } }, { op: 'deleteField', table: 'Customers', field: 'City' }], () => {}],
];

for (const [kind, ops, setup] of broken) {
  test(`reports ${kind}`, () => {
    withSolution(ops, (s) => {
      setup(s);
      const found = checkSolution(s).findings.filter((f) => f.kind === kind);
      assert.ok(found.length > 0, `no ${kind} finding in ${[...kinds(s)].join(', ')}`);
      const f = found[0];
      assert.ok(f.where && f.hint.length > 10);
      // Only an error stops the check being clean; the kinds written as warnings or information say so.
      assert.equal(f.severity, ({ 'plugin-not-installed': 'warning', 'step-unavailable': 'warning', 'relationship-no-match-fields': 'warning', 'step-needs-setup': 'info', 'script-lint': found[0].severity } as Record<string, string>)[kind] ?? 'error');
    });
  });
}

test('a deleted field is reported once where a layout shows it, not once for its name and again for its id', () => {
  withSolution([{ op: 'deleteField', table: 'Customers', field: 'City' }], (s) => {
    const found = checkSolution(s).findings.filter((f) => f.kind === 'missing-field' && f.where === 'Layout "Customers"');
    assert.equal(found.length, 1, JSON.stringify(found));
  });
});

test('a calculation field is reported by the field, not again by the reference index', () => {
  withSolution([{ op: 'deleteField', table: 'Invoices', field: 'Total' }], (s) => {
    const at = checkSolution(s).findings.filter((f) => f.where.startsWith('Field Invoices::Double'));
    assert.deepEqual(at.map((f) => f.kind), ['formula-problem']);
  });
});

test('a step that is switched off is not checked', () => {
  withSolution([{ op: 'createScript', name: 'Off', text: '// Perform Script [ "Helper" ]\n// Get Folder Path [ $p ]' }, { op: 'deleteScript', script: 'Helper' }], (s) => {
    assert.deepEqual(problems(s).filter((f) => f.where.startsWith('Script "Off"')), []);
  });
});

test('privilege sets and accounts: a set that names what is gone, a set that grants nothing, an account with no set', () => {
  withSolution([], (s) => {
    s.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: true, create: true, delete: false }, layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', scriptAccess: { 'Deleted script': 'none' }, extendedPrivileges: ['fmapp'] });
    s.savePrivilegeSet({ name: 'Nobody', records: { view: false, edit: false, create: false, delete: false }, layouts: 'none', valueLists: 'none', scripts: 'none', extendedPrivileges: ['fmapp'] });
    s.setPassword('pat', 'pw');
    const got = problems(s);
    assert.ok(got.some((f) => f.kind === 'privilege-set-missing-object' && f.where === 'Privilege set "Clerk"' && f.message.includes('Deleted script')), JSON.stringify(got));
    assert.ok(got.some((f) => f.kind === 'privilege-set-grants-nothing' && f.where === 'Privilege set "Nobody"'));
    assert.ok(got.some((f) => f.kind === 'account-no-privilege-set' && f.where === 'Account "pat"'));
    assert.ok(!got.some((f) => f.where === 'Privilege set "[Full Access]"'));
  });
});

test('--account: a button the account may not run, and a layout the file opens on that it may not see', () => {
  withSolution([
    { op: 'setFileOptions', openLayout: 'Invoices' },
    { op: 'createLayout', name: 'Home', occurrence: 'Customers', design: { objects: [{ id: 1, kind: 'button', bounds: { top: 0, left: 0, width: 100, height: 20 }, text: 'Run', action: { stepId: 0, step: 'Perform Script', script: 'Main', scriptId: 0 } } as never] } },
  ], (s) => {
    const main = s.schema.scripts.find((x) => x.name === 'Main')!;
    for (const o of s.designs().layouts.find((l) => l.name === 'Home')!.objects) if (o.action) o.action.scriptId = main.id;
    s.savePrivilegeSet({
      name: 'Guest', records: { view: true, edit: false, create: false, delete: false }, layouts: 'viewOnly', layoutAccess: { Invoices: { layout: 'none', records: 'none' } },
      valueLists: 'viewOnly', scripts: 'viewOnly', scriptAccess: { Main: 'none' }, extendedPrivileges: ['fmapp'],
    });
    s.setPassword('guest', 'pw', 'Guest');
    // Without an account the question is not asked.
    assert.ok(!kinds(s).has('account-cannot-run-script'));
    const got = problems(s, { account: 'guest' });
    assert.ok(got.some((f) => f.kind === 'account-cannot-open-layout' && f.message.includes('Invoices')), JSON.stringify(got));
    assert.ok(got.some((f) => f.kind === 'account-cannot-run-script' && f.where === 'Layout "Home"'), JSON.stringify(got));
    assert.throws(() => checkSolution(s, { account: 'nobody' }), /no account named "nobody"/);
    // Full Access can do both.
    s.setPassword('boss', 'pw', '[Full Access]');
    assert.deepEqual(problems(s, { account: 'boss' }).filter((f) => f.kind.startsWith('account-cannot')), []);
  });
});

test('a calculation the file reader could not read is a warning, not a parse error', () => {
  withSolution([{ op: 'createCustomFunction', name: 'Opaque', parameters: [], formula: '⟨fn:01⟩⟨fn:00⟩"x"' }], (s) => {
    const f = checkSolution(s).findings.filter((x) => x.kind === 'formula-unreadable' || x.kind === 'formula-syntax');
    assert.deepEqual(f.map((x) => [x.kind, x.severity]), [['formula-unreadable', 'warning']]);
  });
});

test('a plug-in function in a field calculation is a warning like it is in a script, not an error', () => {
  withSolution([
    { op: 'createField', table: 'Customers', name: 'Exists', kind: 'calculation', calculation: 'trFile_Exists ( "x" )' },
    { op: 'createField', table: 'Customers', name: 'Mailer', kind: 'calculation', calculation: 'SMTPit_Version' },
    { op: 'createField', table: 'Customers', name: 'Odd', kind: 'calculation', calculation: 'Frobnicate ( City )' },
  ], (s) => {
    const at = (name: string) => checkSolution(s).findings.filter((f) => f.where.startsWith(`Field Customers::${name}`)).map((f) => [f.kind, f.severity]);
    assert.deepEqual(at('Exists'), [['plugin-not-installed', 'warning']]);
    assert.deepEqual(at('Mailer'), [['plugin-not-installed', 'warning']]);
    assert.deepEqual(at('Odd'), [['unknown-function', 'error']], 'a mistyped function is still an error');
  });
});

test('a calculation field the file reader could not read is a warning, not a syntax error', () => {
  withSolution([{ op: 'createField', table: 'Customers', name: 'Opaque', kind: 'calculation', calculation: '⟨fn:01⟩⟨fn:00⟩"x"' }], (s) => {
    const at = checkSolution(s).findings.filter((f) => f.where.startsWith('Field Customers::Opaque')).map((f) => [f.kind, f.severity]);
    assert.deepEqual(at, [['formula-unreadable', 'warning']]);
  });
});

test('a table with no table occurrence has no table to look its bare field names up in, so they are not reported', () => {
  withSolution([
    { op: 'createTable', name: 'Orphan', fields: [{ name: 'A' }, { name: 'B', kind: 'calculation', calculation: 'A & "x"' }] },
    { op: 'deleteOccurrence', occurrence: 'Orphan' },
  ], (s) => {
    assert.deepEqual(checkSolution(s).findings.filter((f) => f.where.startsWith('Field Orphan::B')), []);
  });
});

test('one missing table occurrence is reported once for each place that uses it, not once for its name and again for its id', () => {
  withSolution([
    { op: 'createOccurrence', name: 'Cust2', table: 'Customers' },
    { op: 'createRelationship', left: 'Invoices', right: 'Cust2', predicates: [{ left: 'Customer', right: 'Name', operator: '=' }] },
  ], (s) => {
    const to = s.schema.tableOccurrences.find((t) => t.name === 'Cust2')!;
    const city = s.schema.tables.find((t) => t.name === 'Customers')!.fields.find((f) => f.name === 'City')!;
    s.applyDesign([{ op: 'createLayout', name: 'L', occurrence: 'Customers', design: { objects: [
      { id: 1, name: 'cityobj', kind: 'field', bounds: { top: 0, left: 0, width: 100, height: 20 }, field: { tableOccurrenceId: to.id, tableOccurrence: 'Cust2', fieldId: city.id, field: 'City' } },
      { id: 2, name: 'por', kind: 'portal', bounds: { top: 30, left: 0, width: 100, height: 60 }, portal: { tableOccurrenceId: to.id, tableOccurrence: 'Cust2' } },
    ] } } as never]);
    s.designs();
    s.schema.tableOccurrences = s.schema.tableOccurrences.filter((t) => t.name !== 'Cust2');
    const found = checkSolution(s).findings.filter((f) => f.kind === 'missing-table-occurrence');
    assert.deepEqual(found.map((f) => f.where).sort(), ['Layout "L", object "cityobj"', 'Layout "L", object "por"', 'Relationship Invoices → Cust2'], JSON.stringify(found));
  });
});

test('an account that is turned off is not reported for having no privilege set, and cannot be checked as if it were on', () => {
  withSolution([], (s) => {
    s.setPassword('old', 'pw');
    assert.ok(problems(s).some((f) => f.where === 'Account "old"'), 'on, it has no privilege set');
    s.sql.prepare("UPDATE _fm_accounts SET inactive = 1 WHERE name = 'old'").run();
    assert.ok(!problems(s).some((f) => f.where === 'Account "old"'), JSON.stringify(problems(s)));
    assert.throws(() => checkSolution(s, { account: 'old' }), /"old" is turned off/);
  });
});
