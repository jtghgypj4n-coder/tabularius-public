import { CONVERT_MEMORY_MIN_MB, wholeNumber } from '../../store/src/settings.ts';

/**
 * Guards for converting an untrusted upload (not a file the operator dropped into the folder): the worker's heap is
 * capped so a file that expands to huge memory out-of-memories the worker rather than the server, and the conversion is
 * stopped after a time budget so a file that makes the reader loop can't block the single conversion slot for good.
 * Generous defaults; raise them with TABULARIUS_CONVERT_MEMORY (MB, 64 or more: the heap is always capped) and
 * TABULARIUS_CONVERT_TIMEOUT (seconds, 0 = none) for an environment that hosts genuinely large uploads.
 * A value that is not a whole number written in digits is refused, naming the variable (checkServeSettings reports it at start).
 */
export function uploadConversionLimits(env: NodeJS.ProcessEnv = process.env): { memoryMb: number; timeoutMs: number } {
  return {
    memoryMb: wholeNumber('TABULARIUS_CONVERT_MEMORY', { min: CONVERT_MEMORY_MIN_MB, env }) ?? 2048,
    timeoutMs: (wholeNumber('TABULARIUS_CONVERT_TIMEOUT', { env }) ?? 900) * 1000,
  };
}
