// What ships (scripts/release-audit.ts): the committed tree and the files of a release pack are held to an allow-list
// and to checks for secrets, personal details, builder details, fixtures, maps, binaries, modes, links, sizes and
// install scripts. Every rule is shown catching the problem it is for; the real tree and the real production
// dependencies are shown clean. The installers' checksum flow for Node is tested in install-checksum.test.ts, and a
// stored release that was changed or swapped fails its checksums in release-reproducible.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  audit, auditTree, duplicateLicences, globToRegExp, isDependencyDebris, isProgramFile, loadAllowList, lockPackages, magicKind,
  packageOf, randomLookingTokens, treeEntries, type Entry, type Scope,
} from '../../../scripts/release-audit.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const isCheckout = (() => { try { execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const file = (path: string, content: string | Buffer = 'x\n', mode = 0o644): Entry => {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return { path, size: data.length, mode, data };
};
const open: Scope = { allow: [{ glob: '**', why: 'a test' }], executable: [{ glob: 'bin/run', why: 'a test' }], maxBytes: 1000, larger: [{ glob: 'big.md', maxBytes: 5000, why: 'a test' }], exceptions: [], emails: [{ address: 'ok@real.example.com', why: 'a test' }] };
const rulesOf = (entries: Entry[], extra: Record<string, unknown> = {}, scope: Scope = open) => audit(entries, { kind: 'pack', scope, ...extra }).map((f) => f.rule);

// ---- The real files -----------------------------------------------------------------------------------------------

test('the committed tree passes every check against the allow-list', { skip: isCheckout ? false : 'not a git checkout' }, () => {
  assert.deepEqual(auditTree(root), []);
});

test('the program files that go in a release pack pass the pack\'s checks and are all named by the pack\'s allow-list', { skip: isCheckout ? false : 'not a git checkout' }, () => {
  const entries = treeEntries(root).filter((e) => isProgramFile(e.path));
  assert.ok(entries.length > 400, 'the program files were found');
  assert.deepEqual(audit(entries, { kind: 'pack', scope: loadAllowList().pack }), []);
});

test('the production dependencies in package-lock.json, as a release ships them, pass the pack\'s checks', (t) => {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, { dev?: boolean; link?: boolean }> };
  const { prod } = lockPackages(lock);
  const dirs = Object.entries(lock.packages).filter(([path, p]) => path.includes('node_modules/') && !p.dev && !p.link && !path.includes('@tabularius/')).map(([path]) => path);
  if (!dirs.every((d) => existsSync(join(root, d)))) return t.skip('the production dependencies are not all installed here');
  const entries: Entry[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const relPath = `${rel}/${name}`;
      const s = lstatSync(join(root, dir, name));
      if (s.isSymbolicLink()) continue;
      // A nested node_modules is its own lock entry.
      if (s.isDirectory()) { if (name !== 'node_modules') walk(`${dir}/${name}`, relPath); continue; }
      if (isDependencyDebris(`${dir}/${name}`)) continue;
      const data = readFileSync(join(root, dir, name));
      entries.push({ path: `${dir}/${name}`, size: data.length, mode: s.mode & 0o111 ? 0o755 : 0o644, data });
    }
  };
  for (const d of dirs) walk(d, d);
  assert.ok(entries.length > 1000);
  const problems = audit(entries, { kind: 'pack', scope: loadAllowList().pack, prodPackages: prod });
  assert.deepEqual(problems, []);
});

test('no installer, build or upgrade runs a dependency\'s install script, and no production dependency has one', () => {
  const places = ['Dockerfile', 'scripts/install.sh', 'scripts/install.ps1', 'packages/cli/src/service.ts', 'scripts/service-e2e.ts', 'scripts/rehearse-upgrade.ts', 'scripts/build-release.ts'];
  for (const place of places) {
    const lines = readFileSync(join(root, place), 'utf8').split('\n').filter((l) => /\bci\b.*--omit=dev/.test(l));
    assert.ok(lines.length > 0, `${place} installs the dependencies`);
    for (const l of lines) assert.match(l, /--ignore-scripts/, `${place}: ${l.trim()}`);
  }
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lockPackages(lock).installScripts, [], 'a production dependency that runs an install script would be silently skipped by --ignore-scripts');
});

