// What a person is told when hosting a file from the admin console goes wrong: what happened, and what to do next,
// never the converter's own words ("block 1 out of range") or an internal limit written as a bare number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Host } from '../src/host.ts';
import { MAX_UPLOAD, UploadError, Uploads, explainHostingFailure, hostedName, readableBytes } from '../src/uploads.ts';

const BANNED = /block \d+|bad magic|\bundefined\b|\[object|\bat \S+:\d+|\bENOENT\b|\bRangeError\b|\bError:|byte aggregate|HTTP \d{3}/i;

test('sizes are written for a person, and a size just over a limit is not rounded into looking equal to it', () => {
  assert.equal(readableBytes(512), '0.5 KB');
  assert.equal(readableBytes(1536 * 1024), '1.5 MB');
  assert.equal(readableBytes(10 * 1024 ** 3), '10 GB');
  assert.equal(readableBytes(1024 ** 2 + 1), readableBytes(1024 ** 2), 'rounded alike: the message then gives exact bytes');
});

test('every way the converter can say a file is unusable becomes a sentence with a next step', () => {
  const raws = [
    'block 1 out of range', 'block count 81 does not match file size 10000', 'not a FileMaker file (bad magic number)',
    'truncated varint', 'could not open the encrypted file: wrong passphrase', 'file uses Encryption at Rest; a passphrase is needed to open it',
    'something nobody foresaw',
  ];
  for (const raw of raws) {
    const text = explainHostingFailure('Contacts', raw);
    assert.match(text, /^Contacts\.fmp12 |^That passphrase /, raw);
    if (!/foresaw/.test(raw)) assert.doesNotMatch(text, BANNED, raw);
    assert.match(text, /\.$/);
  }
  assert.match(explainHostingFailure('A', 'block 1 out of range'), /copied only in part\. Copy it again/);
  assert.match(explainHostingFailure('A', 'not a FileMaker file (bad magic number)'), /isn't a FileMaker database/);
  // What isn't recognised keeps the converter's words, after a plain first sentence.
  assert.match(explainHostingFailure('A', 'something nobody foresaw'), /^A\.fmp12 couldn't be converted: something nobody foresaw\./);
});

test('refusals at the start of an upload say what to do', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upmsg-'));
  const host = new Host(dir, () => {});
  try {
    const uploads = new Uploads(host, () => {});
    const refused = (body: Record<string, unknown>, status: number) => {
      try {
        uploads.start(body);
      } catch (e) {
        assert.ok(e instanceof UploadError);
        assert.equal(e.status, status);
        assert.doesNotMatch(e.message, BANNED);
        return e.message;
      }
      throw new Error('was accepted');
    };
    assert.match(refused({ name: 'Empty.fmp12', size: 0 }, 400), /Empty\.fmp12 is empty \(0 bytes\).*copy it again/);
    assert.match(refused({ name: 'report.pdf', size: 10 }, 400), /report\.pdf isn't a FileMaker database file\. Choose a file whose name ends in \.fmp12/);
    assert.match(refused({ name: 'what?.fmp12', size: 10 }, 400), /Rename it/);
    assert.match(refused({ name: 'Huge.fmp12', size: MAX_UPLOAD + 5 }, 413), /more than the .* this server takes in one upload.*TABULARIUS_MAX_UPLOAD/);
    uploads.start({ name: 'Taken.fmp12', size: 10 });
    assert.match(refused({ name: 'taken.fmp12', size: 10 }, 409), /A file named taken is already hosted or being uploaded\. Remove it from Hosted files first/);
    assert.throws(() => uploads.get('nope'), (e: unknown) => e instanceof UploadError && /may have been removed, or the server restarted/.test(e.message));
    assert.equal(hostedName('Mon dossier é 😀.fmp12'), 'Mon dossier é 😀');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that fails to convert leaves its failure in words, and logs the converter\'s own', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-upmsg2-'));
  const logs: string[] = [];
  const host = new Host(dir, (m) => logs.push(m));
  try {
    const uploads = new Uploads(host, (m) => logs.push(m));
    const u = uploads.start({ name: 'Fake.fmp12', size: 9000 });
    const body = Buffer.alloc(9000, 'x');
    await uploads.write(u.id, 0, Object.assign(Readable.from([body]), { headers: { 'content-length': '9000' } }) as never);
    uploads.finish(u.id);
    for (let i = 0; i < 100 && uploads.get(u.id).phase !== 'failed'; i++) await new Promise((r) => setTimeout(r, 100));
    const failed = uploads.get(u.id);
    assert.equal(failed.phase, 'failed');
    assert.match(failed.error ?? '', /^Fake\.fmp12 isn't a FileMaker database/);
    assert.doesNotMatch(failed.error ?? '', BANNED);
    assert.ok(logs.some((l) => /bad magic number/.test(l)), 'the log keeps the converter\'s words for whoever looks into it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
