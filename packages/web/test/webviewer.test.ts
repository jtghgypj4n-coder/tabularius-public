import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { dataHtml, callWebViewer, webViewerBlank, webViewerChrome, allowedWebAddress, externalFrameAttributes } from '../src/layout.ts';
import { ViewerState, viewerKey, webViewerBridge, viewerMessage, restoreViewer } from '../src/web-viewer.ts';
import { inlinePage } from '../../server/test/refresh-fixture.ts';
import { mergeObjectState } from '../src/refresh.ts';
import type { LayoutObject, ViewState } from '../src/types.ts';

test('web viewers: data:text/html addresses give their HTML; other addresses give none', () => {
  // A private sample's dashboard: "data:text/html;base64," & Base64EncodeRFC ( 4648 ; App::HTML )
  assert.equal(dataHtml('data:text/html;base64,' + Buffer.from('<p>Café</p>').toString('base64')), '<p>Café</p>');
  assert.equal(dataHtml('data:text/html;charset=utf-8,%3Cb%3Ehi%3C%2Fb%3E'), '<b>hi</b>');
  assert.equal(dataHtml('data:text/html,<b>100%</b>'), '<b>100%</b>'); // not percent-encoded: taken as typed
  assert.equal(dataHtml('https://example.com/'), undefined);
  assert.equal(dataHtml('data:image/png;base64,AAAA'), undefined);
});

test('viewer history: boundaries, forward-branch truncation and separate layout address', () => {
  const state = new ViewerState('A');
  assert.equal(state.apply('Go Back'), false);
  assert.equal(state.generation, 0);
  state.apply('Go to URL', 'B');
  state.apply('Go to URL', 'C');
  state.apply('Go Back');
  assert.equal(state.url, 'B');
  state.apply('Go Forward');
  assert.equal(state.url, 'C');
  state.apply('Go Back');
  state.apply('Go to URL', 'D');
  assert.equal(state.apply('Go Forward'), false);
  state.address('new layout address');
  assert.equal(state.url, 'D');
  state.apply('Reload');
  assert.equal(state.url, 'D');
  state.apply('Go Back');
  assert.equal(state.url, 'B');
  state.apply('Reset');
  assert.equal(state.url, 'new layout address');
  assert.equal(state.apply('Go Back'), false);
  assert.equal(state.apply('Go Forward'), false);
});

test('Reset and Reload force a load even for unchanged content; ordinary redraw preserves it', () => {
  const state = new ViewerState('A');
  state.address('A');
  assert.equal(state.generation, 0);
  state.apply('Reload');
  assert.equal(state.generation, 1);
  state.address('A');
  assert.equal(state.generation, 1);
  state.apply('Reset');
  assert.equal(state.generation, 2);
  state.address('B');
  assert.equal(state.generation, 3);
  assert.equal(state.url, 'B');
});

test('viewer identity follows records across row positions and differs across windows and layouts', () => {
  const key = viewerKey('window', 1, 'record', 4, 'child');
  assert.equal(key, viewerKey('window', 1, 'record', 4, 'child'));
  for (const other of [viewerKey('other', 1, 'record', 4, 'child'), viewerKey('window', 2, 'record', 4, 'child'),
    viewerKey('window', 1, 'other', 4, 'child'), viewerKey('window', 1, 'record', 4, 'other')]) assert.notEqual(key, other);
});

test('the bridge tracks supported hash navigation without corrupting raw HTML or accepting a network address', () => {
  const html = 'data:text/html,<p style="color:#123">A</p>';
  const state = new ViewerState(html);
  state.navigate('#one');
  state.navigate('#two');
  assert.equal(state.url, html);
  assert.equal(state.hash, '#two');
  state.apply('Go Back');
  assert.equal(state.hash, '#one');
  state.apply('Reload');
  assert.equal(state.hash, '#one');
  state.navigate('https://example.com');
  assert.equal(state.hash, '#one');
  state.apply('Reset');
  assert.equal(state.hash, undefined);
});

