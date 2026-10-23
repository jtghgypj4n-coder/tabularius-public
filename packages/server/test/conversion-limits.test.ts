import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadConversionLimits } from '../src/conversion-limits.ts';

test('upload conversion memory always has a positive decimal cap', (t) => {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  for (const value of ['0', '', 'abc', '1e3', '0x200', '-1', '1.5', ' ', 'Infinity', '9007199254740992', '512', undefined]) {
    const before = warnings.length;
    const memoryMb = value === '512' ? 512 : 2048;
    assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_MEMORY: value }).memoryMb, memoryMb, JSON.stringify(value));
    assert.equal(warnings.length - before, value === undefined || value === '512' ? 0 : 1);
    if (warnings.length > before) assert.match(warnings.at(-1)!, /TABULARIUS_CONVERT_MEMORY.*2048/);
  }
});

test('conversion timeout retains its documented zero meaning', () => {
  assert.equal(uploadConversionLimits({}).timeoutMs, 900_000);
  assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_TIMEOUT: '0' }).timeoutMs, 0);
  assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_TIMEOUT: '12' }).timeoutMs, 12_000);
});
