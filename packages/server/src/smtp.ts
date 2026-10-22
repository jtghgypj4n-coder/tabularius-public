// A small SMTP client. In outbound test mode it sends copies of captured
// messages to one address, the redirect address, through an account the
// server's operator configures (TABULARIUS_TEST_SMTP). The recipient is fixed
// when the transport is made; a message carries none of its own, so nothing
// a script names can become a recipient.
//
// With mail sending switched on (TABULARIUS_SMTP), Send Mail via SMTP sends to
// the recipients the script names, through the operator's account and from
// the address they set up (mailTransport).
//
//   smtps://user:password@smtp.example.com:465   TLS from the start
//   smtp://user:password@smtp.example.com:587    STARTTLS, required unless the host is this machine

import { connect as tcp, isIP, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { hostRefusal, socketLookup } from '../../scripts/src/net-guard.ts';
import type { OutgoingMail, RedirectedMessage } from '../../scripts/src/index.ts';

export interface SmtpConfig {
  url: string;
  /** For tests: trust this certificate authority. */
  ca?: string;
  /** Idle socket timeout; callers normally use the 30-second default. */
  timeoutMs?: number;
}

/** A transport that sends only to `to`. */
export function redirectTransport(config: SmtpConfig, to: string): (m: RedirectedMessage) => Promise<void> {
  const u = new URL(config.url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('TABULARIUS_TEST_SMTP must be an smtp:// or smtps:// URL');
  let recipient: string;
  try { recipient = plainAddress(to); } catch { throw new Error(`"${to}" is not one email address: use one plain email address, with no display name or list`); }
  // The copy comes from the redirect address itself: never from anyone a script names (a client's
  // staff), and with no Reply-To, Sender, CC or BCC, so it can't pose as them or reach anyone else.
  const from = recipient;
  return async (m) => {
    enforceContentLimit(m);
    await send(server(u, config), from, [recipient], mime([`From: ${from}`, `To: ${recipient}`], m), m.signal);
  };
}

/** One plain address: no display name, list or anything a header could be split on. */
const mailbox = (value: string): { address: string; display?: string } => {
  rejectHeaderBreaks('email address', value);
  // A mailbox is short; refusing a long one first keeps the matching below cheap whatever the text holds.
  if (Buffer.byteLength(value, 'utf8') > 998) throw new Error(`"${value.slice(0, 40)}..." is not an email address (longer than 998 bytes)`);
  // Each pattern has one way to match any text (no overlapping repeats), so none backtracks over a long run of spaces.
  const text = value.trim();
  const m = /^("(?:[^"\\]|\\.)*")\s*<([^<>]+)>$/.exec(text) ?? /^([^<>]*)<([^<>]+)>$/.exec(text) ?? /^()()([^<>]+)$/.exec(text);
  if (!m) throw new Error(`"${value}" is not an email address`);
  const display = m[1]?.trim();
  const address = (m[2] || m[3] || '').trim();
  const at = address.lastIndexOf('@');
  if (at < 1 || at !== address.indexOf('@') || at === address.length - 1 || /[\s<>(),;"\\]/.test(address)) throw new Error(`"${value}" is not an email address`);
  const local = address.slice(0, at);
  const atoms = local.split('.');
  const allowedAscii = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]$/;
  if (atoms.some((atom) => !atom || [...atom].some((c) => (c.codePointAt(0)! < 128 ? !allowedAscii.test(c) : /[\s\p{Cc}\p{Cf}]/u.test(c))))) throw new Error(`"${value}" is not an email address`);
  let domain = address.slice(at + 1);
  if (domain.startsWith('[') && domain.endsWith(']')) {
    const literal = domain.slice(1, -1);
    const ipv6 = /^IPv6:(.+)$/i.exec(literal)?.[1];
    if (ipv6 ? isIP(ipv6) !== 6 : isIP(literal) !== 4) throw new Error(`"${value}" is not an email address`);
  } else {
    domain = domainToASCII(domain);
    if (!domain || domain.length > 253 || domain.split('.').some((part) => !part || part.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part))) throw new Error(`"${value}" is not an email address`);
  }
  if (Buffer.byteLength(local, 'utf8') > 64 || Buffer.byteLength(`${local}@${domain}`, 'utf8') > 254) throw new Error(`"${value}" is not an email address`);
  return { address: `${local}@${domain}`, ...(display ? { display } : {}) };
};

const plainAddress = (a: string) => {
  const parsed = mailbox(a);
  if (parsed.display || /[<>]/.test(a) || a !== a.trim()) throw new Error(`"${a}" is not one plain email address`);
  return parsed.address;
};
const isAddress = (a: string) => { try { plainAddress(a); return true; } catch { return false; } };

const server = (u: URL, config: SmtpConfig): Server => ({
  host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587), secure: u.protocol === 'smtps:',
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), ...(config.ca ? { ca: config.ca } : {}), ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
});

