/** Whether a listen address is this computer only: localhost, 127.x.x.x, and the IPv6 loopback in its spellings. */
export const isLoopbackHost = (host: string): boolean =>
  /^(localhost|\[?::1\]?|\[?0{1,4}(:0{1,4}){6}:0{0,3}1\]?|\[?::ffff:127(\.\d{1,3}){3}\]?|127(\.\d{1,3}){3})$/i.test(host);

/**
 * Why a server may not listen on `host` over plain HTTP, or undefined when it may: the address is this computer only, HTTPS is on
 * (`secure`), or the operator said plain HTTP is wanted (`allowed`, a proxy elsewhere does the HTTPS).
 */
export function plainHttpRefusal(o: { host: string; secure: boolean; allowed: boolean }): string | undefined {
  if (isLoopbackHost(o.host) || o.secure || o.allowed) return undefined;
  return `it would listen on ${o.host} over plain HTTP, so passwords and sign-in tokens would cross the network unencrypted. `
    + `Use --https <your domain> (or --https local for a local network, or --tls-cert with --tls-key), or listen on this computer only with --host 127.0.0.1 and put a proxy that does HTTPS in front. `
    + `If a proxy or network you control already protects the traffic, say so with --allow-plain-http (TABULARIUS_ALLOW_PLAIN_HTTP=1).`;
}
