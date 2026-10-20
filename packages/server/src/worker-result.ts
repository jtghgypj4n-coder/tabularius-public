import type { Worker } from 'node:worker_threads';
import { untilCanceled } from '../../scripts/src/cancellation.ts';

/** A canceled worker must be gone before its caller removes staging files or releases a slot. */
export async function workerResult<T>(worker: Worker, onMessage: (message: unknown) => T | undefined, signal: AbortSignal): Promise<T> {
  let message: (value: unknown) => void;
  let error: (reason: Error) => void;
  let exit: (code: number) => void;
  const result = new Promise<T>((resolve, reject) => {
    message = (value) => {
      try { const done = onMessage(value); if (done !== undefined) resolve(done); }
      catch (e) { reject(e); }
    };
    error = reject;
    exit = (code) => reject(new Error(`Worker stopped before returning a result (exit ${code})`));
    worker.on('message', message);
    worker.once('error', error);
    worker.once('exit', exit);
  });
  try {
    return await untilCanceled(result, signal);
  } finally {
    await worker.terminate();
    worker.removeListener('message', message!);
    worker.removeListener('error', error!);
    worker.removeListener('exit', exit!);
  }
}
