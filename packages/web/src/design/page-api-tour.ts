// A tour of what a modern layout's page can call: window.tabularius and FileMaker.PerformScript. Each step is a short
// explanation and a snippet that runs as written inside the page's script tag; the page editor inserts it with a click.

import { button, h } from './dom.ts';

export interface TourStep {
  title: string;
  text: string;
  /** JavaScript for the page's script tag. `LAYOUT` is the layout the page is on. */
  code: string;
  /** False when the snippet already copes with a page that has no Tabularius calls (FileMaker Pro, the editor's preview). */
  guarded?: boolean;
}

/** The steps, in the order a first page needs them. `layout` is the name of the layout being edited. */
export function tourSteps(layout: string): TourStep[] {
  const L = JSON.stringify(layout).replace(/</g, '\\u003c');
  return [
    { title: 'Who and where', text: 'tabularius.context() says which file, account and layout the page is in, and the record and found count showing.',
      code: `const LAYOUT = ${L};\ntabularius.context().then((c) => {\n  console.log(c.account, 'is on', c.layout, '-', c.foundCount, 'of', c.totalCount, 'records');\n});` },
    { title: 'Read records', text: 'records(layout, {offset, limit, sort}) returns {data, foundCount, totalCount}. Each record has recordId and fieldData, with only the fields this account may see.',
      code: `tabularius.records(${L}, { limit: 10, sort: [{ fieldName: 'recordId', sortOrder: 'descend' }] }).then((r) => {\n  r.data.forEach((rec) => console.log(rec.recordId, rec.fieldData));\n  // record(layout, recordId) reads one record on its own\n  if (r.data[0]) tabularius.record(${L}, r.data[0].recordId).then((one) => console.log(one.fieldData));\n});` },
    { title: 'Find records', text: 'find(layout, requests) takes FileMaker find requests: several requests are "or", and {"omit": true} leaves matches out.',
      code: `tabularius.find(${L}, [{ Status: 'Open' }, { Status: 'Late' }], { limit: 20 }).then((r) => {\n  console.log(r.foundCount, 'open or late');\n});` },
    { title: 'Create, change and delete', text: 'create, update and remove are checked against the account\'s privileges like any other edit, and a refused one rejects with the reason.',
      code: `async function tryWrites() {\n  const { recordId } = await tabularius.create(${L}, { Note: 'Made by a page' });\n  await tabularius.update(${L}, recordId, { Note: 'Changed by a page' });\n  await tabularius.remove(${L}, recordId);\n}\ntryWrites().catch((e) => console.log('Refused:', e.message));` },
    { title: 'Figures for charts', text: 'summarize(widget) takes what a dashboard widget does: kind (number, chart, table), groupBy, by (a period for dates), measure, query and limit. Dates in a query may be relative, such as "this month".',
      code: `tabularius.summarize({ kind: 'chart', chart: 'column', layout: ${L}, groupBy: ['Status'], measure: { field: 'Total', fn: 'sum' }, limit: 12 }).then((c) => {\n  console.log(c.categories, c.series[0].values);\n});\ntabularius.summarize({ kind: 'number', layout: ${L}, query: [{ Created: 'this month' }] }).then((n) => console.log('New this month:', n.value));` },
    { title: 'Show a picture', text: 'A container field comes back as a link to its file, which the page may show in an img: only these links load, nothing from outside. They expire after an hour, so read the record again for a fresh one. image(link, size) asks for a thumbnail that fits size pixels (16 to 1024).',
      code: `tabularius.records(${L}, { limit: 1 }).then((r) => {\n  const link = r.data[0] && r.data[0].fieldData['Photo'];\n  if (!link) return;\n  const img = new Image();\n  img.src = tabularius.image(link, 128);\n  document.body.append(img);\n});` },
    { title: 'Read a value list', text: 'valueList(name) gives {values, labels?} for a value list this account may use: draw a pop-up menu from it, and a change to the list shows the next time the page draws. labels is present when the text to show differs from the value stored.',
      code: `tabularius.valueList('Statuses').then((list) => {\n  const menu = document.createElement('select');\n  list.values.forEach((v, i) => menu.append(new Option(list.labels ? list.labels[i] : v, v)));\n  document.body.append(menu);\n}).catch((e) => console.log('No such list:', e.message));` },
    { title: 'Move around', text: 'layouts() lists the layouts this account may open, and goToLayout(name) goes to one of them. Any other name is refused.',
      code: `tabularius.layouts().then((names) => {\n  const next = names.find((n) => n !== ${L});\n  if (next) document.body.addEventListener('dblclick', () => tabularius.goToLayout(next));\n});` },
    { title: 'Run a script', text: 'FileMaker.PerformScript(name, parameter) runs a script by name. It works in FileMaker Pro and Go too; tabularius.performScript(name, parameter) is the same call as a promise. The web viewer must allow it in Web Viewer Setup, and the parameter is text.',
      guarded: false, code: `document.addEventListener('click', (e) => {\n  if (e.target.closest('[data-script]')) FileMaker.PerformScript(e.target.dataset.script, 'from the page');\n});\n// In Tabularius only: tabularius.performScript('Name', 'parameter')` },
    { title: 'Print or save as PDF', text: 'print() opens the browser\'s print dialog for the window, which shows this page and nothing else around it; choose Save as PDF there. It is refused for an account that may not print. Hide what should not print with an @media print rule.',
      code: `const printButton = document.createElement('button');\nprintButton.textContent = 'Print / Save as PDF';\nprintButton.className = 'no-print';\nprintButton.onclick = () => tabularius.print().catch((e) => console.log('Refused:', e.message));\ndocument.body.append(printButton);\n// In the page's style: @media print { .no-print { display: none; } }` },
    { title: 'Stay current', text: 'on("refresh", fn) runs fn whenever the window is drawn again: another record, a script, a save. Put the page\'s reading in a function and call it from both places.',
      code: `async function show() {\n  const r = await tabularius.records(${L}, { limit: 5 });\n  document.title = r.foundCount + ' records';\n}\nshow();\ntabularius.on('refresh', show);` },
    { title: 'Work in FileMaker Pro too', text: 'The window.tabularius calls exist only in Tabularius. FileMaker Pro shows the same layout and page, with FileMaker.PerformScript but without them, so check for window.tabularius first and say where the data would come from.',
      guarded: false, code: `if (!window.tabularius) {\n  document.body.textContent = 'Live figures show when this file is opened in Tabularius.';\n}` },
  ];
}

