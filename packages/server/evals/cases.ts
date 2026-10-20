// The eval cases: a question for each AI tool on the public sample files (Charts, and Flicks for finds on a
// differently built file), and how its answer is graded. Graders
// check against the data, not against the fixture's wording, so a live model that phrases a find, a formula or a
// script differently still passes when the result is right.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Assistant, ChatContext } from '../src/assistant.ts';
import { changeImpact } from '../src/change-impact.ts';
import type { Host } from '../src/host.ts';
import { suggestRules } from '../src/rule-suggestions.ts';
import { checkScript } from '../src/script-check.ts';
import { Store, type FindRequest } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

export type ChatOut = Awaited<ReturnType<Assistant['chat']>>;
export interface Check { name: string; pass: boolean; detail?: string }
export interface GradeInput {
  store: Store;
  out: ChatOut;
  calls: { name: string; input: Record<string, unknown> }[];
  host: Host;
  /** Each model call: the model and the input it sent (a rough count). */
  sent: { model: string; inputTokens: number }[];
  /** Live runs: how long the answer took, and the tokens the API counted. */
  live?: { ms: number; tokens: number };
  /** Every request as sent to the model (system prompt, tools, messages), for checks on what it was shown. */
  requests: string[];
  /** What a case with `run` got back besides its text (a solution plan). */
  result?: unknown;
}

export interface EvalCase {
  id: string;
  /** The sample file it asks about (fixtures/fmp12/<file>.fmp12); Charts when left out. */
  file?: string;
  area: 'cost' | 'find' | 'formula' | 'script' | 'impact' | 'rules' | 'record' | 'build' | 'handover';
  /** What the person types. */
  ask: string;
  /** Where they are in the web client when they ask. */
  context: (store: Store) => ChatContext;
  grade: (g: GradeInput) => Check[] | Promise<Check[]>;
  /** For what isn't a chat question (a plan for a new solution, a handover memo): calls it, and gives its text as the reply. */
  run?: (assistant: Assistant, store: Store) => Promise<{ reply: string; result?: unknown }>;
}

const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, ...(pass || !detail ? {} : { detail }) });
const congressTo = (store: Store) => store.schema.tableOccurrences.find((t) => t.name === 'Congress')!.id;
const ids = (store: Store, where: string, table = 'Congress') =>
  store.query(`SELECT _fm_record_id AS id FROM "${table}" WHERE ${where}`, 10_000).map((r) => Number(r.id)).sort((a, b) => a - b);
const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const describeDiff = (got: number[], want: number[]) => {
  const extra = got.filter((x) => !want.includes(x)).length;
  const missing = want.filter((x) => !got.includes(x)).length;
  return `found ${got.length}, want ${want.length} (${extra} extra, ${missing} missing)`;
};
/** Words in a reply, for "does the answer mention X" without minding case or quotes. */
const mentions = (reply: string, name: string) => reply.toLowerCase().includes(name.toLowerCase());

/** Things the file gets before the cases run, so impact checks have something that breaks. */
export const SCRIPT_BY_NAME = 'Count Democrats';
export const PRIVILEGE_SET = 'Party Desk';
export function setUp(store: Store): void {
  store.applyDesign([{ op: 'createScript', name: SCRIPT_BY_NAME, text:
    'Set Variable [ $count ; Value: ExecuteSQL ( "SELECT COUNT(*) FROM Congress WHERE Party = \'D\'" ; "" ; "" ) ]\nShow Custom Dialog [ "Democrats" ; $count ]' }],
  { account: 'evals' });
  store.savePrivilegeSet({
    name: PRIVILEGE_SET,
    records: { view: false, edit: false, create: false, delete: false },
    tables: { Congress: { view: 'Party = "D"', edit: false, create: false, delete: false, fields: { Party: 'viewOnly' } } },
    layouts: 'viewOnly', valueLists: 'viewOnly', scripts: 'viewOnly', extendedPrivileges: ['fmrest'],
  });
  // A stored calculation left out of date on one record, as an import that skipped recalculation leaves it.
  store.applyDesign([{ op: 'createField', table: 'Congress', name: STALE_FIELD, kind: 'calculation', type: 'text', calculation: 'Name & " (" & State & ")"' }], { account: 'evals' });
  store.sql.prepare(`UPDATE "Congress" SET "${STALE_FIELD}" = 'Old name (Ohio)' WHERE _fm_record_id = ?`).run(STALE_RECORD);
}

export const STALE_FIELD = 'Display name';
export const STALE_RECORD = 2;

