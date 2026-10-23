// Generated handles only; fake time keeps the idle-expiry cases fast and deterministic.
import { afterEach, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, evaluateText } from '../src/index.ts';
import { closeMbsJavaScriptSession, MBS_JS_COOL_DOWN_LIMIT, MBS_JS_HANDLES_PER_SESSION } from '../src/mbs-js.ts';
import { JavaScriptContext, JavaScriptResourceError, JS_CONTEXT_LIMIT, JS_CONTEXT_ACCOUNT_LIMIT, JS_COOL_DOWN_MS, stopJavaScript } from '../src/javascript.ts';

const IDLE_MS = 60_000;
afterEach(async () => { await stopJavaScript(); });

function session(account?: string) {
  const scope = {};
  const mbs = (name: string, ...args: string[]) => evaluateText(
    `MBS ( ${[name, ...args].map(v => JSON.stringify(v)).join(' ; ')} )`, { pluginSession: scope, pluginAccount: account });
  const make = (name?: string) => {
    const ref = mbs('JS.New', ...(name ? [name] : []));
    assert.match(ref, name ? new RegExp(`^${name}$`) : /^\d+$/);
    return ref;
  };
  return { scope, mbs, make };
}

function clock(t: TestContext) {
  let monotonic = 0;
  t.mock.method(performance, 'now', () => monotonic);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
  return {
    advance(ms: number, fireTimers = true) {
      monotonic += ms;
      if (fireTimers) t.mock.timers.tick(ms);
    },
  };
}

function fillPool() {
  const owners = Array.from({ length: JS_CONTEXT_LIMIT / MBS_JS_HANDLES_PER_SESSION }, () => session());
  const refs = owners.map(s => Array.from({ length: MBS_JS_HANDLES_PER_SESSION }, () => s.make()));
  return { owners, refs };
}

test('MBS JS account capacity is reclaimed after idle expiry, timeout and stopping all sandboxes', async t => {
  const time = clock(t);
  const fill = () => Array.from({ length: JS_CONTEXT_ACCOUNT_LIMIT }, () => new JavaScriptContext('account'));
  fill();
  assert.throws(() => new JavaScriptContext('account'), /limit.*account/);
  time.advance(IDLE_MS, false); // Account allocation must also sweep overdue timers on a busy event loop.
  const next = fill();
  assert.throws(() => new JavaScriptContext('account'), /limit.*account/);
  assert.throws(() => next[0].call({ op: 'json', source: 'for (;;) {}' }), /took longer/);
  const replacement = new JavaScriptContext('account');
  assert.throws(() => new JavaScriptContext('account'), /limit.*account/);
  assert.equal(replacement.call({ op: 'json', source: '42' }).value, '42');
  await stopJavaScript();
  fill();
  assert.throws(() => new JavaScriptContext('account'), /limit.*account/);
});

test('MBS JS timeout cools the entire session for 30 seconds despite clock changes', t => {
  const time = clock(t);
  const owner = session(), other = session();
  const healthy = owner.make(), runaway = owner.make(), spare = owner.make();
  assert.equal(owner.mbs('JS.Evaluate', healthy, 'var saved = 42; saved'), '42');
  assert.match(owner.mbs('JS.Evaluate', runaway, 'for (;;) {}'), /took longer/);
  const calls = t.mock.method(JavaScriptContext.prototype, 'call');
  const cooling = /^\[MBS\] ERROR:.*recently/;
  const refused = () => {
    assert.match(owner.mbs('JS.New', 'retry'), cooling);
    assert.match(owner.mbs('JS.Evaluate', healthy, 'for (;;) {}'), cooling);
    assert.match(owner.mbs('JS.GetGlobalProperty', healthy, 'saved'), cooling);
    assert.match(owner.mbs('JS.SetGlobalPropertyValue', healthy, 'saved', 'lost'), cooling);
  };
  for (let i = 0; i < 3; i++) refused();
  t.mock.timers.setTime(Date.now() + 86_400_000);
  refused();
  t.mock.timers.setTime(Date.now() - 2 * 86_400_000);
  time.advance(JS_COOL_DOWN_MS - 1);
  refused();
  assert.equal(calls.mock.callCount(), 0, 'cooling requests never enter the sandbox');
  assert.equal(owner.mbs('JS.Release', spare), 'OK', 'release remains available during cool-down');
  assert.equal(other.mbs('JS.Evaluate', other.make(), '7'), '7', 'other sessions remain usable');
  time.advance(1);
  assert.equal(owner.mbs('JS.Evaluate', healthy, 'saved'), '42', 'refusals leave existing state intact');
  assert.equal(owner.make('retry'), 'retry', 'refused allocations reserve neither names nor capacity');
  assert.match(owner.mbs('JS.Evaluate', runaway, '1'), /^\[MBS\] ERROR:/);
});

