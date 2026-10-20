// `tabularius test-scripts --json` writes a line per script as each finishes, so a
// run that dies part way keeps every result so far; a --skip matching nothing stops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(fixture) ? false : 'fixtures missing: run npm run fixtures';
const main = join(import.meta.dirname, '..', 'src', 'main.ts');

function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--no-warnings', main, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => ok({ code: code ?? -1, out, err }));
  });
}

test('--json is one JSON line per script, then a summary line', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-test-scripts-cli-'));
  try {
    copyFileSync(fixture, join(dir, 'Flicks.fmp12'));
    const { out } = await cli('test-scripts', dir, 'Flicks', '--json');
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    const summary = lines.pop();
    assert.equal(summary.database, 'Flicks');
    assert.equal(summary.summary.scripts, lines.length);
    assert.ok(lines.length > 5);
    for (const l of lines) {
      assert.equal(l.database, 'Flicks');
      assert.equal(typeof l.script, 'string');
      assert.ok(['ok', 'error', 'stalled', 'crashed', 'skipped'].includes(l.outcome));
    }
    // --skip with --json: the matched scripts come first, as a line and on stderr, and are not run.
    const name = lines[0].script as string;
    const skipped = await cli('test-scripts', dir, 'Flicks', '--json', '--skip', `${name.slice(0, 3).toUpperCase()}*${name.slice(3)}`);
    const [head, ...rest] = skipped.out.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(head, { database: 'Flicks', skip: { patterns: [`${name.slice(0, 3).toUpperCase()}*${name.slice(3)}`], matches: [name] } });
    assert.match(skipped.err, new RegExp(`--skip matches 1 script in Flicks, not run:\\n  ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(!rest.some((l) => l.script === name));
    // --show prints the steps, literals masked, and runs nothing.
    const shown = await cli('test-scripts', dir, 'Flicks', '--show', '--script', name);
    assert.equal(shown.code, 0, shown.err);
    assert.ok(shown.out.startsWith(`== Flicks: ${name}\n`), shown.out);
    for (const line of shown.out.split('\n')) if (/^\s*(\/\/ )?#/.test(line)) assert.match(line, /^\s*(\/\/ )?# …$/);
    for (const [m] of shown.out.matchAll(/"(?:[^"\\]|\\.|"")*"/g)) assert.ok(m === '"…"' || m.length <= 3 || /^"[^\p{L}]{0,3}"$/u.test(m), m);
    // --lint runs nothing and lists loops that never end (Flicks has none).
    const linted = await cli('test-scripts', dir, 'Flicks', '--lint');
    assert.equal(linted.code, 0, linted.err);
    assert.equal(linted.out, '0 findings in Flicks\n');
    // A --skip pattern that matches nothing stops the run before anything runs.
    const typo = await cli('test-scripts', dir, 'Flicks', '--json', '--skip', 'No such script*');
    assert.equal(typo.code, 1);
    assert.equal(typo.out, '');
    assert.match(typo.err, /--skip "No such script\*" matches no script, so nothing was run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const drawers = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'DEMO_drawers.fmp12');

test('--show --function prints a custom function with literals and comments masked', { skip: existsSync(drawers) ? false : 'fixtures missing: run npm run fixtures' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-test-scripts-cli-'));
  try {
    copyFileSync(drawers, join(dir, 'DEMO_drawers.fmp12'));
    const shown = await cli('test-scripts', dir, 'DEMO_drawers', '--show', '--function', '#P');
    assert.equal(shown.code, 0, shown.err);
    // The formula stays readable; its comment block (author, examples) does not.
    assert.equal(shown.out, '== DEMO_drawers: function #P ( name )\n#Value ( Get ( ScriptParameter ) ; name )\n\n/* … */\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