/** People's names in the sample file: a record's data, which design-only answers must never send the model. */
const recordNames = (store: Store) => store.query('SELECT DISTINCT Name AS n FROM "Congress" WHERE length(Name) > 8', 10_000).map((r) => String(r.n));
const seesNoRecords = (store: Store, requests: string[]) => {
  const names = recordNames(store);
  const leaked = names.filter((n) => requests.some((r) => r.includes(n)));
  return check('the model is sent no record data', names.length > 0 && !leaked.length, leaked.length ? `it was sent ${leaked.slice(0, 3).join(', ')}` : 'no names to look for');
};

/** A natural-language find: the records shown must be exactly the ones the question means. */
function findCase(id: string, ask: string, truth: string, on: { file: string; layout: string; table: string; findMode?: boolean } = { file: 'Charts', layout: 'Congress', table: 'Congress' }): EvalCase {
  return {
    id, area: 'find', ask, ...(on.file === 'Charts' ? {} : { file: on.file }),
    context: () => ({ mode: on.findMode ? 'find' : 'browse', layout: on.layout }),
    grade: ({ store, out, calls, requests }) => {
      const want = ids(store, truth, on.table);
      const shown = out.foundSets.at(-1);
      if (!shown) return [check('shows a found set', false, `the assistant answered without one: ${out.reply.slice(0, 200)}`)];
      let got: number[] = [];
      let error = '';
      try {
        got = store.findIds(shown.layout, { query: shown.query.length ? shown.query as FindRequest[] : undefined }).sort((a, b) => a - b);
      } catch (e) {
        error = (e as Error).message;
      }
      return [
        check('shows a found set', true),
        check(`on a ${on.table} layout`, store.layout(shown.layout).table === on.table, shown.layout),
        check('finds exactly the right records', !error && sameIds(got, want), error || describeDiff(got, want)),
        // Find with AI works from the design alone, so it can't know how many it found; the window shows that.
        ...(on.findMode ? [
          check('uses only the design', calls.every((c) => ['describe_database', 'describe_layout', 'show_records'].includes(c.name)), calls.map((c) => c.name).join(', ')),
          seesNoRecords(store, requests),
        ] : [check('says how many', new RegExp(`\\b${want.length}\\b`).test(out.reply), `the reply doesn't give the count ${want.length}`)]),
      ];
    },
  };
}

/** A drafted calculation for the formula box: its results on the records must match what the data says. */
function formulaCase(id: string, field: string, ask: string, expected: (row: Record<string, unknown>) => (value: string) => string | undefined, columns: string[]): EvalCase {
  return {
    id, area: 'formula', ask,
    context: (store) => ({ mode: 'design', layout: 'Congress', draft: { kind: 'calculation', for: `Congress::${field}`, contextTo: congressTo(store) } }),
    grade: ({ store, out }) => {
      const draft = out.drafts.find((d) => d.kind === 'calculation');
      if (!draft) return [check('offers a formula', false, `no draft: ${out.reply.slice(0, 200)}`)];
      const rows = store.query(`SELECT _fm_record_id AS id, ${columns.map((c) => `"${c}"`).join(', ')} FROM "Congress" ORDER BY _fm_record_id`, 10_000);
      const wrong: string[] = [];
      for (const row of rows) {
        let value: string;
        try {
          value = store.evaluate('Congress', draft.text, Number(row.id)).value;
        } catch (e) {
          wrong.push(`record ${row.id}: ${(e as Error).message}`);
          continue;
        }
        const problem = expected(row)(value);
        if (problem) wrong.push(`record ${row.id}: ${problem}`);
      }
      return [
        check('offers a formula', true),
        check('right on every record', !wrong.length, `${wrong.length} of ${rows.length} wrong, e.g. ${wrong.slice(0, 3).join('; ')}`),
        check('shows sample results', !!draft.samples?.results.length, 'the draft came back without sample results'),
      ];
    },
  };
}

