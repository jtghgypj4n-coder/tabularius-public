#!/usr/bin/env node
// Check the runtime before Node tries to load TypeScript or node:sqlite.
const { minimumNode, nodeSupports } = require('./node-version.cjs');
if (!nodeSupports(process.versions.node)) {
  console.error(`Tabularius needs Node ${minimumNode} or later (https://nodejs.org).`);
  process.exit(1);
} else {
  // The command was called openhbam before it was Tabularius; that name still works. Someone typing it is told once, on a
  // terminal only, so scripts that run it see nothing new.
  const alias = process.env.TABULARIUS_ALIAS === 'openhbam' || /^openhbam(?:\.cmd|\.exe)?$/i.test(require('node:path').basename(process.argv[1] ?? ''));
  delete process.env.TABULARIUS_ALIAS;
  if (alias && process.stderr.isTTY) console.error('The openhbam command is now called tabularius; openhbam still works but will be removed in a later version.');
  import('./main.ts');
}
