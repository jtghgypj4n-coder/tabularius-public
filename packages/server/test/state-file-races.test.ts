import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerConfig } from '../src/server-config.ts';
import { McpTokens } from '../src/mcp-tokens.ts';
import { setPluginEnabled } from '../../plugins/src/admin.ts';
import { BUILTIN_PACKS } from '../../plugins/src/index.ts';

test('settings from separate instances merge against the latest file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-settings-race-'));
  try {
    new ServerConfig(dir).setBlockNewUsers(true);
    new ServerConfig(dir).setSessionIdleMinutes(31);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.openhbam-settings.json'), 'utf8')), { blockNewUsers: true, sessionIdleMinutes: 31 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MCP token creates from separate instances preserve both tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-token-race-'));
  try {
    const a = new McpTokens(dir);
    const b = new McpTokens(dir);
    a.create({ database: 'Sales', account: 'Admin' });
    b.create({ database: 'Stock', account: 'Admin' });
    assert.deepEqual(new McpTokens(dir).list().map((token) => token.database).sort(), ['Sales', 'Stock']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('built-in plugin toggles from separate calls preserve both files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabularius-plugin-race-'));
  try {
    const id = BUILTIN_PACKS[0].id;
    setPluginEnabled(dir, 'Sales', id, false);
    setPluginEnabled(dir, 'Stock', id, false);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plugins', 'builtin-off.json'), 'utf8')), { Sales: [id], Stock: [id] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
