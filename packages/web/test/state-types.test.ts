import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ActiveState, AppSession, FileSession, FoundSetState, RecordEditState, ScriptRunState, ViewMode, WindowState } from '../src/state/types.ts';

// Keep the model's exported shapes referenced at compile time while checking that it remains runtime-independent.
const stateTypes: (AppSession | FileSession | FoundSetState | RecordEditState | ScriptRunState | ViewMode | WindowState | ActiveState)[] = [];
void stateTypes;

test('state model has no DOM globals or runtime imports', async () => {
  const source = await readFile(new URL('../src/state/types.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /\b(?:document|window|HTMLElement)\b/);
  const imports = code.match(/^\s*import\b[^\n]*/gm) ?? [];
  assert.ok(imports.every((line) => /^\s*import\s+type\b/.test(line)), imports.join('\n'));
});
