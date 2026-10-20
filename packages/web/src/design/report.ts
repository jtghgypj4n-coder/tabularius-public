// The conversion report: what in this file won't work yet in Tabularius, with
// where each thing appears, so a developer can see what to rework.

import type { ConversionItem } from './client.ts';
import { button, check, h, toast } from './dom.ts';
import { errorText, type Studio } from './main.ts';
import { renderText } from '../assistant.ts';

/** An "Ask AI" button for a report line, when the assistant is on. */
function askButton(studio: Studio, question: string): HTMLElement | string {
  return studio.ask ? button('Ask AI', () => studio.ask!(question), { class: 'd-ask', title: 'Ask the assistant how to rework this' }) : '';
}

const places = (i: ConversionItem) => i.where.slice(0, 5).join('; ') + (i.count > Math.min(i.where.length, 5) ? ' and more' : '');

function items(studio: Studio, title: string, note: string, list: ConversionItem[], ask?: (i: ConversionItem) => string): HTMLElement | undefined {
  if (!list.length) return undefined;
  const total = list.reduce((n, i) => n + i.count, 0);
  return h('details', { class: 'd-report' },
    h('summary', {}, `${title} (${list.length === total ? total : `${list.length} kinds, ${total} places`})`),
    h('p', { class: 'd-muted' }, note),
    h('ul', {}, ...list.map((i) => h('li', {}, h('strong', {}, i.name), ` × ${i.count}`, ask ? askButton(studio, ask(i)) : '',
      i.where.length ? h('div', { class: 'd-muted' }, i.where.join(' · ') + (i.count > i.where.length ? ' · …' : '')) : '')),
    ));
}

function lines(studio: Studio, title: string, note: string, list: { where: string; text: string; error?: string }[], ask?: (x: { where: string; text: string; error?: string }) => string): HTMLElement | undefined {
  if (!list.length) return undefined;
  return h('details', { class: 'd-report' },
    h('summary', {}, `${title} (${list.length})`),
    h('p', { class: 'd-muted' }, note),
    h('ul', {}, ...list.map((x) => h('li', {}, h('div', {}, x.where, ask ? askButton(studio, ask(x)) : ''), h('code', {}, x.text), x.error ? h('div', { class: 'd-muted' }, x.error) : ''))));
}

