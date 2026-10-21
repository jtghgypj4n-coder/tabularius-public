/** The Data API reads Basic credentials as UTF-8 on every password sign-in path. */
export function basicAuthorization(account: string, password: string): string {
  let bytes = '';
  for (const byte of new TextEncoder().encode(`${account}:${password}`)) bytes += String.fromCharCode(byte);
  return `Basic ${btoa(bytes)}`;
}
