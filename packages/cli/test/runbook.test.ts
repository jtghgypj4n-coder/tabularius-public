// docs/runbook.md is performed: each scenario is set up in a throwaway folder (with an in-process server where the
// scenario needs one), the commands the page gives are run exactly as written (placeholders filled in), and what the
// page says the person will see, and what is lost, is compared with what happened.
//
// Three checks hold the page to the test: every `tabularius` command and every `curl` call in the page's shell blocks
// is run by some scenario here (or excused, with a reason, in `notRun`); each message the page quotes as a symptom
// is checked by `sees` against what the program really said in that scenario; and each console button or heading the
// page names is checked against the console page by `inConsole`.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, LOCKOUT, Store } from '../../store/src/index.ts';
import { backupFolder, serve, type Host } from '../../server/src/index.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const main = join(root, 'packages', 'cli', 'src', 'main.ts');
const consolePage = readFileSync(join(root, 'packages', 'server', 'admin', 'index.html'), 'utf8');
const page = readFileSync(join(root, 'docs', 'runbook.md'), 'utf8');
const posix = process.platform !== 'win32';

// --- the page, by scenario ------------------------------------------------------------------------------------
const sections = new Map<string, string>();
for (const part of page.split(/^## /m).slice(1)) sections.set(part.slice(0, part.indexOf('\n')).trim(), part);
const section = (name: string): string => {
  const text = sections.get(name);
  assert.ok(text, `docs/runbook.md has no "## ${name}" section`);
  return text;
};

/** The commands and calls the page has run, as written, so the last test can find any that no scenario ran. */
const ran = new Set<string>();
const quoted = new Set<string>();
/** Lines of the page that no test runs, and why not. */
const notRun = new Map<string, string>();
const dirs: string[] = [];
const children: ChildProcess[] = [];
after(() => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
const tmp = (label: string): string => { const d = mkdtempSync(join(tmpdir(), `tabularius-runbook-${label}-`)); dirs.push(d); return d; };
const quiet = () => {};

interface Result { status: number | null; stdout: string; stderr: string }
type Fill = Record<string, string>;

const CLEAN_ENV: NodeJS.ProcessEnv = { ...process.env, TABULARIUS_PASSWORD: undefined, TABULARIUS_BACKUP_KEY: undefined, TABULARIUS_FOLDER: undefined, NODE_EXTRA_CA_CERTS: undefined };

/** A command line of the page, split the way a shell would for these simple lines. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}
function fillIn(template: string, fill: Fill, swap: Fill = {}): string {
  let line = template;
  for (const [k, v] of Object.entries(fill)) line = line.replaceAll(`<${k}>`, v);
  // Numbers the page writes out (8080) that the test has to change to a free port.
  for (const [k, v] of Object.entries(swap)) line = line.replaceAll(k, v);
  assert.doesNotMatch(line, /<[a-z-]+>/, `placeholder left in: ${line}`);
  return line;
}
function shown(where: string, template: string): void {
  assert.ok(section(where).split('\n').some((l) => l.trim() === template), `the "${where}" section of docs/runbook.md does not show: ${template}`);
  ran.add(template);
}

/** Run one `tabularius` line from the page. `fill` replaces the `<placeholders>`; `input` is what the person types. */
function runStep(where: string, template: string, fill: Fill, opts: { input?: string; env?: NodeJS.ProcessEnv; timeout?: number; swap?: Fill } = {}): Result {
  shown(where, template);
  const args = words(fillIn(template, fill, opts.swap)).slice(1);
  const r = spawnSync(process.execPath, ['--no-warnings', main, ...args], {
    encoding: 'utf8', input: opts.input ?? '', timeout: opts.timeout ?? 90_000,
    env: { ...CLEAN_ENV, HOME: tmpdir(), ...opts.env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** As runStep, for a command that talks to a server in this same process, which a blocking spawn would starve. */
async function runStepAsync(where: string, template: string, fill: Fill, opts: { env?: NodeJS.ProcessEnv; swap?: Fill } = {}): Promise<Result> {
  shown(where, template);
  const args = words(fillIn(template, fill, opts.swap)).slice(1);
  const child = spawn(process.execPath, ['--no-warnings', main, ...args], { env: { ...CLEAN_ENV, HOME: tmpdir(), ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
  const status = await new Promise<number | null>((ok) => child.once('close', ok));
  return { status, stdout, stderr };
}

/** Start a long-running `tabularius` line (serve) and collect what it prints. */
function startStep(where: string, template: string, fill: Fill, opts: { env?: NodeJS.ProcessEnv; execArgv?: string[]; swap?: Fill } = {}): { child: ChildProcess; out: () => string; exited: Promise<number | null> } {
  shown(where, template);
  const args = words(fillIn(template, fill, opts.swap)).slice(1);
  const child = spawn(process.execPath, ['--no-warnings', ...(opts.execArgv ?? []), main, ...args], { env: { ...CLEAN_ENV, HOME: tmpdir(), ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let text = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => { text += d; });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { text += d; });
  return { child, out: () => text, exited: new Promise((ok) => child.once('exit', (code) => ok(code))) };
}
async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 60_000): Promise<void> {
  for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 100))) {
    if (await ok()) return;
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
  }
}
async function stopChild(c: ChildProcess): Promise<void> {
  if (c.exitCode !== null) return;
  const gone = new Promise((ok) => c.once('exit', ok));
  c.kill('SIGINT');
  const timer = setTimeout(() => c.kill('SIGKILL'), 15_000);
  try { await gone; } finally { clearTimeout(timer); }
}

/** An admin call from the page: `curl` flags and URL are read, the base address and passwords filled in, and it is sent with fetch. */
async function runCurl(where: string, template: string, fill: Fill, base: string, consolePassword: string): Promise<{ status: number; body: string }> {
  shown(where, template);
  const w = words(fillIn(template, { ...fill, 'console-password': consolePassword }));
  assert.equal(w[0], 'curl');
  const headers: Record<string, string> = {};
  let method = 'GET', body: string | undefined, url = '', user: string | undefined;
  for (let i = 1; i < w.length; i++) {
    if (w[i] === '-sS') continue;
    if (w[i] === '-u') user = w[++i];
    else if (w[i] === '-H') { const [k, ...v] = w[++i].split(':'); headers[k.trim().toLowerCase()] = v.join(':').trim(); }
    else if (w[i] === '-X') method = w[++i];
    else if (w[i] === '-d') body = w[++i];
    else url = w[i];
  }
  assert.ok(url.startsWith('http://localhost:8080/'), `the page's address is not http://localhost:8080/...: ${url}`);
  assert.ok(user?.startsWith(':'), 'the page gives the console password as -u ":password"');
  headers.authorization = 'Basic ' + Buffer.from(user!).toString('base64');
  const r = await fetch(base + url.slice('http://localhost:8080'.length), { method, headers, body });
  return { status: r.status, body: await r.text() };
}

/** The page quotes this message as what the person sees; it must be on the page, and what the program said must contain it. */
function sees(where: string, quote: string, actual: string): void {
  assert.ok(section(where).includes(quote), `the "${where}" section does not quote: ${quote}`);
  actual = actual.replace(/[ \t]+/g, ' ');
  assert.ok(actual.includes(quote), `the program did not say "${quote}"; it said: ${actual}`);
  quoted.add(`${where}: ${quote}`);
}
/** The page names this part of the admin console; it must be there. */
function inConsole(...names: string[]): void {
  for (const n of names) assert.ok(consolePage.includes(n), `the admin console has no "${n}"`);
}

const freePort = () => new Promise<number>((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

const storePath = (folder: string, name = 'Contacts') => join(folder, `${name}.openhbam.sqlite`);
/** A hosted file with an Admin account, a table and `n` records. */
function makeFile(folder: string, name = 'Contacts', n = 2): void {
  mkdirSync(folder, { recursive: true });
  createStore(storePath(folder, name));
  const store = new Store(storePath(folder, name), name);
  try {
    store.applyDesign([{ op: 'createTable', name: 'People', fields: [{ name: 'Name', type: 'text' }] }]);
    for (let i = 1; i <= n; i++) store.create('People', { Name: `Person ${i}` });
    store.setPassword('Admin', 'the-old-password', '[Full Access]');
  } finally { store.close(); }
}
const peopleIn = (folder: string, name = 'Contacts'): number => {
  const store = new Store(storePath(folder, name), name);
  try { return Number(store.select('SELECT count(*) AS n FROM "People"', [], 5).rows[0][0]); } finally { store.close(); }
};
const canSignIn = (folder: string, account: string, password: string, name = 'Contacts'): boolean => {
  const store = new Store(storePath(folder, name), name);
  try { return store.verify(account, password, ''); } finally { store.close(); }
};

const dataApi = (base: string, db = 'Contacts') => {
  const root = `${base}/fmi/data/vLatest/databases/${db}`;
  return {
    signIn: async (account: string, password: string) => {
      const r = await fetch(`${root}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa(`${account}:${password}`), 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json() as { response: { token?: string }; messages: { code: string; message: string }[] };
      return { status: r.status, code: j.messages[0].code, message: j.messages[0].message, token: j.response.token ?? '', retryAfter: r.headers.get('retry-after') };
    },
    use: async (token: string) => {
      const r = await fetch(`${root}/layouts`, { headers: { authorization: `Bearer ${token}` } });
      const j = await r.json() as { messages: { code: string; message: string }[] };
      return { status: r.status, code: j.messages[0].code, message: j.messages[0].message };
    },
  };
};

const consoleSignIn = (base: string, password: string) => fetch(`${base}/tabularius/admin/v1/sign-in`, {
  method: 'POST', headers: { 'x-tabularius-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ password }),
}).then(async (r) => ({ status: r.status, error: (await r.json() as { error?: string }).error ?? '', cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' }));
const consoleStatus = (base: string, cookie: string) => fetch(`${base}/tabularius/admin/v1/status`, { headers: { cookie, 'x-tabularius-admin': '1' } }).then((r) => r.status);

async function stopServer(s: { server: { close(cb: () => void): unknown }; host: Host }): Promise<void> {
  await new Promise<void>((r) => s.server.close(() => r()));
}
const asAdmin = (folder: string, password: string): void => {
  const r = spawnSync(process.execPath, ['--no-warnings', main, 'admin-password', folder], { encoding: 'utf8', env: { ...CLEAN_ENV, TABULARIUS_PASSWORD: password } });
  assert.equal(r.status, 0, r.stderr);
};

/** A certificate authority and certificates it signs, for the scenarios about certificates. */
function certificates(dir: string) {
  const sh = (args: string[]) => { const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, `openssl ${args.join(' ')}: ${r.stderr}`); };
  writeFileSync(join(dir, 'ca.cnf'), '[ca]\ndefault_ca=d\n[d]\ndir=.\ndatabase=index.txt\nnew_certs_dir=.\nserial=serial\ndefault_md=sha256\npolicy=p\nunique_subject=no\n[p]\ncommonName=supplied\n');
  writeFileSync(join(dir, 'index.txt'), '');
  writeFileSync(join(dir, 'serial'), '01\n');
  sh(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Runbook CA', '-days', '30']);
  let n = 0;
  return {
    ca: join(dir, 'ca.pem'),
    /** A key and certificate (file names returned) for the given names, valid between the two dates. */
    issue(names: string[], dates?: { start: string; end: string }): { cert: string; key: string } {
      const id = ++n;
      const key = `leaf${id}.key`, csr = `leaf${id}.csr`, cert = `leaf${id}.pem`;
      sh(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${names[0]}`]);
      writeFileSync(join(dir, `ext${id}.cnf`), `subjectAltName=${names.map((x) => `${/^[\d.]+$/.test(x) ? 'IP' : 'DNS'}:${x}`).join(',')}\n`);
      const when = dates ?? { start: '20200101000000Z', end: '20990101000000Z' };
      sh(['ca', '-config', 'ca.cnf', '-batch', '-notext', '-cert', 'ca.pem', '-keyfile', 'ca.key', '-in', csr, '-out', cert, '-startdate', when.start, '-enddate', when.end, '-extfile', `ext${id}.cnf`]);
      return { cert: join(dir, cert), key: join(dir, key) };
    },
  };
}
const haveOpenssl = spawnSync('openssl', ['version']).status === 0;

// --- 1 and 2: the admin console password -----------------------------------------------------------------------

test('forgot the admin console password, and locked out of the admin console', async () => {
  const folder = tmp('console');
  makeFile(folder);
  const s = await serve({ dir: folder, port: 0, log: quiet });
  try {
    // The password was set once and is now lost: the person only has the sign-in page.
    asAdmin(folder, 'the-forgotten-one');
    assert.ok(existsSync(join(folder, '.openhbam-admin')), 'the page names the .openhbam-admin file');
    assert.doesNotMatch(readFileSync(join(folder, '.openhbam-admin'), 'utf8'), /the-forgotten-one/);
    const wrong = await consoleSignIn(s.url, 'a-guess');
    assert.equal(wrong.status, 401);
    sees('Forgot the admin console password', 'Wrong admin password', wrong.error);
    const signedIn = await consoleSignIn(s.url, 'the-forgotten-one');
    assert.equal(await consoleStatus(s.url, signedIn.cookie), 200);

    const r = runStep('Forgot the admin console password', 'tabularius admin-password <folder>', { folder }, { input: 'a-fresh-console-pass\n' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /admin password set for /);
    assert.equal((await consoleSignIn(s.url, 'a-fresh-console-pass')).status, 200, 'the new password signs in at once, with the server still running');
    assert.equal((await consoleSignIn(s.url, 'the-forgotten-one')).status, 401, 'the old one is refused');
    assert.equal(await consoleStatus(s.url, signedIn.cookie), 401, 'a console tab signed in with the old password is signed out');
    assert.ok(existsSync(join(folder, '.openhbam-admin')));

    // Locked out: five wrong passwords from this address.
    let locked = { status: 0, error: '' };
    for (let i = 0; i < 5; i++) locked = await consoleSignIn(s.url, `guess ${i}`);
    const refused = await consoleSignIn(s.url, 'a-fresh-console-pass');
    assert.equal(refused.status, 429, 'even the right password is refused while the address is locked');
    assert.match(refused.error, /^Too many failed attempts\. Try again in (89\d|900) seconds\.$/);
    sees('Locked out of the admin console', 'Too many failed attempts. Try again in 900 seconds.', refused.error.replace(/\d+ seconds/, '900 seconds'));
    // Setting the password again does not lift it.
    const again = runStep('Forgot the admin console password', 'tabularius admin-password <folder>', { folder }, { input: 'yet-another-console-pass\n' });
    assert.equal(again.status, 0);
    assert.equal((await consoleSignIn(s.url, 'yet-another-console-pass')).status, 429);

    // A restart clears it, and ends the sessions the server held in memory.
    const api = dataApi(s.url);
    const token = (await api.signIn('Admin', 'the-old-password')).token;
    assert.ok(token);
    await stopServer(s);
    const restarted = await serve({ dir: folder, port: 0, log: quiet });
    try {
      assert.equal((await consoleSignIn(restarted.url, 'yet-another-console-pass')).status, 200, 'a restart lifts the console lock');
      assert.equal((await dataApi(restarted.url).use(token)).status, 401, 'a restart ends sessions');
    } finally { await stopServer(restarted); }
  } finally { await stopServer(s).catch(quiet); }
});

// --- 3 and 4: a file's accounts --------------------------------------------------------------------------------

test('forgot a file account password, and an account is locked out', async () => {
  const folder = tmp('accounts');
  makeFile(folder);
  asAdmin(folder, 'console-pass-1');
  const s = await serve({ dir: folder, port: 0, log: quiet });
  const api = dataApi(s.url);
  const call = (template: string, fill: Fill) => runCurl('An account is locked out', template, fill, s.url, 'console-pass-1');
  try {
    const store = s.host.get('Contacts')!;
    store.setPassword('pat', 'pats-old-password', '[Full Access]');
    // Forgot: the person types a wrong one and sees 212.
    const forgot = await api.signIn('pat', 'a guess');
    assert.equal(forgot.status, 401);
    sees('Forgot the password of a file\'s account', 'Invalid user account and/or password; please try again', forgot.message);
    assert.equal(forgot.code, '212');

    const held = (await api.signIn('pat', 'pats-old-password')).token;
    const set = runStep('Forgot the password of a file\'s account', 'tabularius passwd <folder> <database> <account>', { folder, database: 'Contacts', account: 'pat' }, { input: 'pats-new-password\n' });
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /password set for pat in Contacts/);
    assert.match(set.stderr, /note: the server is running .*signed out at their next call.*lockout on it stays/, 'it says what it cannot reach');
    assert.equal((await api.signIn('pat', 'pats-new-password')).status, 200, 'the new password works with the server running');
    assert.equal((await api.signIn('pat', 'pats-old-password')).code, '212');
    assert.equal((await api.use(held)).status, 401, 'a session already signed in ends at its next call, as the page says');
    assert.equal((await api.use((await api.signIn('pat', 'pats-new-password')).token)).status, 200, 'signing in again works');
    inConsole('Security health', 'Account access', 'Set password', 'Unlock', 'Active sessions and tokens');

    // The console's Set password lifts a lockout; the command line cannot reach the running server's lockouts.
    for (let i = 0; i < LOCKOUT.attempts; i++) await api.signIn('pat', `wrong ${i}`);
    const locked = await api.signIn('pat', 'pats-new-password');
    assert.equal(locked.status, 401);
    assert.equal(locked.code, '212');
    sees('An account is locked out', 'Too many failed sign-ins; try again after', locked.message);
    assert.ok(Number(locked.retryAfter) > 0 && Number(locked.retryAfter) <= 900, 'a Retry-After header says how long');
    assert.match(locked.message, /try again after \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'the time is UTC');
    assert.equal(LOCKOUT.attempts, 5);
    assert.equal(LOCKOUT.lockMs, 15 * 60_000);
    assert.equal(LOCKOUT.addressAttempts, 30);

    runStep('Forgot the password of a file\'s account', 'tabularius passwd <folder> <database> <account>', { folder, database: 'Contacts', account: 'pat' }, { input: 'pats-newer-password\n' });
    assert.equal((await api.signIn('pat', 'pats-newer-password')).code, '212', 'passwd on the command line leaves the lock in the running server');

    const unlocked = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/accounts/unlock -d \'{"database":"<database>","account":"<account>"}\'', { database: 'Contacts', account: 'pat' });
    assert.equal(unlocked.status, 200);
    assert.equal(unlocked.body, '{"ok":true,"cleared":true}');
    assert.equal((await api.signIn('pat', 'pats-newer-password')).status, 200, 'the right password signs in once the lock is lifted');
    const nothing = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/accounts/unlock -d \'{"database":"<database>","account":"<account>"}\'', { database: 'Contacts', account: 'pat' });
    assert.equal(nothing.body, '{"ok":true,"cleared":false}', 'cleared:false means there was no lock to lift');

    // Setting a password in the console also lifts the lock.
    for (let i = 0; i < LOCKOUT.attempts; i++) await api.signIn('pat', `wrong ${i}`);
    assert.match((await api.signIn('pat', 'pats-newer-password')).message, /Too many failed sign-ins/);
    const viaConsole = await fetch(`${s.url}/tabularius/admin/v1/accounts/set-password`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa(':console-pass-1'), 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ database: 'Contacts', account: 'pat', password: 'set-in-the-console' }),
    });
    assert.equal(viaConsole.status, 200);
    assert.equal((await api.signIn('pat', 'set-in-the-console')).status, 200, 'Set password lifts the lock too');

    // A blocked address: the same call with "address".
    const addr = '203.0.113.5';
    const unlockAddress = await fetch(`${s.url}/tabularius/admin/v1/accounts/unlock`, {
      method: 'POST', headers: { authorization: 'Basic ' + btoa(':console-pass-1'), 'x-tabularius-admin': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ database: 'Contacts', address: addr }),
    });
    assert.equal(await unlockAddress.text(), '{"ok":true,"cleared":false}');
    assert.ok(section('An account is locked out').includes('"address":"<address>"'));

    // Restarting the server clears a lock too, as the page says.
    for (let i = 0; i < LOCKOUT.attempts; i++) await api.signIn('pat', `wrong ${i}`);
    assert.match((await api.signIn('pat', 'set-in-the-console')).message, /Too many failed sign-ins/);
    await stopServer(s);
    const again = await serve({ dir: folder, port: 0, log: quiet });
    try { assert.equal((await dataApi(again.url).signIn('pat', 'set-in-the-console')).status, 200); } finally { await stopServer(again); }
    return;
  } finally { await stopServer(s).catch(quiet); }
});

// --- 5: access that must end now -------------------------------------------------------------------------------

test('someone\'s access must end now', async () => {
  const folder = tmp('revoke');
  makeFile(folder);
  asAdmin(folder, 'console-pass-2');
  const s = await serve({ dir: folder, port: 0, log: quiet });
  const api = dataApi(s.url);
  const where = 'Someone\'s access must end now';
  const call = (template: string, fill: Fill) => runCurl(where, template, fill, s.url, 'console-pass-2');
  try {
    const store = s.host.get('Contacts')!;
    store.setPassword('Boss', 'boss-password-1', '[Full Access]');
    store.setPassword('pat', 'pats-password-1', '[Full Access]');
    store.setPassword('sam', 'sams-password-1', '[Full Access]');
    const standing = (account: string) => store.createApiToken(account, { label: 'ci' });
    const usable = async (token: string) => (await fetch(`${s.url}/fmi/data/vLatest/databases/Contacts/layouts`, { headers: { authorization: `Bearer ${token}` } })).status === 200;

    // Sessions only: ending them does not stop the account signing in again, and does not touch a standing token.
    const pat = standing('pat');
    const session = (await api.signIn('pat', 'pats-password-1')).token;
    const listed = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" "http://localhost:8080/tabularius/admin/v1/sessions?database=<database>"', { database: 'Contacts' });
    assert.ok((JSON.parse(listed.body).sessions as { account: string }[]).some((x) => x.account === 'pat'));
    const ended = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/sessions/end -d \'{"database":"<database>","account":"<account>"}\'', { database: 'Contacts', account: 'pat' });
    assert.match(ended.body, /^\{"ended":\d+\}$/);
    const after = await api.use(session);
    assert.equal(after.code, '952');
    sees(where, 'Invalid FileMaker Data API token (*)', after.message);
    assert.equal(await usable(pat), true, 'ending sessions leaves a standing token working');
    assert.equal((await api.signIn('pat', 'pats-password-1')).status, 200, 'and the account can sign in again');

    // The token list shows it, and Revoke ends it.
    const health = await fetch(`${s.url}/tabularius/admin/v1/health?database=Contacts`, { headers: { authorization: 'Basic ' + btoa(':console-pass-2'), 'x-tabularius-admin': '1' } }).then((r) => r.json()) as { databases: { broadTokens: { id: string; account: string }[] }[] };
    const id = health.databases[0].broadTokens.find((t) => t.account === 'pat')!.id;
    const revoked = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/health/revoke-token -d \'{"database":"<database>","id":"<token-id>"}\'', { database: 'Contacts', 'token-id': id });
    assert.equal(revoked.body, '{"revoked":true}');
    assert.equal(await usable(pat), false, 'a revoked token is refused');
    inConsole('Sign out', 'Revoke', 'End every session for');

    // Turning the account off does all of it at once.
    const sam = standing('sam');
    const samSession = (await api.signIn('sam', 'sams-password-1')).token;
    const off = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/health/fix-account -d \'{"database":"<database>","account":"<account>","action":"deactivate"}\'', { database: 'Contacts', account: 'sam' });
    assert.equal(off.status, 200, off.body);
    assert.equal(JSON.parse(off.body).deactivated, true);
    assert.equal((await api.use(samSession)).status, 401, 'the session is ended');
    assert.equal(await usable(sam), false, 'the standing token is refused');
    assert.equal((await api.signIn('sam', 'sams-password-1')).code, '212', 'and the account cannot sign in');
    // Turned back on where ADMIN.md says: the Active setting.
    assert.equal(store.setAccountActive('sam', true), true);
    assert.equal((await api.signIn('sam', 'sams-password-1')).status, 200);
  } finally { await stopServer(s); }

  // A file whose only working Full Access account is the one being turned off refuses it.
  const solo = tmp('solo');
  createStore(storePath(solo));
  asAdmin(solo, 'console-pass-2b');
  const lone = await serve({ dir: solo, port: 0, log: quiet });
  try {
    lone.host.get('Contacts')!.setPassword('Boss', 'boss-password-1', '[Full Access]');
    const last = await runCurl(where, 'curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -H "content-type: application/json" -X POST http://localhost:8080/tabularius/admin/v1/health/fix-account -d \'{"database":"<database>","account":"<account>","action":"deactivate"}\'', { database: 'Contacts', account: 'Boss' }, lone.url, 'console-pass-2b');
    assert.equal(last.status, 400);
    assert.match(last.body, /Cannot remove the last account with full access/);
    assert.ok(section(where).includes('if it is not the last account with Full Access'));
  } finally { await stopServer(lone); }
});

