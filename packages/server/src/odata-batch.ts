// OData $batch bodies: reading the requests in one, and writing the answers.
//
// Two formats, as OData v4 defines them. multipart/mixed (OData 4.0, what
// Excel, Power BI and the FileMaker Server documentation use): each part is an
// HTTP request (Content-Type: application/http), and a part that is itself
// multipart/mixed is a change set, done all or nothing. JSON (OData 4.01):
// {"requests": [{id, method, url, headers, body, atomicityGroup, dependsOn}]},
// where requests sharing an atomicityGroup (next to each other) are done all
// or nothing.

import { parseRequestJson } from './request-json.ts';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';

/** The most a $batch body may hold. */
export const MAX_BATCH_BYTES = 32 * 1024 * 1024;
/** The most requests one $batch may hold. */
export const MAX_BATCH_REQUESTS = 1000;
/** Once a $batch's answers add up to this, the requests after it aren't run (and a change set past it fails); the most $crossjoin requests one $batch may hold. Tests lower them. */
export const BATCH_LIMIT = { responseBytes: 64 * 1024 * 1024, crossjoins: 5 };

export interface BatchRequest {
  /** The Content-ID (multipart) or id (JSON): later requests can address what it created as $id. */
  id?: string;
  method: string;
  url: string;
  /** Lower-case names. */
  headers: Record<string, string>;
  body: Buffer;
  /** JSON only: ids or atomicity groups that must succeed first. */
  dependsOn?: string[];
}

/** One request, or a change set (atomicity group) of requests done all or nothing. */
export interface BatchUnit {
  atomic: boolean;
  /** JSON: the atomicityGroup's name. */
  group?: string;
  requests: BatchRequest[];
}

export interface BatchAnswer {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** What became of a unit: an answer per request, or the one that failed a change set (nothing in it was kept). */
export interface BatchResult {
  unit: BatchUnit;
  answers: BatchAnswer[];
  failed?: BatchAnswer;
}

/** A $batch body that can't be read: the whole batch is refused (400). */
export class BatchError extends Error {}

/** The requests in a $batch body, in order. */
export function batchRequests(contentType: string, raw: Buffer): { json: boolean; units: BatchUnit[] } {
  const units = /^\s*application\/json/i.test(contentType) ? jsonUnits(raw)
    : /^\s*multipart\/mixed/i.test(contentType) ? multipartUnits(contentType, raw)
      : undefined;
  if (!units) throw new BatchError('A $batch body is multipart/mixed (with a boundary) or application/json');
  if (units.reduce((n, u) => n + u.requests.length, 0) > MAX_BATCH_REQUESTS) throw new BatchError(`A $batch holds at most ${MAX_BATCH_REQUESTS} requests`);
  return { json: /^\s*application\/json/i.test(contentType), units };
}

// --- multipart/mixed ---------------------------------------------------------------

function boundaryOf(contentType: string): string {
  const m = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const b = m?.[1] ?? m?.[2];
  if (!b || b.length > 70) throw new BatchError('A multipart/mixed $batch needs a boundary (at most 70 characters)');
  return b;
}

/** The parts between a multipart body's boundaries (latin1, so bytes stay as they are). */
function partsOf(text: string, boundary: string): string[] {
  const esc = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\r?\\n)--${esc}(--)?[ \\t]*(?=\\r?\\n|$)`, 'g');
  const parts: string[] = [];
  let start: number | undefined;
  for (let m; (m = re.exec(text));) {
    if (start !== undefined) parts.push(text.slice(start, m.index));
    if (m[1]) return parts;
    start = m.index + m[0].length;
    // The line break after the boundary belongs to it.
    if (text.startsWith('\r\n', start)) start += 2;
    else if (text[start] === '\n') start += 1;
  }
  throw new BatchError(`The multipart body doesn't end with --${boundary}--`);
}

/** Splits headers from the body at the first empty line. */
function headed(text: string): { headers: Record<string, string>; body: string; lines: string[] } {
  const m = /\r?\n\r?\n/.exec(text);
  const empty = /^\r?\n/.exec(text);
  const head = empty ? '' : m ? text.slice(0, m.index) : text;
  const body = empty ? text.slice(empty[0].length) : m ? text.slice(m.index + m[0].length) : '';
  const lines = head ? head.split(/\r?\n/) : [];
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body, lines };
}

