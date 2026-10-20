import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';

const fox = 'The quick brown fox jumps over the lazy dog';
const ctx: CalcContext = {};
const mbs = (args: string) => evaluateText(`MBS ( ${args} )`, ctx);
const isError = () => evaluateText('MBS ( "IsError" )', ctx);

// Expected values from MonkeyBread's function reference (mbsplugins.eu) where it gives one.
test('MBS Hash: digests in upper-case hex, base64 or base64url, of text or hex', () => {
  assert.equal(mbs('"Hash.SHA256" ; ""'), 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855');
  assert.equal(mbs(`"Hash.SHA256" ; "${fox}"`), 'D7A8FBB307D7809469CA9ABCB0082E4F8D5651E46D3CDB762D02D0BF37C9E592');
  assert.equal(isError(), '0');
  // MBS's own flags test: "Hello", and its hex with flag 2, give the same MD5.
  assert.equal(mbs('"Hash.MD5" ; "Hello"'), '8B1A9953C4611296A827ABF8C47804D7');
  assert.equal(mbs('"Hash.MD5" ; "48656C6C6F" ; 2'), '8B1A9953C4611296A827ABF8C47804D7');
  assert.equal(mbs('"Hash.SHA1" ; "Hello" ; 1'), '9/+ei3uy4Jtwk1pdeF4MxdnQq/A=');
  assert.equal(mbs('"Hash.SHA512" ; "a" ; 8').length, 86); // 64 bytes, unpadded
  assert.doesNotMatch(mbs('"Hash.SHA512" ; "a" ; 8'), /[+/=]/);
  // Text is hashed as UTF-8.
  assert.equal(mbs('"Hash.SHA1" ; "é"'), mbs('"Hash.SHA1" ; "C3A9" ; 2'));
});

test('MBS Hash: HMACs, with the key or data given as hex', () => {
  assert.equal(mbs('"Hash.SHA1.HMAC" ; "" ; ""'), 'FBDB1D1B18AA6C08324B7D64B71FB76370690E1D');
  assert.equal(mbs(`"Hash.SHA1.HMAC" ; "key" ; "${fox}"`), 'DE7C9B85B8B78AA6BC8A7A36F70A90701C9DB4D9');
  assert.equal(mbs(`"Hash.MD5.HMAC" ; "key" ; "${fox}"`), '80070713463E7749B90C2DC24911E275');
  assert.equal(mbs(`"Hash.SHA256.HMAC" ; "key" ; "${fox}"`), 'F7BC83F430538424B13298E6AA6FB143EF4D59A14946175997479DBC2D1A3CD8');
  assert.equal(mbs(`"Hash.SHA256.HMAC" ; "6B6579" ; "${fox}" ; 2`), 'F7BC83F430538424B13298E6AA6FB143EF4D59A14946175997479DBC2D1A3CD8');
  assert.equal(mbs('"Hash.SHA1.HMAC" ; "key" ; "414243" ; 4'), mbs('"Hash.SHA1.HMAC" ; "key" ; "ABC"'));
  assert.match(mbs('"Hash.SHA512.HMAC" ; "k" ; "d"'), /^[0-9A-F]{128}$/);
  assert.match(mbs('"Hash.SHA1.HMAC" ; "xyz" ; "d" ; 2'), /^\[MBS\] ERROR/);
  assert.equal(isError(), '1');
});

test('MBS Hash: Hash.Digest; PBKDF2 stays refused', () => {
  assert.match(mbs('"Hash.PBKDF2.HMAC" ; "Hello" ; "World" ; 100 ; 32 ; "SHA512"'), /^\[MBS\] ERROR/);
  assert.equal(mbs('"Hash.Digest" ; "RSA-SHA3-256" ; "Text" ; "Hello World" ; "UTF-8" ; "Hex" ; ""'), 'E167F68D6563D75BB25F3AA49C29EF612D41352DC00606DE7CBD630BB2665F51');
  assert.equal(mbs('"Hash.Digest" ; "Shake128" ; "Text" ; "Hello World" ; "UTF-8" ; "Hex" ; ""'), '1227C5F882F9C57BF2E3E48D2C87EB20');
  assert.equal(mbs('"Hash.Digest" ; "sha256" ; "Text" ; "" ; "UTF-8" ; "hex"'), mbs('"Hash.SHA256" ; ""'));
  assert.equal(mbs('"Hash.Digest" ; "MD5" ; "Base64" ; "SGVsbG8=" ; "" ; "Hex" ; ""'), '8B1A9953C4611296A827ABF8C47804D7');
  assert.equal(mbs('"Hash.Digest" ; "MD5" ; "Container" ; Base64Decode ( "SGVsbG8=" ; "hello.txt" ) ; "" ; "Base64" ; ""'), 'ixqZU8RhEpaoJ6v4xHgE1w==');
  // Latin-1 text and UTF-8 text hash differently.
  assert.notEqual(mbs('"Hash.Digest" ; "MD5" ; "Text" ; "é" ; "Latin1" ; "Hex"'), mbs('"Hash.Digest" ; "MD5" ; "Text" ; "é" ; "UTF-8" ; "Hex"'));
  assert.equal(mbs('"Hash.Digest" ; "MD5" ; "Text" ; "é" ; "Latin1" ; "Hex"'), mbs('"Hash.MD5" ; "E9" ; 2'));
  // Files are not read.
  assert.match(mbs('"Hash.Digest" ; "MD5" ; "Path" ; "/etc/hosts" ; "" ; "Hex"'), /^\[MBS\] ERROR/);
  assert.match(mbs('"Hash.DigestFile" ; "SHA256" ; "/etc/hosts" ; "hex"'), /^\[MBS\] ERROR/);
  assert.match(mbs('"Hash.Digest" ; "nope" ; "Text" ; "x" ; "" ; "Hex"'), /^\[MBS\] ERROR/);
});

test('MBS Hash: CRC16 variants and CRC32', () => {
  assert.equal(mbs('"Hash.CRC16" ; "Text" ; "123456789" ; "UTF-8" ; 65535 ; 4129'), '10673'); // CCITT, MBS's example
  assert.equal(mbs('"Hash.CRC16" ; "Text" ; "123456789" ; "UTF-8" ; 65535 ; 40961 ; 0 ; 1 ; 0'), '15739'); // MBS's MODBUS example
  assert.equal(mbs('"Hash.CRC16" ; "Text" ; "123456789" ; "UTF-8" ; 0 ; 4129'), String(0x31c3)); // XMODEM
  assert.equal(mbs('"Hash.CRC16" ; "Text" ; "123456789"'), '10673'); // the defaults
  assert.equal(mbs('"Hash.CRC32" ; "Text" ; "123456789" ; "UTF-8" ; 0'), String(0xcbf43926));
  assert.equal(mbs('"Hash.CRC32" ; "Hex" ; "313233343536373839"'), String(0xcbf43926));
});
