import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, num, type CalcContext } from '../src/index.ts';
import { mbsFunctionNames, mbsSupports } from '../src/functions.ts';
import { body, calls, grep, parse, source } from '../../scripts/test/sandbox-support.ts';

test('MBS Shell, SQL and unknown CURL commands refuse, including computed names and permissive host capabilities', () => {
  let effects = 0;
  const context: CalcContext = {
    executeSQL: () => { effects++; return [[num(42)]]; },
    network: { fetch: () => { effects++; return { status: 200, body: 'sent', headers: {} }; } },
    outbound: { request: () => { effects++; }, mail: () => { effects++; } },
  };
  for (const name of ['Shell.Execute', 'Shell.ExecuteWithInput', 'Shell.New', 'Shell.Run', 'SQL.Connect', 'SQL.Execute', 'SQL.Select', 'SQL.New',
    'Shell.FutureCommand', 'SQL.FutureCommand', 'CURL.FutureCommand']) {
    for (const variant of [name, name.toLowerCase(), name.toUpperCase()]) {
      assert.equal(mbsSupports(variant), false);
      for (const command of [JSON.stringify(variant), `"${variant.slice(0, 3)}" & "${variant.slice(3)}"`]) {
        const result = evaluateText(`MBS ( ${command} ; "sentinel" ; 1 ) & "|" & MBS ( "IsError" )`, context);
        assert.equal(result, `[MBS] ERROR: ${variant} is not available in Tabularius|1`);
      }
    }
  }
  assert.equal(effects, 0);
  assert.equal(evaluateText('MBS ( "Text.Length" ; "safe" ) & "|" & MBS ( "IsError" )', context), '4|0');
  for (const inherited of ['constructor', '__proto__', 'toString']) {
    assert.equal(evaluateText(`MBS ( "${inherited}" )`, context), `[MBS] ERROR: ${inherited} is not available in Tabularius`);
  }
});

test('registered CURL commands require their dedicated network capability and preserve session errors', () => {
  let effects = 0;
  const pluginSession = {};
  const context: CalcContext = { pluginSession, curlScope: {},
    network: { fetch: () => { effects++; return { status: 200, body: 'sent', headers: {} }; } },
    outbound: { request: () => { effects++; }, mail: () => { effects++; } },
  };
  const handle = evaluateText('MBS ( "CURL.New" )', context);
  assert.match(handle, /^\d+$/);
  assert.equal(evaluateText(`MBS ( "CURL.SetOptionURL" ; ${handle} ; "https://allowed.example/" )`, context), 'OK');
  assert.match(evaluateText(`MBS ( "CURL." & "Perform" ; ${handle} )`, context), /network access is off/);
  assert.equal(evaluateText('MBS ( "IsError" )', { pluginSession }), '1');
  assert.equal(effects, 0);
  assert.equal(evaluateText(`MBS ( "CURL.Perform" ; ${handle} )`, { ...context, curlFetch: () => {
    effects++;
    return { status: 200, body: 'sent', headers: {} };
  } }), '0');
  assert.equal(effects, 1);
  assert.equal(evaluateText('MBS ( "IsError" )', { pluginSession }), '0');
  assert.equal(evaluateText(`MBS ( "CURL.Release" ; ${handle} )`, context), 'OK');
});

test('source grep lists MBS dispatchers and rejects new Shell or SQL implementations', (t) => {
  const entries = grep('packages/calc/src', /(?:def|eager)\('MBS'/g);
  t.diagnostic(JSON.stringify(entries));
  assert.deepEqual(entries, [{ file: 'packages/calc/src/functions.ts', match: "def('MBS'" }]);
  assert.deepEqual(mbsFunctionNames().filter((n) => /^(shell|sql)\./i.test(n)), []);
  const tree = parse(source('packages/calc/src/functions.ts'));
  const dispatch = calls(tree, /^def$/).filter((c) => c.arguments[0]?.getText() === "'MBS'");
  assert.equal(dispatch.length, 1);
  assert.equal(calls(dispatch[0], /^mbsFunction$/).length, 1);
  assert.equal(calls(body(tree, 'mbsFunction'), /^Object\.hasOwn$/).length, 1);
  // A second table lookup could bypass the guard, even inside the existing dispatcher.
  assert.deepEqual([...source('packages/calc/src/functions.ts').matchAll(/MBS\[name\.toLowerCase\(\)\]/g)].map((m) => m[0]), ['MBS[name.toLowerCase()]']);
});
