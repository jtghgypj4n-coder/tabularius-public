// Moving a converted file off its plug-ins: every plug-in call in the file, grouped by plug-in, with what
// works here already and the native FileMaker replacement for each kind of call. The assistant walks this
// plan script by script and proposes the rewrites; each rewritten script is dry-run offline on a copy first
// (Send Mail reaches no one there).

import type { Store } from '../../store/src/index.ts';
import { FUNCTIONS, mbsSupports, pluginCallBehaviour, type PluginBehaviour } from '../../calc/src/functions.ts';
import { solutionIndex, type Site } from './insight.ts';

/** One kind of plug-in call and its native replacement. */
interface Rule {
  /** Matches the function name (lowercase), or for MBS the name of the MBS function ("smtp.send"). */
  match: RegExp;
  /** The native FileMaker replacement, as a FileMaker developer would write it. */
  native: string;
  /** No native step or function does this: say what to do instead. */
  none?: true;
}

interface Family {
  plugIn: string;
  /** The plug-in's 4-character id, which names calls the file reader can't name yet (⟨3MLR:123⟩). */
  id?: string;
  /** Whether a call (lowercase function name) belongs to this plug-in. */
  owns: (fn: string) => boolean;
  rules: Rule[];
  /** For calls no rule covers. */
  otherwise: string;
}

