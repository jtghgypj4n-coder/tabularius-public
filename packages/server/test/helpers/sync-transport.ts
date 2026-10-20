import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Fault } from './sync-model.ts';

type RecordData = { recordId: string; modId: string; fieldData: Record<string, string> };
/** Scripted Data API stand-in; faults cross real HTTP and the production Data API adapter. */
export class Transport {
  records = new Map<string, RecordData>();
  next = 0;
  fault: Fault = 'none';
  at = 1;
  writes = 0;
  metadata = 0;
  fired = false;
  // Includes a committed write whose response was lost, excludes refusals/dropped requests.
  accepted: { method: string; key: string }[] = [];
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://127.0.0.1');
      const ok = (response: unknown, code = '0') => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ response, messages: [{ code, message: 'fake' }] }));
      };
      if (url.pathname.includes('/sessions')) return ok({ token: 'fake-session' });
      assert.equal(req.headers.authorization, 'Bearer fake-session');
      if (!url.pathname.includes('/records')) {
        if (this.fault === 'schema' && ++this.metadata === 2) { this.fired = true; return ok({}, '105'); }
        return ok({ fieldMetaData: ['uuid', 'modts', 'A', 'B'].map((name) => ({ name, type: 'normal' })) });
      }
      const id = /\/records\/([^/]+)$/.exec(url.pathname)?.[1];
      if (req.method === 'GET') {
        if (id) return ok({ data: this.records.has(id) ? [this.records.get(id)] : [] }, this.records.has(id) ? '0' : '401');
        let rows = [...this.records.values()];
        const count = rows.length;
        if (this.fault === 'reorder') { rows.reverse(); this.fired = true; }
        if (this.fault === 'duplicate' && rows.length > 1) { rows[1] = rows[0]; this.fired = true; }
        if (this.fault === 'short-page' && rows.length) { rows.pop(); this.fired = true; }
        if (this.fault === 'truncate') {
          this.fired = true;
          res.setHeader('content-type', 'application/json');
          return res.end('{"response":{"data":[');
        }
        const offset = Number(url.searchParams.get('_offset') ?? 1) - 1;
        const limit = Number(url.searchParams.get('_limit') ?? 1000);
        return ok({ dataInfo: { foundCount: count }, data: rows.slice(offset, offset + limit) });
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      this.writes++;
      const faultHere = this.writes === this.at;
      if (this.fault === 'drop' && faultHere) { this.fired = true; req.socket.destroy(); return; }
      let row = id ? this.records.get(id) : undefined;
      if (req.method === 'POST') {
        row = this.create(body.fieldData);
      } else {
        if (!row) return ok({}, '101');
        if (req.method === 'PATCH') {
          if (body.modId !== row.modId) return ok({}, '306');
          Object.assign(row.fieldData, body.fieldData);
          row.modId = String(Number(row.modId) + 1);
        } else if (req.method === 'DELETE') this.records.delete(id!);
        else throw new Error(`unexpected method ${req.method}`);
      }
      this.accepted.push({ method: req.method!, key: row.fieldData.uuid });
      if (this.fault === 'lost-ack' && faultHere) { this.fired = true; req.socket.destroy(); return; }
      ok({ recordId: row.recordId, modId: row.modId });
    } catch (e) {
      // Surface handler errors to the test, rather than losing an async rejection.
      this.error = e;
      res.destroy();
    }
  });
  error: unknown;
  url = '';
  async start() {
    await new Promise<void>((done, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.server.off('error', reject); done(); });
    });
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async close() { await new Promise<void>((done) => this.server.close(() => done())); }
  arm(fault: Fault, at = 1) { this.fault = fault; this.at = at; this.writes = 0; this.metadata = 0; this.fired = false; }
  create(fields: Record<string, string>) {
    const row = { recordId: String(++this.next), modId: '1', fieldData: { A: '', B: '', modts: '', ...fields } };
    this.records.set(row.recordId, row);
    return row;
  }
  snapshot() { return [...this.records.values()].map(({ fieldData: { uuid, A, B } }) => ({ uuid, A, B })).sort((a, b) => a.uuid.localeCompare(b.uuid)); }
}
