// Scripts as text: the lines FileMaker's script workspace shows (and
// scriptText() writes), read back into steps. One step per line; a step's
// options go in [ ... ] separated by ";"; "// " disables a step; "#" is a
// comment. A step can run over several lines while its brackets are open.
//
// Lines that are unchanged from the script's current steps keep those steps
// as they are, with every decoded option, so editing one line of a long
// imported script never loses what the others held.

import { displayedStepLine, DEVICE_TYPES, WEB_VIEWER_ACTIONS, scriptStepId, scriptStepName, stepLine, type FieldRef, type Ref, type Schema, type ScriptStep, type StepParams, type StoredFindRequest, type SortField } from '../../fmp12/src/index.ts';
import { isDeepStrictEqual } from 'node:util';
import { DesignError, type StepSpec } from './design.ts';

const COMMENT = 89;
// Claris's Select entire contents option on script steps (see the linked
// step pages in docs/script-steps-support.md).
const SELECT_STEPS = new Set(['Check Selection', 'Clear', 'Copy', 'Cut', 'Execute FileMaker Data API',
  'Insert Calculated Result', 'Insert Current Date', 'Insert Current Time', 'Insert Current User Name',
  'Insert from Index', 'Insert from Last Visited', 'Insert from URL', 'Insert Text', 'Paste']);

/** Split "a ; b ; c" on semicolons (or `sep`) outside quotes, brackets and parentheses. */
export function splitParts(s: string, sep = ';'): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < s.length) {
        cur += c + s[++i];
        continue;
      }
      if ((quote === '"' && c === '"') || (quote === '“' && c === '”')) quote = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === '“') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** A find request's criteria split on " AND " outside quotes: Name: “Tom AND Jerry” AND City: “Leeds” is two. */