const FAMILIES: Family[] = [
  {
    plugIn: '360Works Email', id: '3MLR', owns: (fn) => /^email/.test(fn) || fn === 'isvalidemail',
    rules: [
      { match: /^email(create|setbody|setsubject|attach|addrecipient|addcc|addbcc|send|connectsmtp|setsmtp|setheader|setreplyto)/, native:
        'Send Mail [ Send via SMTP Server ; With dialog: Off ; To: … ; CC: … ; BCC: … ; Subject: … ; Message: … ; Attachment: … ] ' +
        '(one step replaces the create / set body / attach / send calls; the SMTP server and account go in the step\'s options). ' +
        'Tabularius sends no mail unless the server is set up to (in test mode it goes to the outbox), so here the step fails with error 3 and the script carries on.' },
      { match: /^email(register|version)$/, native: 'Nothing: native Send Mail needs no registration or version check. Delete the step or the If around it.' },
      { match: /^emaillasterror$/, native: 'Get ( LastError ) and Get ( LastErrorDetail ) right after Send Mail.' },
      { match: /^email(disconnect)$/, native: 'Nothing: Send Mail opens and closes its own connection. Delete the step.' },
      { match: /^email(connectimap|connectpop|readmessages|getnextmessage|readmessagevalue|listmailboxes|move|delete|mark)/, none: true, native:
        'No native step reads a mailbox. Keep the plug-in for this part, or have a mail service post incoming messages to the Data API.' },
      { match: /^isvalidemail$/, native: 'A native calculation (or a custom function made from it): Let ( [ e = Trim ( address ) ; at = Position ( e ; "@" ; 1 ; 1 ) ] ; ' +
        'PatternCount ( e ; "@" ) = 1 and at > 1 and Position ( e ; "." ; at ; 1 ) > at + 1 and Right ( e ; 1 ) ≠ "." and PatternCount ( e ; " " ) = 0 )' },
    ],
    otherwise: 'Send Mail [ Send via SMTP Server ] for sending; reading mail has no native step.',
  },
  {
    plugIn: 'MBS (MonkeyBread)', id: 'MBSP', owns: (fn) => fn === 'mbs',
    rules: [
      { match: /^(smtp|sendmail)\./, native: 'Send Mail [ Send via SMTP Server ; … ] (Tabularius sends no mail unless the server is set up to).' },
      { match: /^curl\./, native: 'Insert from URL [ … ; cURL options: … ] (--request, --header, --data, --user go in the options). Here it reaches only the hosts the server allows.' },
      { match: /^json\./, native: 'JSONGetElement, JSONSetElement, JSONListKeys, JSONListValues, JSONDeleteElement and JSONFormatElements.' },
      { match: /^(text\.(encodetobase64|decodefrombase64)|base64)/, native: 'Base64Encode / Base64Decode ( or Base64EncodeRFC ).' },
      { match: /^(hash\.|text\.(md5|sha))/, native: 'CryptDigest ( data ; "SHA256" ) (with HexEncode or Base64Encode for text), or CryptAuthCode for an HMAC.' },
      { match: /^(encryption|cipher)\./, native: 'CryptEncrypt / CryptDecrypt (AES-256), or CryptEncryptBase64 / CryptDecryptBase64.' },
      { match: /^clipboard\./, native: 'Copy / Paste steps with a global field, or Set Clipboard where the client allows it.' },
      { match: /^(files|binaryfile|text\.(readtextfile|writetextfile))\./, native: 'Create Data File, Open Data File, Read from Data File, Write to Data File, Close Data File; Get File Exists and Get File Size.' },
      { match: /^container\./, native: 'GetContainerAttribute, GetThumbnail, Base64Encode on the container, Insert File / Export Field Contents.' },
      { match: /^progressdialog\./, native: 'Nothing on the server; on a client, Show Custom Dialog or a status field. Delete the steps.' },
      { match: /^dynapdf\./, native: 'Save Records as PDF (with Append for several layouts).' },
      { match: /^(regex|regularexpression)\./, none: true, native: 'No native regular expressions. Rewrite with Substitute, Filter, Position and PatternCount, or a custom function.' },
      { match: /^(fm\.executefilesql|fm\.sql)/, native: 'ExecuteSQL ( query ; fieldSeparator ; rowSeparator ; arguments ).' },
    ],
    otherwise: 'Check whether a native function covers it (many MBS text, JSON, date and container functions have one since FileMaker 16–19); otherwise rewrite it in FileMaker calculation or script steps.',
  },
  {
    plugIn: 'BaseElements', id: 'GyBE', owns: (fn) => fn.startsWith('be_'),
    rules: [
      { match: /^be_json/, native: 'JSONGetElement / JSONSetElement / JSONFormatElements; for an error check, Left ( JSONFormatElements ( json ) ; 1 ) = "?".' },
      { match: /^be_version$/, native: 'Nothing: drop the "is the plug-in installed" check.' },
      { match: /^be_evaluatejavascript$/, native: 'The native JSON functions for JSON work; otherwise Perform JavaScript in Web Viewer on a client.' },
      { match: /^be_clipboard/, native: 'Copy / Paste steps with a global field.' },
      { match: /^be_file(readtext|writetext|exists|size)|^be_(readtextfromfile|writetexttofile)/, native: 'Read from Data File / Write to Data File (with Open and Close Data File), Get File Exists, Get File Size.' },
      { match: /^be_select(file|folder)$/, native: 'Insert File (lets the person pick a file), or Get ( DocumentsPath ) / Get ( TemporaryPath ) for a folder.' },
      { match: /^be_filemakersql$/, native: 'ExecuteSQL ( query ; fieldSeparator ; rowSeparator ; arguments ).' },
      { match: /^be_smtp/, native: 'Send Mail [ Send via SMTP Server ; … ] (one step replaces the BE_SMTP calls; the server and account go in the step\'s options). Tabularius sends no mail unless the server is set up to.' },
      { match: /^be_(http|curl)/, native: 'Insert from URL [ … ; cURL options: … ]. Here it reaches only the hosts the server allows.' },
      { match: /^be_base64/, native: 'Base64Encode / Base64Decode.' },
      { match: /^be_(messagedigest|hmac)/, native: 'CryptDigest / CryptAuthCode.' },
      { match: /^be_executesystemcommand$/, none: true, native: 'No native step runs a shell command, and Tabularius never does. Move the work into a scheduled script or outside the solution.' },
      { match: /^be_(zip|unzip|gzip)/, none: true, native: 'No native zip. Keep files unzipped in container fields, or do this outside the solution.' },
    ],
    otherwise: 'Look for the native function of the same purpose (JSON, files, Base64, crypto, Insert from URL); otherwise rewrite it in FileMaker steps.',
  },
  {
    plugIn: 'DataGuard (WorldSync)', id: 'AUDI', owns: (fn) => fn.startsWith('dataguard_'),
    rules: [{ match: /./, native: 'Nothing to add: Tabularius keeps an audit log of every record change (who, when, old and new values) without a plug-in. Delete the calls.' }],
    otherwise: 'tabularius\'s audit log.',
  },
  {
    plugIn: 'Troi', owns: (fn) => /^(dlg_|trfile_|trurl_|trnum_|trtext_|trserial_)/.test(fn),
    rules: [
      { match: /^dlg_/, native: 'Show Custom Dialog (up to three input fields and three buttons) or a card window.' },
      { match: /^trfile_/, native: 'Create / Open / Read from / Write to Data File, Get File Exists, Insert File, Export Field Contents.' },
      { match: /^trurl_/, native: 'Insert from URL.' },
    ],
    otherwise: 'Look for the native step of the same purpose.',
  },
  {
    plugIn: 'SMTPit Pro', owns: (fn) => fn.startsWith('smtpit_'),
    rules: [{ match: /./, native: 'Send Mail [ Send via SMTP Server ; … ] (Tabularius sends no mail unless the server is set up to).' }],
    otherwise: 'Send Mail via SMTP.',
  },
  {
    plugIn: 'ScriptMaster (360Works)', owns: (fn) => /^(evaluategroovy|registergroovy|regularexpression|scriptmaster)/.test(fn),
    rules: [
      { match: /^regularexpression/, none: true, native: 'No native regular expressions. Rewrite with Substitute, Filter, Position and PatternCount, or a custom function.' },
      { match: /./, none: true, native: 'No native Groovy or Java. Rewrite the module as script steps or a custom function, or move it outside the solution.' },
    ],
    otherwise: 'Rewrite as script steps or a custom function.',
  },
];

