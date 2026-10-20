// examples/time-tracking: hours logged against projects, with a summary report. Built from an empty database with
// `tabularius design-apply`, then used the way the example's README says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'time-tracking');

test('the time-tracking example totals hours and money per project and reports hours by person', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-time-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    let r = run('new', dir, 'Time');
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'Time', example, '--apply');
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'Time', example);
    assert.match(r.stdout, /Time: nothing to change \(\d+ files already match\)/);

    const s = new Store(join(dir, 'Time.openhbam.sqlite'), 'Time');
    try {
      assert.deepEqual(s.schema.tables.map((t) => t.name).sort(), ['Entries', 'Projects']);
      assert.equal(s.schema.relationships.length, 1);
      s.create('Projects', { Name: 'Website', 'Hourly Rate': '80' });
      s.create('Projects', { Name: 'Support', 'Hourly Rate': '50' });
      const log = (parameter: string) => runScript(s, 'Log time', { layout: 'Entries', parameter });

      assert.equal((await log('1|Ana|2.5')).result, 'logged');
      await log('1|Ben|4');
      await log('1|Ana|1');
      await log('2|Ana|3');
      assert.equal((await log('1||2')).result, 'need a person and some hours');
      assert.equal((await log('1|Ana|0')).result, 'need a person and some hours');

      const project = (id: number) => s.get('Projects', id).fieldData;
      assert.deepEqual([project(1).Hours, project(1).Billable], [7.5, 600]);
      assert.deepEqual([project(2).Hours, project(2).Billable], [3, 150]);
      assert.equal(s.get('Entries', 1).fieldData.Amount, 200);
      assert.equal(s.get('Entries', 1).fieldData['Project Name'], 'Website');

      assert.equal((await runScript(s, 'Hours by person', { layout: 'Projects' })).result, 'Ana: 6.5\rBen: 4');
      assert.equal((await runScript(s, 'Hours by person', { layout: 'Projects', parameter: '1' })).result, 'Ana: 3.5\rBen: 4');
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
