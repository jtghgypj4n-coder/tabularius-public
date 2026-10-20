// Presentation only. Never change the bytes covered by an audit hash.
import { csvField } from './csv-export.ts';

/** One bounded physical line; invisible controls are visible, and literal escapes remain distinguishable. */
export function auditText(value: unknown): string {
  const text = String(value ?? '');
  const limit = 4096;
  let shown = '';
  let consumed = 0;
  for (const char of text) {
    const escaped = char === '\\' ? '\\\\' : /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(char)
      ? `\\u{${char.codePointAt(0)!.toString(16).padStart(4, '0')}}` : char;
    if (shown.length + escaped.length > limit) break;
    shown += escaped;
    consumed += char.length;
  }
  return shown + (consumed < text.length ? `… [truncated; ${text.length} UTF-16 units]` : '');
}

export function auditCsvField(value: unknown): string {
  return csvField(auditText(value));
}

/** JSONL remains parseable and one physical line, including when a whole entry exceeds the display budget. */
export function auditJsonLine(entry: { seq: number }): string {
  const json = JSON.stringify(entry);
  // JSON already escapes C0, quotes and backslashes. Escape the remaining invisible controls without
  // changing decoded values. Oversize entries are explicitly labelled previews, never silent truncation.
  const safe = json.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, c =>
    [...c].map(v => v.length === 2
      ? `\\u${v.charCodeAt(0).toString(16)}\\u${v.charCodeAt(1).toString(16)}`
      : `\\u${v.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
  return safe.length <= 65536 ? safe : JSON.stringify({ seq: entry.seq, truncated: true,
    originalCharacters: json.length, preview: auditText(json) });
}
