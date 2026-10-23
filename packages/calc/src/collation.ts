// Sort keys that order text the way FileMaker's English index does: case and
// accents don't matter ("apple" < "Banana" < "café" = "cafe"), punctuation and
// spaces come before digits, digits before letters. Checked against the key
// order of the value indexes stored in the sample files (Charts, Flicks,
// FMburgh and private samples: every English index matches these keys),
// where Intl.Collator('en', { sensitivity: 'base' }) gives FileMaker's order and
// plain byte order doesn't. SQLite has no custom collations in node:sqlite, so
// ORDER BY uses these keys: plain strings whose code point order is the order.
//
// Fields indexed in Japanese (language 31 in the file) use Intl.Collator('ja')
// instead. A few sampled keys agree with this order; Japanese special rules
// and Furigana have not been verified. See docs/sort-languages.md.
//
// Every other language Claris Pro Help names (SORT_LANGUAGES below) orders by the ICU locale nearest it. Those orders
// are an approximation of Claris, unverified: no sample file holds an index in them. A key gives each character one
// weight, so a contraction (Czech and Slovak "ch", traditional Spanish "ch" and "ll", Hungarian "cs") and a
// language-specific rule that depends on the neighbours are not applied.

type Range = [number, number];

const LATIN: Range[] = [[0x20, 0x7e], [0xa0, 0x24f], [0x2010, 0x2027], [0x2030, 0x205e], [0x20a0, 0x20bf]];
const GREEK: Range[] = [[0x370, 0x3ff], [0x1f00, 0x1fff]];
const CYRILLIC: Range[] = [[0x400, 0x52f]];
const HEBREW: Range[] = [[0x590, 0x5ff]];
const ARABIC: Range[] = [[0x600, 0x6ff], [0x750, 0x77f]];
const KANA: Range[] = [[0x3000, 0x30ff], [0x31f0, 0x31ff], [0xff01, 0xffef]];
const HAN: Range[] = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]];
const HANGUL: Range[] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7a3]];
const INDIC = (from: number): Range[] => [[from, from + 0x7f]];

