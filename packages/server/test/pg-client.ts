// Just enough of a PostgreSQL client for tests: sign in with a cleartext password, then run simple queries and
// prepared (extended-protocol) statements with typed parameters. Every wait has a limit, so a server that stops
// answering fails the test instead of hanging it.
import { connect, type Socket } from 'node:net';

export interface PgResult {
  columns: string[];
  /** Type oid of each column, as the server described it. */
  oids: number[];
  rows: (string | null)[][];
  tags: string[];
  error?: { code: string; message: string };
  notices: string[];
}

const WAIT_MS = 20_000;

export class PgClient {
  private buf = Buffer.alloc(0);
  private wake?: () => void;
  readonly socket: Socket;
  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.wake?.(); });
    socket.on('close', () => this.wake?.());
    socket.on('error', () => this.wake?.());
  }

  /** Signs in, or throws "<sqlstate> <message>" from the server's refusal. */
  static async open(opts: { port: number; user: string; password: string; database: string; options?: Record<string, string> }): Promise<PgClient> {
    const socket = connect(opts.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { socket.destroy(); reject(new Error('the server did not answer')); }, WAIT_MS);
      socket.once('connect', () => { clearTimeout(t); resolve(); });
      socket.once('error', reject);
    });
    const c = new PgClient(socket);
    const extra = Object.entries(opts.options ?? {}).map(([k, v]) => `${k}\0${v}\0`).join('');
    const params = Buffer.from(`user\0${opts.user}\0database\0${opts.database}\0${extra}\0`);
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + params.length);
    head.writeInt32BE(196608, 4);
    socket.write(Buffer.concat([head, params]));
    const auth = await c.read();
    if (auth.type === 'E') throw new Error(PgClient.errorText(auth.body));
    c.send('p', Buffer.from(opts.password + '\0'));
    for (;;) {
      const m = await c.read();
      if (m.type === 'E') throw new Error(PgClient.errorText(m.body));
      if (m.type === 'Z') return c;
    }
  }

  close(): void {
    this.socket.destroy();
  }

  private async read(): Promise<{ type: string; body: Buffer }> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      if (this.buf.length >= 5 && this.buf.length >= this.buf.readInt32BE(1) + 1) {
        const len = this.buf.readInt32BE(1);
        const m = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
        this.buf = this.buf.subarray(len + 1);
        return m;
      }
      if (this.socket.destroyed) throw new Error('the server closed the connection');
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no answer within ${WAIT_MS / 1000} seconds`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.wake = () => { clearTimeout(t); resolve(); };
      });
    }
  }

  private send(type: string, body = Buffer.alloc(0)): void {
    const head = Buffer.alloc(5);
    head.write(type);
    head.writeInt32BE(body.length + 4, 1);
    this.socket.write(Buffer.concat([head, body]));
  }

  static errorText(body: Buffer): string {
    const f = body.toString().split('\0');
    return `${f.find((x) => x.startsWith('C'))?.slice(1)} ${f.find((x) => x.startsWith('M'))?.slice(1)}`;
  }

  private async untilReady(): Promise<PgResult> {
    const out: PgResult = { columns: [], oids: [], rows: [], tags: [], notices: [] };
    for (;;) {
      const m = await this.read();
      if (m.type === 'Z') return out;
      if (m.type === 'T') {
        let pos = 2;
        out.columns = [];
        out.oids = [];
        for (let i = 0; i < m.body.readInt16BE(0); i++) {
          const end = m.body.indexOf(0, pos);
          out.columns.push(m.body.subarray(pos, end).toString());
          out.oids.push(m.body.readInt32BE(end + 7));
          pos = end + 19;
        }
      } else if (m.type === 'D') {
        let pos = 2;
        const row: (string | null)[] = [];
        for (let i = 0; i < m.body.readInt16BE(0); i++) {
          const len = m.body.readInt32BE(pos);
          pos += 4;
          row.push(len < 0 ? null : m.body.subarray(pos, pos + len).toString());
          if (len > 0) pos += len;
        }
        out.rows.push(row);
      } else if (m.type === 'C') out.tags.push(m.body.subarray(0, m.body.length - 1).toString());
      else if (m.type === 'E') {
        const f = m.body.toString().split('\0');
        out.error ??= { code: f.find((x) => x.startsWith('C'))?.slice(1) ?? '', message: f.find((x) => x.startsWith('M'))?.slice(1) ?? '' };
      } else if (m.type === 'N') out.notices.push(PgClient.errorText(m.body));
    }
  }

  /** A simple query (the Q message): any number of statements separated by semicolons. */
  async simple(sql: string | Buffer): Promise<PgResult> {
    this.send('Q', Buffer.concat([Buffer.from(sql), Buffer.from([0])]));
    return this.untilReady();
  }

  /** Parse and Sync only, to check refusals before binding or executing a statement. */
  async parse(sql: string): Promise<PgResult> {
    this.send('P', Buffer.concat([Buffer.from('\0' + sql + '\0'), Buffer.alloc(2)]));
    this.send('S');
    return this.untilReady();
  }

  /** A prepared statement run once: Parse with the parameter types, Bind with text values, Describe, Execute, Sync. */
  async extended(sql: string | Buffer, params: { oid: number; value: string | Buffer | null }[] = [], opts: { rowLimit?: number } = {}): Promise<PgResult> {
    const i16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
    const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
    const z = (s: string | Buffer) => Buffer.concat([Buffer.from(s), Buffer.from([0])]);
    this.send('P', Buffer.concat([z(''), z(sql), i16(params.length), ...params.map((p) => i32(p.oid))]));
    this.send('B', Buffer.concat([z(''), z(''), i16(0), i16(params.length),
      ...params.map((p) => (p.value === null ? i32(-1) : Buffer.concat([i32(Buffer.byteLength(p.value)), Buffer.from(p.value)]))), i16(0)]));
    this.send('D', Buffer.concat([Buffer.from('P'), z('')]));
    this.send('E', Buffer.concat([z(''), i32(opts.rowLimit ?? 0)]));
    this.send('S');
    return this.untilReady();
  }
}
