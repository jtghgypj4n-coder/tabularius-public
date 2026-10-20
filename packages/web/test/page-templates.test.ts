import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPage, pickTable, planDashboard } from '../src/page-templates.ts';
import { modernPage, modernDesign } from '../src/page-source.ts';
import type { DesignField, DesignTable } from '../src/design/client.ts';

const f = (id: number, name: string, type: DesignField['type'] = 'text', kind: DesignField['kind'] = 'normal', global = false): DesignField =>
  ({ id, name, type, kind, ...(global ? { options: { global: true, unstored: false, repetitions: 1 } } : {}) } as DesignField);
const invoices: DesignTable = { id: 1, name: 'Invoices', records: 500, fields: [f(1, 'InvoiceID', 'number'), f(2, 'Customer'), f(3, 'Status'), f(4, 'Total', 'number'), f(5, 'Date', 'date'), f(6, 'gFilter', 'text', 'normal', true), f(7, 'Calc', 'number', 'calculation')] };

test('dashboard templates: the plan takes the measure, category and date from names and types, never keys, globals or calculations', () => {
  const plan = planDashboard(invoices);
  assert.deepEqual(plan, { table: 'Invoices', measure: 'Total', category: 'Status', date: 'Date', shown: ['Customer', 'Status', 'Total'] });
  // A table with nothing to measure or group by still gets a dashboard of counts and the latest records.
  assert.deepEqual(planDashboard({ id: 2, name: 'Notes', records: 3, fields: [f(1, 'Body')] }), { table: 'Notes', shown: ['Body'] });
  assert.equal(pickTable([{ ...invoices, records: 5 }, { id: 9, name: 'Big', records: 90, fields: [] }])?.name, 'Big');
});

test('dashboard templates: the page is a modern layout page, with names kept out of the markup and script structure', () => {
  const nasty = 'Q4 </script><b>"x"';
  const html = dashboardPage(nasty, nasty, { table: 'T</script>', measure: 'A"B', shown: ['x'] });
  // Only the page's own script tag closes; the names inside it are escaped.
  assert.equal(html.split('</script>').length, 2);
  assert.ok(!html.includes('<b>"x"'));
  assert.ok(html.includes('"layout":"Q4 \\u003c/script>'));
  const design = modernDesign('D', 'D', html);
  assert.equal(modernPage(design.objects)?.html, html);
  assert.ok(design.objects[0].webUrl!.length < 30000, `${design.objects[0].webUrl!.length} characters`);
  // The page runs: every script statement parses.
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
});

test('landing pages: a colour per set, a script that routes by set name, names escaped', async () => {
  const { HOME_PREFIX, hueOf, homePage, homeScript } = await import('../src/page-templates.ts');
  assert.equal(hueOf('Clerk'), hueOf('Clerk'));
  assert.notEqual(hueOf('Clerk'), hueOf('Manager'));
  assert.ok(hueOf('[Full Access]') >= 0 && hueOf('[Full Access]') < 360);
  assert.equal(homeScript([{ set: 'A', layout: `${HOME_PREFIX}A` }, { set: 'B"x', layout: `${HOME_PREFIX}B"x` }]),
    'If [ Get ( AccountPrivilegeSetName ) = "A" ]\n  Go to Layout [ "Home - A" ]\nElse If [ Get ( AccountPrivilegeSetName ) = "B\\"x" ]\n  Go to Layout [ "Home - B\\"x" ]\nEnd If');
  assert.equal(homeScript([]), '');
  const html = homePage('Home - </script>', '</script>"');
  assert.equal(html.split('</script>').length, 2);
});

test('flavours: each is backed by the fields it needs, suggested by the table name, and the page still parses', async () => {
  const { flavourOf } = await import('../src/page-templates.ts');
  const stock: DesignTable = { id: 3, name: 'Products', records: 9, fields: [f(1, 'Name'), f(2, 'Qty On Hand', 'number'), f(3, 'Price', 'number')] };
  assert.equal(flavourOf(stock), 'inventory');
  assert.equal(flavourOf(invoices), 'invoicing');
  assert.equal(flavourOf({ id: 4, name: 'Contacts', records: 1, fields: [] }), 'crm');
  assert.equal(flavourOf({ id: 5, name: 'Notes', records: 1, fields: [] }), undefined);
  assert.equal(planDashboard(stock, 'inventory').stock, 'Qty On Hand');
  // Asked for without the fields to back it, the flavour is left out and a general dashboard comes back.
  assert.equal(planDashboard({ id: 6, name: 'Notes', records: 1, fields: [f(1, 'Body')] }, 'inventory').flavour, undefined);
  assert.equal(planDashboard(invoices, 'invoicing').flavour, 'invoicing');
  assert.equal(planDashboard(invoices, 'general').flavour, undefined);
  for (const [t, fl] of [[stock, 'inventory'], [invoices, 'invoicing'], [{ ...invoices, name: 'Contacts' }, 'crm']] as const) {
    const html = dashboardPage('T', 'T', planDashboard(t, fl));
    assert.doesNotThrow(() => new Function(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))));
  }
  assert.ok(dashboardPage('T', 'T', planDashboard(stock, 'inventory')).includes('id="low"'));
  assert.ok(!dashboardPage('T', 'T', planDashboard(stock)).includes('id="low"'));
});

