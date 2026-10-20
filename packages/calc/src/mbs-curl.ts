// A bounded subset of MBS FileMaker CURL. Signatures and results follow the public
// function pages at https://www.mbsplugins.eu/CURLNew.shtml (one page per call).
import { MbsError } from './mbs-text.ts';
import type { MbsCurlRequest, PluginResponse } from './evaluate.ts';

interface Handle {
  url: string;
  method?: string;
  headers: Record<string, string>;
  post?: string;
  input?: string;
  upload: boolean;
  user?: string;
  password?: string;
  follow: boolean;
  maxRedirs: number;
  verbose: boolean;
  debugWithData: boolean;
  aws?: { spec: string; user: string };
  response?: PluginResponse;
}
interface Session { next: number; handles: Map<number, Handle> }
const sessions = new WeakMap<object, Session>();
/** A suspended script step runs again; restore its handle changes before replay. */
export function snapshotMbsCurl(scope: object): Session | undefined {
  const s = sessions.get(scope);
  return s && { next: s.next, handles: new Map([...s.handles].map(([id, h]) => [id, { ...h, headers: { ...h.headers } }])) };
}
export function restoreMbsCurl(scope: object, saved: Session | undefined): void {
  if (saved) sessions.set(scope, saved);
  else sessions.delete(scope);
}
const session = (scope: object) => {
  let s = sessions.get(scope);
  if (!s) sessions.set(scope, (s = { next: 16000, handles: new Map() }));
  return s;
};
const error = (message: string): never => { throw new MbsError(message); };
const flag = (v: string | undefined) => Number(v ?? '0') !== 0;
const integer = (v: string | undefined, name: string) => {
  const n = Number(v);
  if (v === undefined || !Number.isInteger(n)) error(`${name} needs an integer`);
  return n;
};
const handle = (scope: object, value: string | undefined): Handle => {
  const n = Number(value);
  return session(scope).handles.get(n) ?? error(`"${value ?? ''}" is not a CURL handle`);
};
const lineEndings = (value: string, preserve: string | undefined) => flag(preserve) ? value : value.replace(/\r\n|\n/g, '\r');
const utf8 = (encoding: string | undefined) => {
  if (encoding && !/^(?:utf-?8|native)$/i.test(encoding)) error(`CURL text encoding "${encoding}" is not available in Tabularius`);
};
const headerText = (r: PluginResponse) => r.headerText ?? `HTTP/1.1 ${r.status}\r\n${Object.entries(r.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`;

