// Generate the script-step reference from the registry and the support notes.
// Run `node scripts/script-step-pages.ts` to write, or pass --check to verify.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPT_STEP_NAMES, scriptStepId } from '../packages/fmp12/src/script-steps.ts';
import { ERROR_3_STEPS, ERROR_3_UNLESS_CONFIGURED } from '../packages/scripts/src/unavailable-steps.ts';

const root = join(import.meta.dirname, '..');
const sourcePath = join(import.meta.dirname, 'script-steps-support-source.md');
const supportPath = join(root, 'docs/script-steps-support.md');
const output = join(root, 'docs/reference/script-steps');
const source = readFileSync(sourcePath, 'utf8');
const parserSource = readFileSync(join(root, 'packages/store/src/script-text.ts'), 'utf8');
const bareOutcomes = new Map((JSON.parse(readFileSync(join(import.meta.dirname, 'script-step-bare-outcomes.json'), 'utf8')) as
  { id: number; error: number; count: number }[]).map((row) => [row.id, row]));

export type StepStatus = 'works' | 'partly' | 'error 3' | 'does nothing';
export interface StepPage {
  id: number;
  name: string;
  slug: string;
  group: string;
  status: StepStatus;
  note?: string;
  options: string;
  privileges: string;
  codes: number[];
  example: string;
  setup: string;
  expected: string;
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const table = (heading: string): Map<string, string> => {
  const begin = source.indexOf(`\n## ${heading}\n`);
  if (begin < 0) throw new Error(`missing support section: ${heading}`);
  const end = source.indexOf('\n## ', begin + 4);
  const rows = source.slice(begin, end < 0 ? undefined : end).split('\n');
  const result = new Map<string, string>();
  for (const row of rows) {
    const match = /^\| ([^|]+) \| (.+?) \|(?:.*)?$/.exec(row);
    if (!match || match[1] === 'Script step') continue;
    const cell = match[1].replace(/\([^)]*\)/g, '');
    for (const raw of cell.split(';').map((s) => s.trim())) {
      const name = SCRIPT_STEP_NAMES.includes(raw) ? raw : raw.replace(/ via .*/, '');
      if (name && SCRIPT_STEP_NAMES.includes(name)) result.set(name, match[2].trim());
    }
  }
  return result;
};

const unsupported = table('Not supported (error 3)');
const inert = table('Does nothing');
const partial = table('Partly supported');

