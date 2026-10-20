import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuItems } from '../src/index.ts';
import { readCustomMenus } from '../src/menus.ts';
import { Node } from '../src/tree.ts';

const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
/** One item entry: a 19-byte header, the marker, node and target refs, and padding to the next entry. */
const entry = (header: string, refs: string, nodeSize: number) => {
  const h = hex(header);
  const r = hex(refs);
  return Buffer.concat([h, Buffer.of(0x40), r, Buffer.alloc(14 + nodeSize - r.length)]);
};

// Entries as stored in two private samples' custom menus.
const RECORD = Buffer.concat([
  Buffer.of(0x00, 0x04),
  // A script-only item with a ⌘[ shortcut, node 4, running script 466 (81 52).
  entry('0000004b 00000000 005b0004000100040000 40', '020104 03028152', 3),
  entry('80000030 00000000 00000000000100000000 00', '00 020100', 1),
  entry('40000030 00000000 00000000000100000000 00', '00 020107', 1),
  // Find Mode with its title overridden and a script as its action.
  entry('00000049 0000c006 00000000000100020000 00', '020101 0302828c', 3),
]);

test('custom menu items: commands, separators, submenus, scripts and shortcuts', () => {
  const items = menuItems(RECORD);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], { kind: 'command', flags: 0x4b, node: 4, scriptId: 466, shortcut: { key: '[', modifiers: 4 } });
  assert.deepEqual(items[1], { kind: 'separator', flags: 0x30 });
  assert.deepEqual(items[2], { kind: 'submenu', flags: 0x30, submenuId: 7 });
  assert.deepEqual(items[3], { kind: 'command', flags: 0x49, node: 1, commandId: 0xc006, command: 'Find Mode', scriptId: 780 });
});

test('custom menus and menu sets: formulas, names and the set menu list', () => {
  const node = (kv: Record<number, Uint8Array> = {}, children: Record<number, Node> = {}) => {
    const n = new Node();
    for (const [k, v] of Object.entries(kv)) n.kv.set(+k, v);
    for (const [k, c] of Object.entries(children)) n.children.set(+k, c);
    return n;
  };
  const xor = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'), (b) => b ^ 0x5a);
  const calc = (text: string) => node({ 5: Buffer.from(text) });
  const item1 = node({}, { 16: calc('"Find Mode"'), 37: calc('1') });
  const item4 = node({}, { 37: calc('Get ( AccountName ) = "Admin"'), 128: node({}, { 5: calc('"Backward"') }) });
  const menus = node({}, {
    7: node({ 16: xor('[Go to Layout]') }),
    27: node({ 2: hex('0000000400000038'), 7: RECORD, 16: xor('View User') }, { 5: node({}, { 1: item1, 4: item4 }) }),
  });
  const sets = node({}, { 2: node({ 7: hex('0002 020119 02011b'), 16: xor('User Default'), 3: xor('main') }) });
  // Formulas come from a stand-in: plain text here instead of calc tokens.
  const formula = (n: Node | undefined) => (n?.kv.has(5) ? Buffer.from(n.kv.get(5)!).toString() : undefined);
  const { menus: [goTo, view], sets: [set], defaultSetId } = readCustomMenus(menus, sets, formula, (id) => (id === 466 ? 'Browser Nav' : undefined), hex('011e'));
  assert.equal(defaultSetId, 30);
  assert.equal(goTo.name, '[Go to Layout]');
  assert.equal(view.basedOn, 4);
  assert.deepEqual(view.items[0], { kind: 'command', flags: 0x4b, scriptId: 466, script: 'Browser Nav', parameter: '"Backward"', installWhen: 'Get ( AccountName ) = "Admin"', shortcut: { key: '[', modifiers: 4 } });
  assert.equal(view.items[2].submenu, '[Go to Layout]');
  assert.equal(view.items[3].title, '"Find Mode"');
  assert.equal(view.items[3].installWhen, undefined); // "1" is FileMaker's always
  assert.deepEqual(set, { id: 2, name: 'User Default', comment: 'main', menuIds: [25, 27] });
});
