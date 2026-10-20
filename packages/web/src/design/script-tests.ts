// The script editor's Tests and History panels, which FileMaker doesn't have. Tests: saved inputs (parameter,
// layout, found set, globals, stand-in AI answers) and what the script should end with, run offline on a copy
// of the file; "Fill in from a run" records how a run ends as the expectations. History: the script as each
// save here left it, and what each save changed, with a way to put an earlier version back in the editor.
import type { ScriptTestCase, ScriptTestEnd, ScriptTestOutcome, SuggestedTest } from './client.ts';
import { h, button, field, toast } from './dom.ts';
import { errorText, type Studio } from './main.ts';
import { diffHunks, diffSummary, lineDiff } from './line-diff.ts';
import { lines, pairs, requestLines, requests } from './script-test-input.ts';

type Given = ScriptTestCase['given'];

export function testsPanel(studio: Studio, script: { id: number; name: string }): HTMLElement {
  const list = h('div', { class: 'st-list' });
  const results = new Map<string, ScriptTestOutcome>();
  let tests: ScriptTestCase[] = [];
  let editing: ScriptTestCase | undefined;

  const input = (attrs: Record<string, string> = {}) => h('input', { type: 'text', ...attrs });
  const area = (rows = 2, placeholder = '') => h('textarea', { rows: String(rows), placeholder, spellcheck: 'false' });
  const name = input({ placeholder: 'What this case checks' });
  const parameter = input();
  const layout = input({ placeholder: 'Where a button runs it' });
  const find = area(2, 'Status: open ; Amount: >100');
  const record = input({ inputmode: 'numeric', placeholder: '1' });
  const globals = area(2, '$$user = Ann\nInvoices::gYear = 2026');
  const ai = area(2, 'One answer per line, in the order the AI steps ask');
  const result = input();
  const error = input({ inputmode: 'numeric' });
  const count = input({ inputmode: 'numeric' });
  const endLayout = input();
  const variables = area(2, '$$total = 120');
  const fields = area(2, 'Invoices::Status = paid');

  const given = (): Given => {
    const n = Number(record.value);
    return {
      ...(parameter.value ? { parameter: parameter.value } : {}),
      ...(layout.value.trim() ? { layout: layout.value.trim() } : {}),
      ...(requests(find.value) ? { find: requests(find.value) } : {}),
      ...(Number.isInteger(n) && n > 1 ? { record: n } : {}),
      ...(pairs(globals.value) ? { globals: pairs(globals.value) } : {}),
      ...(ai.value.trim() ? { ai: ai.value.split('\n').filter((x) => x.trim()) } : {}),
    };
  };
  const expected = (): ScriptTestEnd => {
    const int = (el: HTMLInputElement) => (el.value.trim() !== '' && Number.isInteger(Number(el.value)) ? Number(el.value) : undefined);
    const e = int(error);
    const c = int(count);
    return {
      ...(result.value !== '' ? { result: result.value } : {}),
      ...(e !== undefined ? { error: e } : {}),
      ...(c !== undefined ? { foundCount: c } : {}),
      ...(endLayout.value.trim() ? { layout: endLayout.value.trim() } : {}),
      ...(pairs(variables.value) ? { variables: pairs(variables.value) } : {}),
      ...(pairs(fields.value) ? { fields: pairs(fields.value) } : {}),
    };
  };
  const fill = (t?: ScriptTestCase) => {
    editing = t;
    name.value = t?.name ?? '';
    parameter.value = t?.given.parameter ?? '';
    layout.value = t?.given.layout ?? '';
    find.value = requestLines(t?.given.find);
    record.value = t?.given.record ? String(t.given.record) : '';
    globals.value = lines(t?.given.globals);
    ai.value = (t?.given.ai ?? []).join('\n');
    showEnd(t?.expect ?? {});
    form.hidden = false;
    name.focus();
  };
  const showEnd = (e: ScriptTestEnd) => {
    result.value = e.result ?? '';
    error.value = e.error !== undefined ? String(e.error) : '';
    count.value = e.foundCount !== undefined ? String(e.foundCount) : '';
    endLayout.value = e.layout ?? '';
    variables.value = lines(e.variables);
    fields.value = lines(e.fields);
  };

  const draw = () => {
    list.replaceChildren(
      ...(tests.length ? [h('ul', { class: 'd-list st-cases' }, ...tests.map((t) => {
        const o = results.get(t.id);
        const li = h('li', { class: o ? (o.passed ? 'st-pass' : 'st-fail') : '' },
          h('span', { class: 'st-mark', 'aria-label': o ? (o.passed ? 'Passed' : 'Failed') : 'Not run yet' }, o ? (o.passed ? '✓' : '✕') : '•'),
          h('div', {},
            h('p', {}, t.name),
            ...(o && !o.passed ? [h('ul', { class: 'st-why' },
              ...o.failures.map((f) => h('li', {}, `${f.what}: expected “${f.expected}”, got “${f.actual}”`)),
              ...(o.message ? [h('li', { class: 'd-muted' }, o.message)] : []))] : [])),
          h('div', { class: 'se-lint-actions' },
            button('Edit', () => fill(t)),
            button('Delete', async () => {
              try {
                await studio.client.deleteScriptTest(t.id);
                tests = tests.filter((x) => x.id !== t.id);
                draw();
              } catch (e) {
                toast(errorText(e));
              }
            })));
        return li;
      }))] : [h('p', { class: 'd-muted' }, 'No test cases yet. A case saves the inputs a run starts with and what it should end with; cases run offline on a copy of the file, so nothing here changes.')]),
    );
  };
  const load = async () => {
    try {
      tests = await studio.client.scriptTests(script.id);
    } catch (e) {
      list.replaceChildren(h('p', { class: 'se-error' }, errorText(e)));
      return;
    }
    draw();
  };
  const runAll = async () => {
    if (!tests.length) return;
    summary.textContent = 'Running…';
    try {
      const out = await studio.client.runScriptTests(script.id);
      for (const o of out) results.set(o.id, o);
      const passed = out.filter((o) => o.passed).length;
      summary.textContent = `${passed} of ${out.length} pass`;
    } catch (e) {
      summary.textContent = '';
      toast(errorText(e));
    }
    draw();
  };
  const summary = h('span', { class: 'd-muted', 'aria-live': 'polite' });

  const form = h('div', { class: 'st-form', hidden: '' },
    field('Name', name),
    h('fieldset', {}, h('legend', {}, 'Given'),
      field('Script parameter', parameter),
      field('Layout', layout),
      field('Found set', find, 'Blank for all records. One find request per line: Field: criterion ; Field: criterion'),
      field('Current record', record, 'Its number in the found set'),
      field('Globals', globals, '$$variables and global fields, one per line: name = value'),
      field('AI answers', ai, 'What the AI steps get instead of a model')),
    h('fieldset', {}, h('legend', {}, 'Expect'),
      field('Result', result, 'Exit Script’s result'),
      field('Error', error, 'Get ( LastError ) at the end; 0 for none'),
      field('Found count', count),
      field('Layout at the end', endLayout),
      field('Global variables', variables, 'name = value, one per line'),
      field('Fields', fields, 'Of the record it ends on: Table::Field = value')),
    h('div', { class: 'd-actions' },
      button('Fill in from a run', async () => {
        try {
          // Ask for the globals the case sets, so it checks what it set up.
          const end = await studio.client.recordScriptTest(script.id, given());
          showEnd({ ...end, ...(pairs(fields.value) ? { fields: pairs(fields.value) } : {}) });
          toast('Filled in from a run on a copy of the file: check each value is what the script should give', 'info');
        } catch (e) {
          toast(errorText(e));
        }
      }, { title: 'Runs the script once, offline on a copy, and fills in how it ended' }),
      button('Save test case', async () => {
        try {
          const saved = await studio.client.saveScriptTest({ ...(editing ? { id: editing.id } : {}), script: script.id, name: name.value, given: given(), expect: expected() });
          tests = editing ? tests.map((x) => (x.id === saved.id ? saved : x)) : [...tests, saved];
          results.delete(saved.id);
          form.hidden = true;
          draw();
        } catch (e) {
          toast(errorText(e));
        }
      }, { class: 'primary' }),
      button('Cancel', () => (form.hidden = true))));

  // AI-written cases: proposed by the assistant, each run once offline on a copy; the person keeps the ones they want.
  const suggestions = h('div', { class: 'st-suggest', 'aria-live': 'polite' });
  const keep = async (s: SuggestedTest, expect: ScriptTestEnd, row: HTMLElement) => {
    try {
      const saved = await studio.client.saveScriptTest({ script: script.id, name: s.name, given: s.given, expect });
      tests = [...tests, saved];
      draw();
      row.remove();
      if (!suggestions.querySelector('li')) suggestions.replaceChildren();
    } catch (e) {
      toast(errorText(e));
    }
  };
  const inputs = (g: SuggestedTest['given']) => [
    g.parameter !== undefined ? `parameter “${g.parameter}”` : 'no parameter',
    ...(g.layout ? [`on ${g.layout}`] : []), ...(g.find ? [`found set: ${requestLines(g.find).replace(/\n/g, '; ')}`] : []),
    ...(g.record ? [`record ${g.record}`] : []), ...(g.globals ? [lines(g.globals).replace(/\n/g, ', ')] : []),
  ].join(', ');
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const changed = (c: SuggestedTest['changes']) => !c ? '' : [c.create && `creates ${plural(c.create, 'record')}`, c.update && `changes ${plural(c.update, 'record')}`, c.delete && `deletes ${plural(c.delete, 'record')}`,
    c.more && `changes ${plural(c.more, 'more record')}`, c.emptied?.length && `empties ${c.emptied.join(', ')}`].filter(Boolean).join(', ') || 'changes no records';
  const suggest = async (b: HTMLButtonElement) => {
    b.disabled = true;
    suggestions.replaceChildren(h('p', { class: 'd-muted' }, 'The assistant is writing test cases, then each runs once on a copy of the file…'));
    try {
      const { cases, skipped } = await studio.client.suggestScriptTests(script.id);
      suggestions.replaceChildren(
        h('p', { class: 'd-hint' }, cases.length ? 'Suggested by AI and run once on a copy of the file. Keep the ones worth keeping; a case the script fails may be a bug in the script, or the AI misreading it.' : 'The assistant didn\'t suggest any cases it could run.'),
        h('ul', { class: 'd-list st-cases' }, ...cases.map((s) => {
          const row: HTMLElement = h('li', { class: s.passed ? 'st-pass' : 'st-fail' },
            h('span', { class: 'st-mark', 'aria-label': s.passed ? 'The script does this' : 'The script does something else' }, s.passed ? '✓' : '✕'),
            h('div', {},
              h('p', {}, s.name),
              h('p', { class: 'd-muted' }, `${inputs(s.given).replace(/^./, (c) => c.toUpperCase())}.${s.changes ? ` It ${changed(s.changes)}.` : ''}`),
              ...(s.why ? [h('p', { class: 'd-muted' }, s.why)] : []),
              ...(!s.passed ? [h('ul', { class: 'st-why' },
                ...s.failures.map((f) => h('li', {}, `${f.what}: expected “${f.expected}”, it gave “${f.actual}”`)),
                ...(s.message ? [h('li', { class: 'd-muted' }, s.message)] : []))] : [])),
            h('div', { class: 'se-lint-actions' }, ...(s.passed
              ? [button('Keep', () => void keep(s, s.expect, row), { class: 'primary' })]
              : [...(s.asRuns ? [button('Keep as it runs now', () => void keep(s, s.asRuns!, row), { title: 'Saves what the script does today, so a later change that alters it is caught' })] : []),
                button('Keep as expected', () => void keep(s, s.expect, row), { title: 'Saves the AI\'s expectation: the case fails until the script does this' })])));
          return row;
        })),
        ...(skipped?.length ? [h('p', { class: 'd-muted' }, `Left out ${plural(skipped.length, 'case')} that couldn't run: ${skipped.join('; ')}`)] : []));
    } catch (e) {
      suggestions.replaceChildren(h('p', { class: 'se-error' }, errorText(e)));
    } finally {
      b.disabled = false;
    }
  };
  const suggestButton: HTMLButtonElement = button('Suggest cases with AI', () => void suggest(suggestButton), { title: 'The assistant reads the script (secrets hidden) and the file\'s tables and layouts, never its records, and proposes cases; each runs once offline on a copy' });

  void load();
  return h('section', { class: 'se-lint st' },
    h('div', { class: 'se-review-head' }, h('strong', {}, 'Tests'), summary),
    list,
    h('div', { class: 'd-actions' },
      button('Run all', () => void runAll(), { title: 'Runs every case offline on a copy of the file; the script is run as last saved' }),
      button('New test case', () => fill()),
      ...(studio.ask ? [suggestButton] : [])),
    suggestions,
    form);
}

