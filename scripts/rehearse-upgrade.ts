// Rehearses upgrading and downgrading across this project's own history (npm run rehearse-upgrade). Not part of the test run:
// it checks out several old builds, so it needs the full git history and takes a few minutes.
//
//   npm run rehearse-upgrade [-- --commits <sha>,<sha>,... ] [--report <file.md>] [--keep] [--no-future]
//
// For each old build: it makes a hosted folder with that build (two files with tables, records, a container, accounts and a
// privilege set, a value list, a script, tokens, a backup, a schedule and settings), then
//   forward  - opens the folder with this build and compares everything with what the old build saw; restores the old build's
//              backup with this build; reads the schedule file and runs the schedule with this build; runs doctor;
//   backward - makes a folder with this build, opens it with the old build, lets the old build write, then reads it again with
//              this build and checks nothing it held was changed or lost.
// A "future" build (this one with the file format number one higher) is added the same way, to show the refusal that a
// build with the format number gives. Exit status 1 when a forward step loses or changes data, or the future build does not refuse.
// Linux only. Probes run as child processes (scripts/rehearse-upgrade/probe.ts) so each runs with the build it names.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'scripts', 'rehearse-upgrade', 'probe.ts');
const EXT = '.openhbam.sqlite';
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };

const git = (...a: string[]) => {
  const r = spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
};

type Json = Record<string, any>;

/** Runs one probe step with a build; the last line it prints is JSON. */
function probe(build: string, step: string, folder: string, argument = ''): { ok: boolean; out: Json; ms: number } {
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', PROBE, build, step, folder, argument], { encoding: 'utf8', timeout: 180_000 });
  const line = (r.stdout || '').trim().split('\n').pop() ?? '';
  let out: Json;
  try { out = JSON.parse(line); } catch { out = { failed: `no answer (exit ${r.status}): ${(r.stderr || line).trim().split('\n').slice(0, 3).join(' | ').slice(0, 300)}` }; }
  return { ok: r.status === 0 && !out.failed, out, ms: Date.now() - started };
}

/** SQLite's own check of every file in a folder. */
function integrity(folder: string): string {
  const bad: string[] = [];
  for (const f of readdirSync(folder).filter((n) => n.endsWith(EXT))) {
    const sql = new DatabaseSync(join(folder, f), { readOnly: true });
    try {
      const rows = sql.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
      if (rows.length !== 1 || rows[0].integrity_check !== 'ok') bad.push(`${f}: ${rows.map((r) => r.integrity_check).slice(0, 2).join('; ')}`);
    } catch (e) { bad.push(`${f}: ${(e as Error).message}`); } finally { sql.close(); }
  }
  return bad.length ? bad.join(' | ') : 'ok';
}

const SECTIONS = ['tables', 'records', 'values', 'accounts', 'privilegeSets', 'valueLists', 'scripts', 'container', 'signIn', 'clerkSignIn'];
const unavailable = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && 'unavailable' in v;

/** What differs between two reads. `grown`: rows added to a table since are expected (a later write), and do not count. */
function differences(was: Json, now: Json, grown = false): string[] {
  const out: string[] = [];
  // A read that failed outright compares equal to another that failed, so it is a difference on its own.
  for (const [who, read] of [['the first', was], ['the second', now]] as const) if (typeof read.failed === 'string') return [`${who} read failed: ${read.failed.slice(0, 120)}`];
  for (const file of Object.keys(was)) {
    const a = was[file];
    const b = now[file];
    if (!b) { out.push(`${file}: missing`); continue; }
    if (b.refused) { out.push(`${file}: refused (${b.refused})`); continue; }
    for (const s of SECTIONS) {
      // Not made by the old build: nothing to compare. Made, but this build could not read it: that is the regression to catch.
      if (unavailable(a[s])) continue;
      if (unavailable(b[s])) { out.push(`${file}.${s}: this build could not read it (${String(b[s].unavailable).slice(0, 80)})`); continue; }
      if (grown && (s === 'tables' || s === 'values')) continue;
      if (grown && s === 'records') {
        for (const [t, rows] of Object.entries<any[]>(a.records ?? {})) {
          const later = new Set((b.records?.[t] ?? []).map((r: any[]) => r.join(':')));
          const lost = rows.filter((r) => !later.has(r.join(':')));
          if (lost.length) out.push(`${file}.${t}: ${lost.length} of ${rows.length} records changed or lost`);
        }
        continue;
      }
      if (JSON.stringify(a[s]) !== JSON.stringify(b[s])) out.push(`${file}.${s} differs`);
    }
  }
  return out;
}

