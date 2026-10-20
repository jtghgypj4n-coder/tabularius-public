import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import { estimatePolish, interfacePage, labelOf, planFromLayout, planInterface, previewPage, samplesOf, whyNot, type ModernField, type ModernTable } from '../src/modernize.ts';
import { modernDesign, modernPage } from '../src/page-source.ts';

const f = (name: string, type = 'text', extra: Partial<ModernField> = {}): ModernField => ({ name, type, kind: 'normal', ...extra });
const customers: ModernTable = { name: 'Customers', fields: [
  f('CustomerID', 'number', { automatic: true }), f('Notes'), f('Status', 'text', { values: ['New', 'Active'] }), f('Since', 'date'), f('Full_Name'), f('Balance', 'number'),
  f('Photo', 'container'), f('gFilter', 'text', { global: true }), f('Tags', 'text', { repetitions: 3 }), f('Created', 'timestamp'), f('Age', 'number', { }), { name: 'Label', type: 'text', kind: 'calculation' },
] };

test('modernize: labels read field names, and tables of only keys get no interface', () => {
  assert.equal(labelOf('first_name'), 'First name');
  assert.equal(labelOf('FirstName'), 'First Name');
  assert.equal(whyNot({ name: 'Tags', fields: [f('CustomerID'), f('TagID')] }), 'only keys and stamps, which looks like a join table');
  assert.equal(whyNot({ name: 'Empty', fields: [] }), 'no fields');
  assert.equal(whyNot(customers), undefined);
});

