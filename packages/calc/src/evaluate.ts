// Tree-walking evaluator for parsed FileMaker calculations.

import { markExecutionRefusal, rethrowExecutionRefusal } from './execution-refusal.ts';
import { withRegexBudget } from './regex-guard.ts';
import { ComplexityError } from './complexity-error.ts';
import { FUNCTIONS, pluginNotInstalled, type Fn } from './functions.ts';
import { getParameter } from './get.ts';
import { unknownFunctionId } from './unknown.ts';
import { concatRuns } from './styled.ts';
import { checkCalcTextSize } from './text-budget.ts';
import { Decimal, decimalFunction, decimalNumberText, supportsDecimalFunction, withDecimalBudget } from './decimal.ts';
import { assertTraversalDepth, NameTable, parse, type CalcNames, type Node } from './parser.ts';
import {
  CalcError, ERR, EMPTY, asBoolean, asNumber, asNumberOrEmpty, asText, bool, exactOf, exactPow, fromExact, isBeyondDouble, isEmpty, isOverlongWholeText, num, text, tidy,
  type DateStyle, type Value,
} from './values.ts';

/** A field as a calculation names it: occurrence is absent for the context table's own fields. */
export interface FieldRef {
  occurrence?: string;
  field: string;
  /** 1-based repetition. */
  repetition: number;
}

/**
 * What a calculation can see. Every member is optional: a context that
 * leaves one out makes the matching formulas fail with an error, as a
 * FileMaker calculation does when a field or function is unavailable.
 */
/** A custom function as a calculation sees it. */
export interface CustomFunctionDef {
  parameters: string[];
  formula: string;
  /** Runs a function written in JavaScript on its evaluated arguments. */
  call?(args: Value[]): Value;
}

export interface CalcContext {
  /** Host platform override for deterministic evaluation and platform tests. */
  platform?: NodeJS.Platform;
  /** Whether this calculation runs without a person at a client (inferred for MBS IsServer). */
  headless?: boolean;
  /** Repetition being evaluated in a repeating calculation field; defaults to 1. */
  calculationRepetition?: number;
  /** Field and occurrence names, so names with spaces parse. Build once with `new NameTable(...)` and reuse. */
  names?: NameTable | CalcNames;
  /** The context table occurrence's name; TO::Field with this occurrence reads the current record. */
  occurrence?: string;
  /**
   * A field's value in the current record, or in the first related record
   * for another occurrence. Undefined means the field does not exist.
   */
  field?(ref: FieldRef): Value | undefined;
  /**
   * Every value a field reference stands for in an aggregate (Sum, Count,
   * List, ...): one per related record for another occurrence. Defaults to
   * the single value from field().
   */
  related?(ref: FieldRef): Value[] | undefined;
  /**
   * LookupNext: the related field's value in the record whose match value is the next lower or higher than the
   * current record's, when no record matches; undefined when the host can't say (the result is then empty).
   */
  lookupNext?(ref: FieldRef, direction: 'lower' | 'higher'): Value | undefined;
  /** Number of repetitions a field has (for Sum ( repeatingField ) and similar); default 1. */
  repetitions?(ref: Omit<FieldRef, 'repetition'>): number;
  /**
   * GetSummary ( summaryField ; breakField ): the summary over the records
   * that share the current record's break field value. Without it, the
   * summary field's own value (the total) is used.
   */
  summary?(field: FieldRef, breakField: FieldRef): Value | undefined;
  /** Get ( name ) values the host knows; built-in defaults cover dates, times, UUIDs and the like. */
  get?(name: string): Value | undefined;
  /** Reader-placeholder notices. Messages contain IDs only, never calculation text. */
  notice?(message: string): void;
  /** $local and $$global variables (name includes the $ signs). */
  variable?(name: string, repetition: number): Value | undefined;
  setVariable?(name: string, repetition: number, value: Value): void;
  /**
   * Custom functions defined in the file. One written in JavaScript comes with `call`, which runs it (in a sandbox)
   * on its evaluated arguments; `formula` is then its JavaScript.
   */
  customFunction?(name: string): CustomFunctionDef | undefined;
  /**
   * A plug-in function enabled for this file, by name or by the reader's ⟨OWNR:n⟩ marker. Looked up after
   * FileMaker's own functions and before custom functions; without it, plug-in calls give "?" as uninstalled.
   */
  plugin?(name: string): PluginFunction | undefined;
  /**
   * True when a function belongs to a built-in plug-in pack (BaseElements) that the admin turned off for this file: it
   * then gives "?", as a plug-in that isn't installed does.
   */
  builtinOff?(name: string): boolean;
  /** Get ( InstalledFMPlugins ): the plug-ins the host has, and whether each is enabled for this file. */
  installedPlugins?(): InstalledPlugin[];
  /**
   * GetEmbedding ( account ; model ; text ): the text's embedding as container data, from the host's AI. Without it
   * (a field calculation, or no AI) GetEmbedding is an error.
   */
  embedding?(account: string, model: string, input: string): Value;
  /** GetRAGSpaceInfo ( account {; spaceId} ): the RAG spaces of this file as JSON text, or undefined when there is no such RAG account. */
  ragSpaceInfo?(account: string, spaceId?: string): string | undefined;
  /** Design functions (TableNames, FieldNames, LayoutNames, ...) by name, with evaluated arguments. */
  design?(name: string, args: Value[]): Value | undefined;
  /** ExecuteSQL: rows of values for a query with ? parameters. */
  executeSQL?(query: string, args: Value[]): Value[][];
  /** GetPersistentData: the entry stored by Configure Persistent Data, or undefined. */
  persistentData?(name: string, instance: string): Value | undefined;
  /** ListPersistentDataIDs: the instance IDs stored under a name. */
  persistentDataIds?(name: string): string[];
  /**
   * Location and LocationValues (FileMaker Go): where the person's device is, as its browser reported it for the
   * script being run; undefined when it isn't known (no permission, or no device), and the functions give empty.
   */
  location?(): DeviceLocation | undefined;
  /** Date order (and two-digit padding) for converting dates to and from text; default MDY. */
  dateOrder?: DateStyle;
  /** Clock for Get ( CurrentDate ) and friends; default the system clock. */
  now?(): Date;
  /**
   * Local text files for plug-in functions (BE_FileReadText and friends), kept
   * by the host to its own folders: a path outside them reads as missing and
   * writes nothing.
   */
  files?: PluginFiles;
  /**
   * What plug-in state belongs to (MBS's compiled regular expressions): the script session, which lasts across the
   * steps and runs of one person's session. Without it, state lasts for this one context object, except JS.*,
   * whose persistent sandbox handles require a script session.
   */
  pluginSession?: object;
  /** Optional DynaPDF functions provided by the script host. */
  mbsCall?(name: string, args: Value[]): Value | undefined;
  /** Opaque originating database/account key for JavaScript handle quotas and cool-downs, shared across sessions. */
  pluginAccount?: string;
  /**
   * Outbound test mode for plug-in functions: web requests and mail are
   * recorded, and nothing is sent (calculations can't wait for a reply).
   * Absent, those functions fail as before.
   */
  outbound?: PluginOutbound;
  /** Real web requests for plug-in functions (see PluginNetwork). Outbound test mode takes its place when set. */
  network?: PluginNetwork;
  /** Synchronous bridge to the script engine's guarded URL transport. */
  curlFetch?(request: MbsCurlRequest): PluginResponse;
  /** Synchronous bridge to the script engine's guarded FTP client (BE_FTP_*). */
  ftpFetch?(request: PluginFtpRequest): PluginFtpResponse;
  /** CURL handles last for one script run, including calls to child scripts. */
  curlScope?: object;
  /** Real mail for plug-in functions, where the operator switched sending on (see PluginMailer). Outbound test mode takes its place when set. */
  mailer?: PluginMailer;
  /** Mail for the built-in BaseElements functions (BE_SMTPSend), where the operator set up sending and scripts may use the network. Outbound test mode takes its place when set. */
  builtinMailer?: PluginMailer;
  /**
   * Called after each part of the formula is worked out, innermost first,
   * with its nesting depth (1 for the whole formula): the result, or the
   * error that stopped it. For explaining a value step by step.
   */
  trace?(node: Node, result: Value | CalcError, depth: number): void;
}

