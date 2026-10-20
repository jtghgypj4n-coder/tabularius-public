import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docsHtml } from '../src/docs.ts';

const paragraph = (s: string, guide = false) => {
  const html = docsHtml(s, 'generated', undefined, { guide });
  return html.slice(html.indexOf('<main id="doc" tabindex="-1">') + '<main id="doc" tabindex="-1">'.length, html.indexOf('</main>')).trim();
};

test('unmatched Markdown delimiters scale to generated audit sizes', () => {
  for (const n of [10, 1000, 100_000]) for (const input of ['['.repeat(n) + 'x', '[a]('.repeat(n), '[a](/'.repeat(n) + ')']) {
    const start = performance.now();
    assert.ok(paragraph(input, true).length >= input.length);
    assert.ok(performance.now() - start < 3000, 'Markdown work budget regression (3x headroom)');
  }
});

test('link scanner preserves labels, escapes, destinations and HTML escaping', () => {
  assert.equal(paragraph('[first [nested](#x)'), '<p><a href="#x">first [nested</a></p>');
  assert.equal(paragraph('[a\\]b](#x)'), '<p><a href="#x">a]b</a></p>');
  assert.equal(paragraph('[a\\[b](#x)'), '<p><a href="#x">a[b</a></p>');
  assert.equal(paragraph('[x](/docs/a) [y](//bad) [z](javascript:bad)'), '<p><a href="/docs/a">x</a> [y](//bad) [z](javascript:bad)</p>');
  assert.equal(paragraph('[x](reference/a.md#b)', true), '<p><a href="/docs/reference/a#b">x</a></p>');
  assert.equal(paragraph('[x](https://example.invalid/a)', true), '<p><a href="https://example.invalid/a" rel="noopener noreferrer">x</a></p>');
  assert.equal(paragraph('[x](https://example.invalid/a)'), '<p>[x](https://example.invalid/a)</p>');
  assert.equal(paragraph('<script>&"'), '<p>&lt;script&gt;&amp;&quot;</p>');
});

test('generated short link labels agree with the previous grammar', () => {
  const legacy = (s: string) => s.replace(/\[((?:\\.|[^\]\\])+)\]\((#[a-z0-9-]+|\/(?!\/)[\w\-./#]*)\)/g,
    (_, label: string, href: string) => `<a href="${href}">${label.replace(/\\(.)/g, '$1')}</a>`);
  const pieces = ['[', ']', 'x', '\\[', '\\]', '(', ')', '#a', '/a', ' '];
  let seed = 17;
  for (let i = 0; i < 500; i++) {
    let input = 'text ';
    for (let j = 0; j < 12; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; input += pieces[seed % pieces.length]; }
    input += '[last](#a)';
    assert.equal(paragraph(input), `<p>${legacy(input)}</p>`);
  }
});
