// Where a record change came from, for the audit log, read from the route that carried it. The Data API's session
// refines "rest" to "web" for the web client (it signs in saying so).

const ROUTES: [prefix: string, surface: string][] = [
  ['/fmi/data/', 'rest'],
  ['/fmi/odata/', 'odata'],
  ['/tabularius/sql/', 'sql'],
  ['/mcp', 'mcp'],
  ['/tabularius/admin/', 'admin'],
  ['/fmi/admin/', 'admin'],
  ['/tabularius/cleanup/', 'cleanup'],
  ['/tabularius/agent/', 'agent'],
  ['/tabularius/assistant/', 'assistant'],
  ['/tabularius/hooks/', 'hook'],
  ['/tabularius/design/', 'design'],
  ['/tabularius/debug/', 'debug'],
];

/** The audit-log surface for a request path, or undefined when the route doesn't change records. */
export function auditSurface(pathname: string): string | undefined {
  return ROUTES.find(([prefix]) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix))?.[1];
}
