/**
 * Build-failing guard: a secret (token, hash, code, challenge, nonce, password, key) is compared with sameSecret
 * (packages/store/src/same-secret.ts), never with ==, ===, !=, !==, startsWith or Buffer.equals/compare, which stop at the
 * first difference. A name-based tripwire, not taint analysis: it judges a comparison by the names in it, so a comparison
 * that is not of a secret (a cache stamp, a public checksum, a grammar token) is listed below with the reason it is safe.
 * An entry is tied to its exact file and expression text, so a new comparison fails until it is converted or reasoned.
 * Never reads fixtures or user data. `npm run check:secrets`; the test is packages/server/test/secret-primitives.test.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export interface Finding { file: string; line: number; expression: string }
export interface Allowance { file: string; expression: string; reason: string }
const reviewed: { file: string; reason: string; expressions: string[] }[] = [
  { file: "packages/calc/src/xslt.ts", reason: "These are grammar tokens of a language being parsed (a number-format picture, an OData path, a dependency expression), not credentials.", expressions: ["token === 'a'", "token === 'A'", "token === 'A'", "token === 'i'", "token === 'I'", "token === 'I'"] },
  { file: "packages/cli/src/corpus-scan.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["hash.slice(0, 12) === id.toLowerCase()"] },
  { file: "packages/fmp12/src/schema.ts", reason: "The first byte of the verifier is a public format version number, not secret material.", expressions: ["verifier[0] === 1"] },
  { file: "packages/fmp12/src/script-params.ts", reason: "Tests whether the converted script text starts a quotation; it does not compare the key with anything.", expressions: ["ai.apiKey.startsWith('\"')", "ai.apiKey.startsWith('\"')"] },
  { file: "packages/plugins/src/package.ts", reason: "SIGNATURE is the public file name of the package signature, used to list the package entries.", expressions: ["n !== SIGNATURE", "n !== SIGNATURE", "name !== SIGNATURE"] },
  { file: "packages/scripts/src/digest-auth.ts", reason: "userhash is a public HTTP Digest negotiation flag, not a password hash.", expressions: ["p.userhash?.toLowerCase() === 'true'"] },
  { file: "packages/scripts/src/redaction.ts", reason: "Redaction searches output for a known secret to hide it; it is not an authentication check and the text is the server's own.", expressions: ["folded.startsWith(secret, start)"] },
  { file: "packages/server/src/account-provisioning.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["bearer.startsWith('ohbt_')", "bearer.startsWith('ohbt_')"] },
  { file: "packages/server/src/admin.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["token.startsWith(`ohbt_${x.id}.`)"] },
  { file: "packages/server/src/assistant.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["bearer.startsWith('ohbt_')"] },
  { file: "packages/server/src/auth-cache.ts", reason: "This token is a data or security version stamp used to tell whether a cache is still current; it is not a credential and nothing remote can probe it.", expressions: ["seen.get(store) !== token"] },
  { file: "packages/server/src/calendar.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["token!.startsWith('ohbt_')", "token!.startsWith('ohbt_')"] },
  { file: "packages/server/src/calendar.ts", reason: "Only tests that the feed link carried a token at all; the token is verified separately.", expressions: ["token !== ''"] },
  { file: "packages/server/src/conversion-guide.ts", reason: "Tests whether redaction changed a guide's own text; no credential is compared.", expressions: ["redactSecrets(`${title}: ${what}`) !== `${title}: ${what}`"] },
  { file: "packages/server/src/dataapi.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["store.schemaSignature !== schema"] },
  { file: "packages/server/src/dataapi.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["s.token.startsWith('ohbt_')", "token?.startsWith('ohbt_')", "token.startsWith('ohbt_')", "token.startsWith('ohbt_')", "o.token.startsWith('ohbt_')", "session.token.startsWith('ohbt_')"] },
  { file: "packages/server/src/debug.ts", reason: "This token is a data or security version stamp used to tell whether a cache is still current; it is not a credential and nothing remote can probe it.", expressions: ["kept.token === token"] },
  { file: "packages/server/src/file-list.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["bearer?.startsWith('ohbt_')"] },
  { file: "packages/server/src/fms-sync.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["localDesignHash !== remoteDesignHash"] },
  { file: "packages/server/src/fms-sync.ts", reason: "These are Promise objects: identity elects one concurrent refresh, not secret string equality.", expressions: ["token === used"] },
  { file: "packages/server/src/index.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["bearer?.startsWith('ohbt_')", "bearer?.startsWith('ohbt_')", "bearer?.startsWith('ohm_')"] },
  { file: "packages/server/src/mcp-tokens.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["token.startsWith(PREFIX)"] },
  { file: "packages/server/src/oauth.ts", reason: "Compares an internal error string with a fixed public message.", expressions: ["error === PASSWORD_REFUSAL"] },
  { file: "packages/server/src/odata-crossjoin.ts", reason: "These are grammar tokens of a language being parsed (a number-format picture, an OData path, a dependency expression), not credentials.", expressions: ["tokens[k + 1] === '/'", "tokens[k - 1] !== '/'", "tokens[k - 1] !== '/'"] },
  { file: "packages/server/src/odata.ts", reason: "These are grammar tokens of a language being parsed (a number-format picture, an OData path, a dependency expression), not credentials.", expressions: ["tokens[i + 2] === '('", "tokens[i + 1].toLowerCase() === 'all'", "tokens[i] === '('", "tokens[i] === ')'"] },
  { file: "packages/server/src/pii.ts", reason: "A personal-data stand-in such as <PERSON_3> is a public placeholder, not a credential.", expressions: ["c.token !== `<${old.kind}_${oldId}>`"] },
  { file: "packages/server/src/scim.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["token.startsWith(TOKEN_PREFIX)"] },
  { file: "packages/server/src/sql.ts", reason: "Only a public token family prefix is read here, to choose which check runs; the secret part after it is verified separately, by a hash lookup or sameSecret.", expressions: ["bearer?.startsWith('ohbt_')"] },
  { file: "packages/server/src/containers.ts", reason: "The first bytes of an uploaded image are compared with the public PNG file signature; no secret is involved.", expressions: ["signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))"] },
  { file: "packages/store/src/webauthn.ts", reason: "rpIdHash is the SHA-256 of the site's own public name, sent by the browser in the clear; it authenticates nothing.", expressions: ["parsed.rpIdHash.equals(sha256(Buffer.from(input.rpId)))"] },
  { file: "packages/store/src/audit-anchor.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["stored !== hash"] },
  { file: "packages/store/src/calc.ts", reason: "This token is a data or security version stamp used to tell whether a cache is still current; it is not a credential and nothing remote can probe it.", expressions: ["edited.columns !== signature", "e.token === token", "shared.stamp === token", "shared.stamp === token", "v.token !== token", "v.token !== token", "at !== token", "e.token !== token", "s?.stamp === token", "v.token === before", "v.token === before", "token !== this.lookupToken", "token !== this.foundToken", "this.store.dataStamp() !== token", "kept.token === token", "s.stamp === token", "s.stamp === token", "target.dataStamp() === token", "kept.stamp !== token", "kept.token !== token", "kept.token !== token"] },
  { file: "packages/store/src/durable.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["cached?.hash === hash"] },
  { file: "packages/store/src/record-chain.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["st.genesis_hash !== genesis(chainId, String(st.created_at), Number(st.legacy_through))", "row.rprev_hash !== prev", "entryHash(chainId, position + 1, prev, row) !== row.rhash", "prev !== st.head_hash"] },
  { file: "packages/store/src/script-text.ts", reason: "Tests whether the script text starts a quotation; it does not compare the key with anything.", expressions: ["p.ai?.apiKey?.startsWith('\"')"] },
  { file: "packages/store/src/security-chain.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["hashText(row.prev_hash) !== prev", "securityEventHash(text(s.chain_id)!, row) !== hashText(row.event_hash)", "prev !== hashText(s.head_hash)"] },
  { file: "packages/store/src/store.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["actual.digest('hex') === sha256"] },
  { file: "packages/store/src/store.ts", reason: "Only the public scheme prefix of a stored hash is read, to choose how to check it; the hash itself is checked in constant time.", expressions: ["hash.startsWith('fmp12$')"] },
  { file: "packages/store/src/store.ts", reason: "Tests for a blank password (the only one an old file's verifier can hold); nothing secret is compared.", expressions: ["password !== ''"] },
  { file: "packages/store/src/store.ts", reason: "This token is a data or security version stamp used to tell whether a cache is still current; it is not a credential and nothing remote can probe it.", expressions: ["kept.token !== token", "identity?.token !== token", "hit.token === token", "previous?.token !== token"] },
  { file: "packages/store/src/text-styles.ts", reason: "An unkeyed public checksum or content digest, compared to detect change or corruption; it authenticates nothing.", expressions: ["textHash(value) !== r.hash"] },
  { file: "packages/web/src/change-relay.ts", reason: "Runs in the browser and compares the page's own session token with its stored copy; there is no remote caller to time it, and the page cannot import the server's helper.", expressions: ["m.token !== token"] },
  { file: "packages/web/src/design/main.ts", reason: "location.hash is the page's public URL fragment, not a cryptographic hash.", expressions: ["location.hash === '#modernize'", "`#scripts=${encodeURIComponent(x.name)}` === location.hash"] },
  { file: "packages/web/src/main.ts", reason: "Runs in the browser and compares the page's own session token with its stored copy; there is no remote caller to time it, and the page cannot import the server's helper.", expressions: ["currentToken !== api.token", "sessionStorageGet('tabularius.opened') !== this.api.token", "currentToken === this.api.token", "saved?.token !== this.api.token"] },
  { file: "packages/web/src/watch-storage.ts", reason: "Runs in the browser and compares the page's own session token with its stored copy; there is no remote caller to time it, and the page cannot import the server's helper.", expressions: ["now.token === this.session.token"] },
  { file: "packages/web/src/web-viewer.ts", reason: "location.hash is the page's public URL fragment, not a cryptographic hash.", expressions: ["hash === (this.hash ?? '')"] },
  { file: "scripts/dependency-gate.ts", reason: "These are grammar tokens of a language being parsed (a number-format picture, an OData path, a dependency expression), not credentials.", expressions: ["tokens[i++] !== ')'"] },
  { file: "scripts/error-strings-lib.ts", reason: "These are grammar tokens of a language being parsed (a number-format picture, an OData path, a dependency expression), not credentials.", expressions: ["node.operatorToken.kind === ts.SyntaxKind.PlusToken"] },
  { file: "scripts/fuzz/harness.ts", reason: "A repository tool comparing its own digests, signatures or tokens (test and build helpers); not a server code path.", expressions: ["outcome.signature === wanted"] },
  { file: "scripts/licence-gate.ts", reason: "These are grammar tokens of a language being parsed (a number-format picture, an OData path, a dependency expression), not credentials.", expressions: ["tokens[i++] !== ')'"] },
  { file: "scripts/standby-chaos.ts", reason: "A repository tool comparing its own digests, signatures or tokens (test and build helpers); not a server code path.", expressions: ["f.digest !== prefix[f.seq]", "f.containers.get(i) !== hash", "a.digest !== prefix[changes]"] },
  { file: "scripts/visual.ts", reason: "A repository tool comparing its own digests, signatures or tokens (test and build helpers); not a server code path.", expressions: ["hash((await tab.shoot(name, token, l.name)) as Buffer) !== shots[key]"] },
];
export const allowances: Allowance[] = reviewed.flatMap(({ file, reason, expressions }) => [...new Set(expressions)].map((expression) => ({ file, reason, expression })));

/** Names that mark a value as a secret. A guess on names: `token` also names cache stamps and parser tokens, which is why the list above exists. */
const sensitive = /(?:secret|token|password|passwd|hmac|csrf|recoveryCode|challenge|nonce|verifier|signature|apiKey|digest|hash|bearer)/i;
const unwrap = (n: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n) ? unwrap(n.expression) : n;

