// Writes docs/reference/rest.md and docs/reference/mcp.md from the code and
// the notes in scripts/reference/ (npm run docs:reference). With --check it
// writes nothing and fails when either file is out of date.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REFERENCE_DIR, mcpListing, renderMcp, renderRest } from './reference/render.ts';
import { OPENAPI_FILE, openApiText } from './reference/openapi-file.ts';

const check = process.argv.includes('--check');
const docs = {
  'rest.md': renderRest(),
  'mcp.md': renderMcp(await mcpListing()),
};

let stale = 0;
mkdirSync(REFERENCE_DIR, { recursive: true });
// The OpenAPI description of the Data API and OData is built from the same route table; the server serves it.
const outputs: [string, string][] = [...Object.entries(docs).map(([name, text]): [string, string] => [join(REFERENCE_DIR, name), text]), [OPENAPI_FILE, openApiText()]];
for (const [file, text] of outputs) {
  const shown = relative(process.cwd(), file);
  let old: string | undefined;
  try {
    old = readFileSync(file, 'utf8');
  } catch {
    old = undefined;
  }
  if (old === text) {
    console.log(`${shown}: up to date`);
  } else if (check) {
    console.error(`${shown}: out of date; run npm run docs:reference`);
    stale++;
  } else {
    writeFileSync(file, text);
    console.log(`${shown}: written`);
  }
}
process.exitCode = stale ? 1 : 0;
