import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StyleSheet } from '../src/styles.ts';
import type { Theme } from '../src/types.ts';

test('layout background and parts draw only their normal and active states', () => {
  const bg = (state: number, color: string) => ({ part: 1, state, css: { 'background-color': color } });
  const theme: Theme = {
    id: 1, name: 'Green-1.0',
    // This theme's layout background carries a green hover and pressed state FileMaker never shows.
    defaults: { 20: [bg(1, 'white'), bg(2, 'green'), bg(3, 'darkgreen')], 34: [bg(1, 'white'), bg(7, 'blue')], 80: [bg(1, 'white'), bg(2, 'gray')] },
    styles: [{ name: 'Body', element: 34, rules: [bg(2, 'red')] }],
  };
  const css = new StyleSheet('.l', theme).text();
  assert.match(css, /\.l \.e20\{background-color:white\}/);
  assert.doesNotMatch(css, /green|red/);
  assert.match(css, /\.l \.e34\.fm-checked\{background-color:blue\}/);
  assert.match(css, /\.l \.e80:hover\{background-color:gray\}/);
});

test('a theme\'s text box insets the text, and a portal\'s rows take its row colours', () => {
  const theme: Theme = {
    id: 1, name: 'Apex Blue',
    defaults: {
      // Apex Blue's edit box: FileMaker's ".text" margins (part 3), focus adds padding.
      61: [{ part: 3, state: 1, css: { 'margin-top': '0.4em', 'margin-left': '0.5em', color: 'red' } }, { part: 3, state: 4, css: { 'padding-top': '11px' } }],
      83: [{ part: 12, state: 1, css: { 'background-color': 'white' } }, { part: 13, state: 1, css: { 'background-color': 'gray' } }, { part: 28, state: 1, css: { 'background-color': 'blue' } }],
    },
    styles: [],
  };
  const css = new StyleSheet('.l', theme).text();
  // As custom properties the field's own padding adds up (app.css); nothing else from the text box.
  assert.match(css, /\.l \.e61\{--fm-text-margin-top:0\.4em;--fm-text-margin-left:0\.5em\}/);
  assert.match(css, /\.l \.e61:focus-within\{--fm-text-padding-top:11px\}/);
  assert.doesNotMatch(css, /red/);
  assert.match(css, /\.l \.e83 > \.fm-portal-rows > \.fm-portal-row\{background-color:white\}/);
  assert.match(css, /\.l \.e83 > \.fm-portal-rows > \.fm-portal-row\.fm-alt\{background-color:gray\}/);
  assert.match(css, /\.l \.e83 > \.fm-portal-rows > \.fm-portal-row:is\(:focus-within, \.fm-portal-current\)\{background-color:blue\}/);
});

test('repeated rendering of one object keeps one copy of its local CSS', () => {
  const sheet = new StyleSheet('.layout', undefined);
  const element = {
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
  } as unknown as HTMLElement;
  const style = { rules: [{ part: 1, state: 2, css: { color: 'red' } }] };
  for (let i = 0; i < 1000; i++) sheet.apply(element, style, 61, 'o1');
  const css = sheet.text();
  assert.equal(css.match(/\.layout \.fm\.o1:hover\{color:red\}/g)?.length, 1);
  assert.ok(css.length < 100, `stylesheet grew to ${css.length} bytes`);
});
