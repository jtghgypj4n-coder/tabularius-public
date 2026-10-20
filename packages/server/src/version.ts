import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one place a version is read. Everything that says which Tabularius this is (the command line, the web client's About,
// the admin console, the Data API's productInfo, the MCP handshake, the metrics and the XML grammars) reads it from here.

const readJson = (url: URL): Record<string, any> | undefined => {
  try { return JSON.parse(readFileSync(url, 'utf8')) as Record<string, any>; } catch { return undefined; }
};

/** The server's version, from its package file (which the single-file release unpacks beside the code). */
export const SERVER_VERSION: string = String(readJson(new URL('../package.json', import.meta.url))?.version ?? 'unknown');

/** The oldest Node.js that runs it, as the project's `engines.node` says ("22.20"); the launcher and CI hold to the same line. */
export const NODE_MINIMUM: string = String(readJson(new URL('../../../package.json', import.meta.url))?.engines?.node ?? '').replace(/^>=/, '') || 'unknown';

// Written by scripts/build-release.ts into a release only, so it is not in a checkout.
const BUILD_INFO = 'build-info.json';

// The repository root. Only an optional look for `.git` is made there, so a Docker image that copies no `.git` loses nothing.
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let commit: string | null | undefined;

/**
 * The short commit this was built from: `build-info.json` beside the server's package file (a release writes it), else
 * the checkout's own HEAD. Undefined when neither is there, as with a copy of the files taken out of git.
 */
export function serverCommit(): string | undefined {
  if (commit === undefined) {
    commit = readJson(new URL(`../${BUILD_INFO}`, import.meta.url))?.commit ?? null;
    if (commit === null && existsSync(join(REPOSITORY_ROOT, '.git'))) {
      try {
        commit = execFileSync('git', ['-C', REPOSITORY_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null;
      } catch {
        commit = null;
      }
    }
  }
  return commit ?? undefined;
}

/** The version followed by the commit in brackets, or the version alone when the commit is not known. */
export function versionLabel(): string {
  const c = serverCommit();
  return c ? `${SERVER_VERSION} (${c})` : SERVER_VERSION;
}

/** What `tabularius --version` prints. */
export function versionText(runningNode: string = process.versions.node): string {
  return [
    `tabularius ${SERVER_VERSION}`,
    `commit ${serverCommit() ?? 'unknown'}`,
    `Node ${NODE_MINIMUM} or newer is needed; this is Node ${runningNode}`,
    '',
  ].join('\n');
}
