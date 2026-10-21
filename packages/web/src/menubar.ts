// The file's custom menu set, drawn as a menu bar above the status toolbar.
// Items run their script on the server, or the web client's own version of
// the FileMaker command; commands the web client can't do show greyed out.

import type { CustomMenu, CustomMenuItem, ScriptsMenuEntry } from './types.ts';
import { PRODUCT_NAME } from './brand.ts';

/** What the menu bar asks the app to do. */
export interface MenuHost {
  /** Runs a FileMaker command; false when the web client can't. */
  command(name: string, run: boolean): boolean;
  /** Runs a script-backed item. */
  script(item: CustomMenuItem): void;
  /** Items of a built-in submenu, such as "[Go to Layout]". */
  builtin(name: string): { title: string; checked?: boolean; run: () => void }[] | undefined;
}

/**
 * Keys a page can't take from the browser while it is a tab: ⌘/Ctrl+N, T and W, with or without Shift (new window,
 * new tab, close tab; private window, reopen tab, close window). Chrome, Firefox and Safari keep these for themselves,
 * so a menu item that advertises one would never run in a tab. FileMaker's New Record, Omit Record and Close are on
 * N, T and W, so in a tab the web client shows (and answers) the same key with Alt added.
 */
export const BROWSER_RESERVED_KEYS = ['n', 't', 'w'];

/** Whether the page is an ordinary browser tab, not an installed app window (where the browser leaves these keys alone). */
export function inBrowserTab(): boolean {
  return typeof matchMedia === 'function' && !matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)').matches;
}

/** The shortcut to show and answer: the same key with Alt added when a browser tab would swallow it. */
export function tabShortcut(s: NonNullable<CustomMenuItem['shortcut']>, tab = inBrowserTab()): NonNullable<CustomMenuItem['shortcut']> {
  return tab && s.modifiers & 4 && !(s.modifiers & 8) && BROWSER_RESERVED_KEYS.includes(s.key.toLowerCase()) ? { ...s, modifiers: s.modifiers | 8 } : s;
}

/**
 * A key press with Alt added to a browser-reserved key, as the plain key press it stands for (Alt changes the letter
 * on a Mac, so the key comes from the physical key). Undefined for anything else, or when Alt is AltGr, which types
 * letters.
 */
export function withoutTabAlt(e: KeyboardEvent, tab = inBrowserTab()): KeyboardEvent | undefined {
  if (!tab || !e.altKey || !(e.metaKey || e.ctrlKey) || e.getModifierState?.('AltGraph')) return undefined;
  const letter = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : '';
  if (!BROWSER_RESERVED_KEYS.includes(letter)) return undefined;
  const plain = new KeyboardEvent('keydown', { key: letter, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: false, bubbles: true, cancelable: true });
  Object.defineProperty(plain, 'target', { value: e.target });
  return plain;
}

/** "⌘[" or "Ctrl+[" for a shortcut. */
export function shortcutText(shortcut: NonNullable<CustomMenuItem['shortcut']>, mac = /Mac/.test(navigator.platform), tab = inBrowserTab()): string {
  const s = tabShortcut(shortcut, tab);
  const parts: string[] = [];
  if (s.modifiers & 8) parts.push(mac ? '⌥' : 'Alt+');
  if (s.modifiers & 1) parts.push(mac ? '⇧' : 'Shift+');
  if (s.modifiers & 4) parts.push(mac ? '⌘' : 'Ctrl+');
  return parts.join('') + s.key.toUpperCase();
}

/** The item a key press runs, if a shortcut matches. */
export function shortcutItem(menus: CustomMenu[], e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; getModifierState?: (key: string) => boolean }): CustomMenuItem | undefined {
  if (e.getModifierState?.('AltGraph')) return undefined;
  const mod = e.metaKey || e.ctrlKey;
  const find = (items: CustomMenuItem[]): CustomMenuItem | undefined => {
    for (const it of items) {
      const s = it.shortcut;
      if (s && s.key.toLowerCase() === e.key.toLowerCase() && !!(s.modifiers & 4) === mod && !!(s.modifiers & 1) === e.shiftKey && !!(s.modifiers & 8) === e.altKey) return it;
      const sub = it.items && find(it.items);
      if (sub) return sub;
    }
    return undefined;
  };
  for (const m of menus) {
    const it = find(m.items);
    if (it) return it;
  }
  return undefined;
}

