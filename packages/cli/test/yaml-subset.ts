// A reader for the small part of YAML that the Compose files in this repository use: block mappings, block sequences of
// text or of mappings, quoted and plain text, true/false and comments. It is a checker's reader, not a general one: anything
// else (flow collections, anchors, block scalars, tabs, several documents, text carried over lines) throws, so a file that
// starts using it is noticed here rather than read wrongly.

export type Yaml = string | boolean | Yaml[] | { [key: string]: Yaml };

interface Line { indent: number; text: string; no: number }

function unsupported(no: number, what: string): never {
  throw new Error(`line ${no}: ${what} is not part of the YAML this reader understands; extend yaml-subset.ts or keep to block mappings and lists`);
}

/** Text without a trailing comment: a # that starts the text or follows a space, outside quotes. */
function withoutComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if ((c === '"' || c === "'") && (i === 0 || /[\s:\[,-]/.test(text[i - 1]!))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]!))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

function scalar(raw: string, no: number): string | boolean {
  const text = raw.trim();
  if (/^[\[{]/.test(text)) unsupported(no, 'a flow list or mapping');
  if (/^[&*!|>%@`]/.test(text)) unsupported(no, `"${text[0]}" at the start of a value`);
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) unsupported(no, 'a quoted text that does not end where the line does');
    return JSON.parse(text);
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) unsupported(no, 'a quoted text that does not end where the line does');
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/: |:$/.test(text)) unsupported(no, 'a colon inside a plain value');
  return text === 'true' ? true : text === 'false' ? false : text;
}

function key(text: string, no: number): { key: string; rest: string } | undefined {
  const m = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'#:\-?\[{&*!|>%@`][^:#]*?|-[^\s:][^:#]*?)\s*:(?:\s+(.*)|)$/.exec(text);
  if (!m) return undefined;
  const k = m[1]!;
  return { key: k.startsWith('"') || k.startsWith("'") ? String(scalar(k, no)) : k, rest: m[2] ?? '' };
}

export function parseYaml(source: string): Yaml {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    if (/^\s*\t|^\t/.test(raw)) unsupported(no, 'a tab used to indent');
    const text = withoutComment(raw.trimEnd());
    if (!text.trim()) return;
    if (/^(---|\.\.\.)(\s|$)/.test(text)) unsupported(no, 'a document marker');
    lines.push({ indent: raw.length - raw.trimStart().length, text: text.trim(), no });
  });
  let at = 0;

  function block(indent: number): Yaml {
    const first = lines[at];
    if (!first || first.indent < indent) return '';
    return first.text === '-' || first.text.startsWith('- ') ? list(first.indent) : map(first.indent);
  }

  function map(indent: number, inline?: Line): { [key: string]: Yaml } {
    const out: { [key: string]: Yaml } = {};
    let carried = inline;
    for (;;) {
      const line = carried ?? lines[at];
      if (!line || line.indent !== indent || line.text === '-' || line.text.startsWith('- ')) {
        if (line && line.indent > indent) unsupported(line.no, 'text carried over from the line above');
        return out;
      }
      if (carried) carried = undefined; else at++;
      const kv = key(line.text, line.no);
      if (!kv) unsupported(line.no, `"${line.text}" as a mapping entry`);
      if (Object.hasOwn(out, kv.key)) throw new Error(`line ${line.no}: "${kv.key}" appears twice`);
      if (kv.rest) out[kv.key] = scalar(kv.rest, line.no);
      else {
        const next = lines[at];
        // A list may sit level with its key; a mapping must be indented under it.
        if (next && (next.indent > indent || (next.indent === indent && (next.text === '-' || next.text.startsWith('- '))))) out[kv.key] = block(next.indent);
        else out[kv.key] = '';
      }
    }
  }

  function list(indent: number): Yaml[] {
    const out: Yaml[] = [];
    for (;;) {
      const line = lines[at];
      if (!line || line.indent !== indent || !(line.text === '-' || line.text.startsWith('- '))) {
        if (line && line.indent > indent) unsupported(line.no, 'text carried over from the line above');
        return out;
      }
      at++;
      const rest = line.text.slice(1).trim();
      if (!rest) { out.push(lines[at] && lines[at]!.indent > indent ? block(lines[at]!.indent) : ''); continue; }
      if (key(rest, line.no)) {
        // "- name: value" starts a mapping whose other entries line up under "name".
        const inner = indent + (line.text.length - line.text.slice(1).trimStart().length);
        out.push(map(inner, { indent: inner, text: rest, no: line.no }));
      } else out.push(scalar(rest, line.no));
    }
  }

  if (!lines.length) return {};
  const value = block(lines[0]!.indent);
  if (at < lines.length) unsupported(lines[at]!.no, 'an indent that does not match the lines above');
  return value;
}
