// FileMaker theme import: a file's own themes turned into Tabularius's design
// tokens, and the census of what of its styling isn't drawn yet. The Flicks
// sample's themes need `npm run fixtures`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FmpDatabase, readFonts, readThemes, type StyleRule } from '../../fmp12/src/index.ts';
import { PRODUCT_TOKENS, styleCensus, styleCensusText, tokensFromTheme } from '../src/index.ts';

const flicks = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'fmp12', 'Flicks.fmp12');
const skip = existsSync(flicks) ? false : 'fixtures missing: run npm run fixtures';

const rule = (css: Record<string, string>, part = 1, state = 1): StyleRule => ({ part, state, css }) as StyleRule;

test('theme tokens: taken from the elements\' normal state, each with where it came from', () => {
  const { tokens, from, unmapped } = tokensFromTheme({
    defaults: {
      20: [rule({ 'background-color': 'rgb(240 240 240)' })],
      34: [rule({ 'background-image': 'linear-gradient(rgb(255 250 240), rgb(0 0 0))' })],
      60: [rule({ color: 'rgb(20 20 20)', 'border-top-color': 'rgb(200 200 200)', 'font-family': '"Avenir", sans-serif', 'font-size': '14px' })],
      70: [rule({ color: 'rgb(100 100 100)' }), rule({ color: 'rgb(255 0 0)' }, 1, 2)],
      80: [rule({ 'background-color': 'rgb(0 64 128)', color: 'rgb(255 255 255)', 'border-top-left-radius': '8px 8px' })],
    },
  } as never);
  assert.deepEqual(tokens, { accent: '#004080', accentText: '#ffffff', text: '#141414', muted: '#646464', background: '#f0f0f0', panel: '#fffaf0', line: '#c8c8c8', font: '"Avenir", sans-serif', size: 14, radius: 8 });
  assert.equal(from.accent, 'button background');
  assert.equal(from.panel, 'body part background');
  assert.deepEqual(unmapped, []);
});

test('theme tokens: an outlined button gives the accent; unset tokens keep ours and are listed', () => {
  const { tokens, from, unmapped } = tokensFromTheme({
    defaults: { 80: [rule({ 'background-image': 'none', 'border-top-color': 'rgb(0 145 206)', color: 'rgb(0 145 206)' })] },
  } as never);
  assert.equal(tokens.accent, '#0091ce');
  assert.match(from.accent, /outlined/);
  // Its text would vanish on a filled accent button: it becomes whichever of black and white reads.
  assert.equal(tokens.accentText, '#000000');
  assert.equal(tokens.text, PRODUCT_TOKENS.text);
  assert.ok(unmapped.includes('text') && unmapped.includes('font') && !unmapped.includes('accent'));
  // Nothing in a font name can break out of the CSS it lands in.
  assert.equal(tokensFromTheme({ defaults: { 60: [rule({ 'font-family': 'x; } body { color: red' })] } } as never).tokens.font, PRODUCT_TOKENS.font);
});

test('theme tokens: Flicks\' themes map, every colour a hex colour', { skip }, () => {
  const db = FmpDatabase.open(flicks);
  const themes = readThemes(db.file, readFonts(db.file));
  const apex = themes.find((t) => t.name === 'Apex Blue')!;
  const r = tokensFromTheme(apex);
  assert.equal(r.tokens.accent, '#0091ce');
  assert.equal(r.tokens.font, '"Helvetica Neue", sans-serif');
  assert.deepEqual(r.unmapped, []);
  for (const t of themes) {
    const { tokens } = tokensFromTheme(t);
    for (const k of ['accent', 'accentText', 'text', 'muted', 'background', 'panel', 'line'] as const) assert.match(tokens[k], /^#[0-9a-f]{6}$/, `${t.name} ${k}`);
  }
});

test('style census: counts properties not drawn yet, in themes and objects\' own styles, by id only', { skip }, () => {
  const db = FmpDatabase.open(flicks);
  const c = styleCensus(db.file, db.schema);
  assert.equal(c.themes, 8);
  assert.ok(c.properties.length > 0);
  // Drawn properties (background colour, borders, fonts, padding) never show up.
  for (const id of [1, 7, 20, 34, 64, 101, 504]) assert.ok(!c.properties.some((p) => p.id === id), `property ${id} is drawn`);
  assert.ok(c.properties.some((p) => p.themes > 0) && c.properties.some((p) => p.objects > 0));
  for (let i = 1; i < c.properties.length; i++) assert.ok(c.properties[i - 1].themes + c.properties[i - 1].objects >= c.properties[i].themes + c.properties[i].objects);
  const text = styleCensusText(c, 'Flicks');
  assert.match(text, /^Flicks: 8 themes/);
  assert.match(text, /in objects' own styles/);
});
