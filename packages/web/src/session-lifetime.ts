/** Owns the event listeners and recurring work of one signed-in browser session. */
export class SessionLifetime {
  private readonly controller = new AbortController();
  private readonly intervals = new Map<ReturnType<typeof setInterval>, () => void>();
  private disposed = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval> {
    const handle = setInterval(() => { if (!this.disposed) callback(); }, delay);
    if (this.disposed) {
      clearInterval(handle);
      return handle;
    }
    this.intervals.set(handle, () => clearInterval(handle));
    return handle;
  }

  clearInterval(handle: ReturnType<typeof setInterval> | undefined): void {
    if (handle === undefined) return;
    this.intervals.get(handle)?.();
    this.intervals.delete(handle);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    for (const clear of this.intervals.values()) clear();
    this.intervals.clear();
  }
}
