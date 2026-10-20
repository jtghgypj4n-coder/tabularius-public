// The search field: plain words look in every text field of the list, and "field: value" narrows by one field
// (the value takes FileMaker's find syntax, so "total: >500" and "date: 1/1/2026...3/31/2026" work). Each
// narrowing shows as a chip that can be taken off; the words stay in the field.

import type { FindRequest } from '../src/types.ts';
import type { Column } from './model.ts';

export interface Filter {
  field: string;
  label: string;
  value: string;
}

export interface Search {
  words: string;
  filters: Filter[];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_.]+/g, '');

/** The column a typed name means: its label or its name, ignoring case, spaces and underscores. */
export function columnFor(columns: Column[], typed: string): Column | undefined {
  const t = norm(typed);
  if (!t) return undefined;
  return columns.find((c) => norm(c.label) === t || norm(c.name) === t)
    ?? columns.find((c) => norm(c.label).startsWith(t) || norm(c.name).startsWith(t));
}

/**
 * Splits what was typed into words and filters. "city: Leeds" or "city:Leeds" makes a filter when "city" names a
 * column; a quoted value keeps its spaces ("city: \"New York\""). Anything else stays as words.
 */
export function parse(text: string, columns: Column[]): Search {
  const filters: Filter[] = [];
  const rest: string[] = [];
  const re = /(?:^|\s)([^\s:"]+(?:\s[^\s:"]+)?):\s*("([^"]*)"|\S+)|(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1]) {
      const value = m[3] ?? m[2];
      // "first name: Ada" names a two-word field; "ada city: Leeds" is a word, then a one-word field.
      const [first, second] = m[1].split(' ');
      const two = second ? columnFor(columns, m[1]) : undefined;
      const one = two ? undefined : columnFor(columns, second ?? first);
      const col = two ?? one;
      if (col) {
        if (second && !two) rest.push(first);
        filters.push({ field: col.name, label: col.label, value });
        continue;
      }
      rest.push(`${m[1]}:${m[2]}`);
    } else if (m[4]) rest.push(m[4]);
  }
  return { words: rest.join(' ').trim(), filters };
}

/**
 * FileMaker find requests for a search: one request per searchable field holding the words (any of them can
 * match), each also holding every filter (all of them must). Filters alone make one request.
 */
export function requests(search: Search, searchable: Column[]): FindRequest[] {
  const base: Record<string, string> = {};
  for (const f of search.filters) base[f.field] = f.value;
  if (!search.words) return Object.keys(base).length ? [base as FindRequest] : [];
  const fields = searchable.filter((c) => !(c.name in base));
  if (!fields.length) return [{ ...base } as FindRequest];
  return fields.map((c) => ({ ...base, [c.name]: search.words }) as FindRequest);
}

/** Puts a search back into text, for the search field after a chip is removed. */
export function unparse(search: Search): string {
  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
  return [...search.filters.map((f) => `${f.label.toLowerCase()}: ${quote(f.value)}`), search.words].filter(Boolean).join(' ');
}