/** Whether a name that says "secret" is in the expression: a variable, a property, `a ?? b`, `String(x)`, `x.toLowerCase()`. */
function named(n: ts.Expression): boolean {
  n = unwrap(n);
  if (ts.isIdentifier(n)) return sensitive.test(n.text);
  if (ts.isPropertyAccessExpression(n)) return sensitive.test(n.name.text);
  if (ts.isElementAccessExpression(n)) return n.argumentExpression && ts.isStringLiteral(n.argumentExpression) ? sensitive.test(n.argumentExpression.text) : named(n.expression);
  if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) return named(n.left) || named(n.right);
  if (ts.isConditionalExpression(n)) return named(n.whenTrue) || named(n.whenFalse);
  if (ts.isCallExpression(n) && /^(?:String|Buffer\.from|decodeURIComponent|encodeURIComponent|atob|btoa)$/.test(n.expression.getText())) return n.arguments.some(named);
  if (ts.isCallExpression(n)) return named(n.expression) || ((ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression)) && named(n.expression.expression));
  return false;
}
/** `typeof x`, null, true, false and undefined say what a value is, not what it holds. */
function shape(n: ts.Expression): boolean {
  n = unwrap(n);
  return ts.isTypeOfExpression(n) || n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(n) && n.text === 'undefined');
}
const comparisons = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);
/** Methods that compare their object with an argument and stop at the first difference. */
const COMPARING = new Set(['startsWith', 'endsWith', 'equals', 'compare']);

