// The administrator token for /mcp when the server was not given one (--mcp-token): made once, kept in the hosted folder in a
// file only its owner can read, and checked on every call. A program on this computer reaches /mcp as the administrator only
// by reading that file, so another user of the same computer, or a web page, cannot (the admin console is a separate door:
// it trusts this computer until it has a password).

import { randomBytes } from 'node:crypto';
import { linkSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MCP_LOCAL_TOKEN_FILE = '.openhbam-mcp-token';
/** Starts every token made here, so a leaked one is easy to recognise (and to scan for). */
const PREFIX = 'tbmcp_';

/**
 * The folder's /mcp administrator token, made on first use. Two processes starting together (a cluster's workers) agree on
 * one: it is written to a file of its own and linked into place, which only one of them can do, and the others read it. A file
 * that is already there is used only when it is a plain file of this user's that nobody else can read.
 */
export function localMcpToken(dir: string): string {
  const file = join(dir, MCP_LOCAL_TOKEN_FILE);
  const existing = readLocalMcpToken(dir);
  if (existing) return existing;
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temp, `${PREFIX}${randomBytes(32).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  try {
    linkSync(temp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  } finally {
    unlinkSync(temp);
  }
  const made = readLocalMcpToken(dir);
  if (!made) throw new Error(`${file} could not be made; check that this user can write to the folder`);
  return made;
}

/** The token already kept in the folder, or undefined when there is none yet. A file that is not safe to trust is an error. */
export function readLocalMcpToken(dir: string): string | undefined {
  const file = join(dir, MCP_LOCAL_TOKEN_FILE);
  let stat;
  try {
    stat = lstatSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  const unsafe = !stat.isFile() ? 'is not a plain file'
    : process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid() ? 'belongs to another user'
    : process.platform !== 'win32' && (stat.mode & 0o077) !== 0 ? 'can be read by other users'
    : undefined;
  if (unsafe) throw new Error(`${file} ${unsafe}, so it is not trusted as the /mcp token. Delete it (or run chmod 600 on your own file) and start the server again.`);
  const text = readFileSync(file, 'utf8').trim();
  if (!text.startsWith(PREFIX) || text.length < PREFIX.length + 43) throw new Error(`${file} does not hold a /mcp token. Delete it and start the server again.`);
  return text;
}
