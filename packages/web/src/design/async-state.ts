import type { LayoutDesign, LayoutObject } from '../types.ts';
import type { Draft } from './script-tabs.ts';

/** Acknowledge the exact design revision sent; the mutable editor may have advanced meanwhile. */
export function acknowledgeLayoutSave(current: LayoutDesign, submitted: LayoutDesign, accepted: LayoutDesign): { design: LayoutDesign; saved: string } {
  const changedWhileSaving = JSON.stringify(current) !== JSON.stringify(submitted);
  return { design: changedWhileSaving ? current : accepted, saved: JSON.stringify(accepted) };
}

/** Keep edits typed after submission, with the server's accepted text as their new base. */
export function acknowledgeScriptDraft(drafts: Map<number, Draft>, id: number, submitted: string, current: string, accepted: string): Draft | undefined {
  if (current === submitted) {
    drafts.delete(id);
    return undefined;
  }
  const name = drafts.get(id)?.name;
  const draft = { text: current, base: accepted, ...(name === undefined ? {} : { name }) };
  drafts.set(id, draft);
  return draft;
}

/** Commit a replacement and only then acknowledge the draft revisions the user approved. */
export async function commitReplacingScriptDrafts<T>(drafts: Map<number, Draft>, ids: number[], change: () => Promise<T>, acceptedText: (result: T, id: number, fallback: string) => string): Promise<T> {
  const submitted = new Map(ids.map((id) => [id, drafts.get(id)]));
  const result = await change();
  for (const id of ids) {
    const before = submitted.get(id);
    const current = drafts.get(id);
    if (!before || !current) continue;
    acknowledgeScriptDraft(drafts, id, before.text, current.text, acceptedText(result, id, current.base));
  }
  return result;
}

/** Whether a pending layout change may be abandoned after applying the caller's confirmation decision. */
export function canLeaveLayout(dirty: boolean, confirmed: boolean): boolean {
  return !dirty || confirmed;
}

/** Add one full-layout snapshot with a shared bound for every edit path. */
export function pushBoundedHistory(history: string[], snapshot: string, limit: number): void {
  history.push(snapshot);
  if (history.length > limit) history.splice(0, history.length - limit);
}

/** Find an object by stable ID in the current layout tree. */
export function findLayoutObject(objects: LayoutObject[], id: number): LayoutObject | undefined {
  for (const object of objects) {
    if (object.id === id) return object;
    const nested = object.children && findLayoutObject(object.children, id);
    if (nested) return nested;
  }
  return undefined;
}

export function scriptEditorTabKey(input: { key: string; shiftKey: boolean; escaped: boolean }): 'indent' | 'leave' | 'other' {
  if (input.key !== 'Tab') return 'other';
  return input.shiftKey || input.escaped ? 'leave' : 'indent';
}
