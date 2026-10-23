// A local channel to the admin console, for Tabularius commands run on the
// server machine while it hosts the folder (`tabularius reconvert` and the
// like): no sudo, no admin password, no stopping the server.
//
// When the server is listening it writes <folder>/.openhbam.local, readable
// only by the user the server runs as, with its address and a random token.
// A request carrying that token in `x-tabularius-local` is let into the admin
// console. Whoever can read the file can already read the hosted files
// themselves, so it grants nothing they don't have. The file goes when the
// server stops.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sameSecret } from './secrets.ts';

export const LOCAL_FILE = '.openhbam.local';

export interface LocalAccess {
  pid: number;
  /** Where to reach the server from this machine. */
  url: string;
  token: string;
}

/** The address a command on this machine reaches a server listening on `hostname` at. */
export function localUrl(hostname: string | undefined, port: number, tls: boolean): string {
  const any = !hostname || hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]';
  const host = any ? '127.0.0.1' : hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return `${tls ? 'https' : 'http'}://${host}:${port}`;
}

/** Writes the local channel file; returns a function that removes it. */
export function openLocalAccess(folder: string, url: string): () => void {
  const file = join(folder, LOCAL_FILE);
  const access: LocalAccess = { pid: process.pid, url, token: randomBytes(32).toString('hex') };
  rmSync(file, { force: true }); // a new file, so the mode below applies
  writeFileSync(file, JSON.stringify(access), { mode: 0o600 });
  return () => {
    try {
      if (sameSecret((JSON.parse(readFileSync(file, 'utf8')) as LocalAccess).token, access.token)) rmSync(file, { force: true });
    } catch {
      // already gone
    }
  };
}

/** The running server's local channel, if it has one. */
export function localAccess(folder: string): LocalAccess | undefined {
  try {
    return JSON.parse(readFileSync(join(folder, LOCAL_FILE), 'utf8')) as LocalAccess;
  } catch {
    return undefined;
  }
}

const cached = new Map<string, { stamp: string; token: string }>();

/** Whether a request carries the folder's local token. */
export function isLocalAdmin(folder: string, header: string | string[] | undefined): boolean {
  if (typeof header !== 'string' || header.length !== 64) return false;
  const file = join(folder, LOCAL_FILE);
  let token: string;
  try {
    // A replaced file differs in its inode or size as well as its modification time (which some filesystems keep to the second).
    const st = statSync(file);
    const stamp = `${st.mtimeMs}:${st.ino}:${st.size}`;
    const c = cached.get(file);
    if (c && c.stamp === stamp) token = c.token;
    else {
      const read = (JSON.parse(readFileSync(file, 'utf8')) as LocalAccess).token;
      // A file with no token, or one that is not text, lets nobody in (and must not throw: that would be a 500 for the caller).
      if (typeof read !== 'string') return false;
      token = read;
      cached.set(file, { stamp, token });
    }
  } catch {
    return false;
  }
  // A header can hold characters past ASCII (latin1), which encode to more bytes; timingSafeEqual refuses unequal lengths.
  const given = Buffer.from(header);
  const wanted = Buffer.from(token);
  return token.length === 64 && given.length === wanted.length && timingSafeEqual(given, wanted);
}
