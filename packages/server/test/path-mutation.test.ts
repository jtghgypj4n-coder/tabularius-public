import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { existingDirectoryLinks, safeExistingPath, safeWritePath } from '../../store/src/safe-path.ts';

function folders(t: { after(fn: () => void): void }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mutation-path-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'root'), outside = join(dir, 'outside');
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(root, 'inside'), 'inside'); writeFileSync(join(outside, 'secret'), 'outside');
  return { dir, root, outside };
}

test('read and write resolution reject lexical escapes, absolute paths and empty names', (t) => {
  const { root, outside } = folders(t);
  for (const rel of ['', '..', '../outside/secret', join(outside, 'secret')]) {
    assert.equal(safeExistingPath(root, rel), undefined, rel);
    assert.equal(safeWritePath(root, rel), undefined, rel);
  }
  assert.equal(safeExistingPath(root, 'inside'), join(root, 'inside'));
  assert.equal(safeExistingPath(root, 'missing'), undefined);
  assert.equal(safeExistingPath(join(root, 'missing'), 'inside'), undefined);
  assert.equal(safeWritePath(join(root, 'inside'), 'child'), undefined);
  assert.equal(safeExistingPath(root, 'inside/child'), undefined);
  assert.equal(safeWritePath(root, 'inside/child'), undefined);
  const target = safeWritePath(root, 'nested/folder/new');
  assert.equal(target, join(root, 'nested/folder/new'));
  writeFileSync(target!, 'new');
  assert.equal(safeExistingPath(root, 'nested/folder/new'), target);
  assert.equal(safeWritePath(root, 'nested/folder/again'), join(root, 'nested/folder/again'));
});

test('only indexed directory mounts are usable, and final symlinks are never writable', (t) => {
  const { root, outside } = folders(t);
  symlinkSync(outside, join(root, 'mount'));
  symlinkSync(join(outside, 'secret'), join(root, 'file-link'));
  symlinkSync(join(outside, 'missing'), join(root, 'dangling'));
  const links = existingDirectoryLinks([root]);
  assert.ok(links.has(join(root, 'mount')));
  assert.equal(safeExistingPath(root, 'mount/secret'), undefined);
  assert.equal(safeWritePath(root, 'mount/new'), undefined);
  assert.equal(safeExistingPath(root, 'mount/secret', links), join(outside, 'secret'));
  assert.equal(safeWritePath(root, 'mount/new', links), join(outside, 'new'));
  for (const rel of ['file-link', 'dangling', 'file-link/child']) {
    assert.equal(safeExistingPath(root, rel, links), undefined, rel);
    assert.equal(safeWritePath(root, rel, links), undefined, rel);
  }
  // An approved mount cannot smuggle a later unindexed mount through its interior.
  symlinkSync(root, join(outside, 'late'));
  assert.equal(safeExistingPath(root, 'mount/late/inside', links), undefined);
  assert.equal(safeWritePath(root, 'mount/late/new', links), undefined);
  assert.equal(readFileSync(join(outside, 'secret'), 'utf8'), 'outside');
});

test('a mount is pinned to both its link text and its resolved target after first use', (t) => {
  const { dir, root, outside } = folders(t);
  const other = join(dir, 'other'), alias = join(dir, 'alias');
  mkdirSync(other); writeFileSync(join(other, 'secret'), 'other');
  symlinkSync(outside, alias); symlinkSync(alias, join(root, 'mount'));
  const links = existingDirectoryLinks([root]);
  assert.equal(safeExistingPath(root, 'mount/secret', links), join(outside, 'secret'));
  rmSync(alias); symlinkSync(other, alias);
  assert.equal(safeExistingPath(root, 'mount/secret', links), undefined);
  assert.equal(safeWritePath(root, 'mount/new', links), undefined);
  rmSync(join(root, 'mount')); symlinkSync(outside, join(root, 'mount'));
  assert.equal(safeExistingPath(root, 'mount/secret', links), undefined);
  assert.equal(safeWritePath(root, 'mount/new', links), undefined);
});

test('mount indexing never enters a linked root and respects its directory-depth boundary', (t) => {
  const { dir, root, outside } = folders(t);
  mkdirSync(join(root, 'a/b/c'), { recursive: true });
  symlinkSync(outside, join(root, 'a/b/allowed'));
  symlinkSync(outside, join(root, 'a/b/c/too-deep'));
  const links = existingDirectoryLinks([root]);
  assert.ok(links.has(join(root, 'a/b/allowed')));
  assert.equal(links.has(join(root, 'a/b/c/too-deep')), false);
  symlinkSync(root, join(dir, 'linked-root'));
  assert.equal(existingDirectoryLinks([join(dir, 'linked-root')]).size, 0);
  assert.equal(existingDirectoryLinks([join(dir, 'missing-root')]).size, 0);
  assert.equal(existingDirectoryLinks([]).size, 0);
});