test('the allow-list: every entry says why, every pattern matches something, and nothing is a catch-all', { skip: isCheckout ? false : 'not a git checkout' }, () => {
  const list = loadAllowList();
  const tracked = treeEntries(root);
  const built = ['THIRD-PARTY-NOTICES.md', 'packages/server/build-info.json']; // written by the build, not tracked
  const programPaths = tracked.map((e) => e.path).filter(isProgramFile).concat(built);
  for (const [name, scope, paths] of [['pack', list.pack, programPaths], ['tree', list.tree, tracked.map((e) => e.path)]] as const) {
    for (const group of ['allow', 'executable', 'larger', 'exceptions'] as const) {
      for (const entry of scope[group]) {
        assert.ok(entry.why.trim().length > 10, `${name}.${group} ${entry.glob} needs a reason`);
        assert.notEqual(entry.glob.replace(/[*/]/g, ''), '', `${name}.${group} ${entry.glob} is a catch-all`);
      }
    }
    for (const a of scope.allow) assert.ok(paths.some((p) => globToRegExp(a.glob).test(p)), `${name}.allow ${a.glob} matches no file: remove it`);
    for (const x of scope.executable) assert.ok(paths.some((p) => globToRegExp(x.glob).test(p)) || name === 'pack', `${name}.executable ${x.glob} matches no file: remove it`);
    for (const l of scope.larger) assert.ok(paths.some((p) => globToRegExp(l.glob).test(p)), `${name}.larger ${l.glob} matches no file: remove it`);
    for (const x of scope.exceptions) assert.ok(paths.some((p) => globToRegExp(x.glob).test(p)), `${name}.exceptions ${x.glob} matches no file: remove it`);
    for (const e of scope.emails) assert.match(e.address, /^[^@\s]+@[^@\s]+$/);
  }
  // The execute bit in the tree is exactly the allow-list's.
  const executable = tracked.filter((e) => e.mode & 0o111).map((e) => e.path).sort();
  const listed = tracked.map((e) => e.path).filter((p) => list.tree.executable.some((x) => globToRegExp(x.glob).test(p))).sort();
  assert.deepEqual(executable, listed);
});

// ---- What goes in a pack ------------------------------------------------------------------------------------------

test('the pack holds the program, not its tests, browser tests, evaluations or benchmarks', () => {
  for (const f of ['packages/server/src/server.ts', 'packages/web/index.html', 'packages/web/sw.js', 'packages/web/src/app.js', 'packages/server/admin/index.html', 'packages/cli/package.json', 'docs/runbook.md', 'docs/reference/rest.md', 'LICENSE', 'NOTICE', 'package.json', 'package-lock.json']) {
    assert.ok(isProgramFile(f), f);
  }
  for (const f of ['packages/server/test/server.test.ts', 'packages/web/e2e/find.e2e.ts', 'packages/server/evals/run.ts', 'packages/scripts/bench/loop.ts', 'packages/web/tsconfig.json', 'scripts/install.sh', 'docs/tutorials/first-app.md', 'README.md', 'notes/audits/x.md', 'tsconfig.json']) {
    assert.ok(!isProgramFile(f), f);
  }
});

test('a dependency\'s source maps and its lint, coverage and git settings are left out, our own files never are', () => {
  for (const f of ['node_modules/a/dist/index.js.map', 'node_modules/@s/b/x.d.ts.map', 'node_modules/a/.eslintrc', 'node_modules/a/.eslintrc.json', 'node_modules/a/.npmignore', 'node_modules/a/.nycrc', 'node_modules/a/.editorconfig', 'node_modules/a/.gitattributes', 'node_modules/a/.github/workflows/ci.yml', 'node_modules/a/.npmrc', 'node_modules/a/node_modules/b/.travis.yml']) {
    assert.ok(isDependencyDebris(f), f);
  }
  for (const f of ['node_modules/a/index.js', 'node_modules/a/README.md', 'node_modules/a/LICENSE', 'node_modules/a/package.json', 'node_modules/a/lib/.hidden-but-needed.js', 'packages/a/.eslintrc', 'docs/x.map.md']) {
    assert.ok(!isDependencyDebris(f), f);
  }
});

