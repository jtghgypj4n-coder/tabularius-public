// Conservative, pre-execution AI boundary with schema-derived calculation taint (not persisted value taint).
// All reachable tables are included: calculations, portals, triggers and stored copies need not name
// the table a tool starts on. Unknown executable constructs fail closed, including for Full Access.
import { StoreError, type Store, type Privileges, type DesignOp } from '../../store/src/index.ts';
import { dataSourceFile } from '../../store/src/import.ts';
import { parse, resolveFunction, type Node } from '../../calc/src/index.ts';
import type { Script, Schema } from '../../fmp12/src/index.ts';
import { secretName } from './ai-output.ts';
import { assertNoAiVisibility } from './ai-security.ts';
import { sqlFieldRefs } from './ai-policy-sql.ts';

const lower = (s: string) => s.toLowerCase();
const entry = <T>(map: Record<string, T> | undefined, name: string): T | undefined =>
  Object.entries(map ?? {}).find(([key]) => lower(key) === lower(name))?.[1];

function policyFunction(store: Store, schema: Schema, name: string) {
  return resolveFunction(name, {
    plugin: (name) => store.plugin(name),
    customFunction: (name) => schema.customFunctions.find((f) => lower(f.name) === lower(name)),
  });
}

function refuse(store: Store, operation: string, why: string): never {
  throw new StoreError(9, `AI policy refused ${operation} in ${store.name}: ${why}. An administrator can turn the AI policy off for this file.`);
}

// These functions have no hidden data sources. Unknown/plugin functions require a reviewed addition.
const PURE = new Set(('abs acos asin atan average base64decode base64encode base64encoderfc case ceiling char choose code cos count date day dayname dayofweek dayofyear degrees exact exp filter filtervalues floor getasboolean getasdate getasnumber getastext getastime getastimestamp getvalue getvalues hexdecode hexencode hour if isempty isvalid jsonformatElements jsongetelement jsonlistelements jsonlistkeys jsonsetelement left leftvalues leftwords length list ln log lower max middle middlevalues middlewords min minute mod month monthname numtohex patterncount pi position proper quote radians random replace right rightvalues rightwords round second sign sin sqrt substitute sum tan textcolor textfont textsize textstyleadd textstyleremove time timestamp trim trimall truncate upper valuecount while wordcount year').toLowerCase().split(' '));
const STEPS = new Set([1, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 28, 31, 40, 44, 51, 60, 61, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 85, 86, 89, 90, 91, 103, 116, 125, 133, 141, 147, 164, 205, 206, 207, 212, 215, 216, 218, 219, 220, 221, 227]);
const PARAMS = new Set('calculation errorCode errorMessage field selectEntireContents repetitionCalculation variable value repetition fieldName layout layoutDestination layoutCalculation scriptCalculation script parameter on noDialog skipValidation skipAutoEnter location exitAfterLast restore requests sort sortOrder replaceWith serial text ai'.split(' '));
const CALCS = new Set('calculation errorCode errorMessage repetitionCalculation value repetition fieldName layoutCalculation scriptCalculation parameter'.split(' '));

export interface AiPolicyRequest {
  formula?: string;
  sql?: string;
  /** Executing scripts can also execute layout/record triggers; inspect every script conservatively. */
  scripts?: boolean;
  programs?: readonly Script[];
  /** Arbitrary design changes or automation programs aren't proved by this analyzer. */
  uncertain?: boolean;
}

