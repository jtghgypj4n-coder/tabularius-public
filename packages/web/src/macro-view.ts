// The macro recorder's dialog, shown when recording stops: the recorded steps
// as a script (editable), a Dry run that runs them once on a throwaway copy of
// the file and lists what they would change, and Save, which adds the script.
import { h, button } from './design/dom.ts';
import type { ScriptDryRun } from './design/client.ts';
import { dryRunSummary } from './design/dry-run-summary.ts';

export interface MacroDialogApi {
  /** POST .../scripts/dry-run {text}: what the steps would change, on a copy. */
  dryRun(text: string): Promise<ScriptDryRun>;
  /** Adds the script; false when it couldn't (the reason is already shown). */
  save(name: string, text: string): Promise<boolean>;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function changes(r: ScriptDryRun): HTMLElement {
  const rows = r.changes.records.slice(0, 50).flatMap((rec) => {
    const what = `${rec.table} record ${rec.recordId}${rec.kind === 'create' ? ' (new)' : rec.kind === 'delete' ? ' (deleted)' : ''}`;
    if (!rec.fields.length) return [h('tr', {}, h('th', { scope: 'row' }, what), h('td', {}), h('td', {}))];
    return rec.fields.map((f, i) => h('tr', {}, h('th', { scope: 'row' }, i ? '' : what),
      h('td', {}, f.field),
      h('td', {}, ...(rec.kind !== 'create' && f.before !== f.after ? [h('span', { class: 'ai-before' }, f.before), ' → '] : []), rec.kind === 'delete' ? '' : f.after)));
  });
  return rows.length ? h('table', { class: 'ai-samples macro-changes' }, h('tbody', {}, ...rows)) : h('span');
}

/** Resolves true when the script was saved. */
export function macroDialog(recorded: { text: string; steps: number; notes: string[] }, api: MacroDialogApi): Promise<boolean> {
  return new Promise((done) => {
    let saved = false;
    const dialog = h('dialog', { class: 'replace-dialog export-dialog macro-dialog', 'aria-label': 'Recorded script' }) as HTMLDialogElement;
    const name = h('input', { type: 'text', value: `Recorded ${new Date().toLocaleString()}`, 'aria-label': 'Script name' }) as HTMLInputElement;
    const text = h('textarea', { class: 'macro-text', spellcheck: 'false', rows: String(Math.min(16, recorded.text.split('\n').length + 1)), 'aria-label': 'Script steps' }) as HTMLTextAreaElement;
    text.value = recorded.text;
    const status = h('p', { class: 'g-status', 'aria-live': 'polite' },
      `${plural(recorded.steps, 'step')}. What you did while recording is already done; Dry run shows what running the script again would change. It runs once on a throwaway copy of the file, offline, and nothing is saved.`);
    const result = h('div', { class: 'macro-result' });
    const runDry = async () => {
      dry.disabled = true;
      status.textContent = 'Running it on a copy of the file…';
      result.replaceChildren();
      try {
        const r = await api.dryRun(text.value);
        status.textContent = dryRunSummary(r);
        status.classList.toggle('macro-bad', !!r.ended.error);
        result.replaceChildren(changes(r));
      } catch (e) {
        status.textContent = (e as Error).message;
        status.classList.add('macro-bad');
      } finally {
        dry.disabled = false;
      }
    };
    const dry = button('Dry run', () => void runDry(), { title: 'Runs the steps once on a throwaway copy of the file, offline; nothing is saved' });
    const save = button('Save script', async () => {
      if (!name.value.trim()) {
        name.focus();
        return;
      }
      save.disabled = true;
      saved = await api.save(name.value.trim(), text.value);
      save.disabled = false;
      if (saved) dialog.close();
    }, { class: 'primary' });
    dialog.append(
      h('h2', {}, 'Recorded script'),
      h('label', { class: 'row' }, 'Name', name),
      text,
      ...(recorded.notes.length ? [h('ul', { class: 'ai-lint' }, ...recorded.notes.map((n) => h('li', {}, `Not recorded: ${n}. Add it in the script editor if the script needs it.`)))] : []),
      status,
      result,
      h('div', { class: 'actions' },
        dry,
        h('span', { class: 'spacer' }),
        button('Discard', () => {
          if (confirm('Discard the recorded steps?')) dialog.close();
        }, { class: 'danger' }),
        save,
      ),
    );
    // Escape asks first: the recording is lost once the dialog closes.
    dialog.addEventListener('cancel', (e) => {
      if (!confirm('Discard the recorded steps?')) e.preventDefault();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      done(saved);
    });
    document.body.append(dialog);
    dialog.showModal();
    name.select();
  });
}