test('packageOf names the package a path belongs to, nested and scoped ones included', () => {
  assert.equal(packageOf('node_modules/a/index.js'), 'a');
  assert.equal(packageOf('node_modules/@s/b/x/y.js'), '@s/b');
  assert.equal(packageOf('node_modules/a/node_modules/c/i.js'), 'c');
  assert.equal(packageOf('node_modules/a/node_modules/@s/d/i.js'), '@s/d');
  assert.equal(packageOf('node_modules/.package-lock.json'), undefined);
  assert.equal(packageOf('packages/a/src/x.ts'), undefined);
});

// ---- Every rule catches its problem ------------------------------------------------------------------------------

test('clean files give no finding', () => {
  assert.deepEqual(rulesOf([file('docs/a.md', '# Hello\nA plain line with ok@real.example.com and someone@example.com.\n'), file('bin/run', '#!/bin/sh\n', 0o755), file('packages/a/src/x.ts', 'export const x = 1;\n')]), []);
});

test('unlisted-file: a file the allow-list does not name; not-in-lock: a package outside the production set', () => {
  const narrow: Scope = { ...open, allow: [{ glob: 'docs/*.md', why: 'a test' }] };
  assert.deepEqual(audit([file('docs/a.md'), file('docs/deep/b.md'), file('extra.txt')], { kind: 'pack', scope: narrow }).map((f) => `${f.rule} ${f.path}`), ['unlisted-file docs/deep/b.md', 'unlisted-file extra.txt']);
  const prod = new Set(['good']);
  const found = audit([file('node_modules/good/index.js'), file('node_modules/dev-only/index.js'), file('node_modules/.package-lock.json', '{}')], { kind: 'pack', scope: narrow, prodPackages: prod });
  assert.deepEqual(found.map((f) => `${f.rule} ${f.path}`), ['unlisted-file node_modules/.package-lock.json', 'not-in-lock node_modules/dev-only/index.js']);
});

test('no-notice: a shipped package whose licence text is not in the notices file', () => {
  const pkg = (name: string, version: string) => file(`node_modules/${name}/package.json`, JSON.stringify({ name, version }));
  const notices = '# Third-party notices\n\n## Node.js v22\n\n## covered 1.2.3\n\ntext\n';
  const found = audit([pkg('covered', '1.2.3'), pkg('missing', '4.5.6'), pkg('covered', '9.9.9')], { kind: 'pack', scope: open, notices });
  assert.deepEqual(found.map((f) => `${f.rule} ${f.detail}`), ['no-notice covered@9.9.9 has no licence text in THIRD-PARTY-NOTICES.md', 'no-notice missing@4.5.6 has no licence text in THIRD-PARTY-NOTICES.md']);
});

test('fixture-file: FileMaker files, SQLite files and fixtures, by name and by what is inside', () => {
  const sqlite = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]);
  const filemaker = Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x05, 0x00, 0x02, 0x00, 0x02, 0xc0, 0x00]);
  const found = audit([file('docs/Invoices.fmp12', 'x'), file('docs/hosted.openhbam.sqlite', 'x'), file('fixtures/fmp12/a.txt'), file('docs/renamed.dat', sqlite), file('docs/renamed2.dat', filemaker), file('docs/fine.dat', Buffer.from('plain'))], { kind: 'pack', scope: open });
  assert.deepEqual(found.filter((f) => f.rule === 'fixture-file').map((f) => f.path), ['docs/Invoices.fmp12', 'docs/hosted.openhbam.sqlite', 'docs/renamed.dat', 'docs/renamed2.dat', 'fixtures/fmp12/a.txt']);
  // A dependency's own fixtures folder is its business; a database in it is not.
  const dep = audit([file('node_modules/p/test/fixtures/a.json', '{}'), file('node_modules/p/data.sqlite', 'x')], { kind: 'pack', scope: open });
  assert.deepEqual(dep.filter((f) => f.rule === 'fixture-file').map((f) => f.path), ['node_modules/p/data.sqlite']);
  assert.equal(magicKind(sqlite), 'sqlite');
  assert.equal(magicKind(filemaker), 'filemaker');
});

