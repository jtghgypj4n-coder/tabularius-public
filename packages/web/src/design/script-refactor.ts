// Improve: where the script could be simpler or faster (branches that never run, steps nothing reaches, runs of
// steps repeated in it, the slow loop shapes, and where the profiler says the time goes). FileMaker has nothing like
// it. "Explain and refactor with AI" hands the hints to the assistant; its draft is shown as a diff and proven
// against the script (both run offline on a copy, from each saved test case's inputs) before it can be put in the
// editor, and nothing changes until it is saved.

import type { RefactorHint } from './client.ts';
import { h, button } from './dom.ts';
import { errorText, type Studio } from './main.ts';

const LABELS: Record<RefactorHint['kind'], string> = {
  'dead-branch': 'Never runs',
  unreachable: 'Never reached',
  repeated: 'Repeated',
  'same-as-script': 'Another script',
  'record-loop': 'Slow loop',
  'find-in-loop': 'Slow loop',
  'commit-in-loop': 'Slow loop',
  'slow-step': 'Slow step',
  disabled: 'Disabled steps',
};

/** The prompt "Explain and refactor" sends: the hints (if any), and the editor's steps when they aren't saved yet. */
export function refactorPrompt(name: string, hints: RefactorHint[], unsaved?: string): string {
  const list = hints.map((x) => `- Line${x.endLine > x.line ? `s ${x.line}–${x.endLine}` : ` ${x.line}`}: ${x.message} ${x.fix}`).join('\n');
  return `Explain in a few plain sentences what the script "${name}" does, then refactor it to be simpler and easier to read` +
    (hints.length ? ` and faster. These are the places to look at:\n${list}\n` : '. ') +
    'Make the script do exactly what it does now: same records changed, same result, same variables set. Move a repeated run of steps into a new subscript only when one already fits; ' +
    'otherwise leave it and say which new subscript would help. Keep everything else as it is; write out the whole script. ' +
    'Your version is run against the script on a copy of the file before it can be used.' +
    (unsaved ? `\n\nThe editor has unsaved steps; refactor these:\n${unsaved}` : '');
}

export function improvePanel(studio: Studio, script: { id: number; name: string }, text: () => string, saved: () => string,
  selectLines: (from: number, to: number) => void, review: (draft: string, prove?: boolean) => void): HTMLElement {
  const summary = h('p', { class: 'd-hint', 'aria-live': 'polite' }, 'Looking for what could be simpler or faster…');
  const list = h('div');
  const actions = h('div', { class: 'd-actions' });
  const load = async () => {
    const at = text();
    const changed = at !== saved();
    let r: { hints: RefactorHint[]; timed: boolean };
    try {
      r = await studio.client.refactorHints(script.id, changed ? at : undefined);
    } catch (e) {
      summary.textContent = errorText(e);
      return;
    }
    summary.textContent = r.hints.length
      ? `${r.hints.length} place${r.hints.length === 1 ? '' : 's'} where the script could be simpler or faster${r.timed ? ', with where the time goes on this server' : changed ? ' (in the steps the editor has open; timings show for the saved script)' : ''}:`
      : `Nothing to simplify${r.timed ? ', and no step takes most of the time' : ''}.`;
    list.replaceChildren(...(r.hints.length ? [h('ul', { class: 'd-list se-lint-list' }, ...r.hints.map((x) => {
      const li = h('li', { class: 'se-lint-warning' },
        h('button', { type: 'button', title: 'Select these lines' }, h('span', { class: 'g-mono' }, x.endLine > x.line ? `Lines ${x.line}–${x.endLine}` : `Line ${x.line}`)),
        h('div', {}, h('p', {}, h('strong', {}, `${LABELS[x.kind]}: `), x.message), h('p', { class: 'd-muted' }, x.fix)));
      li.querySelector('button')!.addEventListener('click', () => selectLines(x.line, x.endLine));
      return li;
    }))] : []));
    actions.replaceChildren(
      button('Check again', () => void load(), { title: 'Look again at the steps the editor has open' }),
      ...(studio.ask && text().trim() ? [button('Explain and refactor with AI', () => {
        const now = text();
        const unsaved = now !== saved() && now.length <= 6000 ? now : undefined;
        void studio.ask!(refactorPrompt(script.name, r.hints, unsaved), { target: { kind: 'script', for: script.name }, use: (draft) => review(draft, true) });
      }, { class: r.hints.length ? 'primary' : undefined, title: 'The assistant explains the script and drafts a cleaner version; it is run against the script on a copy of the file (each saved test case, and where buttons start it) before you can put it in the editor' })] : []));
  };
  void load();
  return h('div', { class: 'd-stack' }, h('h3', {}, 'Improve'), summary, list, actions);
}
