// Reproducible r25-08 inventory. Reads route definitions only; never opens hosted data.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { groups as data } from './reference/rest/dataapi.ts';
import { groups as web } from './reference/rest/webclient.ts';
import { groups as design } from './reference/rest/design.ts';
import { groups as features } from './reference/rest/features.ts';
import { groups as admin } from './reference/rest/admin.ts';
import { groups as server } from './reference/rest/server.ts';

export const routeGroups = [...data, ...web, ...design, ...features, ...admin, ...server];
export const routes = routeGroups.flatMap((group) => group.routes.flatMap((route) =>
  route.method.split(/,\s*/).map((method) => ({ group: group.id, method, path: route.path }))));

/** Credential category, with reasons and exceptions detailed in the companion audit. */
export function policy(group: string, path: string, method: string): string {
  if (path.startsWith('/tabularius/admin/')) return 'A: console origin + auth; mutation header';
  if (path === '/fmi/admin/api/v2/user/auth') return 'A: origin + Basic';
  if (group === 'admin-api' || group === 'replication' || group === 'scim') return 'B: explicit bearer; no cookie';
  if (group === 'mcp') return 'M: MCP origin allow-list + auth/local Host';
  if (group === 'oidc') return 'O: public discovery / OIDC state + PKCE';
  if (group === 'inbound-hooks') return 'H: explicit webhook secret/signature';
  if (path.startsWith('/tabularius/images/') || path.startsWith('/tabularius/containers/')) return 'U: signed URL capability';
  if (group === 'calendar') return path.endsWith('calendar.ics') ? 'B/U: header token or scoped feed token' : 'B: explicit file token';
  if (group === 'odata' || group === 'sql' || group === 'cwp-xml') return 'A/B: Basic origin check / explicit token';
  if (group === 'data-api-sessions') {
    if (method === 'POST' && /\/sessions(?:\/|$)/.test(path)) return 'A: origin + password/assertion/recovery proof';
    if (method === 'DELETE' && path.endsWith('/{sessionToken}')) return 'U: token in path; origin checked';
    return 'B: explicit file token';
  }
  if (group === 'data-api-metadata') return path.includes('/{database}/') ? 'B: explicit file token' : 'P: public metadata / optional file list';
  if (group === 'server' || group === 'local-tls' || group === 'acme' || path === '/admin/' ||
      path === '/favicon.ico' || path.startsWith('/fmi/webd/') || path.startsWith('/app') || path === '/next' || path === '/next/') return 'P: public shell/static/discovery';
  return 'B: explicit file token; no cookie';
}

const supplements = [
  ['GET', '/.well-known/oauth-protected-resource', 'P: credentialless wildcard CORS discovery'],
  ['GET', '/.well-known/oauth-protected-resource/mcp', 'P: credentialless wildcard CORS discovery'],
  ['GET', '/.well-known/oauth-authorization-server', 'P: credentialless wildcard CORS discovery'],
  ['GET', '/.well-known/oauth-authorization-server/mcp', 'P: credentialless wildcard CORS discovery'],
  ['POST', '/oauth/register', 'O: public client registration; no cookie authority'],
  ['GET', '/oauth/authorize', 'O: sign-in page / OIDC initiation; no ambient account grant'],
  ['POST', '/oauth/authorize', 'A/O: same-origin + explicit account proof + PKCE binding'],
  ['POST', '/oauth/token', 'O: code + verifier or refresh token; no cookie authority'],
  ['POST', '/oauth/revoke', 'O: possession of token; no cookie authority'],
  ['OPTIONS', '/oauth/* and /.well-known/oauth-*', 'P: wildcard; GET, POST; content-type, authorization; max-age 600; no credentials'],
  ['GET', '/mcp', 'M: authenticated SSE transport; no cookie authority'],
  ['DELETE', '/mcp', 'M: transport operation; same origin/auth gates as POST'],
  ['OPTIONS', '/mcp', 'M: same origin/auth gates; no CORS grant'],
];

export function inventoryMarkdown(): string {
  const nonGet = routes.filter((r) => r.method !== 'GET' && r.method !== 'HEAD').length;
  const reads = routes.length - nonGet;
  const out = [
    '# r25-08 cross-origin route inventory', '',
    'Generated with `node scripts/audit-cross-origin.ts` from the six modules in `scripts/reference/rest/`. Check with `--check`.', '',
    `Route-table entries after splitting methods: **${routes.length}** (${nonGet} non-GET/HEAD; ${reads} GET/HEAD). All reads are included so data-bearing and stateful GETs cannot disappear behind a method-only filter.`, '',
    'Categories and exemption reasons: [audit](r25-08-csrf-cors-matrix.md). A is an ambient-credential origin guard; B is a bearer/header-token exemption from CSRF checks, never from authorization; U is an explicit URL capability; M is MCP; O is OAuth/OIDC; P is public; H is a webhook secret.', '',
    'The route table groups some action alternatives into a placeholder. Those handlers are reviewed as a family. Parameter substitutions in the harness are synthetic. These rows are an inventory, not a claim that every success path was exercised.', '',
  ];
  for (const group of routeGroups) {
    out.push(`## ${group.id}`, '', `Handler: ${group.sources.map((s) => '`packages/server/src/' + s + '`').join(', ')}.`, '',
      '| Method | Route | Credential / invariant |', '| --- | --- | --- |');
    for (const r of routes.filter((r) => r.group === group.id)) out.push(`| ${r.method} | \`${r.path}\` | ${policy(r.group, r.path, r.method)} |${/unverified/i.test(r.path) ? ' <!-- known-difference-ok: the route name contains the word -->' : ''}`);
    out.push('');
  }
  out.push('## Source supplements', '',
    'OAuthServer.handle and MCP transport methods are not fully represented by the route table. These additional entries were read directly from `oauth.ts` and `index.ts`. The OAuth discovery handler also answers non-OPTIONS methods with the same public metadata; they do not change account state. Unsupported methods on other routes are denied or return public/static responses.', '',
    '| Method | Route | Credential / invariant |', '| --- | --- | --- |',
    ...supplements.map(([method, path, invariant]) => `| ${method} | \`${path}\` | ${invariant} |`), '',
    'Legacy `/openhbam/` aliases are canonicalized by `legacy-request.ts` before the shared origin guard; they are not independent exemptions. HTTP upgrades (including WebSocket) and CONNECT receive 400 in `edge-limits.ts`.', '');
  return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = new URL('../docs/audits/r25-08-cross-origin-routes.md', import.meta.url);
  const text = inventoryMarkdown();
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== text) throw new Error('Cross-origin route inventory is stale');
    console.log('Cross-origin route inventory: up to date');
  } else {
    writeFileSync(target, text);
    console.log(`Wrote inventory: ${routes.length} route-table method/path entries`);
  }
}
