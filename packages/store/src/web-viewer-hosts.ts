// The web hosts a file's web viewers may load. A host is a name like "maps.example.com" or "*.example.com" (any
// subdomain, not the bare domain); the address always starts https:// and uses the default port. Written the way
// a content security policy writes a source, so the list goes into the policy as it is.
import { StoreError } from './errors.ts';

export const WEB_VIEWER_HOSTS_MAX = 50;

// Names under which anyone can register a site of their own, so a wildcard on one allows every stranger's page. The
// country-code registries that sell names a level down (co.uk, com.au, ...) are matched by shape below; these are the
// rest: hosting platforms people publish pages on, and the shared domains of cloud storage. Not the full public suffix
// list (a dependency this package does not take), so a wildcard is still only as safe as the name the person picks.
const SHARED_SUFFIXES = new Set([
  'github.io', 'gitlab.io', 'bitbucket.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com',
  'blogspot.com', 'wordpress.com', 'azurewebsites.net', 'azurestaticapps.net', 'cloudapp.azure.com', 'cloudfront.net', 'amazonaws.com', 's3.amazonaws.com', 'elasticbeanstalk.com',
  'onrender.com', 'fly.dev', 'glitch.me', 'repl.co', 'surge.sh', 'myshopify.com', 'wixsite.com', 'weebly.com', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'run.app',
  'blob.core.windows.net', 'web.core.windows.net', 'file.core.windows.net', 'queue.core.windows.net', 'table.core.windows.net', 'dfs.core.windows.net', 'storage.googleapis.com',
  'firebaseio.com', 'amplifyapp.com', 'azureedge.net', 'sharepoint.com', 'railway.app', 'up.railway.app', 'ondigitalocean.app',
  'githubusercontent.com', 'googleusercontent.com', 'r2.dev', 'deno.dev', 'notion.site', 'webflow.io', 'readthedocs.io', 'duckdns.org', 'ddns.net',
]);
const REGISTRY_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'ne', 'or', 'go', 'mil', 'ltd', 'plc', 'sch']);

/** Whether a name is one under which many unrelated sites live (a country registry's co.uk, a hosting platform's github.io). */
function isPublicSuffix(labels: string[]): boolean {
  const name = labels.join('.');
  if (SHARED_SUFFIXES.has(name)) return true;
  // Every blog on a blog service has its own name under it, in each country's flavour (blogspot.com, blogspot.co.uk, ...).
  if (labels[0] === 'blogspot') return true;
  // Names under amazonaws.com (or its China twin) are the cloud's service names (s3, compute, regional endpoints): a wildcard over one allows every
  // customer's. Service and region is two labels (s3.us-east-1) and a bucket's own name is a label more; the dual-stack and FIPS endpoints add a label
  // of their own, so they are told by it.
  const aws = name.endsWith('.amazonaws.com') ? 2 : name.endsWith('.amazonaws.com.cn') ? 3 : 0;
  if (aws && (labels.length - aws <= 2 || labels.some((l) => l === 'dualstack' || l.endsWith('-fips') || l === 'fips') && labels.length - aws <= 3)) return true;
  return labels.length === 2 && labels[1].length === 2 && REGISTRY_LEVEL.has(labels[0]);
}

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
  if (wild && isPublicSuffix(labels)) {
    throw new StoreError(960, `"${input.trim()}" is a public suffix, so it would allow every site under it: list a name below it, like *.example.${labels.join('.')}`);
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

/** The most stored entries looked at, and the most dropped ones named: a restored file can hold any number, and each read is on a page's way. */
const STORED_LOOKED_AT_MAX = 1000;
const DROPPED_NAMED_MAX = 50;

/** The stored list sorted into what can be trusted and what cannot: a value written by anything but setWebViewerHosts (a restored or foreign file) is dropped unless it passes the same checks. */
export function checkStoredWebViewerHosts(stored: unknown): { hosts: string[]; dropped: string[] } {
  const hosts: string[] = [];
  const dropped: string[] = [];
  if (!Array.isArray(stored)) return { hosts, dropped };
  const looked = stored.length > STORED_LOOKED_AT_MAX ? stored.slice(0, STORED_LOOKED_AT_MAX) : stored;
  for (const v of looked) {
    try {
      const host = normalizeWebViewerHost(v);
      if (host === v) { if (!hosts.includes(host)) hosts.push(host); continue; }
    } catch { /* dropped */ }
    // Shown to an administrator, so plainly and shortly whatever the file held.
    dropped.push(String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/[^\x20-\x7e]/g, '?').slice(0, 100));
  }
  // Only so many can be listed; the rest are dropped too.
  dropped.push(...hosts.slice(WEB_VIEWER_HOSTS_MAX));
  const unlisted = Math.max(0, dropped.length - DROPPED_NAMED_MAX) + (stored.length - looked.length);
  const named = dropped.slice(0, DROPPED_NAMED_MAX);
  if (unlisted > 0) named.push(`… and ${unlisted} more ${unlisted === 1 ? 'entry' : 'entries'} not listed`);
  return { hosts: hosts.slice(0, WEB_VIEWER_HOSTS_MAX), dropped: named };
}

/** The stored list as it can be trusted. */
export function trustedWebViewerHosts(stored: unknown): string[] {
  return checkStoredWebViewerHosts(stored).hosts;
}

/** The stored entries that are not trusted, written plainly, for the console to name. */
export function droppedWebViewerHosts(stored: unknown): string[] {
  return checkStoredWebViewerHosts(stored).dropped;
}

/** Whether a listed entry (a stored host or `*.` wildcard) would let a web viewer load a page of the host name `name`. */
export function webViewerEntryCovers(entry: string, name: string): boolean {
  const e = entry.trim().toLowerCase();
  const n = name.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!e || !n) return false;
  return e === n || (e.startsWith('*.') && n.endsWith(e.slice(1)));
}
