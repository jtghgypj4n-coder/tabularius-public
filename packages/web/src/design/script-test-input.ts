// What the script editor's Tests form takes as text: "name = value" lines and find requests.

/** "name = value" lines, as an object (split at the first =; lines without one are skipped). */
export function pairs(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const k = line.slice(0, at).trim();
    if (k) out[k] = decodeValue(line.slice(at + 1).trim());
  }
  return Object.keys(out).length ? out : undefined;
}
const encodeValue = (value: string) => value.replace(/\\|\r\n|\r|\n/g, (part) => part === '\\' ? '\\\\' : part === '\r' ? '\\r' : part === '\r\n' ? '\\r\\n' : '\\n');
const decodeValue = (value: string) => value.replace(/\\\\|\\r|\\n/g, (part) => part === '\\\\' ? '\\' : part === '\\r' ? '\r' : '\n');
export const lines = (o: Record<string, string> | undefined) => Object.entries(o ?? {}).map(([k, v]) => `${k} = ${encodeValue(v)}`).join('\n');

/** The found set's find requests as lines: one request per line, "Field: criterion" parts joined by " ; ". */
export function requests(text: string): Record<string, string>[] | undefined {
  const out = text.split('\n').map((line) => {
    const r: Record<string, string> = {};
    for (const part of line.split(' ; ')) {
      // The first colon that isn't part of a Table::Field name.
      let at = -1;
      for (let i = 0; i < part.length && at < 0; i++) if (part[i] === ':' && part[i + 1] !== ':' && part[i - 1] !== ':') at = i;
      if (at > 0) r[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    return r;
  }).filter((r) => Object.keys(r).length);
  return out.length ? out : undefined;
}
export const requestLines = (find: Record<string, string>[] | undefined) => (find ?? []).map((r) => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' ; ')).join('\n');