test('key-file, source-map, debug-output: files named for what they are', () => {
  assert.deepEqual(audit([file('a/server.pem'), file('a/.env'), file('a/.env.local'), file('a/id_ed25519'), file('a/cert.p12')], { kind: 'pack', scope: open }).map((f) => f.rule), ['key-file', 'key-file', 'key-file', 'key-file', 'key-file']);
  assert.deepEqual(audit([file('a/x.js.map', '{}'), file('a/y.js', 'var a;\n//# sourceMappingURL=y.js.map\n')], { kind: 'pack', scope: open }).map((f) => `${f.rule} ${f.path}`), ['source-map a/x.js.map', 'source-map a/y.js']);
  const debug = ['a/run.cpuprofile', 'a/h.heapsnapshot', 'a/server.log', 'a/tsconfig.tsbuildinfo', 'a/.DS_Store', 'a/old.orig', 'a/x~', 'a/coverage/lcov.info', 'a/core', 'a/npm-debug.log.1'];
  assert.deepEqual(audit(debug.map((p) => file(p)), { kind: 'pack', scope: open }).map((f) => f.path).sort(), [...debug].sort());
  // A folder that happens to be called core, and a file that merely contains the word, are not debug output.
  assert.deepEqual(audit([file('node_modules/z/src/core/index.ts'), file('a/core-values.md')], { kind: 'pack', scope: open }), []);
});

test('native-binary: compiled libraries and programs, by name and by their first bytes', () => {
  const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
  const macho = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]);
  const pe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
  const java = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]);
  const found = audit([file('a/addon.node'), file('a/lib.so.1'), file('a/tool.dll'), file('a/prog', elf), file('b/prog', macho), file('c/prog', pe), file('d/Thing.class', java), file('e/data.bin2', Buffer.from('x'))], { kind: 'pack', scope: open });
  assert.deepEqual(found.map((f) => f.path), ['a/addon.node', 'a/lib.so.1', 'a/prog', 'a/tool.dll', 'b/prog', 'c/prog']);
});

test('executable, risky-mode: the execute bit only where the allow-list says, and no setuid, sticky or world-writable bits', () => {
  const found = audit([file('bin/run', 'x', 0o755), file('docs/script.sh', 'x', 0o755), file('docs/suid', 'x', 0o4755), file('docs/ww', 'x', 0o666), file('docs/sticky', 'x', 0o1644), file('docs/group', 'x', 0o664)], { kind: 'pack', scope: open });
  assert.deepEqual(found.map((f) => `${f.rule} ${f.path}`), [
    'risky-mode docs/group', 'executable docs/script.sh', 'risky-mode docs/sticky', 'risky-mode docs/suid', 'executable docs/suid', 'risky-mode docs/ww', 'risky-mode docs/ww',
  ]);
  // In the tree only the bits git keeps are real, so a group-writable file is not a finding there.
  assert.deepEqual(audit([file('docs/group', 'x', 0o664)], { kind: 'tree', scope: open }), []);
});

test('symlink: none in a pack; in the tree none that is absolute or leaves it', () => {
  const link = (path: string, target: string): Entry => ({ path, size: 0, mode: 0o777, data: Buffer.alloc(0), link: target });
  assert.deepEqual(audit([link('a/l', 'b')], { kind: 'pack', scope: open }).map((f) => f.rule), ['symlink']);
  const tree = audit([link('docs/abs', '/etc/passwd'), link('docs/up', '../../outside'), link('docs/in', 'other.md')], { kind: 'tree', scope: open });
  assert.deepEqual(tree.map((f) => f.detail.split(' ').slice(0, 5).join(' ')), ['an absolute link to /etc/passwd', 'a link to other.md: the', 'a link to ../../outside, outside']);
});

test('oversized: over the limit unless the allow-list gives that file more', () => {
  const found = audit([file('a.md', 'x'.repeat(1001)), file('big.md', 'x'.repeat(4000)), file('big2.md', 'x'.repeat(1001)), file('c.md', 'x'.repeat(1000))], { kind: 'pack', scope: open });
  assert.deepEqual(found.map((f) => f.path), ['a.md', 'big2.md']);
});