export interface DeviceLocation {
  latitude: number;
  longitude: number;
  /** Meters above sea level, when the device knows. */
  altitude?: number;
  /** Meters either way. */
  horizontalAccuracy: number;
  verticalAccuracy?: number;
  /** When it was measured (ms since 1970). */
  at: number;
}

/** A real answer to a plug-in's web request. */
export interface PluginResponse {
  /** 0 when the request didn't get an answer (see error). */
  status: number;
  body: string;
  /** The body as it came, where the request asked for it (wantBytes); body is then empty. */
  bytes?: Uint8Array;
  /** Lowercase names. */
  headers: Record<string, string>;
  error?: string;
  headerText?: string;
}

export interface MbsCurlRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** The body as bytes (a file to send); body is then absent. */
  bodyBytes?: Uint8Array;
  /** Answer with the body's bytes (PluginResponse.bytes), for a file to save. */
  wantBytes?: boolean;
  follow: boolean;
  maxRedirs: number;
  aws?: { spec: string; user: string };
  /** The function asking, for messages (CURL.Perform when absent). */
  via?: string;
}

/** An FTP upload or delete for BaseElements' FTP functions (see packages/scripts/src/ftp.ts). */
export interface PluginFtpRequest {
  op: 'put' | 'delete';
  url: string;
  user: string;
  password: string;
  bytes?: Uint8Array;
  /** The function asking, for messages. */
  via: string;
}

/** How an FTP request went: PluginResponse's status is the server's final reply code, and error says why not, with curl's number for it in `code`. */
export interface PluginFtpResponse extends PluginResponse {
  code?: number;
}

/**
 * Real web requests for plug-ins, when the host lets scripts reach the network. A calculation can't wait for a
 * reply, so the host throws HostWait until it has made the request and the call is run again; it never makes
 * the same request twice in one step.
 */
export interface PluginNetwork {
  fetch(via: string, req: { method: string; url: string; headers: Record<string, string>; body: string; allows(url: string): boolean }): PluginResponse;
}

/** A message a plug-in sends: the addresses as the plug-in wrote them, attachments as paths in the scripts' folders. */
export interface PluginMail { from: string; to: string; cc: string; bcc: string; subject: string; body: string; attachments: string[] }

export interface PluginMailer {
  /** Sends a message through the operator's mail account, or throws why it wasn't sent. */
  send(via: string, m: PluginMail): void;
}

export interface PluginOutbound {
  /** A web request a plug-in would make; recorded, never sent. */
  request(via: string, method: string, url: string, bodyBytes: number): void;
  /** A message a plug-in would send; captured, never sent to its recipients. */
  mail(via: string, m: { from: string; to: string; cc: string; bcc: string; subject: string; body: string; attachments: string[] }): void;
}

/** A plug-in the host has, as Get ( InstalledFMPlugins ) lists it. */
export interface InstalledPlugin { name: string; id: string; version: string; state: 'Enabled' | 'Disabled'; description?: string }

