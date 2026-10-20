// `tabularius check-solution <folder> <database>`: exit 0 when nothing is wrong, 2 when problems are found, 1 when it could not run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, createStore, type DesignOp } from '../../store/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const cli = (...args: string[]) => runCli(main, args);

function build(dir: string, ops: DesignOp[]): void {
  const file = join(dir, 'Shop.openhbam.sqlite');
  createStore(file, { mode: 'native' });
  const s = new Store(file, 'Shop');
  try {
    s.applyDesign(ops);
  } finally {
    s.close();
  }
}

const WHOLE: DesignOp[] = [
  { op: 'createTable', name: 'Orders', fields: [{ name: 'Number' }, { name: 'Total', type: 'number' }] },
  { op: 'createScript', name: 'Helper', text: 'Set Variable [ $x ; 1 ]' },
  { op: 'createScript', name: 'Main', text: 'Perform Script [ "Helper" ]' },
];

test('check-solution: 0 for a solution with nothing wrong (information does not fail it), 2 when problems are found, with text and JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-check-solution-cli-'));
  try {
    build(dir, WHOLE);
    let r = await cli('check-solution', dir, 'Shop');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Script "Main": No script, button, trigger or menu runs it/);
    assert.match(r.stdout, /Shop: 0 errors, 0 warnings, 1 to tidy/);

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-solution: problems exit 2, say where and how to fix, and --json has the same findings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-check-solution-cli-'));
  try {
    build(dir, [...WHOLE, { op: 'deleteScript', script: 'Helper' }, { op: 'createScript', name: 'Folder', text: 'Get Folder Path [ $p ]' }]);
    const text = await cli('check-solution', dir, 'Shop');
    assert.equal(text.status, 2, text.stderr);
    assert.match(text.stdout, /error\s+Script "Main", line 1: There is no script named "helper"/);
    assert.match(text.stdout, /\n\s+fix: Point the step at a script that exists/);
    assert.match(text.stdout, /warning\s+Script "Folder", line 1: Get Folder Path is not available in this build/);
    assert.match(text.stdout, /Shop: 1 error, 1 warning, /);

    const json = await cli('check-solution', dir, 'Shop', '--json');
    assert.equal(json.status, 2);
    const result = JSON.parse(json.stdout) as { database: string; counts: Record<string, number>; findings: { kind: string; severity: string; where: string; message: string; hint: string }[] };
    assert.equal(result.database, 'Shop');
    assert.deepEqual(result.counts, { error: 1, warning: 1, info: 2 });
    assert.deepEqual(result.findings.map((f) => f.kind), ['missing-script', 'step-unavailable', 'unused-script', 'unused-script']);
    for (const f of result.findings) assert.ok(f.where && f.message && f.hint);

    // An error fails the run whatever --fail-on says.
    assert.equal((await cli('check-solution', dir, 'Shop', '--fail-on', 'error')).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-solution: a warning fails the run unless --fail-on error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-check-solution-cli-'));
  try {
    build(dir, [...WHOLE, { op: 'createScript', name: 'Folder', text: 'Get Folder Path [ $p ]' }]);
    assert.equal((await cli('check-solution', dir, 'Shop')).status, 2);
    assert.equal((await cli('check-solution', dir, 'Shop', '--fail-on', 'error')).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-solution: usage mistakes exit 1 and print nothing on stdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-check-solution-cli-'));
  try {
    build(dir, WHOLE);
    for (const [args, message] of [
      [['check-solution'], /give a file or folder/],
      [['check-solution', dir], /give a database/],
      [['check-solution', dir, 'Nope'], /Nope.*doesn't exist/],
      [['check-solution', dir, 'Shop', '--account', 'nobody'], /no account named "nobody"/],
      [['check-solution', dir, 'Shop', '--fail-on', 'info'], /--fail-on is error or warning/],
    ] as const) {
      const r = await cli(...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.equal(r.stdout, '', args.join(' '));
      assert.match(r.stderr, message, args.join(' '));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-solution: --account or --fail-on with no value is a usage error (1), not a run that ignores it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-check-solution-cli-'));
  try {
    build(dir, WHOLE);
    for (const flag of ['--account', '--fail-on']) {
      const r = await cli('check-solution', dir, 'Shop', flag);
      assert.equal(r.status, 1, `${flag}: ${r.stdout}`);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, new RegExp(`${flag} needs `));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
