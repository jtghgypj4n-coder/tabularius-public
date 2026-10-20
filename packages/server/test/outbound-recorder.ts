// Loaded into a child process with `node --import` to record, and refuse, every attempt to reach anything but this
// computer: a TCP connection (which is what fetch, https, WebSocket, HTTP/2 and the mail and directory clients all
// end in), a UDP send, and a DNS question about a name that is not this computer's. One JSON line per attempt is
// appended to the file named by TABULARIUS_OUTBOUND_LOG; a child of the child inherits this through NODE_OPTIONS.
//
// It is a test instrument: the no-phone-home tests start the program with it and assert the file holds no attempt.
import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const log = process.env.TABULARIUS_OUTBOUND_LOG;
const note = (what: Record<string, unknown>) => {
  if (log) appendFileSync(log, JSON.stringify({ pid: process.pid, ...what }) + '\n');
};
note({ hook: 'loaded' });

/** This computer, under any of its loopback spellings. */
const isLocal = (host: unknown): boolean => {
  if (host === undefined || host === null || host === '') return true;
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '::' || h === '0.0.0.0' || /^127(\.\d{1,3}){3}$/.test(h) || h === '::ffff:127.0.0.1';
};

const refused = (what: string) => Object.assign(new Error(`outbound recorder: ${what} refused`), { code: 'ECONNREFUSED' });

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0]; // net.connect hands over [options, callback]
  let host: unknown, port: unknown, path: unknown;
  if (first && typeof first === 'object') ({ host, port, path } = first);
  else if (typeof first === 'string' && Number.isNaN(Number(first))) path = first;
  else { port = first; host = typeof args[1] === 'string' ? args[1] : undefined; }
  if (path === undefined && !isLocal(host)) {
    note({ kind: 'tcp', host, port });
    process.nextTick(() => this.destroy(refused(`connection to ${host}:${port}`)));
    return this;
  }
  return (connect as any).apply(this, args);
} as typeof net.Socket.prototype.connect;

const lookup = dns.lookup;
dns.lookup = function (host: string, ...rest: any[]) {
  if (!isLocal(host) && !/^\d+(\.\d+){3}$|:/.test(host)) {
    note({ kind: 'dns', host });
    const done = rest.at(-1);
    if (typeof done === 'function') process.nextTick(() => done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })));
    return {} as unknown as ReturnType<typeof dns.lookup>;
  }
  return (lookup as any)(host, ...rest);
} as typeof dns.lookup;
for (const fn of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveSrv', 'resolveTxt', 'reverse'] as const) {
  (dns as any)[fn] = (host: string, ...rest: any[]) => {
    note({ kind: 'dns', host, call: fn });
    const done = rest.at(-1);
    if (typeof done === 'function') process.nextTick(() => done(Object.assign(new Error(`${fn} ENOTFOUND ${host}`), { code: 'ENOTFOUND' })));
  };
  (dns.promises as any)[fn] = async (host: string) => {
    note({ kind: 'dns', host, call: fn });
    throw Object.assign(new Error(`${fn} ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  };
}

for (const method of ['send', 'connect'] as const) {
  const original = (dgram.Socket.prototype as any)[method];
  (dgram.Socket.prototype as any)[method] = function (this: dgram.Socket, ...args: any[]) {
    // send(msg, [offset, length,] port, address, cb) and connect(port, address, cb): the address is the last string.
    const address = [...args].reverse().find((a) => typeof a === 'string' && /^[\w.:-]*[.:][\w.:-]*$/.test(a));
    if (address !== undefined && !isLocal(address)) {
      note({ kind: 'udp', host: address });
      return;
    }
    return original.apply(this, args);
  };
}

// `import { lookup } from 'node:dns'` in the program must see the replacements too.
syncBuiltinESMExports();
