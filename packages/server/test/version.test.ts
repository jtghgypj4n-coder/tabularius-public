// What a visitor is told about the version comes from one place (packages/server/src/version.ts, which reads the
// package file), and every surface that tells it agrees: the command line, the Data API's productInfo, the admin
// console, the web client's About, the MCP handshake and the metrics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { serve, setAdminPassword } from '../src/index.ts';
import { STORE_EXT } from '../src/host.ts';
import { createStore, Store } from '../../store/src/index.ts';
import { AREAS, OTHER } from '../../../scripts/release-notes-lib.ts';
import { NODE_MINIMUM, SERVER_VERSION, serverCommit, versionLabel, versionText } from '../src/version.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; engines: { node: string } };
const launch = join(root, 'packages', 'cli', 'src', 'launch.cjs');

test('every package file says the same version, and the program reads it from the server package', () => {
  const packages = readdirSync(join(root, 'packages')).map((n) => join('packages', n, 'package.json')).filter((p) => statSync(join(root, p), { throwIfNoEntry: false })?.isFile());
  assert.ok(packages.length >= 8, 'the workspace packages were not found');
  const versions = Object.fromEntries(['package.json', ...packages].map((p) => [p, (JSON.parse(readFileSync(join(root, p), 'utf8')) as { version: string }).version]));
  assert.deepEqual(Object.values(versions).filter((v) => v !== rootPackage.version), [], `these disagree with package.json (${rootPackage.version}): ${JSON.stringify(versions)}`);
  assert.equal(SERVER_VERSION, rootPackage.version);
});

test('the Node requirement shown is the one in package.json', () => {
  assert.equal(`>=${NODE_MINIMUM}`, rootPackage.engines.node);
});

test('no source file spells out the version', () => {
  const literal = new RegExp(`['"\`]${SERVER_VERSION.replaceAll('.', '\\.')}['"\`]`);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'test' || name === 'e2e') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      // Generated from the code (docs:reference), and the lock files and package files that are the source of the number.
      if (!/\.(ts|cjs|html|js)$/.test(name)) continue;
      if (literal.test(readFileSync(path, 'utf8'))) found.push(relative(root, path));
    }
  };
  walk(join(root, 'packages'));
  walk(join(root, 'scripts'));
  assert.deepEqual(found, [], 'these files write the version out; read it from packages/server/src/version.ts');
});

test('--version, -v and version print the same three lines', () => {
  const expected = versionText();
  assert.match(expected, new RegExp(`^tabularius ${SERVER_VERSION.replaceAll('.', '\\.')}\\ncommit ([0-9a-f]{7,}|unknown)\\nNode ${NODE_MINIMUM.replaceAll('.', '\\.')} or newer is needed; this is Node ${process.versions.node.replaceAll('.', '\\.')}\\n$`));
  for (const arg of ['--version', '-v', 'version']) {
    const r = spawnSync(process.execPath, ['--no-warnings', launch, arg], { encoding: 'utf8', timeout: 90_000 });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, expected, arg);
    assert.equal(r.stderr, '');
  }
});

test('in a checkout the commit is the one git reports', () => {
  const git = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  if (git.status !== 0) return; // a copy of the files without git: the commit is unknown, which versionText says
  assert.equal(serverCommit(), git.stdout.trim());
  assert.equal(versionLabel(), `${SERVER_VERSION} (${git.stdout.trim()})`);
});

test('the Data API, admin console, web client, metrics and info all name the same version', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-version-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, `Shop${STORE_EXT}`);
  createStore(file);
  const store = new Store(file, 'Shop');
  store.setPassword('Admin', 'pw', '[Full Access]');
  store.close();
  setAdminPassword(dir, 'secret');
  const s = await serve({ dir, port: 0, watch: false, log: () => {} });
  t.after(() => new Promise<void>((resolve) => s.server.close(() => resolve())));
  const commit = serverCommit();

  const product = await (await fetch(`${s.url}/fmi/data/vLatest/productInfo`)).json() as { response: { productInfo: { version: string } } };
  assert.equal(product.response.productInfo.version, SERVER_VERSION, 'Data API productInfo');

  const admin = await (await fetch(`${s.url}/tabularius/admin/v1/status`, { headers: { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' } })).json() as { server: { version: string; commit?: string } };
  assert.equal(admin.server.version, SERVER_VERSION, 'admin console');
  assert.equal(admin.server.commit, commit, 'admin console commit');

  const login = await fetch(`${s.url}/fmi/data/vLatest/databases/Shop/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + btoa('Admin:pw'), 'content-type': 'application/json', 'x-tabularius-client': 'web' }, body: '{}' });
  const token = ((await login.json()) as { response: { token: string } }).response.token;
  const menu = await (await fetch(`${s.url}/tabularius/app/v1/databases/Shop/layouts`, { headers: { authorization: `Bearer ${token}` } })).json() as { version?: string; commit?: string };
  assert.equal(menu.version, SERVER_VERSION, 'web client About');
  assert.equal(menu.commit, commit, 'web client About commit');

  const metrics = await (await fetch(`${s.url}/tabularius/admin/v1/metrics`, { headers: { authorization: 'Basic ' + btoa('admin:secret'), 'x-tabularius-admin': '1' } })).text();
  assert.match(metrics, new RegExp(`tabularius_build_info\\{version="${SERVER_VERSION.replaceAll('.', '\\.')}"\\} 1`), 'metrics');

  const info = spawnSync(process.execPath, ['--no-warnings', launch, 'info', file], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(info.status, 0, info.stderr);
  assert.equal((JSON.parse(info.stdout) as { tabularius: string }).tabularius, SERVER_VERSION, 'tabularius info');
});

test('docs/versioning.md matches the program', () => {
  const page = readFileSync(join(root, 'docs', 'versioning.md'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  // The page's current version, its sample of the --version output, and the Node line.
  assert.ok(page.includes(`is at version ${SERVER_VERSION} `), 'the page names a version other than the current one');
  assert.ok(page.includes(`tabularius ${SERVER_VERSION}\ncommit `), 'the --version sample shows another version');
  assert.ok(page.includes(`Node ${NODE_MINIMUM} or newer is needed; this is Node `), 'the --version sample shows another Node line');
  // The commands it tells a person to run, and the options of the release-notes command.
  for (const [, script] of page.matchAll(/npm run ([a-z-]+)/g)) assert.ok(packageJson.scripts[script!], `npm run ${script} does not exist`);
  const notes = readFileSync(join(root, 'scripts', 'release-notes.ts'), 'utf8');
  const section = page.slice(page.indexOf('## Release notes'), page.indexOf('## Not decided yet'));
  const flags = new Set(section.match(/--[a-z][a-z-]+/g));
  assert.ok(flags.size >= 5, 'the release-notes options were not found on the page');
  for (const flag of flags) assert.ok(notes.includes(`'${flag}'`), `release-notes has no ${flag}`);
  // The areas it lists are the areas the script groups by.
  const listed = /The areas are: (.+)\./.exec(page)?.[1]?.split('; ');
  assert.deepEqual(listed, [...AREAS.map((a) => a.name), OTHER]);
  // The workflows it says Node 22 for, and the Node line.
  assert.match(page, /Node 22\.20 or newer/);
  assert.equal(`>=22.20`, rootPackage.engines.node, 'the page says Node 22.20; package.json says another');
});
