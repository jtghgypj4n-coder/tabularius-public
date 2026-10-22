import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as safe from '../src/fs-boundary.ts';
import { atomicWrite, writeDurable, writeJsonStateSync } from '../src/durable.ts';

function setup(t: import('node:test').TestContext) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-fs-race-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inside = join(dir, 'inside'), outside = join(dir, 'outside');
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  const file = join(inside, 'data'), secret = join(outside, 'data');
  fs.writeFileSync(file, 'original'); fs.writeFileSync(secret, 'secret');
  return { dir, inside, outside, file, secret };
}

test('invariant: stable parent aliases support guarded reads, writes, and durable state publication', async (t) => {
  const warnings = t.mock.method(console, 'warn');
  const s = setup(t), alias = join(s.dir, 'alias');
  fs.symlinkSync(s.inside, alias);
  const file = join(alias, 'data');
  assert.equal(safe.readFileSync(file, 'utf8'), 'original');
  safe.writeFileSync(file, 'replacement');
  const handle = await safe.open(file, 'r');
  try { assert.equal(await handle.readFile('utf8'), 'replacement'); }
  finally { await handle.close(); }
  const state = join(alias, 'settings.json');
  writeJsonStateSync(state, { value: 42 });
  writeJsonStateSync(state, { value: 17 });
  assert.deepEqual(JSON.parse(fs.readFileSync(state, 'utf8')), { value: 17 });
  assert.equal(fs.statSync(state).mode & 0o777, 0o600);
  atomicWrite(join(alias, 'atomic'), 'published');
  assert.equal(fs.readFileSync(join(s.inside, 'atomic'), 'utf8'), 'published');
  assert.deepEqual(fs.readdirSync(s.inside).filter((n) => n.endsWith('.tmp')), []);
  assert.equal(warnings.mock.callCount(), 0, 'the aliased state directory must also be flushed');
});

for (const phase of ['checked', 'opened'] as const) {
  for (const attack of ['alias', 'target', 'target-parent'] as const) {
    test(`invariant: ${attack} replacement behind a parent alias is refused at ${phase}`, (t) => {
      const s = setup(t), alias = join(s.dir, 'alias');
      const parent = join(s.inside, 'parent'), target = join(parent, 'target');
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(join(target, 'data'), 'original');
      fs.symlinkSync(target, alias);
      let hit = false;
      assert.throws(() => safe.withFilesystemHook((e) => {
        if (hit || e.operation !== 'open' || e.phase !== phase) return;
        hit = true;
        if (attack === 'alias') {
          fs.unlinkSync(alias); fs.symlinkSync(s.outside, alias);
        } else if (attack === 'target') {
          fs.renameSync(target, target + '-old'); fs.symlinkSync(s.outside, target);
        } else {
          // Preserve the target inode and pathname while replacing its resolved ancestry.
          fs.renameSync(parent, parent + '-old'); fs.mkdirSync(parent);
          fs.renameSync(join(parent + '-old', 'target'), target);
        }
      }, () => safe.writeFileSync(join(alias, 'data'), 'clobber')), { code: 'ESTALE' });
      assert.ok(hit);
      const original = attack === 'target' ? join(target + '-old', 'data') : join(target, 'data');
      assert.equal(fs.readFileSync(original, 'utf8'), 'original');
      assert.equal(fs.readFileSync(s.secret, 'utf8'), 'secret');
    });
  }
}

test('invariant: refusal at the guarded write check preserves bytes of a newly hard-linked file', (t) => {
  const s = setup(t), alias = join(s.outside, 'alias');
  let hit = false;
  assert.throws(() => safe.withFilesystemHook((e) => {
    if (hit || e.operation !== 'write') return;
    hit = true; fs.linkSync(s.file, alias);
  }, () => safe.writeFileSync(s.file, 'clobber')), { code: 'ESTALE' });
  assert.ok(hit);
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'original');
  assert.equal(fs.readFileSync(alias, 'utf8'), 'original');
});

for (const phase of ['checked', 'opened'] as const) {
  for (const operation of ['read', 'write'] as const) {
    for (const attack of ['symlink', 'swap', 'parent', 'hardlink'] as const) {
      test(`${operation} rejects ${attack} at ${phase}`, (t) => {
        const s = setup(t);
        let hit = false;
        assert.throws(() => safe.withFilesystemHook((event) => {
          if (hit || event.phase !== phase) return;
          hit = true;
          if (attack === 'parent') {
            fs.renameSync(s.inside, s.inside + '-old');
            fs.symlinkSync(s.outside, s.inside);
          } else if (attack === 'hardlink') fs.linkSync(s.file, join(s.outside, 'link'));
          else {
            fs.renameSync(s.file, s.file + '-old');
            if (attack === 'symlink') fs.symlinkSync(s.secret, s.file);
            else fs.writeFileSync(s.file, 'replacement');
          }
        }, () => operation === 'read' ? safe.readFileSync(s.file) : safe.writeFileSync(s.file, 'new')));
        assert.ok(hit);
        assert.equal(fs.readFileSync(s.secret, 'utf8'), 'secret');
        if (attack === 'hardlink') assert.equal(fs.readFileSync(s.file, 'utf8'), 'original');
      });
    }
  }
}