// --- 6: a runaway script ---------------------------------------------------------------------------------------

test('a script is running away', async () => {
  const folder = tmp('runaway');
  makeFile(folder);
  asAdmin(folder, 'console-pass-3');
  const s = await serve({ dir: folder, port: 0, log: quiet });
  const where = 'A script is running away';
  try {
    const store = s.host.get('Contacts')!;
    store.applyDesign([{ op: 'createScript', name: 'Forever', text: ['Loop', '  Set Variable [ $i ; Value: $i + 1 ]', 'End Loop'].join('\n') }]);
    const { runScript } = await import('../../scripts/src/index.ts');
    // A schedule or Perform Script on Server runs through the server's queue like this.
    const job = s.host.serverScripts.run((stop) => runScript(store, 'Forever', { ...(stop ? { stop } : {}), maxSteps: 100_000_000, timeoutMs: 120_000 }), { file: 'Contacts', script: 'Forever', kind: 'schedule' });
    const call = (template: string, fill: Fill = {}) => runCurl(where, template, fill, s.url, 'console-pass-3');
    await until('the script to be running', async () => JSON.parse((await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" "http://localhost:8080/tabularius/admin/v1/server-scripts"')).body).running.length === 1);
    const running = JSON.parse((await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" "http://localhost:8080/tabularius/admin/v1/server-scripts"')).body).running[0] as { id: string; script: string };
    assert.equal(running.script, 'Forever');
    const stopped = await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" -X POST http://localhost:8080/tabularius/admin/v1/server-scripts/<script-id>/cancel', { 'script-id': running.id });
    assert.equal(stopped.body, '{"canceled":true}');
    const result = await job;
    assert.equal(result.error, 1, 'it ends as "user canceled action"');
    const after = JSON.parse((await call('curl -sS -u ":<console-password>" -H "x-tabularius-admin: 1" "http://localhost:8080/tabularius/admin/v1/server-scripts"')).body) as { running: unknown[]; recent: { outcome: string }[] };
    assert.equal(after.running.length, 0);
    assert.equal(after.recent[0].outcome, 'canceled');
    inConsole('Running on the server', 'Cancel');
    inConsole('Hosted files', 'Converting');
  } finally { await stopServer(s); }
});

// --- 7: the port is taken --------------------------------------------------------------------------------------

test('the port is already in use', async () => {
  const folder = tmp('port');
  makeFile(folder);
  asAdmin(folder, 'console-pass-4');
  const holder = createServer();
  await new Promise<void>((ok) => holder.listen(0, '127.0.0.1', ok));
  const port = (holder.address() as { port: number }).port;
  const where = 'The port is already in use';
  try {
    const refused = runStep(where, 'tabularius serve <folder> --port 8081', { folder }, { swap: { 8081: String(port) } });
    assert.equal(refused.status, 1);
    sees(where, 'port 8080 is in use: another program is already listening on', refused.stderr.replace(String(port), '8080'));
    assert.match(refused.stderr, /lsof -nP -iTCP:\d+ -sTCP:LISTEN/);
    const doctor = runStep(where, 'tabularius doctor <folder> --port 8080', { folder }, { swap: { 8080: String(port) } });
    assert.match(doctor.stdout, new RegExp(`check\\s+Port: port ${port} is in use`));
    assert.match(doctor.stdout, new RegExp(`--port ${port + 1}`), 'it names the next port to try');
    assert.ok(section(where).includes('`port 8080 is in use`'));
    // The other port, as the page says.
    const other = await freePort();
    const running = startStep(where, 'tabularius serve <folder> --port 8081', { folder }, { swap: { 8081: String(other) } });
    await until('the server on the other port', async () => fetch(`http://127.0.0.1:${other}/tabularius/health`).then((r) => r.ok, () => false));
    assert.match(running.out(), new RegExp(`127\\.0\\.0\\.1:${other}/`));
    await stopChild(running.child);
  } finally { holder.close(); }
});

// --- 8: too many open files ------------------------------------------------------------------------------------

test('too many open files', { skip: !posix && 'needs ulimit' }, async () => {
  const folder = tmp('emfile');
  makeFile(folder);
  const where = 'Too many open files';
  assert.ok(section(where).includes('`ulimit -n`') || section(where).includes('ulimit -n\n'));
  const port = await freePort();
  // The page's `serve` command, started under a low limit the way a service manager's limit would apply.
  const child = spawn('bash', ['-c', `ulimit -n 48; exec "${process.execPath}" --no-warnings "${main}" serve "${folder}" --port ${port} --no-backups`], { env: { ...CLEAN_ENV, HOME: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (d) => { out += d; });
  child.stderr!.on('data', (d) => { out += d; });
  // A fresh connection each time: a kept-alive one would get through while the limit is reached.
  const probe = () => new Promise<number>((done) => {
    const req = httpGet(`http://127.0.0.1:${port}/tabularius/health`, { agent: false, timeout: 3000 }, (res) => { res.resume(); done(res.statusCode ?? 0); });
    req.on('error', () => done(0));
    req.on('timeout', () => req.destroy());
  });
  await until('the server', async () => (await probe()) === 200);
  const limit = spawnSync('bash', ['-c', `ulimit -n 48; ulimit -n`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(limit, '48');
  const held = [];
  for (let i = 0; i < 120; i++) { const c = connect(port, '127.0.0.1'); c.on('error', () => {}); held.push(c); await new Promise((r) => setTimeout(r, 10)); }
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await probe(), 0, 'while the limit is reached, new connections fail');
  for (const c of held) c.destroy();
  await until('the server to answer again', async () => (await probe()) === 200, 20_000);
  assert.equal(child.exitCode, null, 'the server did not stop');
  // Whether the log shows it depends on which call met the limit; when it does, it is Node's own text.
  for (const line of out.split('\n').filter((l) => /EMFILE/.test(l))) assert.match(line, /EMFILE: too many open files/);
  assert.ok(section(where).includes('EMFILE: too many open files'));
  await stopChild(child);
});

// --- 9: a conversion cut off -----------------------------------------------------------------------------------

test('a file never finishes converting', async () => {
  const folder = tmp('convert');
  const where = 'A file never finishes converting';
  copyFileSync(join(root, 'fixtures', 'fmp12', 'Charts.fmp12'), join(folder, 'Charts.fmp12'));
  const arm = join(tmp('convert-arm'), 'arm.mjs');
  writeFileSync(arm, `import { armCrashPointForTest } from ${JSON.stringify(new URL('../../store/src/crash-point.ts', import.meta.url).href)};\narmCrashPointForTest('host-conversion:after-convert');\n`);
  const port = await freePort();
  // The server is cut off after the conversion has done its work and before it is published.
  const first = startStep(where, 'tabularius serve <folder>', { folder }, { execArgv: ['--import', new URL(`file://${arm}`).href], swap: {}, env: { PORT: String(port) } });
  assert.equal(await first.exited, 73, 'cut off at the chosen point');
  assert.match(first.out(), /converting Charts\.fmp12/);
  assert.doesNotMatch(first.out(), /converted Charts\.fmp12/);
  assert.equal(existsSync(join(folder, 'Charts.openhbam.sqlite')) && readFileSync(join(folder, 'Charts.openhbam.sqlite')).length > 0, false, 'nothing was published');

  const doctor = runStep(where, 'tabularius doctor <folder>', { folder }, { env: { PORT: String(port) } });
  assert.doesNotMatch(doctor.stdout, /PROBLEM/);
  // Start again, as the page says.
  const second = startStep(where, 'tabularius serve <folder>', { folder }, { env: { PORT: String(port) } });
  await until('the file to be hosted', () => /converted Charts\.fmp12: \d+ tables?, \d+ records/.test(second.out()), 120_000);
  assert.match(second.out(), /converting Charts\.fmp12/);
  assert.match(second.out(), /converted Charts\.fmp12: \d+ tables, \d+ records; now hosting Charts/);
  sees(where, 'converted Charts.fmp12: N tables, N records; now hosting Charts', second.out().replace(/converted Charts\.fmp12: \d+ tables, \d+ records; now hosting Charts/, 'converted Charts.fmp12: N tables, N records; now hosting Charts'));
  await stopChild(second.child);
  assert.deepEqual(readFileSync(join(folder, 'Charts.fmp12')), readFileSync(join(root, 'fixtures', 'fmp12', 'Charts.fmp12')), 'the .fmp12 is never changed');
});

// --- 10: a damaged hosted file ---------------------------------------------------------------------------------

const cliRaw = (args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): Result => {
  const r = spawnSync(process.execPath, ['--no-warnings', main, ...args], { encoding: 'utf8', input: opts.input ?? '', timeout: 90_000, env: { ...CLEAN_ENV, HOME: tmpdir(), ...opts.env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** Writes over the start of a file, as a failing disk or a bad copy might. */
function damage(path: string, at = 0, length = 4096): void {
  const fd = openSync(path, 'r+');
  try { writeSync(fd, Buffer.alloc(length, 0xab), 0, length, at); } finally { closeSync(fd); }
}

test('a hosted file is damaged', async () => {
  const folder = tmp('damaged');
  const scratch = tmp('damaged-scratch');
  const where = 'A hosted file is damaged';
  makeFile(folder, 'Contacts', 3);
  makeFile(folder, 'Other', 1);
  assert.equal(cliRaw(['backup', folder]).status, 0);
  const set = readdirSync(join(folder, 'Backups')).filter((n) => /^\d{4}-/.test(n)).sort().at(-1)!;
  // A change after the backup, which the restore will not have.
  const later = new Store(storePath(folder), 'Contacts');
  later.create('People', { Name: 'Added after the backup' });
  later.close();
  assert.equal(peopleIn(folder), 4);
  // The first page of the file is gone.
  damage(storePath(folder));
  for (const ext of ['-wal', '-shm']) rmSync(storePath(folder) + ext, { force: true });

  const logs: string[] = [];
  const s = await serve({ dir: folder, port: 0, log: (m) => logs.push(m) });
  try {
    await until('the damage to be noticed', () => logs.some((l) => /Contacts/.test(l) && /damaged|not a database/.test(l)));
    const line = logs.find((l) => /Contacts/.test(l) && /damaged|not a database/.test(l))!;
    sees(where, 'is damaged (file is not a database) and is not being served', line);
    assert.equal((await dataApi(s.url, 'Other').signIn('Admin', 'the-old-password')).status, 200, 'the other file is served');
  } finally { await stopServer(s); }

  // The page's steps, in order, with the server stopped.
  const doctor = runStep(where, 'tabularius doctor <folder>', { folder });
  assert.match(doctor.stdout, /PROBLEM Damaged file: /);
  assert.equal(doctor.status, 1);
  const verify = runStep(where, 'tabularius verify-backup <folder>', { folder });
  assert.equal(verify.status, 0, verify.stderr + verify.stdout);
  assert.match(verify.stdout, /checked: 2 files ok/);
  // Look first: restore into a scratch folder and read it.
  const look = runStep(where, 'tabularius restore <scratch-folder> <folder>/Backups/<backup-set> <database>', { 'scratch-folder': scratch, folder, 'backup-set': set, database: 'Contacts' });
  assert.equal(look.status, 0, look.stderr);
  assert.equal(look.stdout, 'restored Contacts.openhbam.sqlite\n');
  const rows = runStep(where, 'tabularius records <scratch-folder> <database> <table>', { 'scratch-folder': scratch, database: 'Contacts', table: 'People' });
  assert.equal(rows.stdout.trim().split('\n').length, 3, 'the backup has the three records it was taken with');
  // Keep the damaged file's bytes, then put the backup in the real folder.
  const kept = readFileSync(storePath(folder));
  const real = runStep(where, 'tabularius restore <folder> <backup-set> <database>', { folder, 'backup-set': set, database: 'Contacts' });
  assert.equal(real.status, 0, real.stderr);
  assert.equal(real.stdout, 'restored Contacts.openhbam.sqlite\n');
  assert.notDeepEqual(readFileSync(storePath(folder)), kept);
  const after = runStep(where, 'tabularius doctor <folder>', { folder });
  assert.equal(after.status, 0, after.stdout);
  assert.match(after.stdout, /ok\s+Pages: 2 files read cleanly/);
  assert.equal(peopleIn(folder), 3, 'every change since the backup is gone');
  assert.equal(peopleIn(folder, 'Other'), 1, 'the other file was not touched');
  // The damaged file could not be read, so nothing of its sign-in state was carried over.
  assert.equal(canSignIn(folder, 'Admin', 'the-old-password'), false);
  assert.equal(canSignIn(folder, 'Admin', 'the-old-password', 'Other'), true, 'the other file keeps its password');
  const accounts = runStep(where, 'tabularius privileges <folder> <database>', { folder, database: 'Contacts' });
  assert.match(accounts.stdout, /Accounts\n {2}Admin +\[Full Access\] +no password yet\n/);
  sees(where, 'no password yet', accounts.stdout);
  assert.equal(runStep(where, 'tabularius passwd <folder> <database> <account>', { folder, database: 'Contacts', account: 'Admin' }, { input: 'a-password-again\n' }).status, 0);
  assert.equal(canSignIn(folder, 'Admin', 'a-password-again'), true);
  const again = await serve({ dir: folder, port: 0, log: quiet });
  try { assert.equal((await dataApi(again.url).signIn('Admin', 'a-password-again')).status, 200, 'served again'); } finally { await stopServer(again); }
});

test('a restore lists accounts that differ from the backup and stops until they are accepted', () => {
  const folder = tmp('accounts-differ');
  const where = 'A hosted file is damaged';
  makeFile(folder, 'Contacts', 3);
  assert.equal(cliRaw(['backup', folder]).status, 0);
  const set = readdirSync(join(folder, 'Backups')).filter((n) => /^\d{4}-/.test(n)).sort().at(-1)!;
  // After the backup: an account added, and a record.
  const later = new Store(storePath(folder), 'Contacts');
  later.setPassword('Amy', 'amys-password', '[Full Access]');
  later.create('People', { Name: 'Added after the backup' });
  later.close();
  const stopped = runStep(where, 'tabularius restore <folder> <backup-set> <database>', { folder, 'backup-set': set, database: 'Contacts' });
  assert.equal(stopped.status, 1);
  assert.match(stopped.stderr, /Contacts: Amy has been added since the backup, so it is gone after this restore/);
  assert.match(stopped.stderr, /Nothing was restored\. Read the list, then run the same command again with --accept-account-changes/);
  assert.equal(stopped.stdout, '');
  assert.equal(peopleIn(folder), 4, 'nothing was restored');
  const accepted = runStep(where, 'tabularius restore <folder> <backup-set> <database> --accept-account-changes', { folder, 'backup-set': set, database: 'Contacts' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /^restored Contacts\.openhbam\.sqlite\n/);
  assert.match(accepted.stdout, /Accounts that are not as they were before this restore[^\n]*:\n {2}Contacts: Amy has been added since the backup/);
  assert.equal(peopleIn(folder), 3, 'the backup is what is there');
});

test('a restore refuses a backup set as unsigned or altered', () => {
  const folder = tmp('unsigned');
  const where = 'A restore refuses a backup set as unsigned or altered';
  const env = { TABULARIUS_BACKUP_KEY: 'the backup passphrase' };
  makeFile(folder, 'Contacts', 3);
  assert.equal(cliRaw(['backup', folder], { env }).status, 0);
  const set = readdirSync(join(folder, 'Backups')).filter((n) => /^\d{4}-/.test(n)).sort().at(-1)!;
  // A set from before signatures existed: the same set with its signature gone.
  const manifestPath = join(folder, 'Backups', set, 'backup.json');
  const info = JSON.parse(readFileSync(manifestPath, 'utf8'));
  delete info.auth;
  writeFileSync(manifestPath, JSON.stringify(info));
  const later = new Store(storePath(folder), 'Contacts');
  later.create('People', { Name: 'Added after the backup' });
  later.close();
  const refused = runStep(where, 'tabularius restore <folder> <backup-set>', { folder, 'backup-set': set }, { env });
  assert.equal(refused.status, 1);
  sees(where, 'backup.json has no signature, so nothing says the checksums in it are the ones this backup was made with', refused.stderr);
  assert.equal(peopleIn(folder), 4, 'nothing was restored');
  // The page's step: read every copy back and sign the set, after which it restores like any other.
  const sign = runStep(where, 'tabularius verify-backup <folder> <backup-set> --sign', { folder, 'backup-set': set }, { env });
  assert.equal(sign.status, 0, sign.stderr + sign.stdout);
  const restored = runStep(where, 'tabularius restore <folder> <backup-set>', { folder, 'backup-set': set }, { env });
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /restored Contacts\.openhbam\.sqlite/);
  assert.equal(peopleIn(folder), 3, 'the backup is what is there');
});

// --- 11: the disk is full during a backup ----------------------------------------------------------------------

test('the backup could not be made: the disk is full', async () => {
  const folder = tmp('diskfull');
  const elsewhere = tmp('diskfull-elsewhere');
  const where = 'The backup could not be made: the disk is full';
  makeFile(folder, 'Contacts', 50);
  assert.equal(cliRaw(['backup', folder]).status, 0);
  const sets = () => readdirSync(join(folder, 'Backups')).filter((n) => /^\d{4}-/.test(n));
  const before = sets();
  assert.equal(before.length, 1);
  // The same refusal a server's scheduled backup and the console's "Back up now" get when the disk has 20 KB free.
  const message = await backupFolder(folder, join(folder, 'Backups'), 7, undefined, { statfs: () => ({ bavail: 5, bsize: 4096 }), now: () => Date.now() + 60_000 }).then(() => '', (e: Error) => e.message);
  sees(where, 'not enough free disk space for a backup in', message);
  assert.match(message, /: it needs about [\d.]+ (KB|MB) free, 20 KB available$/);
  assert.deepEqual(sets(), before, 'nothing partial was left, and the older set is kept');
  assert.deepEqual(readdirSync(join(folder, 'Backups')).filter((n) => n.endsWith('.partial')), []);
  assert.ok(section(where).includes('backup failed:'), 'the page says the log line starts with that');
  inConsole('Last scheduled backup', 'failed, ', 'Back up now');

  // The page's way out: a backup to another disk, checked there.
  const made = runStep(where, 'tabularius backup <folder> --to <other-disk-folder>', { folder, 'other-disk-folder': elsewhere });
  assert.equal(made.status, 0, made.stderr);
  sees(where, 'backed up N files to', made.stdout.replace(/backed up \d+ files to/, 'backed up N files to'));
  const verified = runStep(where, 'tabularius verify-backup <folder> --from <other-disk-folder>', { folder, 'other-disk-folder': elsewhere });
  assert.equal(verified.status, 0, verified.stderr);
  sees(where, 'checked: N file ok', verified.stdout.replace(/checked: \d+ files? ok/, 'checked: N file ok'));
  // And the space `doctor` budgets for.
  const doctor = cliRaw(['doctor', folder]);
  assert.match(doctor.stdout, /Disk: .*recommended for hosted files, backups, the write-ahead log and a backup run/);
  assert.ok(section(where).includes('could not be written: the disk is full'));
});

// --- 12: certificates ------------------------------------------------------------------------------------------

test('the certificate expired, or is for the wrong name', { skip: !haveOpenssl && 'needs openssl' }, async () => {
  const where = 'The certificate expired, or is for the wrong name';
  const dir = tmp('certs');
  const folder = tmp('certs-folder');
  makeFile(folder);
  const ca = certificates(dir);
  const expired = ca.issue(['localhost', '127.0.0.1'], { start: '20200101000000Z', end: '20200102000000Z' });
  const good = ca.issue(['localhost', '127.0.0.1']);
  const other = ca.issue(['other.example']);

  // The folder's settings name files that have run out.
  const settings = join(folder, '.openhbam-settings.json');
  writeFileSync(settings, JSON.stringify({ tlsCert: expired.cert, tlsKey: expired.key }));
  const old = runStep(where, 'tabularius doctor <folder>', { folder });
  assert.match(old.stdout, /PROBLEM Certificate: expired \d+ days ago/);
  sees(where, 'PROBLEM Certificate: expired 3 days ago', old.stdout.replace(/expired \d+ days ago/, 'expired 3 days ago'));
  assert.equal(old.status, 1);
  // Put the new files where the old ones were, as the page says.
  copyFileSync(good.cert, expired.cert);
  copyFileSync(good.key, expired.key);
  const renewed = runStep(where, 'tabularius doctor <folder>', { folder });
  assert.match(renewed.stdout, /ok\s+Certificate: valid until /);
  sees(where, 'Certificate: valid until', renewed.stdout);

  // What a browser sees at the address people use.
  const asked = async (files: { cert: string; key: string }, trust: boolean) => {
    const s = await serve({ dir: folder, port: 0, log: quiet, tlsCert: files.cert, tlsKey: files.key });
    try {
      const port = new URL(s.url).port;
      return await runStepAsync(where, 'tabularius doctor <folder> --url https://<name>', { folder, name: `localhost:${port}` }, { env: trust ? { NODE_EXTRA_CA_CERTS: ca.ca } : {} });
    } finally { await stopServer(s); }
  };
  const fine = await asked(good, true);
  assert.match(fine.stdout, /ok\s+Address: https:\/\/localhost:\d+ answers\n/);
  sees(where, 'Address: ... answers', fine.stdout.replace(/Address: https:\/\/localhost:\d+ answers/, 'Address: ... answers'));
  const wrong = await asked(other, true);
  assert.match(wrong.stdout, /PROBLEM Address: https:\/\/localhost:\d+ answers, but a browser would refuse it: its certificate is for other names \(/);
  assert.equal(wrong.status, 1);
  sees(where, 'PROBLEM Address: ... its certificate is for other names', wrong.stdout.replace(/Address: https:\/\/localhost:\d+ answers, but a browser would refuse it: /, 'Address: ... '));
  const lapsed = ca.issue(['localhost', '127.0.0.1'], { start: '20200101000000Z', end: '20200102000000Z' });
  const old2 = await asked(lapsed, true);
  assert.match(old2.stdout, /PROBLEM Address: .* a browser would refuse it: its certificate has expired/);
  const untrusted = await asked(good, false);
  assert.match(untrusted.stdout, /check\s+Address: .* a browser would refuse it: its certificate was not made by an authority this computer trusts/);
  assert.equal(untrusted.status, 0, 'an authority that is not trusted is something to look at, not a failure');
  sees(where, 'check Address: ... was not made by an authority this computer trusts', untrusted.stdout.replace(/Address: https:\/\/localhost:\d+ answers, but a browser would refuse it: its certificate /, 'Address: ... '));
  assert.ok(section(where).includes('/tabularius/tls/'));
});

// --- 13: the clock ---------------------------------------------------------------------------------------------

test('the computer\'s clock was wrong', async () => {
  const where = 'The computer\'s clock was wrong';
  const folder = tmp('clock');
  makeFile(folder);
  const sets = () => readdirSync(join(folder, 'Backups')).filter((n) => /^\d{4}-/.test(n)).sort();
  assert.equal(cliRaw(['backup', folder]).status, 0);
  const [first] = sets();
  // A set made while the clock was ahead: its folder's date is days from now.
  const ahead = new Date(Date.now() + 5 * 86_400_000);
  utimesSync(join(folder, 'Backups', first), ahead, ahead);
  const doctor = runStep(where, 'tabularius doctor <folder>', { folder });
  assert.match(doctor.stdout, /check\s+Backups: the newest of 1 \(.*\) was made 5 days from now by this computer's clock/);
  sees(where, 'was made 5 days from now by this computer\'s clock', doctor.stdout);
  assert.match(doctor.stdout, /Set the clock right, then run: tabularius backup /);
  // A set taken while the clock is ahead keeps its wrong name, and the sets after it are named after it.
  const future = await backupFolder(folder, join(folder, 'Backups'), 0, undefined, { now: () => Date.now() + 30 * 86_400_000 });
  const afterFuture = await backupFolder(folder, join(folder, 'Backups'), 0, undefined);
  assert.ok(afterFuture.dir > future.dir, 'a later set is named after the one dated ahead');
  rmSync(future.dir, { recursive: true, force: true });
  rmSync(afterFuture.dir, { recursive: true, force: true });
  // A set taken with the clock set back is named just after the newest, so the order stays right.
  const back = await backupFolder(folder, join(folder, 'Backups'), 0, undefined, { now: () => Date.now() - 400 * 86_400_000 });
  const named = sets();
  assert.equal(named.length, 2);
  assert.equal(join(folder, 'Backups', named[1]), back.dir, 'the later set sorts after the earlier');
  // The page's own step: after the clock is right, a backup, then doctor.
  const made = runStep(where, 'tabularius backup <folder>', { folder });
  assert.equal(made.status, 0, made.stderr);
  const names = sets();
  assert.equal(names.length, 3);
  assert.ok(names[2] > names[1] && names[1] > names[0], 'every set sorts after the one before it');
  const again = runStep(where, 'tabularius doctor <folder>', { folder });
  assert.doesNotMatch(again.stdout, /from now by this computer's clock/, 'the newest set is now a good one');
  assert.ok(section(where).includes('clock-audit.md'));
});

// --- 14: the folder was moved ----------------------------------------------------------------------------------

test('the folder was moved', async () => {
  const where = 'The folder was moved';
  const base = tmp('moved');
  const oldFolder = join(base, 'old');
  const newFolder = join(base, 'new');
  makeFile(oldFolder);
  writeFileSync(join(oldFolder, '.openhbam-settings.json'), JSON.stringify({ backupDir: join(oldFolder, 'Backups') }));
  const home = tmp('moved-home');
  writeFileSync(join(home, 'service.json'), JSON.stringify({ platform: process.platform, folder: oldFolder, port: await freePort(), host: '127.0.0.1', system: false, extra: [] }));
  renameSync(oldFolder, newFolder);
  const doctor = runStep(where, 'tabularius doctor <new-folder>', { 'new-folder': newFolder }, { env: { TABULARIUS_HOME: home } });
  assert.match(doctor.stdout, new RegExp(`check\\s+Backups: no backup folder yet \\(${oldFolder.replace(/[/.]/g, '\\$&')}/Backups\\)`));
  sees(where, 'no backup folder yet', doctor.stdout);
  assert.match(doctor.stdout, new RegExp(`PROBLEM Service: installed for ${oldFolder.replace(/[/.]/g, '\\$&')} but nothing answers on port \\d+`));
  sees(where, 'installed for <old folder> but nothing answers', doctor.stdout.replaceAll(oldFolder, '<old folder>'));
  // The settings file names the old place; the page says to edit it.
  const settings = JSON.parse(readFileSync(join(newFolder, '.openhbam-settings.json'), 'utf8')) as { backupDir: string };
  assert.equal(settings.backupDir, join(oldFolder, 'Backups'));
  writeFileSync(join(newFolder, '.openhbam-settings.json'), JSON.stringify({ backupDir: join(newFolder, 'Backups') }));
  // What the page shows for the definition; installing and uninstalling a real service is not done in a test.
  for (const line of ['tabularius service uninstall', 'tabularius service install <new-folder>']) {
    shown(where, line);
    ran.delete(line);
    notRun.set(line, 'registers or removes a real service on the machine running the test');
  }
  const printed = runStep(where, 'tabularius service print <new-folder>', { 'new-folder': newFolder }, { env: { TABULARIUS_HOME: home } });
  assert.equal(printed.status, 0, printed.stderr);
  assert.ok(printed.stdout.includes(newFolder), 'the definition names the new folder');
  // And the server, from the new place, with the files, accounts and records in it.
  const s = await serve({ dir: newFolder, port: 0, log: quiet });
  try { assert.equal((await dataApi(s.url).signIn('Admin', 'the-old-password')).status, 200); } finally { await stopServer(s); }
  assert.equal(peopleIn(newFolder), 2);
  const fixed = runStep(where, 'tabularius doctor <new-folder>', { 'new-folder': newFolder }, { env: { TABULARIUS_HOME: tmp('moved-nohome') } });
  assert.doesNotMatch(fixed.stdout, /PROBLEM/);
  assert.ok(!fixed.stdout.includes(oldFolder), 'doctor no longer names the old place');
});

// --- 15: the server is lost ------------------------------------------------------------------------------------

test('the server is lost', async () => {
  const where = 'The server is lost';
  const lost = tmp('lost-old');
  const offsite = tmp('lost-offsite');
  const fresh = join(tmp('lost-new'), 'Databases');
  makeFile(lost, 'Contacts', 5);
  makeFile(lost, 'Sales', 2);
  const kept = new Store(storePath(lost, 'Sales'), 'Sales');
  kept.setPassword('rep', 'rep-password-1', '[Full Access]');
  kept.close();
  // Things the folder holds that a backup does not.
  asAdmin(lost, 'the-console-pass');
  mkdirSync(join(lost, 'Documents'), { recursive: true });
  writeFileSync(join(lost, 'Documents', 'note.txt'), 'kept only beside the files');
  writeFileSync(join(lost, '.openhbam-settings.json'), '{"keep":3}');
  assert.equal(cliRaw(['backup', lost]).status, 0);
  // The copy that was kept somewhere else: only the Backups folder survives.
  cpSync(join(lost, 'Backups'), join(offsite, 'Backups'), { recursive: true });
  const backups = join(offsite, 'Backups');
  const set = readdirSync(backups).filter((n) => /^\d{4}-/.test(n)).sort().at(-1)!;
  rmSync(lost, { recursive: true, force: true });
  mkdirSync(fresh, { recursive: true });

  const verify = runStep(where, 'tabularius verify-backup <folder> --from <backups-folder>', { folder: fresh, 'backups-folder': backups });
  assert.equal(verify.status, 0, verify.stderr + verify.stdout);
  assert.match(verify.stdout, /checked: 2 files ok/);
  const restore = runStep(where, 'tabularius restore <folder> <backup-set> --from <backups-folder>', { folder: fresh, 'backup-set': set, 'backups-folder': backups });
  assert.equal(restore.status, 0, restore.stderr);
  assert.match(restore.stdout, /restored Contacts\.openhbam\.sqlite\nrestored Sales\.openhbam\.sqlite\n/);
  assert.equal(peopleIn(fresh), 5, 'the records are back');
  // No password anywhere until one is set.
  assert.equal(canSignIn(fresh, 'Admin', 'the-old-password'), false);
  assert.equal(canSignIn(fresh, 'rep', 'rep-password-1', 'Sales'), false);
  const listed = runStep(where, 'tabularius privileges <folder> <database>', { folder: fresh, database: 'Sales' });
  assert.match(listed.stdout, /Accounts\n {2}Admin +\[Full Access\] +no password yet\n {2}rep +\[Full Access\] +no password yet\n/);
  sees(where, 'no password yet', listed.stdout);
  // What was not in the backup is not in the new folder.
  assert.deepEqual(readdirSync(fresh).filter((n) => n.startsWith('.openhbam-') && !n.endsWith('.lock.db')).filter((n) => !/^\.openhbam-(claim|oauth|pid)/.test(n)), [], 'no settings or console password came with it');
  assert.equal(existsSync(join(fresh, 'Documents')), false);

  assert.equal(runStep(where, 'tabularius admin-password <folder>', { folder: fresh }, { input: 'a-new-console-pass\n' }).status, 0);
  assert.equal(runStep(where, 'tabularius passwd <folder> <database> <account>', { folder: fresh, database: 'Contacts', account: 'Admin' }, { input: 'a-new-admin-pass\n' }).status, 0);
  assert.equal(canSignIn(fresh, 'Admin', 'a-new-admin-pass'), true);
  const port = await freePort();
  const server = startStep(where, 'tabularius serve <folder>', { folder: fresh }, { env: { PORT: String(port) } });
  await until('the server', async () => fetch(`http://127.0.0.1:${port}/tabularius/health`).then((r) => r.ok, () => false));
  assert.equal((await dataApi(`http://127.0.0.1:${port}`).signIn('Admin', 'a-new-admin-pass')).status, 200);
  await stopChild(server.child);
  const records = runStep(where, 'tabularius records <folder> <database> <table>', { folder: fresh, database: 'Contacts', table: 'People' });
  assert.equal(records.stdout.trim().split('\n').length, 5);
});

test('two servers both took writes: the standby refuses a folder with its own file, and --overwrite starts it', { concurrency: false }, async () => {
  const where = 'Two servers both took writes (a standby pair)';
  const folder = tmp('standby-pair');
  createStore(join(folder, 'Contacts.openhbam.sqlite'));
  // No main server is needed: the refusal comes before the standby asks for anything. The address is one nothing listens on.
  const primary = 'http://127.0.0.1:1';
  const refused = spawnSync(process.execPath, ['--no-warnings', main, 'standby', folder, '--primary', primary, '--token', 'a-replication-token'], { encoding: 'utf8', env: { ...CLEAN_ENV, HOME: tmpdir() }, timeout: 60_000 });
  assert.notEqual(refused.status, 0);
  assert.ok(`${refused.stdout}${refused.stderr}`.includes(`already has files this standby didn't copy (Contacts.openhbam.sqlite): use an empty folder, or --overwrite to replace them`), refused.stderr);
  assert.ok(section(where).includes(`already has files this standby didn't copy (...): use an empty folder, or --overwrite to replace them`));
  // The command the page gives starts following (and keeps trying the unreachable main server) instead of refusing.
  const standby = startStep(where, 'tabularius standby <folder> --primary URL --token <token> --overwrite', { folder, token: 'a-replication-token' }, { swap: { URL: primary } });
  await until('the standby to start', () => standby.out().includes(`standby of ${primary} in ${folder}`));
  await stopChild(standby.child);
  const code = await standby.exited;
  assert.equal(code, 0, `the standby ended with ${standby.child.signalCode ?? `code ${code}`}: ${standby.out()}`);
});

// --- the page and the tests agree ------------------------------------------------------------------------------

test('every command and call on the page was run by a scenario, and every scenario is on the page', { concurrency: false }, () => {
  const lines: string[] = [];
  for (const m of page.matchAll(/^```sh\n([\s\S]*?)^```$/gm)) for (const l of m[1].split('\n')) if (/^(tabularius|curl) /.test(l.trim())) lines.push(l.trim());
  assert.ok(lines.length > 30, `found ${lines.length} commands; the extractor stopped finding them`);
  const missed = lines.filter((l) => !ran.has(l) && !notRun.has(l));
  assert.deepEqual(missed, [], 'on the page, but not run by any scenario in runbook.test.ts');
  for (const [line, why] of notRun) assert.ok(lines.includes(line) && why, `${line} is excused but not on the page`);
  // Every section of the page (but the ones that only introduce) has a scenario here.
  const names = [...sections.keys()].filter((n) => !['Find your problem', 'Before it goes wrong'].includes(n));
  assert.equal(names.length, 17);
  const source = readFileSync(import.meta.filename, 'utf8');
  for (const n of names) assert.ok(source.includes(`'${n.replace(/'/g, "\\'")}'`) || source.includes(`"${n}"`), `no scenario performs "${n}"`);
  // The index at the top links every section.
  for (const n of names) {
    const slug = n.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
    assert.ok(page.includes(`](#${slug})`), `the table at the top does not link "${n}"`);
  }
});

test('two servers both took writes gives the standby refusal and overwrite steps', () => {
  const where = 'Two servers both took writes (a standby pair)';
  const text = section(where);
  assert.ok(text.includes('already has files this standby didn\'t copy (...): use an empty folder, or --overwrite to replace them'));
  assert.ok(text.includes('tabularius standby <folder> --primary URL --token <token> --overwrite'));
});