/**
 * FileMaker's standard menus, for files that use [Standard FileMaker Menus]:
 * the commands the web client does, under the menus FileMaker puts them in.
 * Find mode has a Requests menu where Browse mode has Records. `feeds` adds Manage > Calendar Feeds and `tables` adds
 * File > Import Tables…, which only an account with Full Access is offered (the server refuses anyone else).
 */
export function standardMenus(mode: 'browse' | 'find', scripts: ScriptsMenuEntry[] = [], options: { feeds?: boolean; tables?: boolean } = {}): CustomMenu[] {
  const cmd = (command: string, key?: string, title?: string, shift = false): CustomMenuItem => ({
    kind: 'command', command, ...(title ? { title } : {}), ...(key ? { shortcut: { key, modifiers: 4 | (shift ? 1 : 0) } } : {}),
  });
  const sep: CustomMenuItem = { kind: 'separator' };
  const find = mode === 'find';
  // FileMaker Pro's menu bar, in its order and with its names and shortcuts (Claris's menu and keyboard shortcut
  // references), so people who know FileMaker find things where they expect them. Tabularius's own extras sit in the
  // Tools menu (and Open Quickly in File), leaving the familiar menus as they are.
  const alt = (command: string, key: string, title?: string): CustomMenuItem => ({ kind: 'command', command, ...(title ? { title } : {}), shortcut: { key, modifiers: 4 | 8 } });
  return [
    { title: 'File', items: [
      cmd('Open Quickly', 'K', 'Open Quickly…'), sep,
      cmd('Close Window', 'W', 'Close'), sep,
      { kind: 'submenu', title: 'Manage', items: [cmd('Manage Database', 'D', 'Database…', true), cmd('Manage Security', undefined, 'Security…'), cmd('Manage Layouts', undefined, 'Layouts…'), ...(options.feeds ? [cmd('Manage Calendar Feeds', undefined, 'Calendar Feeds…')] : [])] }, sep,
      cmd('Print', 'P', 'Print…'), sep,
      cmd('Import Records', undefined, 'Import Records…'), cmd('Import Calendar', undefined, 'Import Calendar (.ics)…'), ...(options.tables ? [cmd('Import Tables', undefined, 'Import Tables…')] : []), cmd('Export Records', undefined, 'Export Records…'),
      { kind: 'submenu', title: 'Save/Send Records As', items: [cmd('Save Records as Excel', undefined, 'Excel…'), cmd('Save Records as PDF', undefined, 'PDF…')] }, sep,
      { kind: 'submenu', title: 'Offline Copy', builtin: '[Offline Copy]' } as CustomMenuItem, sep,
      cmd('Log Out', undefined, 'Log Out'),
    ] },
    { title: 'Edit', items: [
      cmd('Undo', 'Z'), cmd('Redo', 'Z', undefined, true), sep,
      cmd('Cut', 'X'), cmd('Copy', 'C'), cmd('Paste', 'V'), cmd('Clear'), sep,
      cmd('Select All', 'A'), sep,
      { kind: 'submenu', title: 'Find/Replace', items: [
        cmd('Find/Replace', 'F', 'Find/Replace…', true), cmd('Find Again', 'G'), cmd('Replace & Find Again', 'G', undefined, true),
      ] },
    ] },
    { title: 'View', items: [
      cmd('Browse Mode', 'B'), cmd('Find Mode', 'F'), cmd('Layout Mode', 'L'), cmd('Preview Mode', 'U'), sep,
      { kind: 'submenu', title: 'Go to Layout', builtin: '[Go to Layout]' }, sep,
      cmd('View as Form'), cmd('View as List'), cmd('View as Table'), sep,
      alt('Status Toolbar', 'S'), sep,
      cmd('Zoom In'), cmd('Zoom Out'),
    ] },
    { title: 'Insert', items: [
      cmd('Current Date', '-'), cmd('Current Time', ';'), cmd('Current User Name', 'N', undefined, true), sep,
      cmd('From Index', 'I', 'From Index…'), ...(find ? [] : [cmd('From Last Visited Record', "'")]), sep,
      // Beyond FileMaker Pro, as FileMaker Go's device options: from the camera or where the device is.
      cmd('Bar Code', undefined, 'Bar Code…'), cmd('Current Location'),
    ] },
    ...(find ? [] : [{ title: 'Format', items: [
      { kind: 'submenu', title: 'Font', builtin: '[Font]' } as CustomMenuItem,
      { kind: 'submenu', title: 'Size', builtin: '[Size]' } as CustomMenuItem,
      { kind: 'submenu', title: 'Style', items: [
        cmd('Plain', 'P', 'Plain Text', true), cmd('Bold', 'B', undefined, true), cmd('Italic', 'I', undefined, true), cmd('Underline', 'U', undefined, true), sep,
        cmd('Word Underline'), cmd('Double Underline'), cmd('Strikethrough'), cmd('Highlight'), sep,
        cmd('Small Caps'), cmd('Uppercase'), cmd('Lowercase'), cmd('Title Case'), sep, cmd('Superscript'), cmd('Subscript'),
      ] } as CustomMenuItem,
      { kind: 'submenu', title: 'Text Color', builtin: '[Text Color]' } as CustomMenuItem,
    ] }]),
    find
      ? { title: 'Requests', items: [
        cmd('New Record', 'N', 'Add New Request'), cmd('Duplicate Request', 'D'), cmd('Delete Request', 'E'), cmd('Omit Request', 'T', 'Omit'), sep,
        { kind: 'submenu', title: 'Insert Operator', builtin: '[Insert Operator]' }, sep,
        { kind: 'submenu', title: 'Go to Record/Request/Page', items: [cmd('Next Record', undefined, 'Next'), cmd('Previous Record', undefined, 'Previous'), cmd('Go to Record Number', undefined, 'Specify…')] }, sep,
        cmd('Show All Records', 'J'), cmd('Perform Find'), cmd('Constrain Found Set'), cmd('Extend Found Set'),
      ] }
      : { title: 'Records', items: [
        cmd('New Record', 'N'), cmd('Duplicate Record', 'D'), cmd('Delete Record', 'E', 'Delete Record…'), cmd('Delete All Records', undefined, 'Delete Found Records…'), sep,
        cmd('Refresh Window', 'R', undefined, true), sep,
        { kind: 'submenu', title: 'Go to Record/Request/Page', items: [cmd('Next Record', undefined, 'Next'), cmd('Previous Record', undefined, 'Previous'), cmd('Go to Record Number', undefined, 'Specify…')] }, sep,
        cmd('Show All Records', 'J'), cmd('Show Omitted Only'), cmd('Omit Record', 'T'), cmd('Omit Multiple', 'T', 'Omit Multiple…', true), sep,
        cmd('Modify Last Find', 'R'), { kind: 'submenu', title: 'Saved Finds', builtin: '[Saved Finds]' }, sep,
        cmd('Sort Records', 'S', 'Sort Records…'), { kind: 'submenu', title: 'Saved Sorts', builtin: '[Saved Sorts]' }, cmd('Unsort'), sep,
        cmd('Replace Field Contents', '=', 'Replace Field Contents…'), cmd('Relookup Field Contents', undefined, 'Relookup Field Contents…'), sep,
        cmd('Revert Record', undefined, 'Revert Record…'), cmd('Record History', undefined, 'Record History…'),
      ] },
    { title: 'Scripts', items: [cmd('Script Workspace', 'S', 'Script Workspace…', true), ...(scripts.length ? [sep, ...scriptItems(scripts)] : [])] },
    // FileMaker's Tools menu (Script Debugger, Data Viewer), with Tabularius's own tools after them.
    { title: 'Tools', items: [
      cmd('Script Debugger'), cmd('Data Viewer'), cmd('Record Script', undefined, 'Record Script…'), sep,
      cmd('Ask AI', undefined, 'Ask AI…'), cmd('Dashboards'), cmd('Automations'), cmd('Clean Up Data', undefined, 'Clean Up Data…'),
    ] },
    { title: 'Window', items: [cmd('New Window'), { kind: 'submenu', title: 'Show Window', builtin: '[Windows]' }] },
    { title: 'Help', items: [cmd('Documentation', undefined, 'Documentation…'), cmd('Keyboard Shortcuts', '/', 'Keyboard Shortcuts'), sep, cmd('About', undefined, `About ${PRODUCT_NAME}`)] },
  ];
}

