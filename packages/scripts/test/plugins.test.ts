import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Script } from '@tabularius/fmp12';
import { createStore, parseScriptText, Store } from '@tabularius/store';
import { runScript, ScriptSession } from '../src/index.ts';

let dir: string;
let docs: string;
let store: Store;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabularius-plugins-'));
  docs = join(dir, 'Documents');
  mkdirSync(docs);
  createStore(join(dir, 'P.sqlite'));
  store = new Store(join(dir, 'P.sqlite'), 'P');
  store.applyDesign([{ op: 'createTable', name: 'Items', fields: [{ name: 'Name', type: 'text' }] }]);
  store.create('Items', { Name: 'one' });
});
after(() => {
  store?.close();
  rmSync(dir, { recursive: true });
});

function script(text: string): Script {
  const steps = parseScriptText(text.trim().split('\n').map((l) => l.trim()).join('\n'), store.schema)
    .map((s) => ({ stepId: s.stepId!, name: s.name!, enabled: s.enabled !== false, params: s.params }));
  return { id: 9999, name: 'test', steps } as Script;
}
const result = async (formula: string, withDocuments = true) =>
  (await runScript(store, script(`Exit Script [ Text Result: ${formula} ]`), { layout: 'Items', documents: withDocuments ? docs : undefined })).result;

test('BE_FileWriteText and BE_FileReadText work in the documents folder', async () => {
  assert.equal(await result('BE_FileWriteText ( Get ( DocumentsPath ) & "notes.txt" ; "a¶b¶c" )'), '0');
  assert.equal(readFileSync(join(docs, 'notes.txt'), 'utf8'), 'a\rb\rc');
  assert.equal(await result('BE_FileWriteText ( "/Users/someone/Desktop/notes.txt" ; "¶d" ; 1 )'), '0');
  assert.equal(await result('BE_FileReadText ( Get ( DocumentsPath ) & "notes.txt" )'), 'a\rb\rc\rd');
  assert.equal(await result('BE_FileReadText ( "notes.txt" ; 2 ; 3 )'), '\rb');
  assert.equal(await result('BE_FileReadText ( "notes.txt" ; 0 ; 2 )'), '\rd');
  assert.equal(await result('BE_FileReadText ( "notes.txt" ; 2 ; 3 ; "¶" )'), 'b\rc\r');
  assert.equal(await result('BE_FileExists ( "notes.txt" ) & "/" & BE_FileSize ( "notes.txt" ) & "/" & BE_FileExists ( "nope.txt" )'), '1/7/0');
  // A run's temporary folder keeps subfolders, and is its own.
  assert.equal(await result('BE_FileWriteText ( Get ( TemporaryPath ) & "t.txt" ; "x" ) & BE_FileReadText ( Get ( TemporaryPath ) & "t.txt" )'), '0x');
});

test('plug-in file calls never leave the allowed folders', async () => {
  for (const p of ['".hidden"', 'Get ( DocumentsPath ) & "../x.txt"', 'Get ( DocumentsPath ) & "sub/x.txt"']) {
    assert.equal(await result(`BE_FileWriteText ( ${p} ; "no" ) & "/" & BE_GetLastError`), '/2', p);
  }
  // Any other path counts only by its file name, in the documents folder.
  assert.equal(await result('BE_FileWriteText ( "../escape.txt" ; "in" )'), '0');
  assert.equal(existsSync(join(dir, 'escape.txt')), false);
  assert.equal(readFileSync(join(docs, 'escape.txt'), 'utf8'), 'in');
  assert.equal(existsSync(join(dir, 'x.txt')), false);
  // /etc/passwd counts only by its file name: there is none in the documents folder.
  assert.equal(await result('BE_FileReadText ( "/etc/passwd" ) & "/" & BE_GetLastError'), '/2');
  // With no documents folder, nothing is read or written.
  writeFileSync(join(docs, 'here.txt'), 'here');
  assert.equal(await result('BE_FileReadText ( "here.txt" ) & "/" & BE_GetLastError', false), '/2');
});

