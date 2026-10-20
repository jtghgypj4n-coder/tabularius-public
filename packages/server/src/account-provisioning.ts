import { clientAddress } from './client-address.ts';
// Interactive, database-bound CSV imports. No credential material crosses this surface.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { addressBucket, AccountImportError, StoreError } from '../../store/src/index.ts';
import { ApiError, readBody, type DataApi } from './dataapi.ts';
import { parseRequestJson } from './request-json.ts';
import type { Host } from './host.ts';

export class AccountProvisioningApi {
  private readonly host: Host;
  private readonly api: DataApi;
  private active = 0;

  constructor(host: Host, api: DataApi) {
    this.host = host;
    this.api = api;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m = /^\/tabularius\/security\/v1\/databases\/([^/]+)\/accounts\/import\/(preview|apply)$/.exec(url.pathname);
    if (!m) return false;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '60' } : {}) });
      res.end(JSON.stringify(body));
    };
    let acquired = false;
    try {
      if (req.method !== 'POST') throw new ApiError(3, 'Command is unavailable', 405);
      const db = decodeURIComponent(m[1]);
      const store = this.host.get(db);
      if (!store) {
        // With the file lists off, answered as a hosted file answers this credential.
        if (!this.host.listFilesPublicly) {
          const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
          if (!bearer) throw new ApiError(952, 'Interactive session bearer token required', 401);
          if (bearer.startsWith('ohbt_')) throw new ApiError(9, 'Import requires an interactive session bearer token', 403);
          throw new ApiError(952, 'Invalid FileMaker Data API token (*)', 401);
        }
        throw new ApiError(802, 'Unable to open file', 404);
      }
      store.limitAccountImport(addressBucket(clientAddress(req)), 'ip');
      if (this.active >= 4) throw new AccountImportError('import-busy', 429);
      this.active++;
      acquired = true;
      const authenticate = () => {
        const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
        if (!bearer) throw new ApiError(952, 'Interactive session bearer token required', 401);
        if (bearer.startsWith('ohbt_')) throw new ApiError(9, 'Import requires an interactive session bearer token', 403);
        const session = this.api.authorize(req, db);
        if (session.mustChangePassword || store.mustChangePassword(session.account) || (session.via && store.accountInactive(session.via)) || !store.privileges(session.account, session.via).full || store.isAgent(session.account)) {
          throw new ApiError(9, 'Import requires current Full Access without an owed password change', 403);
        }
        return session;
      };
      const session = authenticate();
      store.limitAccountImport(session.account, m[2] as 'preview' | 'apply');
      // JSON envelope has its own small bound; the decoded CSV is also limited to 1 MiB.
      const raw = await readBody(req, 1024 * 1024);
      let body: Record<string, unknown>;
      try { body = parseRequestJson(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { throw new ApiError(960, 'Invalid JSON or UTF-8', 400); }
      const allowed = m[2] === 'preview' ? ['csv'] : ['csv', 'previewToken', 'idempotencyKey'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !allowed.includes(k)) || typeof body.csv !== 'string') throw new ApiError(960, 'Invalid import body', 400);
      authenticate();
      if (m[2] === 'preview') {
        send(200, store.previewAccountImport(body.csv, session.account, session.via));
      } else {
        if (typeof body.previewToken !== 'string' || typeof body.idempotencyKey !== 'string') throw new ApiError(960, 'previewToken and idempotencyKey are required', 400);
        const result = store.applyAccountImport(body.csv, session.account, body.previewToken, body.idempotencyKey, session.via);
        // Session cleanup follows commit only. Authorization rechecks inactive state even on replay.
        for (const row of result.rows) if (row.actions.includes('deactivate') && store.accountInactive(row.account)) this.api.endByAccount(store.name, row.account);
        send(200, result);
      }
    } catch (e) {
      const status = e instanceof ApiError ? e.status : e instanceof AccountImportError ? e.status : 400;
      const code = e instanceof ApiError || e instanceof StoreError ? e.code : 960;
      // A failed mutation's underlying error may contain SQL or input; expose only known reason codes.
      const message = e instanceof ApiError || e instanceof AccountImportError ? e.message : 'import-failed';
      send(status, { error: { code, message } });
    } finally {
      if (acquired) this.active--;
    }
    return true;
  }
}
