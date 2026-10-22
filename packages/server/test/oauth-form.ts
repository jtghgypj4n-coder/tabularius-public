import assert from 'node:assert/strict';

/**
 * The authorize page's sign-in form as a browser submits it: the page is fetched first, for its CSRF value and cookie, and the
 * form is posted with the server's own Origin. A page that is shown must carry Referrer-Policy: same-origin; with no-referrer a browser
 * posts `Origin: null`, which the same-origin guard refuses.
 */
export async function signInForm(base: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  const { database, account, password, otp, ...query } = fields;
  void database; void account; void password; void otp;
  const page = await fetch(`${base}/oauth/authorize?${new URLSearchParams(query)}`, { redirect: 'manual', headers });
  // A page the server refuses before rendering it (for example a malformed proxy address header) has no policy to check.
  if (page.status === 200) assert.equal(page.headers.get('referrer-policy'), 'same-origin', 'the sign-in page keeps its own address as the referrer');
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? '';
  const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
  return fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { origin: base, ...headers, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, csrf }),
  });
}
