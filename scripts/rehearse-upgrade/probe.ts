// One step of the upgrade rehearsal, run with whichever build is named (an old checkout, or this one):
//   node --experimental-strip-types probe.ts <build-dir> <step> <folder> [argument]
// Steps: seed (make a hosted folder), read (print what is in it as JSON), write (change it), backup, restore <set>,
// schedules (list and run them). Everything it prints is JSON on the last line. It uses only calls that exist in
// every build, and says "unavailable" for a part an old build has no way to make or read, rather than failing.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [build, step, folder, argument] = process.argv.slice(2);
const load = (rel: string) => import(join(build, rel));
const EXT = '.openhbam.sqlite';
const sha = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 12);
/** Runs a part; an error becomes the part's value, so one missing feature does not stop the rest. */
const part = async <T>(fn: () => T | Promise<T>): Promise<T | { unavailable: string }> => {
  try { return await fn(); } catch (e) { return { unavailable: String((e as Error).message ?? e).split('\n')[0].slice(0, 160) }; }
};
/** A record's values in the fields the seed made; a field added later does not change it. */
const KNOWN = ['Name', 'Email', 'Balance', 'Client', 'Total'];
const mine = (data: Record<string, unknown>) => Object.fromEntries(KNOWN.filter((k) => k in data).map((k) => [k, data[k]]));
const say = (value: unknown) => console.log(JSON.stringify(value));

const names = ['Shop', 'Books'];

async function seed(): Promise<Record<string, unknown>> {
  const { createStore, Store } = await load('packages/store/src/index.ts');
  mkdirSync(folder, { recursive: true });
  const made: Record<string, unknown> = {};
  for (const name of names) {
    const path = join(folder, name + EXT);
    createStore(path);
    const store = new Store(path, name);
    try {
      made[name + ' design'] = await part(() => store.applyDesign([
        { op: 'createTable', name: 'Clients', fields: [{ name: 'Name', type: 'text' }, { name: 'Email', type: 'text' }, { name: 'Balance', type: 'number' }, { name: 'Photo', type: 'container' }] },
        { op: 'createTable', name: 'Orders', fields: [{ name: 'Client', type: 'text' }, { name: 'Total', type: 'number' }] },
        { op: 'createValueList', name: 'Tiers', values: ['Gold', 'Silver', 'Bronze'] },
        { op: 'createScript', name: 'Hello', text: 'Set Variable [ $x ; Value: 1 ]\nExit Script [ Text Result: $x ]' },
      ]) && 'ok');
      made[name + ' records'] = await part(() => {
        const ids: number[] = [];
        for (let i = 0; i < 60; i++) ids.push(store.create('Clients', { Name: `Client ${i}`, Email: `c${i}@example.test`, Balance: i * 1.5 }, { account: 'Admin' }).recordId);
        for (let i = 0; i < 20; i++) store.create('Orders', { Client: `Client ${i}`, Total: i * 10 }, { account: 'Admin' });
        for (let i = 0; i < 10; i++) store.update('Clients', ids[i], { Balance: 1000 + i }, undefined, { account: 'Admin' });
        store.delete?.('Orders', 3, { account: 'Admin' });
        return ids.length;
      });
      made[name + ' container'] = await part(() => {
        const first = store.find('Clients', { limit: 1 }).records[0];
        store.setContainer('Clients', first.recordId, 'Photo', 1, { filename: 'dot.png', mime: 'image/png', data: Buffer.from('not really a png ' + name) });
        return 'ok';
      });
      made[name + ' accounts'] = await part(() => {
        store.savePrivilegeSet({ name: 'Clerk', records: { view: true, edit: true, create: true, delete: false }, layouts: 'modifiable', valueLists: 'none', scripts: 'viewOnly', extendedPrivileges: [] });
        store.setPassword('Admin', 'rehearsal passphrase 1', '[Full Access]');
        store.setPassword('Clara', 'rehearsal passphrase 2', 'Clerk');
        return 'ok';
      });
      made[name + ' token'] = await part(() => { store.createApiToken('Admin', { label: 'rehearsal', readOnly: true }); return 'ok'; });
      store.checkpoint?.();
    } finally {
      store.close();
    }
  }
  // Folder-level state is kept in JSON files beside the hosted files; written in the shape every build reads.
  writeFileSync(join(folder, '.openhbam-schedules.json'), JSON.stringify({ schedules: [{ id: 'aabbccddeeff', name: 'Say hello', database: 'Shop', script: 'Hello', account: 'Admin', everyMinutes: 1440, enabled: true }] }, null, 2));
  writeFileSync(join(folder, '.openhbam-settings.json'), JSON.stringify({ backupEvery: '24h', keep: 5 }, null, 2));
  return made;
}

