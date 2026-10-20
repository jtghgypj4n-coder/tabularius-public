// Saved and recent finds (Records > Saved Finds).

import type { FindRequest } from './types.ts';

/** A saved or recent find: its requests and the layout they were typed on. */
export interface SavedFind { name: string; layout: string; requests: { criteria: Record<string, string>; omit: boolean }[] }

/** Build the ordered Data API requests represented by Find mode's request rows. */
export function buildFindRequests(rows: { criteria: Record<string, string>; omit: boolean }[]): FindRequest[] {
  const requests: FindRequest[] = [];
  for (const row of rows) {
    const request: FindRequest = {};
    for (const [key, value] of Object.entries(row.criteria)) {
      if (!value.trim()) continue;
      // Portal criteria are keyed "portal|TO::Field" in Find mode.
      request[key.includes('|') ? key.slice(key.indexOf('|') + 1) : key] = value;
    }
    if (!Object.keys(request).length) continue;
    if (row.omit) request.omit = 'true';
    requests.push(request);
  }
  // An omit-only find starts from the full found set, including records whose
  // fields are empty, before removing records that match each omit request.
  if (requests.length && requests.every((request) => request.omit)) requests.unshift({});
  return requests;
}

/** A find's name as FileMaker words recent finds: "Publisher: Marvel; Omit Status: Inactive". */
export function findName(requests: { criteria: Record<string, string>; omit: boolean }[]): string {
  const parts = requests.map((r) => {
    const c = Object.entries(r.criteria).filter(([, v]) => v.trim())
      .map(([k, v]) => `${k.slice(k.indexOf('|') + 1).replace(/^.*::/, '')}: ${v.trim()}`).join(', ');
    return c && (r.omit ? `Omit ${c}` : c);
  }).filter(Boolean);
  const name = parts.join('; ') || 'Find';
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/** FileMaker's find operators (Insert Operator): what's typed and what it means. */
export const FIND_OPERATORS: [string, string][] = [
  ['<', 'less than'], ['≤', 'less than or equal'], ['>', 'greater than'], ['≥', 'greater than or equal'],
  ['=', 'exact match'], ['==', 'field content match'], ['...', 'range'], ['!', 'duplicate values'],
  ['//', "today's date"], ['?', 'invalid date or time'], ['@', 'one character'], ['#', 'one digit'],
  ['*', 'zero or more characters'], ['""', 'match phrase'], ['~', 'relaxed search'],
];

/** Find Matching Records: the request that finds records whose field holds exactly this value. */
export function matchingCriterion(value: string): string {
  return value === '' ? '=' : `==${value}`;
}
