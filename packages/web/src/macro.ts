// The macro recorder: what someone does in the web client (go to a layout,
// find, sort, make a record, type into fields) recorded as they do it and
// turned into a clean script: field edits to the same field kept once,
// layout hops and sorts that were undone straight away dropped, and a Commit
// wherever FileMaker would have saved the record. The script is checked with
// a Dry run on a copy of the file before it is saved.

import type { FindRequest, SortSpec } from './types.ts';

export type MacroAction =
  | { kind: 'layout'; layout: string }
  | { kind: 'find'; occurrence: string; requests: FindRequest[]; how?: 'constrain' | 'extend' }
  | { kind: 'quickFind'; text: string }
  | { kind: 'showAll' }
  | { kind: 'sort'; occurrence: string; sort?: SortSpec[] }
  | { kind: 'new' }
  | { kind: 'set'; occurrence: string; field: string; value: string }
  | { kind: 'delete' }
  | { kind: 'go'; to: 'first' | 'last' | 'next' | 'previous' | number }
  /** A button that runs a script; `parameter` is its calculation. */
  | { kind: 'script'; script: string; parameter?: string }
  /** Something done that the script can't repeat (a portal row's field, say): it becomes a comment saying so. */
  | { kind: 'skipped'; what: string };

/** A calculation's text literal: quotes, backslashes and a typed ¶ escaped, line breaks as ¶. */
export function literal(s: string): string {
  return '"' + s.replace(/[\\"¶]/g, '\\$&').replace(/\r\n?|\n/g, '¶') + '"';
}

/** A Data API field key ("Name", "Name(2)", "Orders::Total") as the script names it: "Contacts::Name[2]". */
export function fieldName(occurrence: string, key: string): string {
  const m = /^(.*?)(?:\((\d+)\))?$/.exec(key)!;
  const name = m[1].includes('::') ? m[1] : `${occurrence}::${m[1]}`;
  return m[2] && m[2] !== '1' ? `${name}[${m[2]}]` : name;
}

/** Text FileMaker shows inside “ ” can't itself hold ” (there's no escape for it). */
const curly = (s: string) => (s.includes('”') ? undefined : `“${s}”`);

/** Drops what a later action undoes straight away: edits to a field typed over, a layout left at once, a sort re-sorted. */
export function tidy(actions: MacroAction[]): MacroAction[] {
  const out: MacroAction[] = [];
  for (const a of actions) {
    const last = out.at(-1);
    if (a.kind === 'set') {
      // The same field again, with only other fields of this record typed in between: its last value is what counts.
      for (let i = out.length - 1; i >= 0; i--) {
        const b = out[i];
        if (b.kind !== 'set') break;
        if (b.occurrence === a.occurrence && b.field === a.field) {
          out.splice(i, 1);
          break;
        }
      }
    } else if (a.kind === 'layout' && last?.kind === 'layout') out.pop();
    else if (a.kind === 'sort' && last?.kind === 'sort') out.pop();
    // A record gone to by its place (first, last, a number) makes the hops just before it moot.
    else if (a.kind === 'go' && last?.kind === 'go' && a.to !== 'next' && a.to !== 'previous') out.pop();
    else if ((a.kind === 'find' && !a.how || a.kind === 'showAll' || a.kind === 'quickFind') && (last?.kind === 'showAll' || last?.kind === 'find' && !last.how || last?.kind === 'quickFind')) out.pop();
    out.push(a);
  }
  return out;
}

/** The recorded actions as a script, one step per line, with notes on anything it couldn't repeat. */
export function macroScript(actions: MacroAction[], recordedAt = new Date()): { text: string; steps: number; notes: string[] } {
  const lines: string[] = [`# Recorded in the web client ${recordedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`];
  const notes: string[] = [];
  let unsaved = false;
  const commit = () => {
    if (unsaved) lines.push('Commit Records/Requests [ With dialog: Off ]');
    unsaved = false;
  };
  const skip = (what: string) => {
    notes.push(what);
    lines.push(`# Not recorded: ${what.replace(/\n/g, ' ')}`);
  };
  // The layout the script is on, so going to it again is left out.
  let on: string | undefined;
  for (const a of tidy(actions)) {
    if (a.kind === 'layout' && a.layout === on) continue;
    if (a.kind === 'layout') on = a.layout;
    // A script a button ran may have gone anywhere.
    if (a.kind === 'script') on = undefined;
    if (a.kind !== 'set' && a.kind !== 'skipped') commit();
    switch (a.kind) {
      case 'layout': {
        const name = curly(a.layout);
        if (name) lines.push(`Go to Layout [ ${name} ]`);
        else skip(`going to the layout ${a.layout} (its name has a ” in it)`);
        break;
      }
      case 'find': {
        const requests: string[] = [];
        let bad = false;
        for (const r of a.requests) {
          const criteria = Object.entries(r).filter(([k, v]) => k !== 'omit' && v !== '').map(([k, v]) => {
            const c = curly(v);
            if (!c) bad = true;
            return `${fieldName(a.occurrence, k)}: ${c}`;
          });
          if (criteria.length) requests.push(`${r.omit === 'true' ? 'Omit' : 'Find'}: ${criteria.join(' AND ')}`);
        }
        const step = a.how === 'constrain' ? 'Constrain Found Set' : a.how === 'extend' ? 'Extend Found Set' : 'Perform Find';
        if (bad || !requests.length) skip(`a find (${bad ? 'its criteria have a ” in them' : 'it had no criteria'})`);
        else if (requests.every((r) => r.startsWith('Omit'))) skip('a find with only Omit requests (add a Find request that finds all records first)');
        else lines.push(`${step} [ Restore ; ${requests.join(' ; ')} ]`);
        break;
      }
      case 'quickFind':
        lines.push(`Perform Quick Find [ ${literal(a.text)} ]`);
        break;
      case 'showAll':
        lines.push('Show All Records');
        break;
      case 'sort':
        lines.push(a.sort?.length
          ? `Sort Records [ Restore ; With dialog: Off ; ${a.sort.map((s) => `${fieldName(a.occurrence, s.fieldName)} ; ${s.sortOrder === 'descend' ? 'descending' : 'ascending'}`).join(' ; ')} ]`
          : 'Unsort Records');
        break;
      case 'new':
        lines.push('New Record/Request');
        break;
      case 'set':
        lines.push(`Set Field [ ${fieldName(a.occurrence, a.field)} ; ${literal(a.value)} ]`);
        unsaved = true;
        break;
      case 'delete':
        lines.push('Delete Record/Request [ With dialog: Off ]');
        break;
      case 'go':
        lines.push(`Go to Record/Request/Page [ ${typeof a.to === 'number' ? a.to : a.to[0].toUpperCase() + a.to.slice(1)} ]`);
        break;
      case 'script': {
        const name = curly(a.script);
        // A parameter over several lines would lose its line breaks (and a // comment would swallow the rest): left out.
        const long = a.parameter?.includes('\n') || a.parameter?.includes('\r');
        if (name) lines.push(`Perform Script [ ${name}${a.parameter && !long ? ` ; Parameter: ${a.parameter}` : ''} ]`);
        else skip(`the script ${a.script} (its name has a ” in it)`);
        if (name && long) skip(`the parameter of ${a.script} (it runs over several lines)`);
        break;
      }
      case 'skipped':
        skip(a.what);
        break;
    }
  }
  commit();
  return { text: lines.join('\n'), steps: lines.filter((l) => !l.startsWith('#')).length, notes };
}