/** A function a plug-in provides: it gets its arguments evaluated, never the formula. */
export interface PluginFunction {
  /** Same arguments always give the same result, without host calls. Defaults to volatile. */
  pure?: boolean;
  /** Changes when the implementation or manifest changes, for shared calculation caches. */
  cacheKey?: string;
  min: number;
  max?: number;
  call(args: Value[], env: Env): Value;
}

/** Runtime precedence, also used by pre-execution analysis. Host lookups are case-insensitive.
 * A disabled built-in still owns its name; it must not fall through to a plug-in or custom body. */
export function resolveFunction<C>(name: string, context: {
  plugin?(name: string): PluginFunction | undefined;
  customFunction?(name: string): C | undefined;
}): { kind: 'builtin'; fn: Fn } | { kind: 'plugin'; fn: PluginFunction } | { kind: 'custom'; fn: C } | undefined {
  const builtin = FUNCTIONS.get(name.toLowerCase());
  if (builtin) return { kind: 'builtin', fn: builtin };
  const plugin = context.plugin?.(name);
  if (plugin) return { kind: 'plugin', fn: plugin };
  const custom = context.customFunction?.(name);
  return custom ? { kind: 'custom', fn: custom } : undefined;
}

export interface PluginFiles {
  read(path: string): Uint8Array | undefined;
  /** False when the path is outside the allowed folders or its folder is missing. */
  write(path: string, content: string | Uint8Array, append: boolean): boolean;
  size(path: string): number | undefined;
  /** Folder tools: 0 when done, else the system error number (2: no such file, 17: already exists). */
  makeFolder?(path: string): number;
  /** Deletes a file, or a folder with everything in it. */
  remove?(path: string): number;
  move?(from: string, to: string, overwrite: boolean): number;
  copy?(from: string, to: string, overwrite: boolean): number;
  /** What a folder holds, as paths relative to it ("sub/a.txt" when recursing); undefined when it isn't one. */
  list?(path: string, recurse: boolean): { path: string; folder: boolean }[] | undefined;
  modified?(path: string): Date | undefined;
}

const MAX_DEPTH = 10000;
export const EVALUATION_LIMIT = { steps: 5_000_000, ms: 2500, cachedFormulas: 256 } as const;
const WORK_BUDGET_MS = 850;

// Elapsed wall time includes time when another test or process has descheduled
// this calculation. Charge the executing thread instead, while retaining a
// wall-clock fallback for browser runtimes without thread CPU accounting.
const calculationTime = (): number => {
  if (typeof process !== 'undefined' && typeof process.threadCpuUsage === 'function') {
    const { user, system } = process.threadCpuUsage();
    return (user + system) / 1000;
  }
  return performance.now();
};

/** Evaluation state: the context, Let scopes and recursion depth. */
export class Env {
  readonly ctx: CalcContext;
  readonly names: NameTable;
  private scopes: Map<string, Value>[] = [];
  private readonly parameterFields = new WeakMap<Map<string, Value>, Map<string, string>>();
  depth = 0;
  /** SetRecursion's limit on custom function depth and While loops, while its expression is evaluated. */
  recursionLimit?: number;
  /** Guarded decimal places while evaluating SetPrecision's first argument. */
  private decimalPlaces?: number;
  private workDeadline = Infinity;
  private workExhausted = false;
  private whileDepth = 0;

  constructor(ctx: CalcContext) {
    this.ctx = ctx;
    this.names = ctx.names instanceof NameTable ? ctx.names : new NameTable(ctx.names);
  }

  get order(): DateStyle {
    return this.ctx.dateOrder ?? 'MDY';
  }

  /** The clock is shared by every loop and Decimal operation; small batches charge every step. */
  checkWorkBudget(steps = 1): void {
    this.tick(steps);
    this.checkClock();
    if (calculationTime() < this.workDeadline) return;
    this.workExhausted = true;
    const error = new CalcError(ERR.recursion, this.whileDepth
      ? this.whileBudgetMessage()
      : `Calculation exceeded its ${WORK_BUDGET_MS} ms calculation work budget`);
    markExecutionRefusal(error);
    throw error;
  }

  whileBudgetMessage(): string {
    return `While exceeded its work budget or ${(this.recursionLimit ?? 50000).toLocaleString('en-US')} iteration limit`;
  }

  withWhileBudget<T>(work: () => T): T {
    this.whileDepth++;
    try { return work(); } finally { this.whileDepth--; }
  }

  /** Evaluate a node (and report it to ctx.trace when one is set). */
  v(n: Node): Value {
    if (this.evaluating) {
      this.tick();
      return this.traced(n);
    }
    assertTraversalDepth(n);
    this.steps = 0;
    this.workExhausted = false;
    const started = calculationTime();
    this.stop = started + EVALUATION_LIMIT.ms;
    this.workDeadline = started + WORK_BUDGET_MS;
    this.evaluating++;
    try {
      const result = withRegexBudget(() => this.traced(n));
      // Error-inspection functions may catch an inner error; they cannot reset
      // an exhausted budget or make the enclosing evaluation succeed.
      if (this.workExhausted || this.steps > EVALUATION_LIMIT.steps || calculationTime() >= this.stop) {
        throw new ComplexityError('Calculation exceeds the supported work budget');
      }
      return result;
    } finally {
      this.evaluating--;
      this.stop = Infinity;
      this.workDeadline = Infinity;
    }
  }

