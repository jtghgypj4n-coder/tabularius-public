// A forwarding header is authority only across an explicitly configured chain of trusted peers.
import { BlockList, isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { canonicalIP } from '../../store/src/client-ip.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1']);
const HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'] as const;
export type ProxyHeader = typeof HEADERS[number];
export const UNKNOWN_CLIENT = 'unknown';

export function hasForwardedHeaders(req: IncomingMessage): boolean {
  return HEADERS.some(h => req.headers[h] !== undefined);
}

export function proxyHeader(name: string): ProxyHeader {
  const h = name.trim().toLowerCase();
  if (!(HEADERS as readonly string[]).includes(h)) throw new Error(`--proxy-header must be one of ${HEADERS.join(', ')}`);
  return h as ProxyHeader;
}

export function trustedProxyAddresses(values: readonly string[] = []): BlockList {
  const trusted = new BlockList();
  for (const value of values) {
    const parts = value.trim().split('/');
    const ip = parts[0], family = isIP(ip), prefix = parts[1];
    if (!canonicalIP(ip) || parts.length > 2 || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) {
      throw new Error(`--trusted-proxies: "${value}" must be an IP address or CIDR`);
    }
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) trusted.addAddress(ip, type);
    else trusted.addSubnet(ip, Number(prefix), type);
  }
  return trusted;
}

