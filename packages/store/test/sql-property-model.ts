// Generated inputs only. Expected token boundaries come from construction,
// independently of the production scanner; shrinking removes model atoms.
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stubDir = mkdtempSync(join(tmpdir(), 'openhbam-sql-path-'));
const marker = join(stubDir, 'called');
const oldPath = process.env.PATH;
for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
  writeFileSync(join(stubDir, name), `#!/bin/sh\nprintf called > '${marker}'\nexit 99\n`, { mode: 0o755 });
}
process.env.PATH = stubDir;
after(() => {
  try { assert.equal(existsSync(marker), false, 'a forbidden child command ran'); }
  finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(stubDir, { recursive: true, force: true });
  }
});

export const SEED = Number(process.env.OPENHBAM_SQL_PROPERTY_SEED ?? 0x2204cafe) >>> 0;
export function random(seed = SEED) {
  let state = seed;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}
export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const identifier = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const catalogProbes = [
  "SELECT p.name FROM Items, 'pragma_table_info' p WHERE p.arg = '_fm_totp'",
  "SELECT name FROM main.'pragma_table_info' WHERE arg = '_fm_totp'",
  "SELECT * FROM (SELECT 1) a, 'pragma_compile_options' c",
  "SELECT p.file FROM Items, 'pragma_database_list' p",
  'SELECT name FROM dbstat',
  "SELECT p.name FROM Items, 'dbstat' p",
  "SELECT name FROM main.'dbstat'",
];
export const payloads = [
  'FROM Items', 'JOIN Items', "FROM Items; DELETE FROM Items -- ' ",
  'ATTACH PRAGMA load_extension VACUUM INTO', '$1::int8 ?99', 'ILIKE public.x pg_catalog.pg_class',
  "trim(BOTH 'x' FROM y)", 'CURRENT_DATE FETCH FIRST 1 ROW ONLY', '= ANY (ARRAY[1])',
  'a"b`c[d] ‘Unicode’ “quotes” «日本語» café 🐈', '/* outer /* inner */ ; */', '-- ;\nSELECT',
  'ROWMODID inside a name', 'USER CURRENT_USER POSITION EXTRACT ROUND STRVAL',
];
export interface Atom { kind: 'word' | 'space' | 'string' | 'identifier' | 'comment' | 'symbol' | 'parameter'; text: string; normalized?: string }
export function model(next: (n: number) => number, postgres = false): Atom[] {
  const value = payloads[next(payloads.length)];
  const name = payloads[next(payloads.length)];
  const names = [identifier(name), '`' + name.replace(/`/g, '``') + '`'];
  if (!name.includes(']')) names.push('[' + name + ']');
  const strings = [literal(value)];
  if (postgres) strings.push("E'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'", '$body$' + value + '$body$');
  return [
    { kind: 'word', text: 'SELECT' }, { kind: 'space', text: ' ' },
    { kind: 'string', text: strings[next(strings.length)], normalized: literal(value) }, { kind: 'space', text: ' ' },
    { kind: 'word', text: 'AS' }, { kind: 'space', text: ' ' },
    { kind: 'identifier', text: names[next(names.length)], normalized: identifier(name) }, { kind: 'symbol', text: ',' },
    { kind: 'space', text: ' ' }, { kind: 'parameter', text: '$' + (next(9) + 1) },
    { kind: 'space', text: ' ' }, { kind: 'comment', text: '/* ' + '/* nested */ '.repeat(next(4)) + '; SELECT \' */' },
  ];
}

export async function property<T>(cases: T[], check: (value: T) => unknown | Promise<unknown>, shrink: (value: T) => T[] = () => []): Promise<void> {
  for (let i = 0; i < cases.length; i++) {
    try { await check(cases[i]); }
    catch (cause) {
      let small = cases[i];
      for (let attempts = 0; attempts < 64; attempts++) {
        let reduced = false;
        for (const candidate of shrink(small)) {
          try { await check(candidate); }
          catch { small = candidate; reduced = true; break; }
        }
        if (!reduced) break;
      }
      throw new Error(`seed=${SEED} case=${i}\nshrunk input=${JSON.stringify(small)}`, { cause });
    }
  }
}
export const shrinkAtoms = (atoms: Atom[]) => atoms.map((_, i) => atoms.filter((__, j) => j !== i));
export const shrinkText = (text: string) => text.length > 1 ? [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.floor(text.length / 2))] : [];
