// The messages people see say what to try, not just what failed: the bare FileMaker wording keeps its place
// (clients match on it) and advice follows. A code with no meaning, or a bare message with no advice, fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMeaning, plainMessage } from '../../store/src/index.ts';
import { ApiError } from '../src/dataapi.ts';

const src = join(import.meta.dirname, '..', 'src');
// The bare messages that say nothing about what to do next.
const BARE = new Set(['Command is unavailable', 'Not supported', 'Unable to open file', 'No such script', 'Invalid JSON', 'Request body too large', 'Invalid FileMaker Data API token (*)']);

test('every error the server raises has a meaning, and the bare messages carry advice', () => {
  const found: { file: string; code: number; message: string; status?: number }[] = [];
  for (const f of readdirSync(src).filter((x) => x.endsWith('.ts'))) {
    const text = readFileSync(join(src, f), 'utf8');
    for (const m of text.matchAll(/new ApiError\((\d+),\s*'((?:[^'\\]|\\.)*)'(?:,\s*(\d+))?/g)) {
      found.push({ file: f, code: Number(m[1]), message: m[2].replace(/\\'/g, "'"), status: m[3] ? Number(m[3]) : undefined });
    }
  }
  assert.ok(found.length > 100, 'the scan sees the server\'s errors');
  const unknown = found.filter((e) => errorMeaning(e.code) === undefined);
  assert.deepEqual(unknown, [], 'codes with no meaning in packages/store/src/error-codes.ts');
  const bare = found.filter((e) => BARE.has(e.message) && plainMessage(e.code, e.message, e.status ?? 500) === e.message);
  assert.deepEqual(bare, [], 'bare messages with no advice: add them to HINTS in packages/store/src/error-codes.ts');
});

test('the advice follows the wording clients match on', () => {
  const e = new ApiError(802, 'Unable to open file', 404);
  assert.match(e.message, /^Unable to open file \(.*\/databases/);
  assert.equal(new ApiError(3, 'Command is unavailable', 405).message.startsWith('Command is unavailable ('), true);
  assert.notEqual(new ApiError(3, 'Command is unavailable', 404).message, new ApiError(3, 'Command is unavailable', 405).message, 'by status');
  assert.equal(new ApiError(802, 'Unable to open file: Sales', 404).message, 'Unable to open file: Sales', 'a message with detail is left alone');
});
