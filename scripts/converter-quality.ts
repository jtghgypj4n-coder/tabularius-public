// Converter quality: reads each .fmp12 file given (by default the demo corpus in fixtures/fmp12, which `npm run
// fixtures` downloads) and lists the layout objects that did not convert (store/layout-conversion.ts). Nothing is
// written. `--strict` exits 1 when any file has an error-level finding; `--json` prints the findings as JSON.
//   npm run converter-quality
//   npm run converter-quality -- --strict path/to/File.fmp12

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, readImageLibrary, readLayoutDesigns } from '../packages/fmp12/src/index.ts';
import { conversionText, layoutConversion, type ConversionQuality } from '../packages/store/src/index.ts';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const json = args.includes('--json');
const given = args.filter((a) => !a.startsWith('--'));
const corpus = join(import.meta.dirname, '..', 'fixtures', 'fmp12');
const files = given.length ? given : existsSync(corpus) ? readdirSync(corpus).filter((f) => f.endsWith('.fmp12')).sort().map((f) => join(corpus, f)) : [];
if (!files.length) {
  console.error('No .fmp12 files: give some, or run npm run fixtures first.');
  process.exit(2);
}

const results: { file: string; quality?: ConversionQuality; error?: string }[] = [];
for (const file of files) {
  try {
    const db = FmpDatabase.open(file);
    const { layouts } = readLayoutDesigns(db.file, db.schema);
    results.push({ file, quality: layoutConversion(layouts, db.schema, new Set(readImageLibrary(db.file).keys())) });
  } catch (e) {
    results.push({ file, error: (e as Error).message });
  }
}
if (json) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(r.quality ? conversionText(r.file.split('/').pop()!, r.quality) : `${r.file}: could not be read: ${r.error}`);
const bad = results.filter((r) => r.error || r.quality!.findings.some((f) => f.severity === 'error')).length;
if (!json) console.log(`\n${results.length} file${results.length === 1 ? '' : 's'}, ${bad} with errors`);
process.exit(strict && bad ? 1 : 0);
