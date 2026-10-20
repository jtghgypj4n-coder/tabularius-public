/** Rows of comma-, tab-, semicolon- or pipe-separated text (`report` is told the row of a quote that is never closed); quoted values may hold the separator, quotes ("") and line breaks. */
export function* parseDelimitedRows(src: string, sep: string, strict = false, report?: { unclosedQuoteRow?: number }): Generator<string[]> {
  // Tab-separated text is written without quotes, so a value that starts with a lone quote is just text.
  const opens = (at: number) => {
    if (sep !== '\t') return true;
    for (let j = at + 1; j < src.length; j++) {
      if (src[j] !== '"') continue;
      if (src[j + 1] === '"') { j++; continue; }
      return j + 1 >= src.length || src[j + 1] === sep || src[j + 1] === '\r' || src[j + 1] === '\n';
    }
    return false;
  };
  let row: string[] = [];
  let v = '';
  let quoted = false;
  let closed = false;
  let quoteRow = 0;
  let lines = 0;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] !== '"') { quoted = false; closed = true; }
      else {
        // Up to the quote that closes the value at once: a character at a time, a long value is a string of millions
        // of pieces (~33 bytes each). In between, quotes come only in pairs ("").
        let end = i;
        for (let q = src.indexOf('"', end); ; q = src.indexOf('"', end)) {
          if (q >= 0 && src[q + 1] === '"') { end = q + 2; continue; }
          end = q < 0 ? src.length : q;
          break;
        }
        // split/join, not replaceAll: that keeps ~32 bytes a pair until it is done.
        v += src.slice(i, end).split('""').join('"');
        i = end - 1;
      }
    } else if (c === '"' && v === '' && (!strict || !closed) && opens(i)) { quoted = true; quoteRow = lines + 1; }
    else if (c === sep) { row.push(v); v = ''; closed = false; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      // A blank line is left out as it is read, not kept to be filtered: a file of line breaks would fill memory.
      if (strict || row.length || v !== '') { row.push(v); yield row; }
      lines++; v = ''; closed = false; row = [];
    } else {
      if (strict && (closed || c === '"')) throw new Error('Malformed CSV quoting');
      let end = i + 1;
      while (end < src.length && src[end] !== '"' && src[end] !== sep && src[end] !== '\r' && src[end] !== '\n') end++;
      v += src.slice(i, end);
      i = end - 1;
    }
  }
  if (quoted && report) report.unclosedQuoteRow = quoteRow;
  if (strict && quoted) throw new Error('Unclosed CSV quote');
  // A last line of just "" is a blank row, dropped like a blank line elsewhere (strict mode keeps it).
  if (strict ? (closed || v !== '' || row.length) : (v !== '' || row.length)) { row.push(v); yield row; }
}

/** All rows of comma-, tab-, semicolon- or pipe-separated text. */
export function parseDelimited(src: string, sep: string, strict = false, report?: { unclosedQuoteRow?: number }): string[][] {
  return [...parseDelimitedRows(src, sep, strict, report)];
}

export type DelimitedFormat = 'csv' | 'tab' | 'semicolon' | 'pipe';
export const DELIMITED_SEPARATORS: Record<DelimitedFormat, string> = { csv: ',', tab: '\t', semicolon: ';', pipe: '|' };

/** The separator a text file uses, from its first line (outside quotes): commas win, else the most used of tab, semicolon and pipe. */
export function sniffSeparator(data: string): DelimitedFormat {
  const counts: Record<DelimitedFormat, number> = { csv: 0, tab: 0, semicolon: 0, pipe: 0 };
  let quoted = false;
  for (const c of data.replace(/^\ufeff/, '')) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted) for (const k of Object.keys(DELIMITED_SEPARATORS) as DelimitedFormat[]) if (c === DELIMITED_SEPARATORS[k]) counts[k]++;
  }
  if (counts.csv) return 'csv';
  const best = (['tab', 'semicolon', 'pipe'] as const).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return counts[best] ? best : 'csv';
}