/** The Scripts menu's items: scripts, folders as submenus, separators. */
function scriptItems(entries: ScriptsMenuEntry[]): CustomMenuItem[] {
  return entries.map((e): CustomMenuItem => ('separator' in e ? { kind: 'separator' }
    : 'items' in e ? { kind: 'submenu', title: e.name, items: scriptItems(e.items) }
      : { kind: 'command', title: e.name, scriptId: e.id }));
}

/** Every command name in the menus, with the item that holds it. */
export function commands(menus: CustomMenu[]): Map<string, CustomMenuItem> {
  const out = new Map<string, CustomMenuItem>();
  const walk = (items: CustomMenuItem[]) => {
    for (const it of items) {
      if (it.command && !out.has(it.command)) out.set(it.command, it);
      if (it.items) walk(it.items);
    }
  };
  for (const m of menus) walk(m.items);
  return out;
}

/** Shows a submenu beside its item, kept on screen (fixed, so a scrolling menu doesn't clip it). */
function place(li: HTMLElement, ul: HTMLElement): void {
  li.append(ul);
  const r = li.getBoundingClientRect();
  const w = ul.offsetWidth;
  ul.style.left = `${r.right + w > innerWidth ? Math.max(0, r.left - w) : r.right}px`;
  ul.style.top = `${Math.max(0, Math.min(r.top - 5, innerHeight - ul.offsetHeight))}px`;
}

