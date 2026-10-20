// examples/crm: companies, contacts and deals. Built from an empty database with `tabularius design-apply`, then used the way the
// example's README says: totals follow the relationships, Close deal moves a deal on, and Open deals reports a find.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../store/src/index.ts';
import { runScript } from '../../scripts/src/index.ts';

const main = join(import.meta.dirname, '..', 'src', 'main.ts');
const example = join(import.meta.dirname, '..', '..', '..', 'examples', 'crm');

test('the crm example totals deals per company, closes deals and reports the open ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-crm-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8' });
    let r = run('new', dir, 'CRM');
    assert.equal(r.status, 0, r.stderr);
    r = run('design-apply', dir, 'CRM', example, '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CRM: 9 changes made/);
    r = run('design-apply', dir, 'CRM', example);
    assert.match(r.stdout, /CRM: nothing to change \(\d+ files already match\)/);

    const s = new Store(join(dir, 'CRM.openhbam.sqlite'), 'CRM');
    try {
      assert.deepEqual(s.schema.tables.map((t) => t.name).sort(), ['Companies', 'Contacts', 'Deals']);
      assert.equal(s.schema.relationships.length, 2);
      assert.deepEqual(s.schema.valueLists.map((v) => v.name).sort(), ['Deal stage', 'Industry']);

      assert.equal((await runScript(s, 'Open deals', { layout: 'Companies' })).result, 'Open deals: 0');

      s.create('Companies', { Name: 'Acme', Industry: 'Manufacturing' });
      s.create('Companies', { Name: 'Globex', Industry: 'Finance' });
      s.create('Contacts', { 'Company ID': '1', Name: 'Wile', Role: 'Buyer', Email: 'wile@acme.example' });
      s.create('Contacts', { 'Company ID': '1', Name: 'Road', Role: 'Owner' });
      s.create('Deals', { 'Company ID': '1', Title: 'Anvils', Amount: '1000' });
      s.create('Deals', { 'Company ID': '1', Title: 'Rockets', Amount: '5000', Stage: 'Proposal' });
      s.create('Deals', { 'Company ID': '2', Title: 'Audit', Amount: '700' });

      const company = (id: number) => s.get('Companies', id).fieldData;
      assert.equal(company(1)["Contacts Count"], 2);
      assert.deepEqual([company(1).Pipeline, company(1).Won], [6000, 0]);
      assert.equal(s.get('Contacts', 1).fieldData['Company Name'], 'Acme');
      assert.equal(s.get('Deals', 1).fieldData.Stage, 'Lead');

      const close = (id: number, parameter: string) => runScript(s, 'Close deal', { layout: 'Deals', foundSet: [id], recordId: id, parameter });
      assert.equal((await close(1, 'Maybe')).result, 'say Won or Lost');
      assert.equal((await close(1, 'Won')).result, 'closed');
      assert.equal((await close(1, 'Lost')).result, 'already closed');
      assert.equal((await close(3, 'Lost')).result, 'closed');
      assert.equal(s.get('Deals', 1).fieldData.Stage, 'Won');
      assert.ok(s.get('Deals', 1).fieldData.Closed);
      assert.deepEqual([company(1).Pipeline, company(1).Won], [5000, 1000]);

      assert.equal((await runScript(s, 'Open deals', { layout: 'Companies' })).result, 'Open deals: 1\rAcme: Rockets, 5000');
    } finally {
      s.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
