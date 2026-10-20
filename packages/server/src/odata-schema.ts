// OData schema changes, as on FileMaker Server: create and delete tables,
// add and delete fields, create and delete indexes. [Full Access] only, as in
// FileMaker; each change goes through the store's design changes (logged,
// undoable from Design mode like any other).
//
//   POST   {db}/FileMaker_Tables                   {"tableName": "T", "fields": [field, ...]}
//   PATCH  {db}/FileMaker_Tables/{table}           {"fields": [field, ...]}  add fields
//   DELETE {db}/FileMaker_Tables/{table}           delete the table
//   DELETE {db}/FileMaker_Tables/{table}/{field}   delete the field
//   POST   {db}/FileMaker_Indexes/{table}          {"indexName": "field"}
//   DELETE {db}/FileMaker_Indexes/{table}/{field}  remove the field's index
//
// A field: {"name", "type", "nullable", "primary", "unique", "global",
// "repetitions", "default"}. Types are SQL names: VARCHAR / CHARACTER VARYING
// (with an optional length, kept as a maximum-characters check), NUMERIC,
// DECIMAL, INT, DATE, TIME, TIMESTAMP, BLOB / VARBINARY / LONGVARBINARY /
// BINARY VARYING (container). "nullable": false is "not empty", "primary" is
// not empty and unique, "default" is an auto-enter creation value (USER,
// CURRENT_DATE, CURRENT_TIME, CURRENT_TIMESTAMP and their synonyms).

import { writer, type Privileges, type Store } from '../../store/src/index.ts';
import type { DesignOp, FieldSpec } from '../../store/src/design.ts';
import type { AutoEnterValue, FieldType } from '../../fmp12/src/index.ts';
import { ApiError } from './dataapi.ts';

const TYPES: Record<string, FieldType> = {
  VARCHAR: 'text', 'CHARACTER VARYING': 'text', CHAR: 'text', CHARACTER: 'text', TEXT: 'text',
  NUMERIC: 'number', DECIMAL: 'number', INT: 'number', INTEGER: 'number',
  DATE: 'date', TIME: 'time', TIMESTAMP: 'timestamp',
  BLOB: 'container', VARBINARY: 'container', LONGVARBINARY: 'container', 'BINARY VARYING': 'container',
};

const DEFAULTS: Record<string, AutoEnterValue> = {
  USER: 'creationAccountName', USERNAME: 'creationAccountName', CURRENT_USER: 'creationAccountName',
  CURRENT_DATE: 'creationDate', CURDATE: 'creationDate',
  CURRENT_TIME: 'creationTime', CURTIME: 'creationTime',
  CURRENT_TIMESTAMP: 'creationTimestamp', CURTIMESTAMP: 'creationTimestamp', NOW: 'creationTimestamp',
};

const FIELD_KEYS = new Set(['name', 'type', 'nullable', 'primary', 'unique', 'global', 'repetitions', 'default']);

const bad = (message: string) => new ApiError(8310, message, 400);

/** One field of a request, as a design change's field. */
function fieldSpec(raw: unknown, native = false): FieldSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Each field is an object with a "name" and a "type"');
  const f = raw as Record<string, unknown>;
  for (const k of Object.keys(f)) if (!FIELD_KEYS.has(k)) throw bad(`A field has no "${k}" property`);
  if (typeof f.name !== 'string' || !f.name.trim()) throw bad('Each field needs a "name"');
  if (typeof f.type !== 'string') throw bad(`${f.name}: give a "type", such as "VARCHAR(100)", "NUMERIC" or "DATE"`);
  const m = /^\s*([a-z][a-z ]*?)\s*(?:\(\s*(\d+)\s*\))?\s*$/i.exec(f.type);
  const sqlName = m?.[1].toUpperCase().replace(/\s+/g, ' ');
  const nativeTypes: Record<string, FieldType> = { BOOLEAN: 'boolean', BOOL: 'boolean', INTEGER: 'integer', INT: 'integer', BIGINT: 'integer', DECIMAL: 'decimal', NUMERIC: 'decimal', JSON: 'json', JSONB: 'json', UUID: 'uuid' };
  const type = sqlName ? (native ? nativeTypes[sqlName] ?? TYPES[sqlName] : TYPES[sqlName]) : undefined;
  if (!type) throw bad(`${f.name}: "${f.type}" is not a field type`);
  for (const k of ['nullable', 'primary', 'unique', 'global'] as const) {
    if (f[k] !== undefined && typeof f[k] !== 'boolean') throw bad(`${f.name}: "${k}" is true or false`);
  }
  const options: NonNullable<FieldSpec['options']> = {};
  const validation: NonNullable<NonNullable<FieldSpec['options']>['validation']> = {};
  if (f.nullable === false || f.primary) validation.notEmpty = true;
  if (f.unique || f.primary) validation.unique = true;
  // VARCHAR(n): FileMaker keeps the length as a maximum-characters check (inferred from its SQL DDL).
  if (m![2] !== undefined && type === 'text') validation.maxLength = Number(m![2]);
  if (Object.keys(validation).length) options.validation = { strict: true, ...validation };
  if (f.global) options.global = true;
  if (f.repetitions !== undefined) {
    if (!Number.isInteger(f.repetitions) || (f.repetitions as number) < 1 || (f.repetitions as number) > 32000) throw bad(`${f.name}: "repetitions" is a whole number from 1 to 32000`);
    options.repetitions = f.repetitions as number;
  }
  if (f.default !== undefined) {
    const value = typeof f.default === 'string' ? DEFAULTS[f.default.trim().toUpperCase()] : undefined;
    if (!value) throw bad(`${f.name}: "default" is one of ${Object.keys(DEFAULTS).join(', ')}`);
    options.autoEnter = { value };
  }
  return { name: f.name, type, kind: 'normal', ...(Object.keys(options).length ? { options } : {}) };
}

