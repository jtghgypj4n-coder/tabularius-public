/**
 * Named process-exit boundaries. Production calls the same empty function:
 * no environment lookup, allocation, counter, or I/O on the unarmed path.
 * Tests arm only their disposable child, after preparing its input; arming is refused when NODE_ENV is production.
 */
export let crashPoint: (name: string) => void = () => {};

/** Exit without unwinding finally blocks; occurrence exercises later loop iterations. */
export function armCrashPointForTest(name: string, occurrence = 1): void {
  if (process.env.NODE_ENV === 'production') throw new Error('Crash checkpoints cannot be armed in production');
  if (!name || !Number.isSafeInteger(occurrence) || occurrence < 1) throw new Error('Invalid crash checkpoint');
  crashPoint = (point) => {
    if (point === name && --occurrence === 0) process.exit(73);
  };
}
