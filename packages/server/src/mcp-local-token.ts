// The administrator token for /mcp when the server was not given one (--mcp-token): made once, kept in the hosted folder in a
// file only its owner can read, and checked on every call. A program on this computer reaches /mcp as the administrator only
// by reading that file, so another user of the same computer, or a web page, cannot.

import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const MCP_LOCAL_TOKEN_FILE = '.openhbam-mcp-token';
/** Starts every token made here, so a leaked one is easy to recognise (and to scan for). */
const PREFIX = 'tbmcp_';

/**
 * The folder's /mcp administrator token, made on first use. Two processes starting together (a cluster's workers) agree on
 * one: the file is created exclusively, and the loser reads what the winner wrote.
 */
export function localMcpToken(dir: string): string {
  const file = join(dir, MCP_LOCAL_TOKEN_FILE);
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = readToken(file);
    if (token) return token;
    let fd: number;
    try {
      fd = openSync(file, 'wx', 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw e;
    }
    try {
      writeSync(fd, `${PREFIX}${randomBytes(32).toString('base64url')}\n`);
    } finally {
      closeSync(fd);
    }
  }
  throw new Error(`${file} is empty or could not be written; delete it and start the server again`);
}

/** What the file holds, or undefined when it is missing or still being written. */
function readToken(file: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8').trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  return text.startsWith(PREFIX) && text.length >= PREFIX.length + 43 ? text : undefined;
}