/** The script's saves here, newest first, each with what it changed; one can be put back in the editor. */
export function historyPanel(studio: Studio, script: { id: number }, restore: (text: string) => void): HTMLElement {
  const body = h('div', { class: 'd-stack' }, h('p', { class: 'd-muted' }, 'Loading…'));
  void (async () => {
    let versions;
    try {
      versions = await studio.client.scriptVersions(script.id);
    } catch (e) {
      body.replaceChildren(h('p', { class: 'se-error' }, errorText(e)));
      return;
    }
    if (!versions.length) {
      body.replaceChildren(h('p', { class: 'd-muted' }, 'No saves of this script in Tabularius yet: the history starts with the first save here (edits made in FileMaker before the file was converted aren’t in it).'));
      return;
    }
    const items = versions.map((v, i) => ({ ...v, before: i > 0 ? versions[i - 1].text : undefined })).reverse();
    const detail = h('div', { class: 'd-stack' });
    const hunks = (diff: ReturnType<typeof lineDiff>) => diffHunks(diff).map((hunk) => h('pre', { class: 'se-diff', 'aria-label': `From line ${hunk.line}` },
      ...hunk.lines.map((d) => h('span', { class: `se-diff-${d.kind}` }, `${d.kind === 'add' ? '+' : d.kind === 'del' ? '−' : ' '} ${d.text}\n`))));
    /** The version's own change, or (`sinceThen`) everything changed from it to the script as saved now. */
    const show = (v: (typeof items)[number], sinceThen = false) => {
      const now = studio.design.scripts.find((x) => x.id === script.id)?.text ?? items[0].text;
      const diff = sinceThen ? lineDiff(v.text, now) : lineDiff(v.before ?? '', v.text);
      const changed = diff.some((d) => d.kind !== 'same');
      detail.replaceChildren(
        h('p', { class: 'd-hint' }, sinceThen
          ? (changed ? `What changed since this save, up to the script as saved now: ${diffSummary(diff)}` : 'The script as saved now is the same as this save.')
          : v.before === undefined ? 'The first save here, in full:' : `What this save changed: ${diffSummary(diff)}`),
        ...hunks(diff),
        h('div', { class: 'd-actions' },
          button(sinceThen ? 'Show what this save changed' : 'Compare with the script now', () => show(v, !sinceThen)),
          button('Put this version in the editor', () => restore(v.text), { title: 'Nothing is saved until you save the script' })));
    };
    // Who has changed it, from the design history: the last save, and everyone who saved it here.
    const who = [...new Set(versions.map((v) => v.account ?? 'the server'))];
    const last = items[0];
    body.replaceChildren(
      h('p', { class: 'd-muted' }, `Last saved by ${last.account ?? 'the server'} on ${new Date(last.at).toLocaleString()}. ` +
        `${versions.length} save${versions.length === 1 ? '' : 's'} here, by ${who.join(', ')}.`),
      h('ul', { class: 'd-list st-versions' }, ...items.map((v) => {
        const b = button(`${new Date(v.at).toLocaleString()}${v.account ? `, ${v.account}` : ''}`, () => show(v));
        return h('li', {}, b);
      })),
      detail);
    show(items[0]);
  })();
  return h('section', { class: 'se-lint' }, h('div', { class: 'se-review-head' }, h('strong', {}, 'History')), body);
}
