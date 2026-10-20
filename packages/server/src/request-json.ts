/** Container nesting includes the root object/array; scalar values do not add a level. */
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_QUERY_BYTES = 8 * 1024;
export const MAX_JSON_NUMBER_CHARS = 1024;

export class JsonNumberError extends SyntaxError {
  constructor() { super(`Invalid JSON: numbers must be finite and at most ${MAX_JSON_NUMBER_CHARS} characters`); }
}

export class JsonSizeError extends SyntaxError {
  constructor(maxBytes: number) { super(`Invalid JSON: exceeds ${maxBytes} bytes`); }
}

export class JsonDepthError extends SyntaxError {
  constructor() { super(`Invalid JSON: nesting exceeds ${MAX_JSON_DEPTH} levels`); }
}

/** Check before parsing, without recursion or allocating a second object graph. Strings may contain brackets.
 * V8's JSON.parse is not recursive (it can parse 1e6 levels); the bound protects downstream
 * recursion in stringify and walkers, not the parser itself.
 */
export function assertRequestJsonBounds(text: string, maxBytes?: number, finiteNumbers = false): void {
  // Body readers already enforce their endpoint's size cap; query strings pass one here.
  if (maxBytes !== undefined && Buffer.byteLength(text, 'utf8') > maxBytes) throw new JsonSizeError(maxBytes);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') {
      if (++depth > MAX_JSON_DEPTH) throw new JsonDepthError();
    } else if (c === '}' || c === ']') depth--;
    else if (c === '-' || (c >= '0' && c <= '9')) {
      const start = i;
      while (i + 1 < text.length && /[0-9eE+.\-]/.test(text[i + 1])) {
        if (++i - start + 1 > MAX_JSON_NUMBER_CHARS) throw new JsonNumberError();
      }
      const number = text.slice(start, i + 1);
      if (number.length > MAX_JSON_NUMBER_CHARS || (finiteNumbers && !Number.isFinite(Number(number)))) throw new JsonNumberError();
    }
  }
}

export function parseRequestJson(text: string, maxBytes?: number): ReturnType<typeof JSON.parse> {
  assertRequestJsonBounds(text, maxBytes, true);
  return JSON.parse(text);
}
