// Custom menus (catalog 65) and custom menu sets (catalog 64).
//
// A menu's items are one record at key 7 of the menu node (a kv when short, a
// segment otherwise): 00 <count>, then one entry per item. Each entry is a
// 19-byte header, a marker byte, the item's node id as [n+1][n][bytes] (or a
// single 00 when the item has no node), a reference as [n+1][n][bytes] (the
// submenu for a submenu item, the script for a script-backed item), then
// padding: the next entry starts 34 + (node id length) bytes after the marker.
//
// Header: byte 0 is the item kind (0x00 command, 0x40 submenu, 0x80
// separator), byte 3 the overrides, bytes 6-7 the command id, byte 9 the
// shortcut key and byte 11 its modifiers. Override bits were matched against
// the item nodes' children across the sample files: 0x01 title (child 16
// holds the title formula), 0x02 shortcut, 0x08 action (a script). Child 37
// holds the "install when" formula and child 128/5 the script parameter.
//
// Everything here was read from private sample files; FileMaker documents none of it.

import { pathValue } from './chunks.ts';
import type { Node } from './tree.ts';

export interface CustomMenuItem {
  kind: 'command' | 'submenu' | 'separator';
  /** Commands: FileMaker's built-in command id, and its name where it is known. */
  commandId?: number;
  command?: string;
  /** The title formula, when the item overrides the command's title. */
  title?: string;
  /** The "install when" formula; the item is shown only when it is true. */
  installWhen?: string;
  /** Submenu items: the custom menu shown as the submenu. */
  submenuId?: number;
  submenu?: string;
  /** Items whose action is a script (instead of the command's own action). */
  scriptId?: number;
  script?: string;
  /** The script parameter formula. */
  parameter?: string;
  /** Keyboard shortcut override: the key, and modifiers (1 Shift, 4 Cmd/Ctrl; others not yet seen). */
  shortcut?: { key: string; modifiers: number };
  /** The raw override byte, for what isn't decoded yet (bits 0x10-0x40 look like platforms). */
  flags: number;
}

export interface CustomMenu {
  id: number;
  name: string;
  /** The standard FileMaker menu this one is based on (2 File, 3 Edit, 4 View, ...), as stored. */
  basedOn?: number;
  comment?: string;
  installWhen?: string;
  items: CustomMenuItem[];
}

export interface CustomMenuSet {
  id: number;
  name: string;
  comment?: string;
  /** The menus in the set, in menu bar order. */
  menuIds: number[];
}

/**
 * Names for the command ids found in the sample files. 0xe1xx are the
 * standard Windows (MFC) command ids. The rest are inferred: from item title
 * overrides ("Find Mode", "New Record", "Refresh Window"), from the scripts
 * that replace them ("Menu: Advanced Find - Constrain"), and from their
 * position in copies of the standard View and Records menus.
 */
export const MENU_COMMANDS: Record<number, string> = {
  0xe100: 'New', 0xe101: 'Open', 0xe102: 'Close', 0xe106: 'Print Setup', 0xe107: 'Print', 0xe120: 'Clear', 0xe122: 'Copy', 0xe123: 'Cut', 0xe125: 'Paste',
  0xe12a: 'Select All', 0xe140: 'About FileMaker Pro', 0xe146: 'Help',
  0xc003: 'Browse Mode', 0xc004: 'Preview Mode', 0xc005: 'Layout Mode', 0xc006: 'Find Mode',
  0xc0a8: 'Undo', 0xc0a9: 'Redo',
  0xc415: 'View as Form', 0xc416: 'View as List', 0xc417: 'View as Table',
  0xc015: 'Status Toolbar', 0xc0aa: 'Customize Status Toolbar', 0xc41c: 'Formatting Bar', 0xc066: 'Zoom In', 0xc067: 'Zoom Out',
  0xc3ed: 'New Record', 0xc3f1: 'Duplicate Record', 0xc3ee: 'Delete Record', 0xc3ef: 'Delete All Records',
  0xc3eb: 'Refresh Window', 0xc3f4: 'Show All Records', 0xc3f5: 'Show Omitted Only', 0xc3f3: 'Omit Record',
  0xc3f2: 'Omit Multiple', 0xc3fb: 'Modify Last Find', 0xc414: 'Sort Records', 0xc425: 'Unsort',
  0xc40e: 'Replace Field Contents', 0xc413: 'Relookup Field Contents', 0xc3f0: 'Revert Record',
  0xc3fc: 'Perform Find', 0xc426: 'Constrain Found Set', 0xc427: 'Extend Found Set',
};

/** What FileMaker stores when "install when" is left unset. */
const ALWAYS = new Set(['1', 'True']);