/** What a call does here: PluginBehaviour for the plug-ins Tabularius knows; an MBS name it has no version of gives an MBS error text; an MBS call whose name is worked out at run time cannot be told from the file. */
export type CallBehaviour = PluginBehaviour | 'mbs-error' | 'cannot-tell';

/** How many places of each kind call it: scripts, field and custom-function calculations, layout objects, anything else. A place that calls it twice counts once. */
export interface CallUses { scripts: number; calculations: number; layouts: number; other: number }

export interface MigrationCall {
  /** The function as written, or "MBS ( \"SMTP.Send\" )" for MBS. */
  call: string;
  count: number;
  /** What the call does in this server, from the tables the engine itself uses. */
  behaviour: CallBehaviour;
  uses: CallUses;
  /** True when Tabularius runs this call already (an offline subset of the plug-in, built in). */
  worksHere: boolean;
  native: string;
  /** No native replacement exists; the plan says what to do instead. */
  noNative?: true;
  where: string[];
}

export interface MigrationPlan {
  database: string;
  summary: string;
  plugIns: { plugIn: string; calls: MigrationCall[] }[];
  /** Scripts to rewrite, most plug-in calls first: one proposal each. */
  scripts: { script: string; calls: number; plugIns: string[] }[];
  /** Fields, custom functions and layout objects that call plug-ins (rewrite their formulas). */
  formulas: { where: string; calls: string[] }[];
}

