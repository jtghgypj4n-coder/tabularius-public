// A release built twice from one commit is the same bytes (scripts/build-release.ts, scripts/verify-repro.ts), has a
// software bill of materials (scripts/sbom.ts), and a stored release that was changed is refused
// (scripts/verify-release.ts). `npm run release:verify-repro` does the real two-clone build; these tests cover its
// parts without the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, unpack } from '../../../scripts/build-release.ts';
import { buildSbom, licenseOf, npmPurl } from '../../../scripts/sbom.ts';
import { compareBuilds, comparePacks } from '../../../scripts/verify-repro.ts';
import { verifyManifest, writeManifest } from '../../../scripts/verify-release.ts';

const temp = () => mkdtempSync(join(tmpdir(), 'tabularius-repro-test-'));
const put = (root: string, path: string, text: string, mode = 0o644, mtime = 0) => {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
  utimesSync(file, mtime || 1_000_000_000, mtime || 1_000_000_000);
};

test('a pack does not depend on the order files were made in, their times, or the builder\'s umask', () => {
  const [a, b] = [temp(), temp()];
  try {
    put(a, 'packages/x/a.ts', 'one', 0o644, 1_100_000_000);
    put(a, 'node_modules/p/index.js', 'two', 0o755, 1_200_000_000);
    put(a, 'bin/run', 'three', 0o775, 1_300_000_000);
    // The same files made in another order, later, under a stricter umask (600/700) or a looser one (664/775).
    put(b, 'bin/run', 'three', 0o700, 1_700_000_000);
    put(b, 'node_modules/p/index.js', 'two', 0o775, 1_600_000_000);
    put(b, 'packages/x/a.ts', 'one', 0o664, 1_500_000_000);
    const [x, y] = [pack(a), pack(b)];
    assert.ok(x.equals(y), comparePacks(x, y).join('\n'));
    const files = unpack(x);
    assert.deepEqual(files.map((f) => f.path), ['bin/run', 'node_modules/p/index.js', 'packages/x/a.ts']);
    assert.deepEqual(files.map((f) => f.mode), [0o755, 0o755, 0o644]);
    assert.deepEqual(files.map((f) => f.data.toString()), ['three', 'two', 'one']);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('two builds that differ are reported by file, and inside a pack by the file that changed', () => {
  assert.deepEqual(compareBuilds(new Map([['a', '1'], ['b', '2']]), new Map([['a', '1'], ['b', '2']])), []);
  assert.deepEqual(compareBuilds(new Map([['a', '1'], ['b', '2']]), new Map([['a', '1'], ['b', '3'], ['c', '4']])), [
    'b: bytes differ', 'c: only the second build wrote it',
  ]);
  assert.deepEqual(compareBuilds(new Map([['a', '1']]), new Map()), ['a: only the first build wrote it']);
  const [a, b] = [temp(), temp()];
  try {
    put(a, 'same.txt', 'same'); put(b, 'same.txt', 'same');
    put(a, 'changed.txt', 'before'); put(b, 'changed.txt', 'after');
    put(a, 'mode.sh', 'x', 0o755); put(b, 'mode.sh', 'x', 0o644);
    put(a, 'gone.txt', 'only a');
    put(b, 'new.txt', 'only b');
    assert.deepEqual(comparePacks(pack(a), pack(b)), [
      'changed.txt: contents differ', 'gone.txt: only in the first pack', 'mode.sh: mode 755 against 644', 'new.txt: only in the second pack',
    ]);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

function tree(root: string): void {
  const pkg = (at: string, manifest: object, files: Record<string, string> = {}) => {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
    for (const [f, text] of Object.entries(files)) writeFileSync(join(at, f), text);
  };
  const nm = join(root, 'node_modules');
  pkg(join(nm, 'zeta'), { name: 'zeta', version: '2.0.0', license: '(MIT OR Apache-2.0)' }, { LICENSE: 'zeta text' });
  pkg(join(nm, '@scope', 'alpha'), { name: '@scope/alpha', version: '1.0.0', license: 'ISC' }, { LICENSE: 'alpha text' });
  pkg(join(nm, 'plain'), { name: 'plain', version: '0.1.0' });
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'tabularius' },
    'node_modules/zeta': { version: '2.0.0', integrity: 'sha512-' + Buffer.from('zeta').toString('base64') },
    'node_modules/@scope/alpha': { version: '1.0.0', integrity: 'sha512-' + Buffer.from('alpha').toString('base64') },
  } }));
}

test('the bill of materials names every shipped package once, with licence and hash, and holds no date or serial number', () => {
  const root = temp();
  try {
    tree(root);
    const first = JSON.stringify(buildSbom(root, { version: '1.2.3', nodeVersion: 'v22.0.0' }));
    assert.equal(JSON.stringify(buildSbom(root, { version: '1.2.3', nodeVersion: 'v22.0.0' })), first, 'the same tree gives the same bytes');
    assert.doesNotMatch(first, /timestamp|serialNumber/);
    const bom = JSON.parse(first) as { bomFormat: string; specVersion: string; metadata: { component: { name: string; version: string } }; components: { name: string; version?: string; purl: string; licenses?: unknown[]; hashes?: { content: string }[] }[]; dependencies: { dependsOn: string[] }[] };
    assert.equal(bom.bomFormat, 'CycloneDX');
    assert.equal(bom.specVersion, '1.5');
    assert.deepEqual(bom.metadata.component, { type: 'application', 'bom-ref': 'pkg:generic/tabularius@1.2.3', name: 'tabularius', version: '1.2.3', licenses: [{ license: { id: 'MIT' } }] });
    const byName = new Map(bom.components.map((c) => [c.name, c]));
    assert.equal(byName.get('@scope/alpha')?.purl, 'pkg:npm/%40scope/alpha@1.0.0');
    assert.deepEqual(byName.get('@scope/alpha')?.licenses, [{ license: { id: 'ISC' } }]);
    assert.deepEqual(byName.get('@scope/alpha')?.hashes, [{ alg: 'SHA-512', content: Buffer.from('alpha').toString('hex') }]);
    assert.deepEqual(byName.get('zeta')?.licenses, [{ expression: 'MIT OR Apache-2.0' }]);
    assert.equal(byName.get('plain')?.licenses, undefined, 'no licence declared: none claimed');
    assert.equal(byName.get('plain')?.hashes, undefined);
    assert.equal(byName.get('Node.js')?.version, 'v22.0.0');
    for (const name of ['FMP Tools', 'BaseElements plug-in']) assert.ok(byName.has(name), name);
    const refs = bom.components.map((c) => c.purl);
    assert.deepEqual(refs, [...refs].sort(), 'components in a fixed order');
    assert.equal(new Set(refs).size, refs.length);
    assert.deepEqual([...bom.dependencies[0].dependsOn].sort(), [...refs].sort());
    assert.equal(npmPurl('@a/b', '1.0.0'), 'pkg:npm/%40a/b@1.0.0');
    assert.deepEqual(licenseOf('Some Custom Licence'), [{ license: { name: 'Some Custom Licence' } }]);
    assert.deepEqual(licenseOf('(none declared)'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stored release that was changed, shortened, swapped or emptied fails its checksums', () => {
  const dir = temp();
  try {
    const program = join(dir, 'tabularius-1.2.3-linux-x64');
    writeFileSync(program, 'the program');
    writeFileSync(join(dir, 'tabularius-1.2.3-linux-x64.sbom.cdx.json'), '{"bomFormat":"CycloneDX"}');
    writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.md'), '# notices');
    const manifest = writeManifest(program);
    assert.deepEqual(verifyManifest(manifest), [], 'as written, it verifies');

    writeFileSync(program, 'the program, with a backdoor');
    assert.deepEqual(verifyManifest(manifest), ['tabularius-1.2.3-linux-x64 does not match its checksum']);
    writeFileSync(program, 'the program');
    assert.deepEqual(verifyManifest(manifest), []);

    writeFileSync(program, 'the progra');
    assert.match(verifyManifest(manifest).join(), /does not match/, 'a truncated download');
    writeFileSync(program, 'the program');

    writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.md'), '# notices, edited');
    assert.deepEqual(verifyManifest(manifest), ['THIRD-PARTY-NOTICES.md does not match its checksum']);
    writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.md'), '# notices');

    rmSync(join(dir, 'tabularius-1.2.3-linux-x64.sbom.cdx.json'));
    assert.deepEqual(verifyManifest(manifest), ['tabularius-1.2.3-linux-x64.sbom.cdx.json is missing']);

    // A manifest that lists no program, or is empty or garbage, never passes.
    const bare = join(dir, 'bare.sha256');
    writeFileSync(bare, `${'0'.repeat(64)}  THIRD-PARTY-NOTICES.md\n`);
    assert.ok(verifyManifest(bare).includes('the checksum file lists no program'));
    writeFileSync(bare, '');
    assert.deepEqual(verifyManifest(bare), ['the checksum file is empty']);
    writeFileSync(bare, 'rm -rf /\n');
    assert.match(verifyManifest(bare)[0], /^not a checksum line/);
    // A name that climbs out of the folder is not a checksum line either.
    writeFileSync(bare, `${'0'.repeat(64)}  ../tabularius-1.2.3-linux-x64\n`);
    assert.match(verifyManifest(bare)[0], /^not a checksum line/);
    // Writing checksums with a file missing is an error, not a short list.
    assert.throws(() => writeManifest(program), /sbom\.cdx\.json not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no link is committed, and a node_modules link is ignored (one pointing into a builder\'s computer broke every other checkout\'s release build)', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const links = execFileSync('git', ['-C', root, 'ls-files', '-s'], { encoding: 'utf8' }).split('\n')
    .filter((l) => l.startsWith('120000')).map((l) => l.split('\t')[1]);
  assert.deepEqual(links, [], 'tracked symbolic links');
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-q', 'packages/node_modules'], { encoding: 'utf8' });
  assert.equal(ignored.status, 0, 'packages/node_modules (a link or a folder) is not ignored');
});

test('licences: brackets come off only around the whole expression, other licence shapes do not stop the build, unknown ids become names', () => {
  assert.deepEqual(licenseOf('(MIT OR Apache-2.0)'), [{ expression: 'MIT OR Apache-2.0' }]);
  assert.deepEqual(licenseOf('(MIT OR Apache-2.0) AND (BSD-3-Clause OR ISC)'), [{ expression: '(MIT OR Apache-2.0) AND (BSD-3-Clause OR ISC)' }]);
  assert.deepEqual(licenseOf('Apache-2'), [{ license: { name: 'Apache-2' } }]);
  assert.deepEqual(licenseOf('BSD-foo'), [{ license: { name: 'BSD-foo' } }]);
  assert.deepEqual(licenseOf('Apache-2.0'), [{ license: { id: 'Apache-2.0' } }]);
  const root = temp();
  try {
    mkdirSync(join(root, 'node_modules', 'old'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'old', 'package.json'), JSON.stringify({ name: 'old', version: '1.0.0', license: { type: 'MIT', url: 'x' } }));
    mkdirSync(join(root, 'node_modules', 'nameless'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'nameless', 'package.json'), JSON.stringify({ version: '1.0.0', license: 'ISC' }));
    const bom = buildSbom(root, { version: '1', nodeVersion: 'v22.0.0' }) as { components: { name: string; licenses?: unknown[] }[] };
    assert.deepEqual(bom.components.find((c) => c.name === 'old')?.licenses, [{ license: { id: 'MIT' } }]);
    assert.ok(bom.components.some((c) => c.name === 'node_modules/nameless'), 'an unnamed package is named by its place under the root, never an absolute path');
    assert.ok(!JSON.stringify(bom).includes(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('package URLs escape a + in a version, leave out an unknown one, and component types are ones CycloneDX 1.5 allows', () => {
  assert.equal(npmPurl('a', '1.0.0+build.5'), 'pkg:npm/a@1.0.0%2Bbuild.5');
  assert.equal(npmPurl('a', '?'), 'pkg:npm/a');
  assert.equal(npmPurl('@s/a', '1.0.0'), 'pkg:npm/%40s/a@1.0.0');
  const allowed = new Set(['application', 'framework', 'library', 'container', 'platform', 'operating-system', 'device', 'device-driver', 'firmware', 'file', 'machine-learning-model', 'data']);
  const bom = buildSbom(temp(), { version: '1', nodeVersion: 'v22.0.0' }) as { components: { type: string; purl: string }[] };
  for (const c of bom.components) assert.ok(allowed.has(c.type), `${c.purl}: ${c.type}`);
  assert.ok(bom.components.every((c) => c.purl === c.purl.toLowerCase() || c.purl.startsWith('pkg:npm') || c.purl.startsWith('pkg:generic')), 'pkg:github names are lower case');
});

test('a pack leaves out npm\'s own bookkeeping at the top of node_modules, and keeps dotfiles elsewhere', () => {
  const dir = temp();
  try {
    put(dir, 'node_modules/.package-lock.json', '{}');
    put(dir, 'node_modules/.bin/x', 'x');
    put(dir, 'node_modules/p/.npmrc', 'kept');
    put(dir, 'packages/a/.hidden', 'kept');
    assert.deepEqual(unpack(pack(dir)).map((f) => f.path), ['node_modules/p/.npmrc', 'packages/a/.hidden']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checksums: exactly the program, its bill of materials and the notices; plain regular files; either line ending', () => {
  const dir = temp();
  try {
    const name = 'tabularius-1.2.3-linux-x64';
    const program = join(dir, name);
    writeFileSync(program, 'the program');
    writeFileSync(join(dir, `${name}.sbom.cdx.json`), '{}');
    writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.md'), '# n');
    const manifest = writeManifest(program);
    const text = readFileSync(manifest, 'utf8');
    // sha256sum's own binary-mode lines and Windows line endings are the same manifest.
    const crlf = join(dir, 'crlf.sha256');
    writeFileSync(crlf, text.replace(/\n/g, '\r\n').replace(/  /g, ' *'));
    assert.deepEqual(verifyManifest(crlf), []);
    // A manifest cut down to the program alone does not pass: the other two files would go unchecked.
    const only = join(dir, 'only.sha256');
    writeFileSync(only, text.split('\n').filter((l) => l.endsWith(name)).join('\n') + '\n');
    assert.deepEqual(verifyManifest(only), [`the checksum file does not list ${name}.sbom.cdx.json`, 'the checksum file does not list THIRD-PARTY-NOTICES.md']);
    // Extra names are refused, and so are dot names and names with a path or a stream.
    for (const bad of ['..', '.', '.hidden', 'a/b', 'a\\b', `${name}:stream`]) {
      writeFileSync(only, `${'0'.repeat(64)}  ${bad}\n`);
      assert.match(verifyManifest(only)[0], /^not a checksum line/, bad);
    }
    writeFileSync(only, text + `${'0'.repeat(64)}  extra.bin\n`);
    assert.ok(verifyManifest(only).includes('the checksum file lists extra.bin, which is not part of the release'));
    // A listed file swapped for a link to other bytes is not a regular file.
    writeFileSync(join(dir, 'other'), 'the program');
    rmSync(program);
    symlinkSync(join(dir, 'other'), program);
    assert.deepEqual(verifyManifest(manifest), [`${name} is not a regular file`]);
    assert.throws(() => writeManifest(program), /not found/);
    assert.throws(() => writeManifest(join(dir, 'THIRD-PARTY-NOTICES.md')), /not a release program/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tool that builds the executable is pinned by hash in a lockfile, not fetched by version number', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const lock = JSON.parse(readFileSync(join(root, 'scripts', 'release', 'postject', 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; integrity?: string }> };
  const entries = Object.entries(lock.packages).filter(([path]) => path !== '');
  assert.ok(entries.some(([path]) => path === 'node_modules/postject'), 'postject is in the lockfile');
  for (const [path, entry] of entries) assert.match(entry.integrity ?? '', /^sha512-/, `${path} has a hash`);
  assert.doesNotMatch(readFileSync(join(root, 'scripts', 'build-release.ts'), 'utf8'), /\bnpx\b.*postject|postject@/, 'build-release.ts fetches postject through the lockfile');
});
