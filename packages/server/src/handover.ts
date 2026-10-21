// "Explain this file": a handover memo for a solution someone is taking over, often one just converted from .fmp12.
// What goes to the model is the design only, gathered here: the solution's map (tables and how they relate,
// layouts, scripts and what starts them), what reaches outside, what won't work here, risky security setups and
// objects nothing uses. No record data and no record counts; values that look like secrets are hidden by the caller.

import type { Store } from '../../store/src/index.ts';
import { conversionReport } from './conversion.ts';
import { conversionGuide, guideText } from './conversion-guide.ts';
import { reviewGraph } from './graph-review.ts';
import { canVerifyUnused, solutionIndex, solutionOverview } from './insight.ts';
import { reviewPrivileges } from './privilege-review.ts';
import { scriptForModel } from './script-for-model.ts';

const lower = (s: string) => s.toLowerCase();
const list = (items: string[], max: number) => (items.length > max ? `${items.slice(0, max).join(', ')}, … (${items.length - max} more)` : items.join(', '));

/** Layouts, value lists, custom functions and table occurrences nothing in the solution uses. */
export function unusedObjects(store: Store): { layouts: string[]; valueLists: string[]; functions: string[]; occurrences: string[] } {
  const s = store.schema;
  const index = solutionIndex(store);
  const used = { layouts: new Set<string>(), valueLists: new Set<string>(), functions: new Set<string>() };
  for (const site of index.sites) {
    for (const n of site.refs.layouts) used.layouts.add(n);
    for (const n of site.refs.valueLists) used.valueLists.add(n);
    // A function calling itself is not a use of it.
    for (const n of site.refs.functions) if (!(site.kind === 'customFunction' && lower(site.where).startsWith(`custom function ${n} (`))) used.functions.add(n);
  }
  // A value list named in a formula (ValueListItems ( Get ( FileName ) ; "Colors" )) is used too.
  const texts = index.sites.map((x) => lower(x.text));
  for (const v of s.valueLists) if (texts.some((t) => t.includes(`"${lower(v.name)}"`))) used.valueLists.add(lower(v.name));
  const graph = reviewGraph(store);
  const unusedTo = new Set(graph.issues.filter((i) => i.rule === 'unused').flatMap((i) => i.occurrences));
  return {
    // Folders and separators are not layouts anyone opens.
    layouts: s.layouts.filter((l) => l.name && l.tableOccurrenceId !== undefined && !used.layouts.has(lower(l.name)) && canVerifyUnused(index, l.name)).map((l) => l.name),
    valueLists: s.valueLists.filter((v) => !used.valueLists.has(lower(v.name)) && canVerifyUnused(index, v.name)).map((v) => v.name),
    functions: s.customFunctions.filter((f) => !used.functions.has(lower(f.name)) && canVerifyUnused(index, f.name)).map((f) => f.name),
    occurrences: s.tableOccurrences.filter((t) => unusedTo.has(t.id)).map((t) => t.name),
  };
}

/** Everything the memo is written from, as text: the design only. */
export function handoverFacts(store: Store, hosted: string[] = []): string {
  const out = [solutionOverview(store, { counts: false })];
  // Migration readiness: what won't work the same off FileMaker, worst first, each with what to do instead.
  const report = conversionReport(store, hosted, undefined, { designOnly: true });
  const guide = conversionGuide(store, hosted, report);
  out.push('', '## Migration readiness (severity; uses)', guideText(guide, { designOnly: true }).split('\n').slice(2).join('\n') || 'Everything works here as it did in FileMaker.');
  const graph = reviewGraph(store);
  const warnings = graph.issues.filter((i) => i.severity === 'warning');
  if (warnings.length) out.push('', '## Relationship graph problems', ...warnings.slice(0, 20).map((i) => `- ${i.message}`));
  // Not who has signed in lately (the audit log): the setups only.
  const security = reviewPrivileges(store).findings.filter((f) => f.severity !== 'low' && f.kind !== 'unused-extended');
  if (security.length) out.push('', '## Security setups to look at', ...security.slice(0, 15).map((f) => `- (${f.severity}) ${f.title}`));
  const unused = unusedObjects(store);
  if (!solutionIndex(store).referenceComplete) out.push('', '## Unused objects', 'Cannot verify some unused objects because some calculations could not be indexed; names those calculations may contain are excluded below.');
  const parts = [
    unused.layouts.length ? `Layouts no script or button goes to (people may still pick them from the Layouts menu): ${list(unused.layouts, 40)}.` : '',
    unused.valueLists.length ? `Value lists no field or layout uses: ${list(unused.valueLists, 30)}.` : '',
    unused.functions.length ? `Custom functions nothing calls: ${list(unused.functions, 30)}.` : '',
    unused.occurrences.length ? `Table occurrences nothing uses: ${list(unused.occurrences, 30)}.` : '',
  ].filter(Boolean);
  if (parts.length) out.push('', '## Possibly unused', ...parts.map((p) => `- ${p}`));
  return out.join('\n');
}

/**
 * Each script as the model documents it (the design only): its name, what starts it (buttons, triggers, menus, other
 * scripts), the scripts it performs, what it reaches outside with, and its steps with every secret-looking literal
 * hidden, long scripts cut short. In groups of about `size` characters, one model call each, in the Scripts order.
 */
export function scriptDocFacts(store: Store, size = 40_000): string[] {
  const index = solutionIndex(store);
  const groups: string[] = [];
  let group = '';
  for (const sc of store.schema.scripts) {
    if (!sc.name) continue;
    const key = lower(sc.name);
    const started = [
      ...[...index.buttons.get(key) ?? []].map((l) => `a button on ${l}`),
      ...index.starters.get(key) ?? [],
      ...[...index.callers.get(key) ?? []].map((c) => `the script ${c}`),
    ];
    const text = scriptForModel(sc.steps);
    const facts = [
      `### ${sc.name}`,
      `Started by: ${started.length ? list(started, 12) : 'nothing in the file (people run it from the Scripts menu, or it is unused)'}.`,
      ...(index.calls.get(key)?.size ? [`Performs: ${list([...index.calls.get(key)!], 12)}.`] : []),
      ...(index.outbound.get(key)?.size ? [`Reaches outside with: ${list([...index.outbound.get(key)!], 8)}.`] : []),
      ...(sc.fullAccess ? ['Runs with full access privileges.'] : []),
      'Steps:', text.length > 6000 ? `${text.slice(0, 6000)}\n… (${text.split('\n').length} lines in all; the rest left out)` : text || '(no steps)',
    ].join('\n');
    if (group && group.length + facts.length > size) {
      groups.push(group);
      group = '';
    }
    group += (group ? '\n\n' : '') + facts;
  }
  if (group) groups.push(group);
  return groups;
}
