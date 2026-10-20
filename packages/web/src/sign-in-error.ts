// What the sign-in screen says for a wrong password: error 212 covers both a wrong password and a lockout (too many
// of them from this browser), and the two need different words — a lockout should say so, with when it lifts,
// rather than the generic "the account name or password is wrong" that just invites retrying it. Pulled out of
// main.ts so this parsing has a test of its own without pulling in the whole DOM-wired module.

/**
 * The sign-in screen's message for a code-212 failure, from the server's own error text (which already says
 * "Too many failed sign-ins; try again after <ISO time>" for a lockout — see Store.verify/verifyAsync — and
 * something else otherwise). Revealing the lockout and its unlock time is no more than the Data API, the AI-app
 * sign-in and the Postgres and SQL endpoints already do, and it says the same whether or not the account exists
 * (lockout tracking doesn't distinguish them either), so it gives nothing away about which account names are real.
 */
export function signInError212(serverMessage: string): string {
  const until = /try again after (\S+)/.exec(serverMessage)?.[1];
  return until
    ? `Too many tries; wait until ${new Date(until).toLocaleTimeString()} and try again.`
    : 'The account name or password is wrong. Passwords are set with "tabularius passwd".';
}