test('network, mail, shell and clipboard plug-in calls are refused', async () => {
  for (const call of ['BE_HTTP_GET ( "https://example.com" )', 'BE_SMTP_Send ( "a" ; "b" ; "c" ; "d" )', 'BE_ExecuteSystemCommand ( "ls" )', 'BE_ClipboardGetText ( "public.utf8-plain-text" )', 'BE_OpenURL ( "https://example.com" )']) {
    assert.equal(await result(`${call} & "/" & BE_GetLastError`), '?/3', call);
  }
});

test('BE_RegularExpression matches, lists and replaces', async () => {
  assert.equal(await result('BE_RegularExpression ( "Order 12 and 345" ; "\\\\d+" )'), '12');
  assert.equal(await result('BE_RegularExpression ( "Order 12 and 345" ; "\\\\d+" ; "g" )'), '12\r345');
  assert.equal(await result('BE_RegularExpression ( "Order 12 and 345" ; "(\\\\d+)" ; "g" ; "#$1" )'), 'Order #12 and #345');
  assert.equal(await result('BE_RegularExpression ( "Order 12 and 345" ; "\\\\d+" ; "" ; "[$0]" )'), 'Order [12] and 345');
  assert.equal(await result('BE_RegularExpression ( "ABC" ; "b" ; "i" )'), 'B');
  assert.equal(await result('BE_RegularExpression ( "a1¶b¶c3" ; "\\\\d" ; "v" )'), '1\r3');
  assert.equal(await result('BE_RegularExpression ( "a b" ; "a  b # spaced" ; "x" )'), '');
  assert.equal(await result('BE_RegularExpression ( "ab" ; "a b # spaced" ; "x" )'), 'ab');
});

test('BE_Stack functions keep named stacks', async () => {
  assert.equal(await result('Let ( [ a = BE_StackPush ( "s" ; "1" ) ; b = BE_StackPush ( "s" ; "2" ) ] ; BE_StackCount ( "s" ) & BE_StackPop ( "s" ) & BE_StackCount ( "s" ) )'), '221');
});

test('plug-in state lasts one formula, as before steps shared a calculation context', async () => {
  const r = await runScript(store, script(`Set Variable [ $a ; Value: BE_FileReadText ( "nowhere/missing.txt" ) ]
Set Variable [ $push ; Value: BE_StackPush ( "s" ; "x" ) ]
Exit Script [ Text Result: BE_GetLastError & "/" & BE_StackCount ( "s" ) ]`), { layout: 'Items' });
  assert.equal(r.result, '0/0');
});

test('BaseElements folder tools work in the documents folder and nowhere else', async () => {
  const docsPath = 'Get ( DocumentsPath )';
  assert.equal(await result(`BE_FolderCreate ( ${docsPath} & "be/sub" )`), '0');
  assert.equal(await result(`BE_FileWriteText ( ${docsPath} & "be/a.txt" ; "Apple apple" )`), '0');
  assert.equal(await result(`BE_FileWriteText ( ${docsPath} & "be/sub/b.txt" ; "pear" )`), '0');
  assert.equal(await result(`BE_FileListFolder ( ${docsPath} & "be/" )`), 'a.txt');
  assert.equal(await result(`BE_FileListFolder ( ${docsPath} & "be" ; BE_FileTypeAll ; 1 )`), '/a.txt\r/sub\r/sub/b.txt');
  assert.equal(await result(`BE_FileListFolder ( ${docsPath} & "be/" ; BE_FileTypeFolder )`), 'sub');
  assert.equal(await result(`BE_FilePatternCount ( ${docsPath} & "be/a.txt¶" & ${docsPath} & "be/sub/b.txt" ; "apple¶PEAR¶fig" )`), '2\r1\r0');
  assert.equal(await result(`BE_FileCopy ( ${docsPath} & "be/a.txt" ; ${docsPath} & "be/c.txt" )`), '0');
  assert.equal(await result(`BE_FileCopy ( ${docsPath} & "be/a.txt" ; ${docsPath} & "be/c.txt" )`), '17');
  assert.equal(await result(`BE_FileMove ( ${docsPath} & "be/c.txt" ; ${docsPath} & "be/sub/c.txt" )`), '0');
  assert.ok(existsSync(join(docs, 'be', 'sub', 'c.txt')));
  assert.ok(Number(await result(`BE_FileModificationTimestamp ( ${docsPath} & "be/a.txt" )`)) > 63e9);
  assert.equal(await result(`BE_FileDelete ( ${docsPath} & "be" ) & BE_FileExists ( ${docsPath} & "be/a.txt" )`), '00');
  assert.equal(await result(`BE_FileDelete ( ${docsPath} & "be" ) & "," & BE_GetLastError`), '2,2');
  // Without a documents folder (or outside the allowed ones) nothing happens.
  assert.equal(await result('BE_FolderCreate ( "/tmp/x" )', false), '2');
  assert.equal(await result('BE_FileDelete ( "/etc/hosts" )'), '2');
});

