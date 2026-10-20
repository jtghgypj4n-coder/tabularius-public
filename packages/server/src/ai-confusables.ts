// Latin look-alike groups for the additional secret-name match, not transliteration.
// Native-language matching runs first. NFKC handles fullwidth, mathematical,
// circled, parenthesized and ordinary squared letters; the negative enclosed
// alphabets below have no compatibility decomposition. Keep these groups as data
// so extending an alphabet does not require changing the matching expression.
const LATIN_CONFUSABLES: Readonly<Record<string, string>> = {
  a: 'ᴀɑαаꓮ🄰🅐🅰@',
  b: 'ʙβϐвЬьꓐ🄱🅑🅱',
  c: 'ᴄϲϹсꓚ🄲🅒🅲',
  d: 'ᴅԁԀꓓ🄳🅓🅳',
  e: 'ᴇεϵеєꓰ🄴🅔🅴',
  f: 'ꜰϜϝғꓝ🄵🅕🅵',
  g: 'ɢɡԌԍꓖ🄶🅖🅶',
  h: 'ʜΗНһнꓧ🄷🅗🅷',
  i: 'ɪΙιіӏꓲ🄸🅘🅸',
  j: 'ᴊϳјꓙ🄹🅙🅹',
  k: 'ᴋκϰкꓗ🄺🅚🅺',
  l: 'ʟꓡ🄻🅛🅻',
  m: 'ᴍΜмꓟ🄼🅜🅼',
  n: 'ɴոꓠ🄽🅝🅽',
  o: 'ᴏοоօꓳ🄾🅞🅾',
  p: 'ᴘρϱрꓑ🄿🅟🅿',
  q: 'ꞯԚԛ🅀🅠🆀',
  r: 'ʀГгꓣ🅁🅡🆁',
  s: 'ꜱѕꓢ🅂🅢🆂$',
  t: 'ᴛτтꓔ🅃🅣🆃',
  u: 'ᴜυսꓴ🅄🅤🆄',
  v: 'ᴠνѵꓦ🅅🅥🆅',
  w: 'ᴡԝԜωꓪ🅆🅦🆆',
  x: 'χхꓫ🅇🅧🆇',
  y: 'ʏγуүꓬ🅈🅨🆈',
  z: 'ᴢΖꓜ🅉🅩🆉',
};

const letters = new Map(Object.entries(LATIN_CONFUSABLES)
  .flatMap(([latin, variants]) => [...variants].map((variant) => [variant.toLowerCase(), latin] as const)));

export function foldConfusables(text: string): string {
  return [...text].map((char) => letters.get(char) ?? char).join('');
}
