// Scripts with credentials written into their steps (a capture-only AWS
// keys, an SMTP account's password in a variable): test runs never run them,
// and say so without ever showing the secret.

import { SCRIPT_STEP_NAMES, type Script } from '../../fmp12/src/index.ts';

/** Variable and field names that hold a password, key or token. */
export const CREDENTIAL_NAME = String.raw`pass[ _-]?(?:word|wd|phrase|code)|passwort|kennwort|contrase[ñn]a|senha|mot[ _-]?de[ _-]?passe|parola[ _-]?d['’ _-]?ordine|(?:smtp|sender|mail)[ _-]?user(?:[ _-]?name)?|pwd|secret|(?:api|access|private|signing)[ _-]?key|(?:(?:auth|access|refresh|session|id)[ _-]?)?token|jwt|credential|authorization|bearer|(?<![a-z])(?:ssn|iban|cvv|otp)(?![a-z])`;
const SECRET_NAME = new RegExp(`${CREDENTIAL_NAME}|custom debug info`, 'i');
const SHORT_SECRET_NAME = /(?:^|[^a-z])(?:pass|pw)(?:$|[^a-z])/i;
// Skipping execution needs a whole credential-name word: status/counter names
// such as authorization_status and bearerCount still run, even if diagnostics hide them.
const EMBEDDED_NAME = new RegExp(String.raw`\b(?:${CREDENTIAL_NAME}|pass|pw)\b`, 'i');

/** Conservative name policy for runtime diagnostics, including camelCase aliases. */
export const isCredentialName = (name: string): boolean => {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  return SECRET_NAME.test(name) || SECRET_NAME.test(words) || SHORT_SECRET_NAME.test(words);
};

/** Could a SQL result contain a credential column? COUNT(*) reads no column values. */
export function sqlMayReadSecret(query: string, secretText: (text: string) => boolean = isCredentialName): boolean {
  return secretText(query) || /\*/.test(query.replace(/count\s*\(\s*\*\s*\)/gi, ''));
}

// URL parameters and diagnostic labels need word boundaries: "secretary" is not a secret.
// Every name keeps its word start, as before ("Okapi Key" and "Compass Word" are not credentials). The one exception is a single
// unbroken word that ends in password, passwd, passphrase, pwd or secret (PGPASSWORD, adminpassword): those may follow other letters.
// The end boundary is kept for every name, and nothing here is an unanchored repeat, so matching stays linear.
const CREDENTIAL_LABEL = new RegExp(`(?:^|[^a-z0-9])(?:(?:container|plugin)[ _-]?)?(?:${CREDENTIAL_NAME}|credentials|pass|pw)(?:$|[^a-z0-9])|(?:password|passwd|passphrase|pwd|secret)(?:$|[^a-z0-9])`, 'i');
/** Names are short; a longer one is judged by its first and last 128 characters, so a hostile 30,000-character name costs little. */
const LABEL_CHARS = 128;
const labelTest = (name: string): boolean => CREDENTIAL_LABEL.test(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
export const isCredentialLabelName = (name: string): boolean =>
  name.length <= 2 * LABEL_CHARS ? labelTest(name) : labelTest(name.slice(0, LABEL_CHARS)) || labelTest(name.slice(-LABEL_CHARS));
export const isCredentialParameterName = (name: string): boolean => isCredentialLabelName(name) || /^(?:sig|signature|key|code|state|x-amz-signature)$/i.test(name);

/** Patterns that are a credential wherever they appear, and what to call them. */
const PATTERNS: [RegExp, string][] = [
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/[a-z0-9+.-]{1,32}:\/\/[^\s/:@"$]+:[^\s/@"$]+@/i, 'a user name and password in a web address'],
  [/(?:--user|\s-u)\s+"?[^\s"$&]+:[^\s"$&]+/, 'a user name and password in cURL options'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/, 'a bearer token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];

/** A text value of only a quoted literal: "abc" (what Set Variable [ $Password ; Value: "abc" ] holds). */
const LITERAL = /^\s*(?:"((?:[^"\\]|\\.)*)"|“([^”]*)”)\s*$/;

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/**
 * What kind of credential a script has written into its steps, if any: never
 * the credential itself. Reads the steps as decoded (SMTP passwords in a Send
 * Mail step's options are never decoded, so they are not looked at).
 */
