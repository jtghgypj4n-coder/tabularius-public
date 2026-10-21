// Outbound test mode: scripts that send mail or call web services can be
// tried without reaching anyone. Every message Send Mail (or a mail plug-in)
// would send is captured in a local outbox, and its recipients are replaced:
// nothing ever goes to the addresses the script names. A copy may go to one
// redirect address, through an SMTP account the server's operator set up
// (never one a script names). Web requests reach only hosts on an allowlist;
// any other request is recorded and answered with an empty body.
//
// Without test mode (the default), scripts stay offline: Send Mail fails with
// error 3 and Insert from URL needs the network option.

import { isIP } from 'node:net';

/** Production CURL reaches only public HTTP(S) addresses. An injected fetch can opt into private test endpoints. */
export function curlAddressAllowed(raw: string, allowPrivate = false): boolean {
  if (!URL.canParse(raw)) return false;
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (['metadata', 'instance-data', 'metadata.google.internal', 'metadata.goog', 'instance-data.ec2.internal'].includes(h)) return false;
  if (isIP(h) === 4) {
    const [a, b, c] = h.split('.').map(Number);
    return !(a === 0 || a >= 224 || (a === 169 && b === 254) || h === '100.100.100.200' ||
      (!allowPrivate && (a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(h) === 6) {
    if (h === '::' || /^fe[89abcdef]/.test(h) || /^ff/.test(h) || h.startsWith('2001:db8:')) return false;
    // Teredo (2001::/32), discard-only (100::/64), 64:ff9b:1::/48, and the IPv4-compatible and SIIT forms that embed an IPv4 destination.
    if (/^2001:0{0,4}:/.test(h) || /^100::|^100:0{1,4}:0{1,4}:0{1,4}:0{1,4}:/.test(h) || h.startsWith('64:ff9b:1:')) return false;
    if (/^::(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|\d+\.\d+\.\d+\.\d+)$/.test(h) || /^::ffff:0:/.test(h)) return false;
    if (!allowPrivate && (h === '::1' || /^f[cd]/.test(h))) return false;
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return curlAddressAllowed(`http://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}/`, allowPrivate);
    }
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (dotted) return curlAddressAllowed(`http://${dotted[1]}/`, allowPrivate);
    const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (nat64) {
      const high = parseInt(nat64[1], 16), low = parseInt(nat64[2], 16);
      return curlAddressAllowed(`http://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}/`, allowPrivate);
    }
    if (h.startsWith('2002:')) return false; // 6to4 embeds an IPv4 destination.
  }
  return isIP(h) !== 0 || !!h;
}

export interface OutboxAttachment {
  name: string;
  size: number;
  /** Base64; left out when the file is larger than the outbox keeps. */
  data?: string;
}

export interface OutboxMail {
  kind: 'mail';
  at: string;
  script: string;
  /** The step or plug-in function that sent it. */
  via: string;
  from: string;
  /** The recipients the script named. None of them is ever sent anything. */
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: OutboxAttachment[];
  /** Where a copy went (the redirect address), when it was sent. */
  deliveredTo?: string;
  /** Why the copy to the redirect address failed. */
  error?: string;
  /** Why no copy was sent although delivery is set up (the limit on copies). */
  notCopied?: string;
}

export interface OutboxRequest {
  kind: 'http';
  at: string;
  script: string;
  via: string;
  method: string;
  /** With anything that looks like a credential (keys, tokens, signatures, passwords) removed. */
  url: string;
  host: string;
  /** On the allowlist, so it was really sent. */
  allowed: boolean;
  requestBytes: number;
  status?: number;
  responseBytes?: number;
  error?: string;
}

export type OutboxEntry = OutboxMail | OutboxRequest;

/** A message for the redirect address. It has no recipients or sender: the transport sends only to, and from, the address it was set up with. */
export interface RedirectedMessage {
  signal?: AbortSignal;
  subject: string;
  text: string;
  attachments: { name: string; data: Uint8Array }[];
  /** The files whose scripts sent it (the transport refuses any that are capture-only). */
  files: string[];
}

/**
 * A message Send Mail via SMTP really sends, when the server's operator switched sending on: to the
 * recipients the script named. The transport decides who it comes from.
 */
export interface OutgoingMail {
  signal?: AbortSignal;
  /** Mailboxes may include RFC 5322 display names; the envelope address is parsed by the SMTP transport. */
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  /** Shown as the sender's name, beside the operator's address. */
  fromName: string;
  /** The script's From address: replies go there. */
  replyTo?: string;
  attachments: { name: string; data: Uint8Array; mime?: string; contentId?: string }[];
  /** Optional HTML alternative for callers that explicitly provide one. FileMaker's native Send Mail step has no HTML option. */
  html?: string;
  /** The files on the call stack of the script that sent it (the transport refuses any that are capture-only). */
  files: string[];
}

/** A comma-separated list of file-name prefixes, trimmed, without empty entries. */
function prefixList(text: string | undefined): string[] {
  return (text ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

/**
 * Capture-only files: mail from them is only captured, never delivered, not
 * even to the redirect address, and their scripts never reach the network, AI,
 * schedules, automations or inbound hooks. Meant for solutions whose clients
 * must never get, or appear to get, anything from a test run. A file is
 * capture-only when its name starts with one of these prefixes (or equals it,
 * without `.fmp12`; a trailing `*` is allowed). None are built in: the
 * operator names them with TABULARIUS_CAPTURE_ONLY (comma-separated) or
 * `--capture-only`. `copyHeld` lets copies of their mail reach the redirect
 * address only; nothing ever lets it reach anyone else.
 */
let configuredCaptureOnly: string[] = prefixList(process.env.TABULARIUS_CAPTURE_ONLY);

/** The capture-only prefixes set for the whole process (TABULARIUS_CAPTURE_ONLY and `--capture-only`). */
export function captureOnlyDefaults(): readonly string[] {
  return configuredCaptureOnly;
}

/** Adds prefixes to the process-wide capture-only list (it only grows; `replace` starts it over, for tests). */
export function setCaptureOnlyDefaults(prefixes: readonly string[], replace = false): void {
  const add = prefixes.map((x) => x.trim()).filter(Boolean);
  configuredCaptureOnly = replace ? add : [...new Set([...configuredCaptureOnly, ...add])];
}

/** Whether a file's mail may only be captured: one the process names (TABULARIUS_CAPTURE_ONLY, `--capture-only`), or one in `extra`. */
export function captureOnly(file: string, extra: readonly string[] = []): boolean {
  const name = file.trim().toLowerCase();
  return [...configuredCaptureOnly, ...extra].some((p) => {
    const want = p.trim().toLowerCase().replace(/\.fmp12$/, '');
    return !!want && (want.endsWith('*') ? name.startsWith(want.slice(0, -1)) : name === want || name.startsWith(want));
  });
}

/** The subject of a test copy. */
export const TEST_SUBJECT_PREFIX = '[tabularius test] ';

export interface OutboundTest {
  /** Copies of messages go here, and only here, when `deliver` is set. */
  redirectTo?: string;
  /** Host names requests may really reach ("example.com" also allows its subdomains). */
  allowHosts: string[];
  /** Keeps an outbox entry. */
  record(entry: OutboxEntry): void;
  /** Sends a copy to `redirectTo` through the operator's SMTP account; absent = capture only. A string (or false): not sent, and why. */
  deliver?: (message: RedirectedMessage) => Promise<boolean | string | void>;
  /** More files whose mail is only captured, besides the process-wide ones (TABULARIUS_CAPTURE_ONLY): each matches any file name starting with it. */
  captureOnly?: string[];
  /**
   * Let capture-only files' mail be copied to the redirect address too (it is
   * still never sent to anyone the script names). Off unless asked for.
   */
  copyHeld?: boolean;
  /** Test-only transport for allowed requests; requires the engine's internal test injection. Absent uses global fetch. */
  fetch?: typeof fetch;
  /**
   * Refused calls to one host after which a run is stopped (default
   * REFUSED_CALL_LIMIT): a script looping over a blocked service would
   * otherwise call it again for every record.
   */
  refusedCallLimit?: number;
}

/** A run is stopped after this many refused calls to one host. */
export const REFUSED_CALL_LIMIT = 100;

/** Outside services a run tried to reach: per host, with how many calls went out. */
export interface OutsideCalls {
  /** The host, or '' for a web address with no host (often one built from an empty field). */
  host: string;
  /** The steps or functions that made the calls (Insert from URL, Open URL, a plug-in function). */
  via: string[];
  calls: number;
  /** Calls that really went out (the host is on the allowlist). */
  sent: number;
}

/** What a run tried to reach, in plain English: "Tried api.example.com 3 times (all blocked); wrote 1 email (captured, not sent)". */
export function describeOutside(outside: readonly OutsideCalls[], mail = 0): string {
  const n = (x: number) => x.toLocaleString('en-US');
  const times = (x: number) => (x === 1 ? 'once' : `${n(x)} times`);
  const parts = outside.map((o) => {
    const what = o.host || 'a web address with no host (probably built from an empty field)';
    const fate = o.sent === 0 ? 'all blocked' : o.sent === o.calls ? 'all sent' : `${n(o.sent)} sent, ${n(o.calls - o.sent)} blocked`;
    return `${what} ${times(o.calls)} (${o.calls === 1 ? fate.replace('all ', '') : fate})`;
  });
  const tried = parts.length ? `Tried ${parts.join(', ')}` : '';
  const mails = mail ? `wrote ${mail} email${mail === 1 ? '' : 's'} (captured in the outbox)` : '';
  return [tried, mails].filter(Boolean).join('; ').replace(/^w/, 'W');
}

/** Attachments larger than this are listed without their contents. */
export const OUTBOX_ATTACHMENT_LIMIT = 10 * 1024 * 1024;

/** Addresses in a FileMaker recipient list: separated by semicolons, commas or returns. */
export function addresses(list: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let angle = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c === '<') angle++;
    if (!quoted && c === '>' && angle) angle--;
    if (!quoted && !angle && (c === ';' || c === ',' || c === '\r' || c === '\n')) {
      const entry = list.slice(start, i).trim();
      if (entry) out.push(entry);
      start = i + 1;
    }
  }
  const last = list.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/**
 * Hosts test mode never reaches, whatever the allowlist says: solutions often
 * carry live cloud credentials (Amazon Web Services keys in upload scripts),
 * and a test must never use them against the real service.
 */
export const NEVER_ALLOWED = ['amazonaws.com', 'amazonaws.com.cn', 'aws.amazon.com', 'aws'];

const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Whether a host name (or allowlist entry) is one test mode never reaches. */
export function neverAllowed(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return NEVER_ALLOWED.some((d) => under(h, d));
}

/** Whether a URL's host is on the allowlist (exactly, or a subdomain of an entry), and not one that is never allowed. */
export function hostAllowed(url: string, allow: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  if (neverAllowed(host)) return false;
  return allow.some((a) => {
    const h = a.trim().toLowerCase().replace(/^\*\./, '');
    return !!h && (host === h || host.endsWith(`.${h}`));
  });
}

const SECRET_PARAM = /key|token|secret|signature|sig|password|passwd|pwd|auth|credential|session|x-amz-/i;

/** The URL without user info, and with the values of query parameters that look like credentials replaced. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, '[removed]');
    return u.toString();
  } catch {
    return '[not a URL]';
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The text of the copy sent to the redirect address. Who the script meant it
 * from and to stays in the local outbox only: the copy says how many
 * recipients there were, never their addresses or the sender's name.
 */
export function redirectedText(m: Pick<OutboxMail, 'to' | 'cc' | 'bcc' | 'body' | 'script'>, file: string, held = false): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  // The script's message is quoted, so the copy never reads as a message from whoever the script was written for.
  const quoted = m.body.split(/\r\n|[\r\n]/).map((l) => `> ${l}`).join('\n');
  // A copy from a capture-only file names neither the file nor its people.
  return (held ? 'Captured from a Tabularius test run. Not sent to anyone.\n' : `Captured from a Tabularius test run of ${file}. Not sent to anyone.\n`)
    + `This copy went only to you. Nobody else received it: not the ${count(m.to.length, 'recipient')}, ${count(m.cc.length, 'CC')} and ${count(m.bcc.length, 'BCC')} `
    + `the script named (their addresses stay in the local outbox).\n`
    + `Script: ${m.script}\n\n`
    + `The message the script wrote:\n\n${quoted}\n`;
}
