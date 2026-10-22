import { compile, nodeText, type CalcNames, type Node } from '../../calc/src/index.ts';
import { FUNCTIONS } from '../../calc/src/functions.ts';
import type { Script, ScriptStep } from '../../fmp12/src/index.ts';
import { isCredentialName, isCredentialLabelName } from './credentials.ts';

const CREDENTIAL_STEPS = new Map([
  [83, 'Change Password'], [134, 'Add Account'], [136, 'Reset Account Password'],
  [138, 'Re-Login'], [212, 'Configure AI Account'],
]);
const CREDENTIAL_LINE = /^(\s*(?:\/\/\s*)?(?:Add Account|Change Password|Reset Account Password|Re-Login|Configure AI Account))(?=\s|$)/i;
/**
 * Whether the text holds a URL with a user and password. Internal redaction also checks username-only userinfo.
 * Written as a scan over each
 * "://" rather than one regular expression: `[a-z][a-z\d+.-]*:\/\/` tried from every letter of a long run of letters, and
 * an authority pattern from every colon of a long token without an "@", each cost time that grows with the square of
 * the text, and this runs on script text and request bodies a person controls.
 */
export function hasUrlAuth(s: string, includeUsernameOnly = false): boolean {
  let at = s.indexOf('://');
  while (at >= 0) {
    // The scheme: a run of scheme characters just before it that holds a letter to start from.
    let from = at;
    while (from > 0 && /[a-z\d+.-]/i.test(s[from - 1]!)) from--;
    if (from < at && /[a-z]/i.test(s.slice(from, at))) {
      // The part up to the first "/", space, quote or bracket must hold an "@" after a colon, unless checking username-only userinfo.
      let end = at + 3;
      while (end < s.length && !/[\s/"<>]/.test(s[end]!)) end++;
      const part = s.slice(at + 3, end);
      const colon = part.indexOf(':');
      if ((includeUsernameOnly || colon >= 0) && part.indexOf('@', colon + 1) >= 0) return true;
    }
    at = s.indexOf('://', at + 3);
  }
  return false;
}
const CURL_AUTH = /(?:^|[\s"'])--(?:user|proxy-user|oauth2-bearer)(?:[\s=]|$)|(?:^|[\s"'])-u\S*/i;
const MBS_CURL_CREDENTIAL = /\bMBS\s*\(\s*["“]CURL\.(?:SetOptionPassword|SetupAWS)["”]/i;
const CREDENTIAL_CONTEXT = /[a-z][a-z\d+.-]*:\/\/|^[\w-]+:\s|(?:^|[\s"'])--(?:header|proxy-header)(?:[\s=]|$)/i;
/** An unfinished URL authority can acquire a password and @host in later assignments. A numeric port alone cannot. */
function hasUrlAuthPrefix(s: string): boolean {
  let at = s.indexOf('://');
  while (at >= 0) {
    let from = at;
    while (from > 0 && /[a-z\d+.-]/i.test(s[from - 1]!)) from--;
    if (from < at && /[a-z]/i.test(s.slice(from, at))) {
      let end = at + 3;
      while (end < s.length && !/[\s/"<>?#]/.test(s[end]!)) end++;
      if (end === s.length) {
        const authority = s.slice(at + 3);
        const colon = authority.indexOf(':');
        if (colon > 0 && !/^\d+$/.test(authority.slice(colon + 1))) return true;
      }
    }
    at = s.indexOf('://', at + 3);
  }
  return false;
}
export const REDACTED = '‹redacted›';
const authenticationText = (s: string) => hasUrlAuth(s, true) || CURL_AUTH.test(s) || /authorization\s*:|bearer\s+/i.test(s)
  // Form/query parameters, JSON bodies and header names, including X-API-Key.
  || [...s.matchAll(/(?<![\w.-])([\w.-]+(?:[ \t]+[\w.-]+){0,2})(?:\s*["'])?\s*[:=]/g)].some((m) => isCredentialName(m[1]) || /(?:^|\s)(?:set-)?cookie$/i.test(m[1]));
const sensitiveText = (s: string) => isCredentialName(s) || authenticationText(s) || MBS_CURL_CREDENTIAL.test(s);
function hiddenLine(line: string, stepId?: number, name?: string): string {
  const known = CREDENTIAL_LINE.exec(line)?.[1] ?? CREDENTIAL_STEPS.get(stepId ?? -1);
  const candidate = name ?? (line.includes('[') ? line.split('[')[0].trimEnd() : 'Script step');
  const label = known ?? (sensitiveText(candidate) || !/^[\p{L}\p{N} /-]+$/u.test(candidate) ? 'Script step' : candidate);
  return `${label} [ ${REDACTED} ]`;
}

/** Shared fallback for diagnostics that have only a line, including both profilers. */
export function redactCredentialStep(line: string, stepId?: number): string {
  return CREDENTIAL_STEPS.has(stepId ?? -1) || CREDENTIAL_LINE.test(line) || sensitiveText(line) ? hiddenLine(line, stepId) : line;
}

export function redactCredentialError(message: string, line: string, stepId?: number): string {
  return redactCredentialStep(line, stepId) !== line || sensitiveText(message) ? 'Credential step failed' : message;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}

type LetNode = Extract<Node, { k: 'let' }>;
const SCRIPT_PARAMETER = 'get:scriptparameter';
const SCRIPT_RESULT = 'get:scriptresult';
// These built-ins can read data outside their visible arguments. Keep the opaque
// source policy here: Get reads host state; custom/unknown calls and plug-in packs
// are opaque regardless of their implementation, including Evaluate in a CF body.
const OPAQUE_FUNCTIONS = new Set([
  'Evaluate', 'GetField', 'ExecuteSQL', 'ExecuteSQLe', 'Self',
  'Lookup', 'LookupNext', 'GetNthRecord', 'GetSummary',
  'GetEmbedding', 'GetRAGSpaceInfo', 'GetPersistentData', 'ListPersistentDataIDs', 'Location', 'LocationValues',
  'GetLayoutObjectAttribute', 'LayoutNames', 'LayoutIDs', 'ScriptNames', 'ScriptIDs', 'WindowNames', 'FieldNames',
  'TableNames', 'TableIDs', 'FieldIDs', 'FieldType', 'FieldStyle', 'FieldRepetitions', 'FieldBounds', 'FieldComment',
  'RelationInfo', 'ValueListItems', 'ValueListNames', 'ValueListIDs', 'DatabaseNames', 'LayoutObjectNames',
  'ScriptStepNames', 'BaseTableNames', 'BaseTableIDs', 'GetTableDDL', 'GetRecordIDsFromFoundSet', 'GetNextSerialValue', 'GetFieldsOnLayout',
].map((name) => name.toLowerCase()));
const opaqueCall = (name: string): boolean => !FUNCTIONS.has(name.toLowerCase()) || OPAQUE_FUNCTIONS.has(name.toLowerCase()) || /^(?:BE_|MBS$)/i.test(name);
const bindingName = (name: string) => name.replace(/\[.*$/, '').toLowerCase();
function children(node: Node): Node[] {
  switch (node.k) {
    case 'var': case 'field': return node.rep ? [node.rep] : [];
    case 'call': return node.args;
    case 'unary': return [node.a];
    case 'bin': return [node.a, node.b];
    case 'let': return [...node.binds.flatMap(([, value, rep]) => rep ? [value, rep] : [value]), node.body];
    default: return [];
  }
}

const FRAGMENT_LENGTH = 4;
const MIN_FRAGMENT_SECRET_LENGTH = 8;
const MAX_VALUE_BYTES = 4 * 1024;
const MAX_REMEMBERED_BYTES = 1_000_000;
const MAX_SQL_REMEMBERED_BYTES = 64 * 1024;
const HASH_BASE = 257;
const HASH_LEADING = HASH_BASE ** (FRAGMENT_LENGTH - 1);
/** One rolling hash per four-character window, with 32-bit arithmetic. */
function* fragmentHashes(value: string): Generator<number> {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    if (i >= FRAGMENT_LENGTH) hash = (hash - Math.imul(value.charCodeAt(i - FRAGMENT_LENGTH), HASH_LEADING)) | 0;
    hash = (Math.imul(hash, HASH_BASE) + value.charCodeAt(i)) | 0;
    if (i >= FRAGMENT_LENGTH - 1) yield hash;
  }
}

/** Copy a bounded UTF-8 prefix, without retaining the original string or splitting a code point. */
function rememberedPrefix(value: string): string {
  const bytes = Buffer.from(value.slice(0, MAX_VALUE_BYTES));
  let end = Math.min(bytes.length, MAX_VALUE_BYTES);
  if (end < bytes.length) while ((bytes[end] & 0xc0) === 0x80) end--;
  return bytes.toString('utf8', 0, end);
}

/** Run-local policy: discover credential inputs before emitting any diagnostic, and track their runtime values. */
export class CredentialRedactor {
  private readonly names = new Set<string>();
  private readonly values = new Set<string>();
  private readonly referencedNames = new Set<string>();
  private readonly prefixes = new Map<number, Set<string>>();
  // Charge UTF-16 text plus conservative Set/Map entry and bucket overhead.
  private rememberedBytes = 0;
  private rememberFull = false;
  private sqlRememberedBytes = 0;
  private sqlRememberFull = false;
  private readonly expressions = new Map<string, { refs: string[]; literals: string[]; direct: boolean; dynamic: boolean; node?: Node; literal: boolean; credentialLiteral: boolean; malformed: boolean }>();
  private readonly steps = new Set<ScriptStep>();
  private inspected = false;
  private readonly customFunctions = new Set<string>();
  private opaqueCredentials = false;
  private readonly calcNames?: CalcNames;
  constructor(calcNames?: CalcNames) { this.calcNames = calcNames; }

  private expression(formula: string) {
    let parsed = this.expressions.get(formula);
    if (parsed) return parsed;
    const refs: string[] = [];
    const literals: string[] = [];
    let dynamic = false;
    let credentialLiteral = false;
    let literal = false;
    let malformed = false;
    const walk = (node: Node, bound = new Set<string>()): void => {
      // Field names are conservatively shared across occurrences, including unqualified reads.
      if (node.k === 'field' || (node.k === 'var' && !bound.has(node.name.toLowerCase()))) refs.push(node.name.toLowerCase());
      if (node.k === 'str') {
        literals.push(node.value);
        if (isCredentialName(node.value)) credentialLiteral = true;
      }
      if (node.k === 'get') {
        // LastError is a numeric status, not a read of host data.
        if (node.param.toLowerCase() !== 'lasterror') dynamic = true;
        if (/^script(?:parameter|result)$/i.test(node.param)) refs.push(`get:${node.param.toLowerCase()}`);
      }
      if (node.k === 'call' && opaqueCall(node.name)) dynamic = true;
      // FileMaker also permits zero-argument functions without parentheses.
      if (node.k === 'var' && !bound.has(node.name.toLowerCase()) && !node.name.startsWith('$') &&
          (this.customFunctions.has(node.name.toLowerCase()) || (FUNCTIONS.get(node.name.toLowerCase())?.min === 0 && opaqueCall(node.name)))) dynamic = true;
      if (node.k === 'let') {
        const inner = new Set(bound);
        for (const [name, value, rep] of node.binds) {
          walk(value, inner);
          if (rep) walk(rep, inner);
          if (name.startsWith('$')) refs.push(bindingName(name));
          else inner.add(bindingName(name));
        }
        walk(node.body, inner);
      } else children(node).forEach((child) => walk(child, bound));
    };
    let direct = false;
    let node: Node | undefined;
    try {
      node = compile(formula, this.calcNames).node;
      direct = node.k === 'var' || node.k === 'field' || node.k === 'str';
      literal = node.k === 'str';
      walk(node);
    } catch {
      // Malformed expressions must not turn off variable redaction.
      malformed = true;
      refs.push(...(formula.match(/\$\$?[^\s[\];()&"+*/=]+/g) ?? []).map((s) => s.toLowerCase()));
    }
    parsed = { refs, literals, direct, dynamic, node, literal, credentialLiteral, malformed };
    this.expressions.set(formula, parsed);
    return parsed;
  }

  private mark(formula: string): void {
    const { refs, literals, dynamic } = this.expression(formula);
    refs.forEach((s) => this.names.add(s));
    // Keep authentication scaffolding together so a trailing URL host is not
    // learned as a separate secret. Referenced inputs are still marked above.
    const joined = literals.join('');
    if (authenticationText(joined)) this.remember(joined);
    else literals.forEach((s) => this.remember(s));
    // Once dynamic evaluation reaches a credential sink, any input in this run
    // could supply it. Include references collected from every script before tracing.
    if (dynamic) this.opaqueCredentials = true;
    if (this.opaqueCredentials) {
      this.referencedNames.forEach((s) => this.names.add(s));
      this.names.add(SCRIPT_PARAMETER);
      this.names.add(SCRIPT_RESULT);
    }
  }

  private markCurlCredentialInputs(formula: string): void {
    if (!/CURL\.(?:SetOptionPassword|SetupAWS)/i.test(formula)) return;
    try {
      const walk = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        const node = value as { k?: string; name?: string; value?: string; args?: unknown[] };
        if (node.k === 'call' && node.name?.toLowerCase() === 'mbs' && node.args?.[0] &&
            (node.args[0] as { k?: string }).k === 'str') {
          const call = (node.args[0] as { value?: string }).value?.toLowerCase();
          const inputs = call === 'curl.setupaws' ? [node.args[2], node.args[3]]
            : call === 'curl.setoptionpassword' ? [node.args[2]] : [];
          for (const input of inputs) {
            if (!input) continue;
            const markInput = (part: unknown): void => {
              if (!part || typeof part !== 'object') return;
              const item = part as { k?: string; name?: string; value?: string };
              if ((item.k === 'field' || item.k === 'var') && item.name) this.names.add(item.name.toLowerCase());
              if (item.k === 'str' && item.value) this.remember(item.value);
              Object.values(part).forEach(markInput);
            };
            markInput(input);
          }
        }
        Object.values(value).forEach(walk);
      };
      walk(compile(formula, this.calcNames).node);
    } catch {
      // Other sensitive-name and URL policies still apply to malformed formulas.
    }
  }

  inspect(scripts: readonly Script[], customFunctions: Iterable<string> = []): void {
    // Perform Script calls this on every call; the analysis below only changes when a step or a custom function is new.
    let changed = !this.inspected;
    for (const name of customFunctions) if (!this.customFunctions.has(name.toLowerCase())) {
      this.customFunctions.add(name.toLowerCase());
      this.expressions.clear();
      changed = true;
    }
    for (const script of scripts) for (const step of script.steps) if (!this.steps.has(step)) {
      this.steps.add(step);
      changed = true;
    }
    if (!changed) return;
    this.inspected = true;
    const assignments = new Map<string, Set<string>>();
    const assign = (target: string, formula: string): void => {
      const key = target.toLowerCase();
      this.referencedNames.add(key);
      if (!assignments.has(key)) assignments.set(key, new Set());
      assignments.get(key)!.add(formula);
    };
    const letAssignments = (node: Node, scopes: LetNode['binds'][] = []): void => {
      if (node.k === 'let') {
        for (const [i, [name, value, rep]] of node.binds.entries()) {
          const scope = [...scopes, node.binds.slice(0, i)];
          if (name.startsWith('$')) {
            // A binding keeps the preceding local scopes even when its $/$$ value is read
            // by a later step. Keep every possible assignment, including nested Let calls.
            const source = scope.reduceRight<Node>((body, binds) => binds.length ? { k: 'let', binds, body } : body, value);
            assign(bindingName(name), nodeText(source));
          }
          letAssignments(value, scope);
          if (rep) letAssignments(rep, scope);
        }
        letAssignments(node.body, [...scopes, node.binds]);
      } else children(node).forEach((child) => letAssignments(child, scopes));
    };
    for (const step of this.steps) {
      const p = step.params;
      // Replace Field Contents and Set Field By Name (when it names its field in a literal) write a calculation's result too.
      const named = step.stepId === 147 ? /^\s*"([^"]*)"\s*$/.exec(p?.fieldName ?? '')?.[1]?.split('::').pop() : undefined;
      const target = step.stepId === 141 ? p?.variable : [76, 77, 91].includes(step.stepId) ? (p?.field?.field.name ?? p?.variable) : named;
      const formula = step.stepId === 141 ? p?.value : p?.calculation;
      if (target && formula) assign(target, formula);
      // Script state is shared conservatively across calls, just like field names.
      // A tainted caller argument must hide the callee's parameter even if the
      // callee only reads it in a debugger watch, outside its script text.
      if ([1, 164, 210].includes(step.stepId) && p?.parameter !== undefined) assign(SCRIPT_PARAMETER, p.parameter);
      if (step.stepId === 103 && p?.calculation !== undefined) assign(SCRIPT_RESULT, p.calculation);
      for (const source of strings(p)) {
        const { refs, node } = this.expression(source);
        refs.forEach((s) => this.referencedNames.add(s));
        if (node) letAssignments(node);
      }
    }
    if (this.opaqueCredentials) this.referencedNames.forEach((s) => this.names.add(s));
    // Resolve literals, copies, concatenation and Let bindings without executing calculations.
    // Unsupported parts and unresolved references are explicitly uncertain: a credential-capable
    // expression containing any of them taints all its inputs. Expansion limits always fail closed.
    const assembled = new Map<string, { sensitive: boolean; uncertain: boolean }>();
    const credentialExpression = (formula: string, credentialPosition = false): boolean => {
      const cached = assembled.get(formula);
      if (cached) return cached.sensitive || (credentialPosition && cached.uncertain);
      const expression = this.expression(formula);
      // A literal that merely mentions a credential name (an ExecuteSQL query, a label) is not credential material; its use in a URL or header is checked by the sink above.
      const credentialText = (s: string) => authenticationText(s) || MBS_CURL_CREDENTIAL.test(s) || hasUrlAuthPrefix(s);
      if (expression.literals.some(credentialText)) {
        assembled.set(formula, { sensitive: true, uncertain: false });
        return true;
      }
      let budget = 1024;
      let uncertain = false;
      let context = false;
      let found = false;
      const note = (values: string[]): string[] => {
        context ||= values.some((s) => CREDENTIAL_CONTEXT.test(s));
        found ||= values.some(credentialText);
        return values;
      };
      const expand = (node: Node | undefined, seen: Set<string>, locals = new Map<string, string[]>()): string[] | undefined => {
        if (--budget < 0 || seen.size > 32) return undefined;
        if (node?.k === 'str') return note([node.value]);
        if (node?.k === 'var' || node?.k === 'field') {
          const name = node.name.toLowerCase();
          if (node.rep) {
            uncertain = true;
            if (!expand(node.rep, seen, locals)) return undefined;
          }
          if (node.k === 'var' && locals.has(name)) return note(locals.get(name)!);
          if (!seen.has(name) && assignments.has(name)) {
            const next = new Set([...seen, name]);
            const values = new Set<string>();
            for (const source of assignments.get(name)!) {
              // A script/field assignment cannot see the reader's Let scope.
              const parts = expand(this.expression(source).node, next);
              if (!parts) return undefined;
              parts.forEach((s) => values.add(s));
              if (values.size > 64) return undefined;
            }
            return note([...values]);
          }
        }
        if (node?.k === 'let') {
          const inner = new Map(locals);
          for (const [name, value, rep] of node.binds) {
            const parts = expand(value, seen, inner);
            if (!parts || (rep && !expand(rep, seen, inner))) return undefined;
            // $/$$ assignments are shared across steps; retain all alternatives above.
            if (!name.startsWith('$')) inner.set(bindingName(name), parts);
          }
          return expand(node.body, seen, inner);
        }
        if (node?.k === 'bin' && node.op === '&') {
          const a = expand(node.a, seen, locals), b = expand(node.b, seen, locals);
          if (!a || !b || a.length * b.length > 64) return undefined;
          const values: string[] = [];
          for (const left of a) for (const right of b) {
            if (left.length + right.length > 16384) return undefined;
            values.push(left + right);
          }
          return note(values);
        }
        uncertain = true;
        // Look for credential context inside opaque functions/operators, but never treat
        // their placeholder output as proof that the resulting expression is safe.
        if (node) for (const child of children(node)) if (!expand(child, seen, locals)) return undefined;
        return ['\uFFFC'];
      };
      const values = expand(expression.node, new Set());
      const sensitive = !values || found || (uncertain && context);
      assembled.set(formula, { sensitive, uncertain });
      return sensitive || (credentialPosition && uncertain);
    };
    const credentialParams = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, v] of Object.entries(value)) {
        if (isCredentialName(key)) strings(v).forEach((s) => this.mark(s));
        else {
          if (/(?:url|uri|endpoint|headers?|curloptions)$/i.test(key)) {
            strings(v).filter((s) => credentialExpression(s, true)).forEach((s) => this.mark(s));
          }
          credentialParams(v);
        }
      }
    };
    for (const step of this.steps) {
      credentialParams(step.params);
      const curl = step.params?.slots?.[129];
      if ((step.stepId === 160 || step.name === 'Insert from URL') && curl && credentialExpression(curl, true)) this.mark(curl);
      if ([111, 160].includes(step.stepId) && step.params?.calculation && credentialExpression(step.params.calculation, true)) this.mark(step.params.calculation);
      // Joining the parsed literal fragments exposes authentication syntax split by
      // concatenation ("https://user:" & $input & "@host/"). Taint every input
      // before the first trace, profiler event or debugger snapshot is emitted.
      for (const s of strings(step.params)) {
        this.markCurlCredentialInputs(s);
        if (!(authenticationText(s) || authenticationText(this.expression(s).literals.join('')) || credentialExpression(s))) continue;
        this.mark(s);
        const target = step.params?.variable ?? step.params?.field?.field.name;
        if (target) this.names.add(target.toLowerCase());
      }
    }
    // Propagate in both directions: later credential uses taint earlier inputs, and copies of those
    // inputs stay hidden too. This finishes before the first trace/profile/debugger event is emitted.
    let size: number;
    do {
      size = this.names.size;
      for (const [target, formulas] of assignments) {
        for (const formula of formulas) {
          const expression = this.expression(formula);
          // Exit Script [ Get ( ScriptResult ) ] only passes through the existing result.
          // It adds no input that could justify tainting unrelated fields in the file.
          if (target === SCRIPT_RESULT && expression.node?.k === 'get' && expression.node.param.toLowerCase() === 'scriptresult') continue;
          if (credentialExpression(formula) || expression.refs.some((s) => this.sensitiveName(s))) this.names.add(target);
          if (this.sensitiveName(target)) {
            // Public inputs to a visible transformation need not be secret. Opaque
            // sources in a credential-named destination cannot make that guarantee.
            if (this.names.has(target) || expression.direct || expression.dynamic) this.mark(formula);
          }
        }
      }
    } while (this.names.size !== size);
  }

  sensitiveName(name: string): boolean { return isCredentialName(name) || this.names.has(name.toLowerCase()); }
  sensitiveExpression(formula: string): boolean {
    const parsed = this.expression(formula);
    return sensitiveText(formula) || parsed.credentialLiteral || (parsed.malformed && isCredentialName(formula))
      || (this.opaqueCredentials && parsed.dynamic) || parsed.refs.some((s) => this.sensitiveName(s));
  }
  /** Observe frame values before a trace, error or debugger watch can quote them. */
  scriptState(parameter: string, result: string): void {
    if (this.names.has(SCRIPT_PARAMETER)) this.remember(parameter);
    if (this.names.has(SCRIPT_RESULT)) this.remember(result);
  }
  /** Only a literal AST node qualifies, never a field, SQL call or calculated expression. */
  literalExpression(formula: string): boolean {
    return this.expression(formula).literal && !this.sensitiveExpression(formula);
  }
  private addValue(value: string, sql = false): void {
    if ((sql ? this.sqlRememberFull : this.rememberFull) || !value || value === '?') return;
    const folded = rememberedPrefix(value.toLowerCase());
    if (this.values.has(folded)) return;
    const hash = fragmentHashes(folded.slice(0, FRAGMENT_LENGTH)).next().value;
    const cost = folded.length * 2 + 256 + (hash !== undefined && !this.prefixes.has(hash) ? 256 : 0);
    if ((sql ? this.sqlRememberedBytes + cost > MAX_SQL_REMEMBERED_BYTES : this.rememberedBytes + cost > MAX_REMEMBERED_BYTES)) {
      if (sql) this.sqlRememberFull = true;
      else this.rememberFull = true;
      return;
    }
    if (sql) this.sqlRememberedBytes += cost;
    else this.rememberedBytes += cost;
    this.values.add(folded);
    if (hash !== undefined) {
      let bucket = this.prefixes.get(hash);
      if (!bucket) this.prefixes.set(hash, bucket = new Set());
      bucket.add(folded);
    }
  }
  remember(value: string, sql = false): void {
    if ((sql ? this.sqlRememberFull : this.rememberFull) || !value || value === '?') return;
    value = rememberedPrefix(value);
    let wrapped = false;
    let added = false;
    const component = (part: string): void => {
      added = true;
      this.addValue(part, sql);
      try { this.addValue(decodeURIComponent(part), sql); } catch { /* Retain malformed credentials as written. */ }
    };
    // Keep only the password/token, never URL scheme, username, host or path.
    for (const match of value.matchAll(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]*/gi)) {
      wrapped = true;
      // A password may itself hold ?, # or :, so userinfo runs to the last @ before the first slash.
      const authority = match[0].slice(match[0].indexOf('://') + 3).split('/', 1)[0];
      const at = authority.lastIndexOf('@');
      if (at >= 0) {
        const userinfo = authority.slice(0, at);
        const colon = userinfo.indexOf(':');
        const lastColon = userinfo.lastIndexOf(':');
        component(userinfo.slice(colon + 1));
        // With more than one colon the split between user and password is ambiguous: keep every split.
        if (lastColon > colon) for (const part of [userinfo.slice(0, colon), userinfo.slice(0, lastColon), userinfo.slice(lastColon + 1)]) if (part) component(part);
      }
      const query = match[0].indexOf('?');
      if (query >= 0) for (const [key, part] of new URLSearchParams(match[0].slice(query + 1).split('#', 1)[0])) {
        if (isCredentialName(key)) { added = true; this.addValue(part, sql); }
      }
    }
    for (const match of value.matchAll(/(?:^|[\s"'])(--(?:user|proxy-user|oauth2-bearer)[=\s]+|-u\s*|Bearer\s+)["']?([^\s"']*)/gi)) {
      wrapped = true;
      const userPassword = /^(?:--(?:user|proxy-user)|-u)/i.test(match[1]);
      const colon = match[2].indexOf(':');
      if (!userPassword || colon >= 0) { added = true; this.addValue(userPassword ? match[2].slice(colon + 1) : match[2], sql); }
    }
    // A secret held in a URL path or a flag with no password part has no component to keep, so keep the whole value.
    if (!wrapped || !added) this.addValue(value, sql);
  }
  /** Mask known values in prose without treating diagnostic labels as credential inputs. */
  text(value: string): string {
    if (this.rememberFull || this.sqlRememberFull) return REDACTED;
    const escaped = [...this.values].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return escaped.length ? value.replace(new RegExp(escaped.join('|'), 'gi'), REDACTED) : value;
  }
  /** SQL results have their own cap so wide result sets cannot consume field-read learning. */
  rememberSql(value: string): void { this.remember(value, true); }
  value(value: string, name?: string, suppress = false, scriptLiteral = false): string {
    if (name && this.sensitiveName(name)) this.remember(value);
    // Once either source exceeds its cap, unknown derived values may contain a credential.
    if (this.rememberFull || this.sqlRememberFull || suppress || (name !== undefined && this.sensitiveName(name)) || sensitiveText(value)) return REDACTED;
    const folded = value.toLowerCase();
    if (this.values.has(folded)) return REDACTED;
    if (!scriptLiteral && folded.length >= FRAGMENT_LENGTH && folded.length <= MAX_VALUE_BYTES && !/^\p{L}{1,4}$/u.test(folded)) {
      // Partial matching applies to a whole displayed value, not incidental overlap in prose.
      for (const secret of this.values) if (secret.length >= MIN_FRAGMENT_SECRET_LENGTH && secret.includes(folded)) return REDACTED;
    }
    if (this.prefixes.size) {
      // Scan once for complete secrets, then verify the text to reject hash collisions.
      let start = 0;
      for (const hash of fragmentHashes(folded)) {
        const bucket = this.prefixes.get(hash);
        if (bucket) for (const secret of bucket) if (folded.startsWith(secret, start)) return REDACTED;
        start++;
      }
    }
    return value;
  }
  /** Preserve field types and repetitions; discover named secrets before emitting sibling aliases. */
  data(value: unknown, name?: string): unknown {
    const discover = (v: unknown, key?: string): void => {
      if (key && this.sensitiveName(key)) strings(v).forEach((s) => this.remember(s));
      if (Array.isArray(v)) v.forEach((x) => discover(x, key));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => discover(x, k));
    };
    discover(value, name);
    const walk = (v: unknown, key?: string): unknown => {
      if (Array.isArray(v)) return v.map((x) => walk(x, key));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
      if (v === null || v === undefined) return v;
      return this.value(String(v), key) === REDACTED ? REDACTED : v;
    };
    return walk(value, name);
  }
  line(step: ScriptStep, suppress = false): string {
    const line = step.line ?? step.name ?? `Step ${step.stepId}`;
    return suppress || CREDENTIAL_STEPS.has(step.stepId) || sensitiveText(line) || strings(step.params).some((s) => this.sensitiveExpression(s) || this.value(s) !== s)
      ? hiddenLine(line, step.stepId, step.name) : line;
  }
  error(message: string, step: ScriptStep, suppress = false): string {
    return suppress || this.line(step) !== (step.line ?? step.name ?? `Step ${step.stepId}`) || this.value(message) !== message ? 'Credential step failed' : message;
  }
}

/** Configured endpoints are identified by scheme and host, never userinfo, path, query or fragment. */
export function diagnosticEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return url.host ? `${url.protocol}//${url.host}` : REDACTED;
  } catch { return REDACTED; }
}

/** Mask values rather than entire diagnostics, so stack locations and cause chains remain useful. */
export function redactDiagnosticText(text: string, options: { labels?: boolean | 'assignments' } = {}): string {
  const values = new CredentialRedactor();
  const hide = (value: string) => { if (value !== REDACTED && value.length >= 4) values.remember(value); return REDACTED; };
  let safe = text
    .replace(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g, hide)
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\b(?:sk[-_]|github_pat_|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{20,}/g, hide)
    .replace(/\b[a-z][a-z\d+.-]{0,31}:\/\/[^\s<>"]+/gi, (url) => {
      // Source locations use file URLs; retain those unless they themselves contain userinfo.
      if (/^file:\/\//i.test(url) && !hasUrlAuth(url)) return url;
      const suffix = /[),;:']+$/.exec(url)?.[0] ?? '';
      return diagnosticEndpoint(url.slice(0, url.length - suffix.length)) + suffix;
    })
    .replace(/(\b(?:Bearer|Basic)[ \t]+)([^\s,;"']+)/gi, (_all, prefix: string, value: string) => prefix + hide(value))
    .replace(/(^|[ \t])((?:--(?:user|proxy-user|oauth2-bearer)[= \t]+|-u[ \t]*))((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s;]+))/gm,
      (_all, space: string, option: string, value: string) => space + option + hide(value))
    // A Cookie or Set-Cookie header is all session material: keep the header name, hide what follows.
    .replace(/(\b(?:Set-)?Cookie[ \t]*:[ \t]*)([^\r\n]+)/gi, (_all, prefix: string, value: string) => prefix + hide(value));
  // Scan separators once and bound label inspection. File locations end in an extension
  // ("credentials.ts:41:5"), not an assignment label; never treat a whole frame as a value.
  const spans: { start: number; end: number; replacement: string }[] = [];
  // 'assignments': only name=value and "name": value, so readable prose such as "Invalid token: signature mismatch" stays readable.
  for (const match of options.labels === false ? [] : safe.matchAll(/[:=]/g)) {
    if (options.labels === 'assignments' && match[0] === ':' && !/["']\s*$/.test(safe.slice(Math.max(0, match.index - 80), match.index))) continue;
    const left = safe.slice(Math.max(0, match.index - 80), match.index);
    const label = /([\w$-]+(?:[ \t]+[\w$-]+){0,2})["']?[ \t]*$/.exec(left)?.[1];
    if (!label || !isCredentialLabelName(label)) continue;
    const rest = safe.slice(match.index + 1);
    // Authentication schemes are useful labels; their payload was already masked above.
    if (/\bauthorization$/i.test(label) && /^[ \t]*(?:Bearer|Basic)[ \t]+/i.test(rest)) continue;
    // This names the invalid field and the expected type; it does not supply a credential.
    if (/\bfield[ \t]+[\w$-]+["']?[ \t]*$/i.test(left) && /^[ \t]*expected\b/i.test(rest)) continue;
    const value = /^[ \t]*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'|[^\s,;&}\])"']+)/.exec(rest);
    if (!value) continue;
    const raw = value[1];
    const quoted = raw.startsWith('"') || raw.startsWith("'");
    const content = quoted ? raw.slice(1, -1) : raw;
    spans.push({ start: match.index + 1 + value[0].length - raw.length, end: match.index + 1 + value[0].length,
      replacement: quoted ? raw[0] + hide(content) + raw[0] : hide(content) });
  }
  let end = 0;
  const parts: string[] = [];
  for (const span of spans) {
    if (span.start < end) continue;
    parts.push(safe.slice(end, span.start), span.replacement);
    end = span.end;
  }
  parts.push(safe.slice(end));
  safe = values.text(parts.join(''));
  return safe.split('\n').map((line) => CREDENTIAL_LINE.test(line) ? hiddenLine(line) : line).join('\n');
}
