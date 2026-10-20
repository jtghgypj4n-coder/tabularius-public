// Connections, as a script sees them: Insert from URL with an address like connection://invoices/2026/a.pdf goes
// to the connection named "invoices" (set up in the admin console), which adds the credentials itself. The script
// never has them: the server signs the request and hands back only the answer.
//
//   Insert from URL [ Files::Scan ; "connection://invoices/2026/a.pdf" ]                       fetches the object into a container
//   Insert from URL [ $r ; "connection://invoices/2026/a.pdf" ; cURL options: "-X PUT --data-binary @$file" ]   stores a container
//   Insert from URL [ $list ; "connection://invoices/?list-type=2&prefix=2026/" ]               lists a folder (S3's XML)
//
// Like every outbound step it works only where scripts may use the network, never for a capture-only file (a
// capture-only), and in outbound test mode it is recorded and reaches only allowlisted hosts.

export interface ConnectionRequest {
  method: string;
  /** What follows the connection's name in the address, starting with "/" (or empty). */
  path: string;
  /** The query string with its "?" (or empty). */
  query: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  /** Aborted when the script's time limit (-m) runs out: the request must stop, not finish unseen. */
  signal?: AbortSignal;
}

export interface ScriptConnections {
  /** The host a request to this connection reaches, when there is such a connection that is on: test mode's allowlist is checked against it. */
  host(name: string): string | undefined;
  /**
   * Makes the request through the connection, with its credentials, and answers with the service's response. `files`
   * are the hosted files the script run involves (its call stack), which the connection may refuse. Throws with a
   * reason that never contains a credential.
   */
  request(name: string, req: ConnectionRequest, files: readonly string[]): Promise<Response>;
}

/** The connection address a script gave, taken apart; undefined when it isn't one. */
export function parseConnectionUrl(url: string): { name: string; path: string; query: string } | undefined {
  const m = /^connection:\/\/([A-Za-z][A-Za-z0-9_-]{0,39})(\/[^?#]*)?(\?[^#]*)?$/.exec(url.trim());
  if (!m) return undefined;
  return { name: m[1], path: m[2] ?? '', query: m[3] ?? '' };
}