export function scanSource(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  function walk(n: ts.Node): void {
    let hit = ts.isBinaryExpression(n) && comparisons.has(n.operatorToken.kind) && !shape(n.left) && !shape(n.right) && (named(n.left) || named(n.right));
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) && callee.argumentExpression && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text : '';
      if (COMPARING.has(method) && (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && (named(callee.expression) || n.arguments.some(named))) hit = true;
    }
    if (hit) found.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, expression: n.getText(sf).replace(/\s+/g, ' ') });
    ts.forEachChild(n, walk);
  }
  walk(sf);
  return found;
}

/** Every source file of every package and the repository's scripts, judged; the findings are those with no reasoned entry above. */
export function checkRepository(root = resolve(import.meta.dirname, '..')): { files: number; findings: Finding[]; allowed: number; stale: Allowance[] } {
  const all: Finding[] = [];
  let files = 0;
  function walk(dir: string): void {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // Only source trees and scripts, with no symlinks, fixtures, corpora or caches.
      if (/^(?:fixtures|corpus|node_modules|\.git|\.github)$/i.test(e.name)) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(e.name)) { files++; all.push(...scanSource(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'))); }
    }
  }
  for (const p of readdirSync(join(root, 'packages'), { withFileTypes: true })) if (p.isDirectory()) walk(join(root, 'packages', p.name, 'src'));
  walk(join(root, 'scripts'));
  const used = new Set<Allowance>();
  const findings = all.filter((f) => {
    const a = allowances.find((a) => a.file === f.file && a.expression === f.expression && a.reason.trim().length > 20);
    if (a) used.add(a);
    return !a;
  });
  return { files, findings, allowed: all.length - findings.length, stale: allowances.filter((a) => !used.has(a)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = checkRepository();
  for (const f of r.findings) console.error(`${f.file}:${f.line}: compares a secret without sameSecret: ${f.expression}`);
  for (const a of r.stale) console.error(`${a.file}: stale entry (the expression is gone): ${a.expression}`);
  console.log(`${r.files} files; ${r.findings.length} findings; ${r.allowed} reasoned entries used; ${r.stale.length} stale entries`);
  if (r.findings.length) console.error('Compare it with sameSecret (packages/store/src/same-secret.ts), or, if no secret is compared, add the exact expression to scripts/check-secret-primitives.ts with the reason.');
  process.exitCode = r.findings.length || r.stale.length ? 1 : 0;
}
