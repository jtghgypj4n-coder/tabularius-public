/** Spreadsheet-safe CSV field serialization. Negative numeric text is intentionally emitted as text. */
const leading = /^[\s\p{White_Space}\u0000-\u001f\u007f-\u009f]*/u;
const controls = /[\u0000-\u001f\u007f-\u009f]/u;

/** The field types whose values are never text, so a leading minus sign is a sign and not a formula. */
const NON_TEXT = new Set(['number', 'date', 'time', 'timestamp', 'boolean', 'integer', 'decimal']);

/** Whether a spreadsheet would take `text` for a formula or a command (it starts with = + - @ or a control character, after any blanks). */
function formulaLike(text: string): boolean {
  const prefix = leading.exec(text)![0];
  return controls.test(prefix) || /^[=+\-@]/u.test(text.slice(prefix.length));
}

/**
 * Text for a spreadsheet to open: a value it would take for a formula gets an apostrophe in front. A value of a
 * number, date, time or timestamp field (`type`) never does, since what such a field holds is a number or a date and
 * a minus sign in front of one is only a sign.
 */
export function formulaGuard(text: string, type?: string): string {
  return (type === undefined || !NON_TEXT.has(type)) && formulaLike(text) ? `'${text}` : text;
}

/** What an export's `formulaGuard` made of a value, undone for a field of the given type that is not text: the apostrophe goes. */
export function stripFormulaGuard<T extends string | number>(value: T, type: string | undefined): T | string {
  if (typeof value !== 'string' || type === undefined || !NON_TEXT.has(type) || value[0] !== "'") return value;
  const rest = value.slice(1);
  return formulaLike(rest) ? rest : value;
}

export function csvField(text: string, options: { quoteAll?: boolean; quoteWhitespace?: boolean; type?: string } = {}): string {
  const safe = formulaGuard(text, options.type);
  const quote = options.quoteAll || /[",\r\n]/u.test(safe) || (options.quoteWhitespace && /^\s|\s$/u.test(safe));
  return quote ? `"${safe.replace(/"/g, '""')}"` : safe;
}
