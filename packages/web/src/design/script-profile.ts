// The script editor's Profile panel, which FileMaker doesn't have: each step's time beside its line (and how
// many times a run a loop's steps ran), the slowest steps picked out, from the runs on this server or from
// one run now, offline on a copy of the file with a parameter of your choosing.
import type { ScriptProfileData } from './client.ts';
import { h, button, field, toast } from './dom.ts';
import { errorText, type Studio } from './main.ts';
import { ms, profileMarks, type LineMark } from './profile-marks.ts';

export function profilePanel(studio: Studio, script: { id: number; name: string }, show: (marks: Map<number, LineMark> | undefined) => void, selectLine: (n: number) => void): HTMLElement {
  const summary = h('p', { class: 'd-hint', 'aria-live': 'polite' }, 'Reading the timings…');
  const slowest = h('div');
  const parameter = h('input', { type: 'text', placeholder: 'Script parameter (optional)' });
  const layout = h('input', { type: 'text', placeholder: 'Where a button runs it' });

  const draw = (p: ScriptProfileData | null, from: string) => {
    if (!p || !p.steps.length) {
      show(undefined);
      summary.textContent = p?.changed
        ? 'The steps that were timed have all changed since. Profile a run to time them as they are now.'
        : `${from === 'server' ? 'This script hasn\'t run on the server since it started.' : 'The run took no measurable time.'} Profile a run to time each step.`;
      slowest.replaceChildren();
      return;
    }
    const { marks, slowest: hot } = profileMarks(p);
    show(marks);
    summary.textContent = (from === 'server'
      ? `${p.runs} run${p.runs === 1 ? '' : 's'} on the server since ${new Date(p.since).toLocaleString()}: ${ms(p.averageMs)} a run on average, the slowest ${ms(p.maxMs)}.`
      : `One run on a copy of the file: ${ms(p.totalMs)}.`) +
      ' Each line shows its step\'s own time a run (not the scripts it performs), and × how many times a run it ran.' +
      (p.changed ? ` ${p.changed} timed step${p.changed === 1 ? ' has' : 's have'} changed since and ${p.changed === 1 ? 'is' : 'are'} left out.` : '');
    slowest.replaceChildren(...(hot.length ? [h('ul', { class: 'sp-hot' }, ...hot.map((m) => {
      const go = h('button', { type: 'button', title: 'Select this line' }, h('span', { class: 'g-mono' }, `Line ${m.line}`));
      go.addEventListener('click', () => selectLine(m.line));
      return h('li', {}, go, h('span', {}, m.title));
    }))] : [h('p', { class: 'd-muted' }, 'No one step takes most of the time.')]));
  };

  const load = async () => {
    try {
      const r = await studio.client.scriptProfile(script.id);
      if (!r.recording) {
        summary.textContent = 'This server isn\'t timing script runs. Profile a run to time each step.';
        return;
      }
      draw(r.profile, 'server');
    } catch (e) {
      summary.textContent = errorText(e);
    }
  };
  const run = async (b: HTMLButtonElement) => {
    b.disabled = true;
    summary.textContent = 'Running it on a copy of the file…';
    try {
      const r = await studio.client.profileScriptRun(script.id, {
        ...(parameter.value ? { parameter: parameter.value } : {}),
        ...(layout.value.trim() ? { layout: layout.value.trim() } : {}),
      });
      draw(r.profile, 'run');
      if (r.ended.error) toast(`The run ended with error ${r.ended.error}`, 'info');
    } catch (e) {
      summary.textContent = errorText(e);
    } finally {
      b.disabled = false;
    }
  };
  const runButton: HTMLButtonElement = button('Profile a run', () => void run(runButton), { title: 'Runs the script once now, offline on a throwaway copy of the file, and times each step' });
  void load();
  return h('div', { class: 'd-stack sp' },
    h('h3', {}, `Where ${script.name}'s time goes`),
    summary,
    slowest,
    h('div', { class: 'sp-run' }, field('Parameter', parameter), field('Layout', layout), runButton,
      button('Server runs', () => void load(), { title: 'The timings of this script\'s runs on the server' })),
    h('p', { class: 'd-hint' }, 'Timings hide while the editor has unsaved changes, since lines move.'),
  );
}
