// A hosted file for the container tests: Contacts with a Photo container field and a portal of Docs, each with a File
// container field; an administrator, an editor whose rights can be changed, and an account that may only look.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '../src/index.ts';
import type { Host, ServeOptions } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, type DesignOp, type Store } from '../../store/src/index.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';

export interface ContainerFixture {
  base: string;
  host: Host;
  store: Store;
  server: Server;
  dir: string;
  /** A Data API session for an account (all use the password "pw"), as the Authorization header's value. */
  login(account: string): Promise<string>;
  /** Contacts' first record ids, one per contact (1 and 2). */
  contact(n: number): string;
  /** The Docs row of a contact. */
  doc(n: number): number;
  portal(): string;
  /** The Data API root of the file. */
  api: string;
  close(): Promise<void>;
}

export async function containerFixture(extra: Partial<ServeOptions> = {}): Promise<ContainerFixture> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-container-'));
  createStore(join(dir, 'C' + STORE_EXT));
  const s = await serve({ dir, port: 0, watch: false, log: () => {}, ...extra });
  const store = s.host.get('C')!;
  store.applyDesign([
    { op: 'createTable', name: 'Contacts', fields: [{ name: 'Id', type: 'number' }, { name: 'Name' }, { name: 'Photo', type: 'container' }] },
    { op: 'createTable', name: 'Docs', fields: [{ name: 'ContactId', type: 'number' }, { name: 'Title' }, { name: 'File', type: 'container' }] },
    { op: 'createRelationship', left: 'Contacts', right: 'Docs', predicates: [{ left: 'Id', right: 'ContactId' }], allowCreation: true },
  ] as DesignOp[]);
  const occ = (name: string) => store.schema.tableOccurrences.find((t) => t.name === name)!;
  const fieldId = (table: string, name: string) => store.schema.tables.find((t) => t.name === table)!.fields.find((f) => f.name === name)!.id;
  const anchors = { left: true, top: true, right: false, bottom: false };
  let top = 0;
  let id = 100;
  const field = (table: string, name: string) => ({
    id: ++id, kind: 'field', type: 1, anchors, style: {}, bounds: { top: top += 24, left: 20, bottom: top + 20, right: 300 },
    field: { tableOccurrenceId: occ(table).id, fieldId: fieldId(table, name), tableOccurrence: table, field: name, display: 'edit', repetitions: 1 },
  }) as unknown as LayoutObject;
  const objects = [field('Contacts', 'Id'), field('Contacts', 'Name'), field('Contacts', 'Photo'), {
    id: 900, kind: 'portal', type: 9, anchors, style: {}, bounds: { top: 300, left: 20, bottom: 400, right: 300 },
    portal: { tableOccurrenceId: occ('Docs').id, tableOccurrence: 'Docs', rows: 4, initialRow: 1 }, children: [field('Docs', 'Title'), field('Docs', 'File')],
  } as unknown as LayoutObject];
  store.applyDesign([{ op: 'updateLayout', layout: 'Contacts', design: { objects, tableView: [] } }] as DesignOp[]);
  for (const n of [1, 2, 3]) store.create('Contacts', { Id: n, Name: `contact ${n}` });
  for (const n of [1, 2, 3]) store.create('Docs', { ContactId: n, Title: `doc ${n}` });
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.setPassword('Admin2', 'pw', '[Full Access]');
  const rest = { name: 'Editors', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', valueLists: 'viewOnly', scripts: 'none', extendedPrivileges: ['fmrest'] };
  store.savePrivilegeSet(rest as never);
  store.setPassword('Editor', 'pw', 'Editors');
  store.savePrivilegeSet({
    ...rest, name: 'Lookers', tables: { Contacts: { view: true, edit: true, create: true, delete: false, fields: { Photo: 'viewOnly' } }, Docs: { view: true, edit: true, create: true, delete: false, fields: { File: 'viewOnly' } } },
  } as never);
  store.setPassword('Looker', 'pw', 'Lookers');
  const api = `${s.url}/fmi/data/vLatest/databases/C`;
  const records = store.find('Contacts', { limit: 100 }).records;
  return {
    base: s.url, host: s.host, store, server: s.server, dir, api,
    async login(account) {
      const r = await fetch(`${api}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:pw`), 'content-type': 'application/json' }, body: '{}' });
      return 'Bearer ' + (await r.json()).response.token;
    },
    contact: (n) => String(records.find((r) => String(r.fieldData.Id) === String(n))!.recordId),
    doc: (n) => Number(store.find('Docs', { limit: 100 }).records.find((r) => String(r.fieldData.ContactId) === String(n))!.recordId),
    portal: () => store.layout('Contacts').plan!.portals[0].name,
    async close() {
      await new Promise<void>((resolve) => s.server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** Bytes that differ from place to place, so a piece in the wrong place or a repeated one shows. */
export function pattern(from: number, length: number, seed = 0): Buffer {
  return fillPattern(Buffer.allocUnsafe(length), from, seed);
}

/** The same bytes, written into a buffer that is used again for the next piece. */
export function fillPattern(into: Buffer, from: number, seed = 0): Buffer {
  for (let i = 0; i < into.length; i++) {
    const at = from + i;
    into[i] = (at * 131 + (at >> 11) + (at >> 19) * 7 + seed) & 0xff;
  }
  return into;
}
