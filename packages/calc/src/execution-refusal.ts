// A host marks an execution refusal at its boundary. Evaluation fallbacks must
// preserve that exact error, regardless of its class or numeric code.
const executionRefusals = new WeakSet<object>();

export function markExecutionRefusal(e: object): void {
  executionRefusals.add(e);
}

export function rethrowExecutionRefusal(e: unknown): void {
  if (typeof e === 'object' && e !== null && executionRefusals.has(e)) throw e;
}
