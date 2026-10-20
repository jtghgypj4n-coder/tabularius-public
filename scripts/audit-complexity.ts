// Synthetic-only measurements. Worker deadlines protect the audit runner even
// when the measured synchronous implementation has no interruptible deadline.
// No child processes or network; never reads a hosted database or corpus.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { evaluate, text } from '../packages/calc/src/index.ts';
import { guardedTest, guardedReplace } from '../packages/calc/src/regex-guard.ts';
import { translate } from '../packages/calc/src/mbs-regex.ts';
import { parseJson, compact } from '../packages/calc/src/mbs-json.ts';
import { jsonPathMatches } from '../packages/calc/src/jsonpath.ts';
import { jmesSearch } from '../packages/calc/src/jmespath.ts';
import { parseXmlDocument } from '../packages/calc/src/xpath.ts';
import { sortKey } from '../packages/calc/src/collation.ts';
import { beginFindBudget, registerFindFunctions, findWhere } from '../packages/store/src/find.ts';
import { readCalendar } from '../packages/store/src/calendar.ts';
import { valueListOrder } from '../packages/store/src/value-list-sort.ts';
import { join } from '../packages/server/src/odata-crossjoin-worker.ts';

const cases = ['find-wildcards', 'find-invalid', 'substitute', 'pattern-count', 'filter', 'regex-backtrack', 'regex-expand', 'pcre-translate', 'mbs-regex', 'evaluate', 'jsonpath', 'jmespath', 'sql-like', 'sql-glob', 'odata-strings', 'csv', 'json', 'xml', 'xml-attributes', 'ics', 'html-escape', 'markdown', 'value-list-sort', 'unicode-collation', 'custom-recursion', 'cartesian', 'crossjoin', 'portal-filter', 'calculated-sort', 'summary'];
type Prepared = { run: () => unknown; close?: () => void };
async function prepare(kind: string, n: number, dir: string): Promise<Prepared> {
  const s = 'a'.repeat(n);
  const calc = (formula: string, input = s) => () => evaluate(formula, { variable: () => text(input) });
  switch (kind) {
    case 'substitute': return { run: calc('Substitute($v; "a"; $v)') };
    case 'pattern-count': return { run: calc('PatternCount($v; "aa")') };
    case 'filter': return { run: calc('Filter($v; "a")') };
    case 'regex-backtrack': return { run: () => guardedTest(/^(a+)+$/, s + '!') };
    case 'regex-expand': return { run: () => guardedReplace(/a/g, s, "$'") };
    case 'mbs-regex': return { run: calc('MBS("RegEx.Match"; "^(a+)+$"; $v)', s + '!') };
    case 'pcre-translate': return { run: () => translate('a?'.repeat(n), 0) };
    case 'evaluate': return { run: calc('Evaluate($v)', `SetRecursion(While([i=0]; i<${n}; [i=i+1]; i); 1000000000)`) };
    case 'jsonpath': {
      const doc = parseJson('['.repeat(Math.min(n, 500)) + '0' + ']'.repeat(Math.min(n, 500)));
      return { run: () => jsonPathMatches(doc, '$' + '..*'.repeat(n)) };
    }
    case 'jmespath': {
      const doc = parseJson('[' + Array(n).fill('0').join(',') + ']');
      return { run: () => jmesSearch(doc, 'sort(@)', { parse: parseJson, compact }) };
    }
    case 'csv': {
      const { importFileRowIterator } = await import('../packages/scripts/src/engine.ts');
      const data = Buffer.from('"a","b"\n'.repeat(n));
      return { run: () => { let rows = 0; for (const _ of importFileRowIterator('generated.csv', data)) rows++; return rows; } };
    }
    case 'json': return { run: () => parseJson('[' + Array(n).fill('0').join(',') + ']') };
    case 'xml': return { run: () => parseXmlDocument('<a>'.repeat(n) + '</a>'.repeat(n)) };
    case 'xml-attributes': {
      const input = '<a ' + Array.from({ length: n }, (_, i) => `a${i}="x"`).join(' ') + '/>';
      return { run: () => parseXmlDocument(input) };
    }
    case 'ics': return { run: () => readCalendar('BEGIN:VCALENDAR\r\n' + 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260101\r\nSUMMARY:a\r\nEND:VEVENT\r\n'.repeat(n) + 'END:VCALENDAR') };
    case 'html-escape': {
      const { docsHtml } = await import('../packages/server/src/docs.ts');
      return { run: () => docsHtml('<>&"'.repeat(n), 'generated') };
    }
    case 'markdown': {
      const { docsHtml } = await import('../packages/server/src/docs.ts');
      return { run: () => docsHtml('['.repeat(n) + 'x', 'generated') };
    }
    case 'unicode-collation': return { run: () => sortKey('a\u0301'.repeat(n), 'en') };
    case 'value-list-sort': {
      const values = Array.from({ length: n }, (_, i) => text(String(n - i)));
      const order = valueListOrder({ type: 'text' }, 'MDY', []);
      return { run: () => values.sort(order.compare) };
    }
    case 'custom-recursion': return { run: () => evaluate(`R(${n})`, { customFunction: () => ({ parameters: ['n'], formula: 'If(n<=0; 0; R(n-1))' }) }) };
    case 'crossjoin': {
      const rows = Array.from({ length: Math.ceil(Math.sqrt(n)) }, (_, i) => [i]);
      return { run: () => join({ tables: [0, 1].map(i => ({ columns: [{ name: `t${i}_id`, type: 'number' }], rows })), params: [], sort: [], limit: 10, skip: 0, count: true, deadline: Date.now() + 500 }) };
    }
    case 'find-wildcards': case 'find-invalid': case 'sql-like': case 'sql-glob': case 'odata-strings': {
      const { filterSql } = kind === 'odata-strings' ? await import('../packages/server/src/odata.ts') : { filterSql: undefined };
      const db = new DatabaseSync(':memory:');
      registerFindFunctions(db);
      let run: () => unknown;
      if (kind === 'find-wildcards') run = () => {
        const end = beginFindBudget();
        try { return db.prepare('SELECT fm_find_text(?, ?, 0)').get(s + '!', '==' + '*a'.repeat(Math.min(n, 100)) + 'b'); } finally { end(); }
      };
      else if (kind === 'find-invalid') run = () => {
        const q = findWhere([{ v: '?' }], new Map([['v', { name: 'v', type: 'number' }]]), x => x);
        return db.prepare(`SELECT * FROM (SELECT ? AS v) WHERE ${q.where}`).all(s, ...q.params);
      };
      else if (kind === 'odata-strings') run = () => {
        const q = filterSql!("endswith(v, 'a') and contains(v, 'b')", [{ name: 'v', field: 'v', type: 'text', edm: 'Edm.String', queryable: true, writable: true }]);
        return db.prepare(`SELECT * FROM (SELECT ? AS v) WHERE ${q.where}`).all(s + 'b', ...q.params);
      };
      else run = () => db.prepare(kind === 'sql-like' ? 'SELECT ? LIKE ?' : 'SELECT ? GLOB ?').get(s + '!', (kind === 'sql-like' ? '%a' : '*a').repeat(Math.min(n, 100)) + 'b');
      return { run, close: () => db.close() };
    }
  }
  const { createStore, Store } = await import('../packages/store/src/index.ts');
  const path = pathJoin(dir, 'generated.sqlite');
  createStore(path);
  const store = new Store(path);
  store.applyDesign([
    { op: 'createTable', name: 'P', fields: [{ name: 'N', type: 'number' }] },
    { op: 'createTable', name: 'T', fields: [{ name: 'N', type: 'number' }] },
    { op: 'createRelationship', left: 'P', right: 'T', predicates: [{ left: 'N', operator: '×', right: 'N' }] },
    { op: 'createField', table: 'T', name: 'C', type: 'number', kind: 'calculation', calculation: 'N * 2', options: { unstored: true } },
    { op: 'createField', table: 'T', name: 'S', kind: 'summary', summary: { type: 'total', field: 'C' } },
  ] as never);
  store.sql.exec('BEGIN');
  const insert = store.sql.prepare('INSERT INTO T (N) VALUES (?)');
  for (let i = 0; i < n; i++) insert.run(n - i);
  store.sql.exec('INSERT INTO P (N) VALUES (1)');
  store.sql.exec('COMMIT');
  const close = () => store.close();
  if (kind === 'calculated-sort') return { run: () => store.find('T', { sort: [{ fieldName: 'C', sortOrder: 'ascend' }], limit: 1 }), close };
  if (kind === 'summary') return { run: () => store.find('T', { limit: 1 }), close };
  if (kind === 'cartesian') return { run: () => store.evaluate('P', 'Sum(T::N)', 1), close };
  const layout = store.design('P')!;
  const to = store.schema.tableOccurrences.find(t => t.name === 'T')!;
  store.applyDesign([{ op: 'updateLayout', layout: 'P', design: { objects: [...layout.objects, {
    id: 900, kind: 'portal', type: 9, anchors: { left: true, top: true, right: false, bottom: false }, bounds: { top: 0, left: 0, bottom: 100, right: 100 }, style: {}, children: [],
    portal: { tableOccurrenceId: to.id, tableOccurrence: 'T', rows: 4, initialRow: 1, filter: 'T::N > 0 and Sum(P::N) > 0' },
  }] } as never }]);
  return { run: () => store.get('P', 1, 'us', { T: { limit: 10 } }), close };
}

if (!isMainThread) {
  const { kind, n, dir } = workerData;
  const job = await prepare(kind, n, dir);
  parentPort!.postMessage({ ready: true });
  parentPort!.once('message', () => {
    const memory = process.memoryUsage().heapUsed, start = performance.now();
    let status = 'ok', result: unknown, errorKind: string | undefined;
    try {
      result = job.run();
      if (result && typeof result === 'object' && ('refused' in result || ('value' in result && typeof result.value === 'string' && result.value.startsWith('[MBS] ERROR:')))) status = 'refused';
    } catch (e) {
      errorKind = e instanceof Error ? e.constructor.name : 'unknown';
      status = ['ComplexityError', 'CalcError', 'MbsError', 'RegexTimeout', 'XPathError', 'FindError', 'RangeError', 'SyntaxError', 'StoreError'].includes(errorKind) ? 'refused' : 'error';
    }
    const heap = Math.max(0, process.memoryUsage().heapUsed - memory);
    parentPort!.postMessage({ status, ms: performance.now() - start, heap, ...(errorKind ? { errorKind } : {}) });
    void result;
    job.close?.();
  });
} else {
  for (const kind of cases.filter(k => !process.argv[2] || process.argv.slice(2).includes(k))) for (const n of [10, 1000, 100_000]) {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'complexity-audit-'));
    const record = await new Promise<Record<string, unknown>>(resolve => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { kind, n, dir }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
      let baseline = 0, peak = 0, ready = false, done = false;
      let timer = setTimeout(() => finish({ status: 'setup-timeout' }), 30_000);
      const sample = setInterval(() => { if (ready) peak = Math.max(peak, process.memoryUsage().rss - baseline); }, 10);
      const finish = (data: Record<string, unknown>) => {
        if (done) return;
        done = true; clearTimeout(timer); clearInterval(sample);
        void worker.terminate().then(() => resolve({ kind, n, ...data, rssGrowth: Math.max(0, peak) }));
      };
      worker.on('message', m => {
        if (m.ready) {
          ready = true; baseline = process.memoryUsage().rss;
          clearTimeout(timer); timer = setTimeout(() => finish({ status: 'audit-timeout', ms: 1000 }), 1000);
          worker.postMessage({ start: true });
        } else finish(m);
      });
      worker.on('error', e => finish({ status: (e as { code?: string }).code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'audit-memory-limit' : 'setup-error' }));
      worker.on('exit', code => { if (!done) finish({ status: 'worker-exit', code }); });
    });
    rmSync(dir, { recursive: true, force: true });
    console.log(JSON.stringify(record));
  }
}