export function assertAiPolicy(store: Store, who: Privileges | string | undefined, operation: string, request: AiPolicyRequest = {}): void {
  const seen = new Map<Store, boolean>();
  const visit = (s: Store, inherited = false): void => {
    const on = inherited || s.aiPolicy;
    // A cycle/diamond may first reach a file OFF and later through an ON source; upgrade that visit.
    if (seen.get(s) === true || (seen.has(s) && !on)) return;
    seen.set(s, on);
    if (on) {
      const p = typeof who === 'string' ? s.privileges(who) : who?.in(s);
      // The local MCP administrator uses the saved Full Access policy, never an implicit exception.
      const set = p?.set ?? s.privilegeSets().find((p) => p.id === 1 || p.name === '[Full Access]');
      const secrets = secretFields(s, s.schema, p).fields;
      for (const table of s.schema.tables) {
        const visible = entry(set?.aiVisible, table.name);
        for (const field of table.fields) if (secrets.get(table.id)?.has(field.id) && visible !== true && !visible?.some((n) => lower(n) === lower(field.name))) {
          // An account-hidden field must not be named by a refusal that runs
          // before SQL planning, including for malformed queries.
          if (p?.field(table.name, field.name) === 'none') {
            refuse(s, operation, `a field is not AI-visible in privilege set "${set?.name ?? '[Full Access]'}"`);
          }
          refuse(s, operation, `table "${table.name}" contains secret or secret-derived field "${field.name}"; mark the field AI-visible in privilege set "${set?.name ?? '[Full Access]'}"`);
        }
      }
      if (request.uncertain || request.programs?.length === 0) refuse(s, operation, 'its read set cannot be determined statically');
      // Materialized and unstored formulas and record privileges can themselves execute dynamic reads.
      for (const table of s.schema.tables) for (const field of table.fields) {
        if ((field.hasCalculation || field.kind === 'calculation') && !field.calculation) refuse(s, operation, `calculation field "${table.name}::${field.name}" has no decoded source; its read set cannot be determined statically`);
        if (field.calculation) formula(s, field.calculation, operation);
        if (field.options?.validation?.calculation) formula(s, field.options.validation.calculation, operation);
      }
      for (const table of [set?.records, ...Object.values(set?.tables ?? {})]) {
        for (const rule of [table?.view, table?.edit, table?.delete]) if (typeof rule === 'string') formula(s, rule, operation);
      }
      if (request.formula !== undefined) formula(s, request.formula, operation);
      if (request.sql !== undefined) sql(s, request.sql, operation);
      if (request.scripts) {
        for (const script of s.schema.scripts) scriptReads(s, script, operation);
        // A referenced file's ON policy also constrains the entry file's program, even when that file is OFF.
        if (s !== store) for (const script of store.schema.scripts) scriptReads(s, script, operation);
      }
      for (const script of request.programs ?? []) scriptReads(s, script, operation);
    }
    for (const source of s.schema.dataSources) {
      const name = dataSourceFile(source.paths) ?? source.name;
      let other: Store | undefined;
      try { other = s.resolveFile(name) as Store | undefined; } catch { /* unresolved is uncertain */ }
      if (other) visit(other, on);
      else if (on) refuse(s, operation, `the read set of external source "${source.name}" cannot be determined statically`);
    }
  };
  visit(store);
}

type Dependency = { secret: boolean; refs: Set<Dependency> };
interface SecretDependencies {
  fields: Map<number, Set<number>>;
  customFunctions: Set<number>;
}
// Shared across all expanded bodies of one calculation/function, not reset at each call.
const DEPENDENCY_DEPTH = 64;
const DEPENDENCY_CHARACTERS = 65_536;
const DEPENDENCY_NODES = 10_000;
const SAFE_GET = new Set('accountname currentdate currenttime currenttimestamp recordid recordnumber foundcount lasterror'.split(' '));

/** Direct references and lookup copies through any occurrence, including hosted files and transitive chains.
 * Recomputed on every check; AI-visible source exceptions never erase its secret classification. */