function splitAnd(s: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if ((quote === '"' && c === '"' && s[i - 1] !== '\\') || (quote === '“' && c === '”')) quote = null;
    } else if (c === '"' || c === '“') quote = c;
    else {
      const m = /^\s+AND\s+/.exec(s.slice(i));
      if (m && i > start) {
        out.push(s.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Open [ brackets left after a line, ignoring quoted text. */
function openBrackets(s: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if ((quote === '"' && c === '"') || (quote === '“' && c === '”')) quote = null;
    } else if (c === '"' || c === '“') quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth;
}

/** Incremental form of openBrackets for continuation lines. */
function advanceBrackets(state: { depth: number; quote: string | null }, s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (state.quote) {
      if (c === '\\' && state.quote === '"') i++;
      else if ((state.quote === '"' && c === '"') || (state.quote === '“' && c === '”')) state.quote = null;
    } else if (c === '"' || c === '“') state.quote = c;
    else if (c === '[') state.depth++;
    else if (c === ']') state.depth--;
  }
}

const unquote = (s: string) => {
  const m = /^“([\s\S]*)”$/.exec(s.trim()) ?? /^"([\s\S]*)"$/.exec(s.trim());
  return m ? m[1] : s.trim();
};
const onOff = (s: string) => /^on$/i.test(s.trim());

interface Ctx {
  schema: Schema;
  line: number;
  /** Scripts in other files the script already performs (their ids can't be looked up here). */
  external: Map<string, { id: number; name: string; file: Ref }>;
}

const fail = (ctx: Ctx, msg: string) => new DesignError(960, `Line ${ctx.line}: ${msg}`);

function fieldRef(ctx: Ctx, text: string): FieldRef {
  const m = /^(.+?)::(.+?)(?:\[(\d+)\])?$/.exec(text.trim());
  if (!m) throw fail(ctx, `"${text}" is not a field (write Table::Field)`);
  const to = ctx.schema.tableOccurrences.find((t) => t.name.toLowerCase() === m[1].toLowerCase());
  if (!to) throw fail(ctx, `No table occurrence named "${m[1]}"`);
  const table = to.dataSourceId ? undefined : ctx.schema.tables.find((t) => t.id === to.baseTableId);
  const field = table?.fields.find((f) => f.name.toLowerCase() === m[2].toLowerCase());
  if (table && !field) throw fail(ctx, `No field "${m[2]}" in ${to.name}`);
  return { tableOccurrence: { id: to.id, name: to.name }, field: { id: field?.id ?? 0, name: field?.name ?? m[2] }, ...(m[3] ? { repetition: Number(m[3]) } : {}) };
}

function ref<T extends { id: number; name: string }>(ctx: Ctx, list: T[], text: string, what: string): Ref {
  const name = unquote(text);
  const item = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!item) throw fail(ctx, `No ${what} named "${name}"`);
  return { id: item.id, name: item.name };
}

/** "Field: value" -> ["Field", "value"]; undefined when the label differs. */
/** FileMaker's "Select" option (Select entire contents) as a leading part: whether it was there, taking it off. */
function takeSelect(parts: string[]): boolean {
  if (!/^select$/i.test(parts[0]?.trim() ?? '')) return false;
  parts.shift();
  return true;
}

/** The Select option as `Select`, `Select: On` or `Select: Off` at the front of the parts: true, false, or undefined when it isn't there. */
function takeSelectState(parts: string[]): boolean | undefined {
  const m = /^select(?:\s*:\s*(on|off))?$/i.exec(parts[0]?.trim() ?? '');
  if (!m) return undefined;
  parts.shift();
  return m[1]?.toLowerCase() !== 'off';
}

function labelled(part: string | undefined, label: string): string | undefined {
  if (part === undefined) return undefined;
  const m = new RegExp(`^${label}\\s*:\\s*([\\s\\S]*)$`, 'i').exec(part);
  return m ? m[1] : undefined;
}

function params(ctx: Ctx, name: string, parts: string[]): StepParams | undefined {
  if (!parts.length && !['Insert Text', 'Insert Calculated Result', 'Copy', 'Cut', 'Paste', 'Clear'].includes(name)) return undefined;
  const p: StepParams = {};
  if (!parts.length && ['Insert Calculated Result', 'Copy', 'Cut', 'Paste', 'Clear'].includes(name)) p.selectEntireContents = true;
  // A label that this step cannot print is not a supported option. In
  // particular, the old fallback silently interpreted these as a calculation.
  const bareSelectIsCalculation = (index: number) =>
    (index === 0 && ['If', 'Else If', 'Exit Loop If', 'Exit Script'].includes(name)) ||
    (index === 1 && ['Set Field', 'Set Next Serial Value', 'Set Variable'].includes(name));
  if (parts.some((part, index) => /^select$/i.test(part) && !bareSelectIsCalculation(index)) && !SELECT_STEPS.has(name) && name !== 'Sort Records by Field') {
    throw fail(ctx, `${name} has no Select option`);
  }
  if (name === 'Reset Account Password' && parts.some((part) => labelled(part, 'With dialog') !== undefined)) {
    throw fail(ctx, 'Reset Account Password has no With dialog option');
  }
  if (['Revert Transaction', 'Set Revert Transaction on Error', 'Import Records'].includes(name)) {
    const diagnostics = parts.filter((part) => /^Undecoded options\s*:|^Mode\s*:\s*Undecoded$/i.test(part));
    if (diagnostics.length) {
      const importMode = name === 'Import Records';
      if (diagnostics.length !== 1 || importMode && !/^Mode\s*:\s*Undecoded$/i.test(diagnostics[0]) || !importMode && !/^Undecoded options\s*:/i.test(diagnostics[0])) throw fail(ctx, 'Invalid undecoded options diagnostic');
      p.undecodedOptions = importMode ? ['Import mode'] : diagnostics[0].replace(/^Undecoded options\s*:\s*/i, '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!p.undecodedOptions.length) throw fail(ctx, 'Undecoded options needs an option label');
      parts = parts.filter((part) => !diagnostics.includes(part));
      if (!importMode) {
        if (parts.length) throw fail(ctx, 'Replace the undecoded options diagnostic with the intended options');
        return p;
      }
      if (parts.some((part) => /^(add|add new records|replace|update(?: existing| matching)? records(?: in found set)?|update)$/i.test(part))) throw fail(ctx, 'Replace Mode: Undecoded with Add, Update or Replace');
    }
  }
  const target = (s: string) => {
    if (s === undefined) return; // No target: the active field, as scriptText prints it.
    if (s.startsWith('$')) p.variable = s;
    else p.field = fieldRef(ctx, s);
  };
  switch (name) {
    case 'Set Variable': {
      const m = /^(\$\$?[^\s[]+)(?:\[(.+)\])?$/.exec(parts[0]);
      if (!m) throw fail(ctx, 'Set Variable needs a $variable');
      p.variable = m[1];
      if (m[2]) p.repetition = m[2];
      p.value = labelled(parts[1], 'Value') ?? parts[1] ?? '';
      break;
    }
    case 'Undo/Redo':
      for (const part of parts) {
        const undo = part.trim().toLowerCase();
        if (undo === 'undo' || undo === 'redo' || undo === 'toggle') p.undo = undo;
      }
      break;
    case 'Send Mail': {
      // [ Send via SMTP Server ; With dialog: Off ; To: … ; CC: … ; BCC: … ; Subject: … ; Message: … ; Attachment: … ]
      const mail: NonNullable<StepParams['mail']> = {};
      const labels: [string, 'to' | 'cc' | 'bcc' | 'subject' | 'message' | 'fromName' | 'fromEmail'][] = [
        ['To', 'to'], ['CC', 'cc'], ['BCC', 'bcc'], ['Subject', 'subject'], ['Message', 'message'], ['From name', 'fromName'], ['From', 'fromEmail'],
      ];
      for (const part of parts) {
        const t = part.trim();
        const d = labelled(t, 'With dialog');
        const a = labelled(t, 'Attachment');
        if (d !== undefined) p.noDialog = !onOff(d);
        else if (/^send via smtp server$/i.test(t)) mail.smtp = true;
        else if (/^send via e-?mail client$/i.test(t)) continue;
        else if (a !== undefined) (mail.attachments ??= []).push(a.trim());
        else {
          const hit = labels.map(([label, key]) => [labelled(t, label), key] as const).find(([v]) => v !== undefined);
          if (!hit) throw fail(ctx, `Send Mail doesn't know "${t}"`);
          mail[hit[1]] = hit[0]!;
        }
      }
      p.mail = mail;
      break;
    }
    case 'Perform Find/Replace': {
      // FileMaker's text: [ With dialog ; find ; replace ; operation ], no replace for Find Next.
      const rest: string[] = [];
      let matchCase = false, wholeWords = false, currentRecord = false;
      let within: 'all' | 'current' | undefined;
      for (const part of parts) {
        const t = part.trim();
        const d = labelled(t, 'With dialog');
        const w = labelled(t, 'Within');
        if (d !== undefined) p.noDialog = !onOff(d);
        else if (/^match case$/i.test(t)) matchCase = true;
        else if (/^whole words$/i.test(t)) wholeWords = true;
        else if (/^across\s*:\s*current record$/i.test(t)) currentRecord = true;
        else if (w !== undefined) within = /current/i.test(w) ? 'current' : 'all';
        else rest.push(part);
      }
      const operation = (['Find Next', 'Replace & Find', 'Replace All', 'Replace'] as const).find((o) => o.toLowerCase() === rest[rest.length - 1]?.trim().toLowerCase());
      if (!operation || rest.length < 2) throw fail(ctx, 'Perform Find/Replace needs what to find and Find Next, Replace & Find, Replace or Replace All');
      p.findReplace = {
        find: rest[0], operation,
        ...(operation !== 'Find Next' ? { replace: rest.length > 2 ? rest[1] : '""' } : {}),
        ...(matchCase ? { matchCase } : {}), ...(wholeWords ? { wholeWords } : {}), ...(currentRecord ? { currentRecord } : {}), ...(within ? { within } : {}),
      };
      break;
    }
    case 'Pause/Resume Script': {
      // FileMaker's text: "Indefinitely" or "Duration (seconds): 2"; Tabularius writes the duration alone.
      if (/^indefinitely$/i.test(parts[0].trim())) break;
      p.calculation = labelled(parts[0], 'Duration \\(seconds\\)') ?? parts[0];
      break;
    }
    case 'Set Field':
    case 'Set Next Serial Value':
    case 'Insert Calculated Result':
    case 'Replace Field Contents':
      if (name === 'Replace Field Contents' && labelled(parts[0], 'With dialog') !== undefined) {
        p.noDialog = !onOff(labelled(parts.shift(), 'With dialog')!);
        if (!parts.length) break;
      }
      if (name === 'Replace Field Contents' && parts.length > 1 && /^(current contents|replace with serial numbers\s*:)/i.test(parts[1].trim())) {
        // FileMaker's text for the other two choices.
        target(parts[0]);
        const rest = parts.slice(1).map((x) => x.trim());
        if (/^current contents$/i.test(rest[0])) {
          p.replaceWith = 'current';
          break;
        }
        p.replaceWith = 'serial';
        const serial: NonNullable<StepParams['serial']> = {};
        for (const part of rest) {
          const initial = labelled(part, 'Initial value');
          const increment = labelled(part, 'Increment value');
          if (initial !== undefined) serial.initial = initial.trim();
          else if (increment !== undefined) serial.increment = increment.trim();
          else if (/^update serial number in entry options$/i.test(part)) serial.updateEntryOptions = true;
        }
        p.serial = serial;
        break;
      }
      // falls through
    case 'Insert from URL':
      // Insert Calculated Result [ Select ; target ; formula ]: without Select it goes in at the selection.
      if (name === 'Insert Calculated Result') {
        p.selectEntireContents = parts.length ? takeSelect(parts) : true;
        // [ ; ] is how the step prints with no Select and no formula.
        while (parts.length && !parts[parts.length - 1].trim()) parts.pop();
        if (!parts.length) break;
      }
      if (name === 'Insert from URL') {
        const state = takeSelectState(parts);
        if (state !== undefined) p.selectEntireContents = state;
      }
      // Without a target (the active field), the only option is the formula.
      if (parts.length === 1 && !/^\$|^[^"“(]+::[^"“(]+$/.test(parts[0])) {
        p.calculation = parts[0];
        break;
      }
      target(parts[0]);
      if (parts[1] !== undefined) p.calculation = parts.slice(1).join(' ; ');
      break;
    case 'Insert Current Date':
    case 'Insert Current Time':
    case 'Insert Current User Name':
    case 'Insert from Last Visited':
    case 'Insert from Index':
      for (const [index, part] of parts.entries()) {
        if (index === 0 && /^select$/i.test(part)) p.selectEntireContents = true;
        else target(labelled(part, 'Target') ?? part);
      }
      break;
    case 'Insert Text':
      p.selectEntireContents = parts.length ? takeSelect(parts) : true;
      if (parts.length === 1 && /^\s*(?:“[\s\S]*”|"[\s\S]*")\s*$/.test(parts[0])) p.text = unquote(parts[0]);
      else {
        target(parts[0]);
        p.text = unquote(parts[1] ?? '');
      }
      break;
    case 'Paste': {
      p.selectEntireContents = parts.length ? takeSelect(parts) : true;
      const into = parts.filter((x) => !/^no style$/i.test(x.trim()))[0];
      if (into) target(into);
      break;
    }
    case 'Go to Field':
    case 'Copy':
    case 'Cut':
    case 'Clear':
    case 'Insert from Device': {
      // [ Table::Field ; Type: Bar Code ; Camera: Back ], as FileMaker Go's step reads.
      // Copy, Cut and Clear [ Select ; Table::Field ]: without Select only the selection.
      if (name === 'Copy' || name === 'Cut' || name === 'Clear') p.selectEntireContents = parts.length ? takeSelect(parts) : true;
      const rest: string[] = [];
      for (const part of parts) {
        const type = labelled(part, 'Type');
        const camera = labelled(part, 'Camera');
        if (type !== undefined) {
          const t = DEVICE_TYPES.find((x) => x.toLowerCase().replace(/\s+/g, '') === type.trim().toLowerCase().replace(/\s+/g, ''));
          if (!t) throw fail(ctx, `Insert from Device takes Type: ${DEVICE_TYPES.join(', ')}`);
          p.device = { ...p.device, type: t };
        } else if (camera !== undefined) p.device = { type: p.device?.type ?? 'Camera', camera: /front/i.test(camera) ? 'front' : 'back' };
        else rest.push(part);
      }
      if (rest[0]) target(rest[0]);
      if (name === 'Insert from Device') p.device ??= { type: 'Camera' };
      break;
    }
    case 'Insert File':
    case 'Export Field Contents': {
      const folders = name === 'Export Field Contents' ? parts.findIndex((x) => labelled(x, 'Create folders') !== undefined) : -1;
      if (folders >= 0 && onOff(labelled(parts.splice(folders, 1)[0], 'Create folders')!)) p.createFolders = true;
      target(parts[0]);
      if (parts[1]) p.filePaths = [unquote(parts[1])];
      break;
    }
    case 'Install Plug-In File':
      if (parts[0]) p.filePaths = [unquote(parts[0])];
      break;
    case 'Get File Exists':
    case 'Get File Size':
    case 'Open Data File':
    case 'Create Data File':
    case 'Delete File':
    case 'Rename File':
    case 'Write to Data File':
    case 'Read from Data File':
    case 'Get Data File Position':
    case 'Set Data File Position':
    case 'Close Data File':
      for (const part of parts) {
        const m = /^(source file|target file|target|data source|file id|amount \(bytes\)|amount|new name|new position|create folders|read as|write as)\s*:\s*([\s\S]*)$/i.exec(part);
        const [label, value] = m ? [m[1], m[2]] : ['', part];
        switch (label.toLowerCase()) {
          case '': case 'source file': case 'target file':
            if (/^append line feed$/i.test(value)) p.appendLineFeed = true;
            else p.filePaths = [unquote(value)];
            break;
          case 'target': case 'data source': target(value); break;
          case 'file id': p.fileId = value; break;
          case 'amount (bytes)': case 'amount': p.amount = value; break;
          case 'new name': p.newName = value; break;
          case 'new position': p.calculation = value; break;
          case 'create folders': p.createFolders = onOff(value); break;
          case 'read as': case 'write as':
            if (name === 'Write to Data File' && !/^utf-?(8|16)$/i.test(value.trim())) throw fail(ctx, 'Write to Data File writes UTF-16 or UTF-8, not "' + value.trim() + '"');
            p.encoding = /utf-?8/i.test(value) ? 'utf-8' : /bytes/i.test(value) ? 'bytes' : 'utf-16';
            break;
        }
      }
      break;
    case 'Export Records':
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        const folders = labelled(part, 'Create folders');
        const fields = labelled(part, 'Fields');
        const grammar = labelled(part, 'Grammar');
        const xslt = labelled(part, 'XSLT');
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (folders !== undefined) p.createFolders = onOff(folders);
        else if (grammar !== undefined) {
          const g = grammar.trim().toUpperCase();
          if (g !== 'FMPXMLRESULT' && g !== 'FMPDSORESULT') throw fail(ctx, `Export Records' Grammar is FMPXMLRESULT or FMPDSORESULT, not "${grammar.trim()}"`);
          p.xmlGrammar = g;
        }
        else if (xslt !== undefined) p.xslt = unquote(xslt);
        else if (/^xml$/i.test(part)) p.exportFormat = 'XML';
        else if (fields !== undefined) p.exportFields = fields.split(',').map((x) => fieldRef(ctx, x));
        else if (/utf-?16/i.test(part)) p.encoding = 'utf-16';
        else if (/utf-?8/i.test(part)) p.encoding = 'utf-8';
        else if (/^comma-separated/i.test(part)) p.exportFormat = 'COMS';
        else if (/^tab-separated/i.test(part)) p.exportFormat = 'TABS';
        else if (/^merge$/i.test(part)) p.exportFormat = 'MRGE';
        else if (/^excel/i.test(part)) p.exportFormat = 'XLXE';
        else p.filePaths = [unquote(part)];
      }
      break;
    case 'Save a Copy as':
      for (const part of parts) {
        const kind = /^copy of current/i.test(part) ? 'copy' : /^compacted/i.test(part) ? 'compacted' : /^clone/i.test(part) ? 'clone' : /^self-contained/i.test(part) ? 'self-contained' : undefined;
        const folders = labelled(part, 'Create folders');
        if (kind) p.copyKind = kind;
        else if (folders !== undefined) p.createFolders = onOff(folders);
        else p.filePaths = [unquote(part)];
      }
      break;
    case 'Save Records as PDF':
    case 'Save Records as Snapshot Link':
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        const folders = labelled(part, 'Create folders');
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (folders !== undefined) p.createFolders = onOff(folders);
        else if (/^append$/i.test(part)) p.appendPdf = true;
        else if (/^currently open pdf$/i.test(part)) p.toOpenPdf = true;
        else if (/^records being browsed$/i.test(part)) p.pdfRecords = 'browsed';
        else if (/^current record$/i.test(part)) p.pdfRecords = 'current';
        else if (/^blank record/i.test(part)) p.pdfRecords = 'blank';
        else if (!/^restore$/i.test(part)) p.filePaths = [unquote(part)];
      }
      break;
    case 'Delete Account':
    case 'Reset Account Password':
    case 'Enable Account':
    case 'Re-Login':
      for (const part of parts) {
        const account = labelled(part, 'Account Name');
        const password = labelled(part, 'New Password') ?? labelled(part, 'Password');
        const dialog = labelled(part, 'With dialog');
        if (account !== undefined) p.accountName = account;
        else if (password !== undefined) p.password = password;
        else if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (/^expire password$/i.test(part)) p.expirePassword = true;
        else if (/^(activate|deactivate)$/i.test(part)) p.activate = /^activate$/i.test(part);
      }
      if (name === 'Reset Account Password') p.expirePassword ??= false;
      break;
    case 'Set Field By Name':
      p.fieldName = parts[0];
      p.calculation = parts.slice(1).join(' ; ');
      break;
    case 'Perform Script':
    case 'Perform Script on Server':
    case 'Install OnTimer Script': {
      let file: string | undefined;
      let byName = false;
      for (const part of parts) {
        const param = labelled(part, 'Parameter');
        const interval = labelled(part, 'Interval');
        const from = labelled(part, 'From file');
        const wait = name === 'Perform Script on Server' ? labelled(part, 'Wait for completion') : undefined;
        if (wait !== undefined) {
          if (onOff(wait)) delete p.wait;
          else p.wait = false;
        } else if (param !== undefined) p.parameter = param;
        else if (interval !== undefined) p.calculation = interval;
        else if (from !== undefined) file = unquote(from);
        else if (/^specified\s*:\s*by name$/i.test(part.trim()) && name !== 'Install OnTimer Script') byName = true;
        else if (/^specified\s*:\s*from list$/i.test(part.trim())) continue;
        else if (byName && p.scriptCalculation === undefined) p.scriptCalculation = part.trim();
        else if (file !== undefined) {
          const known = ctx.external.get(`${file}\n${unquote(part)}`.toLowerCase());
          if (!known) throw fail(ctx, `A script in another file ("${file}") can only be one this script already performs`);
          p.script = { id: known.id, name: known.name, file: known.file };
        } else p.script = ref(ctx, ctx.schema.scripts, part, 'script');
      }
      break;
    }
    case 'Perform Script on Server with Callback': {
      let callback = false;
      for (const part of parts) {
        const param = labelled(part, 'Parameter');
        const cb = labelled(part, 'Callback script');
        const state = labelled(part, 'State');
        if (cb !== undefined) {
          callback = true;
          p.callback = { script: ref(ctx, ctx.schema.scripts, cb, 'script') };
        } else if (state !== undefined && p.callback) p.callback.state = state.trim();
        else if (param !== undefined) {
          if (callback && p.callback) p.callback.parameter = param;
          else p.parameter = param;
        } else if (/^specified\s*:/i.test(part)) continue;
        else if (!callback) p.script = ref(ctx, ctx.schema.scripts, part, 'script');
      }
      break;
    }
    case 'Open File':
    case 'Close File':
      // A file reference (Manage External Data Sources), or the current file.
      if (parts[0] && !/^current file$/i.test(parts[0])) p.dataSource = ref(ctx, ctx.schema.dataSources, parts[0], 'data source');
      break;
    case 'Go to Layout': {
      const byName = labelled(parts[0], 'Layout Name');
      const byNumber = labelled(parts[0], 'Layout Number');
      if (/^original layout$/i.test(parts[0])) p.layoutDestination = 'original';
      else if (byName !== undefined) Object.assign(p, { layoutDestination: 'name', layoutCalculation: byName });
      else if (byNumber !== undefined) Object.assign(p, { layoutDestination: 'number', layoutCalculation: byNumber });
      else Object.assign(p, { layoutDestination: 'named', layout: ref(ctx, ctx.schema.layouts, parts[0], 'layout') });
      break;
    }
    case 'Go to Record/Request/Page':
    case 'Go to Portal Row':
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        const exit = labelled(part, 'Exit after last');
        if (/^(first|last|previous|next)$/i.test(part)) p.location = part.toLowerCase() as StepParams['location'];
        else if (dialog !== undefined) {
          p.location = 'calculation';
          p.noDialog = !onOff(dialog);
        } else if (exit !== undefined) p.exitAfterLast = onOff(exit);
        // FileMaker writes the checked option bare, "Next ; Exit after last", and the lint messages here do too.
        else if (/^exit after last$/i.test(part.trim())) p.exitAfterLast = true;
        // A lone word is not a record number: a misspelt Next or Previous would otherwise become a calculation that never moves.
        else if (/^[A-Za-z]+$/.test(part.trim())) throw fail(ctx, `"${part.trim()}" should be First, Last, Previous, Next, a record number calculation, or Exit after last`);
        else {
          p.location = 'calculation';
          p.calculation = part;
        }
      }
      break;
    case 'Set Error Capture':
    case 'Allow User Abort':
    case 'Set Revert Transaction on Error':
    case 'Allow Formatting Bar':
    case 'Set Layout Object Animation':
      if (parts.length !== 1 || !/^(on|off)$/i.test(parts[0].trim())) throw fail(ctx, `${name} takes only On or Off`);
      p.on = onOff(parts[0]);
      break;
    case 'Enable Touch Keyboard':
      if (parts.length !== 1 || !/^(on|off|toggle)$/i.test(parts[0].trim())) throw fail(ctx, 'Enable Touch Keyboard takes only On, Off or Toggle');
      if (/^toggle$/i.test(parts[0]?.trim() ?? '')) p.toggle = true;
      else p.on = onOff(parts[0]);
      break;
    case 'Revert Transaction':
      for (const part of parts) {
        const condition = labelled(part, 'Condition');
        const code = labelled(part, 'Error code');
        const message = labelled(part, 'Error message');
        if (condition !== undefined) p.calculation = condition;
        else if (code !== undefined) p.errorCode = code;
        else if (message !== undefined) p.errorMessage = message;
        else throw fail(ctx, `"${part}" should read Condition:, Error code: or Error message:`);
      }
      break;
    case 'Exit Script':
      p.calculation = labelled(parts[0], '(?:Text )?Result') ?? parts.join(' ; ');
      break;
    case 'Configure AI Account':
    case 'Insert Embedding':
    case 'Insert Embedding in Found Set':
    case 'Perform Semantic Find':
    case 'Generate Response from Model':
    case 'Perform RAG Action':
    case 'Configure RAG Account':
    case 'Configure Prompt Template': {
      // The options as stepLine writes them, label by label.
      const ai: NonNullable<StepParams['ai']> = {};
      type Text = 'accountName' | 'model' | 'endpoint' | 'apiKey' | 'input' | 'vector' | 'returnCount' | 'threshold' | 'instructions' | 'messagesVariable'
        | 'historyVariable' | 'historyCount' | 'responseVariable' | 'ragAccountName' | 'spaceId' | 'tokensPerChunk' | 'prompt' | 'templateName' | 'sqlPrompt' | 'naturalLanguagePrompt' | 'parameters';
      const texts: [string, Text][] = [
        ['RAG Account Name', 'ragAccountName'], ['Account Name', 'accountName'], ['Embedding Model', 'model'], ['Model', 'model'], ['Endpoint', 'endpoint'],
        ['API key', 'apiKey'], ['Input', 'input'], ['Text', 'input'], ['User Prompt', 'input'], ['Vector', 'vector'], ['Return count', 'returnCount'],
        ['Cosine similarity value', 'threshold'], ['Instructions', 'instructions'], ['Messages', 'messagesVariable'], ['Save Message History To', 'historyVariable'],
        ['Message History Count', 'historyCount'], ['Response Target', 'responseVariable'], ['Space ID', 'spaceId'], ['Tokens per text chunk', 'tokensPerChunk'], ['Prompt', 'prompt'],
        ['Template Name', 'templateName'], ['Prompt Template Name', 'templateName'], ['SQL Prompt', 'sqlPrompt'], ['Natural Language Prompt', 'naturalLanguagePrompt'],
        ['Parameters', 'parameters'],
      ];
      // Perform RAG Action names its target Input; the others' Input is the text to embed.
      const targetLabels = name === 'Perform RAG Action' ? ['Input'] : name === 'Generate Response from Model' ? ['Response'] : ['Target Field', 'Target'];
      const choice = <T extends string>(value: string, options: readonly T[], what: string): T => {
        const v = value.trim().toLowerCase();
        const hit = options.find((o) => o.toLowerCase() === v);
        if (!hit) throw fail(ctx, `${name}: ${what} is one of ${options.join(', ')}`);
        return hit;
      };
      if (name === 'Insert Embedding in Found Set') ai.replaceTarget = false;
      if (name === 'Generate Response from Model' && parts.some((x) => labelled(x.trim(), 'Prompt') !== undefined) && parts.some((x) => labelled(x.trim(), 'User Prompt') !== undefined)) {
        throw fail(ctx, 'Generate Response from Model has both Prompt and User Prompt: Prompt is another spelling of User Prompt, so give only one');
      }
      for (const part of parts) {
        const t = part.trim();
        const into = targetLabels.map((l) => labelled(t, l)).find((v) => v !== undefined);
        const source = labelled(t, 'Source Field');
        const queryBy = labelled(t, 'Query by');
        const recordSet = labelled(t, 'Record set');
        const condition = labelled(t, 'Cosine similarity condition');
        const action = labelled(t, 'Action');
        const data = labelled(t, 'RAG Data');
        const type = labelled(t, 'Template Type');
        const inputFile = name === 'Perform RAG Action' ? labelled(t, 'Input File') : undefined;
        const known = texts.find(([l]) => labelled(t, l) !== undefined);
        if (into !== undefined) target(into.trim());
        else if (source !== undefined) ai.sourceField = fieldRef(ctx, source);
        else if (queryBy !== undefined) ai.queryBy = choice(queryBy, ['natural language', 'vector data', 'image'] as const, 'Query by');
        else if (recordSet !== undefined) ai.recordSet = choice(recordSet, ['all records', 'current found set'] as const, 'Record set');
        else if (condition !== undefined) ai.condition = choice(condition, ['greater than', 'less than', 'equal to', 'greater than or equal to', 'less than or equal to'] as const, 'Cosine similarity condition');
        else if (action !== undefined) ai.ragAction = choice(action, ['add data', 'send prompt', 'remove data'] as const, 'Action');
        else if (data !== undefined) ai.dataSource = choice(data, ['from text', 'from file', 'from file (async)', 'from container', 'from container (async)'] as const, 'RAG Data');
        else if (inputFile !== undefined) p.filePaths = [unquote(inputFile)];
        else if (type !== undefined) ai.requestType = choice(type, ['SQL query'] as const, 'Template Type');
        else if (name === 'Insert Embedding in Found Set' && /^replace target contents$/i.test(t)) ai.replaceTarget = true;
        else if (name === 'Insert Embedding in Found Set' && /^continue on error$/i.test(t)) ai.continueOnError = true;
        else if (name === 'Insert Embedding in Found Set' && /^show summary$/i.test(t)) ai.showSummary = true;
        else if (known) {
          const value = labelled(t, known[0])!;
          // A key written into the script is shown as "…" and can't be read back: it would be lost.
          if (known[1] === 'apiKey' && value.trim() === '"…"') throw fail(ctx, 'API key "…" stands for a key written into the script, which isn\'t shown: give the key again, from a field or variable');
          // Generate Response from Model has no separate prompt option: its prompt is the user prompt.
          ai[name === 'Generate Response from Model' && known[1] === 'prompt' ? 'input' : known[1]] = value;
        }
        // Kept as written, as other steps keep options this parser doesn't know, so they print back unchanged.
        else (p.slots ??= {})[128 + Object.keys(p.slots ?? {}).length] = part;
      }
      p.ai = ai;
      break;
    }
    case 'Perform Find by Natural Language': {
      const ai: NonNullable<StepParams['ai']> = {};
      for (const part of parts) {
        const get = labelled(part, 'Get');
        const account = labelled(part, 'Account Name');
        const model = labelled(part, 'Model');
        const prompt = labelled(part, 'Prompt');
        const template = labelled(part, 'Prompt Template Name');
        const parameters = labelled(part, 'Parameters');
        const response = labelled(part, 'Response Target') ?? labelled(part, 'Target');
        if (get !== undefined) {
          const mode = get.toLowerCase();
          if (!['found set', 'find request as json', 'found set as json'].includes(mode)) throw fail(ctx, `Unknown Get option "${get}"`);
          ai.findGet = mode as NonNullable<typeof ai.findGet>;
        } else if (account !== undefined) ai.accountName = account;
        else if (model !== undefined) ai.model = model;
        else if (prompt !== undefined) ai.prompt = prompt;
        else if (template !== undefined) ai.templateName = template;
        else if (parameters !== undefined) ai.parameters = parameters;
        else if (response !== undefined) target(response);
        // Kept as written, as other steps keep options this parser doesn't know, so they print back unchanged.
        else (p.slots ??= {})[128 + Object.keys(p.slots ?? {}).length] = part;
      }
      p.ai = ai;
      break;
    }
    case 'Perform SQL Query by Natural Language': {
      const ai: NonNullable<StepParams['ai']> = {};
      const actions = ['query', 'query for data only', 'get sql', 'get first sql only', 'get ddl'];
      for (const part of parts) {
        const value = (l: string) => labelled(part, l);
        let v: string | undefined;
        if ((v = value('Account Name')) !== undefined) ai.accountName = v;
        else if ((v = value('Model')) !== undefined) ai.model = v;
        else if ((v = value('Prompt Template Name')) !== undefined) ai.templateName = v;
        else if ((v = value('Prompt')) !== undefined) ai.prompt = v;
        else if ((v = value('Action')) !== undefined) {
          if (!actions.includes(v.toLowerCase())) throw fail(ctx, `Unknown Action "${v}"`);
          ai.sqlAction = v.toLowerCase() as NonNullable<typeof ai.sqlAction>;
        } else if ((v = value('Data Tables')) !== undefined) {
          if (!['from list', 'by name', 'by ddl'].includes(v.toLowerCase())) throw fail(ctx, `Unknown Data Tables option "${v}"`);
          ai.dataTables = v.toLowerCase() as NonNullable<typeof ai.dataTables>;
        } else if ((v = value('Tables')) !== undefined) ai.tables = v.split(',').map((x) => x.trim()).filter(Boolean);
        else if ((v = value('Table Names') ?? value('DDL')) !== undefined) ai.tablesCalculation = v;
        else if ((v = value('Stream')) !== undefined) ai.stream = onOff(v);
        else if ((v = value('Parameters')) !== undefined) ai.parameters = v;
        else if ((v = value('Response Target') ?? value('Target')) !== undefined) target(v);
        else (p.slots ??= {})[128 + Object.keys(p.slots ?? {}).length] = part;
      }
      p.ai = ai;
      break;
    }
    case 'Perform Find':
    case 'Enter Find Mode':
    case 'Constrain Found Set':
    case 'Extend Found Set': {
      const findParts = name === 'Enter Find Mode' ? parts.filter((part) => {
        const pause = labelled(part, 'Pause');
        if (pause === undefined) return true;
        if (!/^off$/i.test(pause.trim())) throw fail(ctx, 'Enter Find Mode supports only Pause: Off');
        p.pause = false;
        return false;
      }) : parts;
      if (!findParts.length) break;
      if (!/^restore$/i.test(findParts[0])) throw fail(ctx, `${name} takes Restore${name === 'Enter Find Mode' ? ' and Pause: Off' : ''}`);
      p.restore = true;
      p.requests = findParts.slice(1).map((r): StoredFindRequest => {
        const m = /^(Find|Omit)\s*:\s*([\s\S]*)$/i.exec(r);
        if (!m) throw fail(ctx, `"${r}" should read Find: Table::Field: “criteria”`);
        return {
          omit: /^omit$/i.test(m[1]),
          criteria: splitAnd(m[2]).map((c) => {
            const cm = /^(.+?::.+?):\s*(“[\s\S]*”|"[\s\S]*")$/.exec(c.trim());
            if (!cm) throw fail(ctx, `"${c}" should read Table::Field: “criteria”`);
            return { field: fieldRef(ctx, cm[1]), criteria: unquote(cm[2]) };
          }),
        };
      });
      break;
    }
    case 'Sort Records by Field': {
      p.selectEntireContents = takeSelect(parts);
      const rest = parts;
      const orderText = rest.find((x) => /^(ascending|descending|associated value list)$/i.test(x));
      const order = /^associated value list$/i.test(orderText ?? '') ? 'custom' : /^descending$/i.test(orderText ?? '') ? 'descending' : 'ascending';
      const target = rest.find((x) => x !== orderText && labelled(x, 'Value list') === undefined);
      if (target) {
        const valueList = rest.map((x) => labelled(x, 'Value list')).find((x) => x !== undefined);
        p.sort = [{ field: fieldRef(ctx, target), order, ...(valueList !== undefined ? { valueList: ref(ctx, ctx.schema.valueLists, valueList, 'value list') } : {}) }];
      } else if (orderText !== undefined) p.sortOrder = order;
      break;
    }
    case 'Sort Records': {
      const rest = parts.filter((x) => {
        const d = labelled(x, 'With dialog');
        if (d !== undefined) p.noDialog = !onOff(d);
        return d === undefined;
      });
      if (rest.length && /^restore$/i.test(rest[0])) {
        p.restore = true;
        const sort: SortField[] = [];
        for (let i = 1; i < rest.length; i += 2) {
          const order = (rest[i + 1] ?? 'ascending').toLowerCase();
          if (!['ascending', 'descending', 'custom'].includes(order)) throw fail(ctx, `Sort order "${rest[i + 1]}" should be ascending, descending or custom`);
          const field = fieldRef(ctx, rest[i]);
          const valueList = order === 'custom' && rest[i + 2] !== undefined ? labelled(rest[i + 2], 'Value list') : undefined;
          sort.push({ field, order: order as SortField['order'], ...(valueList !== undefined ? { valueList: ref(ctx, ctx.schema.valueLists, valueList, 'value list') } : {}) });
          if (valueList !== undefined) i++;
        }
        p.sort = sort;
      } else if (rest.length) {
        // Anything else used to be dropped, leaving a step that sorted nothing.
        throw fail(ctx, `Sort Records reads "Restore; Table::Field; ascending|descending|custom; …" (then "With dialog: On|Off"), not "${rest[0]}"`);
      }
      break;
    }
    case 'Show Custom Dialog': {
      // FileMaker's text has the title and message; buttons and input fields
      // are Tabularius's additions ("Button 1:", "Input 1:", "Label 1:",
      // "Password 1", "Commit 2: On") so they survive editing as text.
      p.title = parts[0];
      const message: string[] = [];
      const buttons: string[] = [];
      const inputs: NonNullable<StepParams['inputs']> = [];
      const commit = [true, false, true];
      let commitSet = false;
      const input = (n: string) => (inputs[Number(n) - 1] ??= {});
      for (const part of parts.slice(1)) {
        const m = /^(Button|Input|Label|Commit)\s+([123])\s*:\s*([\s\S]*)$/i.exec(part.trim());
        const pw = /^Password\s+([123])$/i.exec(part.trim());
        if (pw) input(pw[1]).password = true;
        else if (!m) message.push(part);
        else {
          const [, kind, n, value] = m;
          switch (kind.toLowerCase()) {
            case 'button': buttons[Number(n) - 1] = value; break;
            case 'label': input(n).label = value; break;
            case 'commit': commit[Number(n) - 1] = /^on$/i.test(value); commitSet = true; break;
            default: if (value.startsWith('$')) input(n).variable = value; else input(n).field = fieldRef(ctx, value);
          }
        }
      }
      if (message.length) p.message = message.join(' ; ');
      if (buttons.length) p.buttons = Array.from(buttons, (b) => b ?? '""');
      const kept = inputs.filter((x) => x && (x.field || x.variable));
      if (kept.length) p.inputs = kept;
      if (commitSet && commit.some((c, i) => c !== (i !== 1))) p.commit = commit;
      break;
    }
    case 'Truncate Table': {
      const t = labelled(parts[0], 'Table') ?? parts[0];
      if (!/^<current table>$/i.test(t)) p.tableOccurrence = ref(ctx, ctx.schema.tableOccurrences, t, 'table occurrence');
      break;
    }
    case 'Go to Related Record':
      for (const part of parts) {
        const from = labelled(part, 'From table');
        const using = labelled(part, 'Using layout');
        const window = labelled(part, 'New window');
        if (/^match all records in (the|current) found set$/i.test(part.trim())) p.matchFoundSet = true;
        else if (/^new window$/i.test(part.trim())) p.newWindow = true;
        else if (window !== undefined) Object.assign(p, { newWindow: true, slots: { 128: window } });
        else if (/^(show only related records|match current record only)$/i.test(part.trim())) continue;
        else if (from !== undefined) p.tableOccurrence = ref(ctx, ctx.schema.tableOccurrences, from, 'table occurrence');
        else if (using !== undefined && !/^<current layout>$/i.test(using)) {
          p.layout = ref(ctx, ctx.schema.layouts, using, 'layout');
          p.useLayout = true;
        }
      }
      break;
    case 'Close Window':
    case 'Select Window':
      // "Current Window", or "Name: formula" (and "Current file" or "Of file: …", not used).
      for (const part of parts) {
        const name = labelled(part, 'Name');
        if (name !== undefined) p.calculation = name;
        else if (!/^(current window|current file|of file:.*)$/i.test(part.trim())) p.calculation = part;
      }
      break;
    case 'Adjust Window':
      for (const part of parts) {
        const adjust = part.trim().toLowerCase();
        if (adjust === 'resize to fit' || adjust === 'maximize' || adjust === 'minimize' || adjust === 'restore' || adjust === 'hide') p.adjust = adjust;
      }
      break;
    case 'Scroll Window':
      for (const part of parts) {
        const scroll = part.trim().toLowerCase();
        if (scroll === 'home' || scroll === 'end' || scroll === 'page up' || scroll === 'page down' || scroll === 'to selection') p.scroll = scroll;
      }
      break;
    case 'View As': {
      const v = parts[0]?.trim().toLowerCase().replace(/^view as /, '');
      if (v === 'form' || v === 'list' || v === 'table' || v === 'cycle') p.view = v;
      break;
    }
    case 'Set Zoom Level':
      for (const part of parts) {
        const v = part.trim();
        const pct = /^(\d+)\s*%$/.exec(v);
        if (/^lock$/i.test(v)) p.lock = true;
        else if (pct) p.zoom = Number(pct[1]);
        else if (/^zoom (in|out)$/i.test(v)) p.zoom = v.toLowerCase().endsWith('in') ? 'in' : 'out';
        else if (v) p.zoomCalculation = v;
      }
      break;
    case 'Set Selection':
      for (const part of parts) {
        const start = labelled(part, 'Start Position');
        const end = labelled(part, 'End Position');
        if (start !== undefined) p.selectionStart = start;
        else if (end !== undefined) p.selectionEnd = end;
        else if (part.includes('::')) p.field = fieldRef(ctx, part);
        else throw fail(ctx, `Set Selection needs a target field, not "${part}"`);
      }
      break;
    case 'Check Selection':
      if (takeSelect(parts)) p.selectEntireContents = true;
      if (parts.length > 1) throw fail(ctx, `Check Selection takes only Select and a field, not "${parts[1]}"`);
      if (parts[0]) p.field = fieldRef(ctx, parts[0]);
      break;
    case 'Show/Hide Text Ruler':
    case 'Show/Hide Toolbars':
    case 'Show/Hide Menubar':
      for (const part of parts) {
        const v = part.trim().toLowerCase();
        if (v === 'lock') p.lock = true;
        else if (v === 'show' || v === 'hide' || v === 'toggle') p.showHide = v;
      }
      break;
    case 'Move/Resize Window':
      for (const part of parts) {
        const name = labelled(part, 'Name');
        if (name !== undefined) { p.calculation = name; continue; }
        for (const k of ['height', 'width', 'top', 'left'] as const) {
          const v = labelled(part, k[0].toUpperCase() + k.slice(1));
          if (v !== undefined) (p.bounds ??= {})[k] = v;
        }
      }
      break;
    case 'New Window':
      for (const part of parts) {
        const using = labelled(part, 'Using layout');
        const style = labelled(part, 'Style')?.trim().toLowerCase();
        if (style !== undefined && ['document', 'floating', 'dialog', 'card'].includes(style)) p.windowStyle = style as StepParams['windowStyle'];
        else if (using === undefined) (p.slots ??= {})[128 + Object.keys(p.slots ?? {}).length] = part;
        else if (/^[“"]/.test(using.trim())) {
          p.layout = ref(ctx, ctx.schema.layouts, unquote(using), 'layout');
          p.layoutDestination = 'named';
        } else {
          p.layoutCalculation = using;
          p.layoutDestination = 'name';
        }
      }
      break;
    case 'Relookup Field Contents':
    case 'Find Matching Records':
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (/^(replace|constrain|extend)$/i.test(part)) p.findMode = part.toLowerCase() as StepParams['findMode'];
        else target(part);
      }
      break;
    case 'Execute FileMaker Data API':
      for (const [index, part] of parts.entries()) {
        const into = labelled(part, 'Target');
        if (index === 0 && /^select(?:\s*:\s*(on|off))?$/i.test(part.trim())) { p.selectEntireContents = !/off$/i.test(part.trim()); continue; }
        if (/^select\s*:/i.test(part.trim())) throw fail(ctx, `${name}: Select must come first, as Select, Select: On or Select: Off`);
        if (into !== undefined) target(into.trim());
        else p.calculation = p.calculation === undefined ? part : `${p.calculation} ; ${part}`;
      }
      break;
    case 'Add Account':
    case 'Change Password':
      for (const part of parts) {
        const account = labelled(part, 'Account Name');
        const old = labelled(part, 'Old Password');
        const password = labelled(part, 'New Password') ?? labelled(part, 'Password');
        const set = labelled(part, 'Privilege Set');
        const status = labelled(part, 'Account Status') ?? labelled(part, 'Status');
        const dialog = labelled(part, 'With dialog');
        if (account !== undefined) p.accountName = account;
        else if (old !== undefined) p.oldPassword = old;
        else if (password !== undefined) p.password = password;
        else if (set !== undefined) {
          // Sets made in Tabularius live in the store, not the file's schema: the name is checked when the step runs.
          const known = ctx.schema.privilegeSets.find((x) => x.name.toLowerCase() === unquote(set).toLowerCase());
          p.privilegeSet = known ? { id: known.id, name: known.name } : { id: 0, name: unquote(set) };
        }
        else if (name === 'Add Account' && status !== undefined && /^(active|inactive)$/i.test(unquote(status))) p.accountStatus = unquote(status).toLowerCase() as StepParams['accountStatus'];
        else if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (/^(expire password|user must change password on next login)$/i.test(part)) p.expirePassword = true;
      }
      break;
    case 'Set Error Logging':
      for (const part of parts) {
        const info = labelled(part, 'Custom debug info');
        if (info !== undefined) p.calculation = info;
        else if (/^(on|off)$/i.test(part.trim())) p.on = onOff(part);
        else throw fail(ctx, `Set Error Logging has no option "${part}"`);
      }
      break;
    case 'Import Records': {
      let matches: FieldRef[] = [];
      const formats: Record<string, string> = { 'comma-separated values': 'COMS', 'tab-separated values': 'TABS', 'filemaker pro': 'FMPR', excel: 'XLXE', merge: 'MRGE' };
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        const table = labelled(part, 'Table');
        const source = labelled(part, 'Source');
        const folder = labelled(part, 'Folder');
        const kind = labelled(part, 'File type');
        const enclosed = labelled(part, 'Include enclosed folders');
        const fields = labelled(part, 'Fields');
        const xslt = labelled(part, 'XSLT');
        const worksheet = labelled(part, 'Worksheet');
        const match = labelled(part, 'Match fields');
        const remaining = labelled(part, 'Add remaining data as new records');
        const auto = labelled(part, 'Perform auto-enter options(?: during import)?');
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (table !== undefined) p.tableOccurrence = ref(ctx, ctx.schema.tableOccurrences, table, 'table occurrence');
        else if (source !== undefined) p.filePaths = [unquote(source)];
        else if (folder !== undefined) { p.filePaths = [unquote(folder)]; p.importFolder = { kind: 'text', ...p.importFolder }; }
        else if (kind !== undefined) {
          const k = /^text files?$/i.test(kind.trim()) ? 'text' : /^picture and movie files?$/i.test(kind.trim()) ? 'picture' : undefined;
          if (!k) throw fail(ctx, `Import Records' File type is "Text files" or "Picture and movie files", not "${kind.trim()}"`);
          p.importFolder = { ...p.importFolder, kind: k };
        }
        else if (enclosed !== undefined) p.importFolder = { kind: 'text', ...p.importFolder, enclosed: onOff(enclosed) };
        else if (xslt !== undefined) p.xslt = unquote(xslt);
        else if (worksheet !== undefined) p.worksheet = unquote(worksheet);
        else if (fields !== undefined) p.fieldMapping = splitParts(fields, ',').map((s) => /^don't import$/i.test(s) ? { import: false } : { field: fieldRef(ctx, s), import: true });
        else if (match !== undefined) matches = splitParts(match, ',').map((s) => fieldRef(ctx, s));
        else if (remaining !== undefined) p.addRemaining = onOff(remaining);
        else if (/^add remaining data as new records$/i.test(part)) p.addRemaining = true;
        else if (auto !== undefined) p.performAutoEnter = onOff(auto);
        else if (/^(add|add new records)$/i.test(part)) p.importAction = 'add';
        else if (/^(replace|update existing records(?: in found set)?)$/i.test(part)) p.importAction = 'replace';
        else if (/^(update|update matching records(?: in found set)?)$/i.test(part)) p.importAction = 'update';
        else if (formats[part.toLowerCase()]) p.importFormat = formats[part.toLowerCase()];
        else if (/^(COMS|TABS|MRGE|FMPR|XLXE|XLXS)$/i.test(part)) p.importFormat = part.toUpperCase();
        else if (/^[“"]/.test(part)) p.filePaths = [unquote(part)];
        else if (!/^(Mac Roman|Unicode \(UTF-8\))/i.test(part)) throw fail(ctx, `Import Records doesn't know "${part}"`);
      }
      if (matches.length) {
        if (!p.fieldMapping) throw fail(ctx, 'Match fields need a Fields: mapping in source column order');
        for (const field of matches) {
          const mapping = p.fieldMapping.find((m) => m.field?.tableOccurrence.id === field.tableOccurrence.id && m.field.field.id === field.field.id);
          if (!mapping) throw fail(ctx, `Match field ${field.tableOccurrence.name}::${field.field.name} is not mapped`);
          mapping.match = true;
          mapping.import = false;
        }
      }
      break;
    }
    case 'Save Records as Excel':
    case 'Save Records as JSONL':
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        const folders = labelled(part, 'Create folders');
        const tuning = labelled(part, 'Format for fine-tuning');
        const completion = labelled(part, 'Completion Field');
        const prompt = /^(System|User|Assistant) Prompt\s*:\s*([\s\S]*)$/i.exec(part);
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (folders !== undefined) p.createFolders = onOff(folders);
        else if (tuning !== undefined) p.jsonl = { ...p.jsonl, fineTuning: onOff(tuning) };
        else if (completion !== undefined) p.field = fieldRef(ctx, completion);
        else if (prompt) p.jsonl = { fineTuning: true, ...p.jsonl, [prompt[1].toLowerCase()]: prompt[2] };
        else if (labelled(part, 'Table') !== undefined || /^(records being browsed|current record|restore)$/i.test(part)) continue;
        else p.filePaths = [unquote(part)];
      }
      if (name === 'Save Records as JSONL') p.jsonl ??= { fineTuning: false };
      break;
    case 'Save a Copy as XML':
      for (const part of parts) {
        const dest = labelled(part, 'Destination');
        const folders = labelled(part, 'Create folders');
        if (dest !== undefined) p.filePaths = [unquote(dest)];
        else if (folders !== undefined) p.createFolders = onOff(folders);
        else if (/^(window name\s*:.*|include details for analysis tools)$/i.test(part)) continue;
        else p.filePaths = [unquote(part)];
      }
      break;
    case 'Open PDF':
    case 'Append PDF':
      for (const part of parts) {
        const source = labelled(part, 'Source');
        const password = labelled(part, 'Password');
        if (/^from\s*:/i.test(part)) continue;
        if (source !== undefined) target(source.trim());
        else if (password !== undefined) p.password = password;
        else p.filePaths = [unquote(labelled(part, 'Source file') ?? part)];
      }
      break;
    case 'Close PDF':
      for (const part of parts) {
        const into = labelled(part, 'Target');
        const named = labelled(part, 'Filename');
        const folders = labelled(part, 'Create folders');
        if (/^save to\s*:/i.test(part)) continue;
        if (into !== undefined) target(into.trim());
        else if (named !== undefined) p.newName = named;
        else if (folders !== undefined) p.createFolders = onOff(folders);
        else p.filePaths = [unquote(part)];
      }
      break;
    case 'Configure Persistent Data':
      for (const part of parts) {
        const entry = labelled(part, 'Name');
        const instance = labelled(part, 'Instance ID');
        const value = labelled(part, 'Value');
        if (entry !== undefined) p.text = entry.trim();
        else if (instance !== undefined) p.calculation = instance;
        else if (value !== undefined) p.value = value;
        else if (/^delete entry$/i.test(part)) p.deleteEntry = true;
        else throw fail(ctx, `"${part}" should read Name:, Instance ID:, Value: or Delete Entry`);
      }
      break;
    case 'Go to List of Records':
      for (const part of parts) {
        const list = labelled(part, 'List of record IDs');
        const using = labelled(part, 'Using layout');
        if (list !== undefined) p.calculation = list;
        else if (using !== undefined) {
          if (/^<current layout>$/i.test(using.trim())) continue;
          p.layout = ref(ctx, ctx.schema.layouts, using, 'layout');
        } else if (/^new window$/i.test(part)) p.newWindow = true;
        else if (/^animation\s*:/i.test(part)) continue;
        else p.calculation = part;
      }
      break;
    case 'Insert Picture':
    case 'Insert PDF':
    case 'Insert Audio/Video':
      for (const part of parts) {
        if (/^(reference|store only a reference to the file)$/i.test(part)) continue;
        if (/^\$|::/.test(part) && !/^[“"]/.test(part)) target(part);
        else p.filePaths = [unquote(part)];
      }
      break;
    case 'Go to Object':
      // The object's name, a formula: Go to Object [ "Name" ] (the step reads it as objectName, not a calculation).
      for (const part of parts) {
        const name = labelled(part, 'Object Name');
        const repetition = labelled(part, 'Repetition');
        if (name !== undefined) p.objectName = name;
        else if (repetition !== undefined) p.repetitionCalculation = repetition;
        else if (p.objectName === undefined) p.objectName = part;
        else throw fail(ctx, `Go to Object takes Object Name and Repetition, not "${part}"`);
      }
      break;
    case 'Refresh Window':
      for (const part of parts) {
        if (/^Flush cached join results$/i.test(part)) p.flushJoinResults = true;
        else if (/^Flush cached external data$/i.test(part)) p.flushExternalData = true;
        else throw fail(ctx, `Refresh Window has no option "${part}"`);
      }
      break;
    case 'Refresh Portal':
    case 'Refresh Object':
      for (const [i, part] of parts.entries()) {
        const object = labelled(part, 'Object Name');
        const repetition = labelled(part, 'Repetition');
        if (object !== undefined) p.objectName = object;
        else if (repetition !== undefined && name === 'Refresh Object') p.objectRepetition = repetition;
        else if (i === 0) p.objectName = part;
        else throw fail(ctx, `${name} has no option "${part}"`);
      }
      break;
    case 'Set Web Viewer':
      for (const part of parts) {
        const object = labelled(part, 'Object Name');
        const url = labelled(part, 'URL');
        const action = WEB_VIEWER_ACTIONS.find((a) => a.toLowerCase() === part.toLowerCase());
        if (object !== undefined) p.objectName = object;
        else if (url !== undefined) { p.viewerAction = 'Go to URL'; p.viewerUrl = url; }
        else if (action) p.viewerAction = action;
        else throw fail(ctx, `Set Web Viewer has no option "${part}"`);
      }
      break;
    case 'Perform JavaScript in Web Viewer':
      for (const part of parts) {
        const object = labelled(part, 'Object Name');
        const fn = labelled(part, 'Function Name');
        const args = labelled(part, 'Parameters');
        if (object !== undefined) p.objectName = object;
        else if (fn !== undefined) p.functionName = fn;
        else if (args !== undefined) p.jsParameters = splitParts(args, ',').filter(Boolean);
        else throw fail(ctx, `Perform JavaScript in Web Viewer takes Object Name, Function Name and Parameters, not "${part}"`);
      }
      break;
    case 'Open Transaction':
      for (const part of parts) {
        if (/^skip data entry validation$/i.test(part)) p.skipValidation = true;
        else if (/^skip auto-enter options$/i.test(part)) p.skipAutoEnter = true;
        else if (/^override ess locking conflicts$/i.test(part)) continue; // no external SQL sources here, so nothing to override
        else throw fail(ctx, `Open Transaction takes Skip auto-enter options and Skip data entry validation, not "${part}"`);
      }
      break;
    case 'Commit Records/Requests':
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (/^skip data entry validation$/i.test(part)) p.skipValidation = true;
        else if (/^override ess locking conflicts$/i.test(part)) continue; // no external SQL sources here, so nothing to override
        else throw fail(ctx, `Commit Records/Requests takes With dialog and Skip data entry validation, not "${part}"`);
      }
      break;
    default:
      for (const part of parts) {
        const dialog = labelled(part, 'With dialog');
        if (dialog !== undefined) p.noDialog = !onOff(dialog);
        else if (p.calculation === undefined) p.calculation = part;
        else (p.slots ??= {})[128 + Object.keys(p.slots ?? {}).length] = part;
      }
  }
  return p;
}

/** One step's text (without indentation) as scriptText writes it, for matching unchanged lines. */
function keyOf(text: string): string {
  return text.split('\n').map((l) => l.trim()).join('\n');
}

/**
 * Read a script's text into steps. `current` are the script's steps now:
 * lines that match one of them exactly keep it.
 */
export function parseScriptText(text: string, schema: Schema, current: ScriptStep[] = []): StepSpec[] {
  const reuse = new Map<string, ScriptStep[]>();
  for (const s of current) {
    const line = (s.enabled ? '' : '// ') + displayedStepLine(s);
    const k = keyOf(line);
    reuse.set(k, [...(reuse.get(k) ?? []), s]);
  }
  const external = new Map<string, { id: number; name: string; file: Ref }>();
  for (const s of current) {
    const sc = s.params?.script;
    if (sc?.file) external.set(`${sc.file.name}\n${sc.name}`.toLowerCase(), { id: sc.id, name: sc.name, file: sc.file });
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Every line is a step: blank lines are empty comments, as FileMaker shows them.
  if (lines.length === 1 && !lines[0].trim()) lines.pop();
  const out: StepSpec[] = [];
  const keptSteps = new Set<StepSpec>();
  const tabs = (l: string) => /^\t*/.exec(l)![0].length;
  for (let i = 0; i < lines.length; i++) {
    const startLine = i + 1;
    const indent = tabs(lines[i]);
    let chunk = lines[i].replace(/^\s+/, '');
    if (/^(\/\/\s?)?#/.test(chunk)) {
      // A comment runs on over the lines indented deeper than it (scriptText writes long comments that way).
      while (i + 1 < lines.length && tabs(lines[i + 1]) > indent) chunk += '\n' + lines[++i].trim();
    } else {
      const brackets = { depth: 0, quote: null as string | null };
      advanceBrackets(brackets, chunk);
      while (brackets.depth > 0 && i + 1 < lines.length) {
        const next = lines[++i].trim();
        advanceBrackets(brackets, next);
        chunk += '\n' + next;
      }
    }
    const ctx: Ctx = { schema, line: startLine, external };
    const kept = reuse.get(keyOf(chunk))?.shift();
    if (kept) {
      out.push(kept);
      keptSteps.add(kept);
      continue;
    }
    let enabled = true;
    if (chunk.startsWith('//')) {
      enabled = false;
      chunk = chunk.replace(/^\/\/\s?/, '');
    }
    if (!chunk.trim() || chunk.startsWith('#')) {
      const comment = chunk.replace(/^#\s?/, '');
      out.push({ stepId: COMMENT, enabled, ...(comment ? { text: comment } : {}) });
      continue;
    }
    if (openBrackets(chunk) > 0) throw fail(ctx, 'The step\'s [ is never closed with ]');
    const m = /^([^[]+?)\s*(?:\[([\s\S]*)\])?\s*$/.exec(chunk);
    if (!m) throw fail(ctx, `Can't read "${chunk}"`);
    const stepId = scriptStepId(m[1]);
    if (stepId === undefined) throw fail(ctx, `Unknown script step "${m[1].trim()}"`);
    const name = scriptStepName(stepId);
    const parts = m[2] !== undefined ? splitParts(m[2]) : [];
    const authoredParts = [...parts];
    let p = params(ctx, name, parts);
    if (authoredParts.length && p) {
      // Authored options must survive the same printer used by design export.
      // Parse the printed parameter list directly to avoid recursing through this check.
      // Literal API keys are masked in display text, so validate that shape
      // using a variable formula while retaining the authored value in p.
      const checked = p.ai?.apiKey?.startsWith('"')
        ? { ...p, ai: { ...p.ai, apiKey: '$scriptKey' } } : p;
      const printed = stepLine(name, checked);
      const bracket = /^.*?\s\[\s*([\s\S]*?)\s\]$/.exec(printed);
      const roundTrip = bracket ? params(ctx, name, splitParts(bracket[1])) : undefined;
      const original = { ...checked };
      const restored = { ...roundTrip };
      // These false values can be omitted when the step's default means the same thing.
      for (const key of ['noDialog', 'exitAfterLast'] as const) {
        if (original[key] === false) delete original[key];
        if (restored[key] === false) delete restored[key];
      }
      // These two printers make the legacy implicit replacement choice explicit.
      if (['Insert from URL', 'Execute FileMaker Data API'].includes(name)
        && original.selectEntireContents === undefined && restored.selectEntireContents === true) {
        delete restored.selectEntireContents;
      }
      const printedParts = bracket ? splitParts(bracket[1]) : [];
      const sameEmptyOptions = authoredParts.join(';').toLowerCase() === printedParts.join(';').toLowerCase();
      if (Object.keys(original).some((key) => !isDeepStrictEqual(original[key as keyof StepParams], restored[key as keyof StepParams]))
        || (!Object.keys(original).length && !sameEmptyOptions && !(name === 'Pause/Resume Script' && /^indefinitely$/i.test(authoredParts[0] ?? '')))) {
        throw fail(ctx, `${name} has an option that script text cannot preserve`);
      }
    }
    out.push({ stepId, enabled, ...(p ? { params: p } : {}) });
  }
  return keepUndecodedImportMarks(current, out, (step) => keptSteps.has(step));
}

const UNDECODED_IMPORT = (step: { stepId?: number; name?: string; params?: { undecodedOptions?: string[] } }) =>
  step.params?.undecodedOptions?.includes('Import mode') === true && (step.stepId === 35 || step.name === 'Import Records');

/**
 * A binary import whose "Mode: Undecoded" diagnostic was removed without choosing a mode
 * stays marked, so it refuses instead of guessing Add. The mark follows the step, not its
 * position: each marked step that no kept line accounts for passes its mark to the next
 * new Import Records step that has no mode, so inserting steps above never moves it, and
 * a new authored import (which has a mode, or the implicit Add) is marked only in place of
 * a diagnostic that really went missing.
 */
export function keepUndecodedImportMarks<T extends { stepId?: number; name?: string; params?: any }>(current: ScriptStep[], steps: T[], isKept: (step: T) => boolean): T[] {
  let lost = current.filter(UNDECODED_IMPORT).length - steps.filter(UNDECODED_IMPORT).length;
  if (lost <= 0) return steps;
  return steps.map((step) => {
    if (lost <= 0 || isKept(step) || !(step.stepId === 35 || step.name === 'Import Records') || step.params?.importAction || step.params?.undecodedOptions) return step;
    lost--;
    return { ...step, params: { ...step.params, undecodedOptions: ['Import mode'] } };
  });
}
