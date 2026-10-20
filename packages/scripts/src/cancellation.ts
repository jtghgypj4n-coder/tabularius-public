/** A disposable signal link: no AbortSignal.any dependency on a long-lived parent. */
export function cancellationScope(parents: readonly (AbortSignal | undefined)[], timeoutMs = Infinity): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  const dispose = () => { for (const clean of cleanups.splice(0)) clean(); };
  for (const parent of parents) {
    if (!parent) continue;
    if (parent.aborted) { controller.abort(parent.reason); break; }
    const abort = () => { controller.abort(parent.reason); dispose(); };
    parent.addEventListener('abort', abort, { once: true });
    cleanups.push(() => parent.removeEventListener('abort', abort));
  }
  if (controller.signal.aborted) dispose();
  else if (Number.isFinite(timeoutMs)) {
    const timer = setTimeout(() => { controller.abort(new DOMException('The operation timed out', 'TimeoutError')); dispose(); }, Math.max(1, timeoutMs));
    timer.unref?.();
    cleanups.push(() => clearTimeout(timer));
  }
  return { signal: controller.signal, dispose };
}

/** Stop waiting without retaining a listener after either outcome. The producer owns its cleanup. */
export async function untilCanceled<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      stop = () => reject(signal.reason ?? new DOMException('Canceled', 'AbortError'));
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    })]);
  } finally {
    if (stop) signal.removeEventListener('abort', stop);
  }
}