function secretFields(store: Store, schema: Schema, who?: Privileges): SecretDependencies {
  type File = { store: Store; schema: Schema; fields: Map<number, Map<number, Dependency>>; sources: Map<number, File>;
    customFunctions: Map<number, Dependency>; unknown: Dependency };
  const dependency = (secret = false): Dependency => ({ secret, refs: new Set() });
  const files = new Map<Store, File>();
  const visit = (s: Store): File => {
    const seen = files.get(s);
    if (seen) return seen;
    const current = s === store ? schema : s.schema;
    const p = who?.in(s);
    const file: File = { store: s, schema: current, sources: new Map(), unknown: dependency(),
      customFunctions: new Map(current.customFunctions.map((f) => [f.id, dependency()])),
      fields: new Map(current.tables.map((table) => [table.id,
        new Map(table.fields.map((field) => [field.id, dependency(secretName(field.name) || p?.field(table.name, field.name) === 'none')])),
      ])) };
    files.set(s, file);
    // An unresolved read can depend on any field in this file or its sources.
    // A graph edge, rather than a snapshot boolean, also catches derived secrets.
    for (const fields of file.fields.values()) for (const field of fields.values()) file.unknown.refs.add(field);
    for (const source of current.dataSources) {
      try {
        const other = s.resolveFile(dataSourceFile(source.paths) ?? source.name) as Store | undefined;
        if (other) {
          const resolved = visit(other);
          file.sources.set(source.id, resolved);
          file.unknown.refs.add(resolved.unknown);
        } else file.unknown.secret = true;
      } catch { file.unknown.secret = true; }
    }
    return file;
  };
  const root = visit(store);
  const occurrence = (file: File, ref: string | number) => {
    const to = file.schema.tableOccurrences.find((o) => typeof ref === 'number' ? o.id === ref : lower(o.name) === lower(ref));
    const owner = to?.dataSourceId ? file.sources.get(to.dataSourceId) : file;
    const table = owner?.schema.tables.find((t) => t.id === to?.baseTableId);
    return owner && table ? { owner, table } : undefined;
  };
  const readDependencies = (file: File, target: Dependency, text: string | undefined,
    parameters: string[] = [], table?: Schema['tables'][number]): void => {
    const unknown = () => { target.refs.add(file.unknown); };
    const names = { fields: (table ? [table] : file.schema.tables).flatMap((t) => t.fields.map((f) => f.name)),
      occurrences: file.schema.tableOccurrences.map((o): [string, string[]] => [o.name, occurrence(file, o.id)?.table.fields.map((f) => f.name) ?? []]) };
    // A standalone function has no caller table: union every possible local field.
    const addRef = (ref: { occurrence?: string; name: string }): boolean => {
      const source = ref.occurrence ? occurrence(file, ref.occurrence) : undefined;
      const sources = ref.occurrence ? (source ? [source] : [])
        : (table ? [table] : file.schema.tables).map((t) => ({ owner: file, table: t }));
      let found = false;
      for (const source of sources) {
        const origin = source.table.fields.find((f) => lower(f.name) === lower(ref.name));
        const dep = origin && source.owner.fields.get(source.table.id)?.get(origin.id);
        if (dep) { target.refs.add(dep); found = true; }
      }
      return found;
    };
    let characters = DEPENDENCY_CHARACTERS;
    let nodes = DEPENDENCY_NODES;
    let exhausted = false;
    const visiting = new Set<number>();
    const custom = (fn: Schema['customFunctions'][number], depth: number): void => {
      if (fn.language === 'javascript' || visiting.has(fn.id)) { unknown(); return; }
      visiting.add(fn.id);
      // Parameters are unknown values, never substituted as literal field/SQL names.
      // A callee has its own scope; it cannot capture a caller's parameters or Let names.
      read(fn.formula, depth + 1, new Set(fn.parameters.map((p) => lower(p.trim()))));
      visiting.delete(fn.id);
    };
    const read = (text: string | undefined, depth: number, bound: Set<string>): void => {
      if (exhausted) return;
      if (depth > DEPENDENCY_DEPTH || text === undefined) { unknown(); return; }
      characters -= text.length;
      if (characters < 0) { exhausted = true; unknown(); return; }
      let ast: Node;
      try { ast = parse(text, names, bound); }
      catch { unknown(); return; }
      // Iterative AST traversal also bounds wide/left-deep expressions without a JS stack overflow.
      const pending: { node: Node; bound: Set<string> }[] = [{ node: ast, bound }];
      while (pending.length && !exhausted) {
        if (--nodes < 0) { exhausted = true; unknown(); break; }
        const { node: n, bound } = pending.pop()!;
        const push = (node: Node, scope = bound) => { pending.push({ node, bound: scope }); };
        if (n.k === 'call') {
          const name = lower(n.name);
          const resolved = policyFunction(file.store, file.schema, n.name);
          if (resolved?.kind === 'custom') custom(resolved.fn, depth);
          else if (resolved?.kind !== 'builtin') unknown();
          else if (['getfield', 'getfieldname', 'getbasetablename'].includes(name)) {
            const arg = n.args[0];
            if (arg?.k === 'str') {
              const match = /^(.*?)::(.*)$/.exec(arg.value);
              const fieldName = (match ? match[2] : arg.value).replace(/\[\d+\]$/, '');
              if (arg.value !== '' && !addRef({ occurrence: match?.[1] || undefined, name: fieldName })) unknown();
            } else if (name === 'getfield' || arg?.k !== 'field' || (!arg.occurrence && bound.has(lower(arg.name)))) unknown();
          } else if (name === 'evaluate') {
            if (n.args[0]?.k === 'str') read(n.args[0].value, depth + 1, bound);
            else unknown();
          } else if (name === 'executesql' || name === 'executesqle') {
            const refs = n.args[0]?.k === 'str' ? sqlFieldRefs(file.schema, n.args[0].value) : undefined;
            if (!refs) unknown();
            else for (const ref of refs) {
              const dep = file.fields.get(ref.table)?.get(ref.field);
              if (dep) target.refs.add(dep);
              else unknown();
            }
          } else if (!PURE.has(name) && name !== '[]') {
            // An unreviewed built-in cannot borrow the read set of a same-named custom body.
            unknown();
          }
          for (const [i, arg] of n.args.entries()) {
            // While's initial bindings are also in scope for its logic/result payload.
            const initial = name === 'while' && i === 1 && n.args[0]?.k === 'let' ? n.args[0].binds : [];
            push(arg, initial.length ? new Set([...bound, ...initial.map(([key]) => lower(key.replace(/\[.*$/, '')))]) : bound);
          }
        } else if (n.k === 'field' || n.k === 'var') {
          const qualified = n.k === 'field' && n.occurrence;
          if (qualified || !bound.has(lower(n.name))) {
            if (n.k === 'var' && n.name.startsWith('$')) unknown();
            else {
              const found = addRef({ occurrence: qualified || undefined, name: n.name });
              // A zero-parameter function may be written without parentheses;
              // a real field takes precedence in a known caller context.
              const resolved = !qualified && (!found || !table) ? policyFunction(file.store, file.schema, n.name) : undefined;
              if (resolved?.kind === 'custom' && !resolved.fn.parameters.length) custom(resolved.fn, depth);
              else if (resolved?.kind === 'builtin' && resolved.fn.min === 0) {
                if (!PURE.has(lower(n.name))) unknown();
              } else if ((resolved?.kind === 'plugin' && resolved.fn.min === 0) || !found) unknown();
            }
          }
          if (n.rep) push(n.rep);
        } else if (n.k === 'get') {
          if (!SAFE_GET.has(lower(n.param))) unknown();
        } else if (n.k === 'bin') { push(n.a); push(n.b); }
        else if (n.k === 'unary') push(n.a);
        else if (n.k === 'let') {
          const inner = new Set(bound);
          for (const [key, value, rep] of n.binds) {
            push(value, new Set(inner));
            if (rep) push(rep, new Set(inner));
            inner.add(lower(key.replace(/\[.*$/, '')));
          }
          push(n.body, inner);
        }
      }
    };
    read(text, 0, new Set(parameters.map((p) => lower(p.trim()))));
  };
  for (const file of files.values()) {
    for (const table of file.schema.tables) for (const field of table.fields) {
      const target = file.fields.get(table.id)!.get(field.id)!;
      // Aggregation changes the representation, not its provenance (including count/empty signals).
      if (field.kind === 'summary') {
        const source = field.summary && file.fields.get(table.id)?.get(field.summary.fieldId);
        target.refs.add(source ?? file.unknown);
      }
      const lookup = field.options?.autoEnter?.lookup;
      if (lookup) {
        const source = occurrence(file, lookup.occurrenceId);
        const dep = source?.owner.fields.get(source.table.id)?.get(lookup.fieldId);
        target.refs.add(dep ?? file.unknown);
      }
      if (field.calculation !== undefined || field.hasCalculation || field.kind === 'calculation') {
        readDependencies(file, target, field.calculation, [], table);
      }
    }
    for (const fn of file.schema.customFunctions) {
      const target = file.customFunctions.get(fn.id)!;
      if (fn.language === 'javascript') target.refs.add(file.unknown);
      else readDependencies(file, target, fn.formula, fn.parameters);
    }
  }
  const dependencies = [...files.values()].flatMap((file) => [file.unknown, ...file.customFunctions.values(),
    ...[...file.fields.values()].flatMap((fields) => [...fields.values()])]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of dependencies) {
      if (!field.secret && [...field.refs].some((ref) => ref.secret)) { field.secret = true; changed = true; }
    }
  }
  return {
    fields: new Map([...root.fields].map(([table, fields]) => [table, new Set([...fields].filter(([, field]) => field.secret).map(([id]) => id))])),
    customFunctions: new Set([...root.customFunctions].filter(([, fn]) => fn.secret).map(([id]) => id)),
  };
}

/** Preview and apply share this check; refuse before stored calculations can copy any values.
 * A blanket human table exception is not permission for AI to manufacture new secret copies. */
export function assertAiDesignChanges(store: Store, changes: readonly unknown[], who?: Privileges, readOtherFile?: (file: Store) => boolean): void {
  assertNoAiVisibility(changes);
  if (!store.aiPolicy) return;
  const before = secretFields(store, store.schema, who);
  let previous = store.schema;
  let previousSecrets = before;
  // Inspect each intermediate schema: create/copy/delete in one batch must not erase the evidence.
  for (let i = 1; i <= changes.length; i++) {
    const { schema } = store.checkDesign(changes.slice(0, i) as DesignOp[], { readOtherFile });
    const secrets = secretFields(store, schema, who);
    for (const table of schema.tables) for (const field of table.fields) {
      const prior = previous.tables.find((t) => t.id === table.id)?.fields.find((f) => f.id === field.id);
      // Match identities before considering the new name. An AI-visible exception permits reads,
      // but must not let AI erase either the secret classification or name-based output redaction.
      if (prior && prior.name !== field.name && previousSecrets.fields.get(table.id)?.has(field.id)) {
        refuse(store, 'AI design change', `secret or secret-derived field "${table.name}::${prior.name}" cannot be renamed by AI; a human must make this change`);
      }
      if ((!field.calculation && !field.options?.autoEnter?.lookup && field.kind !== 'summary') || !secrets.fields.get(table.id)?.has(field.id)) continue;
      const old = store.schema.tables.find((t) => t.id === table.id)?.fields.find((f) => f.id === field.id);
      if (!old || old.calculation !== field.calculation || JSON.stringify(old.options?.autoEnter?.lookup) !== JSON.stringify(field.options?.autoEnter?.lookup)
        || JSON.stringify(old.summary) !== JSON.stringify(field.summary) || !before.fields.get(table.id)?.has(field.id)) {
        refuse(store, 'AI design change', `field "${table.name}::${field.name}" derives from a secret field; a human must make this change`);
      }
    }
    for (const fn of schema.customFunctions) {
      if (!secrets.customFunctions.has(fn.id)) continue;
      const prior = previous.customFunctions.find((f) => f.id === fn.id);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(fn) || !previousSecrets.customFunctions.has(fn.id)) {
        refuse(store, 'AI design change', `custom function "${fn.name}" derives from a secret field; a human must make this change`);
      }
    }
    previous = schema;
    previousSecrets = secrets;
  }
}

