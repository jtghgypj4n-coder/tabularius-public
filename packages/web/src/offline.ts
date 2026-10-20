// Offline copy (beyond FileMaker): what this browser keeps of a file so it can be read without a connection,
// and the field changes made meanwhile, waiting to be sent. Opt-in per file and account (File > Offline Copy).
//
// Only what the account has already been sent is kept: the layouts, found sets and records it opened. It is
// encrypted (AES-GCM) with a key made from the account's password (PBKDF2), so the copy opens only with that
// password. Entries are named by an HMAC of what was asked (a find's criteria, a record id), so their names give
// nothing away either, and each is bound to its name, so entries can't be swapped. Only the file's and account's
// names are readable, to list the copies on the sign-in page. Removing the copy deletes it all.

/** Where the copy lives: IndexedDB in the browser, a map in tests. */
export interface Shelf {
  get(store: ShelfStore, key: string): Promise<unknown>;
  put(store: ShelfStore, key: string, value: unknown): Promise<void>;
  delete(store: ShelfStore, key: string): Promise<void>;
  /** Keys starting with prefix, in order. */
  keys(store: ShelfStore, prefix: string): Promise<string[]>;
}

export type ShelfStore = 'files' | 'responses' | 'queue';

/** A field change made without a connection, sent when the connection is back. */
export interface QueuedEdit {
  layout: string;
  recordId: string;
  /** The record's modification id when the first of these changes was made: sending fails if it changed since. */
  modId?: string;
  fieldData: Record<string, string>;
  styles?: Record<string, unknown[]>;
  at: number;
  /** Names this exact version of the change; a later change gets another. Entries kept before it was added have none, and are told apart by `at`. */
  rev?: string;
  /**
   * Set when sending didn't save it, for the person to decide: the record changed on the server (server holds
   * its fields now), was deleted (gone), or the server refused the change (refused: validation, privileges).
   */
  conflict?: { message: string; server?: Record<string, unknown>; gone?: boolean; refused?: boolean };
}

/** The keys a password makes for a copy: one encrypts entries, the other names them. */
export interface CopyKey { enc: CryptoKey; mac: CryptoKey }

interface Sealed { iv: Uint8Array; data: ArrayBuffer }
interface FileEntry { db: string; account: string; salt: Uint8Array; check: Sealed; at: number }

const CHECK = 'openhbam offline copy';
const ITERATIONS = 210_000;
/** Responses kept per file; the oldest go first. */
export const KEEP_LIMIT = 2000;

const text = new TextEncoder();
const fileId = (db: string, account: string): string => `${db}\u0000${account.toLowerCase()}`;
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let revisions = 0;
/** A version name no other change gets, in this window or another, whatever the clock says. */
const newRevision = (): string => `${Date.now().toString(36)}.${(revisions++).toString(36)}.${b64(crypto.getRandomValues(new Uint8Array(6))).replace(/[^A-Za-z0-9]/g, '')}`;
const sameVersion = (a: QueuedEdit, b: QueuedEdit): boolean => a.at === b.at && (a.rev ?? '') === (b.rev ?? '');

/** The copy was moved to another password, replaced or deleted (in this window or another) since this one opened it. */
export class CopyMoved extends Error {
  constructor() {
    super('The offline copy was changed in another window (a new password, or removed).');
    this.name = 'CopyMoved';
  }
}

const chains = new Map<string, Promise<unknown>>();
/**
 * Runs one read-modify-write of a copy's waiting changes alone: after the ones already asked in this window, and
 * (where the browser has Web Locks) after the ones in every other window, so no two read the same old value.
 */
async function exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
  const turn = async (): Promise<T> => {
    const locks = (globalThis as { navigator?: { locks?: { request<R>(name: string, callback: () => Promise<R>): Promise<R> } } }).navigator?.locks;
    return locks ? locks.request(`tabularius.offline.${id}`, work) : work();
  };
  const run = (chains.get(id) ?? Promise.resolve()).then(turn, turn);
  const tail = run.catch(() => {});
  chains.set(id, tail);
  void tail.then(() => { if (chains.get(id) === tail) chains.delete(id); });
  return run;
}

