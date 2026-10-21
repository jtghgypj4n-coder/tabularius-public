import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands, shortcutItem, shortcutText, standardMenus } from '../src/menubar.ts';
import type { CustomMenu } from '../src/types.ts';

const menus: CustomMenu[] = [
  { title: 'View', items: [
    { kind: 'command', title: 'Back', run: [27, 0], shortcut: { key: '[', modifiers: 4 } },
    { kind: 'separator' },
    { kind: 'command', command: 'Find Mode', title: 'Find Mode', run: [27, 4] },
    { kind: 'submenu', items: [{ kind: 'command', command: 'Refresh Window', shortcut: { key: 'R', modifiers: 5 } }] },
  ] },
];

test('custom menu shortcuts and commands', () => {
  const key = (key: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({ key, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt });
  assert.equal(shortcutItem(menus, key('[', { ctrl: true }))?.title, 'Back');
  assert.equal(shortcutItem(menus, key('['))?.title, undefined);
  assert.equal(shortcutItem(menus, key('r', { ctrl: true, shift: true }))?.command, 'Refresh Window');
  assert.equal(shortcutItem(menus, key('r', { ctrl: true })), undefined);
  assert.deepEqual([...commands(menus).keys()], ['Find Mode', 'Refresh Window']);
  assert.deepEqual(commands(menus).get('Find Mode')?.run, [27, 4]);
  assert.equal(shortcutText({ key: 'r', modifiers: 5 }, true), '⇧⌘R');
  assert.equal(shortcutText({ key: '[', modifiers: 4 }, false), 'Ctrl+[');
});

test('custom shortcuts match Alt as well as the other advertised modifiers', () => {
  const altOnly: CustomMenu[] = [{ title: 'Custom', items: [
    { kind: 'command', title: 'Alt command', shortcut: { key: 's', modifiers: 12 } },
    { kind: 'command', title: 'Plain command', shortcut: { key: 's', modifiers: 4 } },
  ] }];
  const event = (altKey: boolean) => ({ key: 's', shiftKey: false, metaKey: false, ctrlKey: true, altKey });
  assert.equal(shortcutItem(altOnly, event(false))?.title, 'Plain command');
  assert.equal(shortcutItem(altOnly, event(true))?.title, 'Alt command');
  assert.equal(shortcutItem([{ title: 'Custom', items: [...altOnly[0].items].reverse() }], event(false))?.title, 'Plain command');
  assert.equal(shortcutItem(altOnly, { ...event(true), getModifierState: (key) => key === 'AltGraph' }), undefined);
});

test('standard menus: Records in Browse mode, Requests in Find mode', () => {
  const browse = standardMenus('browse');
  assert.deepEqual(browse.map((m) => m.title), ['File', 'Edit', 'View', 'Insert', 'Format', 'Records', 'Scripts', 'Tools', 'Window', 'Help']);
  const records = commands(browse);
  for (const c of ['New Record', 'Delete All Records', 'Omit Multiple', 'Replace Field Contents', 'Modify Last Find', 'Sort Records']) assert.ok(records.has(c), c);
  assert.deepEqual(records.get('Omit Record')!.shortcut, { key: 'T', modifiers: 4 });
  // Format > Style: ⇧⌘B bold, as in FileMaker (⌘B stays Browse Mode).
  assert.deepEqual(records.get('Bold')!.shortcut, { key: 'B', modifiers: 5 });
  assert.deepEqual(records.get('Browse Mode')!.shortcut, { key: 'B', modifiers: 4 });
  // View > Layout Mode is ⌘L, as in FileMaker: it opens this layout in the layout editor.
  assert.deepEqual(records.get('Layout Mode')!.shortcut, { key: 'L', modifiers: 4 });
  // FileMaker's other shortcuts: ⇧⌘R Refresh Window, ⇧⌘T Omit Multiple, ⌘= Replace, ⇧⌘S Script Workspace, ⌥⌘S Status Toolbar.
  assert.deepEqual(records.get('Refresh Window')!.shortcut, { key: 'R', modifiers: 5 });
  assert.deepEqual(records.get('Omit Multiple')!.shortcut, { key: 'T', modifiers: 5 });
  assert.deepEqual(records.get('Script Workspace')!.shortcut, { key: 'S', modifiers: 5 });
  assert.deepEqual(records.get('Status Toolbar')!.shortcut, { key: 'S', modifiers: 12 });
  assert.equal(shortcutText(records.get('Status Toolbar')!.shortcut!, true), '⌥⌘S');
  // File > Manage > Layouts… and Window > Show Window, as in FileMaker.
  assert.equal(records.get('Manage Layouts')!.title, 'Layouts…');
  assert.ok(browse.find((m) => m.title === 'Window')!.items.some((i) => i.kind === 'submenu' && i.title === 'Show Window'));
  // File > Open Quickly is ⌘K, as in FileMaker Pro.
  assert.deepEqual(records.get('Open Quickly')!.shortcut, { key: 'K', modifiers: 4 });
  const find = standardMenus('find');
  assert.deepEqual(find.map((m) => m.title), ['File', 'Edit', 'View', 'Insert', 'Requests', 'Scripts', 'Tools', 'Window', 'Help']);
  assert.equal(commands(find).get('New Record')!.title, 'Add New Request');
  assert.deepEqual(records.get('Redo')!.shortcut, { key: 'Z', modifiers: 5 });
  assert.ok(['Undo', 'Cut', 'Copy', 'Paste', 'Clear', 'Select All'].every((c) => commands(find).has(c)));
  assert.ok(commands(find).has('Constrain Found Set') && !commands(find).has('Delete All Records'));
  // Insert: ⌘- date, ⇧⌘N user name; From Last Visited Record only browses.
  assert.deepEqual(records.get('Current Date')!.shortcut, { key: '-', modifiers: 4 });
  assert.deepEqual(records.get('Current User Name')!.shortcut, { key: 'N', modifiers: 5 });
  assert.ok(records.has('From Last Visited Record') && !commands(find).has('From Last Visited Record') && commands(find).has('From Index'));
});

test('standard menus: Manage > Calendar Feeds is only there for an account that may use it; Import Calendar is with Import Records', () => {
  for (const mode of ['browse', 'find'] as const) {
    assert.ok(!commands(standardMenus(mode)).has('Manage Calendar Feeds'), `${mode}: not offered by default`);
    assert.ok(!commands(standardMenus(mode, [], { feeds: false })).has('Manage Calendar Feeds'));
    assert.equal(commands(standardMenus(mode, [], { feeds: true })).get('Manage Calendar Feeds')?.title, 'Calendar Feeds…');
    assert.equal(commands(standardMenus(mode)).get('Import Calendar')?.title, 'Import Calendar (.ics)…');
  }
  // It sits in File > Manage, beside Security and Layouts.
  const manage = standardMenus('browse', [], { feeds: true })[0].items.find((i) => i.kind === 'submenu' && i.title === 'Manage')!;
  assert.deepEqual(manage.items!.map((i) => i.title), ['Database…', 'Security…', 'Layouts…', 'Calendar Feeds…']);
});

test('standard menus: File > Import Tables is only there for an account that may use it, beside Import Records', () => {
  for (const mode of ['browse', 'find'] as const) {
    assert.ok(!commands(standardMenus(mode)).has('Import Tables'), `${mode}: not offered by default`);
    assert.ok(!commands(standardMenus(mode, [], { tables: false })).has('Import Tables'));
    assert.equal(commands(standardMenus(mode, [], { tables: true })).get('Import Tables')?.title, 'Import Tables…');
  }
  const file = standardMenus('browse', [], { tables: true })[0].items.filter((i) => i.kind === 'command').map((i) => i.title);
  assert.deepEqual(file.slice(file.indexOf('Import Records…'), file.indexOf('Import Records…') + 4), ['Import Records…', 'Import Calendar (.ics)…', 'Import Tables…', 'Export Records…']);
});
