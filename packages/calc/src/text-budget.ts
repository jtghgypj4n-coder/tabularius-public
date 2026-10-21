import { ComplexityError } from './complexity-error.ts';

// Implementation limits, not FileMaker compatibility claims. Check before
// allocating expanded text; a time limit alone cannot prevent an allocation.
export const MAX_TEXT_RESULT = 8_000_000;
export const MAX_TEXT_MATCHES = 250_000;

export function checkTextSize(size: number): void {
  if (!Number.isSafeInteger(size) || size > MAX_TEXT_RESULT) throw new RangeError('The result is too large');
}

/**
 * Literal, non-overlapping substitution, with no replacement-string operators. The result size is checked before
 * anything is built; the number of matches is not capped here, since counting them is linear in the input and a
 * replacement that does not grow the text cannot make it larger.
 */
export function substituteText(input: string, search: string, replacement: string, limitUnchanged = false): string {
  if (!search) { if (limitUnchanged) checkTextSize(input.length); return input; }
  let count = 0;
  for (let at = input.indexOf(search); at >= 0; at = input.indexOf(search, at + search.length)) count++;
  if (!count) { if (limitUnchanged) checkTextSize(input.length); return input; }
  checkTextSize(input.length + count * (replacement.length - search.length));
  return input.replaceAll(search, () => replacement);
}

/** Core calculation outputs use a marked refusal; plug-ins keep their RangeError translation. */
export function checkCalcTextSize(size: number): void {
  try { checkTextSize(size); } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    throw new ComplexityError(e.message);
  }
}

/** Count every separator and suffix before joining, checking as each part arrives. */
export function joinCalcText(parts: Iterable<string>, separator = '', suffix = ''): string {
  const out: string[] = [];
  let size = suffix.length;
  checkCalcTextSize(size);
  for (const part of parts) {
    size += part.length + (out.length ? separator.length : 0);
    checkCalcTextSize(size);
    out.push(part);
  }
  return out.join(separator) + suffix;
}

/** Total UTF-16 payload length without constructing the joined text. */
export function textLength(parts: readonly string[]): number {
  let size = 0;
  for (const part of parts) size += part.length;
  return size;
}
/** Check a join, including an optional trailing delimiter, before constructing it. */
export function joinText(parts: readonly string[], delimiter = '', trailing = false): string {
  checkTextSize(textLength(parts) + Math.max(0, parts.length - (trailing ? 0 : 1)) * delimiter.length);
  return parts.join(delimiter) + (trailing && parts.length ? delimiter : '');
}

/** Quoted JSON string size without allocating it. The MBS JSON writer leaves lone surrogates unescaped. */
export function jsonStringSize(s: string, encoding: 'utf16' | 'utf8' = 'utf16', escapeLoneSurrogates = true): number {
  let size = 2;
  for (const c of s) {
    const code = c.charCodeAt(0);
    size += c === '"' || c === '\\' || '\b\f\n\r\t'.includes(c) ? 2
      : code < 32 || (escapeLoneSurrogates && c.length === 1 && code >= 0xd800 && code <= 0xdfff) ? 6
      : encoding === 'utf8' ? Buffer.byteLength(c, 'utf8') : c.length;
  }
  return size;
}

/** JSON string-array output, including escaping, checked before serialization. */
export function jsonStringArray(parts: readonly string[], delimiter = ','): string {
  let size = 2 + Math.max(0, parts.length - 1) * delimiter.length;
  checkTextSize(size);
  for (const part of parts) {
    size += jsonStringSize(part);
    checkTextSize(size);
  }
  return '[' + parts.map(x => JSON.stringify(x)).join(delimiter) + ']';
}