  private traced(n: Node): Value {
    const trace = this.ctx.trace;
    if (!trace) return this.node(n);
    this.traceDepth++;
    try {
      const r = this.node(n);
      trace(n, r, this.traceDepth);
      return r;
    } catch (e) {
      rethrowExecutionRefusal(e);
      if (e instanceof CalcError) trace(n, e, this.traceDepth);
      throw e;
    } finally {
      this.traceDepth--;
    }
  }

  private traceDepth = 0;
  private evaluating = 0;
  private steps = 0;
  private stop = Infinity;

  /** A built-in can spend long on one call, so the clock is read at every function call as well as every 1,024 steps. */
  private checkClock(): void {
    if (this.evaluating && calculationTime() >= this.stop) throw new ComplexityError('Calculation exceeds the supported work budget');
  }

  private tick(steps = 1): void {
    this.steps += steps;
    if (this.steps > EVALUATION_LIMIT.steps || ((this.steps & 1023) < steps && calculationTime() >= this.stop)) {
      throw new ComplexityError('Calculation exceeds the supported work budget');
    }
  }

  private node(n: Node): Value {
    switch (n.k) {
      case 'num': return this.decimalPlaces !== undefined ? (n.raw === 'Pi' ? Decimal.pi(this.decimalPlaces)
        : Decimal.parse(n.raw ?? String(n.value), this.decimalPlaces)).value()
        : n.raw !== undefined && isOverlongWholeText(n.raw) ? num(NaN)
          : n.exact !== undefined ? { type: 'number', value: n.value, exact: n.exact } : num(n.value);
      case 'str': return text(n.value);
      case 'field': return this.field(n);
      case 'var': return this.variable(n);
      case 'get': return getParameter(n.param, this);
      case 'let': return this.withScope(() => {
        // A Let variable bound to a field keeps the field's name, for GetFieldName, as in FileMaker.
        const scope = this.scopes[this.scopes.length - 1];
        const names = new Map<string, string>();
        this.parameterFields.set(scope, names);
        for (const [name, b, rep] of n.binds) {
          this.bind(name, this.v(b), rep);
          if (name.startsWith('$')) continue;
          // A bare name that is no Let variable or parameter is a field of the current table.
          const fieldName = b.k === 'field' ? this.fieldName(b.occurrence, b.name)
            : b.k === 'var' && !b.name.startsWith('$') ? this.fieldNameOf(b.name) ?? (this.lookup(b.name) === undefined ? this.fieldName(undefined, b.name) : undefined)
            : undefined;
          if (typeof fieldName === 'string') names.set(name.toLowerCase(), fieldName);
          else names.delete(name.toLowerCase());
        }
        return this.v(n.body);
      });
      case 'unary': {
        const a = this.v(n.a);
        if (n.op === 'not') return bool(!asBoolean(a));
        if (n.op === '+') return a;
        if (this.decimalPlaces !== undefined && n.op === '-') {
          const d = Decimal.value(a, this.decimalPlaces);
          return d.with(-d.n).value();
        }
        return negate(a);
      }
      case 'bin': return this.binary(n.op, n.a, n.b);
      case 'call': this.checkClock(); return this.call(n.name, n.args);
    }
  }

  text(n: Node): string {
    return this.textOf(this.v(n));
  }

  /** Round guarded decimal digits when a number crosses into text. */
  textOf(v: Value): string {
    return asText(this.decimalPlaces !== undefined && v.type === 'number' && v.decimal !== undefined
      ? Decimal.value(v, this.decimalPlaces).value(this.decimalPlaces - 48) : v, this.order);
  }

  number(n: Node): number {
    return asNumber(this.v(n));
  }

  bool(n: Node): boolean {
    return asBoolean(this.v(n));
  }

  withScope<T>(fn: () => T, scope: Map<string, Value> = new Map()): T {
    this.scopes.push(scope);
    try {
      return fn();
    } finally {
      this.scopes.pop();
    }
  }

  /** Run fn with only the given scope visible (custom function bodies cannot see the caller's Let names). */
  isolated<T>(scope: Map<string, Value>, fn: () => T): T {
    const saved = this.scopes;
    this.scopes = [scope];
    try {
      return fn();
    } finally {
      this.scopes = saved;
    }
  }

  /** Let binding: $names set script variables, other names the innermost scope. */
  bind(name: string, value: Value, rep?: Node): void {
    if (name.startsWith('$')) {
      const m = /^(.*)\[(\d+)\]$/.exec(name);
      if (!this.ctx.setVariable) throw new CalcError(ERR.calculation, `Variables cannot be set here (${name})`);
      this.ctx.setVariable(m ? m[1] : name, rep ? Math.trunc(this.number(rep)) : m ? Number(m[2]) : 1, value);
      return;
    }
    this.scopes[this.scopes.length - 1].set(name.toLowerCase(), value);
  }

  /** TO::Field as GetFieldName gives it. */
  fieldName(occurrence: string | undefined, name: string): string {
    return `${occurrence ?? this.ctx.occurrence ?? ''}::${name}`.replace(/^::/, '');
  }

