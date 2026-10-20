// Before renaming or deleting a field, table, layout, script or value list: what it would break, from the server's
// change impact check (uses in the file, privilege set entries, Data API clients in the log). A panel to look
// before changing anything, and the sentences the rename and delete confirmations show.

import type { ChangeImpact } from './client.ts';
import { h, button } from './dom.ts';
import { errorText, type Studio } from './main.ts';

export type ImpactKind = 'field' | 'table' | 'layout' | 'script' | 'valueList';

const breaking = (r: ChangeImpact) => r.uses.some((u) => u.breaks) || r.privileges.some((p) => p.breaks) || r.clients.length > 0;

/** The impact as text for a confirmation: the summary and the first few things that break. */
export function impactText(r: ChangeImpact): string {
  const items = [
    ...r.clients.map((c) => `Data API, ${c.account}: ${c.calls} call${c.calls === 1 ? '' : 's'} through ${c.via}`),
    ...r.privileges.filter((p) => p.breaks).map((p) => `Privilege set ${p.privilegeSet}: ${p.entry}`),
    ...r.uses.filter((u) => u.breaks).map((u) => u.where),
  ];
  return [...r.summary, ...(items.length ? ['', ...items.slice(0, 8).map((x) => `  • ${x}`), ...(items.length > 8 ? [`  • and ${items.length - 8} more`] : [])] : [])].join('\n');
}

/** The impact sentences for a confirmation, or '' when they can't be had (the change goes ahead as before). */
export async function impactNote(studio: Studio, kind: ImpactKind, name: string, change: 'rename' | 'delete'): Promise<string> {
  try {
    return impactText(await studio.client.impact(kind, name, change));
  } catch {
    return '';
  }
}

/** Asks before a rename that breaks something; true to go ahead. */
export async function confirmRename(studio: Studio, kind: ImpactKind, name: string, to: string): Promise<boolean> {
  let r: ChangeImpact;
  try {
    r = await studio.client.impact(kind, name, 'rename');
  } catch {
    return true;
  }
  return !breaking(r) || confirm(`Rename "${name}" to "${to}"?\n\n${impactText(r)}`);
}

/** "What would break": loaded when opened, for a rename or a delete, with the AI's summary on request. */
export function impactPanel(studio: Studio, kind: ImpactKind, name: string): HTMLElement {
  const body = h('div', { class: 'd-stack' });
  const box = h('details', { class: 'd-report d-impact' }, h('summary', {}, 'What would break if renamed or deleted'), body);
  const show = async (change: 'rename' | 'delete') => {
    body.replaceChildren(h('p', { class: 'd-muted' }, 'Checking…'));
    try {
      const r = await studio.client.impact(kind, name, change);
      const other = change === 'rename' ? 'delete' : 'rename';
      const rows = [
        ...r.clients.map((c) => h('li', { class: 'd-impact-bad' }, h('strong', {}, `Data API, ${c.account}`), ` · ${c.calls} call${c.calls === 1 ? '' : 's'} through ${c.via}, last ${new Date(c.last.replace(' ', 'T').replace(/ ([+-])/, '$1')).toLocaleString()}`)),
        ...r.privileges.map((p) => h('li', p.breaks ? { class: 'd-impact-bad' } : {}, h('strong', {}, `Privilege set ${p.privilegeSet}`), ` · ${p.entry}`, h('br'), h('span', { class: 'd-muted' }, p.why))),
        ...r.uses.map((u) => h('li', u.breaks ? { class: 'd-impact-bad' } : {}, h('strong', {}, u.where), h('br'), h('code', {}, u.text), h('br'), h('span', { class: 'd-muted' }, u.why))),
      ];
      body.replaceChildren(
        h('div', { class: 'd-impact-summary' }, ...r.summary.map((line) => h('p', {}, line))),
        ...(rows.length ? [h('ul', {}, ...rows)] : []),
        ...(r.useCount > r.uses.length ? [h('p', { class: 'd-muted' }, `Showing ${r.uses.length} of ${r.useCount} uses in the file.`)] : []),
        h('div', { class: 'd-actions' },
          button(change === 'rename' ? 'If deleted instead' : 'If renamed instead', () => void show(other), { class: 'quiet' }),
          ...(studio.ask ? [button('Ask AI what would break', () => void studio.ask!(`What would break if I ${change} the ${kind === 'valueList' ? 'value list' : kind} "${name}"? ` +
            'Call check_change_impact, then say in plain words what stops working, for whom, and what to change first so nothing breaks.'))] : [])));
    } catch (e) {
      body.replaceChildren(h('p', { class: 'd-muted' }, errorText(e)));
    }
  };
  box.addEventListener('toggle', () => {
    if (box.open && !body.childElementCount) void show('rename');
  });
  return box;
}