/** An MBS call whose function is a plain quoted name; any other MBS call names its function while it runs. */
const MBS_CALL = /\bMBS\s*\(\s*"([^"]+)"\s*[;)]/gi;
const MBS_ANY = /\bMBS\s*\(/gi;
const WHERE_KEEP = 25;

/** Every plug-in call in the file, grouped by plug-in, with the native replacement for each. */
export function migrationPlan(store: Store, opts: { plugIn?: string } = {}): MigrationPlan {
  const index = solutionIndex(store);
  const custom = index.catalog.customFunctions;
  const calls = new Map<string, { family: Family; call: MigrationCall }>();
  const byScript = new Map<string, { calls: number; plugIns: Set<string> }>();
  const formulas = new Map<string, Set<string>>();
  const places = new Map<string, Record<keyof CallUses, Set<string>>>();
  const want = opts.plugIn?.toLowerCase();

  const record = (site: Site, family: Family, key: string, shown: string, rule: Rule | undefined, worksHere: boolean, behaviour: CallBehaviour) => {
    if (want && !family.plugIn.toLowerCase().includes(want)) return;
    const id = `${family.plugIn}\0${key}`;
    let entry = calls.get(id);
    if (!entry) {
      entry = { family, call: { call: shown, count: 0, behaviour, uses: { scripts: 0, calculations: 0, layouts: 0, other: 0 }, worksHere, native: rule?.native ?? family.otherwise, ...(rule?.none ? { noNative: true as const } : {}), where: [] } };
      calls.set(id, entry);
    }
    entry.call.count++;
    // Places, not mentions: a script is one place however many of its steps call it, and a step that calls it twice counts once.
    const kind = site.kind === 'script' ? 'scripts' : site.kind === 'field' || site.kind === 'customFunction' ? 'calculations' : site.kind === 'layout' ? 'layouts' : 'other';
    const placeSets = places.get(id) ?? { scripts: new Set<string>(), calculations: new Set<string>(), layouts: new Set<string>(), other: new Set<string>() };
    places.set(id, placeSets);
    placeSets[kind].add(kind === 'scripts' ? (/^Script "(.*)", line \d+/.exec(site.where)?.[1] ?? site.where) : site.where);
    entry.call.uses[kind] = placeSets[kind].size;
    if (entry.call.where.length < WHERE_KEEP && !entry.call.where.includes(site.where)) entry.call.where.push(site.where);
    const script = /^Script "(.*)", line \d+/.exec(site.where)?.[1];
    if (script !== undefined && site.kind === 'script') {
      const s = byScript.get(script) ?? { calls: 0, plugIns: new Set() };
      s.calls++;
      s.plugIns.add(family.plugIn);
      byScript.set(script, s);
    } else {
      const f = formulas.get(site.where) ?? new Set();
      f.add(shown);
      formulas.set(site.where, f);
    }
  };

  for (const site of index.sites) {
    // Disabled steps never run.
    if (site.kind === 'script' && site.text.startsWith('// ')) continue;
    for (const fn of site.refs.functions) {
      if (custom.has(fn)) continue;
      // A call the file reader couldn't name: ⟨OWNR:index⟩, where the owner names the plug-in.
      const owner = /^⟨([0-9a-z]{4}):\d+⟩$/i.exec(fn)?.[1];
      if (owner) {
        const family = FAMILIES.find((f) => f.id?.toLowerCase() === owner.toLowerCase());
        if (family) record(site, family, fn, `${fn} (a ${family.plugIn} function the reader can't name yet)`, undefined, false, 'unavailable');
        continue;
      }
      const family = FAMILIES.find((f) => f.owns(fn));
      if (!family) continue;
      if (fn === 'mbs') {
        const names = [...site.text.matchAll(MBS_CALL)].map((m) => m[1]);
        const dynamic = [...site.text.matchAll(MBS_ANY)].length > names.length;
        for (const name of dynamic || !names.length ? [...names, '?'] : names) {
          const rule = family.rules.find((r) => r.match.test(name.toLowerCase()));
          record(site, family, `mbs:${name.toLowerCase()}`, `MBS ( "${name}" )`, rule, mbsSupports(name), name === '?' ? 'cannot-tell' : mbsSupports(name) ? 'runs' : 'mbs-error');
        }
        continue;
      }
      const rule = family.rules.find((r) => r.match.test(fn));
      // Built in, but a call with no native replacement (a shell command) is refused here, not run.
      record(site, family, fn, properName(site.text, fn), rule, FUNCTIONS.has(fn) && !rule?.none, pluginCallBehaviour(fn));
    }
  }

  const grouped = new Map<string, MigrationCall[]>();
  for (const { family, call } of calls.values()) grouped.set(family.plugIn, [...(grouped.get(family.plugIn) ?? []), call]);
  const plugIns = [...grouped].map(([plugIn, list]) => ({ plugIn, calls: list.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => sum(b.calls) - sum(a.calls));
  const scripts = [...byScript].map(([script, s]) => ({ script, calls: s.calls, plugIns: [...s.plugIns] })).sort((a, b) => b.calls - a.calls);
  const formulaList = [...formulas].map(([where, c]) => ({ where, calls: [...c] }));
  return { database: store.name, summary: summarize(plugIns, scripts, formulaList), plugIns, scripts, formulas: formulaList };
}

const sum = (calls: MigrationCall[]) => calls.reduce((n, c) => n + c.count, 0);

/** The function's name as the formula writes it. */
function properName(text: string, fn: string): string {
  const m = new RegExp(`\\b${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').exec(text);
  return m?.[0] ?? fn;
}

function summarize(plugIns: MigrationPlan['plugIns'], scripts: MigrationPlan['scripts'], formulas: MigrationPlan['formulas']): string {
  if (!plugIns.length) return 'This file calls no plug-ins that Tabularius knows. Nothing to migrate.';
  const lines = [`Plug-in calls: ${plugIns.map((p) => `${p.plugIn} (${sum(p.calls)})`).join(', ')}, in ${scripts.length} script${scripts.length === 1 ? '' : 's'} and ${formulas.length} formula${formulas.length === 1 ? '' : 's'}.`];
  const none = plugIns.flatMap((p) => p.calls.filter((c) => c.noNative).map((c) => c.call));
  const works = plugIns.flatMap((p) => p.calls.filter((c) => c.worksHere).map((c) => c.call));
  if (works.length) lines.push(`Already work here without the plug-in (still worth replacing to drop the licence): ${works.join(', ')}.`);
  if (none.length) lines.push(`No native replacement: ${none.join(', ')}.`);
  lines.push('Rewrite one script at a time: each rewritten script is dry-run offline on a copy of the file before anyone applies it.');
  return lines.join(' ');
}
