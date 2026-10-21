// Independent policy oracle. Do not derive expectations from Privileges or observed results.
// Claris sources and intentionally unverified edges: notes/audits/r24-11-privilege-inheritance.md.
import { createStore, Store } from '../../store/src/index.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const IDENTITIES = [
  { account: 'Reader', set: 'Restricted', full: false, read: false, write: false, delete: false },
  { account: 'Editor', set: 'Editing', full: false, read: true, write: true, delete: false },
  { account: 'Admin', set: '[Full Access]', full: true, read: true, write: true, delete: true },
] as const;
export type Identity = typeof IDENTITIES[number];
export type Edge = 'local' | 'server' | 'trigger';
export interface Frame { ownFull: boolean; edge: Edge }
export interface Context { account: string; accountSet: string; effectiveSet: string; full: boolean; ownFull: boolean; nesting: number }
export function context(who: Identity, frame: Frame, nesting: number): Context {
  const full = who.full || frame.ownFull;
  return { account: who.account, accountSet: who.set, effectiveSet: full ? '[Full Access]' : who.set, full, ownFull: frame.ownFull, nesting };
}
export function identityText(c: Context): string { return `${c.account}|${c.accountSet}|${c.effectiveSet}`; }
export const IDENTITY = 'Get ( AccountName ) & "|" & Get ( AccountPrivilegeSetName ) & "|" & Get ( CurrentPrivilegeSetName )';
export const SECRET = 'synthetic-protected-value';
export const PROBE = `${IDENTITY} & "|" & Items::Secret & "|" & Evaluate ( "Items::Secret" ) & "|" & ExecuteSQL ( "SELECT Secret FROM Items" ; "" ; "" ) & "|" & ReadSecret ( )`;
export function probe(who: Identity, frame: Frame, nesting: number): string {
  const c = context(who, frame, nesting);
  return `${identityText(c)}|${Array(4).fill(c.full || who.read ? SECRET : '').join('|')}`;
}
export function generated(seed: number, count = 12): Frame[][] {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  return Array.from({ length: count }, (_, n) => Array.from({ length: 2 + next() % 3 }, (_, depth) => ({
    ownFull: (next() >>> 16) % 2 === 1,
    // Rotate edges to guarantee all mechanisms, even for a short seed run.
    edge: (['local', 'server', 'trigger'] as const)[(n + depth) % 3],
  })));
}
export function populate(store: Store) {
  store.setAiPolicy(false);
  store.applyDesign([
    { op: 'createTable', name: 'Items', fields: [{ name: 'Public' }, { name: 'Secret' }] },
    { op: 'createCustomFunction', name: 'ReadSecret', parameters: [], formula: 'Items::Secret' },
    { op: 'createField', table: 'Items', name: 'Viewer', type: 'text', kind: 'calculation', calculation: IDENTITY, options: { unstored: true } },
    { op: 'createScript', name: 'Forbidden', text: 'Exit Script [ Text Result: "forbidden-executed" ]' },
  ]);
  store.create('Items', { Public: 'visible', Secret: SECRET }, { account: 'Admin' });
  for (const who of IDENTITIES) {
    if (!who.full) store.savePrivilegeSet({
      name: who.set, records: { view: true, edit: who.write, create: false, delete: who.delete, fields: { Secret: who.read ? 'modifiable' : 'none' } },
      layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'viewOnly', scriptAccess: { Forbidden: 'none' },
      extendedPrivileges: ['fmrest', 'fmmcp'],
    });
    store.setPassword(who.account, 'synthetic-password', who.set);
  }
}
export function openSynthetic() {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-inheritance-'));
  const path = join(dir, 'Generated.openhbam.sqlite');
  createStore(path);
  const store = new Store(path, 'Generated');
  try { populate(store); } catch (e) { store.close(); rmSync(dir, { recursive: true, force: true }); throw e; }
  return { store, dir, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
export function putScript(store: Store, name: string, text: string, fullAccess = false) {
  store.applyDesign([store.schema.scripts.some((s) => s.name === name)
    ? { op: 'updateScript', script: name, text } : { op: 'createScript', name, text }]);
  // Synthetic schema setting, as in the existing cross-file privilege tests. Text cannot grant full access.
  const script = store.schema.scripts.find((s) => s.name === name)!;
  script.fullAccess = fullAccess;
  return script;
}

export function installChain(store: Store, frames: Frame[], operation: 'read' | 'write' | 'delete' | 'run' = 'read') {
  // Install deepest first so the script-text resolver can bind every target by ID.
  for (let i = frames.length - 1; i >= 0; i--) {
    const own = frames[i];
    let body: string;
    if (i === frames.length - 1) {
      const action = operation === 'write' ? 'Set Field [ Items::Secret ; "changed" ]'
        : operation === 'delete' ? 'Delete Record/Request [ With dialog: Off ]'
        : operation === 'run' ? 'Perform Script [ "Forbidden" ]' : '';
      body = `Set Variable [ $observed ; Value: ${PROBE} ]\n${action}\n${operation === 'write' ? 'Commit Records/Requests [ With dialog: Off ]\n' : ''}Set Variable [ $error ; Value: Get ( LastError ) ]\nSet Variable [ $result ; Value: $observed & "#" & $error ]`;
    } else {
      const child = `Frame${i + 1}`;
      let call = `${own.edge === 'server' ? 'Perform Script on Server' : 'Perform Script'} [ "${child}"${own.edge === 'server' ? ' ; Wait for completion: On' : ''} ]\nSet Variable [ $child ; Value: Get ( ScriptResult ) ]`;
      if (own.edge === 'trigger') {
        const layout = `Trigger${i}`;
        if (!store.schema.layouts.some((l) => l.name === layout)) store.applyDesign([{ op: 'createLayout', name: layout, occurrence: 'Items' }]);
        store.applyDesign([{ op: 'updateLayout', layout, design: { triggers: [{ event: 'OnLayoutEnter', scriptId: store.schema.scripts.find((s) => s.name === child)!.id, script: child }] } }]);
        call = `Go to Layout [ "${layout}" ]\nSet Variable [ $child ; Value: $$result${i + 1} ]`;
      }
      body = `Set Variable [ $before ; Value: ${IDENTITY} ]\n${call}\nSet Variable [ $result ; Value: $before & ">" & $child & "<" & ${IDENTITY} ]`;
    }
    putScript(store, `Frame${i}`, `Set Error Capture [ On ]\n${body}\nSet Variable [ $$result${i} ; Value: $result ]\nExit Script [ Text Result: $result ]`, own.ownFull);
  }
}
export function expectedChain(who: Identity, frames: Frame[], operation: 'read' | 'write' | 'delete' | 'run'): string {
  const leaf = frames.length - 1;
  const c = context(who, frames[leaf], leaf);
  const allowed = c.full || (operation === 'write' ? who.write : operation === 'delete' ? who.delete : operation === 'run' ? false : true);
  const error = allowed ? 0 : operation === 'write' ? 201 : operation === 'delete' ? 200 : 9;
  let result = `${probe(who, frames[leaf], leaf)}#${error}`;
  for (let i = leaf - 1; i >= 0; i--) { const id = identityText(context(who, frames[i], i)); result = `${id}>${result}<${id}`; }
  return result;
}

/** Every caller/callee elevation pair (full or not on each side) must occur on each edge kind in the graphs a surface walks. */
export function coverage(graphs: Frame[][]): string[] {
  const missing: string[] = [];
  for (const edge of ['local', 'server', 'trigger'] as const) {
    const pairs = new Set(graphs.flatMap((g) => g.slice(0, -1).flatMap((f, i) => f.edge === edge ? [`${f.ownFull}/${g[i + 1]!.ownFull}`] : [])));
    for (const pair of ['false/false', 'false/true', 'true/false', 'true/true']) if (!pairs.has(pair)) missing.push(`${edge} ${pair}`);
  }
  return missing;
}

/** A small subset of the seeded graphs that together cover every pair on every edge kind; asserts that such a subset exists. */
export function covering(): Frame[][] {
  const pool = [0x2411, 0x17_01].flatMap((seed) => generated(seed));
  const chosen: Frame[][] = [];
  let missing = coverage(chosen);
  for (const graph of pool) {
    const next = coverage([...chosen, graph]);
    if (next.length < missing.length) { chosen.push(graph); missing = next; }
  }
  if (missing.length) throw new Error(`The seeded graphs miss: ${missing.join(', ')}`);
  return chosen;
}