export function embeddedCredential(script: Pick<Script, 'steps'>): string | undefined {
  for (const step of script.steps ?? []) {
    const p = (step.params ?? {}) as Record<string, unknown>;
    for (const s of strings(p)) {
      for (const [re, what] of PATTERNS) if (re.test(s)) return what;
    }
    // A password, key or token set to a literal: Set Variable [ $Password ; Value: "…" ], Set Field [ T::api_key ; "…" ].
    const target = [p.variable, typeof p.field === 'object' && p.field ? (p.field as { name?: string }).name : p.field].filter((x) => typeof x === 'string').join(' ');
    const formula = typeof p.value === 'string' ? p.value : p.calculation; // Set Variable's value, Set Field's calculation
    const value = typeof formula === 'string' ? LITERAL.exec(formula) : null;
    const literal = value ? (value[1] ?? value[2] ?? '') : '';
    if (EMBEDDED_NAME.test(target) && literal.length >= 4 && !/\s/.test(literal)) return 'a password or key set to a value written into the script';
    // Re-Login and account steps with a literal password.
    if (typeof p.password === 'string' && (LITERAL.exec(p.password)?.[1] ?? '').length >= 4) return 'a password written into an account step';
  }
  return undefined;
}

/** The scripts of a file with credentials in their steps, by name, with what kind. */
export function scriptsWithCredentials(scripts: readonly Pick<Script, 'name' | 'steps'>[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const s of scripts) {
    const what = embeddedCredential(s);
    if (what) found.set(s.name, what);
  }
  return found;
}

