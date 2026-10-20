// What a person is told when the server (or something between them and it) answers with a failure that has no message of its
// own, or does not answer at all. A browser's own words for a lost connection ("Failed to fetch", "Load failed") say nothing
// about what to do, and "HTTP 502" alone only helps someone who knows what a 502 is.

/** The words the browsers use for a request that never reached the server (Chrome, Firefox, Safari, others). */
export const BROWSER_NETWORK_WORDS = /failed to fetch|networkerror|load failed|network request failed/i;

export const CANT_REACH = "Can't reach the server. Check the connection and try again.";

export function httpProblem(status: number): string {
  switch (status) {
    case 400: return 'The server did not accept that request. Reload the page and try again.';
    case 401: return 'The sign-in has ended. Sign in again.';
    case 403: return 'This account is not allowed to do that.';
    case 404: return 'The server has nothing at that address. If Tabularius was just updated, reload the page.';
    case 408: case 504: return `The server took too long to answer (HTTP ${status}). Try again.`;
    case 413: return 'That is more than the server takes in one request.';
    case 429: return 'Too many requests at once. Wait a moment and try again.';
    case 502: case 503: return `The server did not answer (HTTP ${status}). If Tabularius is behind a proxy, check that the proxy can reach it; otherwise try again in a moment.`;
    default:
      return status >= 500
        ? `The server could not do that (HTTP ${status}). The reason is in its log; try again, and tell whoever runs the server if it keeps happening.`
        : `The server refused that request (HTTP ${status}).`;
  }
}

/** An error as the sentence to show: a lost connection says what to check, anything else keeps its own text. */
export function plainMessage(e: unknown): string {
  if (e instanceof TypeError || (e instanceof Error && BROWSER_NETWORK_WORDS.test(e.message))) return CANT_REACH;
  return e instanceof Error ? e.message : String(e);
}