const OPTION_NOTES: Record<string, string> = {
  'Go to Record/Request/Page': 'First, Last, Previous, Next or a calculated record number; Next and Previous can exit after the last record.',
  'Go to Layout': 'Choose a named layout, the original layout, or a layout name calculated at runtime.',
  'Set Field': 'Choose a field and a calculation for its new value.',
  'Set Variable': 'Choose a $ variable, a value calculation and, optionally, a repetition.',
  'Exit Script': 'Supply an optional text result calculation.',
  'If': 'Supply a Boolean calculation; Else If and Else choose other branches.',
  'Loop': 'Use Exit Loop If with a Boolean calculation to stop repeating.',
  'Perform Script': 'Choose a script and an optional parameter calculation.',
  'Perform Script on Server': 'Choose a script, an optional parameter and whether to wait for completion.',
  'Set Error Capture': 'On or Off.',
  'Allow User Abort': 'On or Off.',
  'Insert from URL': 'Choose a URL calculation, a field or variable target, and optional cURL options. Network access is required.',
  'Send Mail': 'Choose E-mail Client or SMTP Server and the message fields. Mail delivery must be enabled by the administrator.',
  'Import Records': 'Choose a source, import mode and field mapping. Binary import modes with undecoded options return error 3.',
  'Export Records': 'Choose a destination, output format and field order.',
  'Save Records as PDF': 'Choose a destination, records and append or create options.',
  'Insert Text': 'Choose a target field or variable, text, and Select entire contents when replacing.',
};
const BEHAVIOR: Record<string, string> = {
  'Perform Script': 'Runs a named script in the current file, passing the calculated parameter and checking access to the target script.',
  'Perform Script on Server': 'Starts the named script on the server and optionally waits for its result.',
  'Go to Layout': 'Changes the current window’s layout after resolving the named or calculated destination.',
  'Go to Record/Request/Page': 'Moves the current record within the found set; a missing position reports error 101.',
  'New Record/Request': 'Creates a record in the current layout’s table and makes it current.',
  'Duplicate Record/Request': 'Copies the current record into a new record in the same table.',
  'Delete Record/Request': 'Deletes the current record when the account may delete it.',
  'Delete All Records': 'Deletes the records in the current found set when the account may delete them.',
  'Set Field': 'Evaluates the value calculation and writes it to the named field of the current record.',
  'Set Variable': 'Evaluates the value calculation and stores it in a local or session variable.',
  'Commit Records/Requests': 'Saves pending edits to the current record, applying validation and record triggers.',
  'Revert Record/Request': 'Discards uncommitted edits to the current record.',
  'Show All Records': 'Replaces the current found set with all records visible to the account.',
  'Perform Find': 'Evaluates the current find requests and replaces the found set with matching records.',
  'Sort Records': 'Orders the current found set using the step’s stored or authored sort fields.',
  'Import Records': 'Reads a local supported source and adds, updates or replaces records using the supplied mapping.',
  'Export Records': 'Writes the chosen local records and fields in a supported format to the documents folder.',
  'Save Records as PDF': 'Renders the selected records to a PDF in the documents folder.',
  'If': 'Evaluates the condition and runs only the matching branch.',
  'Loop': 'Repeats its body until an Exit Loop If condition or another exit stops it.',
  'Exit Script': 'Ends the script and returns the evaluated result to its caller.',
  'Halt Script': 'Stops the active script run.',
  'Set Error Capture': 'Controls whether script errors ask a web-client user to continue or cancel.',
  'Allow User Abort': 'Controls whether a web-client user may stop the active script.',
};
const SELECT_STEPS = new Set(['Check Selection', 'Clear', 'Copy', 'Cut', 'Execute FileMaker Data API',
  'Insert Calculated Result', 'Insert Current Date', 'Insert Current Time', 'Insert Current User Name',
  'Insert from Index', 'Insert from Last Visited', 'Insert from URL', 'Insert Text', 'Paste']);

const FULL_ACCESS = new Set(['Save a Copy as XML', 'Save a Copy as', 'Set Next Serial Value',
  'Set Error Logging', 'Configure Persistent Data', 'Add Account', 'Delete Account',
  'Reset Account Password', 'Enable Account', 'Install Plug-In File']);
const EXPORT = new Set(['Export Records', 'Export Field Contents', 'Save Records as Snapshot Link']);
const PRINT = new Set(['Print', 'Save Records as PDF']);
const ERRORS: Record<string, number[]> = {
  'Go to Record/Request/Page': [101], 'Go to Layout': [105], 'Perform Find': [400, 401],
  'Constrain Found Set': [401], 'Set Field': [101, 201], 'Set Field By Name': [102],
  'Go to Related Record': [101, 401], 'Go to Field': [102], 'Go to Object': [116],
  'Select Window': [112], 'Close Window': [112], 'Insert from URL': [1626, 1630, 1631],
  'Refresh Portal': [116],
  'Send Mail': [1506], 'Read from Data File': [10, 802], 'Open Data File': [2, 802],
  'Import Records': [700, 715, 718, 719, 731, 954], 'Re-Login': [1, 212],
  'Delete Account': [213], 'Enable Account': [213], 'Reset Account Password': [213],
  'Perform SQL Query by Natural Language': [1200], 'Configure RAG Account': [877],
  'Perform RAG Action': [5, 100, 812, 877, 887],
};
const FILE_STEPS = /(?:File|Records as PDF|Snapshot Link)/;

