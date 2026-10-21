// A small FTP client for BaseElements' FTP functions (BE_FTP_Upload, BE_FTP_UploadFile, BE_FTP_Delete): one upload or one
// delete per call, over plain FTP (ftp://, port 21) or FTP over TLS from the start (ftps://, port 990, "implicit" FTPS).
// SFTP (sftp://) is another protocol, on SSH, and is not built.
//
// Every connection, the control one and each data one, goes through the outbound guard's lookup, so an address the
// guard refuses is refused here. The data connection goes to the address the control connection reached, never to the
// address the server's reply names, and the reply's port must be one the server could really mean: a server cannot
// send this client to another machine.

import { connect as tcp, type Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { hostRefusal, socketLookup, type OutboundPolicy } from './net-guard.ts';

export interface FtpRequest {
  op: 'put' | 'delete';
  /** ftp://host[:port]/path or ftps://host[:port]/path. */
  url: string;
  user: string;
  password: string;
  /** What to upload (put). */
  bytes?: Uint8Array;
}

export interface FtpResult {
  /** The server's final reply code (226 after an upload, 250 after a delete); 0 when there was none. */
  status: number;
  /** Why it failed, in words; absent on success. */
  error?: string;
  /** curl's error number for this kind of failure (inferred, as BaseElements passes curl's): 7 no connection, 35 TLS, 67 login, 25 upload, 21 delete. */
  code?: number;
}

export interface FtpOptions {
  policy?: OutboundPolicy;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** For tests: trust this certificate authority. Scripts cannot set it. */
  ca?: string;
}

const LINE_MAX = 8192;
const REPLY_LINES_MAX = 200;
const DEFAULT_MS = 30_000;

class FtpFailure extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/** The pieces of an ftp or ftps address, or the reason it can't be used. Nothing that could be split into another command passes. */
export function parseFtpUrl(raw: string): { secure: boolean; host: string; port: number; path: string } | string {
  if (!URL.canParse(raw)) return 'the address is not a web address';
  const u = new URL(raw);
  if (u.protocol !== 'ftp:' && u.protocol !== 'ftps:') return 'only ftp and ftps addresses are built in (sftp is not)';
  if (u.username || u.password) return 'give the user name and password as the function\'s arguments, not in the address';
  let path: string;
  try { path = decodeURIComponent(u.pathname); } catch { return 'the path is not valid text'; }
  if (/[\r\n\0]/.test(path)) return 'the path has a line break in it';
  if (!path.replace(/\//g, '')) return 'the address needs the path of a file';
  const secure = u.protocol === 'ftps:';
  return { secure, host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (secure ? 990 : 21), path };
}

/** A control or data connection read a line at a time, with the server's reply codes. */
class Control {
  private buffer = '';
  private lines: string[] = [];
  private waiting?: { resolve(): void; reject(e: Error): void };
  private ended?: Error;
  readonly socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > LINE_MAX * 2 && !this.buffer.includes('\n')) return this.fail(new FtpFailure('the server sent a line that is too long', 7));
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i).replace(/\r$/, '');
        this.buffer = this.buffer.slice(i + 1);
        if (line.length > LINE_MAX) return this.fail(new FtpFailure('the server sent a line that is too long', 7));
        this.lines.push(line);
      }
      this.wake();
    });
    socket.on('error', (e) => this.fail(new FtpFailure(e.message, /cert|TLS|SSL|handshake|self[- ]signed/i.test(e.message) ? 35 : 7)));
    socket.on('close', () => this.fail(new FtpFailure('the server closed the connection', 7)));
  }

  private fail(e: Error): void {
    this.ended ??= e;
    this.wake();
  }

  private wake(): void {
    const w = this.waiting;
    if (!w) return;
    this.waiting = undefined;
    if (this.ended && !this.lines.length) w.reject(this.ended);
    else w.resolve();
  }

  private async next(): Promise<string> {
    while (!this.lines.length) {
      if (this.ended) throw this.ended;
      await new Promise<void>((resolve, reject) => { this.waiting = { resolve, reject }; });
    }
    return this.lines.shift()!;
  }

  /** One reply: its code and text. A reply of several lines ("123-" … "123 ") is read to its end. */
  async reply(): Promise<{ code: number; text: string }> {
    const first = await this.next();
    const m = /^(\d{3})([ -])/.exec(first);
    if (!m) throw new FtpFailure('the server\'s reply was not an FTP reply', 7);
    const out = [first.slice(4)];
    if (m[2] === '-') {
      for (let n = 0; n < REPLY_LINES_MAX; n++) {
        const line = await this.next();
        out.push(line.startsWith(m[1] + ' ') ? line.slice(4) : line);
        if (line.startsWith(m[1] + ' ')) return { code: Number(m[1]), text: out.join('\n') };
      }
      throw new FtpFailure('the server\'s reply was too long', 7);
    }
    return { code: Number(m[1]), text: out[0] };
  }

  send(command: string): void {
    this.socket.write(command + '\r\n');
  }
}

/** One command and its reply. */
async function ask(c: Control, command: string): Promise<{ code: number; text: string }> {
  c.send(command);
  return c.reply();
}

/** The port in an EPSV reply "(|||port|)" or a PASV reply "(h1,h2,h3,h4,p1,p2)": only the port is used. */
function dataPort(passive: { code: number; text: string }): number | undefined {
  const epsv = /\(\|\|\|(\d{1,5})\|\)/.exec(passive.text);
  if (epsv) return Number(epsv[1]);
  const pasv = /(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3})/.exec(passive.text);
  if (pasv) return Number(pasv[5]) * 256 + Number(pasv[6]);
  return undefined;
}