test('a srcdoc fragment link stays in page A and enters viewer history before Back/Forward and a refresh checkpoint', async () => {
  const address = inlinePage('A');
  const state = new ViewerState(address);
  const handlers = new Map<string, (event?: unknown) => unknown>();
  let documentUrl = 'about:srcdoc';
  const calls: string[] = [];
  const messages: unknown[] = [];
  const parent = { postMessage(message: { tabularius: string; hash?: string }, origin: string) {
    assert.equal(origin, 'http://localhost');
    messages.push(structuredClone(message));
    if (message.tabularius === 'navigation') state.navigate(message.hash!);
  } };
  runInNewContext(webViewerBridge('http://localhost', 'document').slice('<script>'.length, -'</script>'.length), {
    addEventListener: (type: string, handler: (event?: unknown) => unknown) => handlers.set(type, handler),
    parent, console, scrollX: 0, scrollY: 0, scrollTo: () => {},
    window: { mark: (value: string) => calls.push(value) },
    location: {
      get hash() { return new URL(documentUrl).hash; },
      set hash(hash: string) {
        const url = new URL(documentUrl);
        url.hash = hash;
        documentUrl = url.href;
        handlers.get('hashchange')?.();
      },
    },
  });
  // srcdoc inherits the embedding page's base URL. Native anchor activation would leave the fixture.
  const href = /<a href="([^"]+)"/.exec(dataHtml(address)!)![1];
  const anchor = { getAttribute: (name: string) => name === 'href' ? href : null };
  const event = {
    button: 0, defaultPrevented: false,
    target: { closest: (selector: string) => selector === 'a[href]' ? anchor : null },
    preventDefault() { this.defaultPrevented = true; },
  };
  handlers.get('click')?.(event);
  if (!event.defaultPrevented) documentUrl = new URL(href, 'http://localhost/app/Refresh').href;
  assert.equal(documentUrl, 'about:srcdoc#one');
  assert.equal(state.url, address);
  assert.equal(state.hash, '#one');
  assert.equal(state.apply('Go Back'), true);
  assert.equal(state.url, address);
  assert.equal(state.hash, undefined);
  assert.equal(state.apply('Go Forward'), true);
  assert.equal(state.url, address);
  assert.equal(state.hash, '#one');
  // Set Web Viewer refreshes formula output at a checkpoint before applying the command.
  const old: ViewState = { hidden: [], tooltips: {}, placeholders: {}, web: { 20: address } };
  const refreshed = mergeObjectState(old, { ...old, web: { 20: address } }, { id: 20 } as LayoutObject);
  state.address(refreshed.web?.[20]);
  state.apply('Reload');
  assert.equal(state.url, address);
  assert.equal(state.hash, '#one');
  await handlers.get('message')?.({ source: parent, origin: 'http://localhost', data: { documentId: 'document', ... { tabularius: 'hash', hash: state.hash } } });
  assert.equal(state.apply('Go Forward'), false); // Restoring a fragment doesn't add a duplicate history entry.
  await handlers.get('message')?.({ source: parent, origin: 'http://localhost', data: { documentId: 'document', ... { tabularius: 'call', fn: 'mark', args: ['after'], id: 'command' } } });
  assert.deepEqual(calls, ['after']);
  assert.deepEqual(messages.at(-1), { tabularius: 'called', id: 'command', documentId: 'document' });
});


test('fragment traversal preserves generation, empty hashes, scroll positions and forward history', () => {
  const state = new ViewerState(inlinePage('A'));
  state.navigate('#one', { x: 0, y: 800 }, { x: 3, y: 20 });
  state.scrolled(0, 900);
  assert.deepEqual(state.scroll, { x: 0, y: 900 });
  state.scrolled(NaN, Infinity);
  assert.deepEqual(state.scroll, { x: 0, y: 900 });
  state.navigate('', { x: 0, y: 0 }, { x: 0, y: 900 });
  assert.equal(state.generation, 0);
  assert.equal(state.apply('Go Back'), true);
  assert.equal(state.hash, '#one');
  assert.deepEqual(state.scroll, { x: 0, y: 900 });
  assert.equal(state.apply('Go Back'), true);
  assert.equal(state.hash, undefined);
  assert.deepEqual(state.scroll, { x: 3, y: 20 });
  assert.equal(state.apply('Go Forward'), true);
  assert.equal(state.apply('Go Forward'), true);
  assert.equal(state.hash, '');
  assert.equal(state.generation, 0);
  state.apply('Go to URL', inlinePage('A'));
  state.apply('Go Back');
  assert.equal(state.generation, 2, 'the same address can belong to different documents');
});

