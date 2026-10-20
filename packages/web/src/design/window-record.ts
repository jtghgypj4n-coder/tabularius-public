// The layout and record the person was on when they opened design mode, so formula previews start there.
// The web client writes it to sessionStorage as it opens design mode; nothing else is kept.

export const WINDOW_RECORD_KEY = 'tabularius.windowRecord';

export function windowRecord(): { layout?: string; recordId?: number } {
  try {
    const v = JSON.parse(sessionStorage.getItem(WINDOW_RECORD_KEY) ?? 'null');
    return v && typeof v.layout === 'string' && Number.isInteger(v.recordId) ? { layout: v.layout, recordId: v.recordId } : {};
  } catch {
    return {};
  }
}
