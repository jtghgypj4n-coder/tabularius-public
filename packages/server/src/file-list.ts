// Which hosted files a caller may see listed. File names are not secret from the people who use them, but a stranger
// who can reach the port learns nothing from the list: by default the lists (the root's, the Data API's and OData's)
// name no file. `--list-files-publicly` (TABULARIUS_LIST_FILES_PUBLICLY) brings back the open lists, as FileMaker Server's
// are. (Checking an account against every file for each list request was tried and left out: it makes one request cost
// a password check per file, counts a failed sign-in in each, and can't answer for directory or identity-provider accounts.)

import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { spendPasswordCheck } from '../../store/src/index.ts';
import { ApiError } from './dataapi.ts';
import type { Host } from './host.ts';

/** The files to list: all of them when the server lists files publicly, else none, and undefined to refuse the request. */
export function listedFiles(host: Host): string[] | undefined {
  return host.listFilesPublicly ? host.names() : undefined;
}

/** The password a Basic header carries, or undefined when the request has none. */
function basicPassword(req: IncomingMessage): string | undefined {
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!basic) return undefined;
  const [, ...rest] = Buffer.from(basic, 'base64').toString('utf8').split(':');
  return rest.join(':');
}

function basicAccount(req: IncomingMessage): string {
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  return basic ? Buffer.from(basic, 'base64').toString('utf8').split(':')[0] : '';
}

/**
 * Refuses a request for a file that isn't hosted the way a hosted file refuses a caller with the same kind of credential
 * (none, a password, a token), at the same cost, so a guessed name is not confirmed by the answer. Only when the server
 * doesn't list its files; with --list-files-publicly the names aren't secret and "no such file" stays.
 */
export async function refuseUnknownFile(host: Host, req: IncomingMessage): Promise<void> {
  if (host.listFilesPublicly) return;
  const auth = req.headers.authorization ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? req.headers['x-fm-data-access-token'] as string | undefined;
  if (bearer?.startsWith('ohbt_')) throw new ApiError(212, 'Invalid API token', 401);
  if (/^Bearer\s/i.test(auth) || req.headers['x-fm-data-access-token']) throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
  const password = basicPassword(req);
  if (password === undefined) throw new ApiError(212, 'Sign in with an account name and password', 401);
  // A hosted file's check is skipped when no account is named.
  if (basicAccount(req)) await spendPasswordCheck(password);
  throw new ApiError(212, 'Invalid user account and/or password', 401);
}

const decoyKey = randomBytes(32);

/** A passkey sign-in start for a file that isn't hosted: a challenge and, for a named account, credential ids that are the same each time asked, as a hosted file's decoys are. */
export function decoyPasskeyStart(db: string, account: string | undefined, rpId: string): { challenge: string; rpId: string; allowCredentials: string[] } {
  const ids: string[] = [];
  if (account) {
    const h = createHmac('sha256', decoyKey).update(db.toLowerCase()).update('\0').update(account.toLowerCase().slice(0, 256)).digest();
    const count = 1 + (h[30] % 3 === 0 ? 1 : 0);
    for (let i = 0; i < count; i++) ids.push(createHmac('sha256', decoyKey).update(h).update(String(i)).digest().toString('base64url'));
  }
  return { challenge: randomBytes(32).toString('base64url'), rpId, allowCredentials: ids };
}
