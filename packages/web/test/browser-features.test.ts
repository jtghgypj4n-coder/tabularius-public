import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserFeatureMessage, browserFeatures } from '../src/browser-features.ts';

test('browser feature inventory names each capability and gives an action for missing support', () => {
  const features = browserFeatures();
  assert.deepEqual(features.map((feature) => feature.name), ['Modules', 'structuredClone', 'IndexedDB', 'WebAuthn', 'Service workers', 'Clipboard', 'ResizeObserver']);
  for (const feature of features) {
    assert.equal(typeof feature.available, 'boolean');
    assert.match(browserFeatureMessage({ ...feature, available: false }), new RegExp(feature.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(feature.alternative.length > 10);
  }
});

test('detection follows the environment it is given', () => {
  const missing = (env: object) => browserFeatures(env as typeof globalThis).filter((feature) => !feature.available).map((feature) => feature.name);
  assert.deepEqual(missing({ HTMLScriptElement: { prototype: { noModule: true } }, structuredClone() {}, indexedDB: {}, ResizeObserver: class {}, PublicKeyCredential: class {}, navigator: { credentials: { get() {} }, serviceWorker: {}, clipboard: { writeText() {} } } }), []);
  assert.deepEqual(missing({}), ['Modules', 'structuredClone', 'IndexedDB', 'WebAuthn', 'Service workers', 'Clipboard', 'ResizeObserver']);
  assert.deepEqual(missing({ HTMLScriptElement: { prototype: {} }, structuredClone() {}, indexedDB: {}, ResizeObserver: class {}, PublicKeyCredential: class {}, navigator: { credentials: { get() {} }, serviceWorker: {} } }), ['Modules', 'Clipboard']);
});
