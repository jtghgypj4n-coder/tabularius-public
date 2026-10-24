import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadConversionLimits } from '../src/conversion-limits.ts';

test('upload conversion memory is a whole number of MB, 64 or more, and the heap is always capped', () => {
  assert.equal(uploadConversionLimits({}).memoryMb, 2048);
  assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_MEMORY: '512' }).memoryMb, 512);
  assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_MEMORY: '64' }).memoryMb, 64);
  for (const value of ['0', '63', '', ' ', 'abc', '1e3', '0x200', '-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.throws(() => uploadConversionLimits({ TABULARIUS_CONVERT_MEMORY: value }), /TABULARIUS_CONVERT_MEMORY.*whole number of 64 or more/, JSON.stringify(value));
  }
});

test('conversion timeout retains its documented zero meaning and refuses anything but digits', () => {
  assert.equal(uploadConversionLimits({}).timeoutMs, 900_000);
  assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_TIMEOUT: '0' }).timeoutMs, 0);
  assert.equal(uploadConversionLimits({ TABULARIUS_CONVERT_TIMEOUT: '12' }).timeoutMs, 12_000);
  for (const value of ['', 'abc', '1e3', '1.5', '-1']) {
    assert.throws(() => uploadConversionLimits({ TABULARIUS_CONVERT_TIMEOUT: value }), /TABULARIUS_CONVERT_TIMEOUT.*whole number.*digits only/, JSON.stringify(value));
  }
});
