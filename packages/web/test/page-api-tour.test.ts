import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insertSnippet, tourSteps } from '../src/design/page-api-tour.ts';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

test('page API tour: every snippet is valid script, whatever the layout is called', () => {
  for (const layout of ['Home', 'Q4 </script> "x"  ']) {
    for (const step of tourSteps(layout)) {
      assert.doesNotThrow(() => new AsyncFunction(step.code), step.title);
      assert.ok(!step.code.includes('</script>'), `${step.title} ends the script tag`);
    }
  }
});

test('page API tour: every call the page gets is toured', () => {
  const layout = readFileSync(new URL('../src/layout.ts', import.meta.url), 'utf8');
  const api = layout.slice(layout.indexOf('window.tabularius={'), layout.indexOf('})();</script>'));
  const calls = [...api.matchAll(/(\w+):function/g)].map((m) => m[1]);
  assert.ok(calls.length >= 10, calls.join());
  const all = tourSteps('L').map((s) => s.code).join('\n');
  for (const call of calls) assert.ok(all.includes(`tabularius.${call}(`), `${call} is not in the tour`);
  assert.ok(all.includes('FileMaker.PerformScript('));
});

test('page API tour: a snippet goes at the end of the last script, or in a new one', () => {
  assert.equal(insertSnippet('<p>x</p><script>a()</script>', 'b()'), '<p>x</p><script>a()\nb()\n</script>');
  assert.equal(insertSnippet('<p>x</p>\n', 'b()'), '<p>x</p>\n<script>\nb()\n</script>\n');
  // Guarded, it waits for the calls to exist; the result is still valid script.
  const guarded = insertSnippet('<script></script>', 'a();\nb();', true);
  assert.equal(guarded, '<script>\nif (window.tabularius) {\n  a();\n  b();\n}\n</script>');
  assert.doesNotThrow(() => new AsyncFunction(guarded.slice(8, -9)));
});