/** Most recipients one Send Mail may name (To, CC and BCC together): a script looping a found set into one message stops here. */
export const MAIL_RECIPIENT_LIMIT = 100;
/** Maximum decoded text and attachment bytes in one outgoing message. */
export const MAIL_CONTENT_LIMIT = 25 * 1024 * 1024;
/** Maximum attachments so empty-file metadata cannot bypass the content cap. */
export const MAIL_ATTACHMENT_LIMIT = 100;
function enforceContentLimit(m: { text: string; html?: string; attachments: { name?: string; mime?: string; contentId?: string; data: Uint8Array }[] }): void {
  if (m.attachments.length > MAIL_ATTACHMENT_LIMIT) throw new Error(`the message names more than ${MAIL_ATTACHMENT_LIMIT} attachments`);
  const bytes = Buffer.byteLength(m.text, 'utf8') + (m.html === undefined ? 0 : Buffer.byteLength(m.html, 'utf8')) + m.attachments.reduce((n, a) => n + a.data.byteLength + Buffer.byteLength(a.name ?? '') + Buffer.byteLength(a.mime ?? '') + Buffer.byteLength(a.contentId ?? ''), 0);
  if (bytes > MAIL_CONTENT_LIMIT) throw new Error(`the message content exceeds ${MAIL_CONTENT_LIMIT} bytes`);
}

/**
 * Send Mail via SMTP, when the operator switched sending on: the message goes to the recipients the script
 * named, through the operator's account, always from `from` (the address the account may send as). The
 * script's From name is shown with it and its From address becomes the Reply-To; the step's own SMTP
 * server and password are never used.
 */
