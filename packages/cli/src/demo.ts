// `tabularius demo [--starter crm|inventory|invoicing|tasks|booking] [--keep <folder>] [--port N] [--no-open]`:
// one command to try Tabularius. A starter app with its sample records in a temporary folder, hosted for this computer
// only on a free port, an Admin account with a random password printed once, the browser opened if it can be, and
// everything deleted when it stops. Nothing leaves the machine: no AI, no mail, no script network, no backups.

import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyStarter, createStore, Store, STARTER_NAMES } from '../../store/src/index.ts';
import { serve, STORE_EXT } from '../../server/src/index.ts';

export const DEMO_ACCOUNT = 'Admin';
export const DEFAULT_STARTER = 'crm';

/** Letters and digits that are not easily mistaken for each other, typed from a screen. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Twenty characters in groups of four: about 99 bits, from the system's random numbers. */
export function demoPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 5; g++) groups.push(Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''));
  return groups.join('-');
}

/** Why a host name is not this computer, or undefined when it is. */
export function notLoopback(host: string): string | undefined {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) && h.split('.').every((n) => Number(n) <= 255)) return undefined;
  return `demo: it only listens on this computer, so --host takes 127.0.0.1, localhost or ::1, not "${host}". To let other people in, host a folder with tabularius serve instead`;
}

export interface DemoOptions {
  starter?: string;
  /** Leave the files in this folder (it must be empty or new) instead of deleting them on exit. */
  keep?: string;
  host?: string;
  /** A particular port; otherwise one that is free is taken. */
  port?: number;
  /** Where the server's own lines go (nothing by default). The password is never among them. */
  log?: (line: string) => void;
}

export interface Demo {
  url: string;
  /** The web client's address, where a person starts. */
  app: string;
  account: string;
  password: string;
  folder: string;
  database: string;
  kept: boolean;
  /** Stops serving and deletes the files (unless kept). Safe to call twice. */
  stop(): Promise<void>;
}

/** The database's name: the starter's, capitalised. */
const databaseName = (starter: string) => (starter === 'crm' ? 'CRM' : starter[0].toUpperCase() + starter.slice(1));

function emptyOrNew(folder: string): void {
  if (!existsSync(folder)) return;
  if (!statSync(folder).isDirectory()) throw new Error(`demo: ${folder} is a file; give a folder for --keep`);
  if (readdirSync(folder).length) throw new Error(`demo: ${folder} is not empty, and demo will not put its files among yours. Give --keep a new or empty folder`);
}

export async function startDemo(opts: DemoOptions = {}): Promise<Demo> {
  const starter = opts.starter ?? DEFAULT_STARTER;
  if (!STARTER_NAMES.includes(starter)) throw new Error(`demo: --starter takes one of ${STARTER_NAMES.join(', ')} (not "${starter}")`);
  const host = opts.host ?? '127.0.0.1';
  const refused = notLoopback(host);
  if (refused) throw new Error(refused);
  if (opts.port !== undefined && !(Number.isInteger(opts.port) && opts.port >= 0 && opts.port < 65536)) throw new Error('demo: --port takes a port number');

  const kept = opts.keep !== undefined;
  // Refused before anything is made, so a folder with things in it is never touched, not even to clean up.
  if (kept) emptyOrNew(resolve(opts.keep!));
  const folder = kept ? resolve(opts.keep!) : mkdtempSync(join(tmpdir(), 'tabularius-demo-'));
  const existed = existsSync(folder);
  try {
    if (kept) mkdirSync(folder, { recursive: true });
    const database = databaseName(starter);
    const file = join(folder, database + STORE_EXT);
    createStore(file);
    const password = demoPassword();
    const store = new Store(file, database);
    try {
      applyStarter(store, starter, { sample: true, account: 'tabularius demo' });
      store.setPassword(DEMO_ACCOUNT, password, '[Full Access]');
    } finally {
      store.close();
    }
    // Everything the server could reach out with stays off: AI, mail, script network, webhooks, backups, off-site copies.
    const running = await serve({ dir: folder, port: opts.port ?? 0, hostname: host, log: opts.log ?? (() => {}), checkFiles: false });
    let stopped: Promise<void> | undefined;
    const demo: Demo = {
      url: running.url, app: `${running.url}/app/`, account: DEMO_ACCOUNT, password, folder, database, kept,
      stop: () => (stopped ??= (async () => {
        try {
          await new Promise<void>((done) => { running.server.close(() => done()); running.server.closeAllConnections?.(); });
          await running.host.close();
        } finally {
          if (!kept) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        }
      })()),
    };
    return demo;
  } catch (e) {
    // What this run made: all of a temporary folder; of a --keep folder (empty or new when it began), what was put in it.
    if (!kept || !existed) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    else for (const name of readdirSync(folder)) rmSync(join(folder, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    throw e;
  }
}
