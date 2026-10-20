// The part of JSON Schema (draft-07 and 2020-12) that the MCP tool schemas use, without a library. Two checks:
// schemaProblems says whether a schema is itself well formed; instanceProblems says whether a value fits one.
// A keyword it does not know is a problem, so a schema that starts using one fails the test until this learns it.

type Schema = boolean | { [keyword: string]: unknown };

const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
// Keywords that only describe or annotate; they say nothing a value could break.
const ANNOTATIONS = ['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly', 'format'];
const KEYWORDS = new Set([
  ...ANNOTATIONS, 'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'propertyNames', 'items', 'anyOf', 'oneOf', 'allOf',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'not', 'definitions', '$defs', '$ref',
]);

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** What is wrong with a schema as a schema (an empty list when nothing is). `root` is where "#/…" references start. */
export function schemaProblems(schema: Schema, root: Schema = schema, path = '#'): string[] {
  if (typeof schema === 'boolean') return [];
  if (!isObject(schema)) return [`${path}: a schema is an object or a boolean`];
  const out: string[] = [];
  const bad = (what: string) => out.push(`${path}: ${what}`);
  const sub = (child: unknown, at: string) => out.push(...schemaProblems(child as Schema, root, at));
  for (const [key, value] of Object.entries(schema)) {
    if (!KEYWORDS.has(key)) bad(`unknown keyword "${key}"`);
    switch (key) {
      case 'type':
        for (const t of Array.isArray(value) ? value : [value]) if (!TYPES.includes(t as string)) bad(`"${String(t)}" is not a type`);
        if (Array.isArray(value) && (!value.length || new Set(value).size !== value.length)) bad('type lists need distinct types');
        break;
      case 'enum': if (!Array.isArray(value) || !value.length) bad('enum needs a non-empty list'); break;
      case 'required':
        if (!Array.isArray(value) || value.some((r) => typeof r !== 'string') || new Set(value).size !== value.length) bad('required is a list of distinct names');
        break;
      case 'properties':
      case 'definitions':
      case '$defs':
        if (!isObject(value)) bad(`${key} is an object of schemas`);
        else for (const [name, child] of Object.entries(value)) sub(child, `${path}/${key}/${name}`);
        break;
      case 'additionalProperties': case 'propertyNames': case 'items': case 'not': sub(value, `${path}/${key}`); break;
      case 'anyOf': case 'oneOf': case 'allOf':
        if (!Array.isArray(value) || !value.length) bad(`${key} needs a non-empty list`);
        else value.forEach((child, i) => sub(child, `${path}/${key}/${i}`));
        break;
      case 'minimum': case 'maximum': case 'exclusiveMinimum': case 'exclusiveMaximum':
        if (typeof value !== 'number') bad(`${key} is a number`);
        break;
      case 'minLength': case 'maxLength': case 'minItems': case 'maxItems': case 'minProperties': case 'maxProperties':
        if (!isCount(value)) bad(`${key} is a count`);
        break;
      case 'pattern':
        try { new RegExp(String(value), 'u'); } catch { bad(`pattern ${JSON.stringify(value)} is not a regular expression`); }
        break;
      case '$ref':
        if (typeof value !== 'string' || !resolve(root, value)) bad(`$ref ${JSON.stringify(value)} points at nothing`);
        break;
    }
  }
  const { minimum, maximum, minLength, maxLength, minItems, maxItems } = schema as Record<string, number | undefined>;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) bad('minimum is above maximum');
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) bad('minLength is above maxLength');
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) bad('minItems is above maxItems');
  const props = isObject(schema.properties) ? Object.keys(schema.properties) : [];
  if (Array.isArray(schema.required) && schema.additionalProperties === false) {
    for (const r of schema.required) if (!props.includes(r as string)) bad(`"${String(r)}" is required but not a property, and no other is allowed`);
  }
  return out;
}

function resolve(root: Schema, ref: string): Schema | undefined {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  let at: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(at)) return undefined;
    at = at[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return at === undefined ? undefined : (at as Schema);
}