async function keysFrom(bits: Uint8Array): Promise<CopyKey> {
  return {
    enc: await crypto.subtle.importKey('raw', bits.slice(0, 32) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']),
    mac: await crypto.subtle.importKey('raw', bits.slice(32, 64) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}

/** The bits an account's password makes for its offline copy of a file (with that copy's salt). */
export async function deriveBits(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', text.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, base, 512));
}

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** What a signed-in session keeps (in sessionStorage, beside its token) to use or start the copy after a reload. */
export interface OfflineKey { account: string; salt: string; key: string }

export function exportKey(account: string, salt: Uint8Array, bits: Uint8Array): OfflineKey {
  return { account, salt: b64(salt), key: b64(bits) };
}

export async function importKey(k: OfflineKey): Promise<{ account: string; salt: Uint8Array; key: CopyKey }> {
  return { account: k.account, salt: unb64(k.salt), key: await keysFrom(unb64(k.key)) };
}

/** A password's key for a copy, from its bits. */
export function copyKey(bits: Uint8Array): Promise<CopyKey> {
  return keysFrom(bits);
}

async function seal(key: CopyKey, name: string, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: text.encode(name) }, key.enc, text.encode(JSON.stringify(value)));
  return { iv, data };
}

/** The value, or undefined when it doesn't open with this key (another password, or tampered with). */
async function unseal(key: CopyKey, name: string, sealed: Sealed | undefined): Promise<unknown> {
  if (!sealed?.iv || !sealed.data) return undefined;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv as BufferSource, additionalData: text.encode(name) }, key.enc, sealed.data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return undefined;
  }
}

export class OfflineCopy {
  readonly db: string;
  readonly account: string;
  readonly salt: Uint8Array;
  private readonly key: CopyKey;
  private readonly shelf: Shelf;
  private readonly id: string;
  private kept = 0;
  /** Set once the copy is removed: responses still on their way aren't kept. */
  private removed = false;

  private constructor(shelf: Shelf, db: string, account: string, salt: Uint8Array, key: CopyKey) {
    this.shelf = shelf;
    this.db = db;
    this.account = account;
    this.salt = salt;
    this.key = key;
    this.id = fileId(db, account);
  }

  /** The files this browser keeps a copy of (names only; their contents need the password). */
  static async list(shelf: Shelf): Promise<{ db: string; account: string }[]> {
    const out: { db: string; account: string }[] = [];
    for (const k of await shelf.keys('files', '')) {
      const f = await shelf.get('files', k) as FileEntry | undefined;
      if (f) out.push({ db: f.db, account: f.account });
    }
    return out;
  }

  /** The salt of an existing copy, so the password can be turned into its key. */
  static async saltOf(shelf: Shelf, db: string, account: string): Promise<Uint8Array | undefined> {
    return (await shelf.get('files', fileId(db, account)) as FileEntry | undefined)?.salt;
  }

  /** How many changes wait in a copy (counted without opening it). */
  static async waitingIn(shelf: Shelf, db: string, account: string): Promise<number> {
    return (await shelf.keys('queue', `${fileId(db, account)}\u0000`)).length;
  }

  /** The copy, if this key opens it: 'wrong' when a copy exists that it doesn't open, undefined when there is none. */
  static async open(shelf: Shelf, db: string, account: string, key: CopyKey): Promise<OfflineCopy | 'wrong' | undefined> {
    const f = await shelf.get('files', fileId(db, account)) as FileEntry | undefined;
    if (!f) return undefined;
    if (await unseal(key, `${fileId(db, account)}\u0000check`, f.check) !== CHECK) return 'wrong';
    return new OfflineCopy(shelf, f.db, f.account, f.salt, key);
  }

