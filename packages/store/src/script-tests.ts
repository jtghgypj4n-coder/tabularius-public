// Script test cases, which FileMaker doesn't have: a script's saved inputs (parameter, layout, found set,
// global variables and global fields, and stand-in AI answers) and what it should end with (result, error,
// found count, layout, global variables, the ending record's fields). Kept in the file, by script id so a
// rename keeps them; run offline by @tabularius/scripts' runScriptTests, from the editor, the CLI and CI.

import type { FindRequest } from './find.ts';

export interface ScriptTestGiven {
  /** The script parameter, as text. */
  parameter?: string;
  /** The layout the script starts on (by default the first layout of a table, as the runner picks). */
  layout?: string;
  /** The starting found set: all records (the default), or these find requests (Data API style). */
  find?: FindRequest[];
  /** Which record of the found set is current, from 1 (default 1). */
  record?: number;
  /** Global variables ($$name) and global fields (Table::Field) before the script starts, as text. */
  globals?: Record<string, string>;
  /** Answers the AI steps get, in order, in place of a model (the run never reaches one). */
  ai?: string[];
}

export interface ScriptTestExpect {
  /** Exit Script's result, as text. */
  result?: string;
  /** Get ( LastError ) at the end. */
  error?: number;
  foundCount?: number;
  layout?: string;
  /** Global variables ($$name) at the end, as text. */
  variables?: Record<string, string>;
  /** Fields of the record the script ends on (Table::Field, or a formula), as text. */
  fields?: Record<string, string>;
}

export interface ScriptTest {
  id: string;
  /** The script's id. */
  script: number;
  name: string;
  given: ScriptTestGiven;
  expect: ScriptTestExpect;
}

const LIMIT = 200;
/** Limits on one case, so the file's list stays small: text values, entries per list, and the whole case as JSON. */
const TEXT = 20_000;
const ENTRIES = 50;
const CASE_BYTES = 200_000;

const texts = (v: unknown, what: string): Record<string, string> | undefined => {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} must be an object of names and text values`);
  const entries = Object.entries(v);
  if (entries.length > ENTRIES) throw new Error(`${what}: at most ${ENTRIES} names`);
  const out: Record<string, string> = Object.create(null);
  for (const [k, x] of entries) {
    if (typeof x !== 'string' && typeof x !== 'number') throw new Error(`${what}: "${k}" must be text`);
    if (k.length > 300 || String(x).length > TEXT) throw new Error(`${what}: "${k.slice(0, 50)}" is too long`);
    if (k.trim()) out[k.trim()] = String(x);
  }
  return { ...out };
};

/** A test case as given (from the editor, the API or a file), checked and trimmed to what is known. */
export function cleanScriptTest(raw: unknown, scriptIds: number[]): Omit<ScriptTest, 'id'> & { id?: string } {
  const t = raw as Partial<ScriptTest> | undefined;
  if (!t || typeof t !== 'object') throw new Error('A test case must be an object');
  if (typeof t.script !== 'number' || !scriptIds.includes(t.script)) throw new Error('A test case must name a script of this file by id');
  const name = typeof t.name === 'string' ? t.name.trim().slice(0, 200) : '';
  if (!name) throw new Error('A test case needs a name');
  const g = (t.given ?? {}) as ScriptTestGiven;
  const e = (t.expect ?? {}) as ScriptTestExpect;
  const str = (v: unknown, what: string) => {
    if (v === undefined) return undefined;
    if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`${what} must be text`);
    if (String(v).length > TEXT) throw new Error(`${what} is longer than ${TEXT.toLocaleString('en-US')} characters`);
    return String(v);
  };
  const int = (v: unknown, what: string) => {
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${what} must be a whole number`);
    return v;
  };
  // Find requests: field names to criteria (text or numbers), and "omit".
  const request = (r: unknown) => !!r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length <= ENTRIES &&
    Object.entries(r).every(([k, x]) => k.length <= 300 && (typeof x === 'string' ? x.length <= TEXT : typeof x === 'number' || typeof x === 'boolean'));
  if (g.find !== undefined && (!Array.isArray(g.find) || g.find.length > ENTRIES || !g.find.every(request))) throw new Error('given.find must be a list of find requests (field: criterion)');
  if (g.ai !== undefined && (!Array.isArray(g.ai) || g.ai.length > ENTRIES || g.ai.some((a) => typeof a !== 'string' || a.length > TEXT))) throw new Error(`given.ai must be a list of at most ${ENTRIES} answers (text)`);
  const given: ScriptTestGiven = {
    ...(str(g.parameter, 'given.parameter') !== undefined ? { parameter: String(g.parameter) } : {}),
    ...(str(g.layout, 'given.layout') ? { layout: String(g.layout) } : {}),
    ...(g.find?.length ? { find: g.find } : {}),
    ...(int(g.record, 'given.record') ? { record: g.record } : {}),
    ...(texts(g.globals, 'given.globals') ? { globals: texts(g.globals, 'given.globals') } : {}),
    ...(g.ai?.length ? { ai: g.ai } : {}),
  };
  const expect: ScriptTestExpect = {
    ...(str(e.result, 'expect.result') !== undefined ? { result: String(e.result) } : {}),
    ...(int(e.error, 'expect.error') !== undefined ? { error: e.error } : {}),
    ...(int(e.foundCount, 'expect.foundCount') !== undefined ? { foundCount: e.foundCount } : {}),
    ...(str(e.layout, 'expect.layout') ? { layout: String(e.layout) } : {}),
    ...(texts(e.variables, 'expect.variables') ? { variables: texts(e.variables, 'expect.variables') } : {}),
    ...(texts(e.fields, 'expect.fields') ? { fields: texts(e.fields, 'expect.fields') } : {}),
  };
  if (!Object.keys(expect).length) throw new Error('A test case needs at least one expected result');
  if (JSON.stringify({ given, expect }).length > CASE_BYTES) throw new Error('This test case is too large to keep with the file');
  return { ...(typeof t.id === 'string' && t.id ? { id: t.id.slice(0, 64) } : {}), script: t.script, name, given, expect };
}

export const SCRIPT_TEST_LIMIT = LIMIT;