const KINDS: Record<number, CustomMenuItem['kind']> = { 0x00: 'command', 0x40: 'submenu', 0x80: 'separator' };

/** [n+1][n][bytes] at `at`: the value and the bytes it takes; a lone 00 is no value. */
function ref(b: Uint8Array, at: number): { value?: number; size: number } {
  const len = b[at];
  if (!len) return { size: 1 };
  return { value: len > 1 ? pathValue(b.subarray(at + 2, at + 1 + len)) : undefined, size: len + 1 };
}

/** The item entries of one menu's key-7 record. */
export function menuItems(b: Uint8Array | undefined): (CustomMenuItem & { node?: number })[] {
  const out: (CustomMenuItem & { node?: number })[] = [];
  if (!b || b.length < 2) return out;
  let at = 2;
  for (let i = 0; i < b[1] && at + 22 <= b.length; i++) {
    const marker = at + 19;
    const kind = KINDS[b[at]];
    const node = ref(b, marker + 1);
    const target = ref(b, marker + 1 + node.size);
    const item: CustomMenuItem & { node?: number } = { kind: kind ?? 'command', flags: b[at + 3] };
    if (node.value !== undefined) item.node = node.value;
    if (kind === 'command' || !kind) {
      // 0 for an item that only runs a script.
      const command = (b[at + 6] << 8) | b[at + 7];
      if (command) item.commandId = command;
      if (MENU_COMMANDS[command]) item.command = MENU_COMMANDS[command];
      if (item.flags & 0x08 && target.value) item.scriptId = target.value;
    } else if (kind === 'submenu' && target.value) item.submenuId = target.value;
    if (item.flags & 0x02 && b[at + 9]) item.shortcut = { key: String.fromCharCode(b[at + 9]), modifiers: b[at + 11] };
    out.push(item);
    at = marker + 15 + node.size;
  }
  return out;
}

/** Custom menus and menu sets, with item formulas read by `formula` and names resolved. */
export function readCustomMenus(
  menusNode: Node | undefined,
  setsNode: Node | undefined,
  formula: (n: Node | undefined) => string | undefined,
  scriptName: (id: number) => string | undefined,
  /** Key 24 of the sets catalog's node 1. */
  defaultSet?: Uint8Array,
): { menus: CustomMenu[]; sets: CustomMenuSet[]; defaultSetId?: number } {
  const menus: CustomMenu[] = [];
  for (const [id, m] of menusNode?.numbered() ?? []) {
    const menu: CustomMenu = { id, name: m.name ?? '', items: [] };
    const based = m.kv.get(2);
    if (based && based.length >= 4) menu.basedOn = (based[2] << 8) | based[3];
    const comment = m.text(3);
    if (comment) menu.comment = comment;
    const install = formula(m.child(37));
    if (install && !ALWAYS.has(install)) menu.installWhen = install;
    for (const { node, ...item } of menuItems(m.kv.get(7) ?? m.segments.get(7))) {
      const n = node !== undefined ? m.child(5, node) : undefined;
      if (n && item.flags & 0x01) {
        const title = formula(n.child(16));
        if (title) item.title = title;
      }
      const when = formula(n?.child(37));
      if (when && !ALWAYS.has(when)) item.installWhen = when;
      if (item.scriptId !== undefined) {
        const script = scriptName(item.scriptId);
        if (script) item.script = script;
        const parameter = formula(n?.child(128, 5));
        if (parameter) item.parameter = parameter;
      }
      menu.items.push(item);
    }
    menus.push(menu);
  }
  const names = new Map(menus.map((m) => [m.id, m.name]));
  for (const m of menus) for (const item of m.items) {
    if (item.submenuId !== undefined && names.has(item.submenuId)) item.submenu = names.get(item.submenuId);
  }
  const sets: CustomMenuSet[] = [];
  for (const [id, s] of setsNode?.numbered() ?? []) {
    if (s.name === undefined) continue; // node 1 holds only bookkeeping
    const set: CustomMenuSet = { id, name: s.name, menuIds: [] };
    const comment = s.text(3);
    if (comment) set.comment = comment;
    const b = s.kv.get(7);
    for (let at = 2; b && at < b.length;) {
      const r = ref(b, at);
      if (r.value !== undefined) set.menuIds.push(r.value);
      at += r.size;
    }
    sets.push(set);
  }
  // The default set as [n][id]: a private sample's custom sets,
  // and 1 (the standard menus) in files without custom sets.
  const def = defaultSet && defaultSet.length > 1 ? pathValue(defaultSet.subarray(1, 1 + defaultSet[0])) : undefined;
  return { menus, sets, ...(def !== undefined ? { defaultSetId: def } : {}) };
}
