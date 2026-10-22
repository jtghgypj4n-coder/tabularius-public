import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FRAMING_HOPS = new Set(['host', 'content-length', 'transfer-encoding', 'expect', 'trailer']);

function authority(value: string): boolean {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9._~-]+)(?::([0-9]+))?$/i.exec(value);
  if (!match || (match[1].startsWith('[') && isIP(match[1].slice(1, -1)) !== 6)) return false;
  return match[2] === undefined || (match[2].length <= 5 && Number(match[2]) <= 65535);
}

/** Validate before WHATWG URL normalization or any route/authentication work. Node's strict
 * HTTP parser remains the only wire/body parser; rawHeaders retains duplicate field lines. */
export function validHttpRequest(req: IncomingMessage): boolean {
  if (req.httpVersion !== '1.1' && req.httpVersion !== '1.0') return false;
  const fields = new Map<string, string[]>();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase(), value = req.rawHeaders[i + 1];
    if (!TOKEN.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) return false;
    const values = fields.get(name) ?? [];
    values.push(value);
    fields.set(name, values);
  }
  const hosts = fields.get('host') ?? [];
  if (hosts.length > 1 || (req.httpVersion === '1.1' && hosts.length !== 1)
    || (hosts.length === 1 && !authority(hosts[0]))) return false;
  const lengths = fields.get('content-length');
  const transfer = fields.get('transfer-encoding');
  if (lengths && (lengths.length !== 1 || !/^\d+$/.test(lengths[0]))) return false;
  // No transfer decoders other than chunked exist here. Never pass compressed transfer bytes
  // to a route as if they were decoded content, or accept chunked HTTP/1.0.
  if (transfer && (lengths || req.httpVersion !== '1.1' || transfer.length !== 1
    || transfer[0].toLowerCase() !== 'chunked')) return false;
  const connection = (fields.get('connection') ?? []).join(',').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (connection.some(x => !TOKEN.test(x) || FRAMING_HOPS.has(x))) return false;
  if (fields.has('upgrade') || connection.includes('upgrade') || fields.has('http2-settings')) return false;

  let target = req.url ?? '';
  if (/[^\x21-\x7e]|[\\#]/.test(target)) return false;
  let host: string | undefined;
  if (/^https?:\/\//i.test(target)) {
    const absolute = /^https?:\/\/([^/?]+)(.*)$/i.exec(target);
    if (!absolute || !authority(absolute[1])) return false;
    host = absolute[1];
    target = absolute[2] || '/';
    if (target.startsWith('?')) target = '/' + target;
  }
  if (target === '*') return req.method === 'OPTIONS';
  if (!target.startsWith('/') || target.startsWith('//')) return false;
  const question = target.indexOf('?');
  const path = question < 0 ? target : target.slice(0, question);
  // A dot segment, written literally or percent-encoded (%2e%2e), is normalized away by URL parsing: a proxy that matches the
  // raw path and this server would then disagree about which route was asked for. An encoded slash is not a segment break,
  // so it stays data for the route.
  const decodes = (segment: string): string | undefined => { try { return decodeURIComponent(segment); } catch { return undefined; } };
  if (path.split('/').some(x => { const d = decodes(x); return d === '.' || d === '..' || x === '.' || x === '..'; })) return false;
  // A malformed % escape is left for the route that decodes it: each answers in its own envelope (a Data API error body, a 404
  // for an unknown guide) and was never a server fault. Only a decodable path is checked here, for controls and backslashes
  // that no route should ever see.
  try {
    if (/[\x00-\x1f\x7f\\]/.test(decodeURIComponent(path))) return false;
    if (question >= 0 && decodeURIComponent(target.slice(question + 1)).includes('\0')) return false;
  } catch { /* undecodable: the route answers */ }
  if (host !== undefined) {
    // RFC 9112 3.2.2: absolute-form authority takes precedence over the received Host.
    req.headers.host = host;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === 'host') req.rawHeaders[i + 1] = host;
    }
  }
  req.url = target;
  return true;
}

export function requestClosesConnection(req: IncomingMessage): boolean {
  const tokens = (req.headers.connection ?? '').toLowerCase().split(',').map(x => x.trim());
  return tokens.includes('close') || (req.httpVersion === '1.0' && !tokens.includes('keep-alive'));
}
