// Works out a hosted file's layout results off the request path (warmer.ts):
// each layout's first record is read as the Data API reads it, which works out
// its whole-table summaries, ExecuteSQL results and the calculations they rest
// on, and leaves them in the file's shared results for every process.

import { parentPort } from 'node:worker_threads';
import { Store } from '../../store/src/index.ts';

parentPort!.on('message', ({ path, name }: { path: string; name: string }) => {
  let store: Store | undefined;
  let layouts = 0;
  try {
    store = new Store(path, name);
    store.warming = true;
    store.shareResults();
    // Each table's summaries together first, in one pass over its records, largest tables first.
    const count = (name: string) => {
      try {
        return store!.recordCount(name);
      } catch {
        return 0; // a table with no records here (its SQLite table is missing): nothing to warm
      }
    };
    const tables = store.schema.tables.map((t) => ({ name: t.name, n: count(t.name) })).sort((a, b) => b.n - a.n);
    for (const t of tables) {
      try {
        store.warmSummaries(t.name);
      } catch {
        // one that fails (a calculation error, memory) is worked out by the layouts that show it
      }
    }
    for (const l of store.schema.layouts) {
      try {
        store.find(l.name, { limit: 1, layoutOnly: true });
        layouts++;
      } catch {
        // a layout on another file's table, or one with no table: nothing to warm here
      }
    }
  } catch {
    // the file went away or is busy: warmed next time
  } finally {
    store?.close();
    parentPort!.postMessage({ done: path, layouts });
  }
});
