// The shape of the hand-checked notes the reference docs are built from
// (scripts/docs-reference.ts). MCP tool names, descriptions and parameters
// come from the running code; what can't be read from it — who may call a
// route or tool, and an example — is written here, next to the code it
// describes, and the reference test holds the two together.

/** One parameter of a REST route. */
export interface RestParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  /** A short type, e.g. string, number, boolean, object, array of string. */
  type: string;
  required?: boolean;
  description: string;
}

/** An example call: the request as HTTP text, the status and the body that comes back. */
export interface RestExample {
  /** First line "METHOD /path?query", then headers, then a blank line and the body, if any. */
  request: string;
  status: number;
  /** The response body: JSON (shown pretty-printed), or a short description in parentheses for anything else. */
  response: string;
  /** Why this example cannot run against the local fixture, if applicable. */
  skipReason?: string;
}

/** One method on one path. */
export interface RestRoute {
  /** GET, POST, PUT, PATCH or DELETE; "GET, HEAD" where both are answered the same way. */
  method: string;
  /** The full path, with {placeholders} for path parameters, e.g. /fmi/data/{version}/databases/{database}/sessions. */
  path: string;
  summary: string;
  /** Who may call it: the credentials it takes and the privileges it checks. */
  permissions: string;
  params?: RestParam[];
  example: RestExample;
  notes?: string;
}

/** A group of routes handled by one part of the server. */
export interface RestGroup {
  /** A short id, used as the section anchor. */
  id: string;
  title: string;
  /** The source files (in packages/server/src) whose routes the group covers. */
  sources: string[];
  /** What the group is for, how it signs in and what every route in it has in common. */
  intro: string;
  /**
   * The route-matching expressions in the sources, verbatim, that this group
   * documents (see code-routes.ts). The reference test fails when one is
   * missing from every group, or when one here is no longer in the code.
   */
  anchors: string[];
  routes: RestRoute[];
}

/** What the code can't say about one MCP tool. */
export interface McpToolNotes {
  /** Who may call it: the identity and privileges it checks, beyond the fmmcp check every file-naming tool makes. */
  permissions: string;
  example: {
    arguments: Record<string, unknown>;
    /** The text of the result's content: usually JSON, shown pretty-printed. */
    response: string;
    /** Why this example cannot run against the local fixture, if applicable. */
    skipReason?: string;
  };
  notes?: string;
}
