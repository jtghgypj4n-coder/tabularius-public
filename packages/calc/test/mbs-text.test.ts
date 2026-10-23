// MBS ( "Text.…" ) against the examples on MBS's own function pages (mbsplugins.eu), plus the edge cases
// those pages state in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';
import { MBS_TEXT } from '../src/mbs-text.ts';

const c: CalcContext = {};
/** A FileMaker text literal: quotes and backslashes escaped, a CR written as ¶ and a literal pilcrow as \¶. */
const q = (s: string) => '"' + s.replace(/[\\"¶]/g, (x) => '\\' + x).replace(/\r/g, '¶') + '"';
const mbs = (name: string, ...args: (string | number)[]) =>
  evaluateText(`MBS ( ${[q(name), ...args.map((a) => (typeof a === 'number' ? String(a) : q(a)))].join(' ; ')} )`, c);
const isError = () => evaluateText('MBS ( "IsError" )', c);

test('MBS Text: case, trimming and characters, as the pages show', () => {
  assert.equal(mbs('Text.CapitalCase', 'HAMBurg'), 'Hamburg');
  assert.equal(mbs('Text.CapitalCase', 'SCHLESWIG-HOLSTEIN'), 'Schleswig-Holstein');
  assert.equal(mbs('Text.LowerCase', 'ÄÖÜÉÁÓÚÍÂÊÎÔÛ'), 'äöüéáóúíâêîôû');
  assert.equal(mbs('Text.UpperCase', 'HAMBurg'), 'HAMBURG');
  assert.equal(mbs('Text.Trim', ' \r Hello \r '), 'Hello');
  assert.equal(mbs('Text.Trim', ' 🍎 🍓 🍒 '), '🍎 🍓 🍒');
  // Tab, CR, LF, space, alt-space and delete go; a zero-width space doesn't (the page's own Substitute removes those).
  assert.equal(mbs('Text.Trim', '\t \u007fx​'), 'x​');
  assert.equal(mbs('Text.LeftTrim', ' \r Hello \r '), 'Hello \r ');
  assert.equal(mbs('Text.RightTrim', ' \r Hello \r '), ' \r Hello');
  assert.equal(mbs('Text.Character', 128512), '😀');
  assert.equal(mbs('Text.Character', 127397 + 68) + mbs('Text.Character', 127397 + 69), '🇩🇪');
  assert.equal(mbs('Text.Characters', 'Hello'), '72 101 108 108 111');
  assert.equal(mbs('Text.Characters', '🍎'), '127822');
  assert.equal(mbs('Text.Code', '😀'), '128512');
  assert.equal(mbs('Text.Length', '🍎'), '2');
  assert.equal(mbs('Text.Reverse', 'Hello World 🥂🎁🎂🍹'), '🍹🎂🎁🥂 dlroW olleH');
  assert.equal(evaluateText('MBS ( "Text.Characters" ; MBS ( "Text.ConvertUnicodeToCharacterComposition" ; Char ( 97 ) & Char ( 776 ) ) )', c), '228');
  assert.equal(evaluateText('MBS ( "Text.Characters" ; MBS ( "Text.ConvertUnicodeToCharacterDecomposition" ; Char ( 228 ) ) )', c), '97 776');
  assert.equal(mbs('Text.Length', mbs('Text.ConvertUnicodeToCharacterDecomposition', 'tränenüberströmt')), '19');
  // Function names are matched in any case (the pages themselves write "Text.ReplaceNewline").
  assert.equal(mbs('text.UPPERCASE', 'a'), 'A');
});

test('MBS Text: lists, words, joining and splitting', () => {
  assert.equal(mbs('Text.Concat', 'apple', '', 'banana'), 'applebanana');
  assert.equal(mbs('Text.ConcatWithDelimiter', ' - ', 'Vorname', '', 'Nachname', ''), 'Vorname - Nachname');
  assert.equal(mbs('Text.List', 'apple', '', 'banana'), 'apple\r\rbanana');
  assert.equal(mbs('Text.ListWords', 'Hello World,äöü.'), 'Hello\rWorld\räöü');
  const counts = mbs('Text.CountWords', 'ä ö ü ä ö ö ö ö ß ß').split('\r').sort();
  assert.deepEqual(counts, ['1\tü', '2\tß', '2\tä', '5\tö'].sort());
  assert.equal(mbs('Text.SplitByLength', 'Hello World', 3), 'Hel\rlo \rWor\rld');
  assert.equal(mbs('Text.SplitByLength', 'Hi'), 'H\ri');
  assert.equal(mbs('Text.FindBetween', '<1><2><3>', '<', '>', 0, 1), '2');
  assert.equal(mbs('Text.FindBetween', '🍎🍓🍒', '🍎', '🍒'), '🍓');
  assert.equal(mbs('Text.FindBetween', '<X>a</X>', '<x>', '</x>', 1), 'a');
  assert.equal(mbs('Text.FindBetween', '<X>a</X>', '<x>', '</x>'), '');
  assert.equal(mbs('Text.ReplaceAll', 'Hello', 'e', 'a'), 'Hallo');
  assert.equal(mbs('Text.ReplaceAll', '🍎🍓🍒', '🍓', '🍌'), '🍎🍌🍒');
  assert.equal(mbs('Text.ReplaceAll', 'Hello', '', 'a'), 'Hello');
  assert.equal(mbs('Text.RemovePrefix', '>Hello World', '>'), 'Hello World');
  assert.equal(mbs('Text.RemovePrefix', 'HELLO world', 'hello '), 'world');
  assert.equal(mbs('Text.RemovePrefix', 'HELLO world', 'hello ', 1), 'HELLO world');
  assert.equal(mbs('Text.RemovePostfix', 'Hello World>', '>'), 'Hello World');
  assert.equal(mbs('Text.RemovePostfix', '🍎🍓🍒', '🍒'), '🍎🍓');
});

test('MBS Text: new lines and control characters', () => {
  // Mixed line endings can't be written in a FileMaker text literal, so these call the function itself.
  const text = 'a\r\nb\rc\nd';
  const replace = (mode: number) => MBS_TEXT['text.replacenewline']([text, String(mode)]);
  assert.equal(replace(0), 'abcd');
  assert.equal(replace(1), 'a\rb\rc\rd');
  assert.equal(replace(2), 'a\nb\nc\nd');
  assert.equal(replace(3), 'a\r\nb\r\nc\r\nd');
  assert.equal(replace(4), 'a<br>b<br>c<br>d');
  // Text after a NULL is dropped, as the page says.
  assert.equal(MBS_TEXT['text.replacenewline'](['a\u0000b', '1']), 'a');
  assert.equal(mbs('Text.ReplaceNewLine', 'a\r\r\rb', 5 + 8), 'a<br />b');
  assert.equal(mbs('Text.ReplaceNewLine', 'one two three', 1, 7), 'one two\rthree');
  assert.equal(MBS_TEXT['text.removenewline']([text]), 'abcd');
  assert.equal(evaluateText('Length ( MBS ( "Text.RemoveControlCharacters" ; "Hello" & Char ( 3 ) & "World" ) )', c), '10');
  assert.equal(evaluateText('Length ( MBS ( "Text.RemoveControlCharacters" ; "Hello" & Char ( 65279 ) ) )', c), '5');
  assert.equal(mbs('Text.RemoveControlCharacters', 'a\tb\rc'), 'a\tb\rc');
});

test('MBS Text: base64, hex, URL and quoted-printable, in the encoding asked for', () => {
  assert.equal(mbs('Text.DecodeFromBase64', 'R3LDvMOfIEdvdHQuIFRlc3Qg4pi6', 'utf8'), 'Grüß Gott. Test ☺');
  assert.equal(mbs('Text.EncodeToBase64', 'Hello World', 'utf8'), 'SGVsbG8gV29ybGQ=');
  assert.equal(mbs('Text.EncodeToBase64URL', 'Hello World', 'utf8'), 'SGVsbG8gV29ybGQ');
  assert.equal(mbs('Text.DecodeFromBase64URL', 'SGVsbG8gV29ybGQ', 'UTF-8'), 'Hello World');
  assert.equal(mbs('Text.DecodeFromBase64', 'SGVsbG8gV29ybGQ', 'base64'), 'SGVsbG8gV29ybGQ=');
  assert.equal(mbs('Text.EncodeToHex', 'Hello World', 'utf8'), '48656C6C6F20576F726C64');
  assert.equal(mbs('Text.EncodeToHex', '🍎 🍓 🍒', 'UTF-8'), 'F09F8D8E20F09F8D9320F09F8D92');
  assert.equal(mbs('Text.DecodeFromHex', 'F09F8D8E20F09F8D9320F09F8D92', 'UTF-8'), '🍎 🍓 🍒');
  // Mac Roman bytes read as UTF-8: the page's own round trip.
  assert.equal(evaluateText('MBS ( "Text.DecodeFromHex" ; MBS ( "Text.EncodeToHex" ; "<string>Eine M√∂bel</string>" ; "Mac" ) ; "UTF-8" )', c), '<string>Eine Möbel</string>');
  assert.equal(mbs('Text.EncodeToHex', 'é', 'Windows'), 'E9');
  assert.equal(mbs('Text.EncodeToHex', 'é', 'Latin1'), 'E9');
  assert.equal(mbs('Text.EncodeToHex', 'A', 'UTF-16BE'), '0041');
  assert.equal(mbs('Text.EncodeToHex', 'A', 'UTF-16'), '4100');
  assert.equal(mbs('Text.EncodeToURL', 'Hello World', 'utf8'), 'Hello+World');
  assert.equal(mbs('Text.EncodeToURL', 'Hello öäü', 'utf8'), 'Hello+%C3%B6%C3%A4%C3%BC');
  assert.equal(mbs('Text.DecodeFromURL', 'Hello+%C3%B6%C3%A4%C3%BC', 'utf8'), 'Hello öäü');
  assert.equal(mbs('Text.DecodeFromURL', '%F0%9F%8D%8E+%F0%9F%8D%93+%F0%9F%8D%92', 'UTF-8'), '🍎 🍓 🍒');
  assert.equal(mbs('Text.EncodeURLComponent', 'http://www.mbsplugins.de'), 'http%3A%2F%2Fwww%2Embsplugins%2Ede');
  assert.equal(mbs('Text.EncodeURLComponent', 'é', 'Windows'), '%E9');
  assert.equal(mbs('Text.EncodeURLComponent', 'é', 'Mac'), '%8E');
  assert.equal(evaluateText('MBS ( "Text.EncodeURLComponent" ; MBS ( "Text.ConvertUnicodeToCharacterDecomposition" ; "é" ) ; "UTF-8" )', c), 'e%CC%81');
  assert.equal(mbs('Text.EncodeURLComponent', '🍎 🍓 🍒', 'UTF-8'), '%F0%9F%8D%8E%20%F0%9F%8D%93%20%F0%9F%8D%92');
  assert.equal(mbs('Text.DecodeURLComponent', 'http%3A%2F%2Fwww%2Embsplugins%2Ede'), 'http://www.mbsplugins.de');
  assert.equal(mbs('Text.DecodeURLComponent', '%F0%9F%8D%8E%20%F0%9F%8D%93%20%F0%9F%8D%92', 'UTF-8'), '🍎 🍓 🍒');
  assert.equal(mbs('Text.EncodeToQuotedPrintable', 'Wünsche', 'UTF8'), 'W=C3=BCnsche');
  assert.equal(mbs('Text.DecodeFromQuotedPrintable', 'W=C3=BCnsche', 'UTF8'), 'Wünsche');
  // Lines are kept to the line length with soft breaks, which decoding removes.
  const long = 'x'.repeat(100);
  const qp = String(MBS_TEXT['text.encodetoquotedprintable']([long, 'UTF-8', '40']));
  assert.ok(qp.split('=\r\n').every((l) => l.length <= 39), qp);
  assert.equal(MBS_TEXT['text.decodefromquotedprintable']([qp, 'UTF-8']), long);
  assert.equal(mbs('Text.EncodeEmailSubject', 'Hello World'), 'Hello World');
  assert.equal(mbs('Text.EncodeEmailSubject', 'Hello äöü'), '=?UTF-8?Q?Hello_=C3=A4=C3=B6=C3=BC?=');
  assert.equal(mbs('Text.EncodeEmailSubject', '🍎 🍓 🍒'), '=?UTF-8?Q?=F0=9F=8D=8E_=F0=9F=8D=93_=F0=9F=8D=92?=');
  assert.equal(mbs('Text.DecodeIMAPFolderName', 'Entw&APw-rfe'), 'Entwürfe');
  assert.equal(mbs('Text.DecodeIMAPFolder', 'Test&AOk-&-'), 'Testé&');
  assert.equal(mbs('Text.DecodeIMAPFolderName', '~peter/mail/&ZeVnLIqe-/&U,BTFw-'), '~peter/mail/日本語/台北');
});

test('MBS Text: an encoding MBS has but Tabularius does not, or one that does not exist, is an MBS error', () => {
  assert.match(mbs('Text.EncodeToHex', 'x', 'DOS'), /^\[MBS\] ERROR: Unknown text encoding "DOS"/);
  assert.equal(isError(), '1');
  assert.match(mbs('Text.EncodeToHex', 'x', 'Klingon'), /^\[MBS\] ERROR/);
  assert.match(mbs('Text.DecodeFromHex', 'XYZ', 'UTF-8'), /^\[MBS\] ERROR: Invalid hex/);
  assert.match(mbs('Text.Character', -1), /^\[MBS\] ERROR/);
  assert.equal(mbs('Text.Trim', ' ok '), 'ok');
  assert.equal(isError(), '0');
});

test('MBS Text: HTML and XML', () => {
  assert.equal(mbs('Text.EncodeToHTML', 'Grüße'), 'Gr&uuml;&szlig;e');
  assert.equal(mbs('Text.EncodeToHTML', '😀😁'), '&#128512;&#128513;');
  assert.equal(mbs('Text.EncodeToHTML', 'ä', 1), '&#228;');
  assert.equal(mbs('Text.EncodeToHTML', 'ä', 2), '&#xe4;');
  assert.equal(mbs('Text.EncodeToHTML', 'Hello World ä', 8), '&#72;&#101;&#108;&#108;&#111;&#32;&#87;&#111;&#114;&#108;&#100;&#32;&auml;');
  assert.equal(mbs('Text.EncodeToHTML', 'Hello World ä', 8 + 2), '&#x48;&#x65;&#x6c;&#x6c;&#x6f;&#x20;&#x57;&#x6f;&#x72;&#x6c;&#x64;&#x20;&#xe4;');
  assert.equal(mbs('Text.EncodeToHTML', 'a<b & "c"'), 'a&lt;b &amp; &quot;c&quot;');
  assert.equal(mbs('Text.DecodeFromHTML', 'Gr&uuml;&szlig;e'), 'Grüße');
  assert.equal(mbs('Text.DecodeFromHTML', '<test>&auml;&amp;&lt;</test>', 1), '<test>ä&amp;&lt;</test>');
  assert.equal(mbs('Text.DecodeFromHTML', '&#128512;&#x1F600;&euro;&nosuch;'), '😀😀€&nosuch;');
  assert.equal(mbs('Text.EncodeToXML', 'Grüße <test>'), 'Grüße &lt;test&gt;');
  assert.equal(mbs('Text.DecodeFromXML', 'test &lt; this'), 'test < this');
  assert.equal(mbs('Text.DecodeFromXML', '&auml;'), '&auml;');
});

test('MBS Text: accents, ASCII, distances, sound and file types', () => {
  assert.equal(mbs('Text.RemoveAccents', 'Müller'), 'Muller');
  assert.equal(mbs('Text.RemoveAccents', '한글'), '한글');
  assert.equal(mbs('Text.RemoveAccents', 'がぱ'), 'がぱ');
  assert.equal(mbs('Text.FilterASCII', '한글a', '?'), '??a');
  assert.equal(mbs('Text.RemoveAccents', 'café'), 'cafe');
  assert.equal(mbs('Text.RemoveAccents', 'Łužica'), 'Luzica');
  const input = '` ‘ ’ • \\¶ ¨ À Á Â Ã Ä Å Æ Ç È É Ê Ë Ì Í Î Ï Ð Ñ Ò Ó Ô Õ Ö Ø Ù Ú Û Ü Ý Þ ß à á â ã ä å æ ç è é ê ë ì í î ï ð ñ ò ó ô õ ö ø ù ú û ü ý þ ÿ ¼ ½ ¾ ⅓ ⅔ ⅕ ⅖ ⅗ ⅘ ⅙ ⅚ ⅐ ⅛ ⅜ ⅝ ⅞ ⅑ ⅒ ↉';
  assert.equal(evaluateText(`MBS ( "Text.RemoveAccents" ; "${input}" )`, c),
    "` ' ' * ¶ ¨ A A A A A A AE C E E E E I I I I D N O O O O O O U U U U Y P s a a a a a a ae c e e e e i i i i d n o o o o o o u u u u y p y 1/4 1/2 3/4 1/3 2/3 1/5 2/5 3/5 4/5 1/6 5/6 1/7 1/8 3/8 5/8 7/8 1/9 1/10 0/3");
  assert.equal(mbs('Text.RemoveAccentsCaseInsensitive', 'Müller'), 'MULLER');
  assert.equal(mbs('Text.FilterASCII', 'Test 🍎 🍓 🍒', '?'), 'Test ?? ?? ??');
  assert.equal(mbs('Text.FilterASCII', 'Wörld ‘x’ ½ ¶'), "World 'x' 1/2 ");
  assert.ok(Math.abs(Number(mbs('Text.JaroWinklerDistance', 'Hello', 'Hallo')) - 0.12) < 0.001);
  assert.equal(mbs('Text.JaroWinklerDistance', 'same', 'same'), '0');
  assert.equal(mbs('Text.LevenshteinDistance', 'Hello', 'Hallo'), '0.2');
  assert.throws(() => MBS_TEXT['text.levenshteindistance'](['x'.repeat(6000), 'y'.repeat(6000)]), /too long/);
  // The Mayers sound alike, as the page says; Robert and Rupert are Soundex's own example.
  assert.deepEqual(['Mayer', 'Maier', 'Meyer', 'Meier'].map((n) => mbs('Text.SoundEx', n)), ['M600', 'M600', 'M600', 'M600']);
  assert.equal(mbs('Text.SoundEx', 'Robert'), 'R163');
  assert.equal(mbs('Text.SoundEx', 'Rupert'), 'R163');
  assert.equal(mbs('Text.SoundEx', 'Ashcraft'), 'A261');
  assert.equal(mbs('Text.SoundEx', 'Müller'), 'M460');
  assert.equal(mbs('Text.FileExtensionToMimeType', 'pdf'), 'application/pdf');
  assert.equal(mbs('Text.FileExtensionToMimeType', 'my.test.pdf'), 'application/pdf');
  assert.equal(mbs('Text.MimeTypeToFileExtension', 'application/pdf'), '.pdf');
  assert.equal(mbs('Text.MimeTypeToFileExtension', 'image/jpeg'), '.jpg');
  assert.match(mbs('Text.FileExtensionToMimeType', 'nosuchext'), /^\[MBS\] ERROR/);
});

test('MBS Text: odd bytes, long texts and characters past U+FFFF decode without failing the calculation', () => {
  const t = (name: string, ...args: string[]) => MBS_TEXT[name.toLowerCase()](args);
  // A stray last byte of UTF-16 is dropped rather than throwing.
  assert.equal(t('Text.DecodeFromBase64', 'QQ==', 'UTF-16BE'), '');
  assert.equal(t('Text.DecodeFromBase64', 'AEEA', 'UTF-16BE'), 'A');
  assert.equal(t('Text.DecodeIMAPFolderName', 'x&AG-'), 'x');
  // A long Latin-1 text.
  const long = 'é'.repeat(300_000);
  assert.equal(t('Text.DecodeFromBase64', Buffer.from(long, 'latin1').toString('base64'), 'Latin1'), long);
  // An emoji written as itself in quoted-printable or URL text stays whole.
  assert.equal(t('Text.DecodeFromQuotedPrintable', 'W=C3=BCnsche 😀', 'UTF-8'), 'Wünsche 😀');
  assert.equal(t('Text.DecodeFromURL', '😀+%C3%A4', 'UTF-8'), '😀 ä');
  assert.equal(t('Text.DecodeURLComponent', '😀%20x'), '😀 x');
});

test('MBS Text: distances and FindBetween stay bounded, and ignoring case keeps positions', () => {
  const t = (name: string, ...args: string[]) => MBS_TEXT[name.toLowerCase()](args);
  assert.throws(() => t('Text.JaroWinklerDistance', 'a'.repeat(10_000), 'b'.repeat(10_000)), /too long/);
  // One short text against a long one: the work is small, so it's allowed.
  assert.equal(t('Text.LevenshteinDistance', 'a', 'a' + 'b'.repeat(1_000_000)), 1_000_000);
  assert.equal(t('Text.LevenshteinDistance', 'Hello', 'Hallo'), 0.2);
  // Empty tags don't repeat the same place NthItem times.
  assert.equal(t('Text.FindBetween', 'abc', '', '', '0', '1e12'), '');
  // "İ" is two characters in lower case; positions still match the original text.
  assert.equal(t('Text.FindBetween', 'İx[abc]', '[', ']', '1'), 'abc');
  assert.equal(t('Text.RemovePrefix', 'Xabc', 'x', '0'), 'abc');
  assert.equal(t('Text.RemovePrefix', 'İabc', 'İ', '0'), 'abc');
});
