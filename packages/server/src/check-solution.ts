// A whole-solution check, read-only: everything a solution points at that is not there, and the steps and functions
// this build does not run. It is built from what the repo already knows about a solution (the reference index in
// insight.ts, the script linter, the security health report); nothing runs and nothing is written.
//
// Each finding has a severity (error: it fails when used; warning: it runs but does not do what it looks like, or can
// not be reached; info: tidying), where it is (table, layout, script, line), what is wrong and one line on how to fix it.

import { FUNCTIONS, pluginNotInstalled } from '../../calc/src/functions.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import { lintScript, isFullAccess, type Store } from '../../store/src/index.ts';
import { ERROR_3_STEPS, ERROR_3_UNLESS_CONFIGURED } from '../../scripts/src/unavailable-steps.ts';
import { checkFormula, didYouMean, solutionIndex, unhostedFileOf, type Site } from './insight.ts';

export type Severity = 'error' | 'warning' | 'info';

export type FindingKind =
  | 'formula-syntax' | 'formula-unreadable' | 'formula-problem' | 'unknown-function' | 'plugin-not-installed'
  | 'missing-table-occurrence' | 'missing-field' | 'missing-script' | 'missing-layout' | 'missing-value-list'
  | 'layout-table-missing' | 'relationship-field-missing' | 'relationship-no-match-fields' | 'value-list-source-missing'
  | 'script-lint' | 'step-unavailable' | 'step-needs-setup'
  | 'privilege-set-missing-object' | 'privilege-set-grants-nothing' | 'account-no-privilege-set'
  | 'account-cannot-run-script' | 'account-cannot-open-layout'
  | 'unused-script' | 'unused-value-list' | 'unused-custom-function';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** Where a person finds it: "Script "New Invoice", line 4", "Layout "Invoices", object "Total"". */
  where: string;
  message: string;
  /** One line on how to put it right. */
  hint: string;
}

export interface SolutionCheck {
  database: string;
  /** Set when the check was made for one account's view of the solution. */
  account?: string;
  counts: Record<Severity, number>;
  findings: Finding[];
}

const lower = (s: string) => s.toLowerCase();
const quoted = (s: string) => `"${s}"`;
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
/** Names a step may give for the layout it is on rather than a layout of that name. */
const SPECIAL_LAYOUTS = /^<?(original layout|current layout)>?$/i;