export async function reportTab(studio: Studio): Promise<HTMLElement> {
  let r;
  try {
    r = await studio.client.report();
  } catch (e) {
    return h('p', { class: 'd-muted' }, errorText(e));
  }
  const sources = r.dataSources.filter((d) => !d.hosted);
  const parts = [
    items(studio, 'FileMaker functions not available yet', 'Calculations using these return an error until the engine has them.', r.functions.notYet,
      (i) => `The function ${i.name} isn't available in Tabularius yet. It is used in: ${places(i)}. For each, suggest a formula that works without it, and propose the changes.`),
    items(studio, 'Plug-in functions', 'Plug-ins don\'t run here; calculations using them return an error.', r.functions.plugIns,
      (i) => `The plug-in function ${i.name} doesn't run in Tabularius. It is used in: ${places(i)}. What does it do there, and can those formulas do the same with built-in functions? Propose the changes where they can.`),
    items(studio, 'Functions the reader can\'t name yet', 'Shown as ⟨fn:…⟩ in formulas.', r.functions.undecoded),
    items(studio, 'Script steps that can\'t run yet', 'Each one fails with error 3 and the script carries on, as in FileMaker.', r.steps.notYet,
      (i) => `The script step ${i.name} can't run in Tabularius yet. It is used in: ${places(i)}. What do those scripts use it for? Where steps that run here can do the same, rewrite those scripts, check them with check_script, and propose the changes (each is tried on a copy of the file); say which can't be replaced and why.`),
    items(studio, 'Steps that never run', 'Tabularius sends no email unless its administrator switches sending on.', r.steps.blocked,
      (i) => `The step ${i.name} sends nothing in Tabularius unless its administrator switches mail sending on. It is used in: ${places(i)}. What do those scripts send, and to whom? Propose a change that keeps the rest of each script working without it (for example, logging the message to a table for someone to send, or a comment saying what used to happen), and say what the developer would need to set up outside Tabularius to send it.`),
    items(studio, 'Steps that reach the network', 'Off unless the server allows it; scripts an AI runs are always offline.', r.steps.network,
      (i) => `The step ${i.name} reaches outside the solution. It is used in: ${places(i)}. What do those scripts use it for, and what happens when they run offline here? Where a script should still work offline, propose a change that checks for the error and carries on (each change is tried on a copy of the file, offline).`),
    items(studio, 'Screen-only steps', 'Skipped on the server, as FileMaker Server does.', r.steps.screenOnly),
    items(studio, 'Steps only FileMaker Pro can do', 'A person choosing a folder, a camera or scanner, AppleScript: error 3 here, as on FileMaker Server.', r.steps.clientOnly ?? []),
    lines(studio, 'Formulas that don\'t parse', 'These calculations can\'t be evaluated.', r.unparsed,
      (x) => `This formula doesn't parse in Tabularius (${x.error ?? 'parse error'}): ${x.where}: ${x.text.slice(0, 1500)}. Suggest a corrected formula, check it, and propose the change.`),
    lines(studio, 'Already broken in FileMaker', 'Missing fields, tables or scripts; broken before conversion.', r.broken,
      (x) => `This was already broken in FileMaker: ${x.where}: ${x.text.slice(0, 1500)}. What did it most likely refer to, and how should it be fixed?`),
    sources.length ? h('details', { class: 'd-report' }, h('summary', {}, `Other files not hosted here (${sources.length})`),
      h('ul', {}, ...sources.map((d) => h('li', {}, h('strong', {}, d.name), ` · ${d.occurrences} table occurrence${d.occurrences === 1 ? '' : 's'}`,
        askButton(studio, `This file uses tables in another file, ${d.name} (${d.paths.join(', ')}), through ${d.occurrences} table occurrence${d.occurrences === 1 ? '' : 's'}, and that file isn't hosted here. ` +
          'Which occurrences, layouts and scripts depend on it? Say what the options are (host that file here too, or move its tables into this file) and, where tables with the same names and fields are already here, propose the changes that point the occurrences at them.'),
        h('div', { class: 'd-muted' }, d.paths.join(', ')))))) : undefined,
    r.accounts.withoutPassword.length ? h('details', { class: 'd-report' }, h('summary', {}, `Accounts without a password (${r.accounts.withoutPassword.length})`),
      h('p', { class: 'd-muted' }, 'They can\'t sign in until a password is set with tabularius passwd.'),
      h('ul', {}, ...r.accounts.withoutPassword.map((a) => h('li', {}, a)))) : undefined,
  ].filter((x): x is HTMLElement => !!x);
  // A plan for the whole file: what to fix first, from the same report the assistant can read (conversion_report).
  const fix = studio.ask && parts.length ? button('Propose fixes with AI', () => void studio.ask!(
    'Go through the conversion report for this file. For each thing that won\'t work here that the design can fix (formulas using ' +
    'functions or plug-ins that aren\'t available, formulas that don\'t parse, script steps that can\'t run, scripts that reach outside), ' +
    'work out a Tabularius-native replacement, check it (check_calculation, check_script), and propose it as design changes, one proposal ' +
    'per thing, most used first, up to five. Scripts in a proposal are tried on a copy of the file, offline. Then list what can\'t be ' +
    'replaced and why. Don\'t apply anything.'), { title: 'The assistant proposes changes for what can be fixed, for you to review and apply' }) : undefined;
  const plan = studio.ask && parts.length ? h('div', { class: 'd-actions' }, ...(fix ? [fix] : []), button('Plan the fixes with AI', () => studio.ask!(
    'Read the conversion report for this file and make a plan: which of the things that won\'t work yet matter most to the people using it ' +
    '(by how often and where they are used), what to do about each, in order, and which can wait. Don\'t change anything; I\'ll ask for each fix.'),
  { title: 'Ask the assistant which of these to fix first, and how' })) : undefined;
  // Moving off plug-ins (licences included), even those that work here already: the assistant walks migration_plan.
  const migrate = studio.ask ? h('div', { class: 'd-actions' }, button('Move off plug-ins with AI', () => void studio.ask!(
    'Help me move this file off its plug-ins. Call migration_plan, tell me in a few lines which plug-ins it uses, what each call becomes natively, ' +
    'and what has no native replacement. Then rewrite the script with the most plug-in calls using native steps and propose it ' +
    '(it is dry-run offline on a copy first). I\'ll ask for the next one.'), { title: 'The assistant lists every plug-in call with its native replacement and rewrites scripts one at a time, each tried offline on a copy first' })) : undefined;
  // "Why doesn't X work here?" for one script, field or layout: the assistant answers from the report for that item.
  let why: HTMLElement | undefined;
  if (studio.ask) {
    const name = h('input', { class: 'd-ai-want', placeholder: 'A script, field (Table::Field) or layout', 'aria-label': 'What to ask about' });
    const go = () => {
      const item = name.value.trim();
      if (item) void studio.ask!(`Why doesn't "${item}" work here the way it did in FileMaker? Check conversion_report with item ${JSON.stringify(item)} and explain what won't work, where, and what to do about it.`);
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    why = h('div', { class: 'd-actions' }, h('span', { class: 'd-muted' }, 'Why doesn\'t this work here?'), name, button('Ask AI', go, { title: 'The assistant explains what won\'t work in it, from the conversion report' }));
  }
  const ddr = h('div', { class: 'd-actions' }, button('Download Design Report (XML)', () => void downloadReport(studio), {
    title: 'The whole design as FileMaker\'s Database Design Report XML, for tools that analyze FileMaker solutions',
  }));
  return h('section', { class: 'd-main' }, renderText(r.summary), ...(plan ? [plan] : []), ...(migrate ? [migrate] : []), ...(why ? [why] : []), ddr, documentation(studio), ...parts);
}

/** "Document this solution": readable documentation to download, with an introduction the assistant writes when it is on. */
function documentation(studio: Studio): HTMLElement {
  let introduction: string | undefined;
  const note = h('p', { class: 'd-muted' }, 'Every table and field, the relationships, each layout and the scripts it starts, and each script with what calls it and what it calls.');
  const download = (format: 'md' | 'html') => async () => {
    try {
      save(await studio.client.docs(format, introduction), `${studio.design.database}_docs.${format}`, format === 'html' ? 'text/html' : 'text/markdown');
    } catch (e) {
      toast(errorText(e));
    }
  };
  const html = button('Download documentation', () => void download('html')(), { title: 'One web page with a table of contents' });
  // Every script written up in plain words too: a model call per few dozen scripts, so it takes longer and costs more.
  const md = button('As Markdown', () => void download('md')(), { title: 'The same, as Markdown, for a wiki or a repository' });
  const actions = h('div', { class: 'd-actions' }, html, md);
  if (studio.ask) {
    const write = button('Write an introduction with AI', async () => {
      write.disabled = true;
      const answer = await studio.ask!(
        'Write an introduction to this solution for a developer who is new to it, to go at the top of its documentation. ' +
        'Use explain_solution (and explain_solution for the main tables and scripts). Cover what the solution is for, the main tables ' +
        'and how they relate, the main things people do in it (the scripts buttons, triggers and file opening start), and anything ' +
        'that reaches outside it (mail, network, plug-ins). Write it as Markdown with ### headings, a few paragraphs and short lists; ' +
        'no preamble, just the introduction.');
      write.disabled = false;
      if (!answer) return;
      introduction = answer;
      html.textContent = 'Download documentation with the introduction';
      write.textContent = 'Write it again';
    }, { title: 'The assistant reads the solution and writes an overview to put first' });
    actions.append(write);
  }
  return h('details', { class: 'd-report', open: '' }, h('summary', {}, 'Document this solution'), note, actions, ...(studio.ask ? [handover(studio)] : []));
}

/** "Explain this file": a handover memo the assistant writes from the design alone, shown here and saved as a page or Markdown. */
function handover(studio: Studio): HTMLElement {
  let memo: string | undefined;
  const view = h('div', { class: 'd-handover', hidden: '' });
  const page = button('Download as a web page', () => void (async () => {
    try {
      save(await studio.client.handover('html', memo), `${studio.design.database}_handover.html`, 'text/html');
    } catch (e) {
      toast(errorText(e));
    }
  })(), { hidden: '' });
  // Every script written up in plain words too: a model call per few dozen scripts, so it takes longer and costs more.
  const everyScript = check('Write up every script too', false);
  everyScript.el.title = 'Adds a Scripts section: what each script does, what starts it and what it changes, from its steps (secrets hidden, no records)';
  const md = button('As Markdown', () => memo && save(memo, `${studio.design.database}_handover.md`, 'text/markdown'), { hidden: '' });
  const write = button('Write a handover memo with AI', async () => {
    write.disabled = true;
    write.textContent = 'Writing the memo…';
    try {
      memo = await studio.client.handover('md', undefined, everyScript.input.checked);
      view.replaceChildren(renderText(memo));
      view.hidden = false;
      page.hidden = false;
      md.hidden = false;
      write.textContent = 'Write it again';
    } catch (e) {
      toast(errorText(e));
      write.textContent = memo ? 'Write it again' : 'Write a handover memo with AI';
    }
    write.disabled = false;
  }, { title: 'What the solution does, its main tables and key scripts, risky spots and what looks unused, from the design alone (no records are sent)' });
  return h('div', {}, h('p', { class: 'd-muted' }, 'A handover memo for whoever takes the file over, written by the assistant from the design only: no records are sent.'),
    h('div', { class: 'd-actions' }, write, everyScript.el, page, md), view);
}

function save(text: string, name: string, type: string): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function downloadReport(studio: Studio): Promise<void> {
  try {
    const xml = await studio.client.designReport();
    const a = h('a', { href: URL.createObjectURL(new Blob([xml], { type: 'application/xml' })), download: `${studio.design.database}_ddr.xml` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (e) {
    toast(errorText(e));
  }
}