  /** Starts a copy (replacing any old one). */
  static async create(shelf: Shelf, db: string, account: string, salt: Uint8Array, key: CopyKey): Promise<OfflineCopy> {
    const id = fileId(db, account);
    return exclusive(id, async () => {
      await OfflineCopy.wipe(shelf, id);
      const entry: FileEntry = { db, account, salt, check: await seal(key, `${id}\u0000check`, CHECK), at: Date.now() };
      await shelf.put('files', id, entry);
      return new OfflineCopy(shelf, db, account, salt, key);
    });
  }

  /** Deletes a copy: what it kept and the changes still waiting. */
  static async remove(shelf: Shelf, db: string, account: string): Promise<void> {
    const id = fileId(db, account);
    await exclusive(id, () => OfflineCopy.wipe(shelf, id));
  }

  private static async wipe(shelf: Shelf, id: string): Promise<void> {
    for (const store of ['responses', 'queue'] as const) {
      for (const k of await shelf.keys(store, `${id}\u0000`)) await shelf.delete(store, k);
    }
    await shelf.delete('files', id);
  }

  /** Deletes this copy; nothing more is kept in it. */
  async forget(): Promise<void> {
    this.removed = true;
    await exclusive(this.id, () => OfflineCopy.wipe(this.shelf, this.id));
  }

  /**
   * Inside `exclusive`: throws unless the copy on the shelf still opens with this key. Another window may have moved
   * it to a new password or replaced it since this one opened it, and a change sealed under the old key would
   * then never be read again.
   */
  private async intact(): Promise<void> {
    const f = await this.shelf.get('files', this.id) as FileEntry | undefined;
    if (this.removed || !f || await unseal(this.key, `${this.id}\u0000check`, f.check) !== CHECK) throw new CopyMoved();
  }

  /**
   * The same copy under another key (a new password): everything kept and waiting is moved to it. The whole
   * replacement is written under the new key first, and only then does the copy's record switch to the new key; the
   * old entries go last. A failure or a restart at any point leaves every waiting change in a copy one of the
   * two passwords opens, and a retry finishes the job.
   */
  async moveTo(salt: Uint8Array, key: CopyKey): Promise<OfflineCopy> {
    return exclusive(this.id, async () => {
      await this.intact();
      const responses: [string, unknown][] = [];
      for (const k of await this.shelf.keys('responses', `${this.id}\u0000`)) {
        const v = await unseal(this.key, k, await this.shelf.get('responses', k) as Sealed | undefined) as { request: string; value: unknown } | undefined;
        if (v) responses.push([v.request, v.value]);
      }
      const waiting = await this.pending();
      const next = new OfflineCopy(this.shelf, this.db, this.account, salt, key);
      const written: { store: 'queue' | 'responses'; name: string }[] = [];
      try {
        for (const e of waiting) {
          const name = await next.queueName(e.layout, e.recordId);
          await this.shelf.put('queue', name, await seal(key, name, e));
          written.push({ store: 'queue', name });
        }
        for (const [request, value] of responses) {
          const name = await next.responseName(request);
          await this.shelf.put('responses', name, { at: Date.now(), ...await seal(key, name, { request, value }) });
          written.push({ store: 'responses', name });
        }
        const entry: FileEntry = { db: this.db, account: this.account, salt, check: await seal(key, `${this.id}\u0000check`, CHECK), at: Date.now() };
        await this.shelf.put('files', this.id, entry);
      } catch (e) {
        // The old copy is untouched and still opens with the old password. What was written for the new key is cleared if it can be.
        for (const { store, name } of written) await this.shelf.delete(store, name).catch(() => {});
        throw e;
      }
      this.removed = true;
      // The record now opens with the new key; whatever else is under it (the old key's entries, a failed earlier try's) is dropped.
      const keep = new Set(written.map((w) => `${w.store}\u0000${w.name}`));
      for (const store of ['responses', 'queue'] as const) {
        for (const k of await this.shelf.keys(store, `${this.id}\u0000`).catch(() => [] as string[])) {
          if (!keep.has(`${store}\u0000${k}`)) await this.shelf.delete(store, k).catch(() => {});
        }
      }
      return next;
    });
  }

