// Manage Custom Menus: menus (commands, submenus and separators, each
// optionally running a script) and menu sets, plus the set the file opens with.

import type { DesignMenu, DesignMenuItem, DesignMenuSet } from './client.ts';
import { h, button, select, field, check } from './dom.ts';
import { createForm, renameRow } from './catalog.ts';
import type { Studio } from './main.ts';

/** Modifier bits as the reader stores them. */
const SHIFT = 1;
const CMD = 4;

export function menusTab(studio: Studio): HTMLElement {
  const d = studio.design;
  const menus = d.customMenus ?? [];
  const sets = d.customMenuSets ?? [];
  const set = sets.find((s) => s.id === studio.selected.menuSet);
  const menu = set ? undefined : menus.find((m) => m.id === studio.selected.menu) ?? menus[0];

  const item = (label: string, sub: string, selected: boolean, pick: () => void) => {
    const li = h('li', { class: selected ? 'selected' : '' }, h('button', { type: 'button' }, h('span', {}, label), h('span', { class: 'd-count' }, sub)));
    li.querySelector('button')!.addEventListener('click', pick);
    return li;
  };
  const menuList = h('ul', { class: 'd-list' }, ...menus.map((m) => item(m.name, `${m.items.length} items`, m === menu, () => {
    studio.selected.menu = m.id;
    studio.selected.menuSet = undefined;
    studio.render();
  })));
  const setList = h('ul', { class: 'd-list' }, ...sets.map((s) => item(s.name, `${s.menuIds.length} menus${s.id === d.defaultMenuSetId ? ' · default' : ''}`, s === set, () => {
    studio.selected.menuSet = s.id;
    studio.render();
  })));
  const createMenu = createForm(studio, 'menu', 'New menu name', [], (name) => ({ op: 'createCustomMenu', name, items: [] }),
    (n) => studio.design.customMenus?.find((m) => m.name === n)?.id);
  const createSet = createForm(studio, 'menuSet', 'New menu set name', [], (name) => ({ op: 'createMenuSet', name, menus: [] }),
    (n) => studio.design.customMenuSets?.find((m) => m.name === n)?.id);
  const defaultSet = select([['', '[Standard FileMaker Menus]'], ...sets.map((s) => [String(s.id), s.name] as [string, string])],
    d.defaultMenuSetId ? String(d.defaultMenuSetId) : '', { 'aria-label': 'Default menu set' });
  defaultSet.addEventListener('change', () => void studio.apply([{ op: 'setDefaultMenuSet', menuSet: defaultSet.value ? Number(defaultSet.value) : null }], 'Default menu set saved'));

  const side = h('aside', { class: 'd-side' },
    h('h2', {}, 'Custom menus'), menuList, createMenu,
    h('h2', {}, 'Menu sets'), setList, createSet,
    field('File opens with', defaultSet));
  const main = h('section', { class: 'd-main' }, ...(set ? setDetail(studio, set) : menu ? menuDetail(studio, menu) : [h('p', { class: 'd-muted' }, 'No custom menus yet. Create one, then put it in a menu set.')]));
  return h('div', { class: 'd-split' }, side, main);
}

