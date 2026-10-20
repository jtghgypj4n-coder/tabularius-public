// Externally stored container files go into backup sets beside the databases,
// unchanged ones as links to the last set, and come back on restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../store/src/index.ts';
import { Store } from '../../store/src/index.ts';
import { backupFolder, restoreBackup, verifySet } from '../src/index.ts';

function hosted(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-backup-external-'));
  const database = join(dir, 'Invoices.openhbam.sqlite');
  createStore(database);
  // Initialize the security tables as a hosted file would before backup.
  new Store(database, 'Invoices').close();
  const pdfs = join(dir, 'RC_Data_FMS', 'Invoices', 'Invoice_Doc');
  mkdirSync(pdfs, { recursive: true });
  writeFileSync(join(pdfs, 'INV-1.pdf'), '%PDF one');
  writeFileSync(join(pdfs, 'INV-2.pdf'), '%PDF two');
  mkdirSync(join(dir, 'Files', 'Invoices'), { recursive: true });
  writeFileSync(join(dir, 'Files', 'Invoices', 'logo.png'), 'png');
  // Not a hosted file's folder: left out.
  mkdirSync(join(dir, 'RC_Data_FMS', 'Other'), { recursive: true });
  writeFileSync(join(dir, 'RC_Data_FMS', 'Other', 'x.txt'), 'x');
  return dir;
}

for (const passphrase of [undefined, 'backup secret']) {
  test(`external container files are backed up and restored${passphrase ? ', encrypted' : ''}`, async () => {
    const dir = hosted();
    const dest = join(dir, 'Backups');
    const ext = passphrase ? '.enc' : '';
    const first = await backupFolder(dir, dest, 7, passphrase);
    const one = join(first.dir, 'RC_Data_FMS', 'Invoices', 'Invoice_Doc', 'INV-1.pdf' + ext);
    assert.ok(existsSync(one));
    assert.ok(existsSync(join(first.dir, 'Files', 'Invoices', 'logo.png' + ext)));
    assert.equal(existsSync(join(first.dir, 'RC_Data_FMS', 'Other')), false);
    if (!passphrase) assert.equal(readFileSync(one, 'utf8'), '%PDF one');
    else assert.notEqual(readFileSync(one, 'utf8'), '%PDF one');

    // A second set links what didn't change and copies what did.
    const changed = join(dir, 'RC_Data_FMS', 'Invoices', 'Invoice_Doc', 'INV-2.pdf');
    writeFileSync(changed, '%PDF two, edited');
    utimesSync(changed, new Date(), new Date(Date.now() + 5000));
    const second = await backupFolder(dir, dest, 7, passphrase);
    const pdf = (set: string, n: number) => join(set, 'RC_Data_FMS', 'Invoices', 'Invoice_Doc', `INV-${n}.pdf${ext}`);
    assert.equal(statSync(pdf(second.dir, 1)).ino, statSync(pdf(first.dir, 1)).ino, 'unchanged: linked');
    assert.notEqual(statSync(pdf(second.dir, 2)).ino, statSync(pdf(first.dir, 2)).ino, 'changed: copied');

    assert.equal((await verifySet(second.dir, passphrase)).ok, true);

    // Restore puts the folder back as it was in that set.
    rmSync(join(dir, 'RC_Data_FMS', 'Invoices'), { recursive: true });
    writeFileSync(join(dir, 'Files', 'Invoices', 'logo.png'), 'replaced');
    await restoreBackup(dir, first.dir, undefined, passphrase);
    assert.equal(readFileSync(join(dir, 'RC_Data_FMS', 'Invoices', 'Invoice_Doc', 'INV-2.pdf'), 'utf8'), '%PDF two');
    assert.equal(readFileSync(join(dir, 'Files', 'Invoices', 'logo.png'), 'utf8'), 'png');
    assert.equal(readFileSync(join(dir, 'RC_Data_FMS', 'Other', 'x.txt'), 'utf8'), 'x');

    // Damage is found by verification. The copy is unlinked first, so the
    // earlier set that shares it stays good.
    const damaged = pdf(second.dir, 2);
    rmSync(damaged);
    writeFileSync(damaged, 'garbage');
    const check = await verifySet(second.dir, passphrase);
    assert.equal(check.ok, false);
    assert.match(check.files['external container files'], /INV-2\.pdf: changed on disk/);
    assert.equal((await verifySet(first.dir, passphrase)).ok, true);
  });
}
