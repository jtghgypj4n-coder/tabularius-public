// OData $crossjoin: pairs of records from two or three entity sets, kept where a
// $filter across them holds, as OData 4.0 has it:
//
//   GET .../Contacts/$crossjoin(Customers,Orders)?$filter=Customers/CustomerID eq Orders/CustomerID
//
// Properties are named Set/Property. Each row links to its records
// ("Customers@odata.navigationLink": "Customers(1)"); $expand=Customers,Orders($select=Total)
// puts them inline. $orderby, $top, $skip and $count work on the rows. Each
// set is read as the account sees it, records and fields alike. Conditions
// on one set alone are run where the records are (the store's SQL); the rest
// run on the pairs, which are capped (CROSSJOIN_LIMIT) so that a join can't
// hold the server.

import { ApiError } from './dataapi.ts';

/**
 * Records read from each set, combinations joined, text the named properties hold, how long the join (run in a
 * child process of its own, killed past this) may take, the memory it may use, and how many may run at once.
 */
export const CROSSJOIN_LIMIT = { sets: 3, records: 100_000, pairs: 500_000, bytes: 64_000_000, ms: 10_000, heapMb: 512, running: 2 };

const bad = (message: string) => new ApiError(3, `$crossjoin: ${message}`, 400);

/** The entity set names in "$crossjoin(A,B)", or undefined when the segment isn't one. */
export function crossjoinSets(segment: string): string[] | undefined {
  const m = /^\$crossjoin\((.*)\)$/i.exec(segment);
  if (!m) return undefined;
  const names = m[1].split(',').map((x) => x.trim());
  if (names.length < 2 || names.length > CROSSJOIN_LIMIT.sets || names.some((x) => !x)) {
    throw bad(`name 2 to ${CROSSJOIN_LIMIT.sets} entity sets, separated by commas`);
  }
  return names;
}

const word = (t: string | undefined) => t !== undefined && /^[\p{L}_]/u.test(t);
const keyword = (t: string, w: string) => t.toLowerCase() === w;

/** The Set/Property paths a $filter's tokens name, as [set, property]. */
export function paths(tokens: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let k = 0; k + 2 < tokens.length; k++) {
    if (word(tokens[k]) && tokens[k + 1] === '/' && word(tokens[k + 2])) out.push([tokens[k], tokens[k + 2]]);
  }
  return out;
}

/**
 * A $filter's tokens as the conditions that must all hold: split at each "and"
 * outside parentheses. With an "or" outside parentheses, "and" binds tighter,
 * so the whole filter is one condition; so is one whose parentheses don't
 * pair up or that has an empty side of an "and" (so $filter's own parser
 * refuses it). A name after "/" is a property, never an operator.
 */
export function conjuncts(tokens: string[]): string[][] {
  const parts: string[][] = [[]];
  let depth = 0;
  for (const [k, t] of tokens.entries()) {
    const operator = tokens[k - 1] !== '/';
    if (t === '(') depth++;
    else if (t === ')' && --depth < 0) return [tokens];
    else if (depth === 0 && operator && keyword(t, 'or')) return [tokens];
    if (depth === 0 && operator && keyword(t, 'and')) parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return depth !== 0 || parts.some((x) => !x.length) ? [tokens] : parts;
}

/** Whether a $filter's parentheses pair up (each condition is wrapped in its own, so they must). */
export function balanced(tokens: string[]): boolean {
  let depth = 0;
  for (const t of tokens) {
    if (t === '(') depth++;
    else if (t === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Whether a $filter names ROWID or ROWMODID without a set, which a $crossjoin can't tell apart. */
export function bareRowId(tokens: string[]): boolean {
  return tokens.some((t, k) => /^row(mod)?id$/i.test(t) && tokens[k - 1] !== '/');
}

/** $expand on a $crossjoin: the sets to put inline, each with the properties $select names (all when it names none). */
export function crossjoinExpand(text: string | null, names: string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  if (!text) return out;
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k <= text.length; k++) {
    const c = text[k];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ',' && depth === 0) || k === text.length) {
      items.push(text.slice(from, k).trim());
      from = k + 1;
    }
  }
  for (const item of items) {
    const m = /^([^()]+?)\s*(?:\((.*)\))?$/.exec(item);
    if (!m) throw bad(`$expand: "${item}" is not an entity set`);
    const targets = m[1] === '*' ? names : [names.find((x) => x.toLowerCase() === m[1].toLowerCase())];
    if (!targets[0]) throw bad(`$expand: "${m[1]}" is not one of ${names.join(', ')}`);
    let select: string | undefined;
    for (const opt of (m[2] ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
      const o = /^\$select=(.*)$/i.exec(opt);
      if (!o) throw bad(`$expand: only $select is supported inside, not "${opt}"`);
      if (select !== undefined) throw bad('$expand: one $select for each set');
      select = o[1];
    }
    for (const t of targets) {
      if (out.has(t!)) throw bad(`$expand names ${t} more than once`);
      out.set(t!, select);
    }
  }
  return out;
}
