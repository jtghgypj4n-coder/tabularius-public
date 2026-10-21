// The start of the single-file Tabularius program (a Node single executable,
// built by scripts/build-release.ts). The program's files travel inside it
// as one packed asset; the first run of each version unpacks them into
// ~/.openhbam/runtime/<version>, and every run starts the command line from
// there, so it behaves exactly like `node packages/cli/src/main.ts`.
//
// The same executable also starts the server's own helper processes and
// installed services, which run it as `tabularius [--no-warnings [--eval <code>]] <file.ts> ...`:
// a .ts or .js file that exists as the first argument is run instead of the
// command line.

'use strict';
const { getAsset } = require('node:sea');
const { createRequire } = require('node:module');
const { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, chmodSync } = require('node:fs');
const { gunzipSync } = require('node:zlib');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');

const VERSION = getAsset('version', 'utf8').trim();
const root = join(process.env.TABULARIUS_HOME || process.env.OPENHBAM_HOME || join(homedir(), '.openhbam'), 'runtime', VERSION);

/** Unpacks the program's files, once per version; a half-finished unpack is never used. */
function unpack() {
  if (existsSync(join(root, '.complete'))) return;
  const partial = `${root}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  const pack = gunzipSync(Buffer.from(getAsset('app.pack')));
  const headerLength = pack.readUInt32LE(0);
  const files = JSON.parse(pack.subarray(4, 4 + headerLength).toString('utf8'));
  let at = 4 + headerLength;
  for (const f of files) {
    const out = join(partial, ...f.path.split('/'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, pack.subarray(at, at + f.size));
    if (f.mode & 0o111) chmodSync(out, 0o755);
    at += f.size;
  }
  writeFileSync(join(partial, '.complete'), VERSION);
  mkdirSync(dirname(root), { recursive: true });
  try {
    renameSync(partial, root);
  } catch (e) {
    // Another run unpacked it first.
    rmSync(partial, { recursive: true, force: true });
    if (!existsSync(join(root, '.complete'))) throw e;
  }
}

// The sandbox a hosted file's JavaScript custom functions run in (packages/store/src/javascript.ts):
// `tabularius --tabularius-js-sandbox <program> <limit>` runs the program with nothing unpacked or read, under the
// limits NODE_OPTIONS sets, since this executable doesn't read Node's flags from its command line. Without
// those limits in force (no permission model, code from strings allowed, or no memory cap) it runs nothing.
function jsSandbox() {
  let strings = true;
  try {
    (0, eval)('0');
  } catch {
    strings = false;
  }
  // The memory cap too (64 MB of heap is set; V8 adds its young generation on top).
  const heapMb = require('node:v8').getHeapStatistics().heap_size_limit / 1048576;
  if (!process.permission || strings || heapMb > 512) process.exit(3);
  require('node:vm').runInThisContext(`(function (require) {${process.argv[3]}\n})`, { filename: 'tabularius-js-sandbox' })(require);
}

/** Runs the command line, or the helper file named first, from the unpacked program. */
function start() {
  unpack();
  const args = process.argv.slice(2);
  if (args[0] === '--no-warnings') args.shift();
  // An installed service starts as `tabularius --no-warnings --eval <code> <main.ts> serve ...` (service.ts). The code
  // restores a renamed app folder for a checkout install and means nothing here: the program's files are unpacked, not renamed.
  if (args[0] === '--eval') args.splice(0, 2);
  const entry = args.length && /\.(ts|js|mjs|cjs)$/.test(args[0]) && existsSync(args[0])
    ? args.shift()
    : join(root, 'packages', 'cli', 'src', 'main.ts');
  // What `node --no-warnings` would hide: Node's notes about experimental features,
  // here and in the worker threads and processes the server starts.
  process.env.NODE_NO_WARNINGS = '1';
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, type, ...rest) {
    const kind = typeof type === 'object' && type ? type.type : type;
    if (kind === 'ExperimentalWarning' || (warning && warning.name === 'ExperimentalWarning')) return;
    return emitWarning.call(process, warning, type, ...rest);
  };
  process.argv = [process.execPath, entry, ...args];
  createRequire(entry)(entry);
}

if (process.argv[2] === '--tabularius-js-sandbox') jsSandbox();
else start();
