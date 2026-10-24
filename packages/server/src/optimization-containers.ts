// Moving the container files a converted file keeps inside its database out to managed external storage (the
// field's folder beside the hosted file), as the optimization report suggests, and putting them back. The store does
// the moving (all or nothing); this adds the design change that opens the field's external storage when it isn't,
// a preview that says what will happen, and a short history in the file that makes the move undoable.
import { encryptionKeyFromEnv } from './setting-values.ts';
import type { Store } from '../../store/src/store.ts';

/** What a move did, kept in the file so it can be undone. */
export interface ContainerMove {
  /** Counts up; the id Undo takes. */
  id: number;
  at: string;
  table: string;
  field: string;
  moved: number;
  bytes: number;
  /** The container ids that were moved out. */
  containerIds: number[];
  /** True when the move also set the field to store its files outside the file (undo sets it back). */
  setStorage: boolean;
  /** The field's storage setting before the move. Missing only in older move history. */
  previousStorage?: { directoryId: number; path?: string; secure?: boolean; fewerFolders?: boolean } | null;
  /** Files still awaiting a retry after a partial undo must outlive the short ordinary history. */
  partial?: boolean;
  /** Whether the file was rewritten afterwards so the freed space went back to the disk. */
  compacted: boolean;
}

export interface ContainerMovePlan {
  table: string;
  field: string;
  files: number;
  bytes: number;
  /** The folder the files go to, beside the hosted file. */
  folder: string;
  /** True when the field has to be set to store its files outside the file first. */
  setsStorage: boolean;
  /** Plain sentences saying what will change, for a person to read before accepting. */
  preview: string[];
}

const KEY = 'containerMoves';
const KEEP = 20;

function read(store: Store): ContainerMove[] {
  const row = store.sql.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(KEY) as { json: string } | undefined;
  try {
    const v = row ? JSON.parse(row.json) : [];
    return Array.isArray(v) ? v as ContainerMove[] : [];
  } catch {
    return [];
  }
}

function write(store: Store, moves: ContainerMove[]): void {
  const recent = new Set(moves.filter((m) => !m.partial).slice(-KEEP));
  store.sql.prepare('INSERT INTO _fm_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(KEY, JSON.stringify(moves.filter((m) => m.partial || recent.has(m))));
}

/** The moves made so far that can still be undone, newest last. */
export function containerMoves(store: Store): ContainerMove[] {
  return read(store);
}

function containerField(store: Store, table: string, field: string) {
  const t = store.schema.tables.find((x) => x.name === table);
  const f = t?.fields.find((x) => x.name === field);
  if (!t || !f) throw new Error(`Field "${table}::${field}" is missing`);
  if (f.type !== 'container') throw new Error(`Field "${table}::${field}" is not a container`);
  return f;
}

const megabytes = (n: number) => `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB`;

/** What moving a field's embedded files out would do. Changes nothing. */
export function planContainerMove(store: Store, table: string, field: string): ContainerMovePlan {
  const f = containerField(store, table, field);
  const { files, bytes } = store.embeddedContainerCount(table, field);
  if (!files) throw new Error(`"${table}::${field}" keeps no files inside the file`);
  const open = !!f.options?.externalStorage && !f.options.externalStorage.secure;
  const folder = `RC_Data_FMS/${store.name}/${table}/${field}/`;
  const preview = [
    `Move ${files} file${files === 1 ? '' : 's'} (${megabytes(bytes)}) of ${table}::${field} out of the database into the folder ${folder} beside the hosted file.`,
    open
      ? `${table}::${field} already stores its files outside the file, so its design stays as it is.`
      : `Set ${table}::${field} to store its files outside the file (open storage, folder "${table}/${field}/"). That is a design change; Undo sets it back.`,
    'All or nothing: if any file can\'t be written, nothing is changed. The records keep pointing at the same files.',
    'Back up that folder with the file from now on. The file is then rewritten to give the space back to the disk, which takes a moment on a large file.',
  ];
  if (encryptionKeyFromEnv()) preview.push('Warning: TABULARIUS_ENCRYPTION_KEY encrypts only the database. These external container files will be stored as plaintext, including while the server is stopped.');
  return { table, field, files, bytes, folder, setsStorage: !open, preview };
}

/**
 * Moves the files out. With `preview` nothing is changed and the plan comes back. `expect` is the number of files the
 * person was shown: a different number now (the file changed since) is refused.
 */
export function moveContainersToManagedStorage(
  store: Store, table: string, field: string, options: { preview?: boolean; expect?: number; compact?: boolean; account?: string } = {},
): { plan: ContainerMovePlan; move?: ContainerMove; compactionError?: string } {
  const plan = planContainerMove(store, table, field);
  if (options.preview) return { plan };
  if (options.expect !== undefined && options.expect !== plan.files) {
    throw new Error(`The file has changed since the report: ${table}::${field} now keeps ${plan.files} files inside it, not ${options.expect}. Look again.`);
  }
  const previousStorage = containerField(store, table, field).options?.externalStorage ?? null;
  let move: ContainerMove | undefined;
  // The design change, the moved files and the undo record commit together: a
  // failed move rolls back to the field's previous setting with nothing recorded.
  store.moveContainersOut(table, field, {
    prepare: plan.setsStorage ? () => {
      store.applyDesign([{ op: 'updateField', table, field, options: { externalStorage: { path: `"${table}/${field}/"` } } }] as never, { account: options.account });
    } : undefined,
    record: (out) => {
      const moves = read(store);
      move = {
        id: (moves.at(-1)?.id ?? 0) + 1, at: new Date().toISOString(), table, field, moved: out.moved, bytes: out.bytes,
        containerIds: out.ids, setStorage: plan.setsStorage, previousStorage, compacted: false,
      };
      write(store, [...moves, move]);
    },
  });
  if (!move) throw new Error('Container move did not record its result');
  if (options.compact !== false) {
    try {
      store.compactFile();
      move.compacted = true;
      write(store, read(store).map((m) => m.id === move!.id ? move! : m));
    } catch (error) {
      return { plan, move, compactionError: error instanceof Error ? error.message : String(error) };
    }
  }
  return { plan, move };
}

/** Puts a move's files back in the database. Files that have gone missing from the folder stay as they are and are counted. */
export function undoContainerMove(store: Store, id: number, options: { compact?: boolean; account?: string } = {}): { moved: number; bytes: number; missing: number; move: ContainerMove } {
  const moves = read(store);
  const move = moves.find((m) => m.id === id);
  if (!move) throw new Error(`No move #${id} to undo`);
  if (move.setStorage && !('previousStorage' in move)) throw new Error(`Move #${id} predates storage-setting history; its original field setting cannot be restored safely`);
  const back = store.moveContainersIn(move.containerIds, (result) => {
    if (move.setStorage && !result.missing) {
      store.applyDesign([{ op: 'updateField', table: move.table, field: move.field, options: { externalStorage: move.previousStorage ?? null } }] as never, { account: options.account });
    }
    if (result.missing) {
      const unresolved = store.sql.prepare('SELECT 1 FROM _fm_containers WHERE id = ? AND external IS NOT NULL');
      const remaining = move.containerIds.filter((containerId) => !!unresolved.get(containerId));
      write(store, moves.map((m) => m.id === id ? { ...m, containerIds: remaining, partial: true } : m));
    } else {
      write(store, moves.filter((m) => m.id !== id));
    }
  });
  return { ...back, move };
}
