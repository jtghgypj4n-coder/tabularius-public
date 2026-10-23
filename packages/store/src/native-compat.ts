// Native-to-compat export preflight and the one-way compat-to-native migration.
// Keep every known native-only feature in this registry so later native slices can add entries.
import { DatabaseSync } from 'node:sqlite';
import { dateOrderOf, parseDate, parseTimestamp, type DateStyle, type Schema } from '../../fmp12/src/index.ts';
import { NATIVE_FIELD_TYPES } from './design.ts';
import { refuseNewer } from './store-format.ts';

export interface NativeCompatStore {
  fileMode: 'native' | 'compat';
  dateOrder: DateStyle;
  schema: Schema;
}

export interface NativeCompatFinding {
  id: string;
  description: string;
  table?: string;
  field?: string;
}

export interface NativeCompatEntry {
  id: string;
  describe: string;
  test(store: NativeCompatStore): { table?: string; field?: string; description?: string }[];
}

/** Add new native-only features here as their storage format lands.
 * SQL expression export behavior is unverified: the current schema has no distinct SQL expression marker.
 */
export const nativeCompatChecks: NativeCompatEntry[] = [
  {
    id: 'file-mode', describe: 'native file mode has no compat export',
    test: (store) => store.fileMode === 'native' ? [{}] : [],
  },
  {
    id: 'native-field-type', describe: 'native-only field type',
    test: (store) => store.fileMode === 'native'
      ? store.schema.tables.flatMap((table) => table.fields.filter((field) => NATIVE_FIELD_TYPES.includes(field.type)).map((field) => ({ table: table.name, field: field.name, description: `native-only ${field.type} field type` })))
      : [],
  },
  {
    id: 'iso-date-order', describe: 'native ISO-only date order',
    test: (store) => store.fileMode === 'native' && dateOrderOf(store.dateOrder) === 'ISO' ? [{}] : [],
  },
  {
    id: 'iso-date', describe: 'ISO-only date or timestamp field',
    test: (store) => store.fileMode === 'native' && dateOrderOf(store.dateOrder) === 'ISO'
      ? store.schema.tables.flatMap((table) => table.fields.filter((field) => field.type === 'date' || field.type === 'timestamp').map((field) => ({ table: table.name, field: field.name })))
      : [],
  },
  {
    id: 'javascript-function', describe: 'JavaScript custom function has no verified compat export',
    test: (store) => store.fileMode === 'native'
      ? (store.schema.customFunctions ?? []).filter((fn) => fn.language === 'javascript').map((fn) => ({ table: '(custom function)', field: fn.name }))
      : [],
  },
];

function storedState(db: DatabaseSync): NativeCompatStore {
  const meta = (key: string): unknown => {
    const row = db.prepare('SELECT json FROM _fm_meta WHERE key = ?').get(key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  };
  return {
    fileMode: meta('fileMode') === 'native' ? 'native' : 'compat',
    dateOrder: (meta('dateOrder') as DateStyle | undefined) ?? 'MDY',
    schema: meta('schema') as Schema,
  };
}

/** Opens the store with SQLite's read-only flag; checking never runs Store startup migrations. */
export function checkNativeCompat(file: string): NativeCompatFinding[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    refuseNewer(db, file);
    const store = storedState(db);
    return nativeCompatChecks.flatMap(({ id, describe, test }) => test(store).map((location) => ({ id, description: describe, ...location })));
  } finally { db.close(); }
}

export interface NativeUpgradePlan {
  alreadyNative: boolean;
  blockers: string[];
  dateValues: number;
}

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

function dateFields(db: DatabaseSync, schema: Schema): { table: string; field: string; type: 'date' | 'timestamp' }[] {
  return schema.tables.flatMap((table) => {
    const columns = new Set((db.prepare(`PRAGMA table_info(${quote(table.name)})`).all() as { name: string }[]).map((c) => c.name));
    return table.fields.filter((field): field is typeof field & { type: 'date' | 'timestamp' } =>
      (field.type === 'date' || field.type === 'timestamp') && columns.has(field.name))
      .map((field) => ({ table: table.name, field: field.name, type: field.type }));
  });
}

