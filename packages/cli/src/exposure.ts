// `tabularius doctor --exposure [--url URL] [--port 8080] [--sql-port N]`: what a running server is open to, one finding
// at a time, each with what to change. It reads and asks, with no password or token: it makes plain GET and POST
// requests that a stranger could make, connects to the server's ports, and reads the options of the installed
// service (if there is one). It changes nothing and signs nothing in. A finding is "ok" only for something it saw; what
// it could not see (the cookie flags, since no sign-in is made; the SQL port when none is named; the proxies of a server
// that was not installed as a service) is a "check" that says so, never "ok".

import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Check } from './doctor.ts';
import { isLoopbackHost } from './loopback.ts';
import type { Installed } from './service.ts';

/** What an answer to a request was: the status, the headers and the start of the body. Undefined when nothing answered. */
export interface Answer { status: number; headers: IncomingHttpHeaders; body: string }

/** Everything the checks ask of the outside world, so a test can answer instead of a network. */
export interface Probes {
  /** One request, no credentials; certificates are not checked (that is `doctor --url`'s question). */
  ask(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<Answer | undefined>;
  /** Whether something accepts a TCP connection at the address, within a second. */
  open(host: string, port: number): Promise<boolean>;
  /** What a PostgreSQL port answers to an SSL request: S (TLS offered), N (plain only), or undefined. */
  sslAnswer(host: string, port: number): Promise<'S' | 'N' | undefined>;
  /** This computer's addresses other than loopback. */
  addresses(): string[];
}

const TIMEOUT = 3000;

export const realProbes: Probes = {
  ask(url, init = {}) {
    const request = url.startsWith('https:') ? httpsRequest : httpRequest;
    return new Promise((done) => {
      const req = request(url, { method: init.method ?? 'GET', headers: init.headers, rejectUnauthorized: false, timeout: TIMEOUT, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { if (body.length < 65_536) body += c; });
        res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
        res.on('error', () => done(undefined));
      });
      req.on('error', () => done(undefined));
      req.on('timeout', () => req.destroy());
      req.end(init.body);
    });
  },
  open: (host, port) => new Promise((done) => {
    const socket = connect({ host, port, timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => done(false));
    socket.once('timeout', () => { socket.destroy(); done(false); });
  }),
  sslAnswer: (host, port) => new Promise((done) => {
    const socket = connect({ host, port, timeout: 2000 });
    socket.once('connect', () => socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])));
    socket.once('data', (d) => { socket.destroy(); done(d[0] === 0x53 ? 'S' : d[0] === 0x4e ? 'N' : undefined); });
    socket.once('error', () => done(undefined));
    socket.once('timeout', () => { socket.destroy(); done(undefined); });
  }),
  addresses: () => Object.values(networkInterfaces()).flatMap((list) => list ?? [])
    .filter((a) => !a.internal && !/^fe80:/i.test(a.address)).map((a) => a.address),
};

export interface ExposureOptions {
  url?: string;
  port?: number;
  sqlPort?: number;
  /** The installed service, whose options say what the server was started with. */
  service?: Installed;
  probes?: Probes;
  /** Where TABULARIUS_TRUSTED_PROXIES is read from (this command's environment). */
  env?: NodeJS.ProcessEnv;
}

const option = (args: string[], name: string): string | undefined => {
  const i = args.findIndex((a) => a === name);
  return i >= 0 ? args[i + 1] : args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
};
const brackets = (host: string) => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host);