export function checkSolution(store: Store, opts: { account?: string } = {}): SolutionCheck {
  const s = store.schema;
  const index = solutionIndex(store);
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding, subject = '') => {
    const key = `${f.kind}|${f.where}|${lower(subject || f.message)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };

  const occurrences = new Set(s.tableOccurrences.map((t) => lower(t.name)));
  const scripts = new Map(s.scripts.map((x) => [lower(x.name), x.name]));
  const layouts = new Set(s.layouts.map((l) => lower(l.name)));
  const valueLists = new Set(s.valueLists.map((v) => lower(v.name)));
  const customFunctions = new Set(s.customFunctions.map((c) => lower(c.name)));
  const usedValueLists = new Set<string>();
  const usedFunctions = new Set<string>();

  // Fields' own calculations are checked where the table they are evaluated from is known; the same place is not reported twice.
  const formulaWheres = new Set<string>();
  // --- formulas of fields, where the table they are evaluated from is known --------------------------------------
  for (const table of s.tables) {
    const home = s.tableOccurrences.find((t) => !t.dataSourceId && t.baseTableId === table.id)?.id;
    for (const f of table.fields) {
      const ctx = f.calculationContextId ?? home;
      const formulas: [string, string | undefined][] = [
        [f.kind === 'calculation' ? 'calculation' : 'auto-enter', f.calculation], ['validation', f.options?.validation?.calculation],
      ];
      for (const [what, formula] of formulas) {
        if (!formula) continue;
        const where = `Field ${table.name}::${f.name} (${what})`;
        formulaWheres.add(where);
        const c = checkFormula(store, ctx, formula);
        if (c.error) {
          // ⟨fn:..⟩ marks a function the file reader could not name: the calculation may be fine in the file.
          if (formula.includes('⟨fn:')) add(unreadable(where));
          else add({ kind: 'formula-syntax', severity: 'error', where, message: `The calculation does not parse: ${c.error.message}`, hint: 'Open the field in Manage Database and correct the calculation.' });
          continue;
        }
        for (const p of c.problems) {
          // A table with no occurrence of its own has nothing to look a bare field name up in.
          if (ctx === undefined && /^(.* has no field named|".*" is not a field of )/.test(p)) continue;
          const fn = /^There is no function named "([^"]+)"/.exec(p)?.[1] ?? (/^"([^"]+)" is not a field of /.exec(p)?.[1]);
          const named = fn && (p.startsWith('There is no function') || pluginNotInstalled(fn) || store.plugin(lower(fn)));
          if (named) unknownFunction(store, customFunctions, lower(fn), where, add);
          else add({ kind: 'formula-problem', severity: 'error', where, message: p, hint: 'Correct the name or the number of parameters in the calculation.' });
        }
      }
    }
  }

  // --- what every place in the solution points at -------------------------------------------------------------
  for (const site of index.sites) {
    // A script step that is switched off runs nowhere.
    if (site.kind === 'script' && site.text.startsWith('// ')) continue;
    if (site.kind === 'field' && formulaWheres.has(site.where)) {
      for (const v of site.refs.valueLists) usedValueLists.add(v);
      for (const fn of site.refs.functions) usedFunctions.add(fn);
      continue;
    }
    for (const v of site.refs.valueLists) usedValueLists.add(v);
    for (const fn of site.refs.functions) usedFunctions.add(fn);
    siteFindings(store, site, { occurrences, scripts, layouts, valueLists, customFunctions }, add);
  }

  // --- scripts ------------------------------------------------------------------------------------------------
  for (const script of s.scripts) {
    script.steps.forEach((step, i) => {
      if (!step.enabled) return;
      const where = `Script ${quoted(script.name)}, line ${i + 1}`;
      if (ERROR_3_STEPS.has(step.name)) {
        add({ kind: 'step-unavailable', severity: 'warning', where, message: `${step.name} is not available in this build: it gives error 3 and the script goes on to the next step.`, hint: 'Replace the step, or handle Get ( LastError ) = 3 after it (see docs/script-steps-support.md).' });
      } else if (step.name === 'Show Custom Dialog') {
        add({ kind: 'step-needs-setup', severity: 'info', where, message: 'Show Custom Dialog gives error 3 when the script runs without a person to answer (a schedule, Perform Script on Server, the Data API, a command-line run).', hint: 'Ask the question in a script a person runs, and pass the answer on as the script parameter (docs/script-steps-support.md).' });
      } else if (ERROR_3_UNLESS_CONFIGURED.has(step.name)) {
        add({ kind: 'step-needs-setup', severity: 'info', where, message: `${step.name} gives error 3 unless the server is set up for it.`, hint: 'Check the server options for it (docs/script-steps-support.md), or handle error 3 after the step.' });
      }
    });
    let issues: ReturnType<typeof lintScript> = [];
    try {
      issues = lintScript({ steps: script.steps }, s);
    } catch {
      // A script the linter cannot read gets no lint findings, the other checks still apply.
    }
    for (const issue of issues) {
      add({ kind: 'script-lint', severity: issue.severity, where: `Script ${quoted(script.name)}, line ${issue.line}`, message: issue.message, hint: issue.fix });
    }
  }

  // --- layouts ------------------------------------------------------------------------------------------------
  for (const design of store.designs().layouts) {
    if (design.tableOccurrenceId !== undefined && !s.tableOccurrences.some((t) => t.id === design.tableOccurrenceId)) {
      add({ kind: 'layout-table-missing', severity: 'error', where: `Layout ${quoted(design.name)}`, message: 'The layout shows a table occurrence that no longer exists.', hint: 'Open Layout Setup and choose the table occurrence it shows.' });
    }
    layoutObjects(store, design.name, design.objects, add);
    for (const col of design.tableView ?? []) fieldRefFinding(store, `Layout ${quoted(design.name)}, table view`, col.field, add);
  }

  // --- relationships ------------------------------------------------------------------------------------------
  for (const r of s.relationships) {
    const left = r.leftTableOccurrence ?? s.tableOccurrences.find((t) => t.id === r.leftTableOccurrenceId)?.name ?? `⟨occurrence ${r.leftTableOccurrenceId}⟩`;
    const right = r.rightTableOccurrence ?? s.tableOccurrences.find((t) => t.id === r.rightTableOccurrenceId)?.name ?? `⟨occurrence ${r.rightTableOccurrenceId}⟩`;
    const where = `Relationship ${left} → ${right}`;
    for (const [toId, name] of [[r.leftTableOccurrenceId, left], [r.rightTableOccurrenceId, right]] as const) {
      if (!s.tableOccurrences.some((t) => t.id === toId)) add({ kind: 'missing-table-occurrence', severity: 'error', where, message: `The relationship joins ${quoted(name)}, which is not a table occurrence of this file.`, hint: 'Open the relationship graph and delete the relationship or join it to a table occurrence that exists.' }, name);
    }
    if (!r.predicates.length) {
      add({ kind: 'relationship-no-match-fields', severity: 'warning', where, message: 'The relationship has no match fields, so every record of one side is related to every record of the other.', hint: 'Open the relationship and add the match fields (a field that went missing takes its match with it), or delete it.' });
    }
    for (const p of r.predicates) {
      for (const [toId, fieldId, shown, side] of [[r.leftTableOccurrenceId, p.leftFieldId, p.leftField, left], [r.rightTableOccurrenceId, p.rightFieldId, p.rightField, right]] as const) {
        const t = store.calc.occurrenceTable(toId);
        // A table of a file that is not hosted here has no fields to look at.
        if (!t || !s.tableOccurrences.some((x) => x.id === toId)) continue;
        if (!t.table.fields.some((f) => f.id === fieldId)) {
          add({ kind: 'relationship-field-missing', severity: 'error', where, message: `The match field ${shown ? `${quoted(shown)} ` : ''}(id ${fieldId}) of ${side} is not a field of ${t.table.name}.`, hint: 'Open the relationship and pick the match field again, or delete the relationship.' }, `${side}:${fieldId}`);
        }
      }
    }
  }

  // --- value lists --------------------------------------------------------------------------------------------
  for (const vl of s.valueLists) {
    const where = `Value list ${quoted(vl.name)}`;
    if (vl.field) {
      const t = store.calc.occurrenceTable(vl.field.occurrenceId);
      const to = s.tableOccurrences.find((x) => x.id === vl.field!.occurrenceId);
      if (!to) add({ kind: 'value-list-source-missing', severity: 'error', where, message: 'The values come from a table occurrence that no longer exists.', hint: 'Edit the value list and choose the field its values come from.' });
      else if (t && !t.table.fields.some((f) => f.id === vl.field!.fieldId)) add({ kind: 'value-list-source-missing', severity: 'error', where, message: `The values come from a field of ${to.name} that no longer exists.`, hint: 'Edit the value list and choose the field its values come from.' });
      else if (t && vl.field.secondFieldId !== undefined && !t.table.fields.some((f) => f.id === vl.field!.secondFieldId)) add({ kind: 'value-list-source-missing', severity: 'error', where, message: `The second field of the list is a field of ${to.name} that no longer exists.`, hint: 'Edit the value list and choose the second field again, or show only the first.' });
    } else if (vl.external && !s.dataSources.some((d) => d.id === vl.external!.dataSourceId)) {
      add({ kind: 'value-list-source-missing', severity: 'error', where, message: 'The list is taken from another file through a data source that no longer exists.', hint: 'Add the data source again in Manage External Data Sources, or give the list its own values.' });
    } else if (!vl.values?.length && !vl.field && !vl.external) {
      add({ kind: 'value-list-source-missing', severity: 'warning', where, message: 'The list has no values and no field to take them from.', hint: 'Add values to the list, or choose a field.' });
    }
  }

  // --- privilege sets and accounts ---------------------------------------------------------------------------
  const sets = store.privilegeSets();
  for (const o of store.orphanedAccessKeys()) {
    const parts = [
      o.layouts.length ? `layouts ${o.layouts.map(quoted).join(', ')}` : '', o.scripts.length ? `scripts ${o.scripts.map(quoted).join(', ')}` : '',
      o.valueLists.length ? `value lists ${o.valueLists.map(quoted).join(', ')}` : '', o.tables.length ? `tables ${o.tables.map(quoted).join(', ')}` : '',
      ...o.fields.map((f) => `fields ${f.fields.map(quoted).join(', ')} of ${f.table}`),
    ].filter(Boolean);
    add({ kind: 'privilege-set-missing-object', severity: 'warning', where: `Privilege set ${quoted(o.set)}`, message: `It names ${parts.join('; ')}, which do not exist (renamed or deleted).`, hint: 'Edit the privilege set and set access for the objects as they are now named.' });
  }
  for (const set of sets) {
    if (isFullAccess(set)) continue;
    const anyRecords = set.records.view !== false || Object.values(set.tables ?? {}).some((t) => t.view !== false);
    if (!anyRecords) add({ kind: 'privilege-set-grants-nothing', severity: 'warning', where: `Privilege set ${quoted(set.name)}`, message: 'It lets no one view records in any table.', hint: 'Give it record access, or delete the set if nothing uses it.' });
  }
  for (const a of store.accounts()) {
    if (a.external || a.agent || a.inactive) continue;
    if (!a.privilegeSet) add({ kind: 'account-no-privilege-set', severity: 'warning', where: `Account ${quoted(a.name)}`, message: 'The account has no privilege set, so it can do nothing.', hint: 'Assign a privilege set to the account.' });
  }

  // --- what one account would meet ---------------------------------------------------------------------------
  if (opts.account) {
    const account = store.accounts().find((a) => lower(a.name) === lower(opts.account!));
    if (!account) throw new Error(`There is no account named "${opts.account}"`);
    if (account.inactive) throw new Error(`The account "${account.name}" is turned off, so it can reach nothing`);
    const privileges = store.privileges(account.name);
    if (!privileges.full) {
      for (const [script, ons] of index.buttons) {
        const name = scripts.get(script);
        if (!name || privileges.script(name) !== 'none') continue;
        for (const layout of ons) {
          if (privileges.layout(layout).layout === 'none') continue;
          add({ kind: 'account-cannot-run-script', severity: 'warning', where: `Layout ${quoted(layout)}`, message: `A button runs the script ${quoted(name)}, which ${account.name} may not run.`, hint: `Give "${privileges.name}" the right to run ${quoted(name)}, or hide the button from it.` }, `${layout}:${name}`);
        }
      }
      const open = s.fileOptions?.openLayout ?? s.layouts.find((l) => l.id === s.fileOptions?.openLayoutId)?.name;
      if (open && privileges.layout(open).layout === 'none') {
        add({ kind: 'account-cannot-open-layout', severity: 'error', where: 'File Options', message: `The file opens on the layout ${quoted(open)}, which ${account.name} may not see.`, hint: `Give "${privileges.name}" access to ${quoted(open)}, or open on a layout every account may see.` });
      }
    }
  }

  // --- things nothing uses (information only) ----------------------------------------------------------------
  for (const script of s.scripts) {
    const key = lower(script.name);
    if (index.callers.has(key) || index.buttons.has(key) || index.starters.has(key)) continue;
    add({ kind: 'unused-script', severity: 'info', where: `Script ${quoted(script.name)}`, message: 'No script, button, trigger or menu runs it (it may still be run through the Data API, a schedule or by hand).', hint: 'Delete it if it is not needed.' });
  }
  for (const vl of s.valueLists) {
    if (usedValueLists.has(lower(vl.name))) continue;
    add({ kind: 'unused-value-list', severity: 'info', where: `Value list ${quoted(vl.name)}`, message: 'No field or layout object uses it.', hint: 'Delete it if it is not needed.' });
  }
  for (const cf of s.customFunctions) {
    if (usedFunctions.has(lower(cf.name))) continue;
    add({ kind: 'unused-custom-function', severity: 'info', where: `Custom function ${cf.name}`, message: 'No calculation calls it.', hint: 'Delete it if it is not needed.' });
  }

  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of out) counts[f.severity]++;
  return { database: store.name, ...(opts.account ? { account: opts.account } : {}), counts, findings: out };
}

/** The references one place in the solution makes, looked up. */
function siteFindings(
  store: Store, site: Site,
  known: { occurrences: Set<string>; scripts: Map<string, string>; layouts: Set<string>; valueLists: Set<string>; customFunctions: Set<string> },
  add: (f: Finding, subject?: string) => void,
): void {
  const s = store.schema;
  const { refs, where } = site;
  const names = <T,>(set: Iterable<T>) => [...set] as T[];
  if (refs.unparsed) {
    // ⟨fn:..⟩ marks a function the file reader could not name: the calculation may be fine in the file.
    if (site.text.includes('⟨fn:')) add(unreadable(where));
    else add({ kind: 'formula-syntax', severity: 'error', where, message: `The calculation does not parse: ${refs.unparsed}`, hint: 'Correct the calculation; Check in the script or layout editor shows where.' });
  }
  for (const to of names(refs.occurrences)) {
    if (known.occurrences.has(to)) continue;
    add({ kind: 'missing-table-occurrence', severity: 'error', where, message: `There is no table occurrence named ${quoted(to)}${didYouMean(to, s.tableOccurrences.map((t) => t.name))}.`, hint: 'Correct the name, or add the table occurrence to the relationship graph.' }, to);
  }
  for (const key of names(refs.fields)) {
    const [table, field] = key.split('::');
    if (!table || !field || table.includes('/')) continue;
    const t = s.tables.find((x) => x.name === table);
    if (!t || t.fields.some((f) => lower(f.name) === lower(field))) continue;
    add({ kind: 'missing-field', severity: 'error', where, message: `${table} has no field named ${quoted(field)}${didYouMean(field, t.fields.map((f) => f.name))}.`, hint: 'Correct the field name, or add the field to the table.' }, `${table}::${field}`);
  }
  for (const sc of names(refs.scripts)) {
    if (known.scripts.has(sc)) continue;
    add({ kind: 'missing-script', severity: 'error', where, message: `There is no script named ${quoted(sc)}${didYouMean(sc, [...known.scripts.values()])}.`, hint: 'Point the step at a script that exists, or add the script.' }, sc);
  }
  for (const l of names(refs.layouts)) {
    if (known.layouts.has(l) || SPECIAL_LAYOUTS.test(l)) continue;
    add({ kind: 'missing-layout', severity: 'error', where, message: `There is no layout named ${quoted(l)}${didYouMean(l, s.layouts.map((x) => x.name))}.`, hint: 'Point it at a layout that exists, or add the layout.' }, l);
  }
  for (const v of names(refs.valueLists)) {
    if (known.valueLists.has(v)) continue;
    add({ kind: 'missing-value-list', severity: 'error', where, message: `There is no value list named ${quoted(v)}${didYouMean(v, s.valueLists.map((x) => x.name))}.`, hint: 'Choose a value list that exists, or add it in Manage Value Lists.' }, v);
  }
  // A function called but not built in, not one of the file's own: a plug-in's, or a mistake.
  if (!refs.unparsed) for (const fn of names(refs.functions)) unknownFunction(store, known.customFunctions, fn, where, add);
}

const unreadable = (where: string): Finding => ({ kind: 'formula-unreadable', severity: 'warning', where, message: 'Part of this calculation could not be read from the FileMaker file, so it is not checked or run correctly here.', hint: 'Rewrite that part of the calculation in Tabularius, or check it in FileMaker Pro against the original file.' });

/** A function (lowercased) that is not built in or one of the file's own: a plug-in's, installed here or not, or a mistake. */
function unknownFunction(store: Store, customFunctions: Set<string>, fn: string, where: string, add: (f: Finding, subject?: string) => void): void {
  if (FUNCTIONS.has(fn) || customFunctions.has(fn) || store.plugin(fn)) return;
  if (pluginNotInstalled(fn)) {
    add({ kind: 'plugin-not-installed', severity: 'warning', where, message: `${fn} is a plug-in function with no version in this build: it gives "?".`, hint: 'Test for "?" from the function and take another way, or use a Tabularius plug-in that provides it (docs/plugin-compatibility.md).' }, fn);
  } else {
    add({ kind: 'unknown-function', severity: 'error', where, message: `There is no function named ${quoted(fn)} (built-in, custom or plug-in)${didYouMean(fn, [...FUNCTIONS.keys(), ...customFunctions])}.`, hint: 'Correct the function name, or add a custom function of that name.' }, fn);
  }
}

/** Layout objects, checked by the ids they store (a name alone can be stale). */
function layoutObjects(store: Store, layout: string, objects: LayoutObject[], add: (f: Finding, subject?: string) => void): void {
  for (const o of objects) {
    const where = `Layout ${quoted(layout)}${o.name ? `, object ${quoted(o.name)}` : ''}`;
    if (o.field) fieldRefFinding(store, where, o.field, add);
    if (o.portal?.tableOccurrenceId !== undefined && !store.schema.tableOccurrences.some((t) => t.id === o.portal!.tableOccurrenceId)) {
      add({ kind: 'missing-table-occurrence', severity: 'error', where, message: 'The portal shows a table occurrence that no longer exists.', hint: 'Open Portal Setup and choose the table occurrence it shows.' }, o.portal.tableOccurrence ?? `occurrence ${o.portal.tableOccurrenceId}`);
    }
    if (o.children?.length) layoutObjects(store, layout, o.children, add);
  }
}

/** A layout field reference, looked up by id; the finding reads the same as a name lookup would, so the two are one. */
function fieldRefFinding(store: Store, where: string, ref: { tableOccurrenceId: number; fieldId: number; tableOccurrence?: string; field?: string }, add: (f: Finding, subject?: string) => void): void {
  const s = store.schema;
  const to = s.tableOccurrences.find((t) => t.id === ref.tableOccurrenceId);
  if (!to) {
    add({ kind: 'missing-table-occurrence', severity: 'error', where, message: `The field ${quoted(ref.field ?? `id ${ref.fieldId}`)} belongs to a table occurrence that no longer exists.`, hint: 'Delete the object or choose a field that exists.' }, ref.tableOccurrence ?? `occurrence ${ref.tableOccurrenceId}`);
    return;
  }
  if (unhostedFileOf(store, to.name)) return;
  const t = store.calc.occurrenceTable(to.id);
  if (!t || t.table.fields.some((f) => f.id === ref.fieldId)) return;
  const subject = `${t.table.name}::${ref.field ?? `⟨field id ${ref.fieldId}⟩`}`;
  add({ kind: 'missing-field', severity: 'error', where, message: `${t.table.name} has no field ${ref.field ? quoted(ref.field) : `with id ${ref.fieldId}`}.`, hint: 'Choose a field that exists for the object, or delete the object.' }, subject);
}

/** The check as text: findings by severity, each with where, what and how to fix it, then the totals. */
export function checkSolutionText(r: SolutionCheck): string {
  const lines: string[] = [];
  for (const f of r.findings) lines.push(`${f.severity.padEnd(7)} ${f.where}: ${f.message}`, `        fix: ${f.hint}`);
  const n = (k: Severity) => `${r.counts[k]} ${k === 'info' ? 'to tidy' : k === 'error' ? (r.counts[k] === 1 ? 'error' : 'errors') : (r.counts[k] === 1 ? 'warning' : 'warnings')}`;
  lines.push(r.findings.length ? `${r.database}${r.account ? ` as ${r.account}` : ''}: ${n('error')}, ${n('warning')}, ${n('info')}` : `${r.database}${r.account ? ` as ${r.account}` : ''}: nothing found`);
  return lines.join('\n') + '\n';
}
