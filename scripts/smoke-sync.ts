// Opt-in browser test of the admin console's Sync page, in a real headless Chromium: set up sync, check, settle a
// record changed on both sides, and run the sync, watching the page and the files behind it. It is not part of the
// default test suite (needs a Chromium; see scripts/chromium.ts). Run it with:
//
//   npm run smoke:sync
//
// Two servers on 127.0.0.1 in this process stand in for the console's server and for FileMaker Server (Tabularius's
// own Data API, with a throwaway file). Nothing here can reach a real FileMaker Server.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { serve } from '../packages/server/src/index.ts';
import { STORE_EXT } from '../packages/server/src/host.ts';
import { createStore, type DesignOp } from '../packages/store/src/index.ts';
import { Cdp, findChromium, launchChromium, type Listener } from './chromium.ts';

const design: DesignOp[] = [{ op: 'createTable', name: 'Contacts', fields: [{ name: 'uuid' }, { name: 'modts', type: 'timestamp' }, { name: 'Name' }] } as DesignOp];

const problems: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

async function main(): Promise<void> {
  const chromium = findChromium();
  if (!chromium) {
    console.error('No Chromium found. Set TABULARIUS_CHROMIUM to a Chrome/Chromium binary, or run this in a cloud session.');
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-smoke-sync-'));
  const profile = mkdtempSync(join(tmpdir(), 'tabularius-smoke-sync-chrome-'));
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  const servers: { close: (cb: () => void) => void }[] = [];
  try {
    const fmDir = join(dir, 'fm');
    mkdirSync(fmDir);
    createStore(join(fmDir, 'Remote' + STORE_EXT));
    const fm = await serve({ dir: fmDir, port: 0, watch: false, log: () => {} });
    servers.push(fm.server);
    // What this server's operator would say: the stand-in FileMaker Server on this machine is one it may reach.
    process.env.TABULARIUS_SYNC_HOSTS = new URL(fm.url).host;
    const remote = fm.host.get('Remote')!;
    remote.applyDesign(design);
    remote.setPassword('Admin', 'pw', '[Full Access]');

    const own = join(dir, 'console');
    mkdirSync(own);
    const s = await serve({ dir: own, port: 0, log: () => {} });
    servers.push(s.server);
    const local = s.host.create('Shop');
    local.applyDesign(design);
    // Alike on both sides, plus one record each side only has.
    const stamp = '2026-01-01T00:00:00';
    remote.create('Contacts', { uuid: 'u1', modts: stamp, Name: 'Ann' });
    local.create('Contacts', { uuid: 'u1', modts: stamp, Name: 'Ann' });
    local.create('Contacts', { uuid: 'u2', modts: stamp, Name: 'Only here' });
    remote.create('Contacts', { uuid: 'u3', modts: stamp, Name: 'Only there' });

    ({ chrome, cdp } = await launchChromium(chromium, profile));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const errors: string[] = [];
    const listener: Listener = (method, params, sid) => {
      if (sid !== sessionId) return;
      if (method === 'Runtime.exceptionThrown') errors.push(`uncaught: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push(`console.error: ${params.args.map((a: any) => a.description ?? a.value).join(' ')}`);
    };
    cdp.on(listener);
    for (const m of ['Runtime', 'Page', 'Log']) await cdp.send(`${m}.enable`, {}, sessionId);

    const ev = async (expression: string): Promise<any> => {
      const r = await cdp!.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expression}`);
      return r.result.value;
    };
    const until = async (what: string, expression: string, ms = 10_000): Promise<void> => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await ev(expression).catch(() => false)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const text = (sel: string) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`) as Promise<string>;

    // WCAG 2.x A and AA by axe-core, when it is installed, on the Sync section as it stands.
    let axe: string | undefined;
    try { axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* dev dependency not installed */ }
    const audit = async (when: string): Promise<void> => {
      if (!axe) return;
      await ev(axe);
      const found = await ev(`axe.run(document.getElementById('sync-section'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'] } }).then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')))`) as string[];
      check(found.length === 0, `no accessibility problems ${when}${found.length ? `: ${found.join('; ')}` : ''}`);
    };

    await cdp.send('Page.navigate', { url: `${s.url}/admin/` }, sessionId);
    await until('the Sync section', `!document.getElementById('sync-section').hidden && document.getElementById('sync-db').value === 'Shop'`);
    await ev('window.confirm = () => true; window.alert = (m) => { window.__alert = m; }; true');
    check(!!(await text('a[href="#sync-section"]')), 'the sidebar links to the Sync section');

    // Setup, with writes and pulls allowed. The password is typed for each run, never saved.
    await ev(`document.querySelector('#sync-state [data-sync="edit"]').click(); true`);
    await until('the setup form', `!document.getElementById('sync-form').hidden`);
    await audit('in the setup form');
    await ev(`(() => {
      const f = document.getElementById('sync-form');
      f.server.value = ${JSON.stringify(fm.url)}; f.database.value = 'Remote'; f.user.value = 'Admin';
      f.allowWrites.checked = true; f.allowPulls.checked = true;
      const row = document.querySelector('[data-sync-row]');
      for (const [k, v] of Object.entries({ localTable: 'Contacts', remoteLayout: 'Contacts', uuidField: 'uuid', modTimestampField: 'modts' })) row.querySelector('[data-f="' + k + '"]').value = v;
      f.requestSubmit();
    })(); true`);
    await until('the saved setup', `document.querySelector('#sync-state [data-sync="check"]') !== null`);
    check((await text('#sync-state')).includes('May send to FileMaker'), 'the saved setup shows what it allows');

    const typePassword = () => ev(`(() => { const p = document.getElementById('sync-password'); p.value = 'pw'; return true; })()`);
    const check1 = async () => {
      await typePassword();
      await ev(`document.querySelector('#sync-state [data-sync="check"]').click(); true`);
      await until('a check', `document.querySelector('#sync-state h3') !== null && !document.querySelector('#sync-state [data-sync="check"]').disabled`);
    };
    await check1();
    check((await text('#sync-state')).includes('Last check'), 'a check reports its result');
    check(local.query('SELECT uuid FROM "Contacts"', 10).length === 2 && remote.query('SELECT uuid FROM "Contacts"', 10).length === 2, 'a check wrote nothing to either side');

    // The first run: send u2, bring in u3.
    await until('the run box', `document.getElementById('sync-write') !== null`);
    await ev(`document.getElementById('sync-write').click(); document.getElementById('sync-pull').click(); document.querySelector('#sync-review [data-sync="apply"]').click(); true`);
    await until('the run', `document.querySelector('#sync-state h3')?.innerText.startsWith('Last run')`);
    check(remote.query('SELECT uuid FROM "Contacts" WHERE uuid = \'u2\'', 1).length === 1, 'a run sent the record only this file had');
    check(local.query('SELECT uuid FROM "Contacts" WHERE uuid = \'u3\'', 1).length === 1, 'a run brought in the record only FileMaker had');

    // The same record changed on both sides: held for review, and nothing is written until it is settled.
    const id = (st: typeof local, u: string) => Number(st.query(`SELECT _fm_record_id id FROM "Contacts" WHERE uuid = '${u}'`, 1)[0].id);
    local.update('Contacts', id(local, 'u1'), { Name: 'Ann (here)' });
    remote.update('Contacts', id(remote, 'u1'), { Name: 'Ann (there)' });
    await check1();
    await until('the review', `document.querySelectorAll('#sync-review .sync-conflict').length === 1`);
    check((await text('#sync-review')).includes('Ann (here)') && (await text('#sync-review')).includes('Ann (there)'), 'the review shows both values');
    await audit('in the review');
    await ev(`document.getElementById('sync-write').click(); document.querySelector('#sync-review [data-sync="apply"]').click(); true`);
    await until('the refusal', `document.getElementById('sync-msg').innerText.includes('Nothing was written')`);
    check(remote.query('SELECT Name FROM "Contacts" WHERE uuid = \'u1\'', 1)[0].Name === 'Ann (there)', 'an undecided record blocks the run, and nothing is written');

    // Keep this file's version: sending it needs "write", which the page insists on when a pick needs it.
    await until('the run box', `document.getElementById('sync-write') !== null`);
    await ev(`document.querySelector('#sync-review input[data-sync-pick="0"][value="mine"]').click(); document.getElementById('sync-pull').click(); document.querySelector('#sync-review [data-sync="apply"]').click(); true`);
    await until('the page to ask for write', `document.getElementById('sync-msg').innerText.includes('Send this file')`);
    check(remote.query('SELECT Name FROM "Contacts" WHERE uuid = \'u1\'', 1)[0].Name === 'Ann (there)', 'a pick that needs write is not run without it');
    await ev(`document.getElementById('sync-write').click(); document.querySelector('#sync-review [data-sync="apply"]').click(); true`);
    await until('the run', `document.getElementById('sync-msg').innerText === 'Done.'`);
    check(remote.query('SELECT Name FROM "Contacts" WHERE uuid = \'u1\'', 1)[0].Name === 'Ann (here)', 'a pick of this file\u2019s version is sent to FileMaker');

    // The log lists what was done.
    await ev(`document.getElementById('sync-log-box').open = true; true`);
    await until('the log', `document.querySelectorAll('#sync-log tbody tr').length > 0`);
    const log = await text('#sync-log');
    check(log.includes('create') && log.includes('update'), 'the log lists what was sent and brought in');
    await audit('in the log');

    // A scheduled sync, once the server has the password: a check by default, run now from the list.
    process.env.TABULARIUS_FMS_PASSWORD = 'pw';
    await until('the schedules box', `!document.getElementById('sync-schedules').hidden`);
    await ev(`document.querySelector('#sync-schedules summary').click(); true`);
    await ev(`(() => { const f = document.getElementById('sync-sched-add'); f.everyMinutes.value = '30'; f.requestSubmit(); })(); true`);
    await until('the schedule', `document.querySelector('#sync-sched-list [data-sync-sched="run"]') !== null`);
    check((await text('#sync-sched-list')).includes('Check only'), 'a scheduled sync is a check unless it is set otherwise');
    check(await ev(`[...document.getElementById('sync-sched-mode').options].filter((o) => o.disabled).length === 0`), 'the modes the setup allows can be picked');
    await ev(`document.querySelector('#sync-sched-list [data-sync-sched="run"]').click(); true`);
    await until('the run', `document.getElementById('sync-sched-list').innerText.includes('Checked:')`);
    await audit('with a scheduled sync');
    delete process.env.TABULARIUS_FMS_PASSWORD;

    check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.join('; ')}` : ''}`);
    cdp.off(listener);
  } finally {
    cdp?.close();
    chrome?.kill();
    for (const sv of servers) await new Promise<void>((r) => sv.close(() => r()));
    await new Promise((r) => setTimeout(r, 300));
    for (const p of [dir, profile]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* leave it for the OS */ } }
  }
  if (problems.length) {
    console.error(`\nSync page test FAILED: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('\nSync page test passed.');
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
