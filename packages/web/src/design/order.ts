// The layout and script lists in FileMaker's order, with folders and
// separators: drag an entry to move it (onto a folder to put it inside),
// add, rename and remove folders. Each change sends the whole order as one
// setOrder change.

import type { OrderedItem } from './client.ts';
import { h, button } from './dom.ts';
import { peersAt, type Studio } from './main.ts';

type Node =
  | { type: 'item'; id: number }
  | { type: 'folder'; id?: number; name: string; children: Node[]; open: boolean }
  | { type: 'separator'; id?: number };

type Spec = { item: number } | { folder: string; id?: number; children: Spec[] } | { separator: true; id?: number };

/** Folders closed in this browser session, by list and folder id. */
const closed = new Set<string>();

/** The order as a tree: a folder holds the entries after it that are one level deeper. Items missing from it go at the end. */
function tree(list: string, order: OrderedItem[], items: { id: number }[]): Node[] {
  const root: Node[] = [];
  const stack: { depth: number; children: Node[] }[] = [{ depth: -1, children: root }];
  const seen = new Set<number>();
  for (const o of order) {
    if (o.kind === 'folder-end') continue;
    while (stack.length > 1 && stack[stack.length - 1].depth >= o.depth) stack.pop();
    const into = stack[stack.length - 1].children;
    if (o.kind === 'folder') {
      const f: Node = { type: 'folder', id: o.id, name: o.name, children: [], open: !closed.has(`${list}:${o.id}`) };
      into.push(f);
      stack.push({ depth: o.depth, children: f.children });
    } else if (o.kind === 'separator') into.push({ type: 'separator', id: o.id });
    else if (items.some((i) => i.id === o.id) && !seen.has(o.id)) {
      seen.add(o.id);
      into.push({ type: 'item', id: o.id });
    }
  }
  for (const i of items) if (!seen.has(i.id)) root.push({ type: 'item', id: i.id });
  return root;
}

const spec = (nodes: Node[]): Spec[] => nodes.map((n) => (n.type === 'item' ? { item: n.id } : n.type === 'separator' ? { separator: true as const, id: n.id } : { folder: n.name, id: n.id, children: spec(n.children) }));

/** Remove a node from wherever it is in the tree. */
function take(nodes: Node[], node: Node): boolean {
  const i = nodes.indexOf(node);
  if (i >= 0) {
    nodes.splice(i, 1);
    return true;
  }
  return nodes.some((n) => n.type === 'folder' && take(n.children, node));
}

const contains = (folder: Node, node: Node): boolean => folder === node || (folder.type === 'folder' && folder.children.some((c) => contains(c, node)));

export function orderedList<T extends { id: number; name: string }>(studio: Studio, opts: {
  key: string; list: 'layouts' | 'scripts'; items: T[]; order: OrderedItem[]; current?: T; describe: (t: T) => string;
}): HTMLElement[] {
  const roots = tree(opts.list, opts.order, opts.items);
  const byId = new Map(opts.items.map((i) => [i.id, i]));
  const save = (done?: string) => void studio.apply([{ op: 'setOrder', list: opts.list, order: spec(roots) } as never], done);
  let dragging: Node | undefined;

  /** Drop `dragging` before or after `target`, or into it when it's a folder and the drop is on its name. */
  const drop = (target: Node, where: 'before' | 'after' | 'into', siblings: Node[]) => {
    const moved = dragging;
    dragging = undefined;
    if (!moved || moved === target || contains(moved, target)) return;
    take(roots, moved);
    if (where === 'into' && target.type === 'folder') {
      target.children.push(moved);
      target.open = true;
      closed.delete(`${opts.list}:${target.id}`);
    } else siblings.splice(siblings.indexOf(target) + (where === 'after' ? 1 : 0), 0, moved);
    save();
  };

  const row = (node: Node, siblings: Node[], depth: number): HTMLElement => {
    let li: HTMLElement;
    if (node.type === 'item') {
      const it = byId.get(node.id)!;
      li = h('li', { class: it === opts.current ? 'selected' : '', draggable: 'true' },
        h('button', { type: 'button', style: `padding-left:${8 + depth * 14}px` }, h('span', {}, it.name), peersAt(studio, opts.list === 'layouts' ? 'layout' : 'script', it.id), h('span', { class: 'd-count' }, opts.describe(it))));
      li.querySelector('button')!.addEventListener('click', () => {
        studio.selected[opts.key] = it.id;
        studio.render();
      });
    } else if (node.type === 'separator') {
      li = h('li', { class: 'd-order-sep', draggable: 'true', title: 'Separator (drag to move)' },
        h('hr', { style: `margin-left:${8 + depth * 14}px` }), button('×', () => {
          take(roots, node);
          save();
        }, { class: 'quiet', title: 'Remove separator' }));
    } else {
      const head = h('div', { class: 'd-order-folder', style: `padding-left:${4 + depth * 14}px` },
        button(node.open ? '▾' : '▸', () => {
          node.open = !node.open;
          if (node.open) closed.delete(`${opts.list}:${node.id}`);
          else closed.add(`${opts.list}:${node.id}`);
          studio.render();
        }, { class: 'quiet', 'aria-label': node.open ? 'Close folder' : 'Open folder' }),
        h('span', { class: 'd-order-name' }, node.name),
        button('Rename', () => {
          const name = prompt('Folder name', node.name)?.trim();
          if (name && name !== node.name) {
            node.name = name;
            save('Folder renamed');
          }
        }, { class: 'quiet' }),
        button('×', () => {
          // Removing a folder keeps what's in it, one level up.
          siblings.splice(siblings.indexOf(node), 1, ...node.children);
          save('Folder removed');
        }, { class: 'quiet', title: 'Remove folder (keeps its contents)' }));
      li = h('li', { class: 'd-order-group', draggable: 'true' }, head);
      if (node.open) li.append(h('ul', { class: 'd-list' }, ...node.children.map((c) => row(c, node.children, depth + 1))));
      head.addEventListener('dragover', (e) => {
        if (!dragging || contains(dragging, node)) return;
        e.preventDefault();
        e.stopPropagation();
        head.classList.add('drop-into');
      });
      head.addEventListener('dragleave', () => head.classList.remove('drop-into'));
      head.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        drop(node, 'into', siblings);
      });
    }
    li.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      dragging = node;
      e.dataTransfer?.setData('text/plain', '');
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + Math.min(r.height, 32) / 2;
      li.classList.toggle('drop-before', !after);
      li.classList.toggle('drop-after', after);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const after = li.classList.contains('drop-after');
      li.classList.remove('drop-before', 'drop-after');
      drop(node, after ? 'after' : 'before', siblings);
    });
    return li;
  };

  const list = h('ul', { class: 'd-list' }, ...roots.map((n) => row(n, roots, 0)));
  const tools = h('div', { class: 'd-row d-order-tools' },
    button('New folder', () => {
      const name = prompt('Folder name')?.trim();
      if (!name) return;
      roots.unshift({ type: 'folder', name, children: [], open: true });
      save('Folder added');
    }),
    button('Separator', () => {
      roots.push({ type: 'separator' });
      save();
    }),
    h('span', { class: 'd-muted' }, 'Drag to reorder'));
  return [list, tools];
}