/** Letters ICU sorts as two letters (a language that has the letter of its own drops its entry). */
const EXPANSIONS: Record<string, string> = { ß: 'ss', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ĳ: 'ij', Ĳ: 'ij', ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl' };
const WITHOUT_AE = { ...EXPANSIONS, æ: undefined, Æ: undefined };
const PHONEBOOK = { ...EXPANSIONS, ä: 'ae', Ä: 'ae', ö: 'oe', Ö: 'oe', ü: 'ue', Ü: 'ue' };

/** One way of ordering text: the key under which a language's names are listed in FileMaker, and the ICU locale standing in for it. */
export interface SortLanguageInfo {
  /** The name Claris Pro Help's SortValues page gives (and a field's Default language is named by in FileMaker's XML). */
  name: string;
  /** The ordering this language shares with others of the same id; it names the SQL function that gives its keys. */
  id: string;
  /** The ICU locale whose collation is used. */
  locale: string;
  ranges: Range[];
  expansions: Record<string, string | undefined>;
  /** Whether the order was compared with an index stored by FileMaker (English, and Japanese thinly); the others are ICU's, standing in. */
  checked: boolean;
}

const lang = (name: string, id: string, locale: string, ranges: Range[] = [], expansions: SortLanguageInfo['expansions'] = EXPANSIONS, checked = false): SortLanguageInfo =>
  ({ name, id, locale, ranges: [...LATIN, ...ranges], expansions, checked });

/**
 * Every language in Claris Pro Help's SortValues page (https://help.claris.com/en/pro-help/content/sortvalues.html,
 * "Sort order is determined by locale in the same manner as for sorting records"), each mapped to the ICU locale
 * nearest its name. Only English and Japanese were compared with FileMaker's own indexes; the rest are an approximation
 * of Claris, unverified. Catalog, Unicode_Raw and Unicode_Standard keep the English order Tabularius has always used.
 */
export const SORT_LANGUAGES: readonly SortLanguageInfo[] = [
  lang('English', 'en', 'en', [], EXPANSIONS, true), lang('Catalog', 'en', 'en'), lang('Unicode_Raw', 'en', 'en'), lang('Unicode_Standard', 'en', 'en'),
  lang('Japanese', 'ja', 'ja', KANA.concat(HAN), EXPANSIONS, true),
  lang('Arabic', 'ar', 'ar', ARABIC), lang('Bengali', 'bn', 'bn', INDIC(0x980)), lang('Bulgarian', 'bg', 'bg', CYRILLIC), lang('Catalan', 'ca', 'ca'),
  lang('Chinese', 'zh', 'zh', KANA.concat(HAN)), lang('Chinese_Stroke', 'zh_stroke', 'zh-u-co-stroke', KANA.concat(HAN)),
  lang('Croatian', 'hr', 'hr'), lang('Czech', 'cs', 'cs'), lang('Danish', 'da', 'da', [], WITHOUT_AE), lang('Dutch', 'nl', 'nl'), lang('Estonian', 'et', 'et'),
  lang('Finnish', 'fi_trad', 'fi-u-co-trad'), lang('Finnish_Custom', 'fi', 'fi'), lang('French', 'fr', 'fr'),
  lang('German', 'de_phonebook', 'de-u-co-phonebk', [], PHONEBOOK), lang('German_Dictionary', 'de', 'de'),
  lang('Greek', 'el', 'el', GREEK), lang('Greek_Mixed', 'el', 'el', GREEK), lang('Gujarati', 'gu', 'gu', INDIC(0xa80)), lang('Hebrew', 'he', 'he', HEBREW),
  lang('Hindi', 'hi', 'hi', INDIC(0x900)), lang('Hungarian', 'hu', 'hu'), lang('Icelandic', 'is', 'is', [], WITHOUT_AE), lang('Italian', 'it', 'it'),
  lang('Kannada', 'kn', 'kn', INDIC(0xc80)), lang('Korean', 'ko', 'ko', HANGUL.concat(HAN)), lang('Latvian', 'lv', 'lv'), lang('Lithuanian', 'lt', 'lt'),
  lang('Malayalam', 'ml', 'ml', INDIC(0xd00)), lang('Marathi', 'mr', 'mr', INDIC(0x900)), lang('Norwegian', 'nb', 'nb', [], WITHOUT_AE),
  lang('Panjabi', 'pa', 'pa', INDIC(0xa00)), lang('Persian', 'fa', 'fa', ARABIC), lang('Polish', 'pl', 'pl'), lang('Portuguese', 'pt', 'pt'), lang('Romanian', 'ro', 'ro'),
  lang('Russian', 'ru', 'ru', CYRILLIC), lang('Serbian', 'sr', 'sr-Latn', CYRILLIC), lang('Slovak', 'sk', 'sk'), lang('Slovenian', 'sl', 'sl'),
  lang('Spanish', 'es', 'es'), lang('Spanish_Traditional', 'es_trad', 'es-u-co-trad'), lang('Swedish', 'sv_trad', 'sv-u-co-trad'), lang('Swedish_Custom', 'sv', 'sv'),
  lang('Tamil', 'ta', 'ta', INDIC(0xb80)), lang('Telugu', 'te', 'te', INDIC(0xc00)), lang('Thai', 'th', 'th', INDIC(0xe00)), lang('Turkish', 'tr', 'tr'),
  lang('Ukrainian', 'uk', 'uk', CYRILLIC), lang('Vietnamese', 'vi', 'vi', [[0x1e00, 0x1eff]]),
];

const byName = new Map(SORT_LANGUAGES.map((l) => [l.name.toLowerCase(), l]));
const byId = new Map<string, SortLanguageInfo>();
for (const l of SORT_LANGUAGES) if (!byId.has(l.id)) byId.set(l.id, l);

/** Whether FileMaker names a language so (the case is not significant). */
export const isSortLanguageName = (name: string | null | undefined): boolean => byName.has(String(name ?? '').trim().toLowerCase());

/** A field's Default language (or a SortValues locale) as the id of the order it sorts in: English for a name that is not known, or none. */
export function sortLanguage(name?: string | null): SortLanguage {
  const known = byName.get(String(name ?? '').trim().toLowerCase());
  return known ? known.id : byId.has(String(name)) ? String(name) : 'en';
}

/** The SQL function giving a language's sort keys: fm_sort_key for English, fm_sort_key_<id> for the rest. */
export const sortFunction = (id: SortLanguage): string => (id === 'en' ? 'fm_sort_key' : `fm_sort_key_${id}`);

/** The ids of every order, one for each distinct way of sorting. */
export const SORT_LANGUAGE_IDS: readonly string[] = [...byId.keys()];

/** The BCP 47 language of an order, for lower-casing text the way its language does (Turkish dotted and dotless i). */
export const sortLocale = (id: SortLanguage): string => (byId.get(id) ?? byId.get('en')!).locale.split('-')[0];

/** The id of one order. 'en' and 'ja' are what the English and Japanese index have always been called. */
export type SortLanguage = string;

/** Unicode uses code point order; a nameless numeric id cannot be mapped to a language order. */
export function recordSortLanguage(name?: string, id?: number): SortLanguage {
  if (name?.toLowerCase() === 'unicode') return 'unicode';
  if (name === undefined && id !== undefined) throw new Error(`FileMaker sort language ID ${id} is not mapped`);
  return sortLanguage(name);
}

const tables: Record<string, { weights: Map<string, number>; after: number }> = {};

/** Weights for the language's characters: equal for characters the collator calls equal. */
function weights(id: SortLanguage): { weights: Map<string, number>; after: number } {
  const known = tables[id];
  if (known) return known;
  const info = byId.get(id) ?? byId.get('en')!;
  const collator = new Intl.Collator(info.locale, { sensitivity: 'base' });
  const chars: string[] = [];
  for (const [from, to] of info.ranges) {
    for (let c = from; c <= to; c++) if (!info.expansions[String.fromCharCode(c)]) chars.push(String.fromCharCode(c));
  }
  chars.sort(collator.compare);
  const table = new Map<string, number>();
  let w = 0x100;
  chars.forEach((c, i) => {
    if (i > 0 && collator.compare(chars[i - 1], c) !== 0) w++;
    table.set(c, w);
  });
  // Characters outside the table sort after it, by code point.
  return (tables[id] = { weights: table, after: Math.max(0x1000, w + 1) });
}

const asChar = (w: number) => String.fromCodePoint(w < 0xd800 ? w : Math.min(w + 0x800, 0x10ffff));

/** A key whose code point (and UTF-8 byte) order is FileMaker's text order. */
export function sortKey(text: string, language: SortLanguage = 'en'): string {
  const id = sortLanguage(language);
  const { weights: t, after } = weights(id);
  const expansions = (byId.get(id) ?? byId.get('en')!).expansions;
  let out = '';
  // One key for text written either way (é as one character or as e and a combining accent).
  for (const ch of /[^\u0000-\u007f]/.test(text) ? text.normalize('NFC') : text) {
    const expanded = expansions[ch];
    if (expanded) { for (const e of expanded) out += asChar(t.get(e)!); continue; }
    let w = t.get(ch);
    if (w === undefined) {
      // Outside the table: the base letter of an accented one, else after the table, by code point.
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      w = base && base !== ch && t.has(base[0]) ? t.get(base[0]) : after + ch.codePointAt(0)!;
      if (base.length > 1 && t.has(base[0])) {
        for (const b of base) out += asChar(t.get(b) ?? after + b.codePointAt(0)!);
        continue;
      }
    }
    // Control characters (returns, tabs) sort before everything, as in FileMaker.
    if (ch < ' ') w = 0x20 + ch.charCodeAt(0);
    out += asChar(w!);
  }
  return out;
}

/** Compare sort keys by Unicode code point, matching their UTF-8 byte order. */
export function compareKeys(a: string, b: string): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  while (true) {
    const x = left.next();
    const y = right.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const diff = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (diff) return diff;
  }
}