test('BE_Zip and BE_Unzip work in the documents folder', async () => {
  const d = 'Get ( DocumentsPath )';
  await result(`BE_FolderCreate ( ${d} & "zip/pics/deep" ) & BE_FileWriteText ( ${d} & "zip/b.txt" ; "bee" ) & BE_FileWriteText ( ${d} & "zip/pics/deep/p.txt" ; "pic" )`);
  await result(`BE_FileWriteText ( ${d} & "zip/a.txt" ; "ay" ) & BE_FileWriteText ( ${d} & "zip/pics/.secret" ; "no" )`);
  // A folder goes in whole, under its own name; hidden files stay out.
  assert.equal(await result(`BE_Zip ( ${d} & "zip/b.txt¶" & ${d} & "zip/a.txt¶" & ${d} & "zip/pics" ; ${d} & "zip/out.zip" )`), '0');
  const listing = (await import('node:child_process')).execFileSync('unzip', ['-Z1', join(docs, 'zip', 'out.zip')], { encoding: 'utf8' });
  assert.deepEqual(listing.trim().split('\n'), ['a.txt', 'b.txt', 'pics/', 'pics/deep/', 'pics/deep/p.txt']);
  // By default the archive is the first file's path plus .zip; two files of the same name keep the last.
  assert.equal(await result(`BE_FileWriteText ( ${d} & "zip/pics/B.TXT" ; "big bee" ) & BE_Zip ( ${d} & "zip/b.txt¶" & ${d} & "zip/pics/B.TXT" )`), '012');
  assert.equal(await result(`BE_FileDelete ( ${d} & "zip/pics/B.TXT" )`), '0');
  assert.equal(await result(`BE_Zip ( ${d} & "zip/a.txt¶" & ${d} & "zip/nope.txt" ) & "/" & BE_GetLastError`), '2/2');
  assert.ok(existsSync(join(docs, 'zip', 'a.txt.zip')));
  assert.equal(await result(`BE_Zip ( ${d} & "zip/nope.txt" )`), '2');
  // Unzipping lists the files it wrote, into the archive's folder by default.
  const dp = await result(d);
  assert.equal(await result(`BE_FolderCreate ( ${d} & "unz" ) & BE_Unzip ( ${d} & "zip/out.zip" ; ${d} & "unz" )`),
    ['a.txt', 'b.txt', 'pics/deep/p.txt'].map((f) => `${dp}unz/${f}`).join('\r').replace(/^/, '0'));
  assert.equal(readFileSync(join(docs, 'unz', 'pics', 'deep', 'p.txt'), 'utf8'), 'pic');
  assert.equal(await result(`BE_Unzip_Deprecated ( ${d} & "zip/a.txt.zip" )`), '0');
  // Container data in, from another zip tool, and a container of a file zipped out.
  const made = 'UEsDBBQAAAAIAGCgTl1X7nGSBwAAAAUAAAAKAAAAaW4vb25lLnR4dEvLLCouAQBQSwMEFAAAAAgAYKBOXUIalToKAAAAEgAAAAcAAAB0d28udHh0K05Nzs9LKUYiAVBLAQIUAxQAAAAIAGCgTl1X7nGSBwAAAAUAAAAKAAAAAAAAAAAAAACAAQAAAABpbi9vbmUudHh0UEsBAhQDFAAAAAgAYKBOXUIalToKAAAAEgAAAAcAAAAAAAAAAAAAAIABLwAAAHR3by50eHRQSwUGAAAAAAIAAgBtAAAAXgAAAAAA';
  assert.equal(await result(`Let ( x = BE_Unzip ( Base64Decode ( "${made}" ; "m.zip" ) ; ${d} & "unz" ) ; Substitute ( x ; ${d} ; "" ) )`), 'unz/in/one.txt\runz/two.txt');
  assert.equal(readFileSync(join(docs, 'unz', 'two.txt'), 'utf8'), 'second'.repeat(3));
  assert.equal(await result(`BE_Zip ( TextEncode ( "hello" ; "utf-8" ; 1 ) ; ${d} & "t.zip" )`), '0');
  // Entries that would climb out of the folder are refused.
  const evil = 'UEsDBBQAAAAAAGCgTl2DFtyMAQAAAAEAAAALAAAALi4vZXZpbC50eHR4UEsBAhQDFAAAAAAAYKBOXYMW3IwBAAAAAQAAAAsAAAAAAAAAAAAAAIABAAAAAC4uL2V2aWwudHh0UEsFBgAAAAABAAEAOQAAACoAAAAAAA==';
  assert.equal(await result(`BE_Unzip ( Base64Decode ( "${evil}" ; "e.zip" ) ; ${d} & "unz" ) & "/" & BE_GetLastError`), '?/10200');
  assert.equal(existsSync(join(docs, 'evil.txt')), false);
});