test('alternate mount spellings resolve only the same indexed symlink, never a twin with the same target', (t) => {
  const { root, outside } = folders(t);
  mkdirSync(join(root, 'dir'));
  const mount = join(root, 'mount'); symlinkSync(outside, mount);
  // A noncanonical spelling exercises the same inode lookup on case-sensitive and insensitive volumes.
  const links = new Map([[join(root, 'dir') + '/../mount', { link: outside }]]);
  assert.equal(safeExistingPath(root, 'mount/secret', links), join(outside, 'secret'));
  assert.equal(safeWritePath(root, 'mount/new', links), join(outside, 'new'));
  symlinkSync(outside, join(root, 'twin'));
  assert.equal(safeExistingPath(root, 'twin/secret', links), undefined);
  assert.equal(safeWritePath(root, 'twin/new', links), undefined);
  rmSync(mount);
  assert.equal(safeExistingPath(root, 'twin/secret', links), undefined);
});

test('write paths reject absolute names even when they point inside the root', (t) => {
  const { root } = folders(t);
  assert.equal(safeWritePath(root, join(root, 'new')), undefined);
});

test('exact indexed mounts avoid fallback probes, and lexical escapes are refused before probing outside', (t) => {
  const { root, outside } = folders(t);
  const mount = join(root, 'mount'); symlinkSync(outside, mount);
  const links = existingDirectoryLinks([root]);
  const original = fs.lstatSync; const probes: string[] = [];
  const mock = t.mock.method(fs, 'lstatSync', ((...args: Parameters<typeof fs.lstatSync>) => {
    probes.push(String(args[0])); return Reflect.apply(original, fs, args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  try {
    assert.equal(safeExistingPath(root, 'mount/secret', links), join(outside, 'secret'));
    assert.equal(probes.filter((p) => p === mount).length, 1, 'exact mounts do not repeat inode lookup');
    probes.length = 0;
    assert.equal(safeExistingPath(root, '../outside/secret'), undefined);
    assert.equal(safeWritePath(root, '../outside/new'), undefined);
    assert.deepEqual(probes, [], 'lexical escapes do not probe the parent or its children');
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test('a directory swapped after lstat is contained before the next component is read or created', (t) => {
  const { root, outside } = folders(t);
  const original = fs.lstatSync;
  for (const write of [false, true]) {
    const directory = join(root, write ? 'write-dir' : 'read-dir'); mkdirSync(directory);
    let swapped = false, editing = false; const later: string[] = [];
    const mock = t.mock.method(fs, 'lstatSync', ((...args: Parameters<typeof fs.lstatSync>) => {
      const path = String(args[0]);
      if (swapped && !editing) later.push(path);
      const result = Reflect.apply(original, fs, args);
      if (!swapped && path === directory) {
        swapped = true; editing = true;
        try { rmSync(directory, { recursive: true }); symlinkSync(outside, directory); }
        finally { editing = false; }
      }
      return result;
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    try {
      const rel = write ? 'write-dir/created/new' : 'read-dir/secret';
      assert.equal((write ? safeWritePath : safeExistingPath)(root, rel), undefined);
      assert.equal(swapped, true); assert.deepEqual(later, [], 'containment stops traversal immediately after the swap');
      assert.equal(fs.existsSync(join(outside, 'created')), false);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  }
});

test('filesystem errors are refused for both intermediate and final write components', (t) => {
  const { root } = folders(t);
  const original = fs.lstatSync;
  for (const rel of ['blocked/child', 'blocked']) {
    const mock = t.mock.method(fs, 'lstatSync', ((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === join(root, 'blocked')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return Reflect.apply(original, fs, args);
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    try { assert.equal(safeWritePath(root, rel), undefined); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
  }
});

test('a fallback mount lookup refuses a non-link snapshot even if a later inode lookup matches', (t) => {
  const { root, outside } = folders(t);
  mkdirSync(join(root, 'dir'));
  const mount = join(root, 'mount'); symlinkSync(outside, mount);
  const links = new Map([[join(root, 'dir') + '/../mount', { link: outside }]]);
  const original = fs.lstatSync;
  const link = original(mount), regular = original(join(root, 'inside'));
  // Model replacement and inode reuse between snapshots. Later matching metadata
  // must not rehabilitate a candidate that was observed as an ordinary file.
  const snapshot = Object.assign(Object.create(Object.getPrototypeOf(regular)), regular, { dev: link.dev, ino: link.ino });
  let probes = 0;
  const mock = t.mock.method(fs, 'lstatSync', ((...args: Parameters<typeof fs.lstatSync>) => {
    if (String(args[0]) === mount && ++probes === 2) return snapshot;
    return Reflect.apply(original, fs, args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  try {
    assert.equal(safeExistingPath(root, 'mount/secret', links), undefined);
    assert.equal(probes, 2);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});