/** An item's label: its title override, else the command's name. Items with neither aren't shown. */
function label(it: CustomMenuItem): string | undefined {
  return it.title || it.command || (it.builtin ? it.builtin.replace(/^\[(.*)\]$/, '$1') : undefined);
}

/** The items of one menu list a keyboard moves between (not those of a submenu inside it). */
const itemsOf = (ul: Element) => [...ul.querySelectorAll<HTMLElement>(':scope > li[role^="menuitem"]')];

export class MenuBar {
  readonly element = document.createElement('nav');
  private open?: HTMLElement;
  /** The title button of the open menu, where focus goes back to when it closes. */
  private opener?: HTMLElement;
  private host: MenuHost;
  private refresh: () => Promise<CustomMenu[]>;

  constructor(host: MenuHost, refresh: () => Promise<CustomMenu[]>) {
    this.host = host;
    this.refresh = refresh;
    this.element.className = 'menubar';
    this.element.setAttribute('aria-label', 'Menus');
    document.addEventListener('mousedown', (e) => {
      if (this.open && !this.element.contains(e.target as Node)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close(true);
    });
  }

  /** A phone's one "Menu" button, which shows or hides the menu titles (CSS hides it on wider windows). */
  private toggleButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-toggle';
    b.textContent = 'Menu';
    b.setAttribute('aria-expanded', String(this.element.classList.contains('expanded')));
    b.addEventListener('click', () => {
      const show = !this.element.classList.contains('expanded');
      if (!show) this.close();
      this.element.classList.toggle('expanded', show);
      b.setAttribute('aria-expanded', String(show));
    });
    return b;
  }

  /** Folds the phone's menu titles away again, once a command has been chosen. */
  private fold(): void {
    this.element.classList.remove('expanded');
    this.element.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
  }