/** Everything a person would notice missing: design, records and their ids, accounts, lists, scripts, containers. */
async function read(): Promise<Record<string, unknown>> {
  const { Store } = await load('packages/store/src/index.ts');
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(folder).filter((f) => f.endsWith(EXT)).sort()) {
    const name = file.slice(0, -EXT.length);
    let store: any;
    try { store = new Store(join(folder, file), name); } catch (e) { out[name] = { refused: String((e as Error).message).split('\n')[0] }; continue; }
    try {
      const schema = store.schema;
      out[name] = {
        tables: await part(() => schema.tables.map((t: any) => ({ name: t.name, fields: t.fields.map((f: any) => f.name), count: store.recordCount(t.name) }))),
        records: await part(() => Object.fromEntries(schema.tables.map((t: any) => [t.name, store.find(t.name, { limit: 100000 }).records.map((r: any) => [r.recordId, r.modId, sha(mine(r.fieldData))])]))),
        values: await part(() => Object.fromEntries(schema.tables.map((t: any) => [t.name, sha(store.find(t.name, { limit: 100000 }).records.map((r: any) => mine(r.fieldData)))]))),
        accounts: await part(() => store.accounts().map((a: any) => `${a.name}:${a.privilegeSet}`).sort()),
        privilegeSets: await part(() => store.privilegeSets().map((p: any) => p.name).sort()),
        valueLists: await part(() => schema.valueLists.map((v: any) => [v.name, sha(v.values ?? v.items ?? v)]).sort()),
        scripts: await part(() => schema.scripts.map((s: any) => [s.name, sha(s.text ?? s.steps ?? s)]).sort()),
        container: await part(() => {
          const first = store.find('Clients', { limit: 1 }).records[0];
          const id = store.containerId('Clients', first.recordId, 'Photo', 1);
          const c = id === undefined ? undefined : store.container(id);
          return c ? sha(c.data ? Buffer.from(c.data).toString('base64') : JSON.stringify(c)) : 'missing';
        }),
        signIn: await part(() => store.verify('Admin', 'rehearsal passphrase 1')),
        clerkSignIn: await part(() => store.verify('Clara', 'rehearsal passphrase 2')),
      };
    } finally {
      store.close();
    }
  }
  return out;
}

/** A change an old build can make: a record, an edit and a new field. */
async function write(): Promise<Record<string, unknown>> {
  const { Store } = await load('packages/store/src/index.ts');
  const out: Record<string, unknown> = {};
  for (const name of names) {
    out[name] = await part(() => {
      const store = new Store(join(folder, name + EXT), name);
      try {
        const { recordId } = store.create('Clients', { Name: 'Written by ' + argument, Balance: 5 }, { account: 'Admin' });
        store.update('Clients', recordId, { Balance: 6 }, undefined, { account: 'Admin' });
        store.applyDesign([{ op: 'createField', table: 'Clients', name: 'Note' + Date.now() % 100000 }]);
        store.checkpoint?.();
        return 'wrote a record, an edit and a field';
      } finally {
        store.close();
      }
    });
  }
  return out;
}

async function backup(): Promise<unknown> {
  const { backupFolder } = await load('packages/server/src/backup.ts');
  const r = await backupFolder(folder, join(folder, 'backups'), 7, '');
  return { dir: r.dir, files: r.files };
}

async function restore(): Promise<unknown> {
  const { restoreBackup } = await load('packages/server/src/backup.ts');
  return await restoreBackup(folder, argument, undefined, '');
}

/** The schedule file read by this build's Schedules, and the schedule run once. */
async function schedules(): Promise<unknown> {
  const { Host, Schedules } = await load('packages/server/src/index.ts');
  const host = new Host(folder, () => {});
  try {
    const s = new Schedules(host, () => {});
    try {
      const all = s.all().map((x: any) => ({ id: x.id, name: x.name, database: x.database, script: x.script, enabled: x.enabled }));
      const run = all.length ? await s.run(all[0].id) : undefined;
      return { hosted: host.names().sort(), schedules: all, run: run ? { error: run.error, result: run.result } : undefined };
    } finally {
      s.stop();
    }
  } finally {
    await host.close();
  }
}

const steps: Record<string, () => Promise<unknown>> = { seed, read, write, backup, restore, schedules };
try {
  say(await steps[step]());
} catch (e) {
  say({ failed: String((e as Error).stack ?? e).split('\n').slice(0, 4).join(' | ') });
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