  private async mac(value: string): Promise<string> {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', this.key.mac, text.encode(value)));
    return b64(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private async responseName(request: string): Promise<string> {
    return `${this.id}\u0000${await this.mac(`response\u0000${request}`)}`;
  }

  private async queueName(layout: string, recordId: string): Promise<string> {
    return `${this.id}\u0000${await this.mac(`queue\u0000${layout}\u0000${recordId}`)}`;
  }

  /** Keeps a response the server sent, by what was asked. */
  async keep(request: string, value: unknown): Promise<void> {
    if (this.removed) return;
    const name = await this.responseName(request);
    const sealed = await seal(this.key, name, { request, value });
    if (this.removed) return;
    await this.shelf.put('responses', name, { at: Date.now(), ...sealed });
    if (++this.kept % 100 === 0) await this.prune();
  }

  /** A kept response, or undefined. */
  async recall(request: string): Promise<unknown> {
    const name = await this.responseName(request);
    const v = await unseal(this.key, name, await this.shelf.get('responses', name) as Sealed | undefined) as { request: string; value: unknown } | undefined;
    return v?.request === request ? v.value : undefined;
  }

  private async prune(): Promise<void> {
    const keys = await this.shelf.keys('responses', `${this.id}\u0000`);
    if (keys.length <= KEEP_LIMIT) return;
    const dated = await Promise.all(keys.map(async (k) => ({ k, at: ((await this.shelf.get('responses', k)) as { at?: number } | undefined)?.at ?? 0 })));
    dated.sort((a, b) => a.at - b.at);
    for (const { k } of dated.slice(0, keys.length - KEEP_LIMIT)) await this.shelf.delete('responses', k);
  }

  /**
   * Puts a record's changed fields into the kept responses that hold it, so reading it again offline shows them.
   * Only responses asked through `scope` (the layout's own requests) are changed: other layouts may show
   * another table whose records have the same ids.
   */
  async patch(scope: string, recordId: string, fieldData: Record<string, string>): Promise<void> {
    for (const name of await this.shelf.keys('responses', `${this.id}\u0000`)) {
      const stored = await this.shelf.get('responses', name) as (Sealed & { at?: number }) | undefined;
      const v = await unseal(this.key, name, stored) as { request: string; value: unknown } | undefined;
      if (!v || !v.request.includes(scope) || !applyFields(v.value, recordId, fieldData)) continue;
      await this.shelf.put('responses', name, { at: stored?.at ?? Date.now(), ...await seal(this.key, name, v) });
    }
  }

  /** Adds a change to the ones waiting, merged with an earlier change to the same record (which keeps its modId). */
  async queue(edit: Omit<QueuedEdit, 'at' | 'rev'>): Promise<void> {
    const name = await this.queueName(edit.layout, edit.recordId);
    await exclusive(this.id, async () => {
      await this.intact();
      const before = await unseal(this.key, name, await this.shelf.get('queue', name) as Sealed | undefined) as QueuedEdit | undefined;
      const merged: QueuedEdit = before
        ? { ...before, fieldData: { ...before.fieldData, ...edit.fieldData }, styles: mergeStyles(before, edit), at: Date.now(), rev: newRevision() }
        : { ...edit, at: Date.now(), rev: newRevision() };
      // Text typed over a field drops the formatting kept for its old text, as it does online.
      if (merged.styles) for (const f of Object.keys(edit.fieldData)) if (!edit.styles?.[f]) delete merged.styles[f];
      if (merged.styles && !Object.keys(merged.styles).length) delete merged.styles;
      await this.shelf.put('queue', name, await seal(this.key, name, merged));
    });
  }

  /** The change waiting for one record, if any. */
  async pendingFor(layout: string, recordId: string): Promise<QueuedEdit | undefined> {
    const name = await this.queueName(layout, recordId);
    return await unseal(this.key, name, await this.shelf.get('queue', name) as Sealed | undefined) as QueuedEdit | undefined;
  }

  /** The changes waiting to be sent, oldest first. */
  async pending(): Promise<QueuedEdit[]> {
    const out: QueuedEdit[] = [];
    for (const k of await this.shelf.keys('queue', `${this.id}\u0000`)) {
      const e = await unseal(this.key, k, await this.shelf.get('queue', k) as Sealed | undefined) as QueuedEdit | undefined;
      if (e) out.push(e);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /**
   * Drops a record's waiting change once it was sent, or the person kept the server's. Only the change as it was
   * read (its version): one that more typing added to meanwhile stays, to be sent next time.
   */
  async settle(edit: QueuedEdit): Promise<void> {
    const name = await this.queueName(edit.layout, edit.recordId);
    await exclusive(this.id, async () => {
      await this.intact();
      const now = await unseal(this.key, name, await this.shelf.get('queue', name) as Sealed | undefined) as QueuedEdit | undefined;
      if (now && sameVersion(now, edit)) await this.shelf.delete('queue', name);
    });
  }

  /** Marks a waiting change as not saved, for the person to decide; not if it changed since it was read. */
  async conflict(edit: QueuedEdit, conflict: NonNullable<QueuedEdit['conflict']>): Promise<void> {
    const name = await this.queueName(edit.layout, edit.recordId);
    await exclusive(this.id, async () => {
      await this.intact();
      const now = await unseal(this.key, name, await this.shelf.get('queue', name) as Sealed | undefined) as QueuedEdit | undefined;
      if (now && sameVersion(now, edit)) await this.shelf.put('queue', name, await seal(this.key, name, { ...now, conflict }));
    });
  }
}

function mergeStyles(before: QueuedEdit, edit: Omit<QueuedEdit, 'at'>): Record<string, unknown[]> | undefined {
  if (!before.styles && !edit.styles) return undefined;
  return { ...before.styles, ...edit.styles };
}

/** Sets fields on every record with this id inside a response; whether any was found. */
function applyFields(value: unknown, recordId: string, fieldData: Record<string, string>): boolean {
  let found = false;
  const visit = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const o = v as Record<string, unknown>;
    if (String(o.recordId) === recordId && o.fieldData && typeof o.fieldData === 'object') {
      Object.assign(o.fieldData as Record<string, unknown>, fieldData);
      // Formatting kept for the old text no longer fits it.
      if (o.styles && typeof o.styles === 'object') for (const f of Object.keys(fieldData)) delete (o.styles as Record<string, unknown>)[f];
      found = true;
    }
    for (const child of Object.values(o)) if (child && typeof child === 'object') visit(child);
  };
  visit(value);
  return found;
}

/** The browser's shelf: an IndexedDB database of three stores. */
export function indexedDbShelf(name = 'openhbam-offline'): Shelf {
  let opening: Promise<IDBDatabase> | undefined;
  const db = (): Promise<IDBDatabase> => opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      for (const s of ['files', 'responses', 'queue']) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = undefined; reject(req.error); };
  });
  const run = async <T>(store: ShelfStore, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = op(d.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: async (store, key, value) => { await run(store, 'readwrite', (s) => s.put(value, key)); },
    delete: async (store, key) => { await run(store, 'readwrite', (s) => s.delete(key)); },
    keys: async (store, prefix) => (await run(store, 'readonly', (s) => s.getAllKeys(prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : undefined))).map(String),
  };
}

/** A shelf in memory, for tests. */
export function memoryShelf(): Shelf & { data: Record<ShelfStore, Map<string, unknown>> } {
  const data = { files: new Map<string, unknown>(), responses: new Map<string, unknown>(), queue: new Map<string, unknown>() };
  return {
    data,
    get: async (store, key) => structuredClone(data[store].get(key)),
    put: async (store, key, value) => { data[store].set(key, structuredClone(value)); },
    delete: async (store, key) => { data[store].delete(key); },
    keys: async (store, prefix) => [...data[store].keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}
