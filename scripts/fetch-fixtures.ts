// Download public sample .fmp12 files into fixtures/fmp12/. They are not
// committed here because their original authors' terms are unknown.
//   evanmiller/fmptools (MIT): small files with records and scripts
//   LonCook/filemaker-articles: relationships, container images, and a
//     FileMaker Database Design Report XML to check decoding against
//   msyk/INTER-Mediator: a 31-table test database
//   beezwax/semantic-search-fm, beezwax/unified-search-actions-fm (MIT):
//     FileMaker 2024 AI steps and functions, with stored embeddings

import '../packages/store/src/legacy-env.ts';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RAW = 'https://raw.githubusercontent.com/';
const FMPTOOLS = 'evanmiller/fmptools/main/test/data/fmp12/';
const LONCOOK = 'LonCook/filemaker-articles/main/';
const FLICKS = 'filemaker-web-viewer-series/articles/part-03-let-the-record-show/';
const FILES: Record<string, string> = {
  'Charts.fmp12': FMPTOOLS + 'Charts.fmp12',
  'FMburgh_2012_11_07_Database.fmp12': FMPTOOLS + 'FMburgh_2012_11_07_Database.fmp12',
  'PortableCode39-2.fmp12': FMPTOOLS + 'PortableCode39-2.fmp12',
  'Standards.fmp12': FMPTOOLS + 'Standards.fmp12',
  'Standards-unshuffled.fmp12': FMPTOOLS + 'Standards-unshuffled.fmp12',
  'Flicks.fmp12': LONCOOK + FLICKS + 'demo/Flicks_WebViewer_Framework_03_RankedViews.fmp12',
  'Flicks_ddr.xml': LONCOOK + FLICKS + 'source/final-target/Flicks_WebViewer_Framework_03_RankedViews_fmp12.xml',
  'DEMO_drawers.fmp12': LONCOOK + 'toolbox-series/articles/slide-out-drawers/demo/DEMO_drawers.fmp12',
  'InterMediator_TestDB.fmp12': 'msyk/INTER-Mediator/master/dist-docs/TestDB.fmp12',
  'BeezwaxSemanticSearch.fmp12': 'beezwax/semantic-search-fm/main/Beezwax%20Semantic%20Search.fmp12',
  'BeezwaxUnifiedSearchActions.fmp12': 'beezwax/unified-search-actions-fm/main/Beezwax%20Unified%20Search%20%2B%20Actions.fmp12',
};
const dir = join(import.meta.dirname, '..', 'fixtures', 'fmp12');
mkdirSync(dir, { recursive: true });
// A CI checkout wipes ignored files (git clean -x), so fixtures/ starts empty on every run and the downloads, a few
// minutes on a good day and a failed run on a bad one, were repeated each time. Files are also kept in a folder that
// outlives the checkout (TABULARIUS_FIXTURE_CACHE, else ~/.cache/tabularius-fixtures) and copied from there when present.
// `--refresh` downloads them all again, for when an upstream file changes.
const refresh = process.argv.includes('--refresh');
const cache = process.env.TABULARIUS_FIXTURE_CACHE ?? join(homedir(), '.cache', 'tabularius-fixtures');
try { mkdirSync(cache, { recursive: true }); } catch { /* a cache that can't be made just isn't used */ }
const kept = (file: string) => !refresh && existsSync(file) && statSync(file).size > 0;
// raw.githubusercontent.com sometimes stalls for minutes (a run once sat on
// one file until undici's 5-minute header timeout), and a 41 MB file can need
// more than a minute on a slow runner. So a try is cut off only when no bytes
// arrive for 30 s (or headers for 30 s), not by a total time, and a stalled
// file is tried up to 6 times.
const STALL_MS = 30_000;
async function download(name: string, url: string): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), STALL_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        clearTimeout(timer);
        timer = setTimeout(() => ctl.abort(), STALL_MS);
        parts.push(chunk);
        size += chunk.length;
      }
      const out = new Uint8Array(size);
      let at = 0;
      for (const p of parts) { out.set(p, at); at += p.length; }
      return out;
    } catch (e) {
      const why = ctl.signal.aborted ? `no data for ${STALL_MS / 1000} s` : (e as Error).message;
      if (attempt >= 6) throw new Error(`${name}: ${why}`);
      console.log(`${name}: ${why}; retrying (${attempt}/5)`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function fetchOne(name: string, path: string): Promise<string> {
  const dest = join(dir, name);
  if (kept(dest)) return `have ${name}`;
  const saved = join(cache, name);
  if (kept(saved)) {
    copyFileSync(saved, dest);
    return `from cache ${name}`;
  }
  const bytes = await download(name, RAW + path);
  writeFileSync(dest, bytes);
  try {
    // Written beside the name and renamed, so a run cut off half way never leaves a cut-short file to be trusted.
    writeFileSync(saved + '.part', bytes);
    renameSync(saved + '.part', saved);
  } catch { /* not cached */ }
  return `fetched ${name}`;
}

// Four at a time: the files come from the same host, and one slow file no longer holds up the others.
const queue = Object.entries(FILES);
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) console.log(await fetchOne(...next));
}));
