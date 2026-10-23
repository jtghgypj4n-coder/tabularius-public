import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareKeys, foldText, isSortLanguageName, recordSortLanguage, SORT_LANGUAGE_IDS, SORT_LANGUAGES, sortFunction, sortKey, sortLanguage } from '../src/collation.ts';

test('foldText maps Greek final sigma, capital sharp s and the remaining common ligatures', () => {
  assert.equal(foldText('ΟΔΟΣ'), foldText('οδος'));
  assert.equal(foldText('STRAẞE'), foldText('straße'));
  assert.equal(foldText('ﬃ'), foldText('ffi'));
});

test('compareKeys follows code point order for astral keys, equality and prefixes', () => {
  assert.ok(compareKeys(sortKey('한'), sortKey('Ａ')) < 0);
  assert.equal(compareKeys('same', 'same'), 0);
  assert.ok(compareKeys('abc', 'abcd') < 0);
});

test('sort keys: case and accents ignored, punctuation before digits before letters', () => {
  const words = ['zebra', 'Apple', 'apple pie', 'apple', 'Ápfel', '10 Downing', '#1', 'banana', 'Straße', 'strasse', 'Zürich', 'Ærø', 'aesop'];
  const sorted = [...words].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  assert.deepEqual(sorted, ['#1', '10 Downing', 'Ærø', 'aesop', 'Ápfel', 'Apple', 'apple', 'apple pie', 'banana', 'Straße', 'strasse', 'zebra', 'Zürich']);
  assert.equal(sortKey('Café'), sortKey('cafe'));
  assert.ok(sortKey('a\rb') < sortKey('a b'));
});

test('Japanese ICU approximation: kana and the sampled kanji order', () => {
  const ja = (a: string, b: string) => (sortKey(a, 'ja') < sortKey(b, 'ja') ? -1 : sortKey(a, 'ja') > sortKey(b, 'ja') ? 1 : 0);
  assert.deepEqual(['ん', 'かき', 'あいう', '処方', '自費', 'abc'].sort(ja), ['abc', 'あいう', 'かき', 'ん', '自費', '処方']);
  assert.equal(sortKey('アイウ', 'ja'), sortKey('あいう', 'ja'));
  assert.equal(sortKey('ｶｷ', 'ja'), sortKey('カキ', 'ja'));
  // A previously compared Japanese index holds 自費 before 処方 (code points put 処 first).
  assert.ok(sortKey('自費', 'ja') < sortKey('処方', 'ja'));
  assert.ok(sortKey('処方') < sortKey('自費'));
});

test('unmapped FileMaker language ids do not silently use English collation', () => {
  assert.throws(() => recordSortLanguage(undefined, 999), /language ID 999 is not mapped/);
});

test('every language Claris Pro Help names has an order, found by its name without regard to case', () => {
  assert.equal(SORT_LANGUAGES.length, 55);
  assert.equal(sortLanguage('Swedish_Custom'), 'sv');
  assert.equal(sortLanguage('swedish'), 'sv_trad');
  assert.equal(sortLanguage('GERMAN_DICTIONARY'), 'de');
  assert.equal(sortLanguage(undefined), 'en');
  assert.equal(sortLanguage(''), 'en');
  assert.equal(sortLanguage('Klingon'), 'en');
  assert.equal(isSortLanguageName('Klingon'), false);
  assert.equal(isSortLanguageName(' korean '), true);
  // Every order has its SQL function, and the ones the store has always had keep their names.
  assert.equal(sortFunction('en'), 'fm_sort_key');
  assert.equal(sortFunction('ja'), 'fm_sort_key_ja');
  assert.ok(new Set(SORT_LANGUAGE_IDS).size === SORT_LANGUAGE_IDS.length);
  for (const l of SORT_LANGUAGES) assert.ok(SORT_LANGUAGE_IDS.includes(sortLanguage(l.name)), l.name);
});

test('Unicode, Default, Catalog and English keep the English order Tabularius has always used', () => {
  const words = ['zebra', 'Ärlig', 'apple', 'Banana', 'Åre', 'cafe', 'café', 'Ærø', 'Zoo', '10 Downing', '#1'];
  for (const name of ['Unicode_Raw', 'Unicode_Standard', 'Catalog', 'English']) {
    for (const w of words) assert.equal(sortKey(w, sortLanguage(name)), sortKey(w), `${name}: ${w}`);
  }
});

test('other languages keep apart the letters they count as their own', () => {
  const order = (name: string, words: string[]) => [...words].sort((a, b) => (sortKey(a, name) < sortKey(b, name) ? -1 : sortKey(a, name) > sortKey(b, name) ? 1 : 0));
  assert.deepEqual(order('Swedish_Custom', ['öl', 'zebra', 'åre', 'ärlig', 'apple']), ['apple', 'zebra', 'åre', 'ärlig', 'öl']);
  assert.deepEqual(order('Danish', ['åre', 'øl', 'ærø', 'zebra']), ['zebra', 'ærø', 'øl', 'åre']);
  assert.deepEqual(order('Polish', ['zebra', 'łódź', 'lato', 'mama']), ['lato', 'łódź', 'mama', 'zebra']);
  assert.deepEqual(order('Spanish', ['ñu', 'oa', 'nz']), ['nz', 'ñu', 'oa']);
  assert.deepEqual(order('Turkish', ['ı', 'i', 'z', 'ç', 'c']), ['c', 'ç', 'ı', 'i', 'z']);
  assert.deepEqual(order('Russian', ['яблоко', 'арбуз', 'ёж', 'берег']), ['арбуз', 'берег', 'ёж', 'яблоко']);
  // The accents a language counts as the same letter still do not matter.
  assert.equal(sortKey('Café', 'French'), sortKey('cafe', 'French'));
  assert.notEqual(sortKey('år', 'Swedish_Custom'), sortKey('ar', 'Swedish_Custom'));
  // German: ü sorts as ue in one setting and as u in the other.
  assert.equal(sortKey('Müller', 'German'), sortKey('Mueller', 'German'));
  assert.equal(sortKey('Müller', 'German_Dictionary'), sortKey('Muller', 'German_Dictionary'));
  // Chinese: by pinyin or by strokes.
  assert.deepEqual(order('Chinese', ['中', '一', '大']), ['大', '一', '中']);
  assert.deepEqual(order('Chinese_Stroke', ['中', '一', '大']), ['一', '大', '中']);
});

test('text written with combining marks has the key of the same text written with one character', () => {
  for (const language of ['English', 'French', 'Swedish_Custom', 'Polish']) {
    assert.equal(sortKey('cafe\u0301', language), sortKey('caf\u00e9', language), language);
    assert.equal(sortKey('A\u030a', language), sortKey('\u00c5', language), language);
  }
  // Å is a letter of its own in Swedish, whichever way it is written.
  assert.notEqual(sortKey('A\u030a', 'Swedish_Custom'), sortKey('A', 'Swedish_Custom'));
});
