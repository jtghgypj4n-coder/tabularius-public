// Conversion report: what in a converted FileMaker file won't work yet in
// Tabularius. Functions the calculation engine doesn't have, script steps the
// engine can't run, plug-ins, steps that reach outside (kept offline), formulas
// that don't parse, references that were already broken in FileMaker, other
// files that aren't hosted, and accounts that need a password.

import { FILEMAKER_FUNCTIONS, PLUGIN_FUNCTIONS } from '../../fmp12/src/index.ts';
import { scriptStepName } from '../../fmp12/src/script-steps.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';
import { CLIENT_ONLY_STEPS, SCREEN_STEPS, SERVER_STEPS } from '../../scripts/src/index.ts';
import { customAccess, isFullAccess, type PrivilegeDefinition, type Store } from '../../store/src/index.ts';
import { dataSourceHosted, resolveTargets, solutionIndex, type Target } from './insight.ts';

/** Something that won't work, how often it appears, and the first few places. */
export interface ConversionItem {
  name: string;
  count: number;
  where: string[];
}

export interface ConversionReport {
  database: string;
  /** Unknown binary IDs. A per-database report has one file per ID, regardless of use count. */
  unknownTokens: UnknownTokenItem[];
  /** Readable summary, worst first. */
  summary: string;
  functions: {
    /** FileMaker functions the calculation engine doesn't have yet. */
    notYet: ConversionItem[];
    /** Functions the file reader can't name yet (shown as ⟨fn:xx⟩). */
    undecoded: ConversionItem[];
    /** Neither FileMaker's nor the file's custom functions: plug-ins. */
    plugIns: ConversionItem[];
  };
  steps: {
    /** Script steps the engine can't run yet. */
    notYet: ConversionItem[];
    /** Send no email unless the server's administrator switches sending on. */
    blocked: ConversionItem[];
    /** Reach the network: off unless the server allows it. */
    network: ConversionItem[];
    /** Only affect a screen; skipped on the server, as FileMaker Server does. */
    screenOnly: ConversionItem[];
    /** Only FileMaker Pro can do them (a person choosing a folder, a camera, AppleScript): error 3, as on FileMaker Server. */
    clientOnly: ConversionItem[];
  };
  /** Formulas that don't parse. */
  unparsed: { where: string; text: string; error: string }[];
  /** References FileMaker itself shows as missing; broken before conversion. */
  broken: { where: string; text: string }[];
  /** Other files the solution uses, and whether they are hosted here. */
  dataSources: { name: string; paths: string[]; occurrences: number; scriptSteps?: number; hosted?: string; usedBy?: string[] }[];
  /** Script step formulas that are all comment: FileMaker kept them that way (often a paste that didn't compile), so they give nothing. */
  commentedOut: { where: string; text: string }[];
  /** Container files FileMaker stored outside the file, and how many of them aren't beside it (RC_Data_FMS/<file>/). */
  externalContainers: { files: number; missing: number; examples: string[] };
  /** withoutPassword includes blankPassword: every account that still relies on its FileMaker password (unverifiable here, whether blank or not — see checkFmp12Password's doc comment); blankPassword is the subset of those whose FileMaker password was empty. */
  accounts: { withoutPassword: string[]; blankPassword: string[] };
  /** How the file's accounts and privilege sets came across, and what wasn't decoded. */
  privileges: {
    /** Each account and the privilege set it resolved to (null = none, so no access). */
    assignments: { account: string; privilegeSet: string | null; external?: boolean; builtIn?: boolean; inactive?: boolean }[];
    /** Accounts that resolved to no privilege set: they can't sign in until given one. */
    withoutSet: string[];
    /** Privilege sets imported, each with a short record-access summary and its extended privileges. */
    sets: { name: string; records: string; extended: string[] }[];
    /** True while FileMaker's per-layout/per-value-list/per-script "Custom privileges" and limited record access aren't decoded (imported at the set's overall level). */
    coarsened: boolean;
    /**
     * Sets that use per-table "Custom privileges" for records, and how they came across. Per-table and per-field
     * access is imported fail-closed: a table the set doesn't list has none, and a field is kept only when its
     * access byte is exactly read/write.
     */
    customRecords: { set: string; tables: number; hiddenFields: string[]; unverifiedFields: string[]; unresolvedTables: number }[];
    /**
     * What the reader found in a set or account that no sample file shows (an access byte in a form never seen, a name
     * already taken, key 10 of another length, an account id written another way). Each came across as no access, or as
     * the more careful choice (view only for records, the restrictive default for key 10).
     */
    notUnderstood: { set: string; what: string[] }[];
  };
}

