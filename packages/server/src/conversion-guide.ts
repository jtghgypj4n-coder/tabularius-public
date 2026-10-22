// The conversion guide: when a .fmp12 is converted (or converted again), a plain-English account of what won't
// work here, what works differently, and what to use instead, written for the developer who knows the file. It is
// made from the conversion report (conversion.ts) and the plug-in migration plan (migration.ts), plus the parts of a
// file that behave differently on a server that stays offline: web viewers that load pages from the internet,
// tables in SQL databases (ESS) and other FileMaker files that aren't hosted. With the assistant on, a short
// overview is written on top. Kept in the file, so it travels with it; shown in the admin console and to MCP
// clients (conversion_guide). Secrets in script text never get into it: everything is passed through
// redactSecrets, and the overview is written from the redacted guide alone.

import { solutionIndex } from './insight.ts';
import type { LayoutObject } from '../../fmp12/src/index.ts';
import type { Store } from '../../store/src/index.ts';
import { redactSecrets } from './ai-output.ts';
import { conversionReport, type ConversionItem, type ConversionReport } from './conversion.ts';
import { migrationPlan } from './migration.ts';
import { optimizationReport } from './optimization.ts';

/** How much it matters for moving off FileMaker: blocker (people can't work), high, medium, low. */
export type Severity = 'blocker' | 'high' | 'medium' | 'low';

export interface GuideItem {
  /** What it is, in a few words ("360Works Email plug-in", "Send Mail"). */
  title: string;
  severity: Severity;
  /** Worked out from the records (container files), not the design: left out where only the design may go. */
  fromRecords?: true;
  /** What happens here, in a sentence. */
  what: string;
  /** The built-in replacement or what to do, when there is one. */
  instead?: string;
  count: number;
  /** The first few places (scripts and lines, fields, layouts). */
  where: string[];
}

export interface ConversionGuide {
  database: string;
  /** When the .fmp12 was converted (the store's import), which the guide was made for. */
  convertedAt?: string;
  made: string;
  /** Won't work until something is done about it. */
  breaks: GuideItem[];
  /** Works, but not as it did in FileMaker Pro or Server. */
  differs: GuideItem[];
  /** Things to do before people use it (passwords, files to host alongside). */
  todo: string[];
  /** The assistant's overview, when the server has one. */
  overview?: string;
  /** The guide as one Markdown text, secrets hidden. */
  text: string;
}

const WHERE = 5;
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const uses = (items: ConversionItem[]) => items.reduce((n, i) => n + i.count, 0);
/** Where each formula is, why it doesn't parse and how it starts: the same formula in two places is named once. */
const unparsedPlaces = (items: ConversionReport['unparsed']) => [...new Set(items.map((u) => {
  const formula = u.text.replace(/\s+/g, ' ').trim();
  return `${u.where}: ${u.error} (${formula.length > 120 ? formula.slice(0, 120) + '…' : formula})`;
}))].slice(0, WHERE);
const places = (items: ConversionItem[]) => [...new Set(items.flatMap((i) => i.where))].slice(0, WHERE);
const FILEMAKER_PATH = /^(?:file|fmnet|filemac|filewin|filelinux):/i;