/** The page with a step's snippet added at the end of its last script tag (or in a new one, if it has none). */
export function insertSnippet(page: string, code: string, guarded = false): string {
  // A guarded snippet waits for the calls to exist, so the page still runs in FileMaker Pro and in the editor's preview.
  if (guarded) code = `if (window.tabularius) {\n${code.replace(/^/gm, '  ')}\n}`;
  const at = page.lastIndexOf('</script>');
  return at < 0 ? `${page.replace(/\s*$/, '')}\n<script>\n${code}\n</script>\n` : `${page.slice(0, at).replace(/\s*$/, '')}\n${code}\n${page.slice(at)}`;
}

/** The tour as a panel: one step at a time, with Back, Next and Insert, which hands the step's code to `insert`. */
export function apiTour(layout: string, insert: (code: string, guarded: boolean) => void): HTMLElement {
  const steps = tourSteps(layout);
  let at = 0;
  const title = h('h4', {});
  const text = h('p', {});
  const code = h('pre', { class: 'le-tour-code' });
  const count = h('span', { class: 'd-muted', 'aria-live': 'polite' });
  const back = button('Back', () => go(at - 1));
  const next = button('Next', () => go(at + 1));
  const go = (i: number) => {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[at];
    title.textContent = s.title;
    text.textContent = s.text;
    code.textContent = s.code;
    count.textContent = `${at + 1} of ${steps.length}`;
    (back as HTMLButtonElement).disabled = at === 0;
    (next as HTMLButtonElement).disabled = at === steps.length - 1;
  };
  go(0);
  return h('section', { class: 'le-tour', 'aria-label': 'Page API tour' }, title, text, code,
    h('div', { class: 'd-row' }, count, h('span', { class: 'd-spacer' }), back, next,
      button('Add to page', () => insert(steps[at].code, steps[at].guarded !== false), { class: 'primary', title: 'Adds this snippet to the end of the page\'s script' })));
}
