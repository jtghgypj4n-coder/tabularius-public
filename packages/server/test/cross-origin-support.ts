import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
export { routeGroups, routes } from '../../../scripts/audit-cross-origin.ts';

export function concretePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_all, key: string) => ({ version: 'vLatest', database: 'Synthetic', layout: 'Records', recordId: '1', id: '1', grammar: 'fmresultset' }[key] ?? 'audit'));
}

/** No inherited executable search path, including for the browser's descendants. */
export function stubPath(t: TestContext, dir: string): void {
  const bin = join(dir, 'bin');
  const marker = join(dir, 'forbidden-command');
  mkdirSync(bin);
  for (const command of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
    writeFileSync(join(bin, command), `#!/bin/sh\nprintf '%s\\n' '${command}' >> '${marker.replaceAll("'", "'\\''")}'\nexit 99\n`, { mode: 0o700 });
  }
  const prior = process.env.PATH;
  process.env.PATH = bin;
  t.after(() => { if (prior === undefined) delete process.env.PATH; else process.env.PATH = prior; });
  t.after(() => assert.equal(existsSync(marker), false, 'a forbidden child command was attempted'));
}