test('modernize: page search request finds literal operators, quotes and backslashes', () => {
  const page = interfacePage('Customers', planInterface(customers), 'list');
  assert.match(page, /Search Notes, Status, Full_Name/);
  assert.match(page, /'\*' \+ JSON\.stringify\(S\.q\) \+ '\*'/);
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-modernize-find-'));
  const path = join(dir, 'Shop.openhbam.sqlite');
  try {
    createStore(path);
    const store = new Store(path, 'Shop');
    store.applyDesign([{ op: 'createTable', name: 'Customers', fields: [{ name: 'Notes' }] }] as never);
    const literal = '==<5! "quoted" \\ path';
    const literalId = store.create('Customers', { Notes: `prefix ${literal} suffix` }).recordId;
    store.create('Customers', { Notes: '5' });
    store.create('Customers', { Notes: '4' });
    // This is the exact criterion the generated page sends; JSON.stringify's quoted
    // phrase keeps operator characters, quotes, and backslashes literal in find().
    const criterion = '*' + JSON.stringify(literal) + '*';
    assert.equal(criterion, '*"==<5! \\\"quoted\\\" \\\\ path"*');
    assert.deepEqual(store.find('Customers', { query: [{ Notes: criterion }] }).records.map((r) => r.recordId), [literalId]);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('modernize: the plan leads with the name, then groups, dates and numbers; keys and stamps go under System; globals and repeating fields are left out', () => {
  const plan = planInterface(customers);
  assert.deepEqual(plan.columns.map((c) => c.name), ['Full_Name', 'Status', 'Since', 'Balance', 'Age', 'Notes']);
  const names = plan.fields.map((x) => x.name);
  assert.ok(!names.includes('gFilter') && !names.includes('Tags'));
  assert.deepEqual(plan.fields.filter((x) => x.system).map((x) => x.name), ['CustomerID', 'Created']);
  assert.equal(names.at(-1), 'Created');
  const by = Object.fromEntries(plan.fields.map((x) => [x.name, x.control]));
  assert.deepEqual([by.Notes, by.Status, by.Since, by.Balance, by.Photo, by.Label, by.Created], ['longtext', 'select', 'date', 'number', 'container', 'readonly', 'timestamp']);
  // Search looks in stored text fields only.
  assert.deepEqual(plan.search, ['Notes', 'Status', 'Full_Name']);
});

test('modernize: every mode is a modern layout page that parses, with the names kept out of markup and script structure', () => {
  const nasty: ModernTable = { name: 'T</script>"', fields: [f('A</script>'), f('B"x', 'number')] };
  for (const mode of ['list', 'detail', 'split'] as const) {
    const html = interfacePage('L</script>', planInterface(nasty), mode);
    assert.equal(html.split('</script>').length, 2, mode);
    const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
    assert.doesNotThrow(() => new Function(script), mode);
    assert.ok(!script.includes('__PLAN__'));
    const design = modernDesign('L', 'L', html);
    assert.equal(modernPage(design.objects)?.html, html);
    assert.ok(design.objects[0].webUrl!.length < 30000, `${mode}: ${design.objects[0].webUrl!.length} characters`);
  }
  // The list has a search box and a table; the detail has neither.
  assert.match(interfacePage('L', planInterface(customers), 'list'), /id="q"/);
  assert.doesNotMatch(interfacePage('L', planInterface(customers), 'detail'), /id="rows"/);
});

test('modernize: the AI polish estimate grows with the pages picked, says nothing for none, and prices only a model it knows', () => {
  assert.deepEqual(estimatePolish(0, { input: 2, output: 10 }), { input: 0, output: 0 });
  const one = estimatePolish(1, { input: 2, output: 10 });
  const three = estimatePolish(3, { input: 2, output: 10 });
  assert.ok(three.input > one.input && three.output === 3 * one.output);
  assert.equal(Math.round((one.usd ?? 0) * 1000), Math.round(((26_000 * 2 + 6_000 * 10) / 1_000_000) * 1000));
  assert.equal(estimatePolish(2).usd, undefined);
});

test('modernize: a plan from a layout follows the fields it shows, in its order, and leaves out what a template cannot use', () => {
  const plan = planFromLayout(customers, ['Notes', 'Full_Name', 'gFilter', 'Created', 'Photo', 'Balance', 'Notes', 'Nope', 'Tags'], 'Customer card');
  assert.equal(plan.title, 'Customer card');
  assert.deepEqual(plan.fields.map((x) => x.name), ['Notes', 'Full_Name', 'Created', 'Photo', 'Balance']);
  // Columns skip keys, stamps and containers, but keep the layout's order.
  assert.deepEqual(plan.columns.map((c) => c.name), ['Notes', 'Full_Name', 'Balance']);
  assert.deepEqual(plan.search, ['Notes', 'Full_Name']);
  assert.ok(plan.fields.find((x) => x.name === 'Created')!.system);
});

test('modernize: a container field becomes the picture of cards and the form, and never a column or a saved value', () => {
  const photos: ModernTable = { name: 'Pics', fields: [f('Title'), f('Place'), f('Photo', 'container')] };
  const plan = planInterface(photos);
  assert.equal(plan.picture, 'Photo');
  assert.deepEqual(plan.columns.map((c) => c.name), ['Title', 'Place']);
  assert.equal(planInterface({ name: 'Plain', fields: [f('Title'), f('Place')] }).picture, undefined);
  assert.equal(planFromLayout(photos, ['Photo', 'Title'], 'Gallery').picture, 'Photo');
  const page = interfacePage('Pics - Modern list', plan, 'list');
  assert.match(page, /tabularius\.image\(link, size\)/);
  assert.doesNotThrow(() => new Function(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')).replace('__PLAN__', '{}')));
  // The preview stands in for the bridge: pictures are data: images, which its policy allows.
  assert.match(previewPage(page, samplesOf('Pics - Modern list', plan)), /img-src data:/);
});

test('modernize: a board is made from a status field and a calendar from a date field, and only those pages carry the extra code', () => {
  const tasks: ModernTable = { name: 'Tasks', fields: [f('Title'), f('Stage', 'text', { values: ['To do', 'Doing', 'Done'] }), f('Due', 'date'), f('Notes'), f('Created', 'timestamp')] };
  const plan = planInterface(tasks);
  assert.deepEqual(plan.board, { field: 'Stage', label: 'Stage', values: ['To do', 'Doing', 'Done'] });
  assert.deepEqual(plan.calendar, { field: 'Due', label: 'Due', control: 'date' });
  // A stamp is not a date to plan by, and a plain text field is a board only when named like a status.
  assert.equal(planInterface({ name: 'Log', fields: [f('Title'), f('Created', 'timestamp'), f('Note')] }).calendar, undefined);
  assert.equal(planInterface({ name: 'Deals', fields: [f('Name'), f('Status')] }).board?.field, 'Status');
  assert.equal(planInterface({ name: 'Plain', fields: [f('Name'), f('City')] }).board, undefined);

  const parses = (page: string) => assert.doesNotThrow(() => new Function(page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>')).replace('__PLAN__', '{}')));
  const list = interfacePage('Tasks - Modern list', plan, 'list');
  const board = interfacePage('Tasks - Modern board', plan, 'list', 'board');
  const calendar = interfacePage('Tasks - Modern calendar', plan, 'list', 'calendar');
  for (const page of [list, board, calendar]) parses(page);
  assert.ok(!list.includes('V.board') && !list.includes('V.calendar') && !list.includes('"board"') && !list.includes('"calendar"'), 'the plain list is as small as it was');
  assert.ok(board.includes('V.board') && board.includes('id="v-board"') && !board.includes('V.calendar'));
  assert.ok(calendar.includes('V.calendar') && calendar.includes('id="v-calendar"') && !calendar.includes('V.board'));
  assert.match(board, /"view":"board"/);
  for (const page of [board, calendar]) assert.ok(page.length < 29_000, `${page.length} characters`);
  // Asked for a view the table can't back, the page is the plain list.
  assert.match(interfacePage('x', planInterface({ name: 'Plain', fields: [f('Name'), f('City')] }), 'list', 'board'), /"view":"table"/);
});

test('modernize: a field with a value list is a pop-up that reads the list again when the page draws', () => {
  const table: ModernTable = { name: 'Things', fields: [f('Name'), f('Status', 'text', { values: ['New'], valueList: 'Statuses' }), f('Code', 'text', { valueList: 'Codes' })] };
  const plan = planInterface(table);
  const by = Object.fromEntries(plan.fields.map((x) => [x.name, x]));
  assert.deepEqual([by.Status.control, by.Status.options, by.Status.list], ['select', ['New'], 'Statuses']);
  // A list taken from a field has no values to bake in, but is still a pop-up, read live.
  assert.deepEqual([by.Code.control, by.Code.options, by.Code.list], ['select', undefined, 'Codes']);
  assert.equal(by.Name.list, undefined);
  const html = interfacePage('Things', plan, 'detail');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /tabularius\.valueList\(f\.list\)\.then\(function \(L\) \{ fill\(c, L\.values \|\| \[\], L\.labels, c\.value\); \}, function \(\) \{\}\)/);
  // A page made without a list does not ask.
  assert.equal(planFromLayout(table, ['Name'], 'Things').fields.find((x) => x.name === 'Name')!.list, undefined);
  // The preview refuses, so the values the page was made with stay.
  assert.match(previewPage(html, {} as never), /valueList: function \(\) \{ return Promise\.reject/);
});

test('modernize: related records load a page at a time, say how many of the total, and offer Show more', () => {
  const related = [{ label: 'Orders', layout: 'Orders list', local: 'CustomerID', remote: 'CustomerID', columns: ['Total'] }];
  const html = interfacePage('Customers', planInterface(customers, related), 'detail');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /var RELATED_PAGE = 25;/);
  // Each page asks for the next rows after those shown, and the note counts against the found total.
  assert.match(script, /\{ offset: got \+ 1, limit: RELATED_PAGE \}/);
  assert.match(script, /'Showing ' \+ got \+ ' of ' \+ total \+ '\.'/);
  assert.match(script, /text: 'Show more'/);
  assert.doesNotMatch(script, /limit: 25 \}/);
  // The preview page's stand-in data answers an offset the same way, so Show more works there.
  const preview = previewPage(html, { Customers: [], 'Orders list': [] } as never);
  assert.match(preview, /foundCount: out\.length/);
});

test('modernize: a rejected save that names a field marks it invalid and shows the message beside it', () => {
  const people: ModernTable = { name: 'People', fields: [f('Name', 'text', { required: true }), f('Name2', 'text'), f('Created', 'timestamp', { automatic: true, required: true })] };
  const plan = planInterface(people);
  assert.equal(plan.fields.find((x) => x.name === 'Name')!.required, true);
  assert.equal(plan.fields.find((x) => x.name === 'Name2')!.required, undefined);
  assert.equal(plan.fields.find((x) => x.name === 'Created')!.required, undefined, 'a field the file fills in is not asked of the person');
  const page = interfacePage('People', plan, 'detail');
  assert.match(page, /aria-required/);
  assert.match(page, /'aria-hidden': 'true', text: ' \*'/);
  const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  const body = script.slice(script.indexOf('function clearInvalid'), script.indexOf('var val = '));
  assert.ok(body.includes('function invalid'), 'the helpers are in the page');

  // Run the two helpers against a minimal stand-in for the form: one input per field, the longest matching field name wins.
  const nodes: { id: string; tagName: string; attrs: Record<string, string>; parentNode: { kids: unknown[]; append(x: unknown): void }; focused?: boolean }[] = [];
  const errs: { id: string; text: string; removed?: boolean }[] = [];
  const mk = (id: string, tag = 'INPUT') => {
    const n = { id, tagName: tag, classList: { contains: () => tag === 'DIV' }, querySelector: () => null, attrs: {} as Record<string, string>, parentNode: { kids: [] as unknown[], append(x: unknown) { this.kids.push(x); } }, focused: false,
      setAttribute(k: string, v: string) { this.attrs[k] = v; }, removeAttribute(k: string) { delete this.attrs[k]; }, focus() { this.focused = true; } };
    nodes.push(n);
    return n;
  };
  mk('f-0'); mk('f-1'); mk('f-2', 'DIV');
  const shown = { msg: '', bad: false };
  const doc = {
    querySelector: (sel: string) => nodes.find((n) => sel.includes(`"${n.id}"`)),
    querySelectorAll: (sel: string) => (sel.includes('aria-invalid') ? nodes.filter((n) => n.attrs['aria-invalid']) : errs.filter((e) => !e.removed).map((e) => ({ remove() { e.removed = true; } }))),
  };
  const el = (_t: string, a: Record<string, string>) => { const e = { id: a.id, text: a.text }; errs.push(e); return e; };
  const run = new Function('P', 'document', 'el', 'fail', 'status', `${body.slice(0, body.indexOf('var val = ') < 0 ? undefined : body.indexOf('var val = '))}; return invalid;`);
  const P = { fields: plan.fields };
  const invalid = run(P, doc, el, (e: Error) => { shown.msg = `fail:${e.message}`; shown.bad = true; }, (m: string, bad: boolean) => { shown.msg = m; shown.bad = bad; });
  const nameAt = plan.fields.findIndex((x) => x.name === 'Name'), name2At = plan.fields.findIndex((x) => x.name === 'Name2');
  invalid(new Error('Field "Name2" requires a value'));
  assert.equal(nodes[name2At].attrs['aria-invalid'], 'true');
  assert.equal(nodes[name2At].attrs['aria-describedby'], `f-${name2At}-err`);
  assert.equal(nodes[name2At].focused, true);
  assert.equal(nodes[nameAt].attrs['aria-invalid'], undefined);
  assert.equal(errs.at(-1)!.text, 'Name2: requires a value');
  assert.equal(shown.msg, 'Not saved: Name2 needs attention.');
  // A message that names no field stays on the status line, as before.
  invalid(new Error('You cannot do that'));
  assert.equal(shown.msg, 'fail:You cannot do that');
});

test('modernize: saving a record with no edits changes no date field, in a native file and a compat one', () => {
  const events: ModernTable = { name: 'Events', fields: [f('Title'), f('Day', 'date'), f('When', 'timestamp'), f('At', 'timestamp')] };
  for (const native of [true, false]) {
    const plan = { ...planInterface(events), ...(native ? { native: true as const } : {}) };
    const script = interfacePage('Events', plan, 'detail').replace(/^[\s\S]*<script>|<\/script>[\s\S]*$/g, '');
    const part = (from: string, to: string) => script.slice(script.indexOf(from), script.indexOf(to));
    assert.equal(script.includes('P.native'), native, 'the ISO branch is only in a native file\'s page');
    assert.ok(script.includes('var val = '), 'the helpers are in the page');
    const run = new Function('P', 'document', 'tabularius', 'status', 'clearInvalid', 'invalid',
      `${part('var p2 = ', 'function status(')}\n${script.slice(script.indexOf('var val = ')).split('\n')[0]}\n${part('function save(', 'var armed')}\nreturn { toIn: toIn, save: save };`);
    const record = { recordId: '1', fieldData: native
      ? { Title: 'Launch', Day: '2026-10-16', When: '2026-10-16T12:30:00', At: '2026-10-16T09:15:42' }
      : { Title: 'Launch', Day: '10/16/2026', When: '10/16/2026 12:30:00', At: '10/16/2026 09:15:42' } };
    const sent: Record<string, string>[] = [];
    const said: string[] = [];
    let controls: { dataset: { field: string }; classList: { contains: () => boolean }; value: string }[] = [];
    const page = run({ ...plan, layout: 'Events' }, { querySelectorAll: () => controls }, { update: (_l: string, _id: string, changes: Record<string, string>) => { sent.push(changes); return new Promise(() => {}); } }, (m: string) => said.push(m), () => {}, () => {});
    // As the browser holds them: a datetime-local input drops seconds that are zero.
    const shown = (control: string, v: string) => { const t = page.toIn(control, v) as string; return control === 'timestamp' ? t.replace(/(T\d\d:\d\d):00$/, '$1') : t; };
    controls = plan.fields.map((x) => ({ dataset: { field: x.name }, classList: { contains: () => false }, value: shown(x.control, record.fieldData[x.name as keyof typeof record.fieldData]) }));
    assert.deepEqual(controls.map((c) => c.value), ['Launch', '2026-10-16', '2026-10-16T12:30', '2026-10-16T09:15:42']);
    page.save(record, false);
    assert.deepEqual(sent, [], native ? 'native' : 'compat');
    assert.deepEqual(said, ['Nothing changed.']);
    controls[1].value = '2026-10-17';
    controls[2].value = '2026-10-18T07:05';
    page.save(record, false);
    assert.deepEqual(sent, [native ? { Day: '2026-10-17', When: '2026-10-18T07:05:00' } : { Day: '10/17/2026', When: '10/18/2026 07:05:00' }]);
  }
});

test('modernize: compat pages are byte-identical to 9091a0ea in every mode and view', () => {
  const pages: string[] = [];
  for (const type of ['date', 'timestamp']) {
    const plan = planInterface({ name: 'Events', fields: [f('Title'), f('Status', 'text', { values: ['New', 'Done'] }), f('Due', type)] });
    for (const mode of ['list', 'detail', 'split'] as const) {
      for (const view of ['table', 'board', 'calendar'] as const) pages.push(interfacePage('Events', plan, mode, view));
    }
  }
  // Captured from the untouched PR head, including date and timestamp calendars. The only change since is the product
  // name in the page text (openhbam to tabularius); the pages are otherwise the same bytes.
  assert.equal(createHash('sha256').update(JSON.stringify(pages)).digest('hex'), '0c8e95a08285755cb29fa95c934b0b057f502ea738e058792ebb3c9864e96185');
});

for (const native of [true, false]) for (const type of ['date', 'timestamp'] as const) {
  test(`modernize: ${native ? 'native' : 'compat'} ${type} calendar finds a month, places records and saves New on day`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabularius-modern-calendar-'));
    const path = join(dir, 'Events.sqlite');
    createStore(path, native ? { mode: 'native' } : undefined);
    const store = new Store(path, 'Events');
    try {
      store.applyDesign([{ op: 'createTable', name: 'Events', fields: [{ name: 'Title' }, { name: 'Due', type }] }]);
      const stored = (day: string, time = '12:30:00') => day + (type === 'timestamp' ? 'T' + time : '');
      const first = store.create('Events', { Title: 'First', Due: stored('2026-10-01', '00:00:00') }).recordId;
      const middle = store.create('Events', { Title: 'Middle', Due: stored('2026-10-16') }).recordId;
      const last = store.create('Events', { Title: 'Last', Due: stored('2026-10-31', '23:59:59') }).recordId;
      store.create('Events', { Title: 'Before', Due: stored('2026-09-30', '23:59:59') });
      store.create('Events', { Title: 'After', Due: stored('2026-11-01', '00:00:00') });
      const plan = { ...planInterface({ name: 'Events', fields: [f('Title'), f('Due', type)] }), ...(native ? { native: true as const } : {}) };
      const script = interfacePage('Events', plan, 'list', 'calendar').replace(/^[\s\S]*<script>|<\/script>[\s\S]*$/g, '');
      const part = (from: string, to: string) => {
        assert.ok(script.includes(from) && script.includes(to));
        return script.slice(script.indexOf(from), script.indexOf(to));
      };
      // Run the generated calendar, input conversion and save code. Only the DOM and bridge are stand-ins.
      type Node = { tag: string; attrs: Record<string, unknown>; kids: Node[]; append(...nodes: Node[]): void };
      const el = (tag: string, attrs: Record<string, unknown> = {}, kids: Node[] = []): Node => ({ tag, attrs, kids, append(...nodes) { this.kids.push(...nodes); } });
      let tree: Node;
      let prefill: Record<string, string> = {};
      let controls: { dataset: { field: string }; classList: { contains(): boolean }; value: string }[] = [];
      let created: number | undefined;
      const queries: Record<string, string>[][] = [];
      const errors: unknown[] = [];
      let saved!: () => void;
      let rejected!: (error: unknown) => void;
      const completion = new Promise<void>((resolve, reject) => { saved = resolve; rejected = reject; });
      const run = new Function('P', 'document', 'tabularius', 'el', 'showForm', 'renderList', 'status', 'fail', 'invalid', `
        var S = { rows: [], found: 0, q: '', cur: null }, V = {}, LOAD = {};
        var $ = function () { return { className: '' }; };
        function clearInvalid() {} function setDirty() {} function openRec() {}
        function load() { return LOAD.calendar(); }
        ${part('var p2 = ', 'function status(')}
        ${script.slice(script.indexOf('var val = ')).split('\n')[0]}
        ${part('var C = P.calendar', 'var dirty = ')}
        ${part('function save(', 'var armed')}
        CAL.y = 2026; CAL.m = 9;
        return { load: load, draw: V.calendar, save: save, toIn: toIn, dayOf: dayOf, state: S };
      `);
      const page = run({ ...plan, layout: 'Events', mode: 'list' }, { querySelectorAll: () => controls }, {
        find: async (layout: string, query: Record<string, string>[], options: { offset: number; limit: number }) => {
          queries.push(query);
          const result = store.find(layout, { query, ...options });
          return { data: result.records, foundCount: result.foundCount };
        },
        create: async (layout: string, data: Record<string, string>) => {
          const result = store.create(layout, data);
          created = result.recordId;
          return result;
        },
        record: async (layout: string, id: number) => store.get(layout, id),
      }, el, (rec: { fieldData: Record<string, string> }, isNew: boolean) => {
        if (!isNew) return;
        prefill = rec.fieldData;
        controls = plan.fields.map((f) => ({ dataset: { field: f.name }, classList: { contains: () => false }, value: (page.toIn(f.control, prefill[f.name] ?? '') as string).replace(/(T\d\d:\d\d):00$/, '$1') }));
      }, () => { tree = page.draw(); }, (message: string) => { if (message === 'Saved.') saved(); }, (error: unknown) => errors.push(error), rejected);
      await page.load();
      assert.deepEqual(errors, []);
      const a = native ? '2026-10-01' : '10/01/2026', b = native ? '2026-10-31' : '10/31/2026', separator = native ? 'T' : ' ';
      assert.deepEqual(queries, [[{ Due: type === 'date' ? a + '...' + b : a + separator + '00:00:00...' + b + separator + '23:59:59' }]]);
      assert.equal(page.state.found, 3);
      const descendants = (node: Node): Node[] => [node, ...node.kids.flatMap(descendants)];
      const eventDays = () => descendants(tree).filter((n) => n.tag === 'td').flatMap((cell) =>
        descendants(cell).filter((n) => n.attrs.class === 'ev').map((n) => [n.attrs['data-id'], cell.kids[0].kids[0].attrs.text]));
      assert.deepEqual(eventDays(), [[first, '1'], [middle, '16'], [last, '31']]);
      assert.equal(page.dayOf({ fieldData: { Due: stored('2025-10-16') } }), 0);
      assert.equal(page.dayOf({ fieldData: { Due: stored('2026-11-16') } }), 0);
      const newOnDay = descendants(tree!).find((n) => n.attrs['aria-label'] === 'New on October 20')!;
      (newOnDay.attrs.onclick as () => void)();
      assert.deepEqual(prefill, { Due: native ? stored('2026-10-20', '09:00:00') : '10/20/2026' + (type === 'timestamp' ? ' 09:00:00' : '') });
      controls.find((c) => c.dataset.field === 'Title')!.value = 'New event';
      page.save({ fieldData: prefill }, true);
      await completion;
      assert.deepEqual(errors, []);
      assert.deepEqual(store.get('Events', created!, 'iso').fieldData, { Title: 'New event', Due: stored('2026-10-20', '09:00:00') });
      assert.deepEqual(eventDays(), [[first, '1'], [middle, '16'], [created, '20'], [last, '31']]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