/** Parse an entire node identifier. Ports are decimal 1..65535; bare IPv6 never implies a port. */
function address(value: string): string | undefined {
  if (/[^\x21-\x7e]/.test(value)) return;
  const bracketed = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(value);
  const v4Port = /^([0-9.]+):([0-9]+)$/.exec(value);
  const match = bracketed ?? v4Port;
  if (match) {
    if (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return;
    if (isIP(match[1]) !== (bracketed ? 6 : 4)) return;
    return canonicalIP(match[1]);
  }
  return canonicalIP(value);
}

// RFC 7239 token/quoted-string grammar. Separators within a quoted extension are data.
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const PAIR = new RegExp(`(${TOKEN})=(${TOKEN}|"(?:[\\t !#-\\[\\]-~\\x80-\\xff]|\\\\[\\t !-~\\x80-\\xff])*")`, 'y');
function forwardedList(value: string): string[] | undefined {
  const result: string[] = [];
  let at = 0;
  const ows = () => { while (value[at] === ' ' || value[at] === '\t') at++; };
  while (at < value.length) {
    const params = new Map<string, string>();
    for (;;) {
      ows(); PAIR.lastIndex = at;
      const pair = PAIR.exec(value);
      if (!pair) return;
      at = PAIR.lastIndex;
      const name = pair[1].toLowerCase();
      if (params.has(name)) return;
      const raw = pair[2];
      params.set(name, raw.startsWith('"') ? raw.slice(1, -1).replace(/\\([\s\S])/g, '$1') : raw);
      ows();
      if (value[at] !== ';') break;
      at++;
    }
    const node = params.get('for');
    if (!node || (node.includes(':') && !node.startsWith('[') && !/^[0-9.]+:[0-9]+$/.test(node))) return;
    const ip = address(node);
    if (!ip) return;
    result.push(ip);
    if (at === value.length) return result;
    if (value[at++] !== ',') return;
    ows();
    if (at === value.length) return;
  }
}

const peers = new WeakMap<Socket, string | undefined>();
const peerOf = (socket: Socket) => peers.has(socket) ? peers.get(socket) : socket.remoteAddress;
// Kernel-supplied scope IDs are interface-local metadata, unlike untrusted header zone IDs.
const socketIP = (value: string) => canonicalIP(value.split('%')[0]);
const isTrusted = (ip: string, trusted?: BlockList) => {
  const family = isIP(ip);
  return !!family && !!trusted?.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};

export function trustedProxyPeer(socket: Socket, trusted?: BlockList): boolean {
  return isTrusted(socketIP(peerOf(socket) ?? '') ?? '', trusted);
}

/** First untrusted hop from the right, or the original socket address on any invalid/missing input. */
function resolveClient(req: IncomingMessage, header?: ProxyHeader, trusted?: BlockList): { address: string | undefined; forwarded: boolean; reject: boolean } {
  const peer = socketIP(peerOf(req.socket) ?? '');
  const configured = !!peer && !!header && isTrusted(peer, trusted);
  // A configured proxy that sends no usable header is a fault to refuse, never a privileged local client. A loopback peer that
  // carries forwarding headers nobody configured (a proxy on this computer) is an unknown visitor: not this computer, answered by authentication.
  const passedOn = !configured && !!peer && loopback(peer) && hasForwardedHeaders(req);
  const fallback = { address: passedOn ? UNKNOWN_CLIENT : peer, forwarded: false, reject: configured };
  if (!peer || !header || !isTrusted(peer, trusted)) return fallback;
  const raw = req.headers[header];
  if (raw === undefined) return fallback;
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const nodes = header === 'forwarded' ? forwardedList(value) : value.split(',').map(v => address(v.replace(/^[ \t]+|[ \t]+$/g, '')));
  if (!nodes?.length || nodes.some(ip => !ip) || (header === 'x-real-ip' && nodes.length !== 1)) return fallback;
  let current = peer;
  for (let i = nodes.length - 1; i >= 0 && isTrusted(current, trusted); i--) current = nodes[i]!;
  return { address: current, forwarded: true, reject: loopback(current) };
}

function loopback(ip: string): boolean {
  return ip === '::1' || (isIP(ip) === 4 && ip.startsWith('127.'));
}

export function forwardedFor(req: IncomingMessage, header?: ProxyHeader, trusted?: BlockList): string | undefined {
  return resolveClient(req, header, trusted).address;
}

/** Capture attribution once per request for asynchronous route/audit consumers. */
const clients = new WeakMap<IncomingMessage, string>();
const forwardedClients = new WeakSet<IncomingMessage>();
/** Only a successfully validated trusted forwarding header can use proxy-specific allowances. */
export const hasTrustedClientAddress = (req: IncomingMessage): boolean => forwardedClients.has(req);
export function clientAddress(req: IncomingMessage): string {
  return clients.get(req) ?? socketIP(req.socket.remoteAddress ?? '') ?? UNKNOWN_CLIENT;
}
export function setClientAddress(req: IncomingMessage, from: string, forwarded = false): void {
  if (forwarded) forwardedClients.add(req);
  else forwardedClients.delete(req);
  clients.set(req, canonicalIP(from) ?? UNKNOWN_CLIENT);
}

/** Capture attribution; false requires rejection before auth. Preserve the peer across keep-alive reuse. */
export function useForwardedFor(req: IncomingMessage, header?: ProxyHeader, trusted?: BlockList): boolean {
  const result = resolveClient(req, header, trusted);
  const from = result.address ?? UNKNOWN_CLIENT;
  if (!peers.has(req.socket)) peers.set(req.socket, req.socket.remoteAddress);
  setClientAddress(req, from, result.forwarded);
  Object.defineProperty(req.socket, 'remoteAddress', { value: from, configurable: true });
  return !result.reject;
}

export function fromThisComputer(req: IncomingMessage): boolean {
  return LOOPBACK.has(socketIP(peerOf(req.socket) ?? '') ?? '');
}

export function directFromThisComputer(req: IncomingMessage): boolean {
  if (hasForwardedHeaders(req) || hasTrustedClientAddress(req) || !fromThisComputer(req)) return false;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

let lastRefusal = 0;
/** The answer to a request `useForwardedFor` refused: plain text saying why, and a log line (at most one a minute) naming the setting to check. */
export function refuseForwarding(res: ServerResponse, log: (text: string) => void): void {
  const body = 'The address header from the proxy in front of this server was missing, malformed or named this computer. Check --proxy-header and --trusted-proxies.\n';
  res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body), connection: 'close' }).end(body);
  const now = Date.now();
  if (now - lastRefusal < 60_000) return;
  lastRefusal = now;
  log('A request from a trusted proxy was refused: its address header was missing, malformed or named this computer. Check --proxy-header and --trusted-proxies.');
}
