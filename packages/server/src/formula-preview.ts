// A formula's results on a few records, as it is being written: the record the person was looking at first (when
// its layout is on the formula's table occurrence), then the first records of a layout that is. Design mode's
// formula boxes show it live as you type, and the assistant checks its drafts against it. Formulas only read;
// nothing is stored.

import type { Store } from '../../store/src/index.ts';

export interface FormulaPreview {
  layout: string;
  results: { recordId: number; value?: string; error?: string }[];
}

const SAMPLE_RECORDS = 5;

/**
 * `text` evaluated from occurrence `contextTo` on up to `limit` records. `from` is where the person is (a layout
 * and record), used first when that layout is on the occurrence. None when no layout shows the occurrence or
 * it has no records.
 */
export function previewFormula(store: Store, contextTo: number | undefined, text: string,
  from: { layout?: string; recordId?: unknown } = {}, limit = SAMPLE_RECORDS): FormulaPreview | undefined {
  if (contextTo === undefined) return undefined;
  const on = store.schema.layouts.filter((l) => l.tableOccurrenceId === contextTo);
  const layout = on.find((l) => l.name === from.layout) ?? on[0];
  if (!layout) return undefined;
  let info;
  let ids: number[];
  try {
    info = store.layout(layout.name);
    ids = store.findIds(info).slice(0, limit + 1);
  } catch {
    return undefined;
  }
  const own = layout.name === from.layout && Number.isInteger(from.recordId) && ids.length ? from.recordId as number : undefined;
  const pick = (own !== undefined ? [own, ...ids.filter((i) => i !== own)] : ids).slice(0, limit);
  if (!pick.length) return undefined;
  return {
    layout: layout.name,
    results: pick.map((recordId) => {
      try {
        const { value } = store.evaluate(info, text, recordId);
        return { recordId, value: value.length > 500 ? value.slice(0, 500) + '…' : value };
      } catch (e) {
        return { recordId, error: (e as Error).message.slice(0, 300) };
      }
    }),
  };
}