  /**
   * The field a name stands for: a custom function parameter or Let variable
   * given a field gives its name, one given a value gives null; undefined when
   * the name is neither.
   */
  fieldNameOf(name: string): string | null | undefined {
    const key = name.toLowerCase();
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (!this.scopes[i].has(key)) continue;
      const names = this.parameterFields.get(this.scopes[i]);
      return names ? names.get(key) ?? null : undefined;
    }
    return undefined;
  }

  lookup(name: string): Value | undefined {
    const key = name.toLowerCase();
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(key);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  repetition(n: { rep?: Node }): number {
    if (!n.rep) return this.ctx.calculationRepetition ?? 1;
    return Math.trunc(asNumber(this.v(n.rep)));
  }

  ref(n: Node): FieldRef | undefined {
    if (n.k === 'field') return { occurrence: this.ownOccurrence(n.occurrence), field: n.name, repetition: this.repetition(n) };
    if (n.k === 'var' && !n.name.startsWith('$') && this.lookup(n.name) === undefined) {
      return { field: n.name, repetition: this.repetition(n) };
    }
    return undefined;
  }

  /** TO::Field on the context occurrence is the current record's field. */
  private ownOccurrence(to: string | undefined): string | undefined {
    if (to === undefined) return undefined;
    return this.ctx.occurrence !== undefined && to.toLowerCase() === this.ctx.occurrence.toLowerCase() ? undefined : to;
  }

  readField(ref: FieldRef): Value {
    if (ref.repetition < 1) return EMPTY;
    const v = this.ctx.field?.(ref);
    if (v === undefined) {
      throw new CalcError(ERR.fieldMissing, `The field "${ref.occurrence ? ref.occurrence + '::' : ''}${ref.field}" cannot be found`);
    }
    return v;
  }

  private field(n: Node & { k: 'field' }): Value {
    // A Let name shadows a one-word field of the same name.
    if (!n.occurrence) {
      const local = this.lookup(n.name);
      if (local !== undefined) return local;
    }
    return this.readField(this.ref(n)!);
  }

  private variable(n: Node & { k: 'var' }): Value {
    if (this.decimalPlaces !== undefined && n.name.toLowerCase() === 'pi' && !n.name.startsWith('$')) {
      const local = this.lookup(n.name);
      if (local !== undefined) return local;
      return Decimal.pi(this.decimalPlaces).value();
    }
    if (n.name.startsWith('$')) {
      return this.ctx.variable?.(n.name, this.repetition(n)) ?? EMPTY;
    }
    const local = this.lookup(n.name);
    if (local !== undefined) return local;
    const ref = { field: n.name, repetition: this.repetition(n) };
    // Functions without parameters (Random, Self, JSONString, ...) may be written without parentheses.
    const resolved = resolveFunction(n.name, this.ctx);
    if (resolved?.kind === 'builtin' && resolved.fn.min === 0) return this.ctx.field?.(ref) ?? (this.ctx.builtinOff?.(n.name) ? text('?') : resolved.fn.run([], this, n.name));
    // So may an enabled plug-in's functions and custom functions without parameters.
    if (resolved?.kind === 'plugin' && resolved.fn.min === 0) return this.ctx.field?.(ref) ?? resolved.fn.call([], this);
    if (resolved?.kind === 'custom' && !resolved.fn.parameters.length) return this.ctx.field?.(ref) ?? this.customFunction(n.name, resolved.fn, []);
    // And plug-in functions, which give "?" when the plug-in isn't installed.
    if (!resolved && pluginNotInstalled(n.name)) return this.ctx.field?.(ref) ?? text('?');
    return this.readField(ref);
  }

  /**
   * Values an aggregate argument stands for: every related record's value
   * for another occurrence's field, every repetition of a repeating field,
   * otherwise the argument's own value.
   */
  values(n: Node): Value[] {
    const ref = this.ref(n);
    if (ref && !(n.k === 'field' && n.rep) && !(n.k === 'var' && n.rep)) {
      if (ref.occurrence !== undefined) {
        const rel = this.ctx.related?.(ref);
        if (rel) return rel;
        return [this.readField(ref)];
      }
      const reps = this.ctx.repetitions?.({ field: ref.field }) ?? 1;
      if (reps > 1) {
        const out: Value[] = [];
        for (let r = 1; r <= reps; r++) out.push(this.readField({ ...ref, repetition: r }));
        return out;
      }
    }
    return [this.v(n)];
  }

  call(name: string, args: Node[]): Value {
    // No public binary-ID mapping: use the requested plug-in-missing fallback.
    // Do not evaluate arguments or let a host/custom function claim this ID.
    if (unknownFunctionId(name)) {
      this.ctx.notice?.(`Unknown function ${name}: skipped; returns ?`);
      return text('?');
    }
    const resolved = resolveFunction(name, this.ctx);
    if (resolved?.kind === 'builtin') {
      const fn = resolved.fn;
      if (args.length < fn.min) throw new CalcError(ERR.tooFewParameters, `Too few parameters in ${name}`);
      if (fn.max !== undefined && args.length > fn.max) throw new CalcError(ERR.tooManyParameters, `Too many parameters in ${name}`);
      // A built-in pack turned off for this file is a plug-in that isn't installed: "?" without evaluating the arguments.
      if (this.ctx.builtinOff?.(name)) return text('?');
      if (this.decimalPlaces !== undefined && name.toLowerCase() === 'pi') return Decimal.pi(this.decimalPlaces).value();
      if (name.toLowerCase() === 'setprecision') {
        const precision = Math.trunc(asNumber(this.v(args[1])));
        // Claris documents 16–400, plus the precision-zero example. Keep the
        // pre-existing evaluation for undocumented precision arguments.
        if (precision !== 0 && !(precision >= 16 && precision <= 400)) return this.v(args[0]);
        const previous = this.decimalPlaces;
        const places = precision === 0 ? 16 : precision;
        this.decimalPlaces = places + 48;
        try {
          const result = withDecimalBudget(() => this.checkWorkBudget(), () => this.v(args[0]));
          return result.type === 'number' && result.decimal !== undefined
            ? Decimal.value(result, this.decimalPlaces).value(places) : result;
        } catch (e) {
          rethrowExecutionRefusal(e);
          if (e instanceof RangeError) throw new CalcError(ERR.calculation, e.message);
          throw e;
        } finally { this.decimalPlaces = previous; }
      }
      if (this.decimalPlaces !== undefined && name.toLowerCase() === 'getasnumber') {
        const v = this.v(args[0]);
        if (v.type === 'number' && !Number.isFinite(v.value)) return v;
        if (v.type !== 'text' && v.type !== 'container') return Decimal.value(v, this.decimalPlaces).value();
        const numeric = decimalNumberText(v.value);
        return numeric === undefined ? EMPTY : Decimal.parse(numeric, this.decimalPlaces).value();
      }
      if (this.decimalPlaces !== undefined && (supportsDecimalFunction(name) || name.toLowerCase() === 'npv')) {
        const key = name.toLowerCase();
        if (key === 'npv') {
          const payments = this.values(args[0]).filter((v) => !isEmpty(v));
          const rate = Decimal.value(this.v(args[1]), this.decimalPlaces);
          const one = Decimal.parse('1', this.decimalPlaces);
          try {
            const base = one.add(rate);
            let total = Decimal.parse('0', this.decimalPlaces);
            for (let i = 0; i < payments.length; i++) {
              total = total.add(Decimal.value(payments[i], this.decimalPlaces).div(base.powInteger(BigInt(i + 1))));
            }
            return total.value();
          } catch (e) { if (e instanceof RangeError) return num(NaN); throw e; }
        }
        const values = ['sum', 'average', 'min', 'max', 'count', 'variance', 'variancep', 'stdev', 'stdevp'].includes(key)
          ? args.flatMap((arg) => this.values(arg)) : args.map((arg) => this.v(arg));
        if (key === 'min' || key === 'max') {
          const nonblank = values.filter((v) => !isEmpty(v));
          if (nonblank.some((v) => v.type !== 'number')) {
            return nonblank.reduce<Value | undefined>((best, v) => !best || (key === 'min' ? compare(v, best, this.order) < 0 : compare(v, best, this.order) > 0) ? v : best, undefined) ?? EMPTY;
          }
        }
        const precise = decimalFunction(key, values, this.decimalPlaces);
        if (precise !== undefined) return precise;
      }
      return fn.run(args, this, name);
    }
    if (resolved?.kind === 'plugin') {
      const pf = resolved.fn;
      if (args.length < pf.min) throw new CalcError(ERR.tooFewParameters, `Too few parameters in ${name}`);
      if (pf.max !== undefined && args.length > pf.max) throw new CalcError(ERR.tooManyParameters, `Too many parameters in ${name}`);
      return pf.call(args.map((a) => this.v(a)), this);
    }
    if (resolved?.kind === 'custom') return this.customFunction(name, resolved.fn, args);
    // The plug-in isn't installed: FileMaker gives "?" without evaluating the arguments.
    if (pluginNotInstalled(name)) return text('?');
    throw new CalcError(ERR.unknownFunction, `The function "${name}" cannot be found`);
  }

  private compiled = new Map<string, Node>();

  /** Parse (once) a formula evaluated within this one: custom functions, Evaluate. */
  parse(formula: string, locals?: string[]): Node {
    let n = this.compiled.get(formula);
    if (!n) {
      n = parse(formula, this.names, locals);
      assertTraversalDepth(n);
      if (this.compiled.size >= EVALUATION_LIMIT.cachedFormulas) this.compiled.clear();
      this.compiled.set(formula, n);
    }
    return n;
  }

  /** The parameters of a custom function call bound to its evaluated arguments, in a scope of their own. */
  private bindParameters(name: string, cf: CustomFunctionDef, args: Node[]): Map<string, Value> {
    if (args.length !== cf.parameters.length) {
      throw new CalcError(args.length < cf.parameters.length ? ERR.tooFewParameters : ERR.tooManyParameters, `Wrong number of parameters in ${name}`);
    }
    const scope = new Map<string, Value>();
    // A parameter given a field keeps the field's name, for GetFieldName in the body.
    const names = new Map<string, string>();
    cf.parameters.forEach((param, i) => {
      // The reader trims them; names typed with stray spaces still bind.
      const p = param.trim();
      const a = args[i];
      const fieldName = a.k === 'field' ? this.fieldName(a.occurrence, a.name) : a.k === 'var' && !a.name.startsWith('$') ? this.fieldNameOf(a.name) : undefined;
      if (typeof fieldName === 'string') names.set(p.toLowerCase(), fieldName);
      scope.set(p.toLowerCase(), this.v(a));
    });
    this.parameterFields.set(scope, names);
    return scope;
  }

  /**
   * What a custom function's body ends in, when that is another custom function's call: the branch an If or Case picks
   * is looked for until it is one. Such a call doesn't need the caller's stack, so a function that recurses this way
   * (a running total passed along, say) can go as deep as FileMaker allows. Not done while a trace is following every step.
   */
  private tailCall(node: Node): { node: Node } | { value: Value } | { name: string; cf: CustomFunctionDef; args: Node[] } {
    for (;;) {
      if (node.k !== 'call' || this.ctx.trace || unknownFunctionId(node.name)) return { node };
      const key = node.name.toLowerCase();
      if (key === 'if' && node.args.length >= 2 && node.args.length <= 3) {
        const next = this.bool(node.args[0]) ? node.args[1] : node.args[2];
        if (!next) return { value: EMPTY };
        node = next;
      } else if (key === 'case' && node.args.length >= 2) {
        const a = node.args;
        let next: Node | undefined;
        for (let i = 0; i + 1 < a.length && !next; i += 2) if (this.bool(a[i])) next = a[i + 1];
        if (!next && a.length % 2) next = a[a.length - 1];
        if (!next) return { value: EMPTY };
        node = next;
      } else {
        const resolved = resolveFunction(node.name, this.ctx);
        return resolved?.kind === 'custom' && !resolved.fn.call ? { name: node.name, cf: resolved.fn, args: node.args } : { node };
      }
    }
  }

  private customFunction(name: string, cf: CustomFunctionDef, args: Node[]): Value {
    if (cf.call) {
      if (args.length !== cf.parameters.length) {
        throw new CalcError(args.length < cf.parameters.length ? ERR.tooFewParameters : ERR.tooManyParameters, `Wrong number of parameters in ${name}`);
      }
      return cf.call(args.map((a) => this.v(a)));
    }
    const limit = Math.min(MAX_DEPTH, this.recursionLimit ?? MAX_DEPTH);
    const start = this.depth;
    let scope = this.bindParameters(name, cf, args);
    if (++this.depth > limit) throw new CalcError(ERR.recursion, `${name} recursed too deeply`);
    try {
      let current = { name, cf };
      for (;;) {
        this.tick();
        const body = this.parse(current.cf.formula, current.cf.parameters.map((p) => p.trim()));
        const step = this.isolated(scope, () => this.tailCall(body));
        if ('value' in step) return step.value;
        if (!('cf' in step)) return this.isolated(scope, () => this.v(step.node));
        // A tail call: its arguments are read in this call's scope, then it takes this call's place.
        const next = this.isolated(scope, () => this.bindParameters(step.name, step.cf, step.args));
        if (++this.depth > limit) throw new CalcError(ERR.recursion, `${step.name} recursed too deeply`);
        scope = next;
        current = step;
      }
    } catch (e) {
      rethrowExecutionRefusal(e);
      // JavaScript's stack can run out before FileMaker's 10,000 levels: the same error ("?"), saying how far it got.
      if (e instanceof RangeError && (e.message.includes('call stack size exceeded') || e.message.includes('too much recursion'))) throw new CalcError(ERR.recursion, `${name} recursed too deeply (this server's stack ran out at level ${this.depth}; FileMaker allows ${MAX_DEPTH})`);
      throw e;
    } finally {
      this.depth = start;
    }
  }

  private binary(op: string, an: Node, bn: Node): Value {
    // and / or stop as soon as the answer is known.
    if (op === 'and') return bool(this.bool(an) && this.bool(bn));
    if (op === 'or') return bool(this.bool(an) || this.bool(bn));
    const a = this.v(an);
    const b = this.v(bn);
    if (this.decimalPlaces !== undefined && ['+', '-', '*', '/', '^'].includes(op)) {
      if ((op === '+' || op === '-') && (['date', 'time', 'timestamp'].includes(a.type) || ['date', 'time', 'timestamp'].includes(b.type))) {
        return op === '+' ? add(a, b, 1) : subtract(a, b);
      }
      if (op === '/' && isEmpty(a) && isEmpty(b)) return EMPTY;
      if (op === '/' && isEmpty(a)) return EMPTY;
      try {
        const x = Decimal.value(a, this.decimalPlaces), y = Decimal.value(b, this.decimalPlaces);
        const result = op === '+' ? x.add(y) : op === '-' ? x.sub(y) : op === '*' ? x.mul(y)
          : op === '/' ? x.div(y) : x.pow(y);
        return result.value();
      } catch (e) { if (e instanceof RangeError) return num(NaN); throw e; }
    }
    switch (op) {
      case 'xor': return bool(asBoolean(a) !== asBoolean(b));
      case '&': {
        // Formatting on either side is kept (TextColor ( "Due" ; RGB ( 255 ; 0 ; 0 ) ) & " " & Date).
        const at = this.textOf(a);
        const bt = this.textOf(b);
        checkCalcTextSize(at.length + bt.length);
        const ar = a.type === 'text' ? a.runs : undefined;
        const br = b.type === 'text' ? b.runs : undefined;
        const runs = ar?.length || br?.length ? concatRuns(ar, at.length, br, bt.length) : undefined;
        return runs?.length ? { type: 'text', value: at + bt, runs } : text(at + bt);
      }
      case '+': return add(a, b, 1);
      case '-': return subtract(a, b);
      case '*': return whole(a, b, (x, y) => x * y) ?? num(tidy(asNumber(a) * asNumber(b)));
      case '/': {
        // FileMaker does not stop on division by zero: the result shows as "?".
        // Empty over empty is empty, though (a private sample file stores nothing for
        // Round ( GetAsNumber ( W ) / GetAsNumber ( L ) ; 2 ) when neither holds a digit).
        // So is empty over a number: the same file stores nothing for
        // Round ( GetContainerAttribute ( Image ; "fileSize" ) / 131072 ; 2 ) on an
        // empty container, where IsEmpty ( Image ) beside it shows the formula ran.
        if (isEmpty(a) && isEmpty(b)) return EMPTY;
        const d = asNumber(b);
        if (d === 0) return num(NaN);
        const x = exactOf(a), y = exactOf(b);
        if (x !== undefined && y !== undefined && y !== 0n && x % y === 0n) {
          const quotient = x / y;
          if (isBeyondDouble(a) || isBeyondDouble(b) || !Number.isSafeInteger(Number(quotient))) return fromExact(quotient);
        }
        return isEmpty(a) ? EMPTY : num(tidy(asNumber(a) / d));
      }
      case '^': {
        // An overlong whole-number operand has no value, including for exponents that Math.pow would simplify.
        if ((a.type === 'text' && isOverlongWholeText(a.value)) || (b.type === 'text' && isOverlongWholeText(b.value))
          || (an.k === 'num' && isOverlongWholeText(an.raw ?? ''))
          || (bn.k === 'num' && isOverlongWholeText(bn.raw ?? ''))) return num(NaN);
        const exact = exactPow(a, b);
        if (exact !== undefined && (isBeyondDouble(a) || isBeyondDouble(b) || !Number.isSafeInteger(Number(exact)))) {
          return fromExact(exact);
        }
        const e = asNumber(b);
        const r = Math.pow(asNumber(a), e);
        return num(Number.isInteger(e) ? tidy(r) : r);
      }
      default: return bool(compareOp(op, compareOperands(a, b, this.order, (v) => this.textOf(v))));
    }
  }
}