function isoValue(value: string, type: 'date' | 'timestamp', order: DateStyle): string | undefined {
  const parse = type === 'date' ? parseDate : parseTimestamp;
  const iso = parse(value, 'ISO') ?? parse(value, order);
  if (!iso || parse(iso, 'ISO') !== iso) return undefined;
  if (type === 'timestamp') {
    // parseTimestamp normalizes text but does not enforce clock ranges.
    const clock = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(iso);
    if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3]) > 59) return undefined;
  }
  return iso;
}

function inspectUpgrade(db: DatabaseSync, file: string): NativeUpgradePlan {
  refuseNewer(db, file);
  const store = storedState(db);
  if (store.fileMode === 'native') return { alreadyNative: true, blockers: [], dateValues: 0 };
  const blockers: string[] = [];
  const repeating = (db.prepare("SELECT json FROM _fm_meta WHERE key = 'repeating'").get() as { json: string } | undefined)?.json;
  const repeated = (repeating ? JSON.parse(repeating) : {}) as Record<string, string[]>;
  for (const table of store.schema.tables) for (const field of table.fields) {
    if ((field.options?.repetitions ?? 1) > 1 || repeated[table.name]?.includes(field.name)) blockers.push(`${table.name}::${field.name} is a repeating field; replace it with separate records or a JSON field before upgrading`);
    if (field.options?.global) blockers.push(`${table.name}::${field.name} is a global field; move its value to a settings table before upgrading`);
  }
  let dateValues = 0;
  for (const { table, field, type } of dateFields(db, store.schema)) {
    const rows = db.prepare(`SELECT ${quote(field)} AS value FROM ${quote(table)} WHERE ${quote(field)} IS NOT NULL`).iterate() as Iterable<{ value: unknown }>;
    for (const { value } of rows) {
      dateValues++;
      if (typeof value !== 'string' || !isoValue(value, type, store.dateOrder)) {
        const message = `${table}::${field} has a date or timestamp value that cannot be converted to ISO; correct it before upgrading`;
        if (!blockers.includes(message)) blockers.push(message);
      }
    }
  }
  return { alreadyNative: false, blockers, dateValues };
}

/** Preview without opening the file for writes. Names only; no record values leave the file. */
export function planNativeUpgrade(file: string): NativeUpgradePlan {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return inspectUpgrade(db, file); }
  finally { db.close(); }
}

/** Backup callback must finish successfully before the first write. */
export async function upgradeNativeFile(file: string, backup: () => Promise<string>): Promise<{ backup: string; dateValues: number }> {
  const preview = planNativeUpgrade(file);
  if (preview.alreadyNative) throw new Error('upgrade-file: this file is already native; native files cannot be changed back to compat');
  if (preview.blockers.length) throw new Error(`upgrade-file: cannot upgrade:\n${preview.blockers.join('\n')}`);
  const backupPath = await backup();
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const plan = inspectUpgrade(db, file); // Recheck after backup, including any writes made while it ran.
      if (plan.alreadyNative) throw new Error('upgrade-file: this file is already native');
      if (plan.blockers.length) throw new Error(`upgrade-file: cannot upgrade:\n${plan.blockers.join('\n')}`);
      const store = storedState(db);
      for (const { table, field, type } of dateFields(db, store.schema)) {
        const rows = db.prepare(`SELECT _fm_record_id AS id, ${quote(field)} AS value FROM ${quote(table)} WHERE ${quote(field)} IS NOT NULL`).iterate() as Iterable<{ id: number; value: string }>;
        const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(field)} = ? WHERE _fm_record_id = ?`);
        for (const { id, value } of rows) {
          const iso = isoValue(value, type, store.dateOrder)!;
          if (iso !== value) update.run(iso, id);
        }
      }
      const meta = db.prepare('INSERT INTO _fm_meta (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json');
      meta.run('dateOrder', JSON.stringify('ISO'));
      meta.run('fileMode', JSON.stringify('native'));
      db.exec('COMMIT');
      return { backup: backupPath, dateValues: plan.dateValues };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
