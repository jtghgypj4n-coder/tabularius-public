// examples/first-app is the QUICKSTART's "start from nothing" folder: an empty database from `tabularius new`,
// filled by `tabularius design-apply`, must make the tables, fields, relationship, value list, function and script
// the example's README promises, and applying it again must have nothing left to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../store/src/index.ts';
import { runCli } from './cli-run.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'first-app');

test('the first-app example builds a contacts book from an empty database', async () => {
  await Promise.all((['compat', 'native'] as const).map(async (mode) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-first-app-'));
  try {
    const run = (...args: string[]) => runCli(main, args);
    let r = await run('new', dir, 'Contacts', ...(mode === 'native' ? ['--native'] : []));
    assert.equal(r.status, 0, r.stderr);
    const info = await run('info', dir, 'Contacts');
    assert.equal(info.status, 0, info.stderr);
    assert.equal(JSON.parse(info.stdout).fileMode, mode);

    r = await run('design-apply', dir, 'Contacts', example);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /6 changes; nothing was changed/);
    r = await run('design-apply', dir, 'Contacts', example, '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Contacts: 6 changes made/);

    // The guide's last command: the new file's Admin account takes a password.
    r = await runCli(main, ['passwd', dir, 'Contacts', 'Admin'], { env: { ...process.env, TABULARIUS_PASSWORD: 'a long enough password' } });
    assert.equal(r.status, 0, r.stderr);

    const s = new Store(join(dir, 'Contacts.openhbam.sqlite'), 'Contacts');
    try {
      assert.equal(s.fileMode, mode);
      const { schema } = s;
      const contacts = schema.tables.find((t) => t.name === 'Contacts')!;
      assert.deepEqual(contacts.fields.map((f) => f.name), ['ID', 'Name', 'Email', 'Phone', 'Company', 'Status', 'Created', 'Calls Count']);
      assert.equal(contacts.fields.find((f) => f.name === 'ID')!.options?.autoEnter?.serial?.increment, 1);
      assert.equal(contacts.fields.find((f) => f.name === 'Name')!.options?.validation?.notEmpty, true);
      assert.equal(contacts.fields.find((f) => f.name === 'Created')!.options?.autoEnter?.value, 'creationTimestamp');
      assert.equal(contacts.fields.find((f) => f.name === 'Calls Count')!.calculation, 'Count ( Calls::ID )');
      assert.deepEqual(schema.tables.find((t) => t.name === 'Calls')!.fields.map((f) => f.name), ['ID', 'Contact ID', 'Date', 'Summary']);
      assert.equal(schema.relationships.length, 1);
      assert.equal(schema.relationships[0].leftTableOccurrence, 'Contacts');
      assert.equal(schema.relationships[0].rightTableOccurrence, 'Calls');
      assert.deepEqual(schema.valueLists.find((v) => v.name === 'Contact status')?.values, ['Lead', 'Customer', 'Past']);
      assert.equal(schema.customFunctions.find((c) => c.name === 'Initials')?.parameters.join(), 'name');
      assert.ok(schema.scripts.some((x) => x.name === 'Make customer' && x.steps.length >= 4));
      assert.deepEqual(schema.layouts.map((l) => l.name).sort(), ['Calls', 'Contacts']);
    } finally {
      s.close();
    }

    r = await run('design-apply', dir, 'Contacts', example);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Contacts: nothing to change \(6 files already match\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  }));
});
