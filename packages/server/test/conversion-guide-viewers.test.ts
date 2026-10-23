import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Store } from '../../store/src/index.ts';
import { webViewerGuide } from '../src/conversion-guide.ts';

function guideFor(urls: string[]) {
  const store = {
    designs: () => ({
      themes: [],
      layouts: [{
        id: 1, name: 'Synthetic layout', style: {}, parts: [],
        objects: urls.map((webUrl) => ({ kind: 'web-viewer', webUrl })),
      }],
    }),
  } as unknown as Store;
  return webViewerGuide(store);
}

test('web viewer guide counts internet addresses and CDN HTML as high severity, but not fully inline HTML', () => {
  const item = guideFor([
    '"https://maps.example.test/"',
    '"data:text/html,<script SRC=\\"HTTPS://cdn.example.test/chart.js\\"></script>"',
    '"data:text/html,<link HREF=\\"http://cdn.example.test/site.css\\">"',
    '"data:text/html,<style>body{background:url(HTTP://cdn.example.test/bg.png)}</style>"',
    '"data:text/html,<p>Everything is inline</p>"',
  ])!;

  assert.equal(item.count, 5);
  assert.equal(item.severity, 'high');
  assert.match(item.what, /^4 web viewers load an http\(s\) page or inline HTML.*1 other show a page made in the file/);

  const inlineOnly = guideFor(['"data:text/html,<p>Everything is inline</p>"'])!;
  assert.equal(inlineOnly.count, 1);
  assert.equal(inlineOnly.severity, 'low');
  assert.match(inlineOnly.what, /pages made in the file/);
  assert.equal(inlineOnly.instead, undefined);
});
