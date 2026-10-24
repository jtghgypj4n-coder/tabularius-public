import { portableName } from '../../store/src/portable-path.ts';
// A new solution from a description: the assistant plans the whole file (tables, fields, relationships, value lists,
// layouts and starter scripts) against an empty scratch file, so the plan is checked and its scripts dry-run before
// anything exists; the server administrator reviews it in the admin console, and only then is the file created, with
// every change applied at once or not at all.
//
//   POST /tabularius/admin/v1/solutions/plan   {name, description}: the plan (creates nothing)
//   POST /tabularius/admin/v1/solutions        {name, changes, password?}: the new file, hosted

import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../store/src/index.ts';
import type { DesignOp } from '../../store/src/index.ts';
import { STORE_EXT, type Host } from './host.ts';

export class SolutionError extends Error {}
const lower = (s: string) => s.toLowerCase();

/** Why a name can't be a database's: it must start with a letter or digit and use only letters, digits, spaces, - and _ (so it cannot name a path). */
export function databaseNameProblem(name: unknown): string | undefined {
  const clean = typeof name === 'string' ? name.trim() : '';
  return portableName(clean) && /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,99}$/u.test(clean) ? undefined : 'Database names use letters, digits, spaces, - and _ and cannot be Windows device names';
}

/** A database name the server could host: not taken, letters, digits, spaces, - and _. */
export function solutionName(host: Host, name: unknown): string {
  const clean = typeof name === 'string' ? name.trim() : '';
  const problem = databaseNameProblem(clean);
  if (problem) throw new SolutionError(problem);
  // Nor the name of a FileMaker file waiting in the folder to be converted (or for its passphrase).
  const waiting = existsSync(host.dir) ? readdirSync(host.dir).some((f) => lower(f) === lower(`${clean}.fmp12`) || lower(f).startsWith(lower(`${clean}${STORE_EXT}`))) : false;
  if (host.get(clean) || waiting) throw new SolutionError(`A database named "${clean}" already exists`);
  return clean;
}

/** An empty file to try a plan on, thrown away after. */
export function withScratch<T>(name: string, fn: (store: Store) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-solution-'));
  const gone = () => rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  let store: Store;
  try {
    const path = join(dir, `${name}${STORE_EXT}`);
    createStore(path);
    store = new Store(path, name);
  } catch (e) {
    gone();
    throw e;
  }
  return fn(store).finally(() => {
    store.close();
    gone();
  });
}

/** Creates the file with every change of the plan, or nothing: a plan that fails part way leaves no file behind. */
export async function createSolution(host: Host, body: { name?: unknown; changes?: unknown; password?: unknown }): Promise<{ database: string; changes: number }> {
  const name = solutionName(host, body.name);
  const changes = Array.isArray(body.changes) ? body.changes.filter((c): c is DesignOp => !!c && typeof c === 'object') : [];
  if (!changes.length) throw new SolutionError('Send the plan\'s changes');
  if (body.password !== undefined && (typeof body.password !== 'string' || !body.password)) throw new SolutionError('The password, when given, is text');
  const path = join(host.dir, name + STORE_EXT);
  createStore(path);
  try {
    const store = new Store(path, name);
    try {
      store.applyDesign(changes, { account: 'admin console' });
      if (typeof body.password === 'string') store.setPassword('Admin', body.password);
    } finally {
      store.close();
    }
  } catch (e) {
    for (const p of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(p)) unlinkSync(p);
    throw new SolutionError(`The plan didn't apply, so no file was made: ${(e as Error).message}`);
  }
  host.add(path, 'trusted', 'create');
  await host.openFileEverywhere(name);
  return { database: name, changes: changes.length };
}
