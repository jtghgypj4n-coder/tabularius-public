// The script editor's Dry run, which FileMaker doesn't have: the script runs once, offline on a throwaway copy
// of the file, with a parameter and layout of your choosing, and you see exactly which records it would create,
// change or delete, each field with its value before and after. Nothing is saved.
import type { ScriptDryRun } from './client.ts';
import { h, button, field } from './dom.ts';
import { errorText, type Studio } from './main.ts';
import { dryRunSummary } from './dry-run-summary.ts';

/** `draft`: run these steps (not saved yet) instead of the saved script's. */
export function dryRunPanel(studio: Studio, script: { id: number; name: string }, draft?: string): HTMLElement {
  const summary = h('p', { class: 'd-hint', 'aria-live': 'polite' }, `Runs ${draft === undefined ? 'the script' : 'the drafted steps'} once on a throwaway copy of the file, offline, and shows what ${draft === undefined ? 'it' : 'they'} would change. Nothing is saved.`);
  const out = h('div', { class: 'dr-records' });
  const parameter = h('input', { type: 'text', placeholder: 'Script parameter (optional)' });
  const layout = h('input', { type: 'text', placeholder: 'Where a button runs it' });
  const record = h('input', { type: 'text', inputmode: 'numeric', placeholder: '1' });
  const draw = (r: ScriptDryRun) => {
    summary.textContent = dryRunSummary(r);
    out.replaceChildren(...r.changes.records.map((rec) => h('section', { class: `dr-record dr-${rec.kind}` },
      h('h4', {}, `${rec.table} record ${rec.recordId}`, h('span', { class: 'dr-kind' }, rec.kind === 'create' ? 'new' : rec.kind === 'delete' ? 'deleted' : 'changed')),
      rec.fields.length ? h('table', { class: 'dr-fields' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Field'), ...(rec.kind !== 'create' ? [h('th', { scope: 'col' }, 'Before')] : []), ...(rec.kind !== 'delete' ? [h('th', { scope: 'col' }, 'After')] : []))),
        h('tbody', {}, ...rec.fields.map((f) => h('tr', {}, h('th', { scope: 'row' }, f.field),
          ...(rec.kind !== 'create' ? [h('td', { class: 'dr-before' }, f.before)] : []),
          ...(rec.kind !== 'delete' ? [h('td', { class: 'dr-after' }, f.after)] : []))))) : h('p', { class: 'd-muted' }, 'No field values.'))));
  };
  const run = async (b: HTMLButtonElement) => {
    b.disabled = true;
    summary.textContent = 'Running it on a copy of the file…';
    out.replaceChildren();
    const n = Number(record.value);
    try {
      draw(await studio.client.dryRunScript(script.id, {
        ...(parameter.value ? { parameter: parameter.value } : {}),
        ...(layout.value.trim() ? { layout: layout.value.trim() } : {}),
        ...(Number.isInteger(n) && n > 1 ? { record: n } : {}),
      }, draft));
    } catch (e) {
      summary.textContent = errorText(e);
    } finally {
      b.disabled = false;
    }
  };
  const go: HTMLButtonElement = button('Dry run', () => void run(go), { class: 'primary', title: 'Runs the saved script once on a throwaway copy, offline; nothing is saved' });
  return h('div', { class: 'd-stack' },
    h('h3', {}, `What ${script.name} would change`),
    h('div', { class: 'sp-run' }, field('Parameter', parameter), field('Layout', layout), field('On record', record), go),
    summary,
    out,
  );
}
