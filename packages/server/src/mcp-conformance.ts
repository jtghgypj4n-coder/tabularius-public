// Where this server's MCP answers differ from what the specification asks for and the SDK does not do on its own.
// docs/mcp-conformance.md lists each rule with the revision and section it comes from; the cases are tested in
// test/mcp-conformance.test.ts over both transports.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** JSON-RPC "Resource not found", as the resources specification gives it (2025-06-18 and 2025-11-25, Error Handling). */
export const RESOURCE_NOT_FOUND = -32002;

type Request = { method: string; params?: unknown };
type Handler = (request: Request, extra: unknown) => Promise<unknown>;
type Internals = { _requestHandlers?: Map<string, Handler>; _registeredTools?: Record<string, unknown> };

/** Every method that returns a page of a list. */
const LISTS = new Set(['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list']);

const invalidParams = (message: string, data?: unknown) => new McpError(ErrorCode.InvalidParams, message, data);

/** A schema check's first complaint, in a line (the SDK would send the whole list as the message of an internal error). */
function firstIssue(e: unknown): string | undefined {
  const issues = (e as { issues?: { code?: string; path?: unknown[]; message?: string }[] } | null)?.issues;
  if (!(e instanceof Error) || !Array.isArray(issues) || !issues.length || typeof issues[0].code !== 'string') return undefined;
  const { path = [], message = 'is not valid' } = issues[0];
  const where = path.length ? path.join('.') : 'params';
  return `Invalid params: ${where}: ${message}`.slice(0, 300);
}

/**
 * What a JSON-RPC message must look like before the MCP layer reads it (2025-06-18 and 2025-11-25, Base Protocol,
 * Messages): "jsonrpc": "2.0"; a request has a method and an id that is a string or a number, never null; a
 * notification has a method and no id; a response has an id and either a result or an error. Returns what is wrong, if anything.
 */
export function invalidMessage(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return 'a message is a JSON object';
  const m = message as Record<string, unknown>;
  if (m.jsonrpc !== '2.0') return '"jsonrpc" must be "2.0"';
  const hasId = 'id' in m;
  if (hasId && typeof m.id !== 'string' && typeof m.id !== 'number') return '"id" must be a string or a number';
  if ('method' in m) {
    if (typeof m.method !== 'string') return '"method" must be a string';
    if ('params' in m && (m.params === null || typeof m.params !== 'object')) return '"params" must be an object or an array';
    return undefined;
  }
  if (!hasId) return 'a message needs a "method" or an "id"';
  if (!('result' in m) && !('error' in m)) return 'a response needs a "result" or an "error"';
  return undefined;
}

/**
 * Makes the server's answers follow the specification where the SDK's differ, for every request it handles:
 * - a request with params that are not an object, or that fail the schema, is Invalid params (-32602), not an
 *   internal error that dumps the schema check;
 * - a cursor on a list is Invalid params, because every list is a single page and no cursor is ever issued
 *   (2025-06-18 and 2025-11-25, Pagination);
 * - a tool the server does not have is a protocol error (-32602), not a tool result that says so (Tools, Error Handling);
 * - a resource the server does not have is -32002 with its uri (Resources, Error Handling);
 * - capabilities say what is true: this server never sends list-changed notifications, so none is advertised
 *   (Tools, Resources and Prompts, Capabilities).
 */
export function conformToSpec(server: McpServer): void {
  const inner = server as unknown as Internals & { server: Internals };
  const handlers = inner.server._requestHandlers;
  if (!(handlers instanceof Map) || typeof inner._registeredTools !== 'object') {
    throw new Error('The MCP SDK changed where it keeps its request handlers; update packages/server/src/mcp-conformance.ts');
  }
  for (const [method, handle] of [...handlers]) {
    handlers.set(method, async (request, extra) => {
      const { params } = request;
      if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) throw invalidParams('Invalid params: params must be an object');
      const p = params as Record<string, unknown> | undefined;
      if (LISTS.has(method) && p?.cursor !== undefined) throw invalidParams('Invalid params: cursor is not one this server issued (it returns each list in one page)');
      if (method === 'tools/call') {
        if (typeof p?.name !== 'string') throw invalidParams('Invalid params: name must be a string');
        if (!Object.hasOwn(inner._registeredTools!, p.name)) throw invalidParams(`Unknown tool: ${p.name}`);
      }
      let result: unknown;
      try {
        result = await handle(request, extra);
      } catch (e) {
        const issue = firstIssue(e);
        if (issue) throw invalidParams(issue);
        if (method === 'resources/read' && e instanceof McpError && e.code === ErrorCode.InvalidParams && /^MCP error -32602: Resource .* not found$/.test(e.message)) {
          throw new McpError(RESOURCE_NOT_FOUND, 'Resource not found', { uri: p?.uri });
        }
        if (method === 'resources/read' && e instanceof McpError && e.code === RESOURCE_NOT_FOUND && e.data === undefined) throw new McpError(RESOURCE_NOT_FOUND, e.message.replace(/^MCP error -?\d+: /, ''), { uri: p?.uri });
        throw e;
      }
      if (method === 'initialize') return withoutListChanged(result);
      return result;
    });
  }
}

function withoutListChanged(result: unknown): unknown {
  const capabilities = (result as { capabilities?: Record<string, unknown> } | undefined)?.capabilities;
  if (!capabilities) return result;
  const honest: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(capabilities)) {
    if (value && typeof value === 'object') {
      const { listChanged: _, ...rest } = value as Record<string, unknown>;
      honest[name] = rest;
    } else honest[name] = value;
  }
  return { ...(result as object), capabilities: honest };
}