  set(menus: CustomMenu[]): void {
    this.close();
    this.element.replaceChildren(...(menus.length ? [this.toggleButton()] : []), ...menus.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-title';
      b.textContent = m.title;
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      // A click from the keyboard (Enter, Space) puts focus on the first item, as a menu button does.
      b.addEventListener('click', (e) => void this.toggle(b, m.title, e.detail === 0));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.open?.dataset.title === m.title) itemsOf(this.open).at(e.key === 'ArrowUp' ? -1 : 0)?.focus();
          else void this.toggle(b, m.title, true);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.titles().at((this.titles().indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1)) % this.titles().length)?.focus();
        }
      });
      b.addEventListener('mouseenter', () => {
        if (this.open && this.open.dataset.title !== m.title) void this.toggle(b, m.title);
      });
      return b;
    }));
  }

  private titles(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>('.menu-title')];
  }

  /** The open menu's title button: found again by its name when the titles were redrawn meanwhile. */
  private title(): HTMLElement | undefined {
    return this.opener?.isConnected ? this.opener : this.titles().find((t) => t.textContent === this.opener?.textContent);
  }

  /** Closes the open menu; `refocus` puts focus back on its title (Escape, or before an item runs). */
  private close(refocus = false): void {
    const hadFocus = this.open?.contains(document.activeElement);
    this.open?.remove();
    this.open = undefined;
    for (const b of this.titles()) {
      b.classList.remove('active');
      b.setAttribute('aria-expanded', 'false');
    }
    if (refocus || hadFocus) this.title()?.focus();
  }

  private async toggle(b: HTMLElement, title: string, focusFirst = false): Promise<void> {
    const was = this.open?.dataset.title;
    this.close();
    if (was === title) return;
    this.opener = b;
    // Titles and "install when" can depend on the record and variables: ask again on opening.
    const menus = await this.refresh();
    const menu = menus.find((m) => m.title === title);
    if (!menu) return;
    // The titles may have been redrawn while the menu was asked for.
    if (!b.isConnected) b = this.titles().find((t) => t.textContent === title) ?? b;
    this.opener = b;
    const list = this.list(menu.items);
    list.dataset.title = title;
    list.style.left = `${b.offsetLeft}px`;
    b.classList.add('active');
    b.setAttribute('aria-expanded', 'true');
    list.setAttribute('aria-label', title);
    this.element.append(list);
    this.open = list;
    if (focusFirst) itemsOf(list).find((li) => !li.hasAttribute('aria-disabled'))?.focus();
  }

  /**
   * Keys inside an open menu (WAI-ARIA menu pattern): arrows move between items, Home and End
   * jump, Enter or Space chooses, Right opens a submenu, Left closes one or moves to the menu
   * beside, Escape closes, and Tab leaves the menus.
   */
  private keys(ul: HTMLElement, e: KeyboardEvent): void {
    const li = (e.target as HTMLElement).closest('li');
    if (!li || li.parentElement !== ul) return;
    const items = itemsOf(ul);
    const at = items.indexOf(li);
    const nested = ul !== this.open;
    const move = (to: number) => items.at(to % items.length)?.focus();
    const sideways = (step: number) => {
      const titles = this.titles();
      const next = titles.at((titles.indexOf(this.title()!) + step) % titles.length);
      if (next) void this.toggle(next, next.textContent ?? '', true);
    };
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': move(at + 1); break;
      case 'ArrowUp': move(at - 1); break;
      case 'Home': move(0); break;
      case 'End': move(-1); break;
      case 'Enter': case ' ': li.click(); if (li.classList.contains('submenu')) li.dispatchEvent(new Event('open')); break;
      case 'ArrowRight':
        if (li.classList.contains('submenu') && !li.hasAttribute('aria-disabled')) li.dispatchEvent(new Event('open'));
        else sideways(1);
        break;
      case 'ArrowLeft':
        if (nested) {
          const parent = ul.parentElement as HTMLElement;
          ul.remove();
          parent.setAttribute('aria-expanded', 'false');
          parent.focus();
        } else sideways(-1);
        break;
      case 'Escape':
        if (nested) {
          const parent = ul.parentElement as HTMLElement;
          ul.remove();
          parent.setAttribute('aria-expanded', 'false');
          parent.focus();
        } else this.close(true);
        break;
      case 'Tab': this.close(); handled = false; break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Whether a menu item can be chosen now: a command that is available, or a submenu with one. */
  private usable(it: CustomMenuItem): boolean {
    if (it.kind === 'separator' || !label(it)) return false;
    if (it.kind === 'submenu') return it.items ? it.items.some((x) => this.usable(x)) : !!(it.builtin && this.host.builtin(it.builtin)?.length);
    return it.run !== undefined || it.scriptId !== undefined || (it.command !== undefined && this.host.command(it.command, false));
  }

  private list(items: CustomMenuItem[]): HTMLElement {
    const ul = document.createElement('ul');
    ul.className = 'menu';
    ul.setAttribute('role', 'menu');
    ul.addEventListener('keydown', (e) => this.keys(ul, e));
    let last: 'separator' | 'item' | undefined;
    for (const it of items) {
      if (it.kind === 'separator') {
        if (last === 'item') {
          ul.append(Object.assign(document.createElement('li'), { className: 'separator', role: 'separator' }));
          last = 'separator';
        }
        continue;
      }
      const text = label(it);
      if (!text) continue;
      const li = document.createElement('li');
      li.setAttribute('role', 'menuitem');
      li.tabIndex = -1;
      li.append(Object.assign(document.createElement('span'), { className: 'label', textContent: text }));
      if (it.shortcut) li.append(Object.assign(document.createElement('span'), { className: 'shortcut', textContent: shortcutText(it.shortcut) }));
      if (it.kind === 'submenu') {
        const sub = it.items ? it.items : it.builtin ? this.host.builtin(it.builtin)?.map((b) => ({ ...b, kind: 'builtin' as const })) : undefined;
        // A submenu none of whose commands can be used now (Save/Send Records As without exporting or printing) is
        // dimmed, as FileMaker dims it, rather than opening on nothing but dimmed items.
        if (sub?.length && (!it.items || it.items.some((x) => this.usable(x)))) {
          li.classList.add('submenu');
          li.setAttribute('aria-haspopup', 'menu');
          li.setAttribute('aria-expanded', 'false');
          const show = () => {
            li.querySelector(':scope > ul')?.remove();
            let ul2: HTMLElement;
            if (it.items) ul2 = this.list(it.items);
            else {
              ul2 = document.createElement('ul');
              ul2.className = 'menu';
              ul2.setAttribute('role', 'menu');
              ul2.addEventListener('keydown', (e) => this.keys(ul2, e));
              for (const b of sub as { title: string; checked?: boolean; run: () => void }[]) {
                const bi = document.createElement('li');
                bi.setAttribute('role', b.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
                if (b.checked !== undefined) bi.setAttribute('aria-checked', String(b.checked));
                bi.tabIndex = -1;
                bi.textContent = b.title;
                if (b.checked) bi.classList.add('checked');
                bi.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this.close(true);
                  this.fold();
                  b.run();
                });
                ul2.append(bi);
              }
            }
            ul2.setAttribute('aria-label', text);
            place(li, ul2);
            li.setAttribute('aria-expanded', 'true');
            return ul2;
          };
          li.addEventListener('mouseenter', show);
          // From the keyboard: open it and go to its first item.
          li.addEventListener('open', () => itemsOf(show()).find((x) => !x.hasAttribute('aria-disabled'))?.focus());
          li.addEventListener('mouseleave', () => {
            if (li.contains(document.activeElement) && document.activeElement !== li) return;
            li.querySelector(':scope > ul')?.remove();
            li.setAttribute('aria-expanded', 'false');
          });
        } else {
          li.classList.add('disabled');
          li.setAttribute('aria-disabled', 'true');
        }
      } else {
        if (!this.usable(it)) {
          li.classList.add('disabled');
          li.setAttribute('aria-disabled', 'true');
        } else {
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close(true);
            this.fold();
            if (it.run !== undefined || it.scriptId !== undefined) this.host.script(it);
            else this.host.command(it.command!, true);
          });
        }
      }
      ul.append(li);
      last = 'item';
    }
    if (ul.lastElementChild?.classList.contains('separator')) ul.lastElementChild.remove();
    return ul;
  }
}