test('BE_FileReplaceText rewrites a text file or container data', async () => {
  const d = 'Get ( DocumentsPath )';
  assert.equal(await result(`BE_FileWriteText ( ${d} & "r.txt" ; "Cat cat dog" ) & BE_FileReplaceText ( ${d} & "r.txt" ; "cat" ; "[$0]" )`), '0');
  assert.equal(readFileSync(join(docs, 'r.txt'), 'utf8'), '[Cat] [cat] dog');
  assert.equal(await result(`BE_FileReplaceText ( ${d} & "r.txt" ; "\\\\[(\\\\w+)\\\\]" ; "$1" ; "" )`), '');
  assert.equal(readFileSync(join(docs, 'r.txt'), 'utf8'), 'Cat [cat] dog');
  assert.equal(await result(`Base64Encode ( BE_FileReplaceText ( TextEncode ( "a-b-c" ; "utf-8" ; 1 ) ; "-" ; "+" ) )`), Buffer.from('a+b+c').toString('base64'));
  assert.equal(await result(`BE_FileReplaceText ( ${d} & "missing.txt" ; "a" ; "b" ) & "/" & BE_GetLastError`), '?/2');
});

test('BE_XSLT_Apply writes each stylesheet result to its file', async () => {
  const d = 'Get ( DocumentsPath )';
  const xslt = (tag: string) => `"<xsl:stylesheet version=\\"1.0\\" xmlns:xsl=\\"http://www.w3.org/1999/XSL/Transform\\"><xsl:output method=\\"text\\"/><xsl:template match=\\"/\\">${tag}:<xsl:value-of select=\\"count(//i)\\"/></xsl:template></xsl:stylesheet>"`;
  assert.equal(await result(`BE_FileWriteText ( ${d} & "in.xml" ; "<r><i/><i/></r>" )`), '0');
  assert.equal(await result(`BE_XSLT_Apply ( ${d} & "in.xml" ; ${xslt('one')} ; ${d} & "one.txt" ; "" ; "" ; ${xslt('two')} ; ${d} & "two.txt" )`), '');
  assert.equal(readFileSync(join(docs, 'one.txt'), 'utf8'), 'one:2');
  assert.equal(readFileSync(join(docs, 'two.txt'), 'utf8'), 'two:2');
  assert.equal(await result(`BE_XSLT_Apply ( ${d} & "none.xml" ; ${xslt('x')} ; ${d} & "x.txt" ) & "/" & BE_GetLastError`), '?/2');
});

