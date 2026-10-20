/**
 * Process-local elapsed milliseconds. Replace `now` in tests to advance all
 * in-memory leases together. Never persist this value or send it as a date.
 */
export const monotonicClock = { now: (): number => performance.now() };