export interface UnknownTokenItem {
  kind: 'function' | 'get' | 'step';
  id: string;
  name: string;
  count: number;
  files: number;
  shapes: string[];
}

const WHERE = 5;
const LIST = 50;
const lower = (s: string) => s.toLowerCase();
const BROKEN = /<(?:Field|Table|Layout|Script|Value List|Function)? ?Missing>|<unknown>|<missing>/i;
const COMMENT = 89;
const SEND_MAIL = 63;
const INSERT_FROM_URL = 160;
/** Execute SQL (the step): an ODBC data source outside the solution. */
const EXECUTE_SQL = 117;
const PERFORM_RAG_ACTION = 219;

class Tally {
  private items = new Map<string, ConversionItem>();
  private readonly keep: number;
  constructor(keep = WHERE) {
    this.keep = keep;
  }
  add(name: string, where: string): void {
    const item = this.items.get(name) ?? { name, count: 0, where: [] };
    this.items.set(name, item);
    item.count++;
    if (item.where.length < this.keep && !item.where.includes(where)) item.where.push(where);
  }
  list(): ConversionItem[] {
    return [...this.items.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
}

/** The data source a hosted file name answers to: "file:Invoices" or "file:Invoices.fmp12" is Invoices. */
export function hostedAs(paths: string[], hosted: string[]): string | undefined {
  for (const p of paths) {
    const m = /^(?:file|fmnet):(?:\/[^/]*\/)?(.+?)(?:\.fmp12)?$/i.exec(p.trim());
    const name = m?.[1].split('/').pop();
    const found = name && hosted.find((h) => lower(h) === lower(name));
    if (found) return found;
  }
  return undefined;
}

/** Calculation text without its comments (nested block comments, and // to the end of the line), strings kept. */
export function withoutComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '*') {
      let depth = 1;
      for (i += 2; i < text.length && depth; i++) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i++; } else if (text[i] === '*' && text[i + 1] === '/') { depth--; i++; }
      }
      i--;
      out += ' ';
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
      i--;
    } else out += c;
  }
  return out;
}

/**
 * `focus` limits the report to the places it accepts (a "where" such as `Script "Invoice", line 4`), and keeps every
 * place instead of the first few: what won't work in one script, field or layout.
 */
