import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { NameTable, evaluate, evaluateText, type CalcContext, type Value } from '../src/index.ts';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le32 = (n: number) => [...le16(n), ...le16(n >>> 16)];
const chunk = (type: string, data: number[]) => [...be32(data.length), ...Buffer.from(type), ...data, 0, 0, 0, 0];

// Headers as image writers make them (checked against Pillow's and ImageMagick's files).
const IMAGES: Record<string, Uint8Array> = {
  // 37 × 21 RGB with pHYs 5906 pixels per metre (150 dpi).
  png: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(37), ...be32(21), 8, 2, 0, 0, 0]),
    ...chunk('pHYs', [...be32(5906), ...be32(5906), 1]),
    ...chunk('IDAT', [...deflateSync(Buffer.alloc(22 * 21))]), ...chunk('IEND', [])]),
  // RGBA: colour type 6 has an alpha channel.
  alpha: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(640), ...be32(480), 8, 6, 0, 0, 0])]),
  // A GIF whose Graphic Control Extension names a transparent colour.
  gif: Uint8Array.from([...Buffer.from('GIF89a'), ...le16(37), ...le16(21), 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0x21, 0xf9, 4, 1, 0, 0, 0, 0]),
  // JFIF at 300 dots per inch, then a baseline frame of 21 rows of 37.
  jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from('JFIF\0'), 1, 1, 1, 1, 44, 1, 44, 0, 0,
    0xff, 0xc0, 0, 11, 8, 0, 21, 0, 37, 1, 1, 0x11, 0]),
  // A BMP with a 40-byte header, top-down (negative height), 3780 pixels per metre (96 dpi).
  bmp: Uint8Array.from([0x42, 0x4d, ...le32(0), 0, 0, 0, 0, ...le32(54), ...le32(40), ...le32(37), ...le32(-21), ...le16(1), ...le16(24), ...le32(0), ...le32(0), ...le32(3780), ...le32(3780), ...le32(0), ...le32(0)]),
};

const fields: Record<string, Value> = {
  Photo: { type: 'container', value: 'photo.png', data: IMAGES.png },
  Alpha: { type: 'container', value: 'alpha.png', data: IMAGES.alpha },
  Anim: { type: 'container', value: 'a.gif', data: IMAGES.gif },
  Shot: { type: 'container', value: 'shot.jpg', data: IMAGES.jpeg },
  Scan: { type: 'container', value: 'scan.bmp', data: IMAGES.bmp },
  Doc: { type: 'container', value: 'notes.txt', data: new TextEncoder().encode('hello') },
};
const ctx: CalcContext = { names: new NameTable({ fields: Object.keys(fields) }), field: (ref) => fields[ref.field] };
const t = (f: string) => evaluateText(f, ctx);

test('GetWidth and GetHeight give an image\'s size in pixels, 0 for anything else', () => {
  assert.equal(t('GetWidth ( Photo ) & "x" & GetHeight ( Photo )'), '37x21');
  assert.equal(t('GetWidth ( Alpha ) & "x" & GetHeight ( Alpha )'), '640x480');
  assert.equal(t('GetWidth ( Anim ) & "x" & GetHeight ( Anim )'), '37x21');
  assert.equal(t('GetWidth ( Shot ) & "x" & GetHeight ( Shot )'), '37x21');
  assert.equal(t('GetWidth ( Scan ) & "x" & GetHeight ( Scan )'), '37x21');
  assert.equal(t('GetWidth ( Doc ) & "x" & GetHeight ( Doc )'), '0x0');
  assert.equal(t('GetHeight ( "text" )'), '0');
});