const EMAIL_WORD = /[^\s"“”'<>()[\];,:]+/g;
const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/**
 * Email addresses become ‹email›. An address is made of the characters of one word (no space, quote, bracket, comma,
 * semicolon or colon): the last "@" in it that a domain follows, with a dot and a top-level name of two letters or more
 * at its end. Found word by word, one scan of each word: a pattern for it backtracks over every "@" of a long run.
 */
export function maskEmails(text: string): string {
  return text.replace(EMAIL_WORD, (word) => {
    if (!word.includes('@')) return word;
    let dot = word.length - 3;
    while (dot >= 0 && !(word[dot] === '.' && isLetter(word[dot + 1]) && isLetter(word[dot + 2]))) dot--;
    // The domain has a character before the dot, and the name something before its "@".
    const at = dot < 3 ? -1 : word.lastIndexOf('@', dot - 2);
    if (at < 1) return word;
    let end = dot + 3;
    while (isLetter(word[end])) end++;
    return `‹email›${word.slice(end)}`;
  });
}
/** A scheme is the (at most) 32 characters of letters, digits and "+.-" before "://", whatever the characters before them: a long run of them is not tried at every position. */
const URL_TEXT = /[a-z0-9+.-]{1,32}:\/\/[^\s"“”]+|\bwww\.[^\s"“”]+/gi;
/** Text beyond this many characters is not shown in a masked report: masking is for what a person reads. It is cut after masking, so a cut can't leave a literal open. */
const MASK_CHARS = 200_000;
const cut = (text: string): string => (text.length > MASK_CHARS ? `${text.slice(0, MASK_CHARS)}…` : text);
/** Where a path ends in a step or message: a quote, a step's ; or ], a list's ¶, a new line. */
const PATH_END = String.raw`[^"“”;\]\n\r¶]*`;
/**
 * FileMaker's typed file references (filemac:/Macintosh HD/Users/…, imagewin:/C:/…, file:…, movie:…),
 * which can name a person's home folder, unless what follows is a $variable.
 */
const FILE_REF = new RegExp(String.raw`\b((?:file|image|movie)(?:mac|win|linux)?|filemac|filewin)\s*:(?!\s*\$)(?!\/\/)${PATH_END}`, 'gi');
/** Absolute paths outside a file reference: /Users/…, /Volumes/…, /home/…, C:\…, \\server\share, ~/…. */
const ABSOLUTE_PATH = new RegExp(String.raw`(?<![\w.:\/\\])(?:\/(?:Users|Volumes|home|private|var|tmp|Library|Applications|mnt|opt|etc|srv|media)\/|[A-Za-z]:[\\\/]|\\\\|~\/)${PATH_END}`, 'g');

/**
 * Text that may quote the file's design (an error message): email addresses,
 * web addresses, file paths and credentials in it are masked; names stay.
 */
export const maskSensitive = (text: string): string => cut(maskAddresses(text));

function maskAddresses(text: string): string {
  let out = text;
  for (const [re] of PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '‹secret›');
  return maskEmails(out.replace(URL_TEXT, '‹url›').replace(FILE_REF, '$1:‹path›').replace(ABSOLUTE_PATH, '‹path›'));
}

/**
 * A script line as test-scripts reports it: text typed into the script
 * (quoted literals: an address, a client's name, a key) is masked, so a
 * report can be shared; field, layout and script names stay.
 */
export function maskStepText(line: string): string {
  return cut(maskLiterals(line)
    // Comments in a calculation; a disabled step's leading "// " stays.
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '/* … */')
    .replace(/\/\/([^\r\n]*)/g, (m, rest: string, at: number, all: string) => (isDisabledStep(all, at, rest) ? m : '// …'))
    // Comment steps can hold anything.
    .replace(/^([ \t]*(?:\/\/ )?)# .*$/gm, '$1# …'));
}

/** A custom function's formula, to share: literals masked as in maskStepText, and comments (they can hold anything). */
export function maskFormula(formula: string): string {
  return cut(maskLiterals(formula).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '/* … */').replace(/\/\/[^\r\n]*/g, '// …'));
}

/**
 * "…" literals become "…" (a "" inside one is an escaped quote, a backslash escapes the next character), except one
 * character, or up to three with no letters, which tell how a script works. A quote that is never closed hides the
 * text from it to the end: it can be the start of a literal whatever follows, and a report is for sharing.
 */
export function maskQuoted(text: string): string {
  const keep = (m: string) => (/^"(?:[^"\\]|[^\p{L}"\\]{0,3})"$/u.test(m) ? m : '"…"');
  let out = '';
  let at = 0;
  for (let i = text.indexOf('"'); i >= 0; i = text.indexOf('"', at)) {
    let end = -1; // where the literal ends: the quote that closes it
    let pair = -1; // else where it ends if a "" inside it is its end and a quote after it
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') {
        if (j + 1 >= text.length || /[\n\r\u2028\u2029]/.test(text[j + 1])) break;
        j++;
      } else if (c === '"') {
        if (text[j + 1] === '"') { pair = j + 1; j++; } else { end = j + 1; break; }
      }
    }
    if (end < 0) end = pair;
    out += text.slice(at, i);
    if (end >= 0) { out += keep(text.slice(i, end)); at = end; } else { out += '"…"'; at = text.length; }
  }
  return out + text.slice(at);
}

function maskLiterals(text: string): string {
  return maskQuoted(maskAddresses(text))
    // "…" literals, except one character, or up to three with no letters ("-5", "¶", "<:"), which tell how a script
    // works (see maskQuoted); “…” names a script, layout or file and stays…
    // …except a stored find's criteria, which print as TO::Field: “criteria”.
    .replace(/(::[^“”"[\];\n]*?: )“[^”]*”/g, '$1“…”')
    // Numbers of five or more digits outside names: record ids, quote and phone numbers.
    .replace(/(?<![\p{L}\p{N}_.$:])\d{5,}(?![\p{L}\p{N}_])/gu, '‹number›');
}

/** "// Set Field [ … ]" at the start of a line is a disabled step, not a comment. */
function isDisabledStep(all: string, at: number, rest: string): boolean {
  if (!/^[ \t]*$/.test(all.slice(all.lastIndexOf('\n', at - 1) + 1, at)) || !rest.startsWith(' ')) return false;
  const after = rest.slice(1);
  return after.startsWith('# ') || SCRIPT_STEP_NAMES.some((n) => after.startsWith(n) && /^(?: \[|$)/.test(after.slice(n.length)));
}
