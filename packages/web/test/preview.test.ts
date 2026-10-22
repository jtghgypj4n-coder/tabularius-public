import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageNumbers, pageSize, paginate, paginateColumns, printLimitNotice, PREVIEW_MAX } from '../src/preview.ts';
import { layoutWidth } from '../src/layout.ts';

test('preview pages: parts fill the space between header and footer, never split', () => {
  // A 100-point page with a 20-point header and 10-point footer leaves 70 for parts.
  const frame = { header: () => 20, footer: () => 10 };
  assert.deepEqual(paginate([30, 30, 30, 30], frame, 100), [[0, 1], [2, 3]]);
  // A part taller than the room still gets a page to itself.
  assert.deepEqual(paginate([10, 200, 10], frame, 100), [[0], [1], [2]]);
  // A taller title header on page one leaves less room there.
  const titled = { header: (p: number) => (p === 1 ? 50 : 20), footer: () => 10 };
  assert.deepEqual(paginate([30, 30, 30, 30], titled, 100), [[0], [1, 2], [3]]);
  // No parts (an empty found set): one page, with just the header and footer.
  assert.deepEqual(paginate([], frame, 100), [[]]);
});

test('preview pages: without a page setup, layouts wider than a portrait page print landscape', () => {
  const pick = ({ orientation, width, height }: ReturnType<typeof pageSize>) => ({ orientation, width, height });
  assert.deepEqual(pick(pageSize(500)), { orientation: 'portrait', width: 540, height: 720 });
  assert.deepEqual(pick(pageSize(773)), { orientation: 'landscape', width: 720, height: 540 });
  assert.deepEqual(pageSize(773).paper, { width: 792, height: 612 });
  // Layouts as wide as a sheet of A4 or Letter are drawn to it edge to edge.
  assert.deepEqual(pick(pageSize(595.275590551181)), { orientation: 'portrait', width: 595.28, height: 841.89 });
  assert.deepEqual(pick(pageSize(841)), { orientation: 'landscape', width: 841.89, height: 595.28 });
  assert.deepEqual(pageSize(612).margins, { top: 0, left: 0, bottom: 0, right: 0 });
});

test('layout and Preview use object overflow when choosing the page width', () => {
  const objects = [{ id: 1, kind: 'text', bounds: { left: 600, right: 700, top: 0, bottom: 20 } }];
  const width = layoutWidth(500, objects as never);
  assert.equal(width, 700);
  assert.equal(pageSize(width).orientation, 'landscape');
});

test("preview pages: the file's page setup decides the paper, orientation and margins", () => {
  // Standards: landscape Arch B (18 x 12 in) with the printer's 1/4 in margins.
  const margins = { top: 18, left: 18, bottom: 18, right: 18 };
  const size = pageSize(500, { orientation: 'landscape', paper: 'arch-b', width: 1296, height: 864, margins });
  assert.deepEqual(size, { orientation: 'landscape', width: 1260, height: 828, paper: { width: 1296, height: 864 }, margins, scale: 1 });
});

test('page setup scale enlarges the printable layout area while retaining physical paper and margins', () => {
  const size = pageSize(500, { orientation: 'portrait', width: 612, height: 792, margins: { top: 36, left: 36, bottom: 36, right: 36 }, scale: 0.5 });
  assert.equal(size.width, 1080);
  assert.equal(size.height, 1440);
  assert.deepEqual(size.paper, { width: 612, height: 792 });
  assert.deepEqual(size.margins, { top: 36, left: 36, bottom: 36, right: 36 });
});

test('fixed layout margins override file margins and apply when no file page setup exists', () => {
  const fixed = { top: 12, left: 18, bottom: 24, right: 30 };
  const setup = pageSize(500, { orientation: 'portrait', width: 612, height: 792, margins: { top: 36, left: 36, bottom: 36, right: 36 } }, fixed);
  assert.equal(setup.width, 564);
  assert.equal(setup.height, 756);
  assert.deepEqual(setup.margins, fixed);
  const inferred = pageSize(500, undefined, fixed);
  assert.equal(inferred.width, 564);
  assert.equal(inferred.height, 756);
});

test('printing over the preview cap offers a complete PDF path', () => {
  assert.equal(printLimitNotice(PREVIEW_MAX), undefined);
  assert.match(printLimitNotice(PREVIEW_MAX + 1) ?? '', /first 500 of 501 found records/);
  assert.match(printLimitNotice(PREVIEW_MAX + 1) ?? '', /save all records as PDF/);
  assert.match(printLimitNotice(PREVIEW_MAX + 1) ?? '', /Cancel to print nothing/);
});

