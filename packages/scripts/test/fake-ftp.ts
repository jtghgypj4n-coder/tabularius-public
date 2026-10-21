// A small FTP server for tests: passive mode on 127.0.0.1, with the commands it was sent, the files uploaded to it, and
// how many data connections it got. Used by ftp.test.ts and be-network.test.ts.
import { createServer, type Server, type Socket, type AddressInfo } from 'node:net';
import { createServer as tlsServer } from 'node:tls';

export interface Fake {
  server: Server;
  port: number;
  commands: string[];
  uploads: Map<string, Buffer>;
  /** Control connections that have closed. */
  controlsClosed: number;
  /** Connections made to the data port. */
  dataConnections: number;
  close(): Promise<void>;
}

/** A passive-mode FTP server on 127.0.0.1. `pasvIp` is what PASV claims the data address is; `epsv` false makes EPSV fail. */
export async function fakeFtp(options: { password?: string; pasvIp?: string; epsv?: boolean; refuseStor?: boolean; hugeLine?: boolean; reportPort?: (real: number, control: number) => number; endReply?: string; floodAfterStor?: boolean; tls?: { key: string; cert: string } } = {}): Promise<Fake> {
  const make = (listener?: (s: Socket) => void): Server => (options.tls ? tlsServer(options.tls, listener) : createServer(listener)) as Server;
  const commands: string[] = [];
  const uploads = new Map<string, Buffer>();
  const open = new Set<Socket>();
  let dataConnections = 0;
  let controlsClosed = 0;
  const server = make((control) => {
    open.add(control);
    control.on('close', () => { open.delete(control); controlsClosed++; });
    control.on('error', () => {});
    control.setEncoding('utf8');
    const say = (line: string) => control.write(line + '\r\n');
    if (options.hugeLine) { say('220 ' + 'x'.repeat(40_000)); return; }
    say('220 fake ftp ready');
    let user = '';
    let dataServer: Server | undefined;
    let dataSocket: Promise<Socket> | undefined;
    const listen = (): Promise<number> => new Promise((resolve) => {
      dataServer?.close();
      dataServer = make();
      dataSocket = new Promise<Socket>((got) => dataServer!.once(options.tls ? 'secureConnection' : 'connection', (s: Socket) => { dataConnections++; open.add(s); s.on('close', () => open.delete(s)); s.on('error', () => {}); got(s); }));
      dataServer.listen(0, '127.0.0.1', () => resolve((dataServer!.address() as AddressInfo).port));
    });
    const shown = (real: number) => options.reportPort ? options.reportPort(real, (server.address() as AddressInfo).port) : real;
    let pending = '';
    control.on('data', async (chunk: string) => {
      pending += chunk;
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const line = pending.slice(0, i).replace(/\r$/, '');
        pending = pending.slice(i + 1);
        commands.push(line);
        const [verb, ...rest] = line.split(' ');
        const arg = rest.join(' ');
        switch (verb) {
          case 'USER': user = arg; say(arg === 'nobody' ? '530 no such user' : '331 password please'); break;
          case 'PASS': say(arg === (options.password ?? 'pw') && user !== 'nobody' ? '230 welcome' : '530 login incorrect'); break;
          case 'TYPE': say('200 binary'); break;
          case 'PBSZ': say('200 ok'); break;
          case 'PROT': say(arg === 'P' ? '200 private' : '534 no'); break;
          case 'EPSV': if (options.epsv === false) say('500 not understood'); else say(`229 Entering Extended Passive Mode (|||${shown(await listen())}|)`); break;
          case 'PASV': {
            const port = shown(await listen());
            say(`227 Entering Passive Mode (${(options.pasvIp ?? '127.0.0.1').replace(/\./g, ',')},${port >> 8},${port & 255})`);
            break;
          }
          case 'STOR': {
            if (options.refuseStor) { say('550 permission denied'); break; }
            say('150 ok to send');
            if (options.floodAfterStor) {
              // Bytes with no line break on the control connection, while the data connection is never read.
              const chunk = 'x'.repeat(256 * 1024);
              const pump = () => { while (!control.destroyed && control.write(chunk)); if (!control.destroyed) control.once('drain', pump); };
              pump();
              break;
            }
            const data = await dataSocket!;
            const parts: Buffer[] = [];
            data.on('data', (b: Buffer) => parts.push(b));
            data.on('end', () => { uploads.set(arg, Buffer.concat(parts)); say(options.endReply ?? '226 transfer complete'); data.end(); });
            break;
          }
          case 'DELE': say(arg === 'old/file.txt' ? '250 deleted' : '550 no such file'); break;
          case 'QUIT': say('221 bye'); control.end(); break;
          default: say('502 not implemented');
        }
      }
    });
    control.on('close', () => dataServer?.close());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    server, commands, uploads,
    get port() { return (server.address() as AddressInfo).port; },
    get dataConnections() { return dataConnections; },
    get controlsClosed() { return controlsClosed; },
    close: async () => { open.forEach((s) => s.destroy()); await new Promise<void>((r) => server.close(() => r())); },
  };
}

