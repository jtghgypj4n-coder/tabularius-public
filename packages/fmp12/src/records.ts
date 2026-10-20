// Streaming reader for a base table's records, stored at [table].5.[recordId].
//
// Short values are key-value chunks keyed by field id. Values too long for one
// chunk live one level deeper, at [table].5.[recordId].[fieldKey], split into
// parts keyed 1, 2, ... (key 0 holds rich-text formatting). Repetitions of a
// repeating field use a two-byte key: field id, then repetition number (2+).

import { pathInt, pathValue } from './chunks.ts';
import { decodeText } from './scsu.ts';
import type { FmpFile } from './file.ts';

export interface RawRecord {
  id: number;
  /** Field id -> repetitions (index 0 is repetition 1). */
  values: Map<number, string[]>;
}

/** Key 252 on a record is bookkeeping (it looks like a modification counter). */
const RECORD_META_KEY = 252;

export function decodeFieldKey(key: number, wide: boolean, fieldIds: Set<number>): [number, number] | undefined {
  if (fieldIds.has(key)) return [key, 1];
  if (wide && key >= 0x80) {
    const field = (key - 0x80) >> 8;
    const rep = (key - 0x80) & 0xff;
    if (fieldIds.has(field) && rep >= 1) return [field, rep];
  }
  return undefined;
}

export function* readRecords(file: FmpFile, tableId: number, fieldIds: Set<number>): Generator<RawRecord> {
  let current: RawRecord | undefined;
  // Long value being assembled: parts by ordinal.
  let longKey: string | undefined;
  let longParts = new Map<number, Uint8Array>();
  let longTarget: [number, number] | undefined;
  let seenTable = false;

  const setValue = (rec: RawRecord, [field, rep]: [number, number], text: string) => {
    let reps = rec.values.get(field);
    if (!reps) rec.values.set(field, (reps = []));
    while (reps.length < rep) reps.push('');
    reps[rep - 1] = text;
  };

  const flushLong = () => {
    if (current && longTarget && longParts.size) {
      const keys = [...longParts.keys()].sort((a, b) => a - b);
      const len = keys.reduce((n, k) => n + longParts.get(k)!.length, 0);
      const buf = new Uint8Array(len);
      let at = 0;
      for (const k of keys) {
        buf.set(longParts.get(k)!, at);
        at += longParts.get(k)!.length;
      }
      setValue(current, longTarget, decodeText(buf));
    }
    longKey = undefined;
    longTarget = undefined;
    longParts = new Map();
  };

  for (const { path, chunk } of file.chunks(undefined, [tableId, 5])) {
    const top = path.length ? pathValue(path[0]) : undefined;
    if (top !== tableId) {
      if (seenTable && top !== undefined && top > tableId) break;
      continue;
    }
    seenTable = true;
    if (path.length < 3 || pathValue(path[1]) !== 5) continue;
    const recordId = pathInt(path[2]);
    if (recordId === undefined) continue;

    if (!current || current.id !== recordId) {
      flushLong();
      if (current) yield current;
      current = { id: recordId, values: new Map() };
    }

    if (path.length === 3) {
      flushLong();
      if (chunk.type === 'kv') {
        if (chunk.key === RECORD_META_KEY) continue;
        const target = decodeFieldKey(chunk.key, chunk.wide, fieldIds);
        if (target) setValue(current, target, decodeText(chunk.data));
      } else if (chunk.type === 'segment') {
        const target = decodeFieldKey(chunk.index, chunk.wide, fieldIds);
        if (target) setValue(current, target, decodeText(chunk.data));
      }
    } else if (path.length === 4) {
      const seg = path[3];
      const id = `${seg.length}:${pathValue(seg)}`;
      if (id !== longKey) {
        flushLong();
        longKey = id;
        const v = pathValue(seg);
        longTarget = v === undefined ? undefined : decodeFieldKey(v, seg.length === 2, fieldIds);
      }
      if (chunk.type === 'kv' && chunk.key >= 1) longParts.set(chunk.key, chunk.data);
      else if (chunk.type === 'segment' && chunk.index >= 1) longParts.set(chunk.index, chunk.data);
    }
  }
  flushLong();
  if (current) yield current;
}
