// Checks a script an AI (or a person) drafted, written as FileMaker's script
// workspace shows steps ("Set Field [ Invoices::Status ; "Paid" ]"), against a
// hosted solution: step names, If/Loop structure, the fields, layouts and
// scripts it names, every formula, and $variables read before they are set.
// Nothing runs; nothing is written.

import { SCRIPT_STEP_NAMES, scriptStepName } from '../../fmp12/src/index.ts';
import { lintScript, parseScriptText as parseStoreScriptText, type LintStep, type ScriptLintIssue, type Store } from '../../store/src/index.ts';
import type { ScriptStep } from '../../fmp12/src/index.ts';
import { checkFormula, didYouMean } from './insight.ts';

export interface ScriptProblem {
  /** 1-based line in the text where the step starts. */
  line: number;
  step: string;
  message: string;
}

export interface ScriptCheck {
  ok: boolean;
  steps: number;
  /** Mistakes FileMaker would reject or that would fail when run. */
  problems: ScriptProblem[];
  /** Things that run but deserve a look: unset variables, steps that reach outside. */
  warnings: ScriptProblem[];
  layouts: string[];
  scripts: string[];
  fields: string[];
}

interface Step {
  line: number;
  name: string;
  params: string[];
  enabled: boolean;
}

const STEP_NAMES = new Map(SCRIPT_STEP_NAMES.map((n) => [n.toLowerCase(), n]));
const OUTBOUND = /^(Send Mail|Send Event|Insert from URL|Open URL|Perform AppleScript|Perform JavaScript in Web Viewer|Perform Script on Server|Perform Script on Server with Callback|Dial Phone|Send DDE Execute|Execute SQL)$/;

/** Splits on `sep` outside quotes, parentheses and brackets. */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote || (quote === '“' && c === '”')) quote = undefined;
      continue;
    }
    if (c === '"' || c === '“') quote = c;
    else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(start, i).trim());
      start = i + sep.length;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

/**
 * Bracket depth and open quote at the end of a text, to know whether a step continues on the next line. The text is
 * fed in pieces (the first line, then each further line with its leading line break) and each piece is scanned once,
 * so a step of many lines costs the length of its text, not that times its lines.
 */
export function bracketScanner(): (piece: string) => boolean {
  let depth = 0;
  let quote: string | undefined;
  let skip = 0; // a backslash at the end of a piece skips the first character of the next
  return (piece) => {
    let closes = false;
    let i = skip;
    skip = 0;
    for (; i < piece.length; i++) {
      const c = piece[i];
      if (quote) {
        if (c === '\\' && quote === '"') i++;
        else if (c === quote || (quote === '“' && c === '”')) quote = undefined;
        continue;
      }
      if (c === '"' || c === '“') quote = c;
      else if (c === '/' && piece[i + 1] === '/') {
        const nl = piece.indexOf('\n', i);
        if (nl >= 0) {
          i = nl;
          continue;
        }
        // "Exit Loop If [ True // done ]": the step's closing bracket ends the comment. (This holds only while the
        // piece is the last one; a later piece starts with a line break, which ends the comment anyway.)
        let close = piece.length - 1;
        while (close > i && piece[close] !== ']') close--;
        if (close > i && !piece.slice(close + 1).trim()) closes = true;
        i = piece.length;
        break;
      } else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
    }
    skip = i - piece.length;
    return depth - (closes ? 1 : 0) <= 0 && !quote;
  };
}

/** Script text -> steps. Lines that continue a formula are joined to their step. */
export function parseScriptText(text: string): Step[] {
  const steps: Step[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const indent = (l: string) => /^\s*/.exec(l)![0].length;
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i].trim();
    if (!raw) continue;
    const line = i + 1;
    if (raw.startsWith('#')) {
      // A comment's later lines are indented under it.
      const own = indent(lines[i]);
      while (i + 1 < lines.length && indent(lines[i + 1]) > own) raw += '\n' + lines[++i].trim();
      steps.push({ line, name: '# (comment)', params: [raw.slice(1).trim()], enabled: true });
      continue;
    }
    let enabled = true;
    if (raw.startsWith('//')) {
      // A disabled step; a disabled comment or blank line needs no checking.
      enabled = false;
      raw = raw.slice(2).trim();
      if (!raw || raw.startsWith('#')) continue;
    }
    const scan = bracketScanner();
    let done = scan(raw);
    while (!done && i + 1 < lines.length) {
      const more = '\n' + lines[++i].trimStart();
      raw += more;
      done = scan(more);
    }
    // `Name [ parameters ]`, split at the first bracket (a pattern for this backtracks cubically on a long run of spaces).
    const open = raw.indexOf('[');
    const closed = open > 0 && raw.trimEnd().endsWith(']');
    const name = (closed ? raw.slice(0, open) : raw).trim();
    const inner = closed ? raw.trimEnd().slice(open + 1, -1).trim() : '';
    steps.push({ line, name, params: inner ? splitTop(inner, ';') : [], enabled });
  }
  return steps;
}

