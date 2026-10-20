import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTokens, STARTER_TOKENS, tokenTheme, type ThemeTokens } from '../../store/src/index.ts';
import { STARTER_LOOKS } from '../../web/src/design/starter-looks.ts';

// WCAG contrast of two #rrggbb colours.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('the starter looks are valid, distinct, and read well', () => {
  assert.deepEqual(STARTER_TOKENS.map((s) => s.id), ['light', 'dark', 'plain', 'warm']);
  assert.equal(new Set(STARTER_TOKENS.map((s) => JSON.stringify(s.tokens))).size, STARTER_TOKENS.length);
  for (const { id, tokens } of STARTER_TOKENS) {
    assert.deepEqual(checkTokens(tokens), tokens, `${id} is valid`);
    assert.ok(contrast(tokens.text, tokens.panel) >= 4.5, `${id}: text on fields`);
    assert.ok(contrast(tokens.text, tokens.background) >= 4.5, `${id}: text on the background`);
    assert.ok(contrast(tokens.muted, tokens.background) >= 4.5, `${id}: labels on the background`);
    assert.ok(contrast(tokens.accentText, tokens.accent) >= 4.5, `${id}: button label on the accent`);
    const theme = tokenTheme(tokens);
    assert.ok(theme.defaults[80] && theme.defaults[61], `${id} styles buttons and fields`);
  }
});

test('the web client\'s copy of the starter looks is the store\'s', () => {
  assert.deepEqual(STARTER_LOOKS.map(({ id, name, tokens }) => ({ id, name, tokens: tokens as ThemeTokens })), STARTER_TOKENS);
});