test('margins wider than the paper leave a printable area of 0, never less', () => {
  const huge = { top: 500, left: 400, bottom: 500, right: 400 };
  for (const size of [pageSize(500, undefined, huge), pageSize(612, undefined, huge), pageSize(500, { orientation: 'portrait', width: 612, height: 792, margins: huge })]) {
    assert.deepEqual([size.width, size.height], [0, 0]);
  }
});

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('Preview mode lays out pages with the layout\'s fixed page margins', () => {
  assert.match(main, /pageSize\(r\.width, this\.meta!\.pageSetup, this\.meta!\.design\.fixedMargins\)/);
});

test('printing over the cap asks only a person, and Cancel prints nothing', () => {
  const print = main.slice(main.indexOf('async print(fromScript = false)'), main.indexOf('window.print();', main.indexOf('async print(fromScript = false)')));
  assert.match(print, /const warning = fromScript \? undefined : printLimitNotice\(this\.foundCount\);/);
  // Whatever confirm answers, the warning path returns before Preview and the print dialog.
  assert.match(print, /if \(warning\) \{\s*if \(confirm\(warning\)\) await this\.doCommand\('Save Records as PDF'\);\s*return;\s*\}/);
});

test('part page breaks: before a part, after every N, and page numbers starting again', () => {
  const frame = { header: () => 0, footer: () => 0 };
  // A sub-summary (index 0 and 3) with "new page before each": the first one doesn't leave an empty page.
  const before = (i: number) => i === 0 || i === 3;
  assert.deepEqual(paginate([10, 10, 10, 10, 10, 10], frame, 100, { before }), [[0, 1, 2], [3, 4, 5]]);
  // A body with "new page after every 2".
  assert.deepEqual(paginate([10, 10, 10, 10, 10], frame, 100, { after: (i) => i % 2 === 1 }), [[0, 1], [2, 3], [4]]);
  // No empty page after a break on the last part.
  assert.deepEqual(paginate([10, 10], frame, 100, { after: () => true }), [[0], [1]]);
  // Numbers start again after the page holding part 2.
  assert.deepEqual(pageNumbers([[0], [1, 2], [3], [4]], (i) => i === 2), [1, 2, 1, 2]);
});

test('print in columns: across first fills rows of N, down first fills a column then the next', () => {
  const frame = { header: () => 0, footer: () => 0 };
  const at = (r: ReturnType<typeof paginateColumns>) => r.pages.map((p) => p.map((x) => `${x.index}:${x.column}@${x.top}`));
  // Five 40pt records in 2 columns on a 100pt page: rows of two, a new page for the third row.
  assert.deepEqual(at(paginateColumns([40, 40, 40, 40, 40], () => false, frame, 100, { count: 2 })), [['0:0@0', '1:1@0', '2:0@40', '3:1@40'], ['4:0@0']]);
  // Down first: two to a column, the second column, then the next page.
  assert.deepEqual(at(paginateColumns([40, 40, 40, 40, 40], () => false, frame, 100, { count: 2, order: 'down' })), [['0:0@0', '1:0@40', '2:1@0', '3:1@40'], ['4:0@0']]);
  // A row is as tall as its tallest part.
  assert.deepEqual(at(paginateColumns([20, 50, 20], () => false, frame, 200, { count: 2 })), [['0:0@0', '1:1@0', '2:0@50']]);
  // A grand summary spans the page below the columns, and columns start again under it.
  const r = paginateColumns([10, 40, 40, 40, 10], (i) => i === 0 || i === 4, frame, 200, { count: 2, order: 'down' });
  assert.deepEqual(at(r), [['0:-1@0', '1:0@10', '2:0@50', '3:0@90', '4:-1@130']]);
  assert.deepEqual(r.used, [140]);
  // A page break before a part still starts a new page.
  assert.deepEqual(at(paginateColumns([10, 10, 10], () => false, frame, 200, { count: 3 }, { before: (i) => i === 2 })), [['0:0@0', '1:1@0'], ['2:0@0']]);
});

test('the browser copy of the page geometry equals the one the PDF layout uses', () => {
  const copy = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(copy('../src/preview.ts'), copy('../../fmp12/src/page-geometry.ts'));
});