interface Build { label: string; dir: string; sha: string; date: string; subject: string }

function checkout(sha: string, dir: string): Build {
  git('worktree', 'add', '-q', '--detach', '--force', dir, sha);
  // What `tabularius upgrade` does after putting a version in place.
  const install = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', timeout: 300_000 });
  if (install.status !== 0) throw new Error(`npm ci in ${dir}: ${(install.stderr || '').trim().slice(0, 300)}`);
  const [full, date, subject] = git('log', '-1', '--format=%H%x09%ad%x09%s', '--date=short', sha).split('\t');
  return { label: sha.slice(0, 8), dir, sha: full, date, subject: subject.length > 70 ? subject.slice(0, 67) + '...' : subject };
}

/** Oldest first; the picks are spread over the history of the first-parent line. */
function pick(): string[] {
  const given = flag('--commits');
  if (given) return given.split(',').filter(Boolean);
  const line = git('rev-list', '--first-parent', '--reverse', 'HEAD').split('\n');
  const roots = git('rev-list', '--max-parents=0', 'HEAD').split('\n');
  // The oldest build, three spread through the history, and main as it was when this branch was cut.
  const main = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '-q', 'origin/main'], { encoding: 'utf8' });
  return [roots[roots.length - 1], line[Math.floor(line.length * 0.25)], line[Math.floor(line.length * 0.5)], line[Math.floor(line.length * 0.75)], main.status === 0 ? main.stdout.trim() : line[line.length - 1]];
}

interface Row {
  build: Build;
  seed: string;
  forward: { opens: string; sameData: string; integrity: string; schedule: string; restore: string; doctor: string };
  backward: { old: string; write: string; thenThisBuild: string; integrity: string };
}

const scratch = mkdtempSync(join(tmpdir(), 'tabularius-rehearse-'));
const keep = args.includes('--keep');
const worktrees: string[] = [];
const rows: Row[] = [];
let failed = false;
const fail = (why: string) => { failed = true; console.error(`FAIL ${why}`); };

