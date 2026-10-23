// Asks the server hosting a folder to do something, through its local admin
// channel (packages/server/src/local-admin.ts): for commands run on the server
// machine while it is running, such as `tabularius reconvert`.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { localAccess } from '../../server/src/local-admin.ts';

/** The server's answer, or an error saying why it couldn't be asked. */
export function askServer(folder: string, method: string, path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<{ status: number; body: Record<string, unknown> }> {
  const access = localAccess(folder);
  if (!access) {
    return Promise.reject(new Error(`the server hosting ${folder} can't be asked: it has no ${'.openhbam.local'} file (one started before this version; restart it once), or it runs as another user (run this as that user)`));
  }
  const url = new URL(path, access.url);
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((ok, fail) => {
    let settled = false;
    let ended = false;
    let responseStarted = false;
    let timeoutError: Error | undefined;
    const resolveOnce = (answer: { status: number; body: Record<string, unknown> }) => {
      if (settled) return;
      settled = true;
      ok(answer);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      fail(error);
    };
    const closedEarly = () => {
      if (!ended) rejectOnce(timeoutError ?? new Error(`the server at ${access.url} closed the connection before it finished answering`));
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method,
      headers: { 'x-tabularius-local': access.token, 'x-tabularius-admin': '1', ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) },
      // The server's own certificate may be one this machine doesn't trust; this goes to the server itself.
      rejectUnauthorized: false,
    }, (res) => {
      responseStarted = true;
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        ended = true;
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: text };
        }
        resolveOnce({ status: res.statusCode ?? 0, body: parsed });
      });
      res.on('error', closedEarly);
      res.on('aborted', closedEarly);
      res.on('close', closedEarly);
    });
    req.on('error', (e) => {
      if (responseStarted && !timeoutError) closedEarly();
      else rejectOnce(e === timeoutError ? e : new Error(`couldn't reach the server at ${access.url}: ${e.message}`));
    });
    if (opts?.timeoutMs !== undefined) req.setTimeout(opts.timeoutMs, () => {
      timeoutError = new Error(`the server at ${access.url} did not answer within ${opts.timeoutMs} ms`);
      req.destroy(timeoutError);
    });
    req.end(data);
  });
}