/**
 * The comparison operators (=, ≠, <, …): if either side is text, both compare
 * as text, so "2" > 10 is true and "Tab-5" ≠ GetAsNumber ( "Tab-5" ), which is
 * how solutions tell a text parameter from a number
 * (https://filemakerhacks.com/2021/03/14/when-2-is-greater-than-10/).
 * Otherwise as compare does.
 */
export function compareOperands(a: Value, b: Value, order: DateStyle = 'MDY', textOf: (v: Value) => string = (v) => asText(v, order)): number {
  const text = (v: Value) => v.type === 'text' || v.type === 'container';
  if ((text(a) || text(b)) && !isEmpty(a) && !isEmpty(b)) return collator.compare(textOf(a), textOf(b));
  return compare(a, b, order);
}

function compareOp(op: string, c: number): boolean {
  switch (op) {
    case '=': return c === 0;
    case '≠': case '<>': return c !== 0;
    case '<': return c < 0;
    case '>': return c > 0;
    case '≤': case '<=': return c <= 0;
    default: return c >= 0;
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'accent', numeric: false });

/**
 * FileMaker comparison: numbers, dates and times compare as numbers; text
 * compares case-insensitively; text against a number compares as numbers
 * when the text holds one. Empty sorts before everything.
 */
export function compare(a: Value, b: Value, order: DateStyle = 'MDY'): number {
  const ae = isEmpty(a);
  const be = isEmpty(b);
  if (ae || be) return ae && be ? 0 : ae ? -1 : 1;
  if (a.type === 'number' && b.type === 'number' && (a.decimal !== undefined || b.decimal !== undefined)) {
    const x = Decimal.value(a, 448).n, y = Decimal.value(b, 448).n;
    return x === y ? 0 : x < y ? -1 : 1;
  }
  const numeric = (v: Value) => v.type !== 'text' && v.type !== 'container';
  if (numeric(a) || numeric(b)) {
    const x = asNumberOrEmpty(a);
    const y = asNumberOrEmpty(b);
    if (x !== undefined && y !== undefined) {
      // Whole numbers past 2^53 compare digit for digit.
      const ex = isBeyondDouble(a) || isBeyondDouble(b) ? exactOf(a) : undefined;
      const ey = ex !== undefined ? exactOf(b) : undefined;
      if (ex !== undefined && ey !== undefined) return ex === ey ? 0 : ex < ey ? -1 : 1;
      return x === y ? 0 : x < y ? -1 : 1;
    }
  }
  return collator.compare(asText(a, order), asText(b, order));
}

