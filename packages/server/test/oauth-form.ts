/** The authorize page's sign-in form as a browser submits it: the page is fetched first, for its CSRF value and cookie. */
export async function signInForm(base: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  const { database, account, password, otp, ...query } = fields;
  void database; void account; void password; void otp;
  const page = await fetch(`${base}/oauth/authorize?${new URLSearchParams(query)}`, { redirect: 'manual', headers });
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? '';
  const cookie = page.headers.get('set-cookie')?.split(';')[0] ?? '';
  return fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { ...headers, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, csrf }),
  });
}
