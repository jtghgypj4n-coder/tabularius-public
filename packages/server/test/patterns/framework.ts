// The solution-patterns suite (docs/solution-patterns.md): one small synthetic solution per widely used FileMaker pattern,
// exercised end to end. A pattern declares, per surface, the result it expects; its check runs the scenario and returns
// the outcome it observed. The test asserts the two agree, and the page is written from the declarations, so a pattern
// that stops working (or starts to) fails a test until the page is changed on purpose.
//
//   pass        the scenario behaves as the Claris page the pattern names says it does
//   partial     it works, and one stated part does not, or differs from the page
//   fail        it does not work as the page says
//   unverified  it runs, but the Claris pages say nothing that settles the result, so there is nothing to compare with
//
// Every expected result is the one the Claris Pro Help page named under the pattern states. The pages were not
// reachable from the environment this suite was written in, so each page is named from what its author knew of it, not
// re-read there; a pattern whose result no page settles is marked unverified, never guessed.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, Store } from '../../../store/src/index.ts';
import { runScript, type RunOptions, type RunResult } from '../../../scripts/src/index.ts';
import { serve } from '../../src/index.ts';

export type Status = 'pass' | 'partial' | 'fail' | 'unverified';
export type Surface = 'script' | 'dataApi' | 'web';
export const SURFACES: Surface[] = ['script', 'dataApi', 'web'];
export const SURFACE_NAMES: Record<Surface, string> = { script: 'Scripts', dataApi: 'Data API', web: 'Web client' };

export interface Outcome { status: Status; note?: string }

export interface Expect {
  /** The result this check must come out with. */
  expected: Status;
  /** What the result means in a sentence; required unless the result is pass. */
  note?: string;
}

export interface Pattern {
  /** Kebab-case id, stable. */
  id: string;
  title: string;
  /** What the pattern is, in a sentence. */
  what: string;
  /** The Claris Pro Help pages that state how it behaves. */
  claris: string[];
  script?: Expect & { run: (t: Workbench) => Promise<Outcome | void> };
  dataApi?: Expect & { run: (t: Workbench) => Promise<Outcome | void> };
  /** The web client check is in packages/web/e2e/solution-patterns.e2e.ts, keyed by id. */
  web?: Expect;
  /** A line for the page when a result is not pass: the backlog item it became. */
  backlog?: string;
}

export const pass = (): Outcome => ({ status: 'pass' });
export const partial = (note: string): Outcome => ({ status: 'partial', note });
export const fail = (note: string): Outcome => ({ status: 'fail', note });
export const unverified = (note: string): Outcome => ({ status: 'unverified', note });

/** A scratch folder of hosted files, with helpers to build a solution in it, run scripts and call the Data API. */
export class Workbench {
  readonly dir = mkdtempSync(join(tmpdir(), 'tabularius-pattern-'));
  private readonly stores = new Map<string, Store>();
  private served?: Awaited<ReturnType<typeof serve>>;
  /** Servers an earlier `api` call started, kept so `close` still stops them. */
  private readonly earlier: Awaited<ReturnType<typeof serve>>[] = [];

  /** A new empty file. */
  file(name: string): Store {
    const path = join(this.dir, `${name}.openhbam.sqlite`);
    createStore(path);
    const store = new Store(path, name);
    this.stores.set(name, store);
    return store;
  }

  /** Lets a file reach the others by name (an external data source), as a hosted folder does. */
  link(): void {
    for (const store of this.stores.values()) store.resolveFile = (n) => this.stores.get(n);
  }

  /** Adds a script from its text and runs it. */
  async run(store: Store, text: string, opts: RunOptions = {}): Promise<RunResult> {
    const name = `Pattern ${this.counter++}`;
    store.applyDesign([{ op: 'createScript', name, text }]);
    return runScript(store, name, opts);
  }
  private counter = 1;

  /** Hosts the folder (every file made so far, closed first) and returns a Data API client. */
  async api(file: string, account = 'Admin', password = 'pw'): Promise<Api> {
    for (const [name, store] of this.stores) {
      if (name === file) store.setPassword(account, password, '[Full Access]');
    }
    for (const store of this.stores.values()) store.close();
    this.stores.clear();
    if (this.served) this.earlier.push(this.served);
    this.served = await serve({ dir: this.dir, port: 0, log: () => {}, listFilesPublicly: true });
    const base = `${this.served.url}/fmi/data/vLatest/databases/${encodeURIComponent(file)}`;
    const signIn = await fetch(`${base}/sessions`, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${account}:${password}`).toString('base64'), 'content-type': 'application/json' }, body: '{}' });
    const token = ((await signIn.json()) as { response: { token: string } }).response.token;
    const call = async (method: string, path: string, body?: unknown) => {
      const form = body instanceof FormData;
      const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}) });
      const j = (await r.json()) as { response: any; messages: { code: string; message: string }[] };
      return { status: r.status, code: j.messages[0]?.code ?? '', message: j.messages[0]?.message ?? '', response: j.response };
    };
    return { call, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), base };
  }

  /** Where the folder is served, once `api` has been called. */
  get url(): string {
    if (!this.served) throw new Error('nothing is served yet: call api() first');
    return this.served.url;
  }

  /** The hosted store of a file the API serves. */
  hosted(name: string): Store {
    const store = this.served?.host.get(name);
    if (!store) throw new Error(`${name} is not hosted`);
    return store;
  }

  async close(): Promise<void> {
    for (const store of this.stores.values()) { try { store.close(); } catch { /* closed */ } }
    for (const served of [...this.earlier, ...(this.served ? [this.served] : [])]) {
      served.server.closeAllConnections();
      // Closing the server closes the hosted files too.
      await new Promise<void>((ok) => served.server.close(() => ok()));
    }
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** A path inside the scratch folder. */
  path(...parts: string[]): string {
    mkdirSync(this.dir, { recursive: true });
    return join(this.dir, ...parts);
  }
}

export interface Api {
  base: string;
  call(method: string, path: string, body?: unknown): Promise<{ status: number; code: string; message: string; response: any }>;
  get(path: string): ReturnType<Api['call']>;
  post(path: string, body?: unknown): ReturnType<Api['call']>;
  patch(path: string, body?: unknown): ReturnType<Api['call']>;
}

/** The text a saved PDF shows, in the order it was drawn (our own writer's output: uncompressed text operators). */
export function pdfText(pdf: Buffer): string[] {
  return [...pdf.toString('latin1').matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) => m[1].replace(/\\([0-7]{3}|.)/g, (_, c: string) => (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c)));
}
