import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText } from '../src/index.ts';

const t = (f: string) => evaluateText(f);
const HALF = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｬｭｮｯｰｶﾞｷﾞｸﾞｹﾞｺﾞｻﾞｼﾞｽﾞｾﾞｿﾞﾀﾞﾁﾞﾂﾞﾃﾞﾄﾞﾊﾞﾋﾞﾌﾞﾍﾞﾎﾞﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟｳﾞ';

test('KanaZenkaku and KanaHankaku convert katakana between widths, voiced marks included', () => {
  // Unicode's compatibility mapping (NFKC) gives the same full-width letters.
  assert.equal(t(`KanaZenkaku ( "${HALF}" )`), HALF.normalize('NFKC'));
  assert.equal(t(`KanaHankaku ( KanaZenkaku ( "${HALF}" ) )`), HALF);
  assert.equal(t('KanaZenkaku ( "ｶﾞｲﾄﾞ｡ abc" )'), 'ガイド。 abc');
  assert.equal(t('KanaHankaku ( "パソコン・データ" )'), 'ﾊﾟｿｺﾝ･ﾃﾞｰﾀ');
  // Hiragana and full-width punctuation are left alone.
  assert.equal(t('KanaHankaku ( "ひらがな、。" )'), 'ひらがな、。');
});

test('Hiragana takes katakana of either width; Katakana gives full-width katakana', () => {
  assert.equal(t('Hiragana ( "カタカナ ｶﾀｶﾅ ﾊﾟﾝ" )'), 'かたかな かたかな ぱん');
  assert.equal(t('Katakana ( "ひらがな ぱん" )'), 'ヒラガナ パン');
  assert.equal(t('Katakana ( Hiragana ( "ヴァイオリン" ) )'), 'ヴァイオリン');
});

test('KanjiNumeral writes each digit as a kanji numeral', () => {
  assert.equal(t('KanjiNumeral ( 123 )'), '一二三');
  assert.equal(t('KanjiNumeral ( "2026年10月１４日" )'), '二〇二六年一〇月一四日');
});

test('DayNameJ and MonthNameJ', () => {
  // January 1, 2021 was a Friday.
  assert.equal(t('DayNameJ ( Date ( 1 ; 1 ; 2021 ) )'), '金曜日');
  assert.equal(t('MonthNameJ ( Date ( 6 ; 6 ; 2019 ) )'), '6月');
});

test('RomanHankaku and RomanZenkaku swap full-width and ordinary letters, digits, symbols and spaces', () => {
  assert.equal(evaluateText('RomanHankaku ( "Ｍａｃｉｎｔｏｓｈ　１２３！" )'), 'Macintosh 123!');
  assert.equal(evaluateText('RomanZenkaku ( "Macintosh 123!" )'), 'Ｍａｃｉｎｔｏｓｈ　１２３！');
  // Kana and kanji are left alone.
  assert.equal(evaluateText('RomanHankaku ( "あＡ漢" )'), 'あA漢');
  assert.equal(evaluateText('RomanZenkaku ( "あA漢" )'), 'あＡ漢');
  assert.equal(evaluateText('RomanHankaku ( RomanZenkaku ( "A~z 0-9" ) )'), 'A~z 0-9');
});
