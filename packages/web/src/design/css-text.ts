/** Split declarations only where a semicolon is outside strings and functions. */
function declarations(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    else if ((c === ';' || c === '\n') && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export const parseCss = (text: string): Record<string, string> => {
  const css: Record<string, string> = {};
  for (const line of declarations(text)) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(i + 1).trim()) css[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return css;
};

export const cssText = (css: Record<string, string>) => Object.entries(css).map(([k, v]) => `${k}: ${v}`).join('\n');