const unquote = (s: string) => {
  const m = /^[“"](.*)[”"]$/s.exec(s.trim());
  return m ? m[1] : undefined;
};
const labeled = (params: string[], label: string) => {
  const p = params.find((x) => x.toLowerCase().startsWith(label.toLowerCase() + ':'));
  return p?.slice(label.length + 1).trim();
};

/**
 * Checks script text against a solution. `layout` is where the script starts
 * (the context for its formulas until a Go to Layout); default the first layout.
 */
export function checkScript(store: Store, text: string, layout?: string): ScriptCheck {
  const s = store.schema;
  const steps = parseScriptText(text);
  const problems: ScriptProblem[] = [];
  const warnings: ScriptProblem[] = [];
  const layouts = new Set<string>();
  const scripts = new Set<string>();
  const fields = new Set<string>();
  const setVars = new Set<string>();
  const warnedVars = new Set<string>();
  const layoutNames = s.layouts.map((l) => l.name);
  let current: string | undefined = layout ?? layoutNames[0];
  if (layout && !layoutNames.includes(layout)) problems.push({ line: 0, step: '', message: `There is no layout named "${layout}"${didYouMean(layout, layoutNames)}` });
  const contextId = () => {
    try {
      return current ? store.calc.occurrence(store.layout(current).occurrence)?.id : undefined;
    } catch {
      return undefined;
    }
  };

  const formula = (st: Step, f: string | undefined) => {
    if (f === undefined || f === '') return;
    const c = checkFormula(store, contextId(), f);
    for (const m of c.problems) problems.push({ line: st.line, step: st.name, message: m });
    for (const f2 of c.fields) if (f2.found) fields.add(f2.name);
    for (const v of c.variables) {
      if (v.startsWith('$$') || setVars.has(v.toLowerCase()) || warnedVars.has(v.toLowerCase())) continue;
      warnedVars.add(v.toLowerCase());
      warnings.push({ line: st.line, step: st.name, message: `${v} is read before any Set Variable sets it in this script` });
    }
  };
  const field = (st: Step, ref: string | undefined) => {
    if (!ref) return;
    const m = /^(.+?)::(.+?)(?:\[(.+)\])?$/s.exec(ref.trim());
    if (!m) {
      problems.push({ line: st.line, step: st.name, message: `"${ref}" is not a field reference (write Occurrence::Field)` });
      return;
    }
    const [, toName, fieldName, rep] = m;
    const to = s.tableOccurrences.find((t) => t.name.toLowerCase() === toName.trim().toLowerCase());
    if (!to) {
      problems.push({ line: st.line, step: st.name, message: `There is no table occurrence named "${toName}"${didYouMean(toName, s.tableOccurrences.map((t) => t.name))}` });
      return;
    }
    const table = store.calc.occurrenceTable(to.id)?.table;
    const f = table?.fields.find((x) => x.name.toLowerCase() === fieldName.trim().toLowerCase());
    if (table && !f) {
      problems.push({ line: st.line, step: st.name, message: `"${to.name}" has no field named "${fieldName}"${didYouMean(fieldName, table.fields.map((x) => x.name))}` });
      return;
    }
    if (f?.kind === 'calculation' || f?.kind === 'summary') {
      problems.push({ line: st.line, step: st.name, message: `${to.name}::${f.name} is a ${f.kind} field and cannot be set` });
    }
    fields.add(`${to.name}::${f?.name ?? fieldName}`);
    if (rep) formula(st, rep);
  };

  const blocks: { kind: 'If' | 'Loop'; line: number; sawElse: boolean }[] = [];
  for (const st of steps) {
    if (st.name === '# (comment)') continue;
    const known = STEP_NAMES.get(st.name.toLowerCase());
    if (!known) {
      problems.push({ line: st.line, step: st.name, message: `There is no script step named "${st.name}"${didYouMean(st.name, SCRIPT_STEP_NAMES as string[])}` });
      continue;
    }
    st.name = known;
    if (!st.enabled) continue;
    const p = st.params;
    if (OUTBOUND.test(known)) warnings.push({ line: st.line, step: known, message: `${known} reaches outside the solution; it must not run without the owner's say-so` });
    switch (known) {
      case 'If':
        blocks.push({ kind: 'If', line: st.line, sawElse: false });
        formula(st, p[0]);
        if (!p[0]) problems.push({ line: st.line, step: known, message: 'If needs a condition' });
        break;
      case 'Else If':
      case 'Else': {
        const b = blocks.at(-1);
        if (b?.kind !== 'If') problems.push({ line: st.line, step: known, message: `${known} without an If` });
        else if (b.sawElse) problems.push({ line: st.line, step: known, message: `${known} after Else` });
        else if (known === 'Else') b.sawElse = true;
        if (known === 'Else If') formula(st, p[0]);
        break;
      }
      case 'End If':
      case 'End Loop': {
        const want = known === 'End If' ? 'If' : 'Loop';
        const b = blocks.at(-1);
        if (b?.kind !== want) problems.push({ line: st.line, step: known, message: `${known} without a ${want}${b ? ` (the ${b.kind} on line ${b.line} is still open)` : ''}` });
        else blocks.pop();
        break;
      }
      case 'Loop':
        blocks.push({ kind: 'Loop', line: st.line, sawElse: false });
        break;
      case 'Exit Loop If':
        if (!blocks.some((b) => b.kind === 'Loop')) problems.push({ line: st.line, step: known, message: 'Exit Loop If outside a Loop' });
        formula(st, p[0]);
        break;
      case 'Set Variable': {
        const name = p[0]?.replace(/\[.*$/s, '').trim() ?? '';
        if (!/^\$\$?[^\s$]/.test(name)) problems.push({ line: st.line, step: known, message: `Set Variable needs a $local or $$global name, not "${p[0] ?? ''}"` });
        const rep = /\[(.*)\]$/s.exec(p[0] ?? '')?.[1];
        if (rep) formula(st, rep);
        formula(st, labeled(p, 'Value'));
        setVars.add(name.toLowerCase());
        break;
      }
      case 'Set Field':
      case 'Insert Calculated Result':
      case 'Replace Field Contents':
        if (p.length >= 2) {
          if (/^\$/.test(p[0]) && known === 'Insert Calculated Result') setVars.add(p[0].toLowerCase());
          else field(st, p[0]);
          formula(st, p.slice(1).join(' ; ').replace(/^Replace with calculation:\s*/i, ''));
        } else formula(st, p[0]);
        break;
      case 'Set Field By Name':
        formula(st, p[0]);
        formula(st, p[1]);
        break;
      case 'Go to Field':
        if (p[0]) field(st, p[0].replace(/^Select\/perform;\s*/i, ''));
        break;
      case 'Exit Script':
        formula(st, labeled(p, 'Result') ?? (p[0] && !p[0].includes(':') ? p[0] : undefined));
        break;
      case 'Perform Script':
      case 'Perform Script on Server': {
        const target = p[0] ?? '';
        if (/^From file:/i.test(target)) break;
        const name = unquote(target);
        if (name === undefined) {
          if (/^By name:/i.test(target)) formula(st, target.slice(8));
          else problems.push({ line: st.line, step: known, message: 'Perform Script needs a script name in quotes' });
        } else if (!s.scripts.some((x) => x.name === name)) {
          problems.push({ line: st.line, step: known, message: `There is no script named "${name}"${didYouMean(name, s.scripts.map((x) => x.name))}` });
        } else scripts.add(name);
        formula(st, labeled(p, 'Parameter'));
        break;
      }
      case 'Go to Layout': {
        const target = p[0] ?? '';
        const name = unquote(target);
        if (name !== undefined) {
          if (!layoutNames.includes(name)) problems.push({ line: st.line, step: known, message: `There is no layout named "${name}"${didYouMean(name, layoutNames)}` });
          else {
            layouts.add(name);
            current = name;
          }
        } else if (/^Layout (Name|Number):/i.test(target)) {
          formula(st, target.replace(/^Layout (Name|Number):/i, ''));
          current = undefined;
        } else if (!/^original layout$/i.test(target)) {
          problems.push({ line: st.line, step: known, message: 'Go to Layout needs a layout name in quotes, original layout, or Layout Name: formula' });
        }
        break;
      }
      case 'Go to Record/Request/Page': {
        const where = p[0] ?? '';
        if (/^With dialog:/i.test(where)) formula(st, p[1]);
        else if (!/^(First|Last|Next|Previous)$/i.test(where)) problems.push({ line: st.line, step: known, message: 'Go to Record/Request/Page goes to First, Last, Next, Previous, or With dialog: Off ; formula' });
        break;
      }
      case 'Go to Related Record': {
        const from = unquote(labeled(p, 'From table') ?? '');
        if (from !== undefined && !s.tableOccurrences.some((t) => t.name === from)) {
          problems.push({ line: st.line, step: known, message: `There is no table occurrence named "${from}"${didYouMean(from, s.tableOccurrences.map((t) => t.name))}` });
        }
        const using = unquote(labeled(p, 'Using layout') ?? '');
        if (using !== undefined) {
          if (!layoutNames.includes(using)) problems.push({ line: st.line, step: known, message: `There is no layout named "${using}"${didYouMean(using, layoutNames)}` });
          else {
            layouts.add(using);
            current = using;
          }
        }
        break;
      }
      case 'Show Custom Dialog':
        formula(st, p[0]);
        formula(st, p[1]);
        break;
      case 'Set Error Capture':
      case 'Allow User Abort':
      case 'Allow Formatting Bar':
      case 'Set Layout Object Animation':
        if (p[0] && !/^(On|Off)$/i.test(p[0])) problems.push({ line: st.line, step: known, message: `${known} is On or Off` });
        break;
      case 'Enable Touch Keyboard':
        if (p[0] && !/^(On|Off|Toggle)$/i.test(p[0])) problems.push({ line: st.line, step: known, message: `${known} is On, Off or Toggle` });
        break;
      case 'Show/Hide Text Ruler':
        if (p[0] && !/^(Show|Hide|Toggle)$/i.test(p[0])) problems.push({ line: st.line, step: known, message: `${known} is Show, Hide or Toggle` });
        break;
      case 'Omit Multiple Records':
      case 'Pause/Resume Script':
        if (p[0] && !/:/.test(p[0])) formula(st, p[0]);
        break;
    }
  }
  for (const b of blocks) problems.push({ line: b.line, step: b.kind, message: `${b.kind} on line ${b.line} has no End ${b.kind}` });
  problems.sort((a, b) => a.line - b.line);
  // Loops that never end and guards that catch nothing (store/script-lint.ts), once the steps read cleanly.
  if (!problems.length) {
    for (const i of lintScriptText(store, text, steps)) warnings.push({ line: i.line, step: i.stepName, message: `${i.message} ${i.fix}` });
  }
  return {
    ok: problems.length === 0,
    steps: steps.length,
    problems,
    warnings,
    layouts: [...layouts],
    scripts: [...scripts],
    fields: [...fields],
  };
}

/**
 * The script linter on a script's text, with each finding's line in that
 * text (blank lines and all). A text the design parser can't read gives none:
 * saving it says which line is wrong.
 */
export function lintScriptText(store: Store, text: string, read: Step[] = parseScriptText(text), current?: ScriptStep[]): (ScriptLintIssue & { stepName: string })[] {
  let steps: LintStep[];
  try {
    steps = parseStoreScriptText(text, store.schema, current);
  } catch {
    return [];
  }
  return lintScript({ steps }, store.schema).map((i) => ({
    ...i,
    line: steps.length === read.length ? read[i.step].line : i.line,
    stepName: steps[i.step].name ?? scriptStepName(steps[i.step].stepId ?? 0),
  }));
}
