/** Wall-clock expiries survive restarts; elapsed durations must use performance.now() instead. */
export class ExpiryClock {
  private readonly wall: number;
  private readonly monotonic: number;
  private warned = false;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly warn: (message: string) => void;

  constructor(
    wallNow: () => number = () => Date.now(),
    monotonicNow: () => number = () => performance.now(),
    warn: (message: string) => void = (message) => console.warn(message),
  ) {
    this.wallNow = wallNow;
    this.monotonicNow = monotonicNow;
    this.warn = warn;
    this.monotonic = monotonicNow();
    this.wall = wallNow();
  }

  /**
   * Epoch milliseconds, never earlier than the startup wall reference plus elapsed
   * time. Forward jumps apply only while present: correcting one does not ratchet
   * the floor. Backward jumps cannot extend the startup-projected deadline.
   */
  now(): number {
    const monotonic = this.monotonicNow();
    const wall = this.wallNow();
    const expected = this.wall + Math.max(0, monotonic - this.monotonic);
    if (expected - wall > 5 * 60_000 && !this.warned) {
      this.warned = true;
      this.warn('Warning: system wall clock moved backwards by more than five minutes; absolute credential expiries use the monotonic-projected wall clock until it catches up.');
    }
    return Math.max(wall, expected);
  }
}

// Capture the reference at process/module startup, before the first credential check.
export const expiryClock = new ExpiryClock();