export function conversionReport(store: Store, hosted: string[] = [], focus?: (where: string) => boolean, opts: { designOnly?: boolean } = {}): ConversionReport {
  const s = store.schema;
  const index = solutionIndex(store);
  const custom = index.catalog.customFunctions;
  const fileMaker = new Set(FILEMAKER_FUNCTIONS.map(lower));
  const keep = focus ? 1000 : WHERE;
  const notYet = new Tally(keep);
  const undecoded = new Tally(keep);
  const plugIns = new Tally(keep);
  const unparsed: ConversionReport['unparsed'] = [];
  const broken: ConversionReport['broken'] = [];
  const unknown = new Map<string, UnknownTokenItem>();
  const addUnknown = (kind: UnknownTokenItem['kind'], id: string, name: string, shape: string) => {
    const key = `${kind}:${id}`;
    let item = unknown.get(key);
    if (!item) unknown.set(key, item = { kind, id, name, count: 0, files: 1, shapes: [] });
    item.count++;
    if (item.shapes.length < 5 && !item.shapes.includes(shape)) item.shapes.push(shape);
  };

  for (const site of index.sites) {
    if (focus && !focus(site.where)) continue;
    // Disabled script steps never run.
    if (site.kind === 'script' && site.text.startsWith('// ')) continue;
    for (const token of site.refs.unknownTokens ?? []) addUnknown(token.kind, token.id, token.name, token.shape);
    for (const fn of site.refs.functions) {
      if (FUNCTIONS.has(fn) || custom.has(fn) || fn === 'let' || fn === 'get') continue;
      const ownerOnly = /^<plugin:([\x21-\x7e]{4}):(\d+)>$/i.exec(fn);
      // FileMaker's public documentation doesn't define an error code for an unknown plug-in function.
      if (ownerOnly) { plugIns.add(`unknown plug-in (id only) ${ownerOnly[1]}`, site.where); continue; }
      if (fn.startsWith('<')) continue; // <Function Missing>: reported as broken
      if (fn.startsWith('⟨')) undecoded.add(fn, site.where);
      else if (fileMaker.has(fn)) notYet.add(FILEMAKER_FUNCTIONS.find((f) => lower(f) === fn)!, site.where);
      else plugIns.add(fn, site.where);
    }
    // A missing reference inside a calculation comment never runs, as in FileMaker.
    if (BROKEN.test(withoutComments(site.text))) broken.push({ where: site.where, text: site.text });
    // Fields of files that aren't hosted show as ⟨field:...⟩; those are reported with the data sources.
    else if (site.refs.unparsed && !site.text.includes('⟨field:')) unparsed.push({ where: site.where, text: site.text, error: site.refs.unparsed });
  }
  // Plug-in function names keep the case they were written in.
  const named = (t: Tally) => t.list().map((i) => ({ ...i, name: properName(index.sites, i.name) }));

  const stepsNotYet = new Tally(keep);
  const blocked = new Tally(keep);
  const network = new Tally(keep);
  const screenOnly = new Tally(keep);
  const clientOnly = new Tally(keep);
  // Scripts that open another file or perform its scripts need it hosted too, even with no table occurrence on it.
  const fileSteps = new Map<number, number>();
  const commentedOut: ConversionReport['commentedOut'] = [];
  for (const script of s.scripts) {
    script.steps.forEach((step, i) => {
      if (!step.enabled) return;
      const p = step.params as { dataSource?: { id: number }; script?: { file?: { id: number } } } | undefined;
      const file = p?.dataSource?.id ?? p?.script?.file?.id;
      if (file !== undefined) fileSteps.set(file, (fileSteps.get(file) ?? 0) + 1);
      const where = `Script "${script.name}", line ${i + 1}`;
      if (focus && !focus(where)) return;
      if (step.stepId === COMMENT) return;
      const canonical = scriptStepName(step.stepId);
      if (canonical.startsWith('Unknown step ')) addUnknown('step', String(step.stepId), canonical, `step(${step.calculations?.length ?? 0} calculations)`);
      for (const c of step.calculations ?? []) {
        if (c.trim() && !withoutComments(c).trim()) commentedOut.push({ where, text: c.length > 300 ? `${c.slice(0, 300)}…` : c });
      }
      if (step.stepId === SEND_MAIL) blocked.add(step.name, where);
      else if (step.stepId === INSERT_FROM_URL || step.stepId === EXECUTE_SQL || step.stepId === PERFORM_RAG_ACTION) network.add(step.name, where);
      else if (SCREEN_STEPS.has(step.stepId)) screenOnly.add(step.name, where);
      else if (CLIENT_ONLY_STEPS.has(step.stepId)) clientOnly.add(step.name, where);
      else if (!SERVER_STEPS.has(step.stepId)) stepsNotYet.add(canonical.startsWith('Unknown step ') ? canonical : step.name, where);
    });
  }

  const dataSources = s.dataSources.map((d) => {
    const at = hostedAs(d.paths, hosted.filter((h) => lower(h) !== lower(store.name)));
    // What stops working without it: scripts and layouts that use its tables (in fields, steps and ExecuteSQL).
    const tos = new Set(s.tableOccurrences.filter((t) => t.dataSourceId === d.id).map((t) => lower(t.name)));
    const users = new Set<string>();
    if (!at && tos.size) {
      for (const site of index.sites) {
        if (![...site.refs.occurrences].some((o) => tos.has(o))) continue;
        const m = /^(Script|Layout) ("[^"]*")/.exec(site.where);
        if (m) users.add(`${m[1].toLowerCase()} ${m[2]}`);
      }
      for (const l of s.layouts) if (l.tableOccurrenceId !== undefined && tos.has(lower(index.catalog.toName.get(l.tableOccurrenceId) ?? ''))) users.add(`layout "${l.name}"`);
    }
    return {
      name: d.name, paths: d.paths,
      occurrences: tos.size,
      ...(fileSteps.get(d.id) ? { scriptSteps: fileSteps.get(d.id) } : {}),
      ...(at ? { hosted: at } : {}),
      ...(users.size ? { usedBy: [...users].sort().slice(0, LIST) } : {}),
    };
  });
  // The guest account signs in without a password. Accounts with the file's
  // empty password sign in, but only from this computer unless the server allows it.
  // Everything else still on the file's own password (store.accounts()[].hasPassword
  // is true for these too — a passwordVerifier came across either way — so it can't
  // tell blank apart from a real, unverifiable one) has no working password at all.
  const blankPassword = store.blankPasswordAccounts();
  const withoutPassword = store.unmigratedAccounts();

  // How accounts and privilege sets came across. Per-table and per-field record
  // access are decoded (customRecords below); per-layout/value-list/script
  // "Custom privileges" aren't yet, so those are imported at the set's overall level.
  const privSets = store.privilegeSets();
  // FileMaker's built-in accounts ([Guest]) are listed too, marked builtIn: whether FileMaker had [Guest]
  // switched on isn't imported, so this says which set it has, not that guest access is on. Accounts
  // switched off here say so. Built-in and switched-off accounts don't count as missing a set.
  const builtIn = (name: string) => /^\[.*\]$/.test(name);
  const assignments = store.accounts()
    .map((a) => ({ account: a.name, privilegeSet: a.privilegeSet ?? null, ...(a.external ? { external: true } : {}), ...(builtIn(a.name) ? { builtIn: true } : {}), ...(a.inactive ? { inactive: true } : {}) }));
  const withoutSet = assignments.filter((a) => a.privilegeSet === null && !a.external && !a.builtIn && !a.inactive).map((a) => a.account);

  const report: ConversionReport = {
    database: store.name,
    unknownTokens: [...unknown.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    summary: '',
    functions: { notYet: notYet.list(), undecoded: undecoded.list(), plugIns: named(plugIns).map((item) => item.name.startsWith('unknown plug-in (id only)') ? { ...item, where: [] } : item) },
    steps: { notYet: stepsNotYet.list(), blocked: blocked.list(), network: network.list(), screenOnly: screenOnly.list(), clientOnly: clientOnly.list() },
    unparsed: unparsed.slice(0, LIST),
    broken: broken.slice(0, LIST),
    commentedOut: commentedOut.slice(0, LIST),
    dataSources,
    accounts: { withoutPassword, blankPassword },
    // Container file names come from records: left out when only the design is wanted (the handover memo).
    externalContainers: opts.designOnly ? { files: 0, missing: 0, examples: [] } : store.externalContainerCheck(),
    privileges: {
      assignments,
      withoutSet,
      sets: privSets.map((p) => ({ name: p.name, records: recordsSummary(p), extended: p.extendedPrivileges })),
      // Only the file's own (non-built-in) sets can carry per-table/layout/script
      // custom privileges; the three built-in sets are uniform and lose nothing.
      // So flag coarsening only when such a set exists — not for every file that
      // has any privilege set at all. Built-ins are id 1-3, or the English names
      // for files converted before ids were kept.
      coarsened: privSets.some((p) => !((p.id !== undefined && p.id >= 1 && p.id <= 3)
        || ['[full access]', '[data entry only]', '[read-only access]'].includes(p.name.toLowerCase()))),
      notUnderstood: [
        ...s.privilegeSets.filter((p) => p.undecoded?.length).map((p) => ({ set: p.name, what: p.undecoded! })),
        ...s.accounts.filter((a) => a.undecoded?.length).map((a) => ({ set: `account ${a.name}`, what: a.undecoded! })),
      ],
      customRecords: s.privilegeSets.filter((p) => p.customRecordAccess).map((p) => {
        const m = customAccess(p, s);
        const named = (by: Record<string, string[]>) => Object.entries(by).flatMap(([t, fs]) => fs.map((f) => `${t}::${f}`));
        return { set: p.name, tables: Object.keys(m.tables).length, hiddenFields: named(m.hiddenFields), unverifiedFields: named(m.unverifiedReadOnly), unresolvedTables: m.unresolvedTables.length };
      }),
    },
  };
  report.summary = summarize(report, unparsed.length, broken.length);
  return report;
}

/** A one-line account-access summary for a privilege set: "full access", "custom per-table", "view, edit", "no access". */
function recordsSummary(set: PrivilegeDefinition): string {
  if (isFullAccess(set)) return 'full access';
  if (set.tables && Object.keys(set.tables).length) return 'custom per-table';
  const r = set.records;
  const parts: string[] = [];
  for (const [name, rule] of [['view', r.view], ['create', r.create], ['edit', r.edit], ['delete', r.delete]] as const) {
    if (rule === true) parts.push(name);
    else if (typeof rule === 'string') parts.push(`${name} (limited)`);
  }
  return parts.length ? parts.join(', ') : 'no access';
}

/** How a function was written somewhere in the file (index keys are lower case). */
function properName(sites: { text: string }[], fn: string): string {
  const re = new RegExp(`(?<![\\w.])(${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*\\(`, 'i');
  for (const site of sites) {
    const m = re.exec(site.text);
    if (m) return m[1];
  }
  return PLUGIN_FUNCTIONS.find((f) => f.toLowerCase() === fn) ?? fn;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function summarize(r: ConversionReport, unparsed: number, broken: number): string {
  const uses = (items: ConversionItem[]) => items.reduce((n, i) => n + i.count, 0);
  const names = (items: ConversionItem[], max = 8) =>
    items.slice(0, max).map((i) => `${i.name} (${i.count})`).join(', ') + (items.length > max ? `, and ${items.length - max} more` : '');
  const out: string[] = [`# Conversion report: ${r.database}`, ''];
  const missing = r.dataSources.filter((d) => !d.hosted && (d.occurrences || d.scriptSteps));
  const problems: string[] = [];
  if (r.steps.notYet.length) problems.push(`- **Script steps not available yet**: ${names(r.steps.notYet)}. Each one fails with error 3 and the script carries on, as in FileMaker.`);
  if (r.functions.notYet.length) problems.push(`- **FileMaker functions not available yet**: ${names(r.functions.notYet)}.`);
  if (r.functions.plugIns.length) problems.push(`- **Plug-in functions** (no plug-ins run here, so formulas using them give an error): ${names(r.functions.plugIns)}.`);
  if (r.functions.undecoded.length) problems.push(`- **Functions the reader can't name yet**: ${plural(uses(r.functions.undecoded), 'use')} of ${plural(r.functions.undecoded.length, 'function')}.`);
  for (const u of r.unknownTokens) problems.push(`- **Unknown ${u.kind} ${u.id}** (${u.name}): ${plural(u.count, 'use')}, ${plural(u.files, 'file')}; shape: ${u.shapes.join(' | ')}. ${u.kind === 'step' ? 'Skipped with a notice and error 3.' : 'Returns ? without dispatching the unknown operation.'}`);
  if (unparsed) problems.push(`- **Formulas that don't parse**: ${unparsed} (some may be parts of the file the reader doesn't decode fully yet).`);
  if (missing.length) problems.push(`- **Other files not hosted here**: ${missing.map((d) => `${d.name} (${[d.occurrences ? plural(d.occurrences, 'table occurrence') : '', d.scriptSteps ? `${plural(d.scriptSteps, 'script step')} opening it or performing its scripts` : ''].filter(Boolean).join(', ')})`).join(', ')}. Host them alongside this file.` +
    missing.filter((d) => d.usedBy?.length).map((d) => ` Without ${d.name}: ${d.usedBy!.slice(0, 12).join(', ')}${d.usedBy!.length > 12 ? `, and ${d.usedBy!.length - 12} more` : ''}.`).join(''));
  if (r.commentedOut.length) problems.push(`- **Script formulas that are all comment** (FileMaker kept them that way, often a pasted formula that didn't compile, so they give nothing): ${r.commentedOut.slice(0, 5).map((c) => c.where).join('; ')}${r.commentedOut.length > 5 ? `, and ${r.commentedOut.length - 5} more` : ''}.`);
  const blank = new Set(r.accounts.blankPassword.map(lower));
  const none = r.accounts.withoutPassword.filter((a) => !blank.has(lower(a)));
  if (none.length) problems.push(`- **Accounts without a password**: ${none.join(', ')} (set one with \`tabularius passwd\` before they can sign in).`);
  if (blank.size) problems.push(`- **Accounts with an empty password**: ${r.accounts.blankPassword.join(', ')}. They sign in from the server's own computer only; set a password with \`tabularius passwd\`, or start the server with \`--allow-blank-passwords\`.`);
  const ext = r.externalContainers;
  if (ext.missing) problems.push(`- **Container files stored outside the file, not found here**: ${ext.missing} of ${ext.files} (e.g. ${ext.examples.join(', ')}). Copy the file's RC_Data_FMS/${r.database} folder from FileMaker Server (or its Files/${r.database} folder from FileMaker Pro) next to the hosted file; \`tabularius migrate-fms\` does it.`);
  if (r.privileges.withoutSet.length) problems.push(`- **Accounts with no privilege set**: ${r.privileges.withoutSet.join(', ')}. They have no access until one is assigned (\`tabularius privileges <file> account <name> <set>\`).`);
  out.push(problems.length ? '## Won\'t work yet' : 'Nothing found that won\'t work.', ...problems);

  const notes: string[] = [];
  if (r.steps.blocked.length) notes.push(`- **Send mail only when switched on**: ${names(r.steps.blocked)}. Tabularius sends no email unless the server's administrator switches sending on.`);
  if (r.steps.network.length) notes.push(`- **Reach the network** (off unless the server allows it): ${names(r.steps.network)}.`);
  if (broken) notes.push(`- **Already broken in FileMaker** (missing fields, tables or scripts): ${plural(broken, 'place')}.`);
  if (r.steps.screenOnly.length) notes.push(`- **Screen-only steps**, skipped on the server as FileMaker Server does: ${plural(uses(r.steps.screenOnly), 'step')}.`);
  if (r.steps.clientOnly.length) notes.push(`- **Only FileMaker Pro can do these** (a person choosing, a device, AppleScript); they give error 3 here, as on FileMaker Server: ${names(r.steps.clientOnly)}.`);
  if (r.privileges.sets.length) {
    const sets = r.privileges.sets.map((p) => `${p.name} (${p.records}${p.extended.length ? `; ${p.extended.join(', ')}` : ''})`).join('; ');
    notes.push(`- **Privilege sets imported**: ${sets}.`);
    // Only warn about whole-file-level approximation when a non-built-in set is
    // present: the three built-in sets are uniform and carry no custom detail.
    if (r.privileges.coarsened) notes.push(`- **Layout, value-list and script access is imported at the whole-file level.** FileMaker's per-layout, per-value-list and per-script "Custom privileges" aren't decoded yet, so a set that used them comes across at its overall access or, where the file stores the choice in a form no sample shows, with no access, and record access limited by a calculation isn't told apart yet (a record-access byte no sample shows imports as view only) — review those sets in Manage Security.`);
    for (const u of r.privileges.notUnderstood) {
      notes.push(`- **${u.set}: part of it was not imported as the file has it** (${u.what.join('; ')}). Anything the reader did not understand came across as no access, or as the more careful choice; check it in Manage Security before anyone relies on it.`);
    }
    for (const c of r.privileges.customRecords) {
      const fieldList = (f: string[]) => f.slice(0, 8).join(', ') + (f.length > 8 ? `, and ${f.length - 8} more` : '');
      notes.push(`- **${c.set}: per-table record access imported** for ${plural(c.tables, 'table')}; a table it doesn't list has no access.` +
        (c.hiddenFields.length ? ` ${plural(c.hiddenFields.length, 'field')} imported with no access (kept only when the file marks them read/write): ${fieldList(c.hiddenFields)}.` : '') +
        (c.unverifiedFields.length ? ` ${plural(c.unverifiedFields.length, 'of those')} carry a value we only infer means view-only (${fieldList(c.unverifiedFields)}); an admin can choose "Treat as read-only (unverified mapping)" for this set in Security.` : '') +
        (c.unresolvedTables ? ` ${plural(c.unresolvedTables, 'listed table')} couldn't be matched to a table in this file and got no access.` : ''));
    }
  }
  if (notes.length) out.push('', '## Good to know', ...notes);
  return out.join('\n');
}

const WHY: [keyof ConversionReport['steps'] | 'notYetFns' | 'plugIns' | 'undecoded', string][] = [
  ['notYet', 'Script steps not available yet: each fails with error 3 and the script carries on, as in FileMaker'],
  ['blocked', 'Sends only when switched on: Tabularius sends no email by default'],
  ['network', 'Needs the network, which is off unless the server allows it (AI-run scripts stay offline)'],
  ['screenOnly', 'Only affect a window, so they are skipped when the script runs on the server (as FileMaker Server does)'],
  ['clientOnly', 'Only FileMaker Pro can do them (a person choosing a folder, a camera or scanner, AppleScript): error 3 here, as on FileMaker Server'],
  ['notYetFns', 'FileMaker functions not available yet: formulas using them give an error'],
  ['plugIns', 'Plug-in functions: no plug-ins run here, so formulas using them give an error'],
  ['undecoded', 'Functions the file reader can\'t name yet'],
];

/**
 * Why one script, field, layout, custom function or value list doesn't work (or convert) as it did in FileMaker:
 * every place in it the conversion report counts, the scripts it performs that have problems of their own, and
 * the files it needs that aren't hosted. For "why didn't X convert?".
 */
export function conversionFor(store: Store, hosted: string[], name: string): string {
  const targets = resolveTargets(store, name).filter((t) => t.kind !== 'tableOccurrence' || !resolveTargets(store, name, 'table').length);
  if (!targets.length) throw new Error(`Nothing named "${name}" in ${store.name}. Try search_solution.`);
  const s = store.schema;
  const index = solutionIndex(store);
  const out: string[] = [];
  const prefix = (t: Target): string[] => t.kind === 'script' ? [`Script "${t.name}", line `]
    : t.kind === 'field' ? [`Field ${t.name} `]
      : t.kind === 'layout' ? [`Layout "${t.name}"`]
        : t.kind === 'customFunction' ? [`Custom function ${t.name} (`]
          : t.kind === 'valueList' ? [`Value list "${t.name}"`] : [];
  const lines = (r: ConversionReport) => {
    const found: string[] = [];
    const cats = { ...r.steps, notYetFns: r.functions.notYet, plugIns: r.functions.plugIns, undecoded: r.functions.undecoded };
    for (const [key, why] of WHY) {
      for (const item of cats[key]) found.push(`- ${item.name} (${why}): ${item.where.map((w) => w.replace(/^Script "[^"]*", /, '')).join('; ')}`);
    }
    for (const u of r.unparsed) found.push(`- A formula that doesn't parse (${u.error}): ${u.where}`);
    for (const b of r.broken) found.push(`- Already broken in FileMaker (a missing field, table or script): ${b.where}`);
    for (const c of r.commentedOut) found.push(`- A formula that is all comment, so it gives nothing (as in FileMaker): ${c.where.replace(/^Script "[^"]*", /, '')}`);
    return found;
  };
  for (const t of targets) {
    out.push(`# ${t.kind} ${t.name}`);
    const starts = prefix(t);
    const report = conversionReport(store, hosted, (w) => starts.some((p) => w.startsWith(p)));
    const own = lines(report);
    // Tables in files that aren't hosted: the item's layout, occurrence or the fields it reads.
    const missingFiles = new Set<string>();
    const fileOf = (toName: string) => {
      const o = s.tableOccurrences.find((x) => lower(x.name) === lower(toName));
      return o?.dataSourceId && !dataSourceHosted(store, o.dataSourceId) ? s.dataSources.find((d) => d.id === o.dataSourceId)?.name : undefined;
    };
    if (t.kind === 'layout') {
      const l = s.layouts.find((x) => x.name === t.name);
      const to = l?.tableOccurrenceId !== undefined ? s.tableOccurrences.find((o) => o.id === l.tableOccurrenceId) : undefined;
      const f = to && fileOf(to.name);
      if (f) missingFiles.add(f);
    }
    if (t.kind === 'table' || t.kind === 'tableOccurrence') {
      const f = fileOf(t.name);
      if (f) missingFiles.add(f);
    }
    for (const site of index.sites) {
      if (!starts.some((p) => site.where.startsWith(p))) continue;
      for (const o of site.refs.occurrences) {
        const f = fileOf(o);
        if (f) missingFiles.add(f);
      }
    }
    if (t.kind === 'script') {
      for (const step of s.scripts.find((x) => x.name === t.name)?.steps ?? []) {
        const p = step.params as { dataSource?: { id: number }; script?: { file?: { id: number } } } | undefined;
        const id = p?.dataSource?.id ?? p?.script?.file?.id;
        if (step.enabled && id !== undefined && !dataSourceHosted(store, id)) missingFiles.add(s.dataSources.find((d) => d.id === id)?.name ?? `data source ${id}`);
      }
    }
    if (missingFiles.size) own.push(`- Uses ${[...missingFiles].join(', ')}, not hosted here: its tables, fields and scripts can't be reached until it is hosted alongside.`);
    out.push(...(own.length ? ['What won\'t work as it did in FileMaker:', ...own] : ['Nothing in it is known not to work here.']));
    if (t.kind === 'script') {
      // One level down: scripts it performs that have problems of their own.
      const called = [...(index.calls.get(lower(t.name)) ?? [])].map((c) => s.scripts.find((x) => lower(x.name) === c)?.name).filter((x): x is string => !!x);
      const troubled = called.filter((c) => lines(conversionReport(store, hosted, (w) => w.startsWith(`Script "${c}", line `))).length);
      if (troubled.length) out.push(`It performs scripts with problems of their own: ${troubled.join(', ')} (ask about each).`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}