export const MBS_CURL: Record<string, (args: string[], scope: object, network?: (request: MbsCurlRequest) => PluginResponse) => string | number> = {
  'curl.new': (_a, scope) => {
    const s = session(scope);
    if (s.handles.size >= 16) error('Too many CURL connections are open (16); release a handle first');
    const id = s.next++;
    s.handles.set(id, { url: '', headers: {}, upload: false, follow: false, maxRedirs: -1, verbose: true, debugWithData: false });
    return id;
  },
  'curl.release': (a, scope) => { handle(scope, a[0]); session(scope).handles.delete(Number(a[0])); return 'OK'; },
  'curl.setoptionurl': (a, scope) => { utf8(a[2]); handle(scope, a[0]).url = a[1] ?? ''; return 'OK'; },
  'curl.setoptionusername': (a, scope) => { utf8(a[2]); handle(scope, a[0]).user = a[1] ?? ''; return 'OK'; },
  'curl.setoptionpassword': (a, scope) => { utf8(a[2]); handle(scope, a[0]).password = a[1] ?? ''; return 'OK'; },
  'curl.setoptionhttpheader': (a, scope) => {
    const h = handle(scope, a[0]);
    const headers: Record<string, string> = {};
    for (const line of a.slice(1)) {
      const at = line.indexOf(':');
      if (at < 1 || /[\r\n]/.test(line)) error('CURL.SetOptionHTTPHeader needs header lines without line endings');
      headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    h.headers = headers;
    return 'OK';
  },
  'curl.setoptionpostfields': (a, scope) => { utf8(a[2]); handle(scope, a[0]).post = a[1] ?? ''; return 'OK'; },
  'curl.setoptioncustomrequest': (a, scope) => {
    utf8(a[2]);
    const method = a[1] ?? '';
    if (!/^[A-Za-z]+$/.test(method)) error('CURL.SetOptionCustomRequest needs an HTTP method');
    handle(scope, a[0]).method = method.toUpperCase();
    return 'OK';
  },
  'curl.setoptionupload': (a, scope) => { handle(scope, a[0]).upload = flag(a[1]); return 'OK'; },
  'curl.setinputtext': (a, scope) => { utf8(a[2]); handle(scope, a[0]).input = a[1] ?? ''; return 'OK'; },
  'curl.setoptionfollowlocation': (a, scope) => {
    const n = integer(a[1], 'CURL.SetOptionFollowLocation');
    if (n !== 0 && n !== 1) error('CURL.SetOptionFollowLocation flags 2 and 4 are not available in Tabularius');
    handle(scope, a[0]).follow = n === 1;
    return 'OK';
  },
  'curl.setoptionmaxredirs': (a, scope) => {
    const n = integer(a[1], 'CURL.SetOptionMaxRedirs');
    if (n < -1) error('CURL.SetOptionMaxRedirs needs -1 or a nonnegative limit');
    handle(scope, a[0]).maxRedirs = n;
    return 'OK';
  },
  'curl.setoptionverbose': (a, scope) => { handle(scope, a[0]).verbose = flag(a[1]); return 'OK'; },
  'curl.setdebugwithdata': (a, scope) => { handle(scope, a[0]).debugWithData = flag(a[1]); return 'OK'; },
  'curl.setoptionsslverifypeer': (a, scope) => {
    handle(scope, a[0]);
    if (integer(a[1], 'CURL.SetOptionSSLVerifyPeer') !== 1) error('CURL.SetOptionSSLVerifyPeer cannot disable TLS verification for scripts');
    return 'OK';
  },
  'curl.setoptionsslverifyhost': (a, scope) => {
    handle(scope, a[0]);
    if (integer(a[1], 'CURL.SetOptionSSLVerifyHost') !== 2) error('CURL.SetOptionSSLVerifyHost requires full TLS verification for scripts');
    return 'OK';
  },
  'curl.setoptionsslversion': (a, scope) => {
    handle(scope, a[0]);
    if (integer(a[1], 'CURL.SetOptionSSLVersion') !== 0) error('CURL.SetOptionSSLVersion is not available in Tabularius');
    return 'OK';
  },
  'curl.setoptionusessl': (a, scope) => {
    handle(scope, a[0]);
    if (integer(a[1], 'CURL.SetOptionUseSSL') !== 0) error('CURL.SetOptionUseSSL requires an unsupported FTP transfer');
    return 'OK';
  },
  'curl.perform': (a, scope, network) => {
    const h = handle(scope, a[0]);
    const send = network ?? error('CURL.Perform: network access is off for scripts');
    if (!URL.canParse(h.url)) return 3; // CURLE_URL_MALFORMAT
    if (!/^https?:\/\//i.test(h.url)) return 1; // CURLE_UNSUPPORTED_PROTOCOL
    const headers = { ...h.headers };
    if (h.user !== undefined && !h.aws) headers.Authorization = 'Basic ' + Buffer.from(`${h.user}:${h.password ?? ''}`).toString('base64');
    const body = h.upload ? h.input : h.post;
    if (h.upload && body === undefined) error('CURL.Perform upload needs CURL.SetInputText');
    if (h.aws && h.upload) error('CURL.SetupAWS signs post fields or no body here; file uploads are not available in Tabularius');
    if (body && Buffer.byteLength(body) > 64 * 1024 * 1024) error('CURL.Perform request body is over 64 MB');
    if (h.post !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const req: MbsCurlRequest = { method: h.method ?? (h.upload ? 'PUT' : h.post !== undefined ? 'POST' : 'GET'), url: h.url, headers, body,
      follow: h.follow, maxRedirs: h.maxRedirs, ...(h.aws ? { aws: h.aws } : {}) };
    const response = send(req);
    h.response = response;
    if (response.error === 'too many redirects') return 47; // CURLE_TOO_MANY_REDIRECTS, documented by CURL.Perform.
    if (response.error) error(`CURL.Perform: ${response.error}`);
    return 0;
  },
  'curl.getresponsecode': (a, scope) => handle(scope, a[0]).response?.status ?? 0,
  'curl.getresultastext': (a, scope) => {
    utf8(a[1]);
    return lineEndings(handle(scope, a[0]).response?.body ?? '', a[2]);
  },
  'curl.getheaderastext': (a, scope) => {
    utf8(a[1]);
    const r = handle(scope, a[0]).response;
    return lineEndings(r ? headerText(r) : '', a[2]);
  },
  'curl.getdebugmessages': (a, scope) => {
    handle(scope, a[0]);
    return error('CURL debug transcript format is not documented publicly and is unavailable in Tabularius');
  },
  'curl.setupaws': (a, scope) => {
    const h = handle(scope, a[0]);
    if (a.length < 8) error('CURL.SetupAWS needs access key, secret, region, service, path, domain and verb');
    if (a[8] || a[9] || a[10]) error('CURL.SetupAWS hashed payload, extra headers and query parameters are not available in Tabularius');
    const [key, secret, region, service, path, domain, verb] = a.slice(1, 8);
    if (!key || !secret || !region || !service || !path?.startsWith('/') || !/^(GET|POST|PUT|PATCH|HEAD|DELETE)$/i.test(verb)) error('CURL.SetupAWS has an invalid required parameter');
    h.url = `https://${domain || `${service}.${region}.amazonaws.com`}${path}`;
    h.method = verb.toUpperCase();
    h.aws = { spec: `aws:amz:${region}:${service}`, user: `${key}:${secret}` };
    return 'OK';
  },
};
MBS_CURL['curl.cleanup'] = MBS_CURL['curl.release'];
MBS_CURL['curl.getdebugastext'] = MBS_CURL['curl.getdebugmessages'];