export function mailTransport(config: SmtpConfig, from: string, most = MAIL_RECIPIENT_LIMIT): (m: OutgoingMail) => Promise<void> {
  const u = new URL(config.url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('TABULARIUS_SMTP must be an smtp:// or smtps:// URL');
  let sender: string;
  try { sender = plainAddress(from); } catch { throw new Error(`--mail-from "${from}" is not one email address`); }
  const account = server(u, config);
  return async (m) => {
    rejectHeaderBreaks('from name', m.fromName);
    rejectHeaderBreaks('subject', m.subject);
    if (m.replyTo !== undefined) rejectHeaderBreaks('reply-to', m.replyTo);
    if (m.replyTo && !isAddress(m.replyTo)) throw new Error(`"${m.replyTo}" is not one Reply-To email address`);
    const named = m.to.length + m.cc.length + m.bcc.length;
    if (!named) throw new Error('the message has no recipients');
    if (named > most) throw new Error(`the message names ${named} recipients, more than ${most}`);
    const all = [...m.to, ...m.cc, ...m.bcc].map(mailbox);
    enforceContentLimit(m);
    const name = m.fromName.trim();
    const replyTo = m.replyTo && isAddress(m.replyTo) && mailbox(m.replyTo).address.toLowerCase() !== sender.toLowerCase() ? mailbox(m.replyTo).address : undefined;
    const head = [
      // An encoded word can't sit inside quotes: a name that isn't plain ASCII goes unquoted.
      fold('From', name ? `${quoteDisplay(name)} <${sender}>` : sender),
      ...(m.to.length ? [fold('To', m.to.map(formatMailbox).join(', '))] : []),
      ...(m.cc.length ? [fold('Cc', m.cc.map(formatMailbox).join(', '))] : []),
      ...(replyTo ? [fold('Reply-To', replyTo)] : []),
    ];
    // BCC recipients are in the envelope only.
    const recipients = all.filter((a, i) => all.findIndex((x) => x.address.toLowerCase() === a.address.toLowerCase()) === i).map((a) => a.address);
    await send(account, sender, recipients, mime(head, m), m.signal, replyTo ? [replyTo] : []);
  };
}

/** Signs in to the account and says goodbye: no message, no recipient. Throws what the SMTP server said when it refuses. */
export async function checkLogin(config: SmtpConfig): Promise<void> {
  const u = new URL(config.url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('an SMTP account is an smtp:// or smtps:// address');
  await send(server(u, config), '', [], '');
}

const b64lines = (data: Uint8Array | string) => Buffer.from(data).toString('base64').replace(/.{76}/g, '$&\r\n');
const encodedWords = (s: string) => {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words: string[] = [];
  let part = '';
  for (const char of s) {
    if (Buffer.byteLength(part + char, 'utf8') > 30 && part) {
      words.push(`=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`);
      part = '';
    }
    part += char;
  }
  if (part) words.push(`=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`);
  return words.join(' ');
};
const rejectHeaderBreaks = (name: string, value: string) => {
  if (/[\r\n\0-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) throw new Error(`${name} contains a line break or control character`);
  if (Buffer.byteLength(value, 'utf8') > 65_536) throw new Error(`${name} is too large`);
};
const fold = (name: string, value: string) => {
  rejectHeaderBreaks(name, value);
  const prefix = `${name}: `;
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = prefix;
  for (const word of words) {
    if (!word) continue;
    if (Buffer.byteLength(line + (line.endsWith(' ') ? '' : ' ') + word, 'utf8') > 78 && line !== prefix) {
      lines.push(line);
      line = ` ${word}`;
    } else {
      line += (line.endsWith(' ') ? '' : ' ') + word;
    }
    if (Buffer.byteLength(line, 'utf8') > 998) throw new Error(`${name} exceeds the 998-octet line limit`);
  }
  lines.push(line.trimEnd());
  return lines.join('\r\n');
};
const quoteDisplay = (value: string) => {
  const decoded = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value;
  if (/^[\x20-\x7e]+$/.test(decoded)) return `"${decoded.replace(/[\\"]/g, '\\$&')}"`;
  return encodedWords(decoded);
};
const formatMailbox = (raw: string) => {
  const m = mailbox(raw);
  return m.display ? `${quoteDisplay(m.display)} <${m.address}>` : m.address;
};
const mediaType = (given: string | undefined, name: string) => {
  if (given !== undefined) rejectHeaderBreaks('attachment content type', given);
  if (given && Buffer.byteLength(given) > 255) throw new Error('attachment content type is too long');
  if (given && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+-]+|"[A-Za-z0-9 _.-]{1,80}"))*$/.test(given)) return given;
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  return ({ pdf: 'application/pdf', txt: 'text/plain; charset=UTF-8', csv: 'text/csv; charset=UTF-8', html: 'text/html; charset=UTF-8', htm: 'text/html; charset=UTF-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', json: 'application/json', zip: 'application/zip' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
};
const filenameParams = (name: string) => {
  rejectHeaderBreaks('attachment filename', name);
  if (Buffer.byteLength(name, 'utf8') > 4096) throw new Error('attachment filename is too long');
  if (/^[\x20-\x7e]*$/.test(name) && Buffer.byteLength(name) <= 60) return `filename="${name.replace(/["\\]/g, '\\$&')}"`;
  // The plain filename is only a fallback for readers without RFC 2231, so keep the extension when shortening.
  const safe = [...name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')];
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(safe.join(''))?.[0] ?? '';
  const fallback = safe.length <= 32 ? safe.join('') : safe.slice(0, Math.max(1, 32 - ext.length)).join('') + ext;
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  // RFC 2231 parameter continuations keep each token short enough to fold safely.
  const tokens = encoded.match(/%[0-9A-Fa-f]{2}|[^%]/g) ?? [];
  const chunks: string[] = [];
  for (const token of tokens) {
    if (!chunks.length || chunks.at(-1)!.length + token.length > 42) chunks.push(token);
    else chunks[chunks.length - 1] += token;
  }
  return [`filename="${fallback}"`, ...chunks.map((chunk, i) => `filename*${i}*=${i === 0 ? "UTF-8''" : ''}${chunk}`)].join('; ');
};

function mime(addressing: string[], m: { subject: string; text: string; html?: string; attachments: { name: string; data: Uint8Array; mime?: string; contentId?: string }[] }): string {
  const boundary = `tabularius-${randomBytes(12).toString('hex')}`;
  rejectHeaderBreaks('subject', m.subject);
  const text = [`Content-Type: text/plain; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', b64lines(m.text)];
  const html = m.html === undefined ? undefined : ['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(m.html)];
  const alternativeBoundary = `tabularius-alt-${randomBytes(12).toString('hex')}`;
  const body = html ? [
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, '',
    `--${alternativeBoundary}`, ...text, `--${alternativeBoundary}`, ...html, `--${alternativeBoundary}--`,
  ] : text;
  const attachments = m.attachments.map((a) => {
    rejectHeaderBreaks('attachment content ID', a.contentId ?? '');
    if (a.contentId && (/[<>\s]/.test(a.contentId) || Buffer.byteLength(a.contentId) > 200 || !/^[\x21-\x7e]+$/.test(a.contentId))) throw new Error('attachment content ID is invalid or too long');
    if (a.contentId) mailbox(a.contentId);
    const cid = a.contentId ? [fold('Content-ID', `<${a.contentId}>`)] : [];
    return [fold('Content-Type', mediaType(a.mime, a.name)), `Content-Transfer-Encoding: base64`, fold('Content-Disposition', `${a.contentId ? 'inline' : 'attachment'}; ${filenameParams(a.name)}`), ...cid, '', b64lines(a.data)];
  });
  const inline = attachments.filter((_, i) => !!m.attachments[i]!.contentId);
  const regular = attachments.filter((_, i) => !m.attachments[i]!.contentId);
  const relatedBoundary = `tabularius-rel-${randomBytes(12).toString('hex')}`;
  const mixedBoundary = boundary;
  const main = inline.length ? [
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`, '',
    `--${relatedBoundary}`, ...body,
    ...inline.flatMap((p) => [`--${relatedBoundary}`, ...p]), `--${relatedBoundary}--`,
  ] : body;
  const isMixed = regular.length > 0;
  const headers = [
    ...addressing,
    fold('Subject', encodedWords(m.subject)),
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@tabularius>`,
    'MIME-Version: 1.0',
    ...(isMixed ? [`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`] : []),
    ...(!isMixed && inline.length ? [`Content-Type: multipart/related; boundary="${relatedBoundary}"`] : []),
  ];
  if (!isMixed) return [...headers, ...(inline.length ? ['', `--${relatedBoundary}`, ...body, ...inline.flatMap((p) => [`--${relatedBoundary}`, ...p]), `--${relatedBoundary}--`] : main)].join('\r\n');
  return [...headers, '', `--${mixedBoundary}`, ...main, ...regular.flatMap((p) => [`--${mixedBoundary}`, ...p]), `--${mixedBoundary}--`].join('\r\n');
}

/** The connection's own name resolution is the shared guard's: link-local and metadata addresses are refused on the very lookup the connection uses, so a name can't be pointed there after it was checked. */
const guardedLookup = socketLookup({ private: true });

interface Server {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  ca?: string;
  timeoutMs?: number;
}

/** One SMTP conversation: EHLO, STARTTLS when not already secure, AUTH PLAIN, then one message to its recipients. */
async function send(server: Server, from: string, to: string[], data: string, signal?: AbortSignal, headerAddresses: string[] = []): Promise<void> {
  signal?.throwIfAborted();
  // A name is checked on the lookup the connection uses; an address written out is checked here (a socket does no lookup for one).
  const refused = hostRefusal({ private: true }, server.host);
  if (refused) throw new Error(refused);
  let socket: Socket | TLSSocket = server.secure
    ? tlsConnect({ host: server.host, port: server.port, servername: server.host, lookup: guardedLookup, ...(server.ca ? { ca: server.ca } : {}) })
    : tcp({ host: server.host, port: server.port, lookup: guardedLookup });
  socket.setTimeout(server.timeoutMs ?? 30_000);
  // The whole conversation has a limit too: a server that answers a word at a time can't hold a run forever.
  const deadline = setTimeout(() => socket.destroy(new Error('the SMTP server took too long')), 180_000);
  let buffer = '';
  let waiting: ((line: string) => void) | undefined;
  let failed: ((e: Error) => void) | undefined;
  const attach = (s: Socket | TLSSocket) => {
    s.setEncoding('utf8');
    s.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 65_536) return void s.destroy(new Error('the SMTP server sent too much'));
      // A reply ends with a line whose code is followed by a space.
      const m = /(?:^|\r\n)(\d{3})(?: [^\r\n]*)?\r\n$/.exec(buffer);
      if (m && waiting) {
        const reply = buffer;
        buffer = '';
        const w = waiting;
        waiting = undefined;
        w(reply);
      }
    });
    s.on('error', (e) => failed?.(e));
    s.on('close', () => failed?.(new Error('the SMTP server closed the connection')));
    s.on('timeout', () => failed?.(new Error('the SMTP server stopped answering')));
  };
  attach(socket);
  const stop = () => socket.destroy(new Error('The mail operation was canceled'));
  signal?.addEventListener('abort', stop, { once: true });
  const reply = (expect: number) => new Promise<string>((resolve, reject) => {
    failed = reject;
    waiting = (r) => {
      const code = Number(r.split('\r\n').filter(Boolean).pop()!.slice(0, 3));
      if (Math.floor(code / 100) !== Math.floor(expect / 100)) reject(new Error(`SMTP: ${r.trim().split('\r\n').pop()}`));
      else resolve(r);
    };
  });
  const command = (line: string, expect: number) => {
    signal?.throwIfAborted();
    const r = reply(expect);
    socket.write(line + '\r\n');
    return r;
  };
  try {
    await reply(220);
    let ehlo = await command('EHLO Tabularius', 250);
    if (!server.secure) {
      const local = server.host === 'localhost' || server.host === '127.0.0.1' || server.host === '::1';
      if (/STARTTLS/i.test(ehlo)) {
        await command('STARTTLS', 220);
        const plain = socket as Socket;
        plain.removeAllListeners('data');
        socket = tlsConnect({ socket: plain, servername: server.host, ...(server.ca ? { ca: server.ca } : {}) });
        socket.setTimeout(server.timeoutMs ?? 30_000);
        attach(socket);
        await new Promise<void>((resolve, reject) => {
          // The handshake has no pending reply, so point the timeout and close handlers at it.
          failed = reject;
          socket.once('secureConnect', () => resolve());
          socket.once('error', reject);
        });
        ehlo = await command('EHLO Tabularius', 250);
      } else if (!local) {
        throw new Error('the SMTP server offers no STARTTLS; the password is never sent unencrypted');
      }
    }
    const smtpUtf8 = /\bSMTPUTF8\b/i.test(ehlo);
    const needsUtf8 = /[^\x00-\x7f]/.test(from.split('@')[0] ?? '') || [...to, ...headerAddresses].some((address) => /[^\x00-\x7f]/.test(address.split('@')[0] ?? ''));
    if (needsUtf8 && !smtpUtf8) throw new Error('the SMTP server does not support SMTPUTF8 for a Unicode email address');
    if (server.user) await command(`AUTH PLAIN ${Buffer.from(`\0${server.user}\0${server.password}`).toString('base64')}`, 235);
    if (!to.length) {
      // Only checking the sign-in.
      await command('QUIT', 221).catch(() => undefined);
      return;
    }
    await command(`MAIL FROM:<${from}>${needsUtf8 ? ' SMTPUTF8' : ''}`, 250);
    for (const rcpt of to) await command(`RCPT TO:<${rcpt}>`, 250);
    await command('DATA', 354);
    // Dot-stuffing: a line that starts with "." gets another.
    await command(data.replace(/\r\n\./g, '\r\n..') + '\r\n.', 250);
    await command('QUIT', 221).catch(() => undefined);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', stop);
    socket.destroy();
  }
}
