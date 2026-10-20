// Value-list sorts share matching, duplicate detection and alphabetical fallback
// between SQLite's stored fields and the script engine's evaluated fields.
import type { DateStyle, Field } from '../../fmp12/src/index.ts';
import { asDate, asText, asTime, asTimestamp, num, text, type Value } from '../../calc/src/index.ts';
import { recordSortKey, recordSortLanguage, sortKey, sortLocale } from '../../calc/src/collation.ts';

export function valueListOrder(field: Pick<Field, 'type' | 'options'>, dateOrder: DateStyle, values: Iterable<string>) {
  const language = recordSortLanguage(field.options?.indexLanguage, field.options?.indexLanguageId);
  const lower = sortLocale(language);
  const foldedKey = (value: string): string => language === 'unicode' ? value
    : sortKey(value.normalize('NFC').toLocaleLowerCase(lower), language);
  const alphabeticalKey = (value: string): string => language === 'unicode' ? value
    : recordSortKey(value.normalize('NFC').toLocaleLowerCase(lower), language);
  const normalized = (value: Value): Value => {
    if (asText(value, dateOrder).trim() === '') return text('');
    switch (field.type) {
      case 'number': {
        const n = Number(asText(value, dateOrder).trim().replace(/,/g, ''));
        return Number.isFinite(n) ? num(n) : value;
      }
      case 'date': {
        const day = asDate(value, dateOrder);
        return day === undefined ? value : { type: 'date', value: day };
      }
      case 'time': {
        const seconds = asTime(value);
        return seconds === undefined ? value : { type: 'time', value: seconds };
      }
      case 'timestamp': {
        const seconds = asTimestamp(value, dateOrder);
        return seconds === undefined ? value : { type: 'timestamp', value: seconds };
      }
      default: return text(asText(value, dateOrder));
    }
  };
  const key = (value: Value): string => {
    const v = normalized(value);
    return v.type === 'text' || v.type === 'container' ? foldedKey(v.value) : `${v.type}:${v.value}`;
  };
  const textKey = (value: Value): string => alphabeticalKey(asText(normalized(value), dateOrder));
  const ranks = new Map<string, number>();
  for (const value of values) {
    const k = key(text(value));
    if (k !== '' && !ranks.has(k)) ranks.set(k, ranks.size);
  }
  const rank = (value: Value): number => ranks.get(key(value)) ?? ranks.size;
  const compare = (a: Value, b: Value): number => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra < ranks.size) return 0;
    const ka = textKey(a);
    const kb = textKey(b);
    // Preserve the store's blank-last behavior for custom sorts.
    if (ka === '' || kb === '') return ka === kb ? 0 : ka === '' ? 1 : -1;
    return Buffer.compare(Buffer.from(ka), Buffer.from(kb));
  };
  return { type: field.type, ranks, rank, textKey, compare };
}