/** An application/http part: the request in it. */
function httpRequest(part: string): BatchRequest {
  const mime = headed(part);
  if (!/^application\/http\b/i.test(mime.headers['content-type'] ?? '')) throw new BatchError('Each part of a $batch is application/http (or a multipart/mixed change set)');
  const inner = headed(mime.body);
  const first = inner.lines.shift() ?? '';
  const m = /^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/1\.[01])?\s*$/.exec(Buffer.from(first, 'latin1').toString('utf8'));
  if (!m) throw new BatchError(`"${first.slice(0, 100)}" is not an HTTP request line`);
  const headers = { ...inner.headers };
  const id = mime.headers['content-id'] ?? headers['content-id'];
  delete headers['content-id'];
  if (id !== undefined && /[\x00-\x1f\x7f]/.test(id)) throw new BatchError('A Content-ID can\'t hold control characters');
  return { ...(id ? { id } : {}), method: m[1].toUpperCase(), url: m[2], headers, body: Buffer.from(inner.body, 'latin1') };
}

function multipartUnits(contentType: string, raw: Buffer): BatchUnit[] {
  const units: BatchUnit[] = [];
  const ids = new Set<string>();
  const check = (r: BatchRequest) => {
    if (r.id !== undefined) {
      if (ids.has(r.id)) throw new BatchError(`Two requests have the Content-ID "${r.id}"`);
      ids.add(r.id);
    }
    return r;
  };
  for (const part of partsOf(raw.toString('latin1'), boundaryOf(contentType))) {
    const mime = headed(part);
    const type = mime.headers['content-type'] ?? '';
    if (/^multipart\/mixed/i.test(type)) {
      const requests = partsOf(mime.body, boundaryOf(type)).map((p) => {
        if (/^multipart\//i.test(headed(p).headers['content-type'] ?? '')) throw new BatchError('A change set can\'t hold another change set');
        return check(httpRequest(p));
      });
      if (requests.length) units.push({ atomic: true, requests });
    } else units.push({ atomic: false, requests: [check(httpRequest(part))] });
  }
  return units;
}

// --- JSON ----------------------------------------------------------------------

function jsonUnits(raw: Buffer): BatchUnit[] {
  let doc: unknown;
  try {
    doc = parseRequestJson(raw.toString('utf8'));
  } catch {
    throw new BatchError('The $batch body is not valid JSON');
  }
  const list = (doc as { requests?: unknown })?.requests;
  if (!Array.isArray(list)) throw new BatchError('A JSON $batch is {"requests": [...]}');
  const units: BatchUnit[] = [];
  const seen = new Set<string>();
  const closed = new Set<string>();
  for (const r of list as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') throw new BatchError('Each request in a JSON $batch is an object');
    const id = r.id === undefined ? undefined : String(r.id);
    if (id === undefined || id === '') throw new BatchError('Each request in a JSON $batch has an id');
    if (seen.has(id)) throw new BatchError(`Two requests have the id "${id}"`);
    if (/[\x00-\x1f\x7f]/.test(id)) throw new BatchError('An id can\'t hold control characters');
    if (typeof r.method !== 'string' || typeof r.url !== 'string') throw new BatchError(`Request "${id}" needs a method and a url`);
    const headers: Record<string, string> = {};
    if (r.headers && typeof r.headers === 'object') for (const [k, v] of Object.entries(r.headers)) headers[k.toLowerCase()] = String(v);
    const dependsOn = r.dependsOn === undefined ? undefined : Array.isArray(r.dependsOn) ? r.dependsOn.map(String) : undefined;
    if (r.dependsOn !== undefined && !dependsOn) throw new BatchError(`Request "${id}": dependsOn is a list of ids`);
    for (const d of dependsOn ?? []) if (!seen.has(d) && !closed.has(d) && units.at(-1)?.group !== d) throw new BatchError(`Request "${id}" depends on "${d}", which isn't before it`);
    const body = r.body === undefined || r.body === null ? Buffer.alloc(0)
      : typeof r.body === 'string' && !/json/i.test(headers['content-type'] ?? 'application/json') ? Buffer.from(r.body, 'utf8')
        : Buffer.from(JSON.stringify(r.body), 'utf8');
    if (body.length && !headers['content-type']) headers['content-type'] = 'application/json';
    const request: BatchRequest = { id, method: r.method.toUpperCase(), url: r.url, headers, body, ...(dependsOn ? { dependsOn } : {}) };
    const group = r.atomicityGroup === undefined || r.atomicityGroup === null ? undefined : String(r.atomicityGroup);
    const last = units.at(-1);
    if (group !== undefined && last?.group === group) last.requests.push(request);
    else {
      if (last?.group !== undefined) closed.add(last.group);
      if (group !== undefined) {
        if (closed.has(group) || seen.has(group)) throw new BatchError(`The requests of atomicity group "${group}" must be next to each other`);
        units.push({ atomic: true, group, requests: [request] });
      } else units.push({ atomic: false, requests: [request] });
    }
    seen.add(id);
  }
  return units;
}

// --- answers ---------------------------------------------------------------------

/** The $batch response: each unit's answers, in the request's format. */
export function batchResponse(json: boolean, results: BatchResult[]): { type: string; data: Buffer } {
  return json ? jsonResponse(results) : multipartResponse(results);
}

function multipartResponse(results: BatchResult[]): { type: string; data: Buffer } {
  const outer = `batchresponse_${randomUUID()}`;
  const chunks: Buffer[] = [];
  const text = (s: string) => chunks.push(Buffer.from(s, 'utf8'));
  const part = (a: BatchAnswer, id?: string) => {
    text(`Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n${id ? `Content-ID: ${id}\r\n` : ''}\r\n`);
    text(`HTTP/1.1 ${a.status} ${STATUS_CODES[a.status] ?? ''}\r\n`);
    for (const [k, v] of Object.entries(a.headers)) text(`${k}: ${v}\r\n`);
    text('\r\n');
    chunks.push(a.body);
    text('\r\n');
  };
  for (const r of results) {
    text(`--${outer}\r\n`);
    // OData 4.0: a change set that failed is answered with the one error, nothing in it having been kept.
    if (r.failed) part(r.failed);
    else if (!r.unit.atomic) part(r.answers[0], r.unit.requests[0].id);
    else {
      const inner = `changesetresponse_${randomUUID()}`;
      text(`Content-Type: multipart/mixed; boundary=${inner}\r\n\r\n`);
      r.answers.forEach((a, i) => {
        text(`--${inner}\r\n`);
        part(a, r.unit.requests[i].id);
      });
      text(`--${inner}--\r\n`);
    }
  }
  text(`--${outer}--\r\n`);
  return { type: `multipart/mixed; boundary=${outer}`, data: Buffer.concat(chunks) };
}

function jsonResponse(results: BatchResult[]): { type: string; data: Buffer } {
  const responses: Record<string, unknown>[] = [];
  const one = (a: BatchAnswer, r: BatchRequest, group?: string) => {
    const type = a.headers['content-type'] ?? '';
    const text = a.body.toString('utf8');
    let body: unknown;
    if (text && /json/i.test(type)) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else if (text) body = text;
    responses.push({ id: r.id, ...(group !== undefined ? { atomicityGroup: group } : {}), status: a.status, headers: a.headers, ...(body !== undefined ? { body } : {}) });
  };
  for (const r of results) {
    r.unit.requests.forEach((req, i) => {
      if (!r.failed) return one(r.answers[i], req, r.unit.group);
      // The group failed: the request that failed says why; the others weren't kept (424, Failed Dependency).
      one(r.answers[i] === r.failed ? r.failed : failure(424, '3', 'Another request in its atomicity group failed, so nothing in the group was kept'), req, r.unit.group);
    });
  }
  return { type: 'application/json; charset=utf-8', data: Buffer.from(JSON.stringify({ responses }), 'utf8') };
}

/** An OData error as an answer. */
export function failure(status: number, code: string, message: string): BatchAnswer {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'odata-version': '4.0' },
    body: Buffer.from(JSON.stringify({ error: { code, message } }), 'utf8'),
  };
}