function fieldsOf(body: Record<string, unknown>, required: boolean, native = false): FieldSpec[] {
  if (body.fields === undefined && !required) return [];
  if (!Array.isArray(body.fields) || !body.fields.length) throw bad('Send "fields": a list of the fields to add');
  return body.fields.map((f) => fieldSpec(f, native));
}

const tableOf = (store: Store, name: string) => {
  const t = store.schema.tables.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!t) throw new ApiError(106, `There is no table "${name}"`, 404);
  return t;
};

const fieldOf = (store: Store, table: string, name: string) => {
  const t = tableOf(store, table);
  const f = t.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!f) throw new ApiError(102, `${t.name} has no field "${name}"`, 404);
  return { t, f };
};

/** A table as FileMaker Server describes it after a change: its name and its fields. */
function describe(store: Store, name: string) {
  const t = tableOf(store, name);
  return {
    tableName: t.name,
    fields: t.fields.map((f) => ({
      name: f.name, type: f.type, kind: f.kind,
      ...(f.options?.validation?.notEmpty ? { nullable: false } : {}),
      ...(f.options?.validation?.unique ? { unique: true } : {}),
      ...(f.options?.global ? { global: true } : {}),
      ...((f.options?.repetitions ?? 1) > 1 ? { repetitions: f.options!.repetitions } : {}),
    })),
  };
}

export const SCHEMA_SETS = ['FileMaker_Tables', 'FileMaker_Indexes'];

/**
 * Answers a schema change: the status and JSON body to send, or undefined for 204.
 * `parts` starts at the set name (FileMaker_Tables or FileMaker_Indexes).
 */
export function schemaChange(store: Store, p: Privileges, method: string, parts: string[], body: Record<string, unknown>): { status: number; body?: unknown } {
  if (!p.full) throw new ApiError(9, `Only [Full Access] can change the schema; "${p.name}" can't`, 403);
  // A change set rolls back records, not the design the store keeps in memory, so schema changes stand alone.
  if (writer.getStore()?.transaction) throw new ApiError(3, 'Schema changes can\'t be part of a change set or an open transaction: send them on their own', 400);
  const apply = (ops: DesignOp[]) => store.applyDesign(ops, { account: p.account });
  const [set, table, field] = parts;
  const indexes = set.toLowerCase() === 'filemaker_indexes';
  if (parts.length > 3) throw new ApiError(3, 'Schema paths name at most a table and a field', 404);

  if (!indexes) {
    if (method === 'POST' && parts.length === 1) {
      if (typeof body.tableName !== 'string' || !body.tableName.trim()) throw bad('Send "tableName" and "fields"');
      const name = body.tableName.trim();
      apply([{ op: 'createTable', name, fields: fieldsOf(body, false, store.fileMode === 'native') }]);
      return { status: 201, body: describe(store, name) };
    }
    if (method === 'PATCH' && parts.length === 2) {
      const t = tableOf(store, table);
      apply(fieldsOf(body, true, store.fileMode === 'native').map((f) => ({ op: 'createField', table: t.id, ...f }) as DesignOp));
      return { status: 200, body: describe(store, t.name) };
    }
    if (method === 'DELETE' && parts.length === 2) {
      apply([{ op: 'deleteTable', table: tableOf(store, table).id }]);
      return { status: 204 };
    }
    if (method === 'DELETE' && parts.length === 3) {
      const { t, f } = fieldOf(store, table, field);
      apply([{ op: 'deleteField', table: t.id, field: f.id }]);
      return { status: 204 };
    }
  } else {
    if (method === 'POST' && parts.length === 2) {
      if (typeof body.indexName !== 'string' || !body.indexName.trim()) throw bad('Send "indexName": the field to index');
      const { t, f } = fieldOf(store, table, body.indexName);
      // The design change first, always (it takes the file's transaction hold and logs the change), then the index itself.
      apply([{ op: 'updateField', table: t.id, field: f.id, options: { index: { ...f.options?.index, value: true } } }]);
      store.addFieldIndex(t.name, f.name);
      return { status: 201, body: { indexName: f.name } };
    }
    if (method === 'DELETE' && parts.length === 3) {
      const { t, f } = fieldOf(store, table, field);
      apply([{ op: 'updateField', table: t.id, field: f.id, options: { index: null } }]);
      store.dropFieldIndex(t.name, f.name);
      return { status: 204 };
    }
  }
  throw new ApiError(3, `${method} is not allowed here`, 405);
}