test('MBS JS account cool-down survives session close and expires despite wall-clock changes', t => {
  const time = clock(t);
  const account = JSON.stringify(['Generated.sqlite', 'admin']);
  const owner = session(account), retained = session(account);
  const healthy = retained.make(), spare = retained.make();
  assert.equal(retained.mbs('JS.Evaluate', healthy, 'var saved = 42; saved'), '42');
  assert.match(owner.mbs('JS.Evaluate', owner.make(), 'for (;;) {}'), /took longer/);
  closeMbsJavaScriptSession(owner.scope);
  const calls = t.mock.method(JavaScriptContext.prototype, 'call');
  const cooling = /^\[MBS\] ERROR:.*recently/;
  const refused = () => {
    const next = session(account);
    assert.match(next.mbs('JS.New'), cooling, 'a new session shares the account deadline');
    closeMbsJavaScriptSession(next.scope);
    assert.match(retained.mbs('JS.New', 'retry'), cooling);
    for (const [name, ...args] of [
      ['JS.Evaluate', 'for (;;) {}'], ['JS.EvaluateToString', 'for (;;) {}'],
      ['JS.GetGlobalProperty', 'saved'], ['JS.GetGlobalPropertyValue', 'saved'],
      ['JS.SetGlobalProperty', 'saved', '0'], ['JS.SetGlobalPropertyValue', 'saved', '0'],
    ]) assert.match(retained.mbs(name, healthy, ...args), cooling);
  };
  refused();
  t.mock.timers.setTime(Date.now() + 86_400_000);
  refused();
  t.mock.timers.setTime(Date.now() - 2 * 86_400_000);
  time.advance(JS_COOL_DOWN_MS - 1);
  refused();
  assert.equal(calls.mock.callCount(), 0, 'all account refusals skip the sandbox');
  assert.equal(retained.mbs('JS.Release', spare), 'OK');
  for (const key of [['Generated.sqlite', 'other'], ['Other.sqlite', 'admin']]) {
    const other = session(JSON.stringify(key));
    assert.equal(other.mbs('JS.Evaluate', other.make(), '7'), '7', 'other accounts and files remain usable');
    closeMbsJavaScriptSession(other.scope);
  }
  time.advance(1);
  assert.equal(retained.mbs('JS.Evaluate', healthy, 'saved'), '42');
  assert.equal(retained.make('retry'), 'retry', 'refused allocations reserve neither names nor capacity');
  closeMbsJavaScriptSession(retained.scope);
  const next = session(account);
  assert.equal(next.mbs('JS.Evaluate', next.make(), '6 * 7'), '42', 'new sessions recover at the deadline');
  closeMbsJavaScriptSession(next.scope);
});

test('MBS JS account cool-down registry evicts only its oldest entry at the bound and expires entries', t => {
  const time = clock(t);
  // Simulate exhaustion to exercise the registry bound without starting a thousand sandbox processes.
  t.mock.method(JavaScriptContext.prototype, 'call', function (this: JavaScriptContext) {
    void this.close();
    throw new JavaScriptResourceError(ERR.calculation, 'simulated exhaustion');
  });
  const key = (i: number) => JSON.stringify(['Bound.sqlite', `account${i}`]);
  for (let i = 0; i <= MBS_JS_COOL_DOWN_LIMIT; i++) {
    const owner = session(key(i));
    assert.match(owner.mbs('JS.Evaluate', owner.make(), '1'), /simulated exhaustion/);
    closeMbsJavaScriptSession(owner.scope);
  }
  const oldest = session(key(0));
  oldest.make();
  closeMbsJavaScriptSession(oldest.scope);
  for (let i = 1; i <= MBS_JS_COOL_DOWN_LIMIT; i++) {
    assert.match(session(key(i)).mbs('JS.New'), /^\[MBS\] ERROR:.*recently/);
  }
  time.advance(JS_COOL_DOWN_MS);
  // Inserting another deadline also sweeps expired accounts that never return.
  const fresh = session(key(MBS_JS_COOL_DOWN_LIMIT + 1));
  assert.match(fresh.mbs('JS.Evaluate', fresh.make(), '1'), /simulated exhaustion/);
  closeMbsJavaScriptSession(fresh.scope);
  for (const i of [1, MBS_JS_COOL_DOWN_LIMIT]) {
    const expired = session(key(i));
    expired.make();
    closeMbsJavaScriptSession(expired.scope);
  }
  assert.match(session(key(MBS_JS_COOL_DOWN_LIMIT + 1)).mbs('JS.New'), /^\[MBS\] ERROR:.*recently/);
});

const SERVER_FULL = '[MBS] ERROR: JavaScript context limit reached for this server (32)';

/** b, c and d hold eight handles each and e holds `8 - spare`, all made first, so they are the oldest in the pool. */
function fillWithOthers(spare: number) {
  const holders = ['b', 'c', 'd', 'e'].map(name => ({ name, s: session(name), refs: [] as string[] }));
  for (const h of holders) for (let i = 0; i < (h.name === 'e' ? 8 - spare : 8); i++) h.refs.push(h.s.make());
  return holders;
}
const untouched = (holders: ReturnType<typeof fillWithOthers>) => {
  for (const h of holders) for (const ref of h.refs) assert.equal(h.s.mbs('JS.Evaluate', ref, '1'), '1', `${h.name}'s handles are untouched`);
};

