// FileMaker's Japanese text functions: Hiragana, Katakana, KanaHankaku and KanaZenkaku convert between
// hiragana, full-width (zenkaku) katakana and half-width (hankaku) katakana. A half-width letter followed by its
// half-width voiced mark (ﾞ or ﾟ) becomes the one full-width letter, and back.

// Half-width forms U+FF61 to U+FF9F, in order, as their full-width equivalents.
const HANKAKU = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ';
const ZENKAKU = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜';
const VOICED = 'ﾞ';
const SEMI = 'ﾟ';

const toZenkaku = new Map<string, string>();
const toHankaku = new Map<string, string>();
for (let i = 0; i < HANKAKU.length; i++) {
  toZenkaku.set(HANKAKU[i], ZENKAKU[i]);
  // Only the katakana themselves (and the long-vowel and voiced marks) go back to half width; full-width
  // punctuation is left as it is.
  if (i >= 5) toHankaku.set(ZENKAKU[i], HANKAKU[i]);
}
toHankaku.set('・', '･');
// Voiced (ガ) and semi-voiced (パ) letters: the base letter's code point plus one or two; ヴ is ウ's.
for (const base of 'カキクケコサシスセソタチツテトハヒフヘホ') {
  const half = HANKAKU[ZENKAKU.indexOf(base)];
  toZenkaku.set(half + VOICED, String.fromCharCode(base.charCodeAt(0) + 1));
  toHankaku.set(String.fromCharCode(base.charCodeAt(0) + 1), half + VOICED);
}
for (const base of 'ハヒフヘホ') {
  const half = HANKAKU[ZENKAKU.indexOf(base)];
  toZenkaku.set(half + SEMI, String.fromCharCode(base.charCodeAt(0) + 2));
  toHankaku.set(String.fromCharCode(base.charCodeAt(0) + 2), half + SEMI);
}
toZenkaku.set('ｳ' + VOICED, 'ヴ');
toHankaku.set('ヴ', 'ｳ' + VOICED);

export function kanaZenkaku(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const pair = toZenkaku.get(s.slice(i, i + 2));
    if (pair && s.length > i + 1) {
      out += pair;
      i++;
    } else {
      out += toZenkaku.get(s[i]) ?? s[i];
    }
  }
  return out;
}

export function kanaHankaku(s: string): string {
  return s.replace(/[゙-゜ァ-ー]/g, (c) => toHankaku.get(c) ?? c);
}

/** Hiragana: katakana of either width become hiragana (ヷ to ヺ have none and stay). */
export function hiragana(s: string): string {
  return kanaZenkaku(s).replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Katakana: hiragana become full-width katakana. */
export function katakana(s: string): string {
  return s.replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** KanjiNumeral: each arabic digit, half or full width, as its kanji numeral. */
export function kanjiNumeral(s: string): string {
  return s.replace(/[0-9０-９]/g, (d) => '〇一二三四五六七八九'[(d.charCodeAt(0) - (d >= '０' ? 0xff10 : 0x30))]);
}

export const DAYS_J = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

/**
 * RomanHankaku: full-width (zenkaku) letters, digits and symbols (U+FF01 to U+FF5E) and the ideographic space become
 * their ordinary ASCII forms. Claris's page says only "alphanumeric and symbols", so the other full-width signs
 * (the yen sign U+FFE5 and the like) are left as they are.
 */
export function romanHankaku(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
}

/** RomanZenkaku: the reverse of romanHankaku, for the ASCII letters, digits, symbols and the space. */
export function romanZenkaku(s: string): string {
  return s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '　');
}
