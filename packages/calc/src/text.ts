// Text is counted in characters, so an emoji or another character outside the Basic Multilingual Plane is one, not
// two. JavaScript strings count UTF-16 units, so positions are converted at the edges.
const ASTRAL = /[\ud800-\udbff][\udc00-\udfff]/;
/** The UTF-16 offset of the character at index `cp` (clamped to the text). */
export const unitAt = (t: string, cp: number): number => {
  if (!ASTRAL.test(t)) return Math.max(0, Math.min(t.length, cp));
  let at = 0;
  for (let n = 0; n < cp && at < t.length; n++) at += t.codePointAt(at)! > 0xffff ? 2 : 1;
  return at;
};
/** How many characters the first `units` UTF-16 units of the text hold. */
export const charsBefore = (t: string, units: number): number => {
  if (!ASTRAL.test(t)) return units;
  let n = 0;
  for (let at = 0; at < units; n++) at += t.codePointAt(at)! > 0xffff ? 2 : 1;
  return n;
};
export const charCount = (t: string): number => charsBefore(t, t.length);

