// Where the AI assistant's Anthropic API key comes from: ANTHROPIC_API_KEY, else a file only its owner can read
// (default ~/.openhbam/anthropic-key). A service has no shell to export a variable from, so the file is how a
// boot service gets its key, and the server reads it again when it changes. A key made outside a workspace also
// needs the workspace id: --ai-workspace-id, or the file `anthropic-workspace-id` beside the key file.
// The key is never printed: errors name the file, not its contents.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AiKey {
  apiKey: string;
  source: 'environment' | 'file';
  /** The key file, when the key came from it (read again when it changes). */
  keyFile?: string;
  workspaceId?: string;
  /** Where a workspace id may be saved, beside the key file. */
  workspaceFile: string;
}

export const defaultKeyFile = () => join(process.env.TABULARIUS_HOME ?? join(homedir(), '.openhbam'), 'anthropic-key');

/** The key to use, or throws saying what to fix. `file` is an explicit path (an error if it is missing). */
export function resolveAiKey(env: NodeJS.ProcessEnv, file?: string, workspaceId?: string): AiKey {
  if (workspaceId !== undefined && !/^wrkspc_[A-Za-z0-9_-]+$/.test(workspaceId)) {
    throw new Error('serve: --ai-workspace-id looks like wrkspc_… (find it in the Console under Settings > Workspaces)');
  }
  const path = file ?? defaultKeyFile();
  const workspace = { workspaceFile: join(dirname(path), 'anthropic-workspace-id'), ...(workspaceId ? { workspaceId } : {}) };
  if (env.ANTHROPIC_API_KEY) return { apiKey: env.ANTHROPIC_API_KEY, source: 'environment', ...workspace };
  if (!existsSync(path)) {
    throw new Error(file
      ? `serve: --ai-key-file ${path} does not exist`
      : `serve: --ai needs an Anthropic API key: put it in ${path} (chmod 600) or set ANTHROPIC_API_KEY`);
  }
  // Group- or world-readable means other users on this computer could read the key.
  if (process.platform !== 'win32' && statSync(path).mode & 0o077) {
    throw new Error(`serve: ${path} can be read by other users; run: chmod 600 ${path}`);
  }
  const apiKey = readFileSync(path, 'utf8').trim();
  if (!apiKey) throw new Error(`serve: ${path} is empty`);
  return { apiKey, source: 'file', keyFile: path, ...workspace };
}
