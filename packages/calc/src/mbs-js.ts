// Public MBS contracts (no solution/corpus-derived behaviour):
// https://mbsplugins.eu/JSNew.shtml
// https://mbsplugins.eu/JSRelease.shtml (old name: JS.Free)
// https://mbsplugins.eu/JSEvaluate.shtml (JSON text)
// https://mbsplugins.eu/JSEvaluateToString.shtml (String conversion)
// https://mbsplugins.eu/JSSetGlobalProperty.shtml (JSON, or plain text since 11.3)
// https://mbsplugins.eu/JSSetGlobalPropertyValue.shtml (number, otherwise FileMaker text)
// https://mbsplugins.eu/JSGetGlobalProperty.shtml (JSON text)
// https://mbsplugins.eu/JSGetGlobalPropertyValue.shtml (number/text, objects as JSON)
//
// These pages promise an error but don't publish exact diagnostics for invalid handles, arity, duplicate names
// or unrepresentable JSON. Those cases fail through the registry's [MBS] ERROR: convention, with local diagnostic
// text; no guessed empty/zero/OK result. Time, heap, input/result and handle caps are Tabularius security policy.
// JS.SetVariable/GetVariable are not documented names and deliberately remain unavailable.

import { JavaScriptContext, JavaScriptResourceError, JS_COOL_DOWN_MS, type JavaScriptContextRequest } from '../../store/src/javascript.ts';
import { CalcError, num, text, type Value } from './values.ts';
import { MbsError } from './mbs-text.ts';

export const MBS_JS_HANDLES_PER_SESSION = 8;
export const MBS_JS_COOL_DOWN_LIMIT = 1000;
const sessions = new WeakMap<object, Map<string, JavaScriptContext>>();
const ended = new WeakSet<object>();
// Server-wide elapsed-time deadlines use the engine's [store.path, account] key, so closing a session cannot
// bypass them. Expired entries are removed on access/insertion; the oldest goes first at the cap.
const cooling = new Map<string, number>();
// Direct calculation callers without an account key retain session isolation without retaining their sessions.
const sessionCooling = new WeakMap<object, number>();
const cleanup = new FinalizationRegistry<Map<string, JavaScriptContext>>(handles => {
  for (const handle of handles.values()) void handle.close();
});
// Opaque numbers are never reused, including across sessions. MBS does not specify their starting value.
let nextHandle = 1;

/** Release synchronously at session end; a resumed in-flight script must not recreate its handles. */
export function closeMbsJavaScriptSession(session: object): void {
  ended.add(session);
  sessionCooling.delete(session);
  const owned = sessions.get(session);
  if (!owned) return;
  sessions.delete(session);
  cleanup.unregister(owned);
  for (const context of owned.values()) void context.close();
  owned.clear();
}

function handles(session: object, account?: string): Map<string, JavaScriptContext> {
  if (ended.has(session)) throw new MbsError('JavaScript session has ended');
  checkCoolDown(session, account);
  let found = sessions.get(session);
  if (!found) {
    found = new Map();
    sessions.set(session, found);
    cleanup.register(session, found, found);
  }
  return found;
}

interface Input { values: Value[]; texts: string[] }
type MbsJavaScript = (input: Input, session: object, account?: string) => Value;

function checkCoolDown(session: object, account?: string): void {
  const until = account === undefined ? sessionCooling.get(session) : cooling.get(account);
  if (until === undefined) return;
  if (performance.now() < until) throw new MbsError('JavaScript ran out of time or memory recently, so it is not run again yet');
  if (account === undefined) sessionCooling.delete(session);
  else cooling.delete(account);
}

function cool(session: object, account?: string): void {
  const now = performance.now();
  if (account === undefined) {
    sessionCooling.set(session, now + JS_COOL_DOWN_MS);
    return;
  }
  for (const [owner, until] of cooling) if (until <= now) cooling.delete(owner);
  if (cooling.size >= MBS_JS_COOL_DOWN_LIMIT) cooling.delete(cooling.keys().next().value!);
  cooling.set(account, now + JS_COOL_DOWN_MS);
}

function arity(input: Input, min: number, max = min): void {
  if (input.values.length < min || input.values.length > max) throw new MbsError('Invalid number of JavaScript parameters');
}

function handle(session: object, ref: string): JavaScriptContext {
  const found = sessions.get(session)?.get(ref);
  if (!found || found.closed) throw new MbsError('Invalid JavaScript reference');
  return found;
}

function call(session: object, ref: string, request: JavaScriptContextRequest, account?: string): Value {
  checkCoolDown(session, account);
  try { return handle(session, ref).call(request); }
  catch (e) {
    if (e instanceof JavaScriptResourceError) cool(session, account);
    if (e instanceof CalcError) throw new MbsError(e.message);
    throw e;
  }
}

export const MBS_JS: Record<string, MbsJavaScript> = {
  'js.new': (input, session, account) => {
    arity(input, 0, 1);
    const owned = handles(session, account);
    // Closed processes no longer count toward the live-handle cap, but their references never become valid again.
    for (const [ref, context] of owned) if (context.closed) owned.delete(ref);
    if (owned.size >= MBS_JS_HANDLES_PER_SESSION) throw new MbsError('JavaScript handle limit reached for this session');
    const named = input.texts.length > 0;
    const ref = named ? input.texts[0] : String(nextHandle++);
    // Numeric names could alias auto-assigned references. Neither that collision nor duplicate names are
    // specified by MBS: refuse them rather than replacing a live context or silently returning it.
    if (named && (!ref || ref.length > 256 || /^\d+$/.test(ref))) throw new MbsError('Unsupported JavaScript reference name');
    if (owned.has(ref)) throw new MbsError('JavaScript reference already exists');
    if (!Number.isSafeInteger(nextHandle)) throw new MbsError('JavaScript reference limit reached');
    try { owned.set(ref, new JavaScriptContext(account)); }
    catch (e) {
      if (e instanceof CalcError) throw new MbsError(e.message);
      throw e;
    }
    return named ? text(ref) : num(Number(ref));
  },
  'js.release': (input, session) => {
    arity(input, 1);
    const ref = input.texts[0];
    void handle(session, ref).close();
    sessions.get(session)!.delete(ref);
    return text('OK');
  },
};
MBS_JS['js.free'] = MBS_JS['js.release'];

for (const [name, op] of [['js.evaluate', 'json'], ['js.evaluatetostring', 'string']] as const) {
  MBS_JS[name] = (input, session, account) => {
    arity(input, 2);
    return call(session, input.texts[0], { op, source: input.texts[1] }, account);
  };
}
for (const [name, op] of [['js.getglobalproperty', 'get'], ['js.getglobalpropertyvalue', 'getValue']] as const) {
  MBS_JS[name] = (input, session, account) => {
    arity(input, 2);
    return call(session, input.texts[0], { op, property: input.texts[1] }, account);
  };
}
for (const [name, op] of [['js.setglobalproperty', 'set'], ['js.setglobalpropertyvalue', 'setValue']] as const) {
  MBS_JS[name] = (input, session, account) => {
    arity(input, 3);
    const value = op === 'setValue' && input.values[2].type === 'number' ? input.values[2].value : input.texts[2];
    if (typeof value === 'number' && !Number.isFinite(value)) throw new MbsError('Unsupported JavaScript number');
    return call(session, input.texts[0], { op, property: input.texts[1], value }, account);
  };
}
