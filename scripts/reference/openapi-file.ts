// Where the generated OpenAPI description lives and what it is built from.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOpenApi, type Contract } from './openapi.ts';
import { REST_GROUPS } from './render.ts';

const server = join(import.meta.dirname, '..', '..', 'packages', 'server');
export const OPENAPI_FILE = join(server, 'src', 'data-api.openapi.json');
export const CONTRACT_FILE = join(server, 'test', 'dataapi-response-contract.json');

export function openApiText(): string {
  return renderOpenApi(REST_GROUPS, JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract);
}