test('MBS RegEx: an expression compiled in one step is there in the next, and in the session\'s next run', async () => {
  const session = new ScriptSession();
  const run = (text: string) => runScript(store, script(text), { layout: 'Items', session });
  const first = await run(`
    Set Variable [ $$regex ; Value: MBS ( "RegEx.Compile" ; "(\\\\d+)-(\\\\d+)" ; 0 ) ]
    Set Variable [ $n ; Value: MBS ( "RegEx.Execute" ; $$regex ; "call 555-1234 now" ; 0 ) ]
    Exit Script [ Text Result: $n & "/" & MBS ( "RegEx.Substring" ; $$regex ; 2 ) ]
  `);
  assert.equal(first.result, '3/1234');
  assert.equal((await run('Exit Script [ Text Result: MBS ( "RegEx.Pattern" ; $$regex ) ]')).result, '(\\d+)-(\\d+)');
  // A run in another session has none of them.
  const other = await runScript(store, script('Exit Script [ Text Result: MBS ( "RegEx.List" ) ]'), { layout: 'Items' });
  assert.equal(other.result, '');
});

test('BaseElements RSA key functions: keys, encryption and signatures round-trip', async () => {
  const r = await runScript(store, script(`Set Variable [ $key ; Value: BE_CreateKeyPair ]
Set Variable [ $pub ; Value: BE_GetPublicKey ( $key ) ]
Set Variable [ $enc ; Value: BE_EncryptWithKey ( "héllo" ; $pub ) ]
Set Variable [ $sig ; Value: Base64Encode ( BE_SignatureGenerateRSA ( "data" ; $key ) ) ]
Exit Script [ Text Result: Left ( $key ; 31 ) & "|" & Left ( $pub ; 30 ) & "|" & BE_DecryptWithKey ( $enc ; $key ) & "|" & BE_SignatureVerifyRSA ( "data" ; $pub ; $sig ) & BE_SignatureVerifyRSA ( "other" ; $pub ; $sig ) & BE_SignatureVerifyRSA ( "data" ; $pub ; $sig ; BE_MessageDigestAlgorithmSHA512 ) ]`), { layout: 'Items' });
  assert.equal(r.result, '-----BEGIN RSA PRIVATE KEY-----|-----BEGIN RSA PUBLIC KEY-----|héllo|100');
  assert.equal(await result('BE_EncryptWithKey ( "x" ; "not a key" ) & "/" & BE_GetLastError'), '?/-1');
  assert.equal(await result('BE_GetPublicKey ( "nope" ) & BE_DecryptWithKey ( "AAAA" ; "nope" )'), '??');
});

test('BE_XMLStripNodes writes a copy of an XML file without the named elements', async () => {
  writeFileSync(join(docs, 'in.xml'), '<?xml version="1.0"?>\n<a><b>1</b><c><b>2</b><d>keep</d></c><e:b xmlns:e="urn:e">3</e:b><f>stay</f></a>');
  assert.equal(await result('BE_XMLStripNodes ( "in.xml" ; "out.xml" ; "b c" ) & "/" & BE_GetLastError'), '/0');
  assert.equal(readFileSync(join(docs, 'out.xml'), 'utf8'), '<?xml version="1.0"?>\n<a><f>stay</f></a>');
  assert.equal(readFileSync(join(docs, 'in.xml'), 'utf8').includes('<b>1</b>'), true, 'the input is left alone');
  assert.equal(await result('BE_XMLStripNodes ( "missing.xml" ; "out.xml" ; "b" ) & "/" & BE_GetLastError'), '?/2');
  writeFileSync(join(docs, 'bad.xml'), '<a><b></a>');
  assert.equal(await result('BE_XMLStripNodes ( "bad.xml" ; "out.xml" ; "b" )'), '?');
});

test('BE_SMTPSetHeader gives ? where mail is not sent', async () => {
  assert.equal(await result('BE_SMTPSetHeader ( "X-Priority" ; "1" ) & "/" & BE_GetLastError'), '?/3');
});
