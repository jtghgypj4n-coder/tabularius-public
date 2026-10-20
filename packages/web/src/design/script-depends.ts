// The script editor's Depends panel, which FileMaker doesn't have: what the script uses (fields, layouts, the
// scripts it performs, value lists, custom functions) with the lines that use each, what starts it (scripts,
// buttons, triggers, menus), and how it reaches outside the solution. Each field and layout answers "what breaks
// if I change this?" from the server's change impact check, across the whole file and the files that reach in.
import type { ScriptDependencies } from './client.ts';
import { h, button } from './dom.ts';
import { impactText } from './impact.ts';
import { errorText, type Studio } from './main.ts';

const KINDS: Record<ScriptDependencies['uses'][number]['kind'], string> = {
  field: 'Fields', layout: 'Layouts', script: 'Scripts it performs', valueList: 'Value lists', customFunction: 'Custom functions',
};
const HOW: Record<ScriptDependencies['startedBy'][number]['how'], string> = { script: 'Performed by script', button: 'Run from', trigger: 'Started by' };

export function dependsPanel(studio: Studio, script: { id: number; name: string }, selectLine: (n: number) => void): HTMLElement {
  const body = h('div', { class: 'd-stack', 'aria-live': 'polite' }, h('p', { class: 'd-hint' }, 'Reading what the script depends on…'));
  const lines = (ns: number[]) => h('span', { class: 'se-dep-lines' }, ...ns.slice(0, 12).map((n) => {
    const b = button(String(n), () => selectLine(n), { class: 'link', title: `Select line ${n}` });
    return h('span', {}, b, ' ');
  }), ns.length > 12 ? `+${ns.length - 12}` : '');
  /** What a rename or delete of a field or layout would break, shown under its row. */
  const breaks = (kind: 'field' | 'layout', name: string, under: HTMLElement) => {
    const box = h('div', { class: 'se-dep-impact' }, h('p', { class: 'd-hint' }, 'Checking every use in the file…'));
    under.append(box);
    void Promise.all([studio.client.impact(kind, name, 'rename'), studio.client.impact(kind, name, 'delete')]).then(([ren, del]) => {
      box.replaceChildren(h('strong', {}, 'If renamed'), h('pre', { class: 'se-dep-pre' }, impactText(ren)),
        h('strong', {}, 'If deleted'), h('pre', { class: 'se-dep-pre' }, impactText(del)));
    }, (e) => box.replaceChildren(h('p', { class: 'd-error' }, errorText(e))));
  };
  const load = async () => {
    let d: ScriptDependencies;
    try {
      d = await studio.client.scriptDependencies(script.id);
    } catch (e) {
      body.replaceChildren(h('p', { class: 'd-error' }, errorText(e)));
      return;
    }
    const groups = (Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => [k, d.uses.filter((u) => u.kind === k)] as const).filter(([, us]) => us.length);
    const byName = d.uses.filter((u) => u.byName);
    body.replaceChildren(
      h('p', { class: 'd-hint' }, d.uses.length
        ? `${d.uses.length} thing${d.uses.length === 1 ? '' : 's'} this script uses.` + (byName.length ? ` ${byName.length} ${byName.length === 1 ? 'is' : 'are'} named in text, which a rename doesn't reach.` : '') +
          ' Pick a field or layout to see what else would break if it changed.'
        : 'The script uses no fields, layouts or other scripts.'),
      ...groups.map(([k, us]) => h('div', {}, h('h4', {}, KINDS[k]), h('ul', { class: 'd-list se-dep-list' }, ...us.map((u) => {
        const li = h('li', {});
        const name = u.kind === 'field' || u.kind === 'layout'
          ? button(u.name, () => {
            const open = li.querySelector('.se-dep-impact');
            if (open) open.remove();
            else breaks(u.kind as 'field' | 'layout', u.name, li);
          }, { class: 'link', title: 'What breaks if this changes' })
          : h('span', {}, u.name);
        li.append(h('div', { class: 'se-dep-row' }, name, ...(u.byName ? [h('span', { class: 'se-dep-badge', title: 'Named in quotes (GetField, ExecuteSQL, a "by name" step): a rename doesn\'t change it' }, 'by name')] : []),
          h('span', { class: 'd-muted' }, u.lines.length === 1 ? 'line ' : 'lines '), lines(u.lines)));
        return li;
      })))),
      h('div', {}, h('h4', {}, 'What starts it'), d.startedBy.length
        ? h('ul', { class: 'd-list se-dep-list' }, ...d.startedBy.map((x) => h('li', {}, h('span', { class: 'd-muted' }, `${HOW[x.how]} `), x.name)))
        : h('p', { class: 'd-hint' }, 'Nothing in the file starts it: no script performs it, and no button, trigger or menu runs it.')),
      ...(d.outbound.length ? [h('div', {}, h('h4', {}, 'Reaches outside the file'), h('p', { class: 'd-hint' }, d.outbound.join(', ')))] : []));
  };
  void load();
  return h('div', { class: 'd-stack' }, h('h3', {}, 'Depends'), body);
}