test('opaque srcdoc replies require the expected source, null origin and current document token', () => {
  const source = {} as Window;
  const frame = { contentWindow: source, dataset: { viewerDocument: 'current' } };
  const event = { source, origin: 'null', data: { documentId: 'current', tabularius: 'called', id: 'call' } };
  assert.equal(viewerMessage(event, frame), true);
  assert.equal(viewerMessage({ ...event, source: {} as Window }, frame), false);
  assert.equal(viewerMessage({ ...event, source: null }, frame), false);
  assert.equal(viewerMessage({ ...event, origin: 'http://localhost' }, frame), false);
  assert.equal(viewerMessage({ ...event, data: { ...event.data, documentId: 'old' } }, frame), false);
  frame.dataset.viewerDocument = 'navigated';
  assert.equal(viewerMessage(event, frame), false, 'navigation invalidates stale acknowledgements');
});


test('the child bridge rejects wrong parent source/origin/document and suppresses restoration echoes for a cleared hash', async () => {
  const handlers = new Map<string, (event?: unknown) => unknown>();
  const messages: unknown[] = [];
  const calls: string[] = [];
  const scrolls: number[][] = [];
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  let hash = '#one';
  runInNewContext(webViewerBridge('https://app.example', 'document').slice(8, -9), {
    addEventListener: (type: string, handler: (event?: unknown) => unknown) => handlers.set(type, handler),
    parent, console, scrollX: 0, scrollY: 800, scrollTo: (x: number, y: number) => scrolls.push([x, y]),
    location: { get hash() { return hash; }, set hash(value: string) { hash = value; handlers.get('hashchange')?.(); } },
    window: { mark: () => calls.push('called') },
  });
  const message = (over: object = {}) => ({ source: parent, origin: 'https://app.example', data: { tabularius: 'call', documentId: 'document', fn: 'mark', args: [], id: 'call' }, ...over });
  await handlers.get('message')?.(message({ source: {} }));
  await handlers.get('message')?.(message({ origin: 'null' }));
  await handlers.get('message')?.(message({ origin: 'https://other.example' }));
  await handlers.get('message')?.(message({ data: { ...message().data, documentId: 'old' } }));
  assert.deepEqual(calls, []);
  assert.deepEqual(messages, []);
  await handlers.get('message')?.(message({ data: { tabularius: 'hash', documentId: 'document', hash: '', x: 3, y: 20 } }));
  assert.equal(hash, '');
  assert.deepEqual(scrolls, [[3, 20]]);
  assert.deepEqual(messages, [], 'restoration is not a new history entry');
  await handlers.get('message')?.(message());
  assert.deepEqual(calls, ['called']);
});

