import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateText, type CalcContext, type PluginMail } from '../../calc/src/index.ts';
import { stopJavaScript } from '../../store/src/javascript.ts';
import { PluginRegistry, parseManifest } from '../src/index.ts';
import { sandboxedCalls } from '../src/sandboxed.ts';

after(async () => { await stopJavaScript(); });
let serial = 0;
function context(permissions: Record<string, unknown>, extra: Partial<CalcContext> = {}, secrets: () => Record<string, string> = () => ({ KEY: 'value' })): CalcContext {
  const parsed = parseManifest({ id: `org.example.boundary${++serial}`, name: 'Boundary', version: '1.0.0', api: '^1.0', publisher: 'Tests', main: 'main.js', permissions,
    functions: [{ name: 'Boundary_Request', min: 1, max: 1 }, { name: 'Boundary_Mail', min: 0, max: 0 }, { name: 'Boundary_Secret', min: 1, max: 1 }, { name: 'Boundary_Bad', min: 0, max: 0 }],
  });
  assert.ok(parsed.ok);
  const registry = new PluginRegistry();
  registry.install(parsed.manifest, sandboxedCalls(parsed.manifest, `const functions = {
    Boundary_Request: (url) => tabularius.http.request({ method: 'post', url, body: 'abc' }).status,
    Boundary_Mail: () => tabularius.mail.send({ from: 'a@example.test', to: 'b@example.test', subject: 'Test', body: 'Hello' }),
    Boundary_Secret: (name) => tabularius.secrets.get(name),
    Boundary_Bad: () => __tabulariusAsk('invented-operation'),
  };`, secrets));
  registry.enable('Test', parsed.manifest.id);
  return { plugin: registry.lookup('Test'), ...extra };
}

test('the live network adapter receives the request and a fail-closed redirect predicate', () => {
  let calls = 0;
  // In-memory adapters only: this test never makes a network request or sends mail.
  const ctx = context({ network: ['api.example.com', '*.example.net'] }, { network: { fetch: (_via, req) => {
    calls++;
    assert.equal(req.method, 'POST'); assert.equal(req.url, 'https://api.example.com/x'); assert.equal(req.body, 'abc');
    assert.equal(req.allows('https://api.example.com/next'), true);
    assert.equal(req.allows('https://eu.example.net/x'), true);
    for (const url of ['https://evil.example.org', 'https://example.net', 'ftp://api.example.com/x', 'not a URL']) assert.equal(req.allows(url), false, url);
    return { status: 201, body: 'created', headers: {} };
  } } });
  assert.equal(evaluateText('Boundary_Request ( "https://api.example.com/x" )', ctx), '201');
  assert.equal(calls, 1);
  assert.throws(() => evaluate('Boundary_Request ( "not a URL" )', ctx), /isn't a web address/);
  assert.equal(calls, 1, 'malformed addresses never reach the adapter');
});

test('mail permissions are enforced before a live adapter, and unavailable mail gives the defined refusal', () => {
  const messages: PluginMail[] = [];
  const mailer = { send: (_via: string, message: PluginMail) => { messages.push(message); } };
  assert.throws(() => evaluate('Boundary_Mail', context({ mail: false }, { mailer })), /may not send mail/);
  assert.equal(messages.length, 0);
  assert.equal(evaluateText('Boundary_Mail', context({ mail: true }, { mailer })), '1');
  assert.equal(messages.length, 1); assert.equal(messages[0].to, 'b@example.test');
  assert.throws(() => evaluate('Boundary_Mail', context({ mail: true })), /mail isn't available/);
});

test('unknown host operations are refused even when a plug-in directly calls the internal request primitive', () => {
  assert.throws(() => evaluate('Boundary_Bad', context({})), /asked the host for "invented-operation"/);
});