/** Every web viewer on the file's layouts, with whether its page comes from the internet. */
function webViewers(store: Store): { layout: string; online: boolean }[] {
  const out: { layout: string; online: boolean }[] = [];
  const walk = (layout: string, objects: LayoutObject[]) => {
    for (const o of objects) {
      if (o.kind === 'web-viewer') out.push({ layout, online: !/^\s*"data:/i.test(o.webUrl ?? '') });
      if (o.children?.length) walk(layout, o.children);
    }
  };
  for (const l of store.designs().layouts) walk(l.name, l.objects);
  return out;
}

const CONTAINERS = 'Container files stored outside the file';
export const SEVERITIES: Severity[] = ['blocker', 'high', 'medium', 'low'];

/** The host of a URL's rest (after the scheme): after the last @ of a user name and password, which may hold / or spaces. */
function hostOf(rest: string): string | undefined {
  const HOST = /^([A-Za-z0-9.-]+)(?::\d+)?(?:[/?#\s]|$)/;
  for (let at = rest.lastIndexOf('@'); at >= 0; at = at === 0 ? -1 : rest.lastIndexOf('@', at - 1)) {
    const host = /[?#]/.test(rest.slice(0, at)) ? undefined : HOST.exec(rest.slice(at + 1))?.[1];
    // A path can hold an @ too (/users/@me): a host after it has a dot in it.
    if (host && (host.includes('.') || host === 'localhost')) return host;
  }
  return HOST.exec(rest)?.[1];
}

/**
 * The hosts Insert from URL steps call, where the address is written in the script (the first URL in each step, so a
 * proxy or header in its cURL options isn't taken for one; anything before an @ is never kept), and whether some
 * steps work their address out when they run. Disabled steps are left out.
 */
export function urlTargets(store: Store): { hosts: string[]; computed: boolean } {
  const hosts = new Set<string>();
  let computed = false;
  for (const site of solutionIndex(store).sites) {
    if (site.kind !== 'script' || !/^Insert from URL\b/.test(site.text)) continue;
    const m = /\b(https?|ftps?):\/\/([^"]*)/i.exec(site.text);
    const host = m ? hostOf(m[2]) : undefined;
    if (host) hosts.add(`${m![1].toLowerCase()}://${host.toLowerCase()}`);
    else computed = true;
  }
  return { hosts: [...hosts].sort(), computed };
}

/** Perform Script on Server steps: how many, and the first few. */
function performOnServer(store: Store): { count: number; where: string[] } {
  const hits = solutionIndex(store).sites.filter((x) => x.kind === 'script' && /^Perform Script on Server\b/.test(x.text));
  return { count: hits.length, where: hits.slice(0, WHERE).map((x) => x.where) };
}

/** The store's conversion: when its .fmp12 was imported, and which file. */
export function convertedAt(store: Store): string | undefined {
  try {
    const row = store.sql.prepare("SELECT json FROM _fm_meta WHERE key = 'source'").get() as { json: string } | undefined;
    const source = row ? JSON.parse(row.json) as { file?: string | null; importedAt?: string } : undefined;
    return source?.file ? source.importedAt : undefined;
  } catch {
    return undefined;
  }
}

export function conversionGuide(store: Store, hosted: string[] = [], report: ConversionReport = conversionReport(store, hosted)): ConversionGuide {
  const breaks: GuideItem[] = [];
  const differs: GuideItem[] = [];
  const todo: string[] = [];

  // Plug-ins: each one with the built-in steps and functions that replace its calls.
  const plan = migrationPlan(store);
  for (const p of plan.plugIns) {
    const count = p.calls.reduce((n, c) => n + c.count, 0);
    const working = p.calls.filter((c) => c.worksHere).reduce((n, c) => n + c.count, 0);
    const scripts = plan.scripts.filter((s) => s.plugIns.includes(p.plugIn)).length;
    const instead = [...new Set(p.calls.filter((c) => !c.worksHere).sort((a, b) => b.count - a.count).map((c) => c.native))].slice(0, 3);
    const item: GuideItem = {
      title: `${p.plugIn} plug-in`, severity: working === count ? 'low' : 'high',
      what: `${plural(count, 'call')}${scripts ? ` in ${plural(scripts, 'script')}` : ''}. No plug-ins run here, so ` +
        (working === count ? 'Tabularius does these calls itself, offline.' : working ? `${plural(count - working, 'call')} give an error (the other ${working} Tabularius does itself, offline).` : 'each call gives an error.'),
      ...(instead.length ? { instead: instead.join(' ') } : {}),
      count,
      where: [...new Set(p.calls.flatMap((c) => c.where))].slice(0, WHERE),
    };
    (working === count ? differs : breaks).push(item);
  }
  if (plan.plugIns.length) todo.push(`Move off plug-ins one script at a time: ask the assistant ("replace the ${plan.plugIns[0].plugIn} plug-in") or an MCP client (migration_plan); each rewritten script is tried offline on a copy first.`);

  const r = report;
  // Plug-in functions the migration plan doesn't know are counted by the report; keep those not covered above.
  const known = new Set(plan.plugIns.flatMap((p) => p.calls.map((c) => c.call.toLowerCase())));
  const otherPlugIns = r.functions.plugIns.filter((f) => ![...known].some((k) => k.startsWith(f.name.toLowerCase())));
  if (otherPlugIns.length) {
    breaks.push({
      title: 'Other plug-in functions', severity: 'high', count: uses(otherPlugIns), where: places(otherPlugIns),
      what: `${otherPlugIns.slice(0, 8).map((f) => f.name).join(', ')}${otherPlugIns.length > 8 ? ', …' : ''}: formulas that use them give an error.`,
      instead: 'Look for the FileMaker function of the same purpose (JSON, text, date, Base64, crypto functions), or rewrite the formula without it.',
    });
  }
  if (r.steps.notYet.length) {
    breaks.push({
      title: 'Script steps not available yet', severity: 'high', count: uses(r.steps.notYet), where: places(r.steps.notYet),
      what: `${r.steps.notYet.slice(0, 8).map((s) => `${s.name} (${s.count})`).join(', ')}: each fails with error 3 and the script carries on, as FileMaker does with a step it can't run.`,
      instead: 'Check Get ( LastError ) after them, or ask the assistant why a script fails ("Why?" on the error) for a rewrite.',
    });
  }
  if (r.functions.notYet.length) {
    breaks.push({
      title: 'FileMaker functions not available yet', severity: 'high', count: uses(r.functions.notYet), where: places(r.functions.notYet),
      what: `${r.functions.notYet.slice(0, 8).map((f) => `${f.name} (${f.count})`).join(', ')}: formulas that use them give an error.`,
    });
  }
  const missing = r.dataSources.filter((d) => !d.hosted && (d.occurrences || d.scriptSteps));
  const sql = missing.filter((d) => d.paths.length && !d.paths.some((p) => FILEMAKER_PATH.test(p.trim())));
  const files = missing.filter((d) => !sql.includes(d));
  if (sql.length) {
    breaks.push({
      title: 'Tables in SQL databases (ESS/ODBC)', severity: 'blocker', count: sql.reduce((n, d) => n + d.occurrences, 0), where: sql.flatMap((d) => d.usedBy ?? []).slice(0, WHERE),
      what: `${sql.map((d) => d.name).join(', ')}: Tabularius doesn't connect to outside SQL databases, so layouts, portals and scripts on these tables find nothing.`,
      instead: 'Import the tables into this file (Import Records from a CSV export of the database), or keep the data in the SQL database and reach Tabularius from it through the Data API or OData.',
    });
  }
  if (files.length) {
    breaks.push({
      title: 'Other FileMaker files not hosted here', severity: 'blocker', count: files.reduce((n, d) => n + d.occurrences + (d.scriptSteps ?? 0), 0), where: files.flatMap((d) => d.usedBy ?? []).slice(0, WHERE),
      what: `${files.map((d) => d.name).join(', ')}: their tables and scripts can't be reached.`,
      instead: 'Host them alongside this file (drop their .fmp12 into the same folder): references between hosted files work as they did.',
    });
    todo.push(`Host ${files.map((d) => d.name).join(', ')} alongside this file.`);
  }
  if (r.unparsed.length) {
    breaks.push({
      title: 'Formulas that don\'t parse', severity: 'medium', count: r.unparsed.length, where: unparsedPlaces(r.unparsed),
      what: 'They give an error. Some may be parts of the file the reader doesn\'t decode fully yet.',
      instead: 'Open each in design mode: the formula box says what it can\'t read, and Fix with AI suggests a correction.',
    });
  }
  if (r.externalContainers.missing) {
    breaks.push({
      title: CONTAINERS, severity: 'high', fromRecords: true, count: r.externalContainers.missing, where: r.externalContainers.examples.slice(0, WHERE),
      what: `${plural(r.externalContainers.missing, 'file')} of ${r.externalContainers.files.toLocaleString('en-US')} aren't next to the hosted file, so those container fields show nothing.`,
      instead: `Copy the RC_Data_FMS/${r.database} folder from FileMaker Server (or Files/${r.database} from FileMaker Pro) next to it; tabularius migrate-fms does it.`,
    });
  }

  // What works, but differently.
  if (r.steps.blocked.length) {
    differs.push({
      title: 'Send Mail', severity: 'medium', count: uses(r.steps.blocked), where: places(r.steps.blocked),
      what: 'Via SMTP Server it sends only when the server\'s administrator switches sending on (serve --send-mail, with their own SMTP account); otherwise, and via E-mail Client with no one\'s browser to open (a schedule, the Data API), it sends nothing: the step ends with error 3 and the script carries on. Via E-mail Client in the web client, the person\'s own mail app opens with the message, without attachments. A server set up for test mode keeps each message in the admin console\'s outbox instead.',
      instead: 'Keep the step as it is (Send via SMTP Server); mail goes out once the server is set up to send it, from the address set up there.',
    });
  }
  if (r.steps.network.length) {
    const { hosts: targets, computed } = urlTargets(store);
    differs.push({
      title: 'Insert from URL', severity: 'medium', count: uses(r.steps.network), where: places(r.steps.network),
      what: 'Works once Script network is turned on for the file. It starts off, so a copy you are only testing cannot call outside services; scripts the assistant runs never reach the network.' +
        (targets.length ? ` It calls ${targets.slice(0, 8).join(', ')}${targets.length > 8 ? ', …' : ''}${computed ? ', and addresses worked out when the script runs' : ''}.` : ' The addresses are worked out when the script runs.'),
      instead: 'Turn on Script network for this file in the admin console when this copy is the live one (or start the server with --allow-script-network to allow every file). The Data API and webhooks let other systems reach Tabularius instead.',
    });
  }
  const viewers = webViewers(store);
  const online = viewers.filter((v) => v.online);
  if (viewers.length) {
    const layouts = [...new Set(online.map((v) => v.layout))];
    differs.push({
      title: 'Web viewers', severity: online.length ? 'medium' : 'low', count: viewers.length, where: layouts.slice(0, WHERE).map((l) => `Layout "${l}"`),
      what: online.length
        ? `${plural(online.length, 'web viewer')} load${online.length === 1 ? 's' : ''} a page from the internet, which loads only from a host an administrator lists for this file (Hosted files, Web viewers may load); until then the web client shows the address as text.` +
          (viewers.length > online.length ? ` ${plural(viewers.length - online.length, 'other')} show a page made in the file (a data: URL), which works.` : '')
        : 'They show pages made in the file (data: URLs), which work, in a sandbox that can\'t reach the app.',
      ...(online.length ? { instead: 'List the host in the admin console (Hosted files, "Web viewers may load"; https only), build the page in the file as a data: URL ("data:text/html," & a field or variable holding the HTML), or show the address as a link a button opens with Open URL.' } : {}),
    });
  }
  if (r.steps.dialogs.length) {
    differs.push({
      title: 'Dialogs in scripts that run without a person', severity: 'medium', count: uses(r.steps.dialogs), where: places(r.steps.dialogs),
      what: `${plural(uses(r.steps.dialogs), 'Show Custom Dialog step')}. If a script with one runs with no person to answer (a schedule, Perform Script on Server, the Data API, an AI tool run), the step stops with error 3 and presses no button, as FileMaker Server and the Data API do not support it; the script carries on with the next step. In the web client a person still sees the dialog.`,
      instead: 'Move the question to a script a person runs on the client, and pass the answer to the server script as its script parameter.',
    });
  }
  if (r.steps.screenOnly.length) {
    differs.push({
      title: 'Steps that only change a window', severity: 'low', count: uses(r.steps.screenOnly), where: places(r.steps.screenOnly),
      what: 'Skipped when a script runs on the server (a schedule, an automation, Perform Script on Server, the Data API), as FileMaker Server does; they work in the web client.',
    });
  }
  if (r.steps.clientOnly.length) {
    differs.push({
      title: 'Steps only FileMaker Pro can do', severity: 'medium', count: uses(r.steps.clientOnly), where: places(r.steps.clientOnly),
      what: `${r.steps.clientOnly.slice(0, 8).map((x) => `${x.name} (${x.count})`).join(', ')}: a person choosing a file or folder, a camera or scanner, AppleScript. They end with error 3, as on FileMaker Server.`,
      instead: 'Let people upload files in the web client (Insert File there), and move AppleScript or device work to a webhook or a script on the person\'s own computer.',
    });
  }
  const psos = performOnServer(store);
  if (psos.count) {
    differs.push({
      title: 'Perform Script on Server', severity: 'low', count: psos.count, where: psos.where,
      what: 'Runs on this server, queued as FileMaker Server queues it, with the same limits on parameters and results; steps that only change a window are skipped there.',
    });
  }
  // FileMaker's three built-in sets come across as they are; only the file's own sets can have custom privileges.
  const ownSets = r.privileges.sets.filter((s) => !['[full access]', '[data entry only]', '[read-only access]'].includes(s.name.toLowerCase()));
  if (r.privileges.coarsened && ownSets.length) {
    differs.push({
      title: 'Privilege sets', severity: 'high', count: ownSets.length, where: ownSets.slice(0, WHERE).map((s) => `${s.name}: ${s.records}`),
      what: 'Per-table and per-field record access come across (failing closed: in a table whose fields the set customises, a field the file doesn\'t mark read/write is hidden until you grant it), and so do the printing and exporting options. Per-layout, per-value-list and per-script custom privileges aren\'t decoded yet, so those come across at the set\'s overall level, the menu command option comes across as All, and record access limited by a calculation isn\'t told apart from a plain grant yet.',
      instead: 'Review those sets in Manage Security (Ask AI there reviews them for risky setups).',
    });
  }
  if (r.commentedOut.length) {
    differs.push({
      title: 'Formulas that are all comment', severity: 'low', count: r.commentedOut.length, where: r.commentedOut.slice(0, WHERE).map((c) => c.where),
      what: 'They give nothing, as in FileMaker (often a pasted formula that didn\'t compile there).',
    });
  }
  if (r.broken.length) {
    differs.push({
      title: 'Already broken in FileMaker', severity: 'low', count: r.broken.length, where: r.broken.slice(0, WHERE).map((b) => b.where),
      what: 'References FileMaker itself shows as missing (fields, tables or scripts): they behave here as they did there.',
    });
  }

  const blank = new Set(r.accounts.blankPassword.map((a) => a.toLowerCase()));
  const none = r.accounts.withoutPassword.filter((a) => !blank.has(a.toLowerCase()));
  if (none.length) todo.push(`Give ${none.join(', ')} a password (tabularius passwd, or Manage Security): accounts without one can't sign in.`);
  if (blank.size) todo.push(`${r.accounts.blankPassword.join(', ')} ${blank.size === 1 ? 'has' : 'have'} the file's empty password, which works only from the server's own computer: set a password.`);
  if (r.privileges.withoutSet.length) todo.push(`Give ${r.privileges.withoutSet.join(', ')} a privilege set: without one they have no access.`);

  const rank = (x: GuideItem) => SEVERITIES.indexOf(x.severity);
  breaks.sort((a, b) => rank(a) - rank(b));
  differs.sort((a, b) => rank(a) - rank(b));
  const guide: ConversionGuide = { database: store.name, ...(convertedAt(store) ? { convertedAt: convertedAt(store) } : {}), made: new Date().toISOString(), breaks, differs, todo, text: '' };
  guide.text = guideText(guide);
  return guide;
}

/** The guide as Markdown, secrets hidden. */
export function guideText(g: ConversionGuide, opts: { designOnly?: boolean } = {}): string {
  // Guides saved before items were marked fromRecords name the container item by its title.
  const shown = (items: GuideItem[]) => (opts.designOnly ? items.filter((i) => !i.fromRecords && i.title !== CONTAINERS) : items);
  const item = (i: GuideItem) => [`- **${i.title}** (${[i.severity, i.count.toLocaleString('en-US')].filter(Boolean).join('; ')}): ${i.what}`, ...(i.instead ? [`  Instead: ${i.instead}`] : []),
    ...(i.where.length ? [`  Where: ${i.where.join('; ')}${i.count > i.where.length ? '; …' : ''}`] : [])];
  const out = [`# ${g.database}: what to know after converting`, ''];
  if (g.overview) out.push(g.overview, '');
  if (!g.breaks.length && !g.differs.length && !g.todo.length) out.push('Everything in this file works here as it did in FileMaker.');
  if (shown(g.breaks).length) out.push('## Won\'t work until changed', ...shown(g.breaks).flatMap(item), '');
  if (shown(g.differs).length) out.push('## Works differently', ...shown(g.differs).flatMap(item), '');
  if (g.todo.length) out.push('## Before people use it', ...g.todo.map((t) => `- ${t}`), '');
  return redactSecrets(out.join('\n').trimEnd());
}

// --- kept with the file -----------------------------------------------------------

export class ConversionGuides {
  /** Writes the overview from the guide's text; set when the server has the assistant. */
  overview?: (store: Store, text: string) => Promise<string | undefined>;
  private readonly hosted: () => string[];
  private readonly log: (m: string) => void;

  constructor(hosted: () => string[], log: (m: string) => void = () => {}) {
    this.hosted = hosted;
    this.log = log;
  }

  private table(store: Store): boolean {
    try {
      store.sql.exec('CREATE TABLE IF NOT EXISTS _fm_conversion_guide (id INTEGER PRIMARY KEY CHECK (id = 1), converted TEXT, spec TEXT NOT NULL)');
      return true;
    } catch {
      return false;
    }
  }

  /** The saved guide, if one was made for this conversion. */
  saved(store: Store): ConversionGuide | undefined {
    if (!this.table(store)) return undefined;
    const row = store.sql.prepare('SELECT spec FROM _fm_conversion_guide WHERE id = 1').get() as { spec: string } | undefined;
    return row ? JSON.parse(row.spec) as ConversionGuide : undefined;
  }

  private save(store: Store, g: ConversionGuide): void {
    if (!this.table(store)) return;
    store.sql.prepare('INSERT INTO _fm_conversion_guide (id, converted, spec) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET converted = excluded.converted, spec = excluded.spec')
      .run(g.convertedAt ?? null, JSON.stringify(g));
  }

  private readonly making = new Map<Store, Promise<ConversionGuide>>();

  /**
   * Makes the guide again (and its overview, with the assistant) and keeps it. While one is being made for a file,
   * asking again waits for it rather than asking the assistant a second time.
   */
  make(store: Store): Promise<ConversionGuide> {
    let p = this.making.get(store);
    if (!p) {
      p = this.build(store).finally(() => this.making.delete(store));
      this.making.set(store, p);
    }
    return p;
  }

  private async build(store: Store): Promise<ConversionGuide> {
    const g = conversionGuide(store, this.hosted());
    this.save(store, g);
    if (this.overview && (g.breaks.length || g.differs.length || g.todo.length)) {
      try {
        // The overview is written from the design: container file names come from the records.
        const text = await this.overview(store, guideText({ ...g, overview: undefined }, { designOnly: true }));
        if (text) {
          g.overview = redactSecrets(text.trim());
          g.text = guideText(g);
          this.save(store, g);
        }
      } catch (e) {
        this.log(`conversion guide for ${store.name}: no overview (${(e as Error).message})`);
      }
    }
    return g;
  }

  /** The guide for this conversion: the saved one, or made now. */
  async get(store: Store): Promise<ConversionGuide> {
    const making = this.making.get(store);
    if (making) return making;
    const saved = this.saved(store);
    return saved && saved.convertedAt === convertedAt(store) ? saved : this.make(store);
  }

  /**
   * Called as each file starts being hosted: a file converted (or converted again) since its guide was made gets a
   * new one, in the background and one file at a time, so hosting and requests don't wait on it.
   */
  hosting(store: Store): void {
    const at = convertedAt(store);
    if (!at || this.queue.includes(store) || this.saved(store)?.convertedAt === at) return;
    this.queue.push(store);
    if (!this.timer) this.next(this.delayMs);
  }

  /** Waits before the first guide is made (startup), and between files. */
  delayMs = 5_000;
  private readonly queue: Store[] = [];
  private timer?: NodeJS.Timeout;

  private next(ms: number): void {
    this.timer = setTimeout(() => {
      const store = this.queue.shift();
      if (!store) {
        this.timer = undefined;
        return;
      }
      this.make(store).then((g) => {
        // Ways to make the file smaller and faster come with it: shown in full in the admin console and by `tabularius optimize`.
        let optimization = '';
        try {
          const o = optimizationReport(store);
          if (o.findings.length) optimization = `; ${o.headline.slice(store.name.length + 2)} (tabularius optimize, or the admin console)`;
        } catch (e) {
          this.log(`optimization report for ${store.name} couldn't be made: ${(e as Error).message}`);
        }
        this.log(`conversion guide for ${store.name}: ${plural(g.breaks.length, 'thing')} won't work until changed, ${g.differs.length} work${g.differs.length === 1 ? 's' : ''} differently${optimization}`);
      },
        (e) => this.log(`conversion guide for ${store.name} couldn't be made: ${(e as Error).message}`))
        .finally(() => { if (!this.stopped) this.next(1_000); });
    }, ms);
    this.timer.unref();
  }

  private stopped = false;

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.queue.length = 0;
  }
}