export async function runExposure(opts: ExposureOptions = {}): Promise<Check[]> {
  const probes = opts.probes ?? realProbes;
  const extra = opts.service?.extra ?? [];
  const tls = extra.some((a) => a === '--https' || a === '--tls-cert' || a.startsWith('--https='));
  const port = opts.port ?? opts.service?.port ?? 8080;
  // Without --url the server is where the installed service listens: its --host if that names one address, else loopback.
  const serviceHost = opts.service?.host && !['0.0.0.0', '::', '[::]', ''].includes(opts.service.host) ? opts.service.host : undefined;
  const base = new URL(opts.url ?? `${tls ? 'https' : 'http'}://${brackets(serviceHost ?? '127.0.0.1')}:${port}`);
  const https = base.protocol === 'https:';
  const host = base.hostname.replace(/^\[|\]$/g, '');
  const local = isLoopbackHost(host) || probes.addresses().includes(host);
  const at = (path: string) => new URL(path, base).toString();
  const checks: Check[] = [];

  const health = await probes.ask(at('/tabularius/health'));
  if (health?.status !== 200) {
    return [{ name: 'Server', level: 'problem', message: `nothing answers at ${base.origin}`, fix: 'Start the server, or give its address with --url (or its port with --port). Nothing else can be checked until it answers.' }];
  }
  checks.push({ name: 'Server', level: 'ok', message: `answers at ${base.origin}` });

  // Binding: a connection to each of this computer's other addresses says whether the server listens beyond loopback.
  const sqlPort = opts.sqlPort ?? (Number(option(extra, '--sql-port')) || undefined);
  let exposedTo: string[] = [];
  if (local) {
    const ports = [Number(base.port || (https ? 443 : 80)), ...(sqlPort ? [sqlPort] : [])];
    const found: string[] = [];
    for (const address of probes.addresses()) for (const p of ports) if (await probes.open(address, p)) found.push(`${brackets(address)}:${p}`);
    exposedTo = found;
    checks.push(found.length
      ? { name: 'Listening', level: 'warn', message: `also accepts connections on ${found.join(', ')}, so other computers on the network can reach it`, fix: 'If only this computer needs it, serve on loopback: --host 127.0.0.1 (a proxy that does HTTPS can sit in front). Otherwise keep it, with HTTPS (below) and a firewall that names who may connect.' }
      : { name: 'Listening', level: 'ok', message: probes.addresses().length ? 'only this computer can connect (no other address of this computer accepts a connection on the port)' : 'only this computer can connect (it has no other address to try)' });
  } else {
    checks.push({ name: 'Listening', level: 'warn', message: `${host} is not this computer, so what the server listens on cannot be tried from here`, fix: 'Run doctor --exposure on the server itself to see whether it listens beyond loopback.' });
  }
  const beyond = exposedTo.length > 0 || !local;

  checks.push(!https
    ? isLoopbackHost(host) && !beyond
      ? { name: 'Plain HTTP', level: 'ok', message: 'plain HTTP, on this computer only' }
      : { name: 'Plain HTTP', level: 'problem', message: `${base.origin} is plain HTTP and reachable from the network: passwords and sign-in tokens cross it unencrypted`, fix: 'Serve HTTPS: --https <your domain>, --https local on a local network, or --tls-cert with --tls-key; or listen on loopback only (--host 127.0.0.1) behind a proxy that does HTTPS.' }
    : { name: 'Plain HTTP', level: 'ok', message: 'HTTPS' });

  // What the server tells browsers, read from the health answer's headers.
  const headers = health.headers;
  if (https) {
    checks.push(headers['strict-transport-security']
      ? { name: 'HSTS', level: 'ok', message: `Strict-Transport-Security: ${headers['strict-transport-security']}` }
      : { name: 'HSTS', level: 'warn', message: 'the answer carries no Strict-Transport-Security header, so a browser may still try plain HTTP first', fix: 'Update the server (versions before the exposure headers do not send it), or, behind a proxy, check the proxy forwards X-Forwarded-Proto: https from an address in --trusted-proxies.' });
  } else if (headers['strict-transport-security']) {
    checks.push({ name: 'HSTS', level: 'warn', message: 'plain HTTP answers with Strict-Transport-Security, which browsers ignore there', fix: 'Check the proxy in front is not adding the header to plain HTTP.' });
  }
  checks.push(headers['permissions-policy']
    ? { name: 'Browser headers', level: 'ok', message: 'Permissions-Policy is sent' }
    : { name: 'Browser headers', level: 'warn', message: 'the answer carries no Permissions-Policy header', fix: 'Update the server, or check a proxy in front is not removing headers.' });

  // The cookie of the admin console is set at sign-in, and this check does not sign in: what follows is not observed.
  checks.push(https
    ? { name: 'Console cookie', level: 'warn', message: 'not observed (no sign-in was made): over HTTPS the console cookie is built to be Secure, HttpOnly and SameSite=Strict, named __Host-tabularius_admin', fix: 'To see it, sign in to the console in a browser and look at the cookie in its developer tools.' }
    : beyond
      ? { name: 'Console cookie', level: 'problem', message: 'not observed (no sign-in was made), but over plain HTTP the console cookie cannot be Secure, and this address is reachable from the network', fix: 'Serve HTTPS (see Plain HTTP).' }
      : { name: 'Console cookie', level: 'warn', message: 'not observed (no sign-in was made): over plain HTTP on this computer only the console cookie is built to be HttpOnly and SameSite=Strict, without Secure', fix: 'To see it, sign in to the console in a browser and look at the cookie in its developer tools.' });

  // The server's own idea of its address, from its public discovery answer.
  const meta = await probes.ask(at('/.well-known/oauth-protected-resource'));
  let issuer: string | undefined;
  try { issuer = (JSON.parse(meta?.body ?? '') as { authorization_servers?: string[] }).authorization_servers?.[0]; } catch { /* no answer */ }
  const publicUrl = option(extra, '--public-url');
  if (issuer) {
    const wrong = new URL(issuer).origin !== base.origin;
    checks.push(wrong && !publicUrl
      ? { name: 'Public URL', level: 'warn', message: `the links the server makes (sign-in for AI apps, shared links) say ${issuer}, not ${base.origin}, and no --public-url is set`, fix: `Start the server with --public-url ${base.origin}, so the links it hands out use the address people type.` }
      : { name: 'Public URL', level: 'ok', message: `links the server makes use ${issuer}${publicUrl ? ' (--public-url)' : ''}` });
  }

  // The console: its page is public, the API behind it is not.
  const info = await probes.ask(at('/tabularius/admin/v1/sign-in-info'));
  let passwordSet: boolean | undefined;
  try { passwordSet = (JSON.parse(info?.body ?? '') as { passwordSet?: boolean }).passwordSet; } catch { /* no answer */ }
  const status = await probes.ask(at('/tabularius/admin/v1/status'));
  const statusSaid = status ? `answered ${status.status}` : 'did not answer';
  if (status?.status === 200 && passwordSet === true) {
    checks.push({ name: 'Admin console', level: 'problem', message: 'the console answers its status without a sign-in although an admin password is set', fix: 'This is a fault: report it as a vulnerability (SECURITY.md) and put a firewall in front until it is fixed.' });
  } else if (status?.status === 200 && passwordSet === undefined) {
    checks.push({ name: 'Admin console', level: 'warn', message: 'the console answers its status without a sign-in, and its sign-in page did not say whether an admin password is set', fix: 'Set an admin password if there is none: tabularius admin-password <folder>' });
  } else if (passwordSet === false) {
    checks.push({ name: 'Admin console', level: beyond ? 'problem' : 'warn', message: `no admin password is set, so the console is open to whoever can use this computer${beyond ? ', and the server is reachable from the network' : ''}`, fix: 'Set one: tabularius admin-password <folder>' });
  } else if (status?.status === 401) {
    checks.push({ name: 'Admin console', level: beyond ? 'warn' : 'ok', message: beyond ? `the console page and its sign-in are reachable from the network (its API answered 401 without a sign-in)` : 'the console is reachable from this computer only; its API answered 401 without a sign-in', ...(beyond ? { fix: 'If administrators work from one place, firewall the port to them, or serve on loopback and reach the console through a proxy or an SSH tunnel.' } : {}) });
  } else {
    checks.push({ name: 'Admin console', level: 'warn', message: `could not confirm that the console API needs a sign-in: its status ${statusSaid} (expected 401)`, fix: 'Check the server is the one you meant (--url), and that nothing in front of it rewrites the answer.' });
  }

  // MCP: an AI app needs a token; a server that answers an unsigned request is open.
  const mcp = await probes.ask(at('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tabularius-doctor', version: '0' } } }) });
  if (mcp && mcp.status >= 200 && mcp.status < 300) {
    checks.push({ name: 'MCP', level: 'problem', message: 'the AI connector answers a request that carries no token', fix: 'Start the server with an MCP token (tabularius mcp-token <folder> prints it), or turn the connector off.' });
  } else if (mcp?.status === 401 || mcp?.status === 403) {
    checks.push({ name: 'MCP', level: 'ok', message: `the AI connector refuses a request with no token (${mcp.status})` });
  } else if (mcp?.status === 404) {
    checks.push({ name: 'MCP', level: 'ok', message: 'the AI connector is not served here (404)' });
  } else {
    checks.push({ name: 'MCP', level: 'warn', message: mcp ? `the AI connector answered ${mcp.status} to a request with no token, so whether it needs one was not checked` : 'the AI connector did not answer, so whether it needs a token was not checked', fix: 'If AI apps use this server, check /mcp answers (a proxy in front may be dropping it) and run this again.' });
  }

  // The PostgreSQL port: only where one was named (by --sql-port or the installed service). It is tried where the server is:
  // on this computer, loopback and every address of it (done above); on another computer, that host.
  if (sqlPort) {
    const here = local ? ['127.0.0.1', '::1'] : [host];
    const opened: string[] = [];
    for (const address of here) if (await probes.open(address, sqlPort)) opened.push(address);
    const network = local ? exposedTo.filter((a) => a.endsWith(`:${sqlPort}`)).map((a) => a.replace(/^\[?(.*?)\]?:\d+$/, '$1')) : opened;
    const tried = [...here, ...(local ? probes.addresses() : [])].map(brackets).join(', ');
    if (!opened.length && !network.length) checks.push({ name: 'SQL port', level: 'ok', message: `nothing accepted a connection on port ${sqlPort} at ${tried}` });
    else {
      const asked = await probes.sslAnswer((network[0] ?? opened[0])!, sqlPort);
      const plain = asked === 'N';
      checks.push(network.length
        ? { name: 'SQL port', level: plain ? 'problem' : 'warn', message: `the SQL port ${sqlPort} accepts connections from the network (${network.map(brackets).join(', ')})${plain ? ' and offers no TLS, so a password is sent unencrypted' : asked === undefined ? ' (whether it offers TLS was not checked)' : ''}`, fix: plain ? 'Serve HTTPS (--https or --tls-cert), which the SQL port uses too, or keep the port on loopback (--host 127.0.0.1) and reach it through an SSH tunnel.' : 'Firewall the port to the machines that need it.' }
        : { name: 'SQL port', level: 'ok', message: `the SQL port ${sqlPort} is on this computer only${plain ? ' (plain, which is fine there)' : ''}` });
    }
  } else {
    checks.push({ name: 'SQL port', level: 'warn', message: 'not checked: no SQL port was named (--sql-port) and none is in the installed service\'s options', fix: 'If the server was started with a SQL port, run this again with --sql-port <port>.' });
  }

  // Proxies: the service's --trusted-proxies, else TABULARIUS_TRUSTED_PROXIES, as the server reads them at start.
  const env = opts.env ?? process.env;
  const flagged = option(extra, '--trusted-proxies');
  const proxies = flagged ?? env.TABULARIUS_TRUSTED_PROXIES;
  const from = flagged !== undefined ? '--trusted-proxies' : opts.service ? 'TABULARIUS_TRUSTED_PROXIES in this command\'s environment, not the service\'s' : 'TABULARIUS_TRUSTED_PROXIES in this command\'s environment';
  if (proxies?.trim()) {
    const list = proxies.split(',').map((v) => v.trim()).filter(Boolean);
    const wide = list.filter((v) => /\/0+$/.test(v));
    checks.push(wide.length
      ? { name: 'Trusted proxies', level: 'problem', message: `${from} includes ${wide.join(', ')}, which trusts every address of that kind to say who a client is`, fix: 'Name the proxy\'s own address (a single address or a small range).' }
      : { name: 'Trusted proxies', level: 'ok', message: `forwarded client addresses are believed from ${list.join(', ')} only (${from})` });
  } else if (opts.service) {
    checks.push({ name: 'Trusted proxies', level: 'ok', message: 'none in the installed service\'s options: X-Forwarded-* headers are believed from this computer only' });
  } else {
    checks.push({ name: 'Trusted proxies', level: 'warn', message: 'not checked: only a server installed as a service shows its options, and TABULARIUS_TRUSTED_PROXIES is not set here', fix: 'Look for --trusted-proxies in the command that starts the server; a range ending in /0 trusts every address.' });
  }
  return checks;
}