/** Labels are read from the actual script-text parser so the option list follows accepted syntax. */
function parsedOptionLabels(name: string): string[] {
  const start = parserSource.indexOf(`case '${name}':`);
  if (start < 0) return [];
  const end = parserSource.indexOf('break;', start);
  if (end < 0) return [];
  const body = parserSource.slice(start, end);
  if ([...body.matchAll(/\bcase '[^']+':/g)].length > 1) return [];
  return [...new Set([...body.matchAll(/labelled\([^,]+, '([^']+)'\)/g)].map((m) => m[1]))]
    .filter((label) => !label.includes('?:'));
}

function group(name: string): string {
  if (/AI|RAG|Embedding|Semantic|Natural Language|Model|Prompt/.test(name)) return 'AI and models';
  if (/Account|Password|Privilege|Re-Login|Error Logging|Persistent Data/.test(name)) return 'Accounts and security';
  if (/File|Import|Export|PDF|Snapshot|Folder/.test(name)) return 'Files and output';
  if (/Field|Variable|Text|Selection|Replace|Copy|Cut|Paste/.test(name)) return 'Fields and values';
  if (/Find|Record|Sort|Found Set|Portal|Transaction/.test(name)) return 'Records and finds';
  if (/Window|Layout|Object|View|Dialog|Toolbar|Zoom|Scroll/.test(name)) return 'Layouts and windows';
  if (/Script|Loop|^If$|^Else|^End If$|Error Capture|Abort|^#/.test(name)) return 'Script flow';
  return 'Other steps';
}

const safeExamples: Record<string, [string, string]> = {
  'New Record/Request': ['New Record/Request\nSet Field [ Examples::Name ; "Mira" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Get ( FoundCount ) ]',
    'One local Examples record has `Name = Mira`; the script result is `1`.'],
  'Set Field': ['New Record/Request\nSet Field [ Examples::Name ; "Mira" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Examples::Name ]',
    'One local Examples record has `Name = Mira`; the script result is `Mira`.'],
  'Commit Records/Requests': ['New Record/Request\nSet Field [ Examples::Name ; "Mira" ]\nCommit Records/Requests [ With dialog: Off ]\nExit Script [ Text Result: Examples::Name ]',
    'The edit is committed; one Examples record has `Name = Mira` and the script result is `Mira`.'],
  'Delete Record/Request': ['New Record/Request\nSet Field [ Examples::Name ; "Mira" ]\nCommit Records/Requests [ With dialog: Off ]\nDelete Record/Request [ With dialog: Off ]\nExit Script [ Text Result: Get ( FoundCount ) ]',
    'The local record is deleted; the script result is `0` and no Examples records remain.'],
  'Show All Records': ['Show All Records\nExit Script [ Text Result: Get ( FoundCount ) ]',
    'The empty synthetic Examples table remains empty; the script result is `0`.'],
  'Go to Layout': ['Go to Layout [ “Examples” ]\nExit Script [ Text Result: Get ( LayoutName ) ]',
    'The current layout is `Examples`; the script result is `Examples`.'],
  'Set Variable': ['Set Variable [ $count ; Value: 2 + 3 ]\nExit Script [ Text Result: $count ]', 'The script result is `5`; no record changes.'],
  'Exit Script': ['Exit Script [ Text Result: "done" ]', 'The script result is `done`; no record changes.'],
  'Set Error Capture': ['Set Error Capture [ On ]\nExit Script [ Text Result: "done" ]', 'The script result is `done`; no record changes.'],
  'Allow User Abort': ['Allow User Abort [ Off ]\nExit Script [ Text Result: "done" ]', 'The script result is `done`; no record changes.'],
  'If': ['Set Variable [ $result ; Value: "before" ]\nIf [ True ]\n  Set Variable [ $result ; Value: "after" ]\nEnd If\nExit Script [ Text Result: $result ]', 'The script result is `after`; no record changes.'],
  'Loop': ['Set Variable [ $n ; Value: 0 ]\nLoop\n  Set Variable [ $n ; Value: $n + 1 ]\n  Exit Loop If [ $n = 2 ]\nEnd Loop\nExit Script [ Text Result: $n ]', 'The script result is `2`; no record changes.'],
  '# (comment)': ['# An offline note\nExit Script [ Text Result: "done" ]', 'The script result is `done`; the comment has no effect.'],
};
const EXTERNAL_STEP = /Mail|URL|Plug-In|RAG|Model|Embedding|Claris Connect|DDE|Send Event|Local Notification|NFC/;
const INERT_BARE_ERRORS: Record<string, number> = { 'Refresh Portal': 116 };

export function stepPages(): StepPage[] {
  const pages = SCRIPT_STEP_NAMES.map((name) => {
    const id = scriptStepId(name)!;
    const status: StepStatus = ERROR_3_STEPS.has(name) ? 'error 3'
      : inert.has(name) || id === 89 ? 'does nothing'
      : partial.has(name) || ERROR_3_UNLESS_CONFIGURED.has(name) ? 'partly' : 'works';
    const note = unsupported.get(name) ?? inert.get(name) ?? partial.get(name);
    const optionSummary = OPTION_NOTES[name] ?? (SELECT_STEPS.has(name)
      ? 'Script text accepts `Select`; where the step runs, this selects the whole target. `Select: Off` preserves the current selection where supported.'
      : 'Use the Script Workspace or script text to supply the target and any positional options the step requires.');
    const labels = parsedOptionLabels(name);
    const options = `${optionSummary}${labels.length ? ` Accepted script-text labels: ${labels.map((label) => `\`${label}:\``).join(', ')}.` : ''}`;
    const privileges = FULL_ACCESS.has(name) ? 'Full access to the file, or a script configured to run with full access.'
      : EXPORT.has(name) ? 'Export privilege for the target file.'
      : PRINT.has(name) ? 'Print privilege for the target file.'
      : 'Permission to run the script; access to any named record, field, layout or file is checked at use.';
    const codes = new Set<number>(status === 'error 3' ? [3] : [0, ...(ERRORS[name] ?? [])]);
    const bare = bareOutcomes.get(id);
    if (bare) codes.add(bare.error);
    if (status === 'error 3' || status === 'partly') codes.add(3);
    if (FULL_ACCESS.has(name) || EXPORT.has(name) || PRINT.has(name)) codes.add(9);
    if (FILE_STEPS.test(name) && status !== 'error 3') for (const n of [800, 802, 809, 850]) codes.add(n);
    const example = safeExamples[name] ?? (EXTERNAL_STEP.test(name)
      ? ['Set Variable [ $state ; Value: "offline" ]\nExit Script [ Text Result: $state ]',
        'The script result is `offline`; no external action is attempted. The named step needs the capability described above.']
      : status === 'error 3'
      ? [name, 'On an offline synthetic file, the step returns error `3` and changes no records.']
      : status === 'does nothing'
      ? [name, `With no target supplied, the step returns \`${INERT_BARE_ERRORS[name] ?? 0}\` and leaves the synthetic file’s records unchanged.`]
      : bare ? [name, `The step returns error \`${bare.error}\`; ${bare.count === 1 ? 'the original record remains' : `${bare.count} records remain`}. No external action is attempted.`]
        : (() => { throw new Error(`missing offline example outcome for ${name}`); })());
    const setup = bare && !safeExamples[name] ? 'Use a synthetic local solution with an `Examples` table, one text field `Name`, and one record where `Name = Mira`.'
      : 'Use a synthetic local solution with an empty `Examples` table and a text field named `Name`.';
    return { id, name, slug: `${id}-${slug(name)}`, group: group(name), status, note, options, privileges,
      codes: [...codes].sort((a, b) => a - b), example: example[0], setup, expected: example[1] };
  });
  if (new Set(pages.map((p) => p.slug)).size !== pages.length) throw new Error('duplicate step slug');
  return pages;
}

export function pageText(p: StepPage): string {
  const explanation = BEHAVIOR[p.name] ?? (p.status === 'error 3' ? 'This step is unavailable in this engine and returns error 3.'
    : p.status === 'does nothing' ? 'The engine accepts this step but does not perform its named action.'
    : p.status === 'partly' ? 'The engine handles this step with the limits described in the support notes.'
    : 'The engine has a handler for this step. Its effect depends on the named target and current script context.');
  const replacement = p.status === 'error 3' ? '\n## Replacement\n\n' + (
    p.name === 'Execute SQL' ? 'Use the `ExecuteSQL` calculation function for local read-only queries.'
      : p.name === 'Send DDE Execute' ? 'Use local script steps and calculations; DDE has no server replacement.'
      : p.name === 'Perform AppleScript' ? 'Use server-side script steps or a local command outside the script engine.'
      : p.name === 'New File' ? 'Create a local solution with the command-line tool before running a script.'
      : 'There is no direct offline replacement for this step.') + '\n' : '';
  const detail = p.note?.replace(/<!--.*?-->/g, '').trim().replace(/\]\((?!https?:|#|\.\.\/)/g, '](../../');
  const note = detail ? `\n${detail}\n\nFileMaker comparisons in this note are inferred unless a Claris help page is linked. See the [full support notes](../../script-steps-support.md) for surrounding conditions.\n` : '';
  return `---\nid: script-step-${p.id}\ntitle: ${JSON.stringify(p.name)}\narea: script-steps\nsince: unknown\nstatus: ${p.status === 'works' ? 'works' : p.status === 'partly' ? 'partly' : 'not-yet'}\nverified: f200448e0\n---\n\n# ${p.name}\n\n${p.name.startsWith('#') ? `\`${p.name}\`` : p.name} is a ${p.group.toLowerCase()} script step. This page describes how the offline Tabularius engine handles it.\n\n- **Support:** ${p.status}\n- **Registry ID:** ${p.id}\n\n## What the engine does\n\n${explanation}${note}\n## Options\n\n${p.options}\n\n## Privileges\n\n${p.privileges}\n\n## Error codes\n\nKnown codes from the engine and the [script error-code reference](../../error-codes.md): ${p.codes.map((n) => `\`${n}\``).join(', ')}. Other failures can arise from calculations or targets used by the step.\n${replacement}\n## Offline script example\n\n${p.setup} The example uses no mail, network or plug-ins.\n\n\`\`\`script\n${p.example}\n\`\`\`\n\n**Expected end state:** ${p.expected}\n`;
}

export function indexText(pages = stepPages()): string {
  const lines = ['---', 'id: script-steps-index', 'title: Script steps', 'area: script-steps', 'since: unknown', 'status: partly', 'verified: f200448e0', '---', '', '# Script steps', '',
    `This index groups all ${pages.length} registered script steps by task and shows what the offline engine supports.`, '',
    'A step marked **error 3** is unavailable; **does nothing** means it succeeds without its named action. Read the [support notes](../../script-steps-support.md) for detailed limits.', ''];
  for (const group of [...new Set(pages.map((p) => p.group))].sort()) {
    lines.push(`## ${group}`, '', '| Step | Support |', '| --- | --- |');
    for (const p of pages.filter((p) => p.group === group).sort((a, b) => a.name.localeCompare(b.name)))
      lines.push(`| [${p.name}](${p.slug}.md) | ${p.status} |`);
    lines.push('');
  }
  return lines.join('\n');
}

function generatedFiles(): Map<string, string> {
  const pages = stepPages();
  const files = new Map<string, string>([[supportPath, `<!-- Generated by scripts/script-step-pages.ts from scripts/script-steps-support-source.md. -->\n${source}`],
    [join(output, 'index.md'), indexText(pages)]]);
  for (const p of pages) files.set(join(output, `${p.slug}.md`), pageText(p));
  return files;
}

export function checkOrWrite(check: boolean): { pages: number; stale: string[] } {
  const files = generatedFiles();
  const stale: string[] = [];
  if (!check) mkdirSync(output, { recursive: true });
  for (const [path, value] of files) {
    let previous: string | undefined;
    try { previous = readFileSync(path, 'utf8'); } catch { /* missing generated file */ }
    if (previous !== value) { stale.push(path); if (!check) writeFileSync(path, value); }
  }
  for (const filename of (existsSync(output) ? readdirSync(output) : []).filter((n) => n.endsWith('.md'))) {
    const path = join(output, filename);
    if (!files.has(path)) { stale.push(path); if (!check) rmSync(path); }
  }
  return { pages: stepPages().length, stale };
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const result = checkOrWrite(check);
  console.log(`${result.pages} script-step pages; ${result.stale.length} ${check ? 'stale' : 'written or removed'} files`);
  if (check && result.stale.length) { for (const path of result.stale) console.error(path); process.exitCode = 1; }
}
