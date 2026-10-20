// What a converted file's plug-in calls will do here, in plain words, for the admin console: each function the file calls,
// how many scripts, calculations and layout objects use it, whether it runs, gives "?", gives an error text or goes to the
// Outbox, and what to use instead. The list is the migration plan's (migration.ts), which reads the same function tables the
// engine runs; this adds the words, the file's own plug-in settings, and a count and CSV that name functions, never data.

import type { Store } from '../../store/src/index.ts';
import { csvField } from '../../store/src/index.ts';
import type { PluginRegistry } from '../../plugins/src/index.ts';
import { migrationPlan, type CallBehaviour, type MigrationCall, type MigrationPlan } from './migration.ts';

/** What happens, or `off` where a built-in pack has been turned off for this file. */
export type Readiness = CallBehaviour | 'off';

export interface ReadinessFunction {
  plugIn: string;
  /** The function as the file writes it ("BE_Version", or MBS ( "SMTP.Send" )). */
  call: string;
  behaviour: Readiness;
  /** Whether a script that calls it gets its work done here. */
  runs: boolean;
  /** What happens, in a sentence. */
  what: string;
  /** What to use instead, from the migration plan. */
  instead: string;
  /** How many places of each kind call it. */
  scripts: number;
  calculations: number;
  layouts: number;
  other: number;
  /** The guide that explains this plug-in, as a path on this server. */
  guide: string;
}

export interface PluginReadiness {
  database: string;
  /** One line for the first-run checklist, or '' when every call runs. */
  line: string;
  /** Distinct functions that will not do their work here. */
  willNotRun: number;
  /** Distinct functions that run here. */
  running: number;
  /** MBS calls whose function is named while the script runs, which the file cannot tell. */
  cannotTell: number;
  functions: ReadinessFunction[];
  /** Said when there is nothing to list. */
  summary: string;
  guides: { title: string; href: string }[];
}

const GUIDES = [
  { title: 'Moving a solution off its plug-ins', href: '/docs/moving-a-solution#plug-ins-are-not-loaded' },
  { title: 'Which plug-in functions run', href: '/docs/plugin-compatibility' },
];

const WHAT: Record<Readiness, string> = {
  runs: 'Runs here: Tabularius has its own version, so it works without the plug-in. A function that reads or writes files works only inside a script.',
  outbox: 'Does nothing outside the server. Inside a script, with the server started in test mode (--test-outbound), a request or message is written to the Outbox (or the call just answers empty); in a calculation, or without test mode, it gives ? and error 3.',
  refused: 'Gives ? and error 3. It would use the clipboard, a file picker, a shell command, FTP, or open a file or web address on a desktop, which Tabularius never does on a server.',
  unavailable: 'Gives ?, as FileMaker does when the plug-in is not installed. A script that asks whether the plug-in is there still works.',
  unrecognised: 'No function has this name here, so a calculation that uses it fails with "The function … cannot be found" instead of giving ?. Check the spelling.',
  'mbs-error': 'Gives an MBS error text ("[MBS] ERROR: … is not available in Tabularius") instead of a result.',
  'cannot-tell': 'An MBS function is named while the calculation runs, so the file does not say which one it is. Check it.',
  off: 'The plug-in is turned off for this file, so the call gives ?, as FileMaker does when a plug-in is not installed.',
};

/** The words for each outcome; the console shows them and the CSV carries them. */
export const readinessWords = (b: Readiness): string => WHAT[b];

const plans = new WeakMap<Store, { schema: Store['schema']; plan: MigrationPlan }>();

/** The migration plan, kept until the file's design changes. */
function planOf(store: Store): MigrationPlan {
  const hit = plans.get(store);
  if (hit && hit.schema === store.schema) return hit.plan;
  const plan = migrationPlan(store);
  plans.set(store, { schema: store.schema, plan });
  return plan;
}

const keyOf = (call: string): string => (/^⟨[^⟩]+⟩/.exec(call)?.[0] ?? call).toLowerCase();

/** The plug-ins turned on for this file that supply a call (a plug-in written for Tabularius and switched on by an administrator). */
function suppliedBy(plugins: PluginRegistry | undefined, file: string, call: MigrationCall): string | undefined {
  if (!plugins) return undefined;
  const key = keyOf(call.call);
  for (const m of plugins.plugins(file)) {
    for (const f of m.functions) {
      if (f.name.toLowerCase() === key || (f.owner && `⟨${f.owner}:${f.index}⟩`.toLowerCase() === key)) return m.name;
    }
  }
  return undefined;
}

/**
 * What every plug-in call in a file will do, worst first. `plugins` is the server's registry, so a built-in pack turned off for
 * the file, or a plug-in written for Tabularius and turned on for it, is taken into account.
 */
export function pluginReadiness(store: Store, plugins?: PluginRegistry): PluginReadiness {
  const plan = planOf(store);
  const off = (call: string) => !!plugins && plugins.builtinOff(store.name, keyOf(call));
  const functions: ReadinessFunction[] = [];
  for (const { plugIn, calls } of plan.plugIns) {
    for (const c of calls) {
      const supplier = suppliedBy(plugins, store.name, c);
      const behaviour: Readiness = supplier ? 'runs' : off(c.call) ? 'off' : c.behaviour;
      functions.push({
        plugIn, call: c.call, behaviour, runs: behaviour === 'runs',
        what: supplier ? `Runs here through the ${supplier} plug-in, which is turned on for this file.` : WHAT[behaviour],
        instead: c.native, scripts: c.uses.scripts, calculations: c.uses.calculations, layouts: c.uses.layouts, other: c.uses.other,
        guide: GUIDES[0]!.href,
      });
    }
  }
  const order: Record<Readiness, number> = { refused: 0, unavailable: 1, unrecognised: 2, 'mbs-error': 3, off: 4, outbox: 5, 'cannot-tell': 6, runs: 7 };
  functions.sort((a, b) => order[a.behaviour] - order[b.behaviour] || b.scripts + b.calculations + b.layouts + b.other - (a.scripts + a.calculations + a.layouts + a.other) || a.call.localeCompare(b.call));
  const willNotRun = functions.filter((f) => !f.runs && f.behaviour !== 'cannot-tell').length;
  const cannotTell = functions.filter((f) => f.behaviour === 'cannot-tell').length;
  const running = functions.filter((f) => f.runs).length;
  const parts = [
    willNotRun ? `${willNotRun} plug-in function${willNotRun === 1 ? '' : 's'} will not run` : '',
    cannotTell ? `${cannotTell} plug-in call${cannotTell === 1 ? '' : 's'} could not be checked` : '',
  ].filter(Boolean);
  return {
    database: store.name,
    line: parts.join(', '),
    willNotRun, running, cannotTell, functions,
    summary: !functions.length
      ? 'This file calls no plug-in functions that Tabularius knows, so there is nothing to move.'
      : !willNotRun && !cannotTell ? `All ${running} plug-in function${running === 1 ? '' : 's'} this file calls run here.` : '',
    guides: GUIDES,
  };
}

/** The same list as CSV: function names, what happens and how many places use each. No record data and no place names. */
export function pluginReadinessCsv(r: PluginReadiness): string {
  const header = ['plugIn', 'function', 'whatHappens', 'whatItDoes', 'scripts', 'calculations', 'layoutObjects', 'otherPlaces', 'useInstead'];
  const rows = r.functions.map((f) => [f.plugIn, f.call, f.behaviour, f.what, f.scripts, f.calculations, f.layouts, f.other, f.instead].map((v) => csvField(String(v))).join(','));
  return [header.map((v) => csvField(v)).join(','), ...rows].join('\r\n') + '\r\n';
}