test('JavaScript acknowledgements reject wrong-source, wrong-origin, stale ids and navigated documents', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const handlers = new Set<(event: MessageEvent) => void>();
  let sent: { id: string; documentId: string } | undefined;
  const source = { postMessage: (data: typeof sent) => { sent = data; } } as unknown as Window;
  const frame = { contentWindow: source, dataset: { loaded: '1', viewerDocument: 'current' } } as unknown as HTMLIFrameElement;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (_: string, handler: (event: MessageEvent) => void) => handlers.add(handler),
    removeEventListener: (_: string, handler: (event: MessageEvent) => void) => handlers.delete(handler),
  } });
  try {
    let completed = false;
    const pending = callWebViewer(frame, 'mark', []).then(() => { completed = true; });
    const reply = { source, origin: 'null', data: { tabularius: 'called', id: sent!.id, documentId: sent!.documentId } };
    const dispatch = (event: typeof reply) => { for (const handler of handlers) handler(event as unknown as MessageEvent); };
    dispatch({ ...reply, source: {} as Window });
    dispatch({ ...reply, origin: 'https://app.example' });
    dispatch({ ...reply, data: { ...reply.data, id: 'old' } });
    dispatch({ ...reply, data: { ...reply.data, documentId: 'old' } });
    await Promise.resolve();
    assert.equal(completed, false);
    dispatch(reply);
    await pending;
    assert.equal(completed, true);
    assert.equal(handlers.size, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('Web Viewer Setup: Find mode draws the page only when asked to, and the loading bar follows the options', () => {
  const on = { interaction: true, findMode: true, progressBar: true, statusMessages: true, encodeUrl: true, jsBridge: false };
  const off = { ...on, findMode: false };
  // Browse mode: blank only while a script has yet to set an address.
  assert.equal(webViewerBlank(on, 'browse', undefined, true), true);
  assert.equal(webViewerBlank(on, 'browse', 'data:text/html,hi', true), false);
  assert.equal(webViewerBlank(on, 'layout', undefined, true), false);
  // Find mode: blank unless "Display content in Find mode" is on and there is a page to show.
  assert.equal(webViewerBlank(off, 'find', 'data:text/html,hi', true), true);
  assert.equal(webViewerBlank(undefined, 'find', 'data:text/html,hi', true), true);
  assert.equal(webViewerBlank(on, 'find', 'data:text/html,hi', true), false);
  assert.equal(webViewerBlank(on, 'find', undefined, true), true);
  // The progress bar and the status line are each on unless turned off; with both off nothing is drawn.
  assert.deepEqual(webViewerChrome(on), { progress: true, status: true });
  assert.deepEqual(webViewerChrome(undefined), { progress: true, status: true });
  assert.deepEqual(webViewerChrome({ ...on, progressBar: false }), { progress: false, status: true });
  assert.deepEqual(webViewerChrome({ ...on, statusMessages: false }), { progress: true, status: false });
  assert.equal(webViewerChrome({ ...on, progressBar: false, statusMessages: false }), undefined);
});

test('web viewers: only an https address on the file\'s list loads; "*." allows subdomains and not the bare domain', () => {
  const hosts = ['maps.example.com', '*.cdn.example.org'];
  assert.equal(allowedWebAddress('https://maps.example.com/a?b=1#c', hosts)?.href, 'https://maps.example.com/a?b=1#c');
  assert.equal(allowedWebAddress('HTTPS://Maps.Example.com/', hosts)?.hostname, 'maps.example.com');
  assert.equal(allowedWebAddress('https://x.cdn.example.org/', hosts)?.hostname, 'x.cdn.example.org');
  assert.equal(allowedWebAddress('https://a.b.cdn.example.org/', hosts)?.hostname, 'a.b.cdn.example.org');
  for (const refused of [
    'https://cdn.example.org/', 'https://evilcdn.example.org/', 'https://maps.example.com.evil.net/', 'https://evil.net/?maps.example.com',
    'http://maps.example.com/', 'https://maps.example.com:8443/', 'https://user:pw@maps.example.com/', 'https://maps.example.com@evil.net/',
    'javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a url', '', 'ftp://maps.example.com/', 'https://.cdn.example.org/',
  ]) assert.equal(allowedWebAddress(refused, hosts), undefined, refused);
  assert.equal(allowedWebAddress('https://maps.example.com/', []), undefined);
  assert.equal(allowedWebAddress('https://maps.example.com/', undefined), undefined);
  assert.equal(allowedWebAddress(undefined, hosts), undefined);
});

test('web viewers: a page from a web host is sent nothing by the window', async () => {
  const sent: unknown[] = [];
  const frame = { dataset: { external: '1', viewerDocument: 'doc' }, contentWindow: { postMessage: (m: unknown) => sent.push(m) } } as unknown as HTMLIFrameElement;
  await callWebViewer(frame, 'later', ['secret']);
  restoreViewer(frame, new ViewerState('https://x.example.com/'));
  assert.deepEqual(sent, []);
});

test('web viewers: a page from a web host sits in a sandbox with no referrer, at the address that was checked', () => {
  const web = allowedWebAddress('HTTPS://Maps.Example.com:443/a b', ['maps.example.com'])!;
  const attributes = externalFrameAttributes(web);
  assert.equal(attributes.src, 'https://maps.example.com/a%20b');
  assert.equal(attributes.referrerpolicy, 'no-referrer');
  assert.deepEqual(attributes.sandbox.split(' ').sort(), ['allow-forms', 'allow-same-origin', 'allow-scripts']);
});
