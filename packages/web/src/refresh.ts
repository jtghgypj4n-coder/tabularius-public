import type { DataRecord, LayoutObject, RowState, FormulaState } from './types.ts';

/** Reject a response for another window, layout or parent record. */
export function refreshMatches(action: { windowId?: unknown; layoutId?: unknown; recordId?: unknown }, window: string, layout: number, record?: string): boolean {
  return (action.windowId === undefined || action.windowId === window)
    && (action.layoutId === undefined || action.layoutId === layout)
    && (action.recordId === undefined || String(action.recordId) === record);
}

export function objectIds(o: LayoutObject): Set<number> {
  return new Set([o.id, ...(o.children ?? []).flatMap((c) => [...objectIds(c)])]);
}

/** Merge visibility object-wide, even when only one field repetition is refreshed. */
export function mergeObjectState<T extends RowState>(old: T, fresh: T, object: LayoutObject): T {
  const ids = objectIds(object);
  const out = { ...old, hidden: [...old.hidden.filter((id) => !ids.has(id)), ...fresh.hidden.filter((id) => ids.has(id))] };
  for (const key of ['styles', 'labels', 'active', 'web', 'tooltips', 'placeholders', 'charts'] as const) {
    const a = (old as FormulaState)[key];
    const b = (fresh as FormulaState)[key];
    if (!a && !b) continue;
    const values: Record<string, unknown> = { ...a };
    for (const id of ids) {
      delete values[id];
      if (b && id in b) values[id] = b[id];
    }
    Object.assign(out, { [key]: values });
  }
  // Merge fields belong to the refreshed text object (including calculated text).
  const texts = (o: LayoutObject): string => [o.text ?? '', ...(o.children ?? []).map(texts)].join('\n');
  const names = [...texts(object).matchAll(/<<([^<>]+)>>/g)].map((m) => m[1]);
  if (names.length) {
    out.merges = { ...old.merges };
    for (const name of names) {
      delete out.merges[name];
      if (fresh.merges && name in fresh.merges) out.merges[name] = fresh.merges[name];
    }
  }
  return out;
}

/** A field's requested repetition only; related/portal fields use the occurrence prefix. */
export function mergeFieldValues(old: Record<string, unknown>, fresh: Record<string, unknown>, key: string, repetition?: number): void {
  const wanted = (name: string) => name === key || (name.startsWith(key + '(') && /^\(\d+\)$/.test(name.slice(key.length)));
  for (const name of new Set([...Object.keys(old), ...Object.keys(fresh)])) {
    if (!wanted(name)) continue;
    if (repetition && name !== (repetition === 1 ? key : `${key}(${repetition})`)) continue;
    if (name in fresh) old[name] = fresh[name];
    else delete old[name];
  }
}

/** Targeted refresh never changes portal membership; match children by record id, not row index. */
export function mergeObjectRecord(old: DataRecord, fresh: DataRecord, key: string | undefined, repetition?: number, portal?: string, requestedIds?: readonly number[]): void {
  if (!key) return;
  if (!portal) mergeFieldValues(old.fieldData, fresh.fieldData, key, repetition);
  else {
    const rows = new Map(fresh.portalData[portal]?.map((row) => [row.recordId, row]));
    // Only explicitly requested missing identities mean deleted/denied; offscreen rows stay cached.
    const requested = new Set(requestedIds?.map(String) ?? rows.keys());
    for (const row of old.portalData[portal] ?? []) {
      if (requested.has(row.recordId)) mergeFieldValues(row, rows.get(row.recordId) ?? {}, key, repetition);
    }
  }
}

/** Reindex cached records by identity before checkpoint actions inspect the current record. */
export function checkpointCache<T extends { recordId: string }>(cache: Map<number, T>, ids: number[]): Map<number, T> {
  const positions = new Map(ids.map((id, i) => [String(id), i]));
  const out = new Map<number, T>();
  for (const record of cache.values()) {
    const index = positions.get(record.recordId);
    if (index !== undefined) out.set(index, record);
  }
  return out;
}

/** Retain the full count and only mark fetched positions present. */
export function foundPortalPage(rows: DataRecord['portalData'][string], count: number, offset = 1): (typeof rows[number] | undefined)[] {
  const out = new Array<typeof rows[number] | undefined>(count);
  rows.forEach((row, i) => { if (offset - 1 + i < count) out[offset - 1 + i] = row; });
  return out;
}

/** Apply object values to displayed found-set identities while retaining row membership. */
export function mergeFoundObjectRows(old: (DataRecord['portalData'][string][number] | undefined)[], fresh: DataRecord['portalData'][string], object: LayoutObject, repetition?: number): void {
  const fields = (o: LayoutObject): string[] => [
    ...(o.field ? [`${o.field.tableOccurrence}::${o.field.field}`] : []),
    ...(o.children ?? []).flatMap(fields),
  ];
  for (const row of old) {
    if (!row) continue;
    const next = fresh.find((r) => r.recordId === row.recordId);
    if (next) for (const key of fields(object)) mergeFieldValues(row, next, key, repetition);
  }
}

/** Before a script supplies ids, fetched portal positions still identify the scrolled page. */
export function foundPortalRange(shown: number[], ids: number[] | undefined, rows: (DataRecord['portalData'][string][number] | undefined)[]): { offset: number; limit: number } | undefined {
  const positions = new Map<string, number>();
  if (ids) ids.forEach((id, i) => positions.set(String(id), i));
  else rows.forEach((row, i) => { if (row) positions.set(row.recordId, i); });
  const indices = shown.flatMap((id) => { const i = positions.get(String(id)); return i === undefined ? [] : [i]; });
  return indices.length ? { offset: Math.min(...indices) + 1, limit: Math.max(...indices) - Math.min(...indices) + 1 } : undefined;
}