function sql(store: Store, text: string, operation: string): void {
  // Use the same schema-only planner as ExecuteSQL calculation dependencies.
  // A store query that compiles can still name an unreviewed SQL source.
  if (!sqlFieldRefs(store.schema, text)) refuse(store, operation, 'SQL read set cannot be determined statically');
  let origins;
  try { origins = store.inspectQuery(text); }
  catch { refuse(store, operation, 'SQL read set cannot be determined statically'); }
  if (origins.virtual || origins.tables.some((t) => !store.schema.tables.some((s) => lower(s.name) === lower(t.table)))) {
    refuse(store, operation, 'SQL reads a virtual or unknown source; its read set cannot be determined statically');
  }
}

function formula(store: Store, text: string, operation: string, visiting = new Set<string>(),
  budget = { characters: DEPENDENCY_CHARACTERS, nodes: DEPENDENCY_NODES }, parameters: string[] = []): void {
  budget.characters -= text.length;
  if (visiting.size > DEPENDENCY_DEPTH || budget.characters < 0) refuse(store, operation, 'calculation read set cannot be determined statically within the analysis limit');
  let ast: Node;
  try {
    ast = parse(text, { fields: store.schema.tables.flatMap((t) => t.fields.map((f) => f.name)),
      occurrences: store.schema.tableOccurrences.map((o) => [o.name, store.schema.tables.find((t) => t.id === o.baseTableId)?.fields.map((f) => f.name) ?? []]) }, parameters.map((p) => p.trim()));
  } catch { refuse(store, operation, 'calculation read set cannot be determined statically'); }
  const call = (name: string, args: Node[]): void => {
    const resolved = policyFunction(store, store.schema, name);
    const key = lower(name);
    if (resolved?.kind === 'custom') {
      const custom = resolved.fn;
      if (custom.formula === undefined || custom.language === 'javascript' || visiting.has(key)) refuse(store, operation, `${name} has an uncertain read set`);
      formula(store, custom.formula, operation, new Set([...visiting, key]), budget, custom.parameters);
    } else if (resolved?.kind !== 'builtin') refuse(store, operation, `${name} has an uncertain read set`);
    else if (key === 'evaluate') refuse(store, operation, 'Evaluate has an uncertain read set');
    else if (key === 'executesql') {
      if (args[0]?.k !== 'str') refuse(store, operation, 'ExecuteSQL uses dynamic SQL; its read set cannot be determined statically');
      sql(store, args[0].value, operation);
    } else if (key === 'getfield' || key === 'getfieldname') {
      if (args[0]?.k !== 'str') refuse(store, operation, `${name} uses a dynamic field name; its read set cannot be determined statically`);
    } else if (!PURE.has(key)) refuse(store, operation, `${name} has an uncertain read set`);
  };
  const pending: { node: Node; bound: Set<string> }[] = [{ node: ast, bound: new Set(parameters.map((p) => lower(p.trim()))) }];
  while (pending.length) {
    if (--budget.nodes < 0) refuse(store, operation, 'calculation read set cannot be determined statically within the analysis limit');
    const { node: n, bound } = pending.pop()!;
    const push = (node: Node, scope = bound) => { pending.push({ node, bound: scope }); };
    if (n.k === 'var' && n.name.startsWith('$$')) refuse(store, operation, 'a global variable has an uncertain cross-run read set');
    if (n.k === 'call') {
      call(n.name, n.args);
      for (const [i, arg] of n.args.entries()) {
        const initial = lower(n.name) === 'while' && i === 1 && n.args[0]?.k === 'let' ? n.args[0].binds : [];
        push(arg, initial.length ? new Set([...bound, ...initial.map(([key]) => lower(key.replace(/\[.*$/, '')))]) : bound);
      }
    } else if (n.k === 'get') {
      // Get can expose cross-run results, errors, external data or session variables.
      if (!SAFE_GET.has(lower(n.param))) refuse(store, operation, `Get (${n.param}) has an uncertain read set`);
    } else if (n.k === 'bin') { push(n.a); push(n.b); }
    else if (n.k === 'unary') push(n.a);
    else if (n.k === 'let') {
      const inner = new Set(bound);
      for (const [key, value, rep] of n.binds) {
        push(value, new Set(inner));
        if (rep) push(rep, new Set(inner));
        inner.add(lower(key.replace(/\[.*$/, '')));
      }
      push(n.body, inner);
    } else if (n.k === 'var' || n.k === 'field') {
      if (n.k === 'var' && !n.name.startsWith('$') && !bound.has(lower(n.name))) {
        const resolved = policyFunction(store, store.schema, n.name);
        if (resolved && (resolved.kind === 'custom' ? !resolved.fn.parameters.length : resolved.fn.min === 0)) call(n.name, []);
      }
      if (n.rep) push(n.rep);
    }
  }
}

function scriptReads(store: Store, script: Script, operation: string): void {
  for (const step of script.steps) {
    if (!step.enabled || step.stepId === 89) continue;
    if (!STEPS.has(step.stepId)) refuse(store, operation, `script "${script.name}" step "${step.name}" has an uncertain read set`);
    const params = step.params ?? {};
    for (const calc of [params.serial?.initial, params.serial?.increment]) if (calc !== undefined) formula(store, calc, operation);
    if (params.ai) {
      const calculations = new Set('accountName apiKey model input vector returnCount threshold endpoint prompt parameters templateName ragAccountName spaceId tokensPerChunk instructions historyCount historyRepetition'.split(' '));
      const options = new Set('sourceField replaceTarget continueOnError showSummary queryBy recordSet condition findGet ragAction dataSource responseVariable messagesVariable historyVariable'.split(' '));
      for (const [key, value] of Object.entries(params.ai)) {
        if (calculations.has(key) && typeof value === 'string') formula(store, value, operation);
        else if (!options.has(key)) refuse(store, operation, `script "${script.name}" has unanalysed AI options`);
        if (['messagesVariable', 'historyVariable'].includes(key) && typeof value === 'string' && value.startsWith('$$')) refuse(store, operation, 'AI message history has an uncertain cross-run read set');
      }
      if (params.ai.dataSource && params.ai.dataSource !== 'from text' && !params.ai.dataSource.startsWith('from container')) refuse(store, operation, 'RAG file input has an uncertain read set');
    }
    for (const key of Object.keys(params)) if (!PARAMS.has(key)) refuse(store, operation, `script "${script.name}" step "${step.name}" has unanalysed options`);
    for (const calc of step.calculations ?? []) formula(store, calc, operation);
    for (const [key, value] of Object.entries(params)) if (CALCS.has(key) && typeof value === 'string') {
      if (['fieldName', 'layoutCalculation', 'scriptCalculation'].includes(key)) {
        let node: Node;
        try { node = parse(value); } catch { refuse(store, operation, `script "${script.name}" has a dynamic target`); }
        if (node.k !== 'str') refuse(store, operation, `script "${script.name}" has a dynamic target; its read set cannot be determined statically`);
      }
      formula(store, value, operation);
    }
    // Calls to other files are accounted for by the source graph above; missing script targets fail closed.
    if ([1, 164].includes(step.stepId) && (!params.script || params.script.file || !store.schema.scripts.some((s) => s.id === params.script?.id || s.name === params.script?.name))) {
      refuse(store, operation, `script "${script.name}" calls a script whose read set cannot be determined statically`);
    }
  }
}