test('unarmed calls work, create private files, and hooks are scoped across awaits', async (t) => {
  const { inside, file } = setup(t);
  safe.writeFileSync(file, 'a'); safe.appendFileSync(file, 'b');
  assert.equal(safe.readFileSync(file, 'utf8'), 'ab');
  const fresh = join(inside, 'new');
  safe.writeFileSync(fresh, 'private');
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
  let calls = 0;
  await safe.withFilesystemHook(() => { calls++; }, async () => { await Promise.resolve(); safe.readFileSync(file); });
  assert.equal(calls, 2);
  safe.readFileSync(file);
  assert.equal(calls, 2);
});

for (const attack of ['delete', 'symlink', 'parent', 'readonly', 'disk-full'] as const) {
  test(`atomic publish fails safely on ${attack}`, (t) => {
    const s = setup(t);
    let hit = false;
    assert.throws(() => safe.withFilesystemHook((event) => {
      if (event.operation !== 'rename') return;
      hit = true;
      if (attack === 'delete') fs.unlinkSync(event.path);
      if (attack === 'symlink') { fs.unlinkSync(event.path); fs.symlinkSync(s.secret, event.path); }
      if (attack === 'parent') {
        fs.writeFileSync(join(s.outside, basename(event.path)), 'outside cleanup sentinel');
        fs.renameSync(s.inside, s.inside + '-old'); fs.symlinkSync(s.outside, s.inside);
      }
      if (attack === 'readonly') fs.chmodSync(s.inside, 0o500);
      if (attack === 'disk-full') throw Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
    }, () => atomicWrite(s.file, 'new')));
    assert.ok(hit);
    fs.chmodSync(attack === 'parent' ? s.inside + '-old' : s.inside, 0o700);
    assert.equal(fs.readFileSync(attack === 'parent' ? join(s.inside + '-old', 'data') : s.file, 'utf8'), 'original');
    assert.equal(fs.readFileSync(s.secret, 'utf8'), 'secret');
    if (attack === 'parent') {
      const sentinels = fs.readdirSync(s.outside).filter((n) => n.endsWith('.tmp'));
      assert.equal(sentinels.length, 1);
      assert.equal(fs.readFileSync(join(s.outside, sentinels[0]), 'utf8'), 'outside cleanup sentinel');
    }
    // No secret-bearing staging file is readable by other users, including on
    // the moved parent where path-based cleanup deliberately cannot follow it.
    const left = attack === 'parent' ? s.inside + '-old' : s.inside;
    for (const entry of fs.readdirSync(left)) if (entry.endsWith('.tmp') && fs.lstatSync(join(left, entry)).isFile()) assert.equal(fs.statSync(join(left, entry)).mode & 0o077, 0);
  });
}

test('backup copy refuses an outside hard link without truncating either name', (t) => {
  const s = setup(t);
  fs.unlinkSync(s.file); fs.linkSync(s.secret, s.file);
  const source = join(s.inside, 'source'); fs.writeFileSync(source, 'backup');
  assert.throws(() => safe.copyFileSync(source, s.file));
  assert.equal(fs.readFileSync(s.secret, 'utf8'), 'secret');
});

test('durable publish refuses a swapped destination entry', (t) => {
  const s = setup(t), staged = join(s.inside, 'staged');
  fs.writeFileSync(staged, 'backup');
  assert.throws(() => safe.withFilesystemHook((e) => {
    if (e.operation !== 'rename') return;
    fs.unlinkSync(s.file); fs.symlinkSync(s.secret, s.file);
  }, () => writeDurable(staged, s.file)));
  assert.equal(fs.readFileSync(staged, 'utf8'), 'backup');
  assert.equal(fs.readFileSync(s.secret, 'utf8'), 'secret');
});


test('copying a file onto itself preserves its bytes', (t) => {
  const { file } = setup(t);
  assert.throws(() => safe.copyFileSync(file, file));
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
});

test('descriptor writes reject a hard link created after the file was opened', (t) => {
  const s = setup(t), fd = safe.openSync(s.file, 'r+');
  try {
    let hit = false;
    assert.throws(() => safe.withFilesystemHook((e) => {
      if (e.operation !== 'write') return;
      hit = true; fs.linkSync(s.file, join(s.outside, 'alias'));
    }, () => safe.writeSync(fd, Buffer.from('clobber'))));
    assert.ok(hit);
    assert.equal(fs.readFileSync(s.file, 'utf8'), 'original');
  } finally { fs.closeSync(fd); }
});

test('atomic cleanup does not remove a replacement leaf', (t) => {
  const s = setup(t); let replacement = '';
  assert.throws(() => safe.withFilesystemHook((e) => {
    if (e.operation !== 'rename') return;
    replacement = e.path;
    fs.renameSync(e.path, e.path + '.held');
    fs.writeFileSync(e.path, 'replacement sentinel');
    throw Object.assign(new Error('injected failure'), { code: 'ENOSPC' });
  }, () => atomicWrite(s.file, 'private')));
  assert.ok(replacement);
  assert.equal(fs.readFileSync(replacement, 'utf8'), 'replacement sentinel');
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'original');
});