/**
 * + - * on whole numbers keep every digit once a number is past 2^53 (a double's reach), as FileMaker's up to 400
 * digits do; undefined when the plain double arithmetic is exact anyway (or an operand isn't a whole number).
 */
function whole(a: Value, b: Value, op: (x: bigint, y: bigint) => bigint): Value | undefined {
  const x = exactOf(a);
  const y = exactOf(b);
  if (x === undefined || y === undefined) return undefined;
  const r = op(x, y);
  if (!isBeyondDouble(a) && !isBeyondDouble(b) && Number.isSafeInteger(Number(r))) return undefined;
  return fromExact(r);
}

function negate(a: Value): Value {
  const e = a.type === 'number' ? a.exact : undefined;
  if (e !== undefined) return fromExact(-e);
  if (a.type === 'time' || a.type === 'timestamp') return { type: a.type, value: -a.value };
  const n = asNumberOrEmpty(a);
  return n === undefined ? EMPTY : num(-n);
}

/** Date + days, time + seconds and timestamp + seconds keep their type, as FileMaker does.
 * Timestamp seconds have no UTC offset: arithmetic can name a skipped or repeated local time at a DST transition. */
function add(a: Value, b: Value, sign: 1 | -1): Value {
  const dated = (v: Value) => v.type === 'date' || v.type === 'time' || v.type === 'timestamp';
  if (dated(a) && !dated(b)) return { type: a.type as 'date', value: a.value as number + sign * asNumber(b) };
  if (dated(b) && !dated(a) && sign === 1) return { type: b.type as 'date', value: (b.value as number) + asNumber(a) };
  if (a.type === 'date' && b.type === 'time') return { type: 'timestamp', value: (a.value - 1) * 86400 + sign * b.value };
  if (a.type === 'timestamp' && b.type === 'time') return { type: 'timestamp', value: a.value + sign * b.value };
  return whole(a, b, (x, y) => (sign === 1 ? x + y : x - y)) ?? num(tidy(asNumber(a) + sign * asNumber(b)));
}

function subtract(a: Value, b: Value): Value {
  // Timestamp differences subtract local calendar seconds; they do not measure elapsed UTC time across DST.
  // date - date and timestamp - timestamp are plain numbers (days, seconds); time - time is a time.
  if (a.type === b.type && (a.type === 'date' || a.type === 'timestamp')) return num(a.value - (b.value as number));
  if (a.type === 'time' && b.type === 'time') return { type: 'time', value: a.value - b.value };
  return add(a, b, -1);
}

export { isEmpty };
