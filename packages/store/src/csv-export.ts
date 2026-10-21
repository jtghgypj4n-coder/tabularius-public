/** Spreadsheet-safe CSV field serialization. Negative numeric text is intentionally emitted as text. */
const leading = /^[\s\p{White_Space}\u0000-\u001f\u007f-\u009f]*/u;
const controls = /[\u0000-\u001f\u007f-\u009f]/u;

/** Types whose valid numeric representations can start with a minus sign. */
const NON_TEXT = new Set(['number', 'date', 'time', 'timestamp', 'boolean', 'integer', 'decimal']);
const NUMERIC = new Set(['number', 'integer', 'decimal']);
const numericText = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** Whether a spreadsheet would take `text` for a formula or a command (it starts with = + - @ or a control character, after any blanks). */
function formulaLike(text: string): boolean {
  const prefix = leading.exec(text)![0];
  return controls.test(prefix) || /^[=+\-@]/u.test(text.slice(prefix.length));
}

/**
 * Text for a spreadsheet to open: a value it would take for a formula gets an apostrophe in front. Only a validated
 * negative numeric representation is exempt; compatibility fields can hold arbitrary text regardless of type.
 */
export function formulaGuard(text: string, type?: string): string {
  return formulaLike(text) && !(type && NUMERIC.has(type) && numericText.test(text)) ? `'${text}` : text;
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