/** Does one upload or one delete. Never throws: the outcome is the result. */
export async function ftpTransfer(request: FtpRequest, options: FtpOptions = {}): Promise<FtpResult> {
  const where = parseFtpUrl(request.url);
  if (typeof where === 'string') return { status: 0, error: where, code: 3 };
  for (const [what, text] of [['user name', request.user], ['password', request.password]] as const) {
    if (/[\r\n\0]/.test(text)) return { status: 0, error: `the ${what} has a line break in it`, code: 67 };
  }
  const sockets: Socket[] = [];
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_MS);
  const stop = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const onAbort = () => sockets.forEach((s) => s.destroy());
  stop.addEventListener('abort', onAbort, { once: true });
  const policy = options.policy ?? {};
  const lookup = socketLookup(policy);
  const connection = (host: string, port: number, session?: Buffer): Promise<Socket> => new Promise((resolve, reject) => {
    // The lookup is not asked about a host written as an address, so that is checked here.
    const why = hostRefusal(policy, host);
    if (why) return reject(new FtpFailure(why, 7));
    const base = { host, port, lookup, servername: where.host };
    const socket: Socket = where.secure
      ? tlsConnect({ ...base, ...(options.ca ? { ca: options.ca } : {}), ...(session ? { session } : {}) } as ConnectionOptions)
      : tcp({ host, port, lookup });
    sockets.push(socket);
    const failed = (e: Error) => reject(new FtpFailure(stop.aborted ? 'the transfer took too long or was stopped' : e.message, stop.aborted ? 7 : /cert|TLS|SSL|handshake|self[- ]signed/i.test(e.message) ? 35 : 7));
    socket.once('error', failed);
    socket.once(where.secure ? 'secureConnect' : 'connect', () => { socket.off('error', failed); resolve(socket); });
  });
  try {
    const control = new Control(await connection(where.host, where.port));
    const hello = await control.reply();
    if (hello.code !== 220) throw new FtpFailure(`the server did not accept the connection: ${hello.code} ${hello.text}`, 7);
    const user = await ask(control, `USER ${request.user || 'anonymous'}`);
    if (user.code === 331) {
      const pass = await ask(control, `PASS ${request.user ? request.password : request.password || 'anonymous@'}`);
      if (pass.code !== 230) throw new FtpFailure(`the server refused the login: ${pass.code} ${pass.text}`, 67);
    } else if (user.code !== 230) throw new FtpFailure(`the server refused the login: ${user.code} ${user.text}`, 67);
    if (where.secure) {
      for (const command of ['PBSZ 0', 'PROT P']) {
        const r = await ask(control, command);
        if (r.code >= 400) throw new FtpFailure(`the server would not protect the data connection: ${r.code} ${r.text}`, 35);
      }
    }
    if (request.op === 'delete') {
      // BaseElements' delete takes the path as the server's login folder sees it: without the leading slash.
      const r = await ask(control, `DELE ${where.path.replace(/^\/+/, '')}`);
      if (r.code !== 250) throw new FtpFailure(`the server did not delete the file: ${r.code} ${r.text}`, 21);
      void ask(control, 'QUIT').catch(() => {});
      return { status: r.code };
    }
    const type = await ask(control, 'TYPE I');
    if (type.code !== 200) throw new FtpFailure(`the server would not send the file as it is: ${type.code} ${type.text}`, 25);
    let passive = await ask(control, 'EPSV');
    let port = passive.code === 229 ? dataPort(passive) : undefined;
    if (port === undefined) {
      passive = await ask(control, 'PASV');
      port = passive.code === 227 ? dataPort(passive) : undefined;
    }
    if (port === undefined || port < 1 || port > 65535) throw new FtpFailure('the server gave no port to send the file to', 25);
    // The address that answered the control connection: the reply's own address is ignored.
    const peer = control.socket.remoteAddress;
    if (!peer) throw new FtpFailure('the connection was lost', 7);
    const session = where.secure ? (control.socket as TLSSocket).getSession() : undefined;
    const data = await connection(peer, port, session);
    const sent = new Promise<void>((resolve, reject) => {
      data.once('error', (e) => reject(new FtpFailure(e.message, 25)));
      data.end(request.bytes ?? new Uint8Array(0), () => resolve());
    });
    // Settled before it is awaited, below, so a failure in between is not an unhandled one.
    sent.catch(() => {});
    // The server's "150" comes as it opens the data connection; the upload is complete at "226".
    const start = await ask(control, `STOR ${where.path}`);
    if (start.code !== 125 && start.code !== 150) { data.destroy(); throw new FtpFailure(`the server would not take the file: ${start.code} ${start.text}`, 25); }
    await sent;
    const done = await control.reply();
    if (done.code !== 226 && done.code !== 250) throw new FtpFailure(`the upload did not finish: ${done.code} ${done.text}`, 25);
    void ask(control, 'QUIT').catch(() => {});
    return { status: done.code };
  } catch (e) {
    if (e instanceof FtpFailure) return { status: 0, error: e.message, code: e.code };
    return { status: 0, error: (e as Error).message, code: 7 };
  } finally {
    stop.removeEventListener('abort', onAbort);
    // Whatever the outcome, nothing stays open.
    setTimeout(() => sockets.forEach((s) => s.destroy()), 200).unref();
  }
}
