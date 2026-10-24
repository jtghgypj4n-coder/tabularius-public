import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore, Store } from '../../store/src/index.ts';
import { STORE_EXT } from '../../server/src/index.ts';
import { claimFolder } from '../../server/src/backup.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');

test('compat-check exit codes and upgrade-file preview, backup, refusal and one-way behavior', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tabularius-native-cli-'));
  const stubDir = join(folder, 'stubs');
  const marker = join(folder, 'external-command-ran');
  try {
    mkdirSync(stubDir);
    for (const name of ['launchctl', 'systemctl', 'sc', 'git', 'npm', 'curl', 'sudo']) {
      const stub = join(stubDir, name);
      writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' '${name}' > '${marker}'\nexit 99\n`);
      chmodSync(stub, 0o755);
    }
    const cli = (...args: string[]) => {
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: stubDir };
      delete env.TABULARIUS_BACKUP_KEY;
      const result = spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', env, timeout: 20000 });
      assert.equal(existsSync(marker), false, 'a forbidden child command was run');
      return result;
    };
    const compat = join(folder, 'Compat' + STORE_EXT);
    const native = join(folder, 'Native' + STORE_EXT);
    const blocked = join(folder, 'Blocked' + STORE_EXT);
    createStore(compat);
    createStore(native, { mode: 'native' });
    createStore(blocked);
    const store = new Store(native);
    try {
      store.applyDesign([{ op: 'createTable', name: 'Items', fields: (['boolean', 'integer', 'decimal', 'json', 'uuid'] as const).map((type) => ({ name: type, type })) }]);
    } finally { store.close(); }
    const noFindings = cli('compat-check', folder, 'Compat');
    assert.equal(noFindings.status, 0, noFindings.stderr);
    assert.match(noFindings.stdout, /no native-only features/);
    for (const command of ['compat-check', 'upgrade-file']) {
      const invalid = cli(command, folder, '../Compat', ...(command === 'upgrade-file' ? ['--to', 'native', '--apply'] : []));
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /not a usable database name/);
    }
    if (process.platform !== 'win32') {
      const nested = join(folder, 'other');
      mkdirSync(nested);
      createStore(join(nested, 'Linked' + STORE_EXT));
      const link = join(folder, 'Linked' + STORE_EXT);
      symlinkSync(join(nested, 'Linked' + STORE_EXT), link);
      try {
        for (const command of ['compat-check', 'upgrade-file']) {
          const linked = cli(command, folder, 'Linked', ...(command === 'upgrade-file' ? ['--to', 'native', '--apply'] : []));
          assert.equal(linked.status, 1);
          assert.match(linked.stderr, /linked file/);
        }
      } finally { rmSync(link); }
    }
    const findings = cli('compat-check', folder, 'Native');
    assert.equal(findings.status, 1, findings.stderr);
    for (const type of ['boolean', 'integer', 'decimal', 'json', 'uuid']) assert.match(findings.stdout, new RegExp(`Items::${type}: native-only ${type} field type`));
    const preview = cli('upgrade-file', folder, 'Compat', '--to', 'native');
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /nothing changed.*--apply/);
    assert.equal(existsSync(join(folder, 'Backups')), false);
    const db = new DatabaseSync(compat, { readOnly: true });
    try { assert.equal(db.prepare("SELECT json FROM _fm_meta WHERE key = 'fileMode'").get(), undefined); }
    finally { db.close(); }
    const bad = new Store(blocked);
    try { bad.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Tags', options: { repetitions: 2 } }, { name: 'Shared', options: { global: true } }] }]); }
    finally { bad.close(); }
    const refused = cli('upgrade-file', folder, 'Blocked', '--to', 'native', '--apply');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Items::Tags.*repeating/);
    assert.match(refused.stderr, /Items::Shared.*global/);
    assert.equal(existsSync(join(folder, 'Backups')), false);
    const release = claimFolder(folder);
    try {
      const hosted = cli('upgrade-file', folder, 'Compat', '--to', 'native', '--apply');
      assert.equal(hosted.status, 1);
      assert.match(hosted.stderr, /already hosted/);
      assert.equal(existsSync(join(folder, 'Backups')), false);
    } finally { release(); }
    const applied = cli('upgrade-file', folder, 'Compat', '--to', 'native', '--apply');
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /upgraded to native/);
    const sets = readdirSync(join(folder, 'Backups'));
    assert.equal(sets.length, 1);
    const saved = new DatabaseSync(join(folder, 'Backups', sets[0], 'Compat' + STORE_EXT), { readOnly: true });
    try { assert.equal(saved.prepare("SELECT json FROM _fm_meta WHERE key = 'fileMode'").get(), undefined); }
    finally { saved.close(); }
    const now = new Store(compat);
    try { assert.equal(now.fileMode, 'native'); }
    finally { now.close(); }
    const again = cli('upgrade-file', folder, 'Compat', '--to', 'native', '--apply');
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already native/);
    assert.equal(readdirSync(join(folder, 'Backups')).length, 1);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
