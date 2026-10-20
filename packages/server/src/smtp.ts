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

import { connect as tcp, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostRefusal, socketLookup } from '../../scripts/src/net-guard.ts';
import type { OutgoingMail, RedirectedMessage } from '../../scripts/src/index.ts';

export interface SmtpConfig {
  url: string;
  /** For tests: trust this certificate authority. */
  ca?: string;
}

/** A transport that sends only to `to`. */
export function redirectTransport(config: SmtpConfig, to: string): (m: RedirectedMessage) => Promise<void> {
  const u = new URL(config.url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('TABULARIUS_TEST_SMTP must be an smtp:// or smtps:// URL');
  if (!isAddress(to)) throw new Error(`"${to}" is not one email address`);
  // The copy comes from the redirect address itself: never from anyone a script names (a client's
  // staff), and with no Reply-To, Sender, CC or BCC, so it can't pose as them or reach anyone else.
  const from = to;
  return (m) => send(server(u, config), from, [to], mime([`From: ${from}`, `To: ${to}`], m), m.signal);
}

/** One plain address: no display name, list or anything a header could be split on. */
const isAddress = (a: string) => /^[^\s@<>,;"()]+@[^\s@<>,;"()]+$/.test(a);

const server = (u: URL, config: SmtpConfig): Server => ({
  host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587), secure: u.protocol === 'smtps:',
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), ...(config.ca ? { ca: config.ca } : {}),
});

/** Most recipients one Send Mail may name (To, CC and BCC together): a script looping a found set into one message stops here. */
export const MAIL_RECIPIENT_LIMIT = 100;

/**
 * Send Mail via SMTP, when the operator switched sending on: the message goes to the recipients the script
 * named, through the operator's account, always from `from` (the address the account may send as). The
 * script's From name is shown with it and its From address becomes the Reply-To; the step's own SMTP
 * server and password are never used.
 */
export function mailTransport(config: SmtpConfig, from: string, most = MAIL_RECIPIENT_LIMIT): (m: OutgoingMail) => Promise<void> {
  const u = new URL(config.url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('TABULARIUS_SMTP must be an smtp:// or smtps:// URL');
  if (!isAddress(from)) throw new Error(`--mail-from "${from}" is not one email address`);
  const account = server(u, config);
  return async (m) => {
    const all = [...m.to, ...m.cc, ...m.bcc];
    const bad = all.find((a) => !isAddress(a));
    if (bad !== undefined) throw new Error(`"${bad}" is not an email address`);
    if (!m.to.length && !m.cc.length && !m.bcc.length) throw new Error('the message has no recipients');
    if (all.length > most) throw new Error(`the message names ${all.length} recipients, more than ${most}`);
    const name = m.fromName.replace(/[\r\n"\\]+/g, ' ').trim();
    const head = [
      // An encoded word can't sit inside quotes: a name that isn't plain ASCII goes unquoted.
      `From: ${name ? `${/^[\x20-\x7e]*$/.test(name) ? `"${name}"` : header(name)} <${from}>` : from}`,
      ...(m.to.length ? [`To: ${m.to.join(', ')}`] : []),
      ...(m.cc.length ? [`Cc: ${m.cc.join(', ')}`] : []),
      ...(m.replyTo && isAddress(m.replyTo) && m.replyTo.toLowerCase() !== from.toLowerCase() ? [`Reply-To: ${m.replyTo}`] : []),
    ];
    // BCC recipients are in the envelope only.
    await send(account, from, [...new Set(all.map((a) => a.toLowerCase()))].map((a) => all.find((x) => x.toLowerCase() === a)!), mime(head, m), m.signal);
  };
}

/** Signs in to the account and says goodbye: no message, no recipient. Throws what the SMTP server said when it refuses. */
export async function checkLogin(config: SmtpConfig): Promise<void> {
  const u = new URL(config.url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('an SMTP account is an smtp:// or smtps:// address');
  await send(server(u, config), '', [], '');
}

const b64lines = (data: Uint8Array | string) => Buffer.from(data).toString('base64').replace(/.{76}/g, '$&\r\n');
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

function mime(addressing: string[], m: { subject: string; text: string; attachments: { name: string; data: Uint8Array }[] }): string {
  const boundary = `tabularius-${randomBytes(12).toString('hex')}`;
  const head = [
    ...addressing, `Subject: ${header(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomBytes(12).toString('hex')}@tabularius>`, 'MIME-Version: 1.0',
  ];
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(m.text)];
  if (!m.attachments.length) return [...head, ...text].join('\r\n');
  const parts = [
    [`--${boundary}`, ...text],
    ...m.attachments.map((a) => [
      `--${boundary}`, `Content-Type: application/octet-stream; name="${header(a.name.replace(/"/g, ''))}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${header(a.name.replace(/"/g, ''))}"`, '', b64lines(a.data),
    ]),
  ].map((p) => p.join('\r\n'));
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts, `--${boundary}--`].join('\r\n');
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
}

/** One SMTP conversation: EHLO, STARTTLS when not already secure, AUTH PLAIN, then one message to its recipients. */
async function send(server: Server, from: string, to: string[], data: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  // A name is checked on the lookup the connection uses; an address written out is checked here (a socket does no lookup for one).
  const refused = hostRefusal({ private: true }, server.host);
  if (refused) throw new Error(refused);
  let socket: Socket | TLSSocket = server.secure
    ? tlsConnect({ host: server.host, port: server.port, servername: server.host, lookup: guardedLookup, ...(server.ca ? { ca: server.ca } : {}) })
    : tcp({ host: server.host, port: server.port, lookup: guardedLookup });
  socket.setTimeout(30_000);
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
        socket.setTimeout(30_000);
        attach(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once('secureConnect', () => resolve());
          socket.once('error', reject);
        });
        ehlo = await command('EHLO Tabularius', 250);
      } else if (!local) {
        throw new Error('the SMTP server offers no STARTTLS; the password is never sent unencrypted');
      }
    }
    if (server.user) await command(`AUTH PLAIN ${Buffer.from(`\0${server.user}\0${server.password}`).toString('base64')}`, 235);
    if (!to.length) {
      // Only checking the sign-in.
      await command('QUIT', 221).catch(() => undefined);
      return;
    }
    await command(`MAIL FROM:<${from}>`, 250);
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