function menuDetail(studio: Studio, menu: DesignMenu): HTMLElement[] {
  const d = studio.design;
  const rows = h('div', { class: 'd-stack d-menu-items' });
  const commands = (d.menuCommands ?? []).map((c) => [String(c.id), c.name] as [string, string]);
  const scripts = d.scripts.map((s) => [String(s.id), s.name] as [string, string]);
  const others = (d.customMenus ?? []).filter((m) => m.id !== menu.id).map((m) => [String(m.id), m.name] as [string, string]);

  const addRow = (it: DesignMenuItem) => {
    const row = h('div', { class: 'd-menu-item' });
    let get: () => Record<string, unknown>;
    if (it.kind === 'separator') {
      row.append(h('span', { class: 'd-muted d-menu-sep' }, '— separator —'));
      get = () => ({ kind: 'separator', flags: it.flags });
    } else {
      const title = h('input', { value: it.title ?? '', placeholder: it.command ?? it.submenu ?? it.script ?? 'Title (formula)', 'aria-label': 'Title (formula)', class: 'd-code' });
      const when = h('input', { value: it.installWhen ?? '', placeholder: 'Always', 'aria-label': 'Install when (formula)', class: 'd-code' });
      const parts: HTMLElement[] = [];
      let target: () => Record<string, unknown>;
      if (it.kind === 'submenu') {
        const sub = select(others, String(it.submenuId ?? others[0]?.[0] ?? ''), { 'aria-label': 'Submenu' });
        parts.push(field('Submenu', sub));
        target = () => ({ kind: 'submenu', submenu: Number(sub.value) });
      } else {
        // Ids the reader found but can't name yet stay selectable.
        const known = it.commandId !== undefined && !commands.some(([id]) => Number(id) === it.commandId) ? [[String(it.commandId), `Command ${it.commandId}`] as [string, string]] : [];
        const command = select([['', '(no command)'], ...known, ...commands], it.commandId !== undefined ? String(it.commandId) : '', { 'aria-label': 'Command' });
        const script = select([['', '(no script)'], ...scripts], it.scriptId !== undefined ? String(it.scriptId) : '', { 'aria-label': 'Script' });
        const parameter = h('input', { value: it.parameter ?? '', placeholder: 'Parameter (formula)', 'aria-label': 'Script parameter', class: 'd-code' });
        const key = h('input', { value: it.shortcut?.key ?? '', maxlength: '1', class: 'd-key', 'aria-label': 'Shortcut key' });
        const cmd = check('⌘/Ctrl', !!it.shortcut && !!(it.shortcut.modifiers & CMD));
        const shift = check('Shift', !!it.shortcut && !!(it.shortcut.modifiers & SHIFT));
        parts.push(field('Command', command), field('Runs script', script), parameter, h('div', { class: 'd-row' }, h('span', { class: 'd-label' }, 'Shortcut'), key, cmd.el, shift.el));
        target = () => ({
          kind: 'command', ...(command.value ? { commandId: Number(command.value) } : {}), ...(script.value ? { scriptId: Number(script.value), parameter: parameter.value } : {}),
          shortcut: key.value.trim() ? { key: key.value.trim(), modifiers: (cmd.input.checked ? CMD : 0) | (shift.input.checked ? SHIFT : 0) } : null,
        });
      }
      row.append(field('Title', title), ...parts, field('Install when', when));
      get = () => ({ ...target(), title: title.value, installWhen: when.value, flags: it.flags });
    }
    const controls = h('div', { class: 'd-actions' },
      button('↑', () => { row.previousElementSibling?.before(row); }, { title: 'Move up', class: 'quiet' }),
      button('↓', () => { row.nextElementSibling?.after(row); }, { title: 'Move down', class: 'quiet' }),
      button('Remove', () => row.remove(), { class: 'quiet' }));
    row.append(controls);
    (row as HTMLElement & { read?: () => Record<string, unknown> }).read = get;
    rows.append(row);
  };
  menu.items.forEach(addRow);

  const installWhen = h('input', { value: menu.installWhen ?? '', placeholder: 'Always', 'aria-label': 'Menu install when', class: 'd-code' });
  const save = button('Save menu', () => {
    const items = [...rows.children].map((r) => (r as HTMLElement & { read: () => Record<string, unknown> }).read());
    void studio.apply([{ op: 'updateCustomMenu', customMenu: menu.id, items, installWhen: installWhen.value }], 'Menu saved');
  }, { class: 'primary' });
  return [
    renameRow(studio, menu.name, (name) => ({ op: 'updateCustomMenu', customMenu: menu.id, name }), () => {
      if (confirm(`Delete custom menu "${menu.name}"? It leaves the menu sets that show it.`)) {
        studio.selected.menu = undefined;
        void studio.apply([{ op: 'deleteCustomMenu', customMenu: menu.id }], 'Menu deleted');
      }
    }, 'Menu', `Explain the custom menu "${menu.name}": what each item does, when it shows, and which menu sets use it.`),
    field('Install when', installWhen, 'The menu shows only when this formula is true'),
    rows,
    h('div', { class: 'd-actions' },
      button('Add command', () => addRow({ kind: 'command', flags: 0, commandId: (studio.design.menuCommands ?? [])[0]?.id })),
      button('Add script item', () => addRow({ kind: 'command', flags: 0, scriptId: studio.design.scripts[0]?.id })),
      others.length ? button('Add submenu', () => addRow({ kind: 'submenu', flags: 0, submenuId: Number(others[0][0]) })) : undefined,
      button('Add separator', () => addRow({ kind: 'separator', flags: 0 }))),
    h('div', { class: 'd-actions' }, save),
  ];
}

function setDetail(studio: Studio, set: DesignMenuSet): HTMLElement[] {
  const menus = studio.design.customMenus ?? [];
  const list = h('ol', { class: 'd-stack d-set-menus' });
  const ordered = [...set.menuIds.map((id) => menus.find((m) => m.id === id)).filter((m): m is DesignMenu => !!m), ...menus.filter((m) => !set.menuIds.includes(m.id))];
  for (const m of ordered) {
    const on = check(m.name, set.menuIds.includes(m.id));
    const li = h('li', { class: 'd-row', 'data-id': String(m.id) }, on.el,
      button('↑', () => { li.previousElementSibling?.before(li); }, { title: 'Move left in the menu bar', class: 'quiet' }),
      button('↓', () => { li.nextElementSibling?.after(li); }, { title: 'Move right in the menu bar', class: 'quiet' }));
    list.append(li);
  }
  const save = button('Save menu set', () => {
    const ids = [...list.children].filter((li) => (li.querySelector('input') as HTMLInputElement).checked).map((li) => Number((li as HTMLElement).dataset.id));
    void studio.apply([{ op: 'updateMenuSet', menuSet: set.id, menus: ids }], 'Menu set saved');
  }, { class: 'primary' });
  return [
    renameRow(studio, set.name, (name) => ({ op: 'updateMenuSet', menuSet: set.id, name }), () => {
      if (confirm(`Delete menu set "${set.name}"?`)) {
        studio.selected.menuSet = undefined;
        void studio.apply([{ op: 'deleteMenuSet', menuSet: set.id }], 'Menu set deleted');
      }
    }, 'Menu set', `Explain the menu set "${set.name}": which menus it has, what they change from FileMaker's standard menus, and which layouts or scripts install it.`),
    h('p', { class: 'd-muted' }, 'Ticked menus make up the menu bar, in this order.'),
    usedBy(studio, set),
    menus.length ? list : h('p', { class: 'd-muted' }, 'Create a custom menu first.'),
    h('div', { class: 'd-actions' }, save),
  ];
}

/** Where a menu set shows: the file's default, and layouts whose Layout Setup names it. */
function usedBy(studio: Studio, set: DesignMenuSet): HTMLElement {
  const d = studio.design;
  const layouts = d.layouts.filter((l) => l.menuSetId === set.id).map((l) => l.name);
  const where = [...(d.defaultMenuSetId === set.id ? ['the file opens with it'] : []), ...(layouts.length ? [`layouts: ${layouts.join(', ')}`] : [])];
  return h('p', { class: 'd-muted' }, where.length ? `Used by ${where.join('; ')}.` : 'No layout uses it yet: pick it in a layout\'s inspector (Menu set), or run Install Menu Set.');
}
