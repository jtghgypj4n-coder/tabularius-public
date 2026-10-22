// The web hosts a file's web viewers may load. A host is a name like "maps.example.com" or "*.example.com" (any
// subdomain, not the bare domain); the address always starts https:// and uses the default port. Written the way
// a content security policy writes a source, so the list goes into the policy as it is.
import { StoreError } from './errors.ts';

export const WEB_VIEWER_HOSTS_MAX = 50;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The host written the one way it is kept, or a StoreError saying what is wrong with it. */
export function normalizeWebViewerHost(input: unknown): string {
  if (typeof input !== 'string') throw new StoreError(960, 'A web host should be text, like maps.example.com');
  const text = input.trim().toLowerCase();
  if (!text) throw new StoreError(960, 'A web host can\'t be empty');
  if (/[/:?#@\s]/.test(text)) throw new StoreError(960, `"${input.trim()}" should be just a host name, like maps.example.com: no https://, port, path or login`);
  const wild = text.startsWith('*.');
  const name = wild ? text.slice(2) : text;
  const labels = name.split('.');
  if (name.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l))) {
    throw new StoreError(960, `"${input.trim()}" isn't a host name Tabularius can allow: use a name with at least two parts, like maps.example.com or *.example.com`);
  }
  // Web viewers load pages in the person's browser, so addresses on a private or local network are not for an allow-list either.
  if (/^(\d+|0x[0-9a-f]*)$/.test(labels[labels.length - 1]) || labels[labels.length - 1] === 'local' || labels[labels.length - 1] === 'localhost' || labels[labels.length - 1] === 'internal') {
    throw new StoreError(960, `"${input.trim()}" is an address on a local network, or a number: allow a public host name instead`);
  }
  return text;
}

/** The list written one way each, without repeats, in order; a StoreError for anything wrong or more than WEB_VIEWER_HOSTS_MAX. */
export function normalizeWebViewerHosts(input: unknown): string[] {
  if (!Array.isArray(input)) throw new StoreError(960, 'Web viewer hosts should be a list of host names');
  const out = [...new Set(input.map(normalizeWebViewerHost))].sort();
  if (out.length > WEB_VIEWER_HOSTS_MAX) throw new StoreError(960, `At most ${WEB_VIEWER_HOSTS_MAX} web hosts can be allowed`);
  return out;
}

/** The stored list as it can be trusted: a value written by anything but setWebViewerHosts (a restored or foreign file) is dropped unless it passes the same checks. */
export function trustedWebViewerHosts(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  const out: string[] = [];
  for (const v of stored) {
    try {
      const host = normalizeWebViewerHost(v);
      if (host === v && !out.includes(host)) out.push(host);
    } catch { /* dropped */ }
  }
  return out.slice(0, WEB_VIEWER_HOSTS_MAX);
}

/** Whether a listed entry (a stored host or `*.` wildcard) would let a web viewer load a page of the host name `name`. */
export function webViewerEntryCovers(entry: string, name: string): boolean {
  const e = entry.trim().toLowerCase();
  const n = name.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!e || !n) return false;
  return e === n || (e.startsWith('*.') && n.endsWith(e.slice(1)));
}
