// A value from a request body as the text it stands for. An object or a list is not text, so it is nothing at all, which the
// checks that follow then answer ("give the account") instead of naming it `[object Object]`.
export function said(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