test('dashboard templates: a table with a container field gets a gallery of its latest pictures', () => {
  const photos: DesignTable = { id: 3, name: 'Photos', records: 4, fields: [f(1, 'Title'), f(2, 'Photo', 'container'), f(3, 'gPic', 'container', 'normal', true)] };
  const plan = planDashboard(photos);
  assert.equal(plan.picture, 'Photo');
  const html = dashboardPage('P', 'P', plan);
  assert.ok(html.includes('id="pics"') && html.includes('tabularius.image('));
  assert.ok(!dashboardPage('N', 'N', planDashboard(invoices)).includes('id="pics"'));
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
});

test('dashboard templates: a category also gets a share-of-total donut, and none without one', () => {
  const html = dashboardPage('I', 'I', planDashboard(invoices));
  assert.ok(html.includes('id="share"') && html.includes('function donut('));
  assert.ok(!dashboardPage('N', 'N', planDashboard({ id: 2, name: 'Notes', records: 3, fields: [f(1, 'Body')] })).includes('id="share"'));
});

test('dashboard templates: a date field adds a period picker that narrows every figure, and none without a date', () => {
  const html = dashboardPage('I', 'I', planDashboard(invoices));
  assert.ok(html.includes('id="period"') && html.includes('<option value="last 30 days">'));
  assert.ok(html.includes('id="count-trend"') && html.includes('function before('));
  assert.ok(!dashboardPage('N', 'N', planDashboard({ id: 2, name: 'Notes', records: 3, fields: [f(1, 'Body')] })).includes('id="period"'));
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
});

test('dashboard templates: a category makes bars and slices choosable, and none without one', () => {
  const html = dashboardPage('I', 'I', planDashboard(invoices));
  assert.ok(html.includes('id="picked"') && html.includes('function choose('));
  assert.ok(!dashboardPage('N', 'N', planDashboard({ id: 2, name: 'Notes', records: 3, fields: [f(1, 'Body')] })).includes('id="picked"'));
});

test('dashboard templates: the trend line says how a figure moved, rounded, from nothing, and when it did not', () => {
  const html = dashboardPage('I', 'I', planDashboard(invoices));
  const src = /  function change\(now, then\) \{[\s\S]*?\n  \}\n/.exec(html)![0];
  const change = new Function(`${src}; return change;`)() as (now: number, then: number) => { text: string; dir: string };
  assert.deepEqual(change(112, 100), { text: '▲ 12%', dir: 'up' });
  assert.deepEqual(change(92, 100), { text: '▼ 8%', dir: 'down' });
  assert.deepEqual(change(5, 0), { text: '▲ up from none', dir: 'up' });
  assert.deepEqual(change(0, 0), { text: 'No change', dir: '' });
  assert.deepEqual(change(7, 7), { text: 'No change', dir: '' });
  // Rounds to the nearest whole percent (a move too small to round up reads "under 1%"), and a fall to nothing is 100%.
  assert.equal(change(1005, 1000).text, '▲ 1%');
  assert.equal(change(1004, 1000).text, '▲ under 1%');
  assert.equal(change(0, 40).text, '▼ 100%');
  // A negative earlier figure (a net loss) compares against its size: -50 to -25 is up 50%.
  assert.deepEqual(change(-25, -50), { text: '▲ 50%', dir: 'up' });
  assert.deepEqual(change(-75, -50), { text: '▼ 50%', dir: 'down' });
});

test('dashboard templates: bars grow up from a zero line, and a negative value hangs below it', () => {
  const html = dashboardPage('I', 'I', planDashboard(invoices));
  const src = /  function barBoxes\(v, H\) \{[\s\S]*?\n  \}\n/.exec(html)![0];
  const boxes = new Function(`${src}; return barBoxes;`)() as (v: number[], H: number) => { y: number; h: number }[];
  // All positive: the tallest bar fills the plot and every bar sits on the same floor (H - 22).
  const up = boxes([10, 5, 0], 220);
  assert.equal(up[0].y, 14);
  assert.equal(up[0].h, 184);
  assert.equal(up[1].y + up[1].h, 198);
  assert.equal(up[2].h, 0);
  // Mixed: no height is ever negative, positives end on the zero line and negatives start there.
  const mix = boxes([30, -10], 220);
  assert.ok(mix.every((b) => b.h >= 0));
  assert.equal(mix[0].y + mix[0].h, mix[1].y);
  assert.ok(mix[1].h > 0 && mix[1].y + mix[1].h <= 198);
  // All negative: the zero line is at the top and the bars hang from it.
  const down = boxes([-4, -2], 220);
  assert.equal(down[0].y, 14);
  assert.equal(down[0].h, 184);
  assert.equal(down[1].h, 92);
});
