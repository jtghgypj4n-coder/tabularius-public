import { positiveWholeNumber } from './setting-values.ts';

/** Limits applied to conversion workers for uploaded files. The memory cap cannot be disabled. */
export function uploadConversionLimits(env: NodeJS.ProcessEnv = process.env) {
  let memoryMb = 2048;
  try { memoryMb = positiveWholeNumber('TABULARIUS_CONVERT_MEMORY', env.TABULARIUS_CONVERT_MEMORY, memoryMb); }
  catch (e) { console.warn(`Warning: ${(e as Error).message}; using 2048 MB`); }
  return {
    memoryMb,
    // Preserve the documented timeout semantics, including 0 for no timeout.
    timeoutMs: Math.max(0, Math.trunc(Number(env.TABULARIUS_CONVERT_TIMEOUT ?? 900)) || 0) * 1000,
  };
}