test('secret, high-entropy: credentials in the shape of real ones, and long random-looking strings', () => {
  const parts = { gh: `gh${'p'}_${'A1b2'.repeat(9)}`, ant: `sk-${'ant'}-${'Ab9_'.repeat(12)}`, aws: `AKIA${'ABCDEFGH12345678'}`, slack: `xox${'b'}-${'1234567890-'.repeat(2)}abcdef`, key: `-----BEGIN ${'RSA PRIVATE'} KEY-----` };
  for (const [what, value] of Object.entries(parts)) {
    assert.deepEqual(rulesOf([file('docs/leak.md', `token ${value}\n`)]), ['secret'], what);
  }
  // Tests and the generated reference may hold fake ones.
  assert.deepEqual(rulesOf([file('packages/a/test/t.ts', `${parts.gh}\n`), file('docs/reference/rest.md', `${parts.gh}\n`)]), []);
  // A dependency may name the header of a key it parses, but not carry a key.
  assert.deepEqual(rulesOf([file('node_modules/jose/i.js', `if (!s.startsWith("${parts.key}")) throw 1;\n`)]), []);
  assert.deepEqual(rulesOf([file('node_modules/jose/i.js', `${parts.key}\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(2)}\n-----END RSA PRIVATE KEY-----\n`)]), ['secret']);
  const random = 'Zq8Xk2Lm9Pd4Rt7Vb3Nc6Yh1Wf5Sj0GaQe8UiOpRw3Ty';
  assert.deepEqual(randomLookingTokens(`const t = "${random}";`), [random]);
  for (const ordinary of ['abcdefabcdefabcdefabcdefabcdefabcdefabcdef1', 'integrity sha512-' + random, 'https://example.com/a/very/long/path/with/segments/that/goes/on/and/on', 'SOME_VERY_LONG_UPPER_CASE_CONSTANT_NAME_HERE_TOO', 'data:image/png;base64,' + random, 'a'.repeat(60)]) {
    assert.deepEqual(randomLookingTokens(ordinary), [], ordinary);
  }
  assert.deepEqual(rulesOf([file('docs/x.md', `Example token: ${random}\n`)]), ['high-entropy']);
  const withException: Scope = { ...open, exceptions: [{ glob: 'docs/x.md', rule: 'high-entropy', why: 'a test' }] };
  assert.deepEqual(rulesOf([file('docs/x.md', `Example token: ${random}\n`)], {}, withException), []);
});

test('private-detail, machine-detail: a person\'s folders and names, and the builder\'s own', () => {
  assert.deepEqual(audit([file('docs/a.md', 'See /Users/jane/Documents/x and /home/jdoe/src.\nAnd C:\\Users\\jane\\Desktop\\x.\nPlaceholders /Users/someone/x and /home/user/y are fine.\n')], { kind: 'pack', scope: open }).map((f) => `${f.rule}:${f.line}`), ['private-detail:1', 'private-detail:2']);
  const machine = { homedir: '/home/builder', repo: '/work/checkout', stage: '/tmp/tabularius-release-', username: 'buildjo', hostname: 'buildhost01' };
  const text = [
    'at /home/builder/.cache/x', 'from /work/checkout/packages', 'in /tmp/tabularius-release-abc123/app', 'by /Users/buildjo/x', 'on buildhost01.local', 'a buildjo mention in prose is fine', 'the word builder is fine',
  ].join('\n') + '\n';
  const found = audit([file('packages/a/src/x.ts', text)], { kind: 'pack', scope: open, machine }).filter((f) => f.rule === 'machine-detail');
  assert.deepEqual(found.map((f) => f.line), [1, 2, 3, 4, 5]);
  assert.deepEqual(audit([file('packages/a/src/x.ts', text)], { kind: 'pack', scope: open, machine: {} }).filter((f) => f.rule === 'machine-detail'), []);
  // A short or empty name is not searched for: it would match everything.
  assert.deepEqual(audit([file('a.md', 'root and /root/x and a /ab/ folder\n')], { kind: 'pack', scope: open, machine: { username: 'ab', homedir: '/', hostname: 'localhost' } }), []);
});

test('email: addresses outside the placeholder domains and the allow-list; OData names are not addresses', () => {
  const found = audit([file('docs/a.md', [
    'Write to real.person@company.com or ok@real.example.com.', 'Placeholders: a@example.com b@x.example c@host.test d@h.invalid e@localhost 123+user@users.noreply.github.com',
    'OData: Customers@odata.navigationLink and Field@com.filemaker.odata.ContentType', 'Sentence end other@firm.org.',
  ].join('\n') + '\n')], { kind: 'pack', scope: open });
  assert.deepEqual(found.map((f) => `${f.rule}:${f.line}:${f.detail}`), ['email:1:the address real.person@company.com', 'email:4:the address other@firm.org']);
  // A dependency's author fields are public metadata and are not searched.
  assert.deepEqual(audit([file('node_modules/p/package.json', '{"name":"p","author":"A <a@firm.org>"}')], { kind: 'pack', scope: open }), []);
});

