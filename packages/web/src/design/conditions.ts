// Conditional formatting's "Value is" conditions, kept as the formulas on Self they mean.

/** Conditional formatting's "Value is" choices: key, label, how many values. */
export const VALUE_OPS = [
  ['eq', 'equal to', 1], ['ne', 'not equal to', 1], ['gt', 'greater than', 1], ['ge', 'greater than or equal to', 1],
  ['lt', 'less than', 1], ['le', 'less than or equal to', 1], ['between', 'between', 2], ['not-between', 'not between', 2],
  ['contains', 'containing', 1], ['not-contains', 'not containing', 1], ['empty', 'empty', 0], ['not-empty', 'not empty', 0],
] as const;
export type ValueIs = { op: (typeof VALUE_OPS)[number][0]; a: string; b: string };
const OP_SYMBOL: Record<string, string> = { eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤' };

/** A "Value is" condition as the formula on Self that means the same. */
export function valueFormula(v: ValueIs): string {
  if (v.op in OP_SYMBOL) return `Self ${OP_SYMBOL[v.op]} ${v.a}`;
  if (v.op === 'between') return `Self ≥ ${v.a} and Self ≤ ${v.b}`;
  if (v.op === 'not-between') return `not ( Self ≥ ${v.a} and Self ≤ ${v.b} )`;
  if (v.op === 'contains') return `PatternCount ( Self ; ${v.a} ) > 0`;
  if (v.op === 'not-contains') return `PatternCount ( Self ; ${v.a} ) = 0`;
  return v.op === 'empty' ? 'IsEmpty ( Self )' : 'not IsEmpty ( Self )';
}

/** The "Value is" condition a formula on Self spells, if it is one. */
export function valueIs(formula: string): ValueIs | undefined {
  // FileMaker string literals use doubled quotes to escape a quote. Keep all
  // their contents byte-for-byte; only make spacing predictable between tokens.
  let f = '';
  let quoted = false;
  let pendingSpace = false;
  for (let i = 0; i < formula.length; i++) {
    const c = formula[i];
    if (quoted) {
      f += c;
      if (c === '"') {
        if (formula[i + 1] === '"') f += formula[++i];
        else quoted = false;
      }
    } else if (c === '"') {
      if (pendingSpace && f && !f.endsWith(' ')) f += ' ';
      pendingSpace = false;
      quoted = true;
      f += c;
    } else if (/\s/.test(c)) pendingSpace = true;
    else {
      if (pendingSpace && f && !f.endsWith(' ')) f += ' ';
      pendingSpace = false;
      f += c;
    }
  }
  f = f.trim();
  // A value is any expression without a top-level and/or (those stay formulas).
  const plain = (...terms: string[]) => terms.every((t) => {
    const outsideLiterals = t.replace(/"(?:[^"]|"")*"/g, '""');
    return !!t.trim() && !/ (and|or|xor|not) /i.test(` ${outsideLiterals} `) && !outsideLiterals.includes(';');
  });
  let m: RegExpExecArray | null;
  if (f === 'IsEmpty ( Self )') return { op: 'empty', a: '', b: '' };
  if (f === 'not IsEmpty ( Self )') return { op: 'not-empty', a: '', b: '' };
  if ((m = /^not \( Self ≥ (.+?) and Self ≤ (.+) \)$/.exec(f)) && plain(m[1], m[2])) return { op: 'not-between', a: m[1], b: m[2] };
  if ((m = /^Self ≥ (.+?) and Self ≤ (.+)$/.exec(f)) && plain(m[1], m[2])) return { op: 'between', a: m[1], b: m[2] };
  if ((m = /^PatternCount \( Self ; (.+) \) (> 0|= 0)$/.exec(f)) && plain(m[1])) return { op: m[2] === '> 0' ? 'contains' : 'not-contains', a: m[1], b: '' };
  if ((m = /^Self (=|≠|>|≥|<|≤) (.+)$/.exec(f)) && plain(m[2])) {
    const sym = m[1];
    const op = Object.entries(OP_SYMBOL).find(([, x]) => x === sym)![0] as ValueIs['op'];
    return { op, a: m[2], b: '' };
  }
  return undefined;
}