/** A record sort ignores punctuation before its first word in a language-based sort. */
export function recordSortKey(text: string, lang: SortLanguage = 'en'): string {
  return sortKey(text.replace(/^[^\p{L}\p{N}]*/u, ''), lang);
}

const EN_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const folded = new Map<string, string>();
let letterCollator: Intl.Collator | undefined;
/** The width variants of Unicode's compatibility block: ideographic space, full-width ASCII, half-width CJK, full-width signs. */
const WIDTH_FORMS = /^[\u3000\uff01-\uff5e\uff61-\uffdc\uffe0-\uffe6\uffe8-\uffee]$/u;

/** One character as a find or a match sees it: lower case, no accent, ligatures spelt out. Characters beyond Latin stay as themselves. */
function foldChar(ch: string): string {
  const known = folded.get(ch);
  if (known !== undefined) return known;
  let out = EXPANSIONS[ch];
  // Claris: "Normally, finds are not case sensitive or width sensitive", so a half-width or full-width form is its normal-width
  // character (full-width letters, digits and punctuation, half-width katakana; a dakuten after one is a mark and drops out).
  if (out === undefined && WIDTH_FORMS.test(ch)) out = [...ch.normalize('NFKC')].map(foldChar).join('');
  if (out === undefined) {
    const base = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    const lower = base.replace(/ς/g, 'σ');
    const expansion = EXPANSIONS[lower] ?? (lower === 'ﬃ' ? 'ffi' : lower === 'ﬄ' ? 'ffl' : lower === 'ﬅ' || lower === 'ﬆ' ? 'st' : undefined);
    if (expansion !== undefined) {
      out = expansion;
      folded.set(ch, out);
      return out;
    }
    out = lower;
    // ł, ø, đ and the like have no decomposition; the collator knows which letter they are a form of.
    if (base.length === 1 && base > '\u007f') {
      letterCollator ??= new Intl.Collator('en', { sensitivity: 'base' });
      const letter = [...EN_LETTERS].find((l) => letterCollator!.compare(base, l) === 0);
      if (letter) out = letter;
    }
  }
  folded.set(ch, out);
  return out;
}

/** Counts changes to foldText: an index of folded text built under another number is built again (store/src/words.ts). */
export const FOLD_VERSION = 3;

/**
 * Text as FileMaker's English index compares it for a find: case and accents don't matter (see sortKey), so "ZÜRICH",
 * "Zürich" and "zurich" fold to the same text, and so do "Łódź" and "lodz". SQLite's own case folding covers ASCII
 * only, so finds compare through this.
 */
export function foldText(text: string): string {
  if (!/[^\u0000-\u007f]/.test(text)) return text.toLowerCase();
  let out = '';
  for (const ch of text) out += ch < '\u0080' ? ch.toLowerCase() : foldChar(ch);
  return out;
}

/**
 * Text with case ignored in every script but accents kept: how a unique value is compared ("É" and "é" are one value, "e"
 * is another). Text that is the same letters written two canonical ways is one value as well: "é" typed as one character
 * and as e with a combining accent, which look alike and only differ in how a keyboard or a file name stored them.
 */
export function foldCase(text: string): string {
  if (!/[^\u0000-\u007f]/.test(text)) return text.toLowerCase();
  return text.normalize('NFC').toLowerCase().normalize('NFC');
}