test('banned-name: a word from the banned list in our own files, not in dependencies', () => {
  // The list holds hashes only, so the check is shown with a stand-in for the word.
  const banned = (text: string) => text.split('\n').flatMap((l, i) => (l.includes('STAND-IN') ? [i + 1] : []));
  assert.deepEqual(audit([file('docs/a.md', 'fine\nwith STAND-IN here\n'), file('node_modules/p/x.js', 'STAND-IN\n')], { kind: 'pack', scope: open, banned }).map((f) => `${f.rule} ${f.path}:${f.line}`), ['banned-name docs/a.md:2']);
});

test('lifecycle-script: install scripts of dependencies, any lifecycle script of our own packages, and binding.gyp', () => {
  const manifest = (path: string, scripts: Record<string, string>) => file(path, JSON.stringify({ name: 'p', version: '1.0.0', scripts }));
  const found = audit([
    manifest('node_modules/p/package.json', { postinstall: 'node x.js', test: 'node t.js' }),
    manifest('node_modules/q/package.json', { prepare: 'husky', prepublish: 'npm run build' }),
    manifest('node_modules/r/package.json', { install: 'node-gyp rebuild' }),
    file('node_modules/s/binding.gyp', '{}'),
    manifest('packages/a/package.json', { prepare: 'git config core.hooksPath hooks' }),
    manifest('packages/b/package.json', { test: 'node --test' }),
  ], { kind: 'pack', scope: open });
  assert.deepEqual(found.map((f) => `${f.rule} ${f.path}`), [
    'lifecycle-script node_modules/p/package.json', 'lifecycle-script node_modules/r/package.json', 'lifecycle-script node_modules/s/binding.gyp', 'lifecycle-script packages/a/package.json',
  ]);
  assert.deepEqual(lockPackages({ packages: { '': {}, 'node_modules/a': { hasInstallScript: true }, 'node_modules/d': { dev: true, hasInstallScript: true }, 'node_modules/@tabularius/x': { link: true } } }), { prod: new Set(['a']), installScripts: ['a'] });
});

test('review fixes: the test folder of a dependency is searched, a NUL byte or UTF-16 does not hide a token, and ** between folders keeps the slash', () => {
  const token = `gh${'p'}_${'A1b2'.repeat(9)}`;
  assert.deepEqual(rulesOf([file('node_modules/qs/test/x.js', `${token}\n`), file('packages/a/test/t.ts', `${token}\n`)]), ['secret']);
  assert.deepEqual(rulesOf([file('packages/a/src/x.ts', `const t = '${token}';\n\0`)]), ['secret']);
  assert.deepEqual(rulesOf([file('scripts/install.ps1', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`$t = '${token}'\r\n`, 'utf16le')]))]), ['secret']);
  assert.ok(globToRegExp('a/**/b.ts').test('a/b.ts') && globToRegExp('a/**/b.ts').test('a/x/y/b.ts') && !globToRegExp('a/**/b.ts').test('a/xb.ts'));
});

test('globs: * stays inside a folder, ** crosses folders, a dot is a dot', () => {
  assert.ok(globToRegExp('docs/*.md').test('docs/a.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/x/a.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/aXmd'));
  assert.ok(globToRegExp('packages/**').test('packages/a/b/c.ts'));
  assert.ok(globToRegExp('**/x.ts').test('x.ts'));
  assert.ok(globToRegExp('**/x.ts').test('a/b/x.ts'));
  assert.ok(globToRegExp('a?c').test('abc') && !globToRegExp('a?c').test('a/c'));
  assert.ok(globToRegExp('compose*.yaml').test('compose.https.yaml'));
});

test('duplicate licence texts are counted, not refused: each package\'s notice has to travel', () => {
  const mit = 'MIT text\n';
  const d = duplicateLicences([file('node_modules/a/LICENSE', mit), file('node_modules/b/LICENSE.md', mit), file('node_modules/c/LICENSE', 'other\n'), file('LICENSE', mit)]);
  assert.deepEqual(d.map((g) => [g.copies, g.bytes]), [[2, mit.length]]);
});
