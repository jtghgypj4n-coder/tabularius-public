/** Whether a listen address is this computer only: localhost, 127.x.x.x, and the IPv6 loopback in its spellings. */
export const isLoopbackHost = (host: string): boolean =>
  /^(localhost|\[?::1\]?|\[?0{1,4}(:0{1,4}){6}:0{0,3}1\]?|\[?::ffff:127(\.\d{1,3}){3}\]?|127(\.\d{1,3}){3})$/i.test(host);