test('Text, a palette that looks like a marker, and cut-off headers aren\'t taken for images', () => {
  const doc = (bytes: Uint8Array): Value => ({ type: 'container', value: 'x', data: bytes });
  const cases: Record<string, Value> = {
    // Starts "BM" like a bitmap.
    Bmw: doc(new TextEncoder().encode('BMW owners manual, edition twelve, second printing 2026')),
    // A JPEG frame header cut off before its size, and a PNG cut off inside IHDR.
    Cut: doc(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00])),
    CutPng: doc(IMAGES.png.subarray(0, 20)),
    // A GIF without a Graphic Control Extension whose colour table holds the bytes 21 F9 04 01.
    Palette: doc(Uint8Array.from([...Buffer.from('GIF89a'), ...le16(2), ...le16(2), 0x81, 0, 0, 0x21, 0xf9, 0x04, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x2c, 0, 0, 0, 0, ...le16(2), ...le16(2), 0, 2, 2, 0x44, 0x01, 0, 0x3b])),
  };
  const c: CalcContext = { names: new NameTable({ fields: Object.keys(cases) }), field: (ref) => cases[ref.field] };
  const e = (f: string) => evaluateText(f, c);
  assert.equal(e('GetWidth ( Bmw ) & GetContainerAttribute ( Bmw ; "width" )'), '0');
  assert.equal(e('GetWidth ( Cut ) & "," & GetContainerAttribute ( Cut ; "height" ) & "," & GetHeight ( CutPng )'), '0,,0');
  assert.equal(e('GetWidth ( Palette ) & "," & GetContainerAttribute ( Palette ; "transparency" )'), '2,0');
});

test('GetContainerAttribute reads image size, resolution, transparency and MD5', () => {
  assert.equal(t('GetContainerAttribute ( Photo ; "width" ) & "," & GetContainerAttribute ( Photo ; "Height" )'), '37,21');
  assert.equal(t('GetContainerAttribute ( Photo ; "dpiWidth" ) & "," & GetContainerAttribute ( Photo ; "dpiHeight" )'), '150,150');
  assert.equal(t('GetContainerAttribute ( Shot ; "dpiWidth" )'), '300');
  assert.equal(t('GetContainerAttribute ( Scan ; "dpiHeight" )'), '96');
  // No pHYs chunk: the file doesn't say, so neither does Tabularius.
  assert.equal(t('GetContainerAttribute ( Alpha ; "dpiWidth" )'), '');
  assert.equal(t('GetContainerAttribute ( Alpha ; "transparency" ) & GetContainerAttribute ( Photo ; "transparency" ) & GetContainerAttribute ( Anim ; "transparency" )'), '101');
  assert.equal(t('GetContainerAttribute ( Doc ; "width" )'), '');
  // MD5 is upper-case hex, as Claris's example shows it.
  assert.equal(t('GetContainerAttribute ( Doc ; "MD5" )'), '5D41402ABC4B2A76B9719D911017C592');
  assert.equal(t('GetContainerAttribute ( Doc ; "fileSize" )'), '5');
});

test('CryptAuthCode is an HMAC, SHA512 when no algorithm is named', () => {
  // RFC 4231 test case 2.
  assert.equal(t('HexEncode ( CryptAuthCode ( "what do ya want for nothing?" ; "SHA256" ; "Jefe" ) )'), '5BDCC146BF60754E6A042426089575C75A003F089D2739839DEC58B964EC3843');
  assert.equal(t('HexEncode ( CryptAuthCode ( "what do ya want for nothing?" ; "" ; "Jefe" ) )'),
    '164B7A7BFCF819E2E395FBE73B56E0A387BD64222E831FD610270CD7EA2505549758BF75C05A994A6D034F65F8F0E6FDCAEAB1A34D4A6B4B636E070A38BCE737');
  // A key given as hex bytes (RFC 2202 test case 1: twenty 0x0b bytes, "Hi There", HMAC-SHA1).
  assert.equal(t('HexEncode ( CryptAuthCode ( "Hi There" ; "SHA1" ; HexDecode ( "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b" ; "k" ) ) )'), 'B617318655057264E28BC0B6FB378C8EF146BE00');
  assert.equal(t('CryptAuthCode ( "x" ; "SHA3" ; "k" )'), '?');
});

