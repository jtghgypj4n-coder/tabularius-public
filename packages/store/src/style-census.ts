// What of a file's FileMaker styling Tabularius doesn't draw yet: style
// properties the reader can't turn into CSS (by property id) and theme rules
// for parts or states of objects the web client has no place for. Read from
// the .fmp12 itself (a converted file keeps only what was understood).
// Counts and FileMaker's own element, part and state names only: nothing
// from the file's data. Read-only.

import { readFonts, readLayoutDesigns, readThemes, withStyleGaps, withStyleProbe, STYLE_PARTS, STYLE_STATES, type FmpFile, type Schema, type StyleRule, type Theme } from '../../fmp12/src/index.ts';

/** The parts and states the web client draws (packages/web/src/styles.ts). */
const DRAWN_PARTS = new Set([1, 2, 3, 4, 9, 10, 12, 13, 28]);
const DRAWN_STATES = new Set([1, 2, 3, 4, 7, 18]);

/** What each value field of a style property holds, for guessing what an unknown one is. */
const VALUE_KINDS: Record<number, string> = { 0: 'flag', 3: 'number or choice', 5: 'colour', 6: 'length', 10: 'image slice', 11: 'pair', 12: 'image', 13: 'corner radii', 14: 'position', 16: 'repeat', 18: 'fill', 19: 'shadow' };

export interface StyleCensus {
  themes: number;
  /** Style properties met but not drawn, by property id: how often, in themes and in objects' own styles, and what kind of value. */
  properties: { id: number; themes: number; objects: number; kind: string }[];
  /** Theme rules the web client has no place for, by FileMaker's part and state names. */
  rules: { part: string; state: string; count: number }[];
}

export function styleCensus(file: FmpFile, schema: Schema): StyleCensus {
  const fonts = readFonts(file);
  const t = withStyleGaps(() => readThemes(file, fonts));
  // Layouts read their themes again: only properties in objects' own styles count here.
  const l = { gaps: new Map<number, { count: number; fields: Set<number> }>() };
  withStyleProbe(() => readLayoutDesigns(file, schema), (g) => {
    if (g.known || g.object === undefined) return;
    const e = l.gaps.get(g.id) ?? { count: 0, fields: new Set<number>() };
    e.count++;
    e.fields.add(g.field);
    l.gaps.set(g.id, e);
  });
  const ids = new Set([...t.gaps.keys(), ...l.gaps.keys()]);
  const kind = (id: number) => [...new Set([...(t.gaps.get(id)?.fields ?? []), ...(l.gaps.get(id)?.fields ?? [])])].map((f) => VALUE_KINDS[f] ?? `field ${f}`).join(', ');
  const properties = [...ids].map((id) => ({ id, themes: t.gaps.get(id)?.count ?? 0, objects: l.gaps.get(id)?.count ?? 0, kind: kind(id) }))
    .sort((a, b) => b.themes + b.objects - a.themes - a.objects || a.id - b.id);
  const rules = new Map<string, number>();
  const count = (list: StyleRule[] | undefined) => {
    for (const r of list ?? []) {
      // Placeholder text is drawn for the object and its text only.
      if (DRAWN_PARTS.has(r.part) && DRAWN_STATES.has(r.state) && (r.state !== 18 || r.part <= 2)) continue;
      const key = `${STYLE_PARTS[r.part] ?? `part ${r.part}`}|${STYLE_STATES[r.state] ?? `state ${r.state}`}`;
      rules.set(key, (rules.get(key) ?? 0) + 1);
    }
  };
  const themes: Theme[] = t.result;
  for (const th of themes) {
    for (const list of Object.values(th.defaults)) count(list);
    for (const c of th.contextual ?? []) count(c.rules);
    for (const s of th.styles) count(s.rules);
  }
  return {
    themes: themes.length, properties,
    rules: [...rules].map(([k, n]) => ({ part: k.split('|')[0], state: k.split('|')[1], count: n })).sort((a, b) => b.count - a.count),
  };
}

/** The census as lines of text. */
export function styleCensusText(c: StyleCensus, title: string): string {
  const lines = [`${title}: ${c.themes} theme${c.themes === 1 ? '' : 's'}`];
  if (!c.properties.length) lines.push('  every style property is drawn');
  else {
    lines.push(`  style properties not drawn yet (${c.properties.length}), by property id:`);
    for (const p of c.properties) lines.push(`    ${p.id}: ${p.themes} in themes, ${p.objects} in objects' own styles (${p.kind})`);
  }
  if (c.rules.length) {
    lines.push('  theme rules for parts or states the web client has no place for:');
    for (const r of c.rules) lines.push(`    ${r.part}, ${r.state}: ${r.count}`);
  }
  return lines.join('\n');
}