const typeOf = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Why a value does not fit a schema (an empty list when it does). */
export function instanceProblems(schema: Schema, value: unknown, root: Schema = schema, path = '$'): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${path}: nothing is allowed here`];
  const out: string[] = [];
  const bad = (what: string) => out.push(`${path}: ${what}`);
  if (typeof schema.$ref === 'string') {
    const target = resolve(root, schema.$ref);
    if (target) out.push(...instanceProblems(target, value, root, path));
  }
  const actual = typeOf(value);
  const types = schema.type === undefined ? undefined : ([] as string[]).concat(schema.type as string | string[]);
  if (types && !types.some((t) => t === actual || (t === 'integer' && Number.isInteger(value)) || (t === 'number' && actual === 'number'))) {
    bad(`expected ${types.join(' or ')}, got ${actual}`);
    return out;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => same(e, value))) bad(`${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if ('const' in schema && !same(schema.const, value)) bad(`expected ${JSON.stringify(schema.const)}`);
  for (const [keyword, expect] of [['anyOf', (n: number) => n > 0], ['oneOf', (n: number) => n === 1]] as const) {
    const options = schema[keyword];
    if (!Array.isArray(options)) continue;
    const fitting = options.filter((s) => instanceProblems(s as Schema, value, root, path).length === 0).length;
    if (!expect(fitting)) bad(`${JSON.stringify(value)?.slice(0, 80)} fits ${fitting} of the ${options.length} ${keyword} choices`);
  }
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf) out.push(...instanceProblems(s as Schema, value, root, path));
  if ('not' in schema && instanceProblems(schema.not as Schema, value, root, path).length === 0) bad('matches what "not" forbids');
  if (typeof value === 'number') {
    const s = schema as Record<string, number | undefined>;
    if (s.minimum !== undefined && value < s.minimum) bad(`${value} is below ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) bad(`${value} is above ${s.maximum}`);
    if (typeof s.exclusiveMinimum === 'number' && value <= s.exclusiveMinimum) bad(`${value} is not above ${s.exclusiveMinimum}`);
    if (typeof s.exclusiveMaximum === 'number' && value >= s.exclusiveMaximum) bad(`${value} is not below ${s.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    const s = schema as Record<string, number | string | undefined>;
    const length = [...value].length;
    if (typeof s.minLength === 'number' && length < s.minLength) bad(`shorter than ${s.minLength}`);
    if (typeof s.maxLength === 'number' && length > s.maxLength) bad(`longer than ${s.maxLength}`);
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(value)) bad(`does not match ${s.pattern}`);
  }
  if (Array.isArray(value)) {
    const s = schema as Record<string, unknown>;
    if (typeof s.minItems === 'number' && value.length < s.minItems) bad(`fewer than ${s.minItems} items`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) bad(`more than ${s.maxItems} items`);
    if (s.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) bad('items are not unique');
    if (s.items !== undefined) value.forEach((item, i) => out.push(...instanceProblems(s.items as Schema, item, root, `${path}[${i}]`)));
  }
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) for (const r of schema.required) if (!(r in value)) bad(`missing "${String(r)}"`);
    for (const [key, child] of Object.entries(value)) {
      if (key in props) out.push(...instanceProblems(props[key] as Schema, child, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) bad(`"${key}" is not allowed`);
      else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) out.push(...instanceProblems(schema.additionalProperties as Schema, child, root, `${path}.${key}`));
      if (schema.propertyNames !== undefined) out.push(...instanceProblems(schema.propertyNames as Schema, key, root, `${path}.<name ${key}>`));
    }
    const count = Object.keys(value).length;
    if (typeof schema.minProperties === 'number' && count < schema.minProperties) bad(`fewer than ${schema.minProperties} properties`);
    if (typeof schema.maxProperties === 'number' && count > schema.maxProperties) bad(`more than ${schema.maxProperties} properties`);
  }
  return out;
}
