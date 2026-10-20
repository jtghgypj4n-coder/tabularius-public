// Extended privileges: custom "ways in" a privilege set can grant, beyond
// Tabularius's own fmapp/fmwebdirect/fmrest/fmxml/fmmcp/fmurlscript. As in FileMaker's
// Manage Security, this is its own tab: add one here, then grant it to a set
// in the Privilege sets tab's "Extended privileges" section.

import { h, button, toast } from '../design/dom.ts';
import { explain, type Sec } from './main.ts';

export function extendedPrivilegesTab(sec: Sec): HTMLElement {
  const { customExtendedPrivileges } = sec.security;

  const row = (e: { id: number; name: string; grantedBy: string[] }) => {
    const nameInput = h('input', { value: e.name, 'aria-label': `Rename ${e.name}` }) as HTMLInputElement;
    const rename = button('Rename', () => {
      const name = nameInput.value.trim();
      if (!name || name === e.name) return;
      void sec.apply([{ op: 'updateExtendedPrivilege', extendedPrivilege: e.id, name }], `Renamed to "${name}"`);
    }, { title: 'Rename this extended privilege; every set granting it keeps the grant under the new name' });
    const del = button('Delete…', () => {
      if (confirm(e.grantedBy.length
        ? `Delete extended privilege "${e.name}"? It is currently granted by: ${e.grantedBy.join(', ')}. Those sets lose it.`
        : `Delete extended privilege "${e.name}"?`)) {
        void sec.apply([{ op: 'deleteExtendedPrivilege', extendedPrivilege: e.id }], 'Extended privilege deleted');
      }
    }, { class: 'danger' });
    return h('tr', {},
      h('td', {}, nameInput, rename),
      h('td', {}, e.grantedBy.length ? e.grantedBy.join(', ') : h('span', { class: 'd-muted' }, 'no privilege set grants it')),
      h('td', {}, del),
    );
  };

  const table = customExtendedPrivileges.length
    ? h('table', { class: 'sec-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Granted by'), h('th', {}, ''))),
        h('tbody', {}, ...customExtendedPrivileges.map(row)))
    : h('p', { class: 'd-muted' }, 'No custom extended privileges yet. Tabularius\'s own (web client, Data API, AI/MCP, XML) always show up as choices in a privilege set\'s Extended privileges list.');

  const newName = h('input', { placeholder: 'New extended privilege name', 'aria-label': 'New extended privilege name' });
  const create = h('form', { class: 'd-inline-form' }, newName, button('Create', () => create.requestSubmit(), { class: 'primary' }));
  create.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newName.value.trim();
    if (!name) return;
    if (await sec.apply([{ op: 'createExtendedPrivilege', name }], `Created "${name}"`)) {
      newName.value = '';
    } else {
      toast(`Couldn't create "${name}"`);
    }
  });

  return h('div', { class: 'd-stack' },
    h('div', { class: 'd-heading' },
      h('h2', {}, 'Extended privileges'),
      h('span', { class: 'd-spacer' }),
      ...explain(sec, 'Explain what a privilege set\'s extended privileges control, and how a custom one differs from Tabularius\'s own (fmapp, fmwebdirect, fmrest, fmxml, fmmcp, fmurlscript).')),
    h('p', { class: 'd-hint' }, 'Grant or revoke one for a privilege set in the Privilege sets tab, under "Extended privileges".'),
    table,
    create,
  );
}