test('CryptGenerateSignature and CryptVerifySignature sign with an RSA key, encrypted or not', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const plain = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  // The traditional encrypted form Claris's example shows (Proc-Type: 4,ENCRYPTED; DEK-Info: DES-EDE3-CBC).
  const locked = privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'des-ede3-cbc', passphrase: 'secret' }).toString();
  assert.match(locked, /DEK-Info: DES-EDE3-CBC/);
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keys: Record<string, Value> = { Plain: { type: 'text', value: plain }, Locked: { type: 'text', value: locked }, Pub: { type: 'text', value: pub } };
  const kctx: CalcContext = { names: new NameTable({ fields: Object.keys(keys) }), field: (ref) => keys[ref.field] };
  const k = (f: string) => evaluateText(f, kctx);

  assert.equal(k('CryptVerifySignature ( "pay 10" ; "SHA512" ; Pub ; CryptGenerateSignature ( "pay 10" ; "SHA512" ; Plain ; "" ) )'), '1');
  assert.equal(k('CryptVerifySignature ( "pay 10" ; "SHA256" ; Pub ; Base64Decode ( Base64EncodeRFC ( 4648 ; CryptGenerateSignature ( "pay 10" ; "SHA256" ; Locked ; "secret" ) ) ; "sig.data" ) )'), '1');
  // Other data, or another digest than the one signed, doesn't verify.
  assert.equal(k('CryptVerifySignature ( "pay 99" ; "SHA512" ; Pub ; CryptGenerateSignature ( "pay 10" ; "SHA512" ; Plain ; "" ) )'), '0');
  assert.equal(k('CryptVerifySignature ( "pay 10" ; "SHA256" ; Pub ; CryptGenerateSignature ( "pay 10" ; "SHA512" ; Plain ; "" ) )'), '0');
  // PKCS #1 v1.5 signatures are deterministic: the same key and data sign the same.
  assert.equal(k('HexEncode ( CryptGenerateSignature ( "a" ; "SHA1" ; Plain ; "" ) ) = HexEncode ( CryptGenerateSignature ( "a" ; "SHA1" ; Locked ; "secret" ) )'), '1');
  // A wrong password, a key that isn't one, or an unknown algorithm: "?".
  assert.equal(k('CryptGenerateSignature ( "a" ; "SHA512" ; Locked ; "wrong" )'), '?');
  assert.equal(k('CryptGenerateSignature ( "a" ; "SHA512" ; "not a key" ; "" )'), '?');
  assert.equal(k('CryptGenerateSignature ( "a" ; "SHA3" ; Plain ; "" )'), '?');
  assert.equal(k('CryptVerifySignature ( "a" ; "SHA512" ; "not a key" ; "x" )'), '?');
  // A private key where the public one belongs is refused, not used for its public half.
  assert.equal(k('CryptVerifySignature ( "a" ; "SHA512" ; Plain ; CryptGenerateSignature ( "a" ; "SHA512" ; Plain ; "" ) )'), '?');
});

test('CryptEncrypt and CryptDecrypt give back text as text, and a container as itself with its name', () => {
  assert.equal(t('CryptDecrypt ( CryptEncrypt ( "This needs protection" ; "My secret password" ) ; "My secret password" )'), 'This needs protection');
  assert.equal(t('GetContainerAttribute ( CryptEncrypt ( "x" ; "k" ) ; "filename" )'), 'encrypted.data');
  // A random salt and IV each time.
  assert.notEqual(t('Base64Encode ( CryptEncrypt ( "x" ; "k" ) )'), t('Base64Encode ( CryptEncrypt ( "x" ; "k" ) )'));
  const doc = evaluate('CryptDecrypt ( CryptEncrypt ( Doc ; "k" ) ; "k" )', ctx);
  assert.equal(doc.type, 'container');
  assert.equal(doc.value, 'notes.txt');
  assert.equal(new TextDecoder().decode((doc as { data: Uint8Array }).data), 'hello');
  // The wrong key, or data CryptEncrypt didn't make, gives empty.
  assert.equal(t('CryptDecrypt ( CryptEncrypt ( "secret" ; "right" ) ; "wrong" )'), '');
  assert.equal(t('CryptDecrypt ( Doc ; "k" )'), '');
  assert.equal(t('CryptDecrypt ( "not a container" ; "k" )'), '');
});

test('CryptEncryptBase64 is text that CryptDecryptBase64 reads, line breaks and all', () => {
  const b64 = t('CryptEncryptBase64 ( "This needs protection" ; "My secret password" )');
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
  const wrapped = b64.replace(/(.{20})/g, '$1\r');
  assert.equal(t(`CryptDecryptBase64 ( "${wrapped}" ; "My secret password" )`), 'This needs protection');
  assert.equal(t(`CryptDecryptBase64 ( "${b64}" ; "nope" )`), '');
  assert.equal(new TextDecoder().decode((evaluate('CryptDecryptBase64 ( CryptEncryptBase64 ( Doc ; "k" ) ; "k" )', ctx) as { data: Uint8Array }).data), 'hello');
});