try {
  const current: Build = { label: 'this build', dir: ROOT, sha: git('rev-parse', 'HEAD'), date: git('log', '-1', '--format=%ad', '--date=short'), subject: 'the build being rehearsed' };

  for (const sha of pick()) {
    const dir = join(scratch, 'build-' + sha.slice(0, 8));
    worktrees.push(dir);
    const build = checkout(sha, dir);
    console.log(`\n== ${build.label} (${build.date}) ${build.subject}`);
    const row: Row = { build, seed: '', forward: { opens: '', sameData: '', integrity: '', schedule: '', restore: '', doctor: '' }, backward: { old: '', write: '', thenThisBuild: '', integrity: '' } };

    // --- forward: the old build writes, this build opens ---------------------------------------------------------------
    const folder = join(scratch, 'fwd-' + build.label);
    const seeded = probe(build.dir, 'seed', folder);
    if (!seeded.ok) { row.seed = `could not make a folder: ${seeded.out.failed ?? JSON.stringify(seeded.out).slice(0, 120)}`; rows.push(row); console.log(`   ${row.seed}`); continue; }
    const unseeded = Object.entries(seeded.out).filter(([, v]) => unavailable(v)).map(([k]) => k);
    row.seed = unseeded.length ? `made, without: ${unseeded.join(', ')}` : 'made';
    const baseline = probe(build.dir, 'read', folder).out;
    const backup = probe(build.dir, 'backup', folder);
    const set = backup.out.dir as string | undefined;

    const mine = probe(ROOT, 'read', folder).out;
    const refused = Object.values(mine).some((v: any) => v?.refused);
    row.forward.opens = refused ? 'refused' : 'opens';
    const diff = differences(baseline, mine);
    row.forward.sameData = diff.length ? diff.join('; ') : 'identical';
    if (refused || diff.length) fail(`${build.label}: this build does not read the old build's folder identically (${diff.join('; ') || 'refused'})`);
    row.forward.integrity = integrity(folder);
    if (row.forward.integrity !== 'ok') fail(`${build.label}: integrity ${row.forward.integrity}`);

    const sched = probe(ROOT, 'schedules', folder);
    const s = sched.out as any;
    row.forward.schedule = sched.ok && s.schedules?.length === 1 && s.run?.error === 0 ? `read and ran (result ${s.run.result})` : `problem: ${JSON.stringify(sched.out).slice(0, 160)}`;
    if (!row.forward.schedule.startsWith('read and ran')) fail(`${build.label}: schedule ${row.forward.schedule}`);

    if (set && existsSync(set)) {
      // Over the live folder, after this build changed it: the data goes back, and the accounts keep the passwords they have.
      const over = join(scratch, 'over-' + build.label);
      cpSync(folder, over, { recursive: true });
      probe(ROOT, 'write', over, 'after the backup');
      const done = probe(ROOT, 'restore', over, set);
      const again = done.ok ? probe(ROOT, 'read', over).out : {};
      const d = done.ok ? differences(baseline, again) : ['restore failed: ' + JSON.stringify(done.out).slice(0, 120)];
      // Into an empty folder (a lost server): the data goes back; passwords do not (ADMIN.md, "Backups and restore").
      const fresh = join(scratch, 'fresh-' + build.label);
      mkdirSync(fresh, { recursive: true });
      const into = probe(ROOT, 'restore', fresh, set);
      const there = into.ok ? probe(ROOT, 'read', fresh).out : {};
      const dd = into.ok ? differences(baseline, there).filter((x) => !/\.(signIn|clerkSignIn) differs$/.test(x)) : ['restore failed: ' + JSON.stringify(into.out).slice(0, 120)];
      row.forward.restore = `over the folder: ${d.length ? d.join('; ') : 'identical, passwords kept'}; into an empty folder: ${dd.length ? dd.join('; ') : 'identical, accounts need a password set'}`;
      if (d.length || dd.length) fail(`${build.label}: restore ${[...d, ...dd].join('; ')}`);
    } else {
      row.forward.restore = `no backup to restore (${JSON.stringify(backup.out).slice(0, 100)})`;
      fail(`${build.label}: ${row.forward.restore}`);
    }

    const doctor = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'packages/cli/src/main.ts'), 'doctor', folder], { encoding: 'utf8', timeout: 120_000 });
    const lines = (doctor.stdout || '').split('\n');
    const problems = lines.filter((l) => /^problem\b/i.test(l));
    const pages = lines.find((l) => /^ok\s+Pages:/.test(l));
    row.forward.doctor = problems.length ? `reports: ${problems.slice(0, 2).map((l) => l.replace(/\s+/g, ' ')).join(' / ').slice(0, 140)}` : pages ? 'files read cleanly' : 'did not report on the files';
    if (!pages || problems.length) fail(`${build.label}: doctor ${row.forward.doctor}`);

    // --- backward: this build writes, the old build opens ----------------------------------------------------------------
    const back = join(scratch, 'back-' + build.label);
    probe(ROOT, 'seed', back);
    const was = probe(ROOT, 'read', back).out;
    const old = probe(build.dir, 'read', back);
    const refusedByOld = Object.values(old.out).some((v: any) => v?.refused);
    row.backward.old = refusedByOld ? `refuses: ${Object.values<any>(old.out).find((v) => v.refused).refused.slice(0, 150)}` : old.ok ? 'opens it' : `fails: ${String(old.out.failed).slice(0, 120)}`;
    if (!refusedByOld && old.ok) {
      const seen = differences(was, old.out);
      if (seen.length) row.backward.old += ` (but sees: ${seen.slice(0, 3).join('; ')})`;
      const w = probe(build.dir, 'write', back, build.label);
      const wrote = Object.values<any>(w.out).map((v) => (unavailable(v) ? v.unavailable : v));
      row.backward.write = w.ok && wrote.every((x) => !/^[A-Z]|rror|not|cannot|can't/.test(String(x)) || /^wrote/.test(String(x))) ? 'wrote a record, an edit and a field' : `write problem: ${wrote.join(' | ').slice(0, 140)}`;
    } else row.backward.write = 'not tried';
    const after = probe(ROOT, 'read', back).out;
    const lost = differences(was, after, true);
    row.backward.thenThisBuild = lost.length ? `PROBLEM: ${lost.join('; ')}` : 'everything it held is intact';
    row.backward.integrity = integrity(back);
    if (lost.length) fail(`${build.label}: after the old build wrote, this build no longer reads what it wrote: ${lost.join('; ')}`);
    if (row.backward.integrity !== 'ok') fail(`${build.label}: integrity after the old build wrote: ${row.backward.integrity}`);
    console.log(`   forward: ${row.forward.opens}, ${row.forward.sameData}; backward: ${row.backward.old}`);
    rows.push(row);
  }

  // --- a future build: this one with the format number one higher ------------------------------------------------------
  let future = '';
  if (!args.includes('--no-future')) {
    const dir = join(scratch, 'future');
    cpSync(join(ROOT, 'packages'), join(dir, 'packages'), { recursive: true, filter: (p) => !/[\\/]node_modules$/.test(p) });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    const file = join(dir, 'packages/store/src/store-format.ts');
    const formatNow = Number(/STORE_FORMAT = (\d+);/.exec(readFileSync(file, 'utf8'))?.[1]);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/STORE_FORMAT = \d+;/, `STORE_FORMAT = ${formatNow + 1};`));
    const folder = join(scratch, 'future-folder');
    probe(ROOT, 'seed', folder);
    const baseline = probe(ROOT, 'read', folder).out;
    const up = probe(dir, 'read', folder);
    const upgraded = differences(baseline, up.out).length === 0 && integrity(folder) === 'ok';
    const bytes = Object.fromEntries(readdirSync(folder).filter((f) => f.endsWith(EXT)).map((f) => [f, readFileSync(join(folder, f)).toString('base64')]));
    const refusal = probe(ROOT, 'read', folder);
    const refused = Object.values<any>(refusal.out).filter((v) => v?.refused);
    const unchanged = Object.entries(bytes).every(([f, b]) => readFileSync(join(folder, f)).toString('base64') === b);
    future = `the next build (format ${formatNow + 1}) opens a format-${formatNow} folder ${upgraded ? 'and brings it up' : 'WRONGLY'}; this build then ${refused.length === 2 ? `refuses both files ("${refused[0].refused.slice(0, 120)}...")` : 'DOES NOT REFUSE'}; files ${unchanged ? 'unchanged by the refusal' : 'CHANGED by the refusal'}`;
    if (!upgraded || refused.length !== 2 || !unchanged) fail(`future build: ${future}`);
  }

  // --- report ----------------------------------------------------------------------------------------------------------------
  const md: string[] = [
    '# Upgrade and downgrade rehearsal',
    '',
    `Run on ${new Date().toISOString().slice(0, 10)} against ${current.sha.slice(0, 8)} (Node ${process.versions.node}, ${process.platform}). Each old build made a folder (two files: tables, 80 records, a container, two accounts and a privilege set, a value list, a script, a token, a backup, a schedule, settings); this build opened it, and the other way round.`,
    '',
    '## Forward: an old build wrote the folder, this build opens it',
    '',
    '| Build | Folder made | Opens | Data | Integrity | Schedule | Old backup restored | Doctor |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.build.label} ${r.build.date} | ${r.seed} | ${r.forward.opens} | ${r.forward.sameData} | ${r.forward.integrity} | ${r.forward.schedule} | ${r.forward.restore} | ${r.forward.doctor} |`),
    '',
    '## Backward: this build wrote the folder, an old build opens it',
    '',
    '| Build | The old build | Its write | Then this build reads | Integrity |',
    '|---|---|---|---|---|',
    ...rows.filter((r) => r.backward.old).map((r) => `| ${r.build.label} ${r.build.date} | ${r.backward.old} | ${r.backward.write} | ${r.backward.thenThisBuild} | ${r.backward.integrity} |`),
    '',
    ...(future ? ['## A build with a newer file format', '', future, ''] : []),
    '## Builds',
    '',
    ...rows.map((r) => `- ${r.build.label} (${r.build.date}): ${r.build.subject}`),
    '',
  ];
  console.log('\n' + md.join('\n'));
  const report = flag('--report');
  if (report) writeFileSync(report, md.join('\n'));
} finally {
  if (!keep) {
    for (const dir of worktrees) { try { git('worktree', 'remove', '--force', dir); } catch { /* removed with the scratch folder */ } }
    try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
    rmSync(scratch, { recursive: true, force: true });
  } else console.log(`kept ${scratch}`);
}
process.exit(failed ? 1 : 0);
