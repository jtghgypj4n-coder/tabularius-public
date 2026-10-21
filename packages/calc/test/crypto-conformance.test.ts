import { test } from 'node:test';
import assert from 'node:assert/strict';
import vectors from './crypto-rfc4231.json' with { type: 'json' };
import { evaluateText } from '../src/index.ts';

// https://www.rfc-editor.org/rfc/rfc4231#section-4 — literal published expected digests.
for (const v of vectors) test(`RFC 4231 case ${v.case}: all four HMAC algorithms`, () => {
  for (const [bits, expected] of Object.entries(v.digests)) {
    const actual = evaluateText(`HexEncode ( CryptAuthCode ( HexDecode ( "${v.data}" ; "data" ) ; "SHA${bits}" ; HexDecode ( "${v.key}" ; "key" ) ) )`);
    assert.equal(actual.slice(0, expected.length).toLowerCase(), expected, `SHA${bits}`);
  }
});

test('HMAC rejects an unsupported algorithm', () => {
  assert.equal(evaluateText('CryptAuthCode ( "data" ; "none" ; "key" )'), '?');
});