/** A drafted script: it must check clean and, run offline on a copy of the file, end on the right found set. */
function scriptCase(id: string, ask: string, truth: string, sortedBy?: { field: string; descending?: boolean }): EvalCase {
  return {
    id, area: 'script', ask,
    context: () => ({ mode: 'design', layout: 'Congress', draft: { kind: 'script', for: 'Eval script' } }),
    grade: async ({ store, out }) => {
      const draft = out.drafts.find((d) => d.kind === 'script');
      if (!draft) return [check('offers a script', false, `no draft: ${out.reply.slice(0, 200)}`)];
      const checked = checkScript(store, draft.text);
      const want = ids(store, truth);
      const dir = mkdtempSync(join(tmpdir(), 'tabularius-eval-script-'));
      let copy: Store | undefined;
      try {
        // A copy, so nothing the script does reaches the file the other cases use; offline, so it reaches nothing outside.
        await store.backup(join(dir, 'copy.sqlite'));
        copy = new Store(join(dir, 'copy.sqlite'), store.name);
        copy.applyDesign([{ op: 'createScript', name: 'Eval script', text: draft.text }], { account: 'evals' });
        const r = await runScript(copy, 'Eval script', { layout: 'Congress', network: false, documents: join(dir, 'documents'), timeoutMs: 5_000, maxSteps: 20_000 });
        const got = [...(r.foundSet ?? [])];
        const checks = [
          check('offers a script', true),
          check('checks clean', checked.problems.length === 0, checked.problems.map((p) => `line ${p.line}: ${p.message}`).join('; ')),
          check('runs without an error', r.error === 0 && !r.halted, `ended with error ${r.error}${r.halted ? ', halted' : ''}`),
          check('ends on exactly the right records', sameIds([...got].sort((a, b) => a - b), want), describeDiff(got, want)),
        ];
        if (sortedBy) {
          const values = got.map((i) => Number(copy!.query(`SELECT "${sortedBy.field}" AS v FROM "Congress" WHERE _fm_record_id = ${i}`)[0]?.v));
          const inOrder = (a: number, b: number) => (sortedBy.descending ? a >= b : a <= b);
          checks.push(check(`sorted by ${sortedBy.field}${sortedBy.descending ? ', highest first' : ''}`, values.every((v, i) => i === 0 || inOrder(values[i - 1], v)), values.join(', ')));
        }
        return checks;
      } finally {
        copy?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

const quoted = (where: string) => /"([^"]+)"/.exec(where)?.[1];

/** Budgets for a simple question: the fast model, one or two calls, and a few thousand tokens. */
export const OVERVIEW_BUDGET = { calls: 2, inputTokensPerCall: 6_000, liveMs: 15_000, liveTokens: 12_000 };

export const CASES: EvalCase[] = [
  {
    id: 'file-overview', area: 'cost', ask: 'In one short sentence: what is this file about?',
    context: () => ({}),
    grade: ({ store, out, sent, live }) => {
      // The tables it names, by a word of their name ("Coasters" for US Coasters, "customer" for NW Customers).
      const words = (name: string) => name.split(/[\s_]+/).filter((w) => w.length >= 5).map((w) => new RegExp(`\\b${w.replace(/e?s$/i, '')}(e?s)?\\b`, 'i'));
      const subjects = store.schema.tables.map((t) => t.name).filter((n) => words(n).length);
      const named = subjects.filter((n) => words(n).some((w) => w.test(out.reply)));
      const biggest = Math.max(0, ...sent.map((x) => x.inputTokens));
      return [
        check('answers in a sentence or two', out.reply.length > 20 && out.reply.length < 400, out.reply),
        check('names what the file holds', named.length >= 2, `names ${named.join(', ') || 'none'} of ${subjects.join(', ')}`),
        check('goes to the fast model', sent.length > 0 && sent.every((x) => x.model === out.model) && out.model !== 'claude-opus-5-5', sent.map((x) => x.model).join(', ')),
        check(`takes at most ${OVERVIEW_BUDGET.calls} model calls`, sent.length <= OVERVIEW_BUDGET.calls, `${sent.length} calls`),
        check(`sends at most ${OVERVIEW_BUDGET.inputTokensPerCall.toLocaleString('en-US')} tokens a call`, biggest <= OVERVIEW_BUDGET.inputTokensPerCall, `${biggest.toLocaleString('en-US')} tokens`),
        ...(live ? [
          check(`answers within ${OVERVIEW_BUDGET.liveMs / 1000} s`, live.ms <= OVERVIEW_BUDGET.liveMs, `${(live.ms / 1000).toFixed(1)} s`),
          check(`uses at most ${OVERVIEW_BUDGET.liveTokens.toLocaleString('en-US')} tokens`, live.tokens <= OVERVIEW_BUDGET.liveTokens, `${live.tokens.toLocaleString('en-US')} tokens`),
        ] : []),
      ];
    },
  },

  findCase('find-ohio-senate-democrats', 'Show me the Democratic senators from Ohio', `Party = 'D' AND Chamber = 'Senate' AND State = 'Ohio'`),
  findCase('find-or-with-omit', 'Show the House Republicans from Texas or Florida, but leave out anyone in district 1',
    `Party = 'R' AND Chamber = 'House' AND State IN ('Texas', 'Florida') AND (District IS NULL OR District <> 1)`),
  findCase('find-number-range', 'Which senators have a liberal composite score above 80?', `Chamber = 'Senate' AND Liberal_Composite > 80`),
  findCase('flicks-find-recent', 'Which movies came out in 2020 or later?', 'year >= 2020', { file: 'Flicks', layout: 'WV Framework - Sample Data', table: 'MOVIE' }),
  findCase('flicks-find-year-range', 'Show me the movies from 2014 through 2016', 'year BETWEEN 2014 AND 2016', { file: 'Flicks', layout: 'WV Framework - Sample Data', table: 'MOVIE' }),

  formulaCase('formula-average', 'Liberal average',
    'Write the formula: the average of the three liberal scores (economic, social and foreign), rounded to one decimal place',
    (row) => (value) => {
      const xs = ['Liberal_Economic', 'Liberal_Social', 'Liberal_Foreign'].map((c) => row[c])
        // Unscored members hold " *" in these number fields, which counts as empty, as in FileMaker.
        .filter((v) => /\d/.test(String(v ?? ''))).map(Number);
      if (!xs.length) return value === '' ? undefined : `got "${value}", want empty`;
      const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
      // Rounded to one place: within half a tenth of the average, with at most one decimal.
      return /^-?\d+(\.\d)?$/.test(value) && Math.abs(Number(value) - avg) <= 0.05 + 1e-9 ? undefined : `got "${value}", want ${avg.toFixed(1)}`;
    }, ['Liberal_Economic', 'Liberal_Social', 'Liberal_Foreign']),
  formulaCase('formula-label', 'Label',
    'A label like "Sherrod Brown (D-Ohio)": the name, then the party and state in brackets',
    (row) => (value) => {
      const want = `${row.Name} (${row.Party}-${row.State})`;
      return value === want ? undefined : `got "${value}", want "${want}"`;
    }, ['Name', 'Party', 'State']),

  scriptCase('script-find-and-sort', 'Write a script that goes to the Congress layout, finds the House Republicans from Ohio and sorts them by district, highest first',
    `Party = 'R' AND Chamber = 'House' AND State = 'Ohio'`, { field: 'District', descending: true }),

  {
    id: 'impact-rename-field', area: 'impact', ask: 'What would break if I renamed the Party field in Congress?',
    context: () => ({ mode: 'design', layout: 'Congress' }),
    grade: async ({ store, out, calls, host }) => {
      const call = calls.find((c) => c.name === 'check_change_impact');
      const impact = await changeImpact(store, host.logs, 'field', 'Congress::Party', 'rename');
      // What breaks, by name: the uses that refer to it in quotes, and the privilege sets that list it.
      const breaking = [...new Set([...impact.uses.filter((u) => u.breaks).map((u) => quoted(u.where) ?? u.where), ...impact.privileges.filter((p) => p.breaks).map((p) => p.privilegeSet)])];
      return [
        check('checks the impact', !!call, `tools used: ${out.tools.join(', ') || 'none'}`),
        check('of renaming Congress::Party', !!call && call.input.kind === 'field' && String(call.input.name).toLowerCase() === 'congress::party' && (call.input.change ?? 'rename') === 'rename', JSON.stringify(call?.input)),
        check('there is something that breaks', breaking.length > 0, 'the case setup should leave a by-name use and a privilege set behind'),
        ...breaking.map((b) => check(`names "${b}" as breaking`, mentions(out.reply, b), out.reply.slice(0, 300))),
      ];
    },
  },

  {
    id: 'rules-for-table', area: 'rules', ask: 'What validation rules should the Grades table have?',
    context: () => ({ mode: 'design', layout: 'Grades' }),
    grade: ({ store, out, calls }) => {
      const call = calls.find((c) => c.name === 'suggest_rules');
      const { suggestions } = suggestRules(store, { table: 'Grades' });
      const offered = new Set(suggestions.flatMap((s) => s.changes).map((c) => JSON.stringify(c)));
      const proposed = out.proposals.flatMap((p) => p.changes);
      return [
        check('looks at the data', !!call && (call.input.table === undefined || String(call.input.table).toLowerCase() === 'grades'), `tools used: ${out.tools.join(', ') || 'none'}`),
        check('the data suggests something', suggestions.length > 0),
        ...suggestions.map((s) => check(`mentions ${s.field}`, mentions(out.reply, s.field), out.reply.slice(0, 300))),
        // Anything it proposes is one of the rules the data supports, not one it made up.
        check('proposes only rules the data supports', proposed.every((c) => offered.has(JSON.stringify(c))), JSON.stringify(proposed).slice(0, 300)),
      ];
    },
  },
  findCase('find-mode-design-only', 'Senate Democrats from Ohio or Michigan', `Party = 'D' AND Chamber = 'Senate' AND State IN ('Ohio', 'Michigan')`,
    { file: 'Charts', layout: 'Congress', table: 'Congress', findMode: true }),

  {
    id: 'check-record-stale', area: 'record', ask: 'Why does this record look wrong?',
    context: () => ({ mode: 'browse', layout: 'Congress', recordId: STALE_RECORD }),
    grade: ({ store, out, calls }) => {
      const call = calls.find((c) => c.name === 'check_record');
      const now = String(store.evaluate('Congress', 'Name & " (" & State & ")"', STALE_RECORD).value);
      return [
        check('checks the record', !!call && Number(call.input.recordId) === STALE_RECORD, `tools used: ${out.tools.join(', ') || 'none'}`),
        check(`names ${STALE_FIELD}`, mentions(out.reply, STALE_FIELD), out.reply.slice(0, 300)),
        check('says it is out of date', /out of date|stale|no longer|recalculat|re-?evaluat/i.test(out.reply), out.reply.slice(0, 300)),
        check('gives what it should show', out.reply.includes(now), `want "${now}" in the reply`),
      ];
    },
  },

  {
    id: 'solution-crm', area: 'build',
    ask: 'Track companies, the people who work at them, and deals moving through the stages Lead, Qualified, Won and Lost, with a pipeline view of deals by stage.',
    context: () => ({}),
    run: async (assistant, _store) => {
      const plan = await assistant.planSolution('Eval CRM', 'Track companies, the people who work at them, and deals moving through the stages Lead, Qualified, Won and Lost, with a pipeline view of deals by stage.');
      return { reply: plan.summary, result: plan };
    },
    grade: ({ result }) => {
      const plan = result as { changes: Record<string, unknown>[]; dryRuns?: { script: string; run: { error: number; halted?: boolean } }[] } | undefined;
      if (!plan) return [check('makes a plan', false)];
      const ops = (op: string) => plan.changes.filter((c) => c.op === op);
      const tables = ops('createTable').map((c) => String(c.name));
      const has = (re: RegExp) => tables.find((t) => re.test(t));
      const [companies, contacts, deals] = [has(/compan/i), has(/contact|people|person/i), has(/deal|opportunit/i)];
      const related = (a?: string, b?: string) => !!a && !!b && ops('createRelationship').some((r) => r.left === a && r.right === b);
      const lists = ops('createValueList').map((v) => (v.values as unknown[] | undefined)?.map(String) ?? []);
      const scripts = ops('createScript').map((c) => String(c.text ?? ''));
      return [
        check('a table each for companies, contacts and deals', !!(companies && contacts && deals), tables.join(', ')),
        check('companies relate to their contacts and deals', related(companies, contacts) && related(companies, deals), JSON.stringify(ops('createRelationship').map((r) => [r.left, r.right]))),
        check('a value list with the four stages', lists.some((l) => ['Lead', 'Qualified', 'Won', 'Lost'].every((s) => l.includes(s))), JSON.stringify(lists)),
        check('a list layout for the pipeline', ops('createLayout').some((l) => /pipeline/i.test(String(l.name)) && (l.design as { view?: string } | undefined)?.view === 'list'), JSON.stringify(ops('createLayout').map((l) => l.name))),
        check('starter scripts that send nothing anywhere', scripts.length > 0 && !scripts.some((t) => /Send Mail|Insert from URL|Open URL|Send Event/i.test(t)), `${scripts.length} scripts`),
        check('its scripts run cleanly on a copy', (plan.dryRuns ?? []).every((d) => d.run.error === 0 && !d.run.halted), JSON.stringify((plan.dryRuns ?? []).filter((d) => d.run.error).map((d) => [d.script, d.run.error]))),
      ];
    },
  },

  {
    id: 'handover-memo', area: 'handover', ask: '(the handover memo for the file)',
    context: () => ({}),
    run: async (assistant, store) => ({ reply: await assistant.handoverMemo(store, 'Admin') }),
    grade: ({ store, out, requests }) => {
      const names = recordNames(store);
      return [
        check('is a Markdown document with a title', /^# \S/.test(out.reply), out.reply.slice(0, 80)),
        check('covers the main tables', ['Congress', 'Grades'].every((t) => mentions(out.reply, t)), out.reply.slice(0, 300)),
        check('has a migration readiness section', /^#+ .*migration readiness/im.test(out.reply), 'no "Migration readiness" heading'),
        check('flags what looks unused', /unused|not used|never used/i.test(out.reply)),
        seesNoRecords(store, requests),
        check('quotes no record data', !names.some((n) => out.reply.includes(n))),
      ];
    },
  },
];