test('MBS JS a full pool drops the requesting account\'s own least recently used handle, never another account\'s', () => {
  const holders = fillWithOthers(2);
  const a = session('a');
  const mine = [a.make(), a.make()];
  assert.equal(JS_CONTEXT_LIMIT, 32);
  for (let round = 0; round < 5; round++) {
    const fresh = a.make();
    assert.match(a.mbs('JS.Evaluate', mine[0], '1'), /^\[MBS\] ERROR:/, 'its own least recently used handle was dropped');
    mine.shift();
    mine.push(fresh);
  }
  assert.equal(a.mbs('JS.Evaluate', mine[0], 'var saved = 42; saved'), '42', 'a handle in use keeps its state');
  untouched(holders);
});

test('MBS JS an account holding none is refused by a full pool, and nothing is dropped', () => {
  const holders = fillWithOthers(0);
  const newcomer = session('f');
  assert.equal(newcomer.mbs('JS.New'), SERVER_FULL);
  assert.equal(newcomer.mbs('IsError'), '1');
  untouched(holders);
  // The attacker's loop: nothing to release, nothing gained.
  for (let i = 0; i < 40; i++) assert.equal(newcomer.mbs('JS.New'), SERVER_FULL);
  untouched(holders);
  // A caller with no account never drops anyone's handle either.
  const anonymous = session();
  assert.equal(anonymous.mbs('JS.New'), SERVER_FULL);
  untouched(holders);
  // Room appears only when a handle is released.
  assert.equal(holders[0].s.mbs('JS.Release', holders[0].refs.shift()!), 'OK');
  assert.match(newcomer.make(), /^\d+$/);
});

test('MBS JS a session at its own handle limit is still refused', () => {
  const { owners } = fillPool();
  assert.match(owners[0].mbs('JS.New', 'ninth'), /^\[MBS\] ERROR:.*session/);
});

test('MBS JS idle handles expire across retained sessions without another request', t => {
  const time = clock(t);
  const { owners, refs } = fillPool();
  time.advance(IDLE_MS);
  session().make();
  for (const [i, owner] of owners.entries()) {
    for (const ref of refs[i]) assert.match(owner.mbs('JS.Release', ref), /^\[MBS\] ERROR:/);
    // The old references do not accumulate against the session's cap.
    for (let n = 0; n < MBS_JS_HANDLES_PER_SESSION; n++) owner.make();
    time.advance(IDLE_MS);
  }
});

test('MBS JS use moves the idle deadline and cancels the old expiry', t => {
  const time = clock(t);
  const active = new JavaScriptContext(), idle = new JavaScriptContext();
  time.advance(IDLE_MS * 3 / 4);
  assert.equal(active.call({ op: 'json', source: '42' }).value, '42');
  time.advance(IDLE_MS / 4);
  assert.equal(idle.closed, true);
  assert.equal(active.closed, false, 'using one handle extends only its deadline');
  time.advance(IDLE_MS * 3 / 4 - 1);
  assert.equal(active.closed, false);
  time.advance(1);
  assert.equal(active.closed, true);
});

test('MBS JS idle expiry uses elapsed time even when the wall clock moves forwards or backwards', t => {
  const time = clock(t);
  const context = new JavaScriptContext();
  t.mock.timers.setTime(Date.now() + 86_400_000);
  assert.equal(context.call({ op: 'json', source: '42' }).value, '42');
  t.mock.timers.setTime(Date.now() - 2 * 86_400_000);
  time.advance(IDLE_MS, false); // Timers have not run yet (e.g. a busy event loop).
  assert.throws(() => context.call({ op: 'json', source: '43' }), /context is closed/);
  assert.equal(context.closed, true);
});

test('MBS JS allocation reclaims overdue handles before testing global and session capacity', t => {
  const time = clock(t);
  const { owners, refs } = fillPool();
  time.advance(IDLE_MS, false);
  // The full owner's own expired entries must not prevent it reaching the global sweep.
  owners[0].make();
  session().make();
  assert.match(owners[0].mbs('JS.Evaluate', refs[0][0], '1'), /^\[MBS\] ERROR:/);
});

test('MBS JS idle expiry stops a started sandbox process', t => {
  const time = clock(t);
  const kill = t.mock.method(process, 'kill'); // Calls the real OS function and records its result.
  const context = new JavaScriptContext();
  context.call({ op: 'json', source: '42' });
  const pid = context.processId!;
  assert.ok(pid > 0);
  time.advance(IDLE_MS);
  // Read the PID first: checking `closed` also reaps overdue contexts on demand.
  assert.equal(context.processId, undefined);
  assert.equal(context.closed, true);
  // SIGKILL was actually delivered to this child. It may remain a zombie until the OS reaps it.
  assert.ok(kill.mock.calls.some(c => c.arguments[0] === pid && c.arguments[1] === 'SIGKILL' && c.result === true));
});
