// The Script Workspace's tabs: several scripts open at once, each keeping its unsaved steps while another is shown.
// The open tabs are kept for the browser tab (sessionStorage, ids only); unsaved steps stay in memory, never stored.

import { mergeText } from './merge.ts';

/** A script's unsaved steps, and the saved text they were typed against. */
export interface Draft { text: string; base: string; name?: string }

export class ScriptTabs {
  open: number[] = [];
  readonly drafts = new Map<number, Draft>();
  /** The tab shown last, for opening the next one beside it. */
  last?: number;
  /** Every tab was closed: the script the list shows by default opens no tab until one is picked. */
  closedAll = false;
  private readonly key?: string;
  constructor(key?: string) {
    this.key = key;
    try {
      const v = key ? JSON.parse(sessionStorage.getItem(key) ?? '[]') : [];
      if (Array.isArray(v)) this.open = v.filter((x): x is number => Number.isInteger(x));
    } catch { /* starts with no tabs */ }
  }

  private keep(): void {
    try {
      if (this.key) sessionStorage.setItem(this.key, JSON.stringify(this.open));
    } catch { /* tabs last for this page only */ }
  }

  /**
   * The tabs to show: those still in the file (in the order opened), with `current` opened after the one shown before
   * it. Drafts of scripts deleted meanwhile are taken out and handed to `gone`, so their steps can still be copied.
   */
  shown(exists: (id: number) => boolean, current: number | undefined, previous?: number, gone?: (d: Draft) => void): number[] {
    const before = this.open.join();
    this.open = this.open.filter(exists);
    for (const [id, d] of this.drafts) {
      if (exists(id)) continue;
      this.drafts.delete(id);
      gone?.(d);
    }
    if (current !== undefined && !this.open.includes(current)) {
      const at = previous === undefined ? -1 : this.open.indexOf(previous);
      this.open.splice(at < 0 ? this.open.length : at + 1, 0, current);
    }
    if (this.open.join() !== before) this.keep();
    return this.open;
  }

  /** Closes a tab (its unsaved steps go with it); the tab to show next when it was the one shown. */
  close(id: number): number | undefined {
    const at = this.open.indexOf(id);
    this.open = this.open.filter((x) => x !== id);
    this.drafts.delete(id);
    this.keep();
    const next = this.open[Math.min(Math.max(at, 0), this.open.length - 1)];
    if (next === undefined) this.closedAll = true;
    return next;
  }

  /** Notes what the editor holds: a draft while it differs from the saved text, none once it matches. */
  edit(id: number, text: string, base: string, name?: string): void {
    if (text === base) this.drafts.delete(id);
    else this.drafts.set(id, { text, base, name: name ?? this.drafts.get(id)?.name });
  }

  /**
   * What the editor shows on opening a script saved as `saved`: its unsaved steps, with any save made since
   * (by anyone) merged in line by line, the unsaved lines kept where both changed. Undefined with nothing unsaved.
   */
  restore(id: number, saved: string): { text: string; conflicts: number; merged: boolean } | undefined {
    const d = this.drafts.get(id);
    if (!d) return undefined;
    if (d.base === saved) return { text: d.text, conflicts: 0, merged: false };
    const m = mergeText(d.base, d.text, saved);
    this.edit(id, m.text, saved);
    return { ...m, merged: true };
  }
}

/** The scripts with unsaved steps that these changes give new steps (or delete). */
export function draftsReplaced(changes: unknown[], drafts: Map<number, Draft>, scripts: { id: number; name: string }[]): number[] {
  return [...new Set(changes.flatMap((c) => {
    const x = c as { op: string; script?: number | string; text?: unknown; steps?: unknown };
    if (!((x.op === 'updateScript' && (x.text !== undefined || x.steps !== undefined)) || x.op === 'deleteScript')) return [];
    const id = typeof x.script === 'number' ? x.script : scripts.find((s) => s.name.toLowerCase() === String(x.script ?? '').toLowerCase())?.id;
    return id === undefined ? [] : [id];
  }))].filter((id) => drafts.has(id));
}

const byFile = new Map<string, ScriptTabs>();
/** The tabs of one file's Script Workspace. */
export function scriptTabs(db: string): ScriptTabs {
  let t = byFile.get(db);
  if (!t) byFile.set(db, (t = new ScriptTabs(`tabularius.scriptTabs.${db}`)));
  return t;
}
