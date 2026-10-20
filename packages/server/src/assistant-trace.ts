// What the assistant's panel shows of a tool call: its arguments with anything secret taken out, and a short
// summary of the result. The person sees what the model asked for and was told, as far as it is safe to show;
// {"tool": ...} lines of the streamed answer (assistant.ts).

import { HIDDEN_VALUE, redactSecrets, secretName } from './ai-output.ts';

/** One tool call as the panel shows it. */
export interface ToolTrace {
  id: string;
  name: string;
  /** In words ("Looking at layout "Orders""), the same line the step list shows. */
  label: string;
  /** The model's arguments, secrets hidden and long values cut. */
  args: unknown;
  /** The start of the result, secrets hidden, on one line. */
  result: string;
  /** How long the result was, in characters. */
  resultLength: number;
  error?: true;
}

const ARG_CHARS = 400;
const RESULT_CHARS = 300;
const MAX_ITEMS = 20;
const MAX_DEPTH = 5;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}… (${s.length - max} more characters)` : s);

/** A tool's arguments for display: a key that names a secret has its value hidden, strings are scrubbed and cut, and the shape is capped. */
export function traceArgs(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return cut(redactSecrets(value), ARG_CHARS);
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => traceArgs(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… ${value.length - MAX_ITEMS} more`] : items;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries.slice(0, MAX_ITEMS)) out[k] = secretName(k) && v !== '' && v !== null && v !== undefined ? HIDDEN_VALUE : traceArgs(v, depth + 1);
    if (entries.length > MAX_ITEMS) out['…'] = `${entries.length - MAX_ITEMS} more`;
    return out;
  }
  return value;
}

/** The start of a tool's result on one line, with secrets hidden. */
export function traceResult(content: string): { result: string; resultLength: number } {
  const text = redactSecrets(content).replace(/\s+/g, ' ').trim();
  return { result: cut(text, RESULT_CHARS), resultLength: content.length };
}
