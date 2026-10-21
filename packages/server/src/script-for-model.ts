// A script's text as a model may see it: every literal that looks like a secret hidden first.

import { scriptText } from '../../fmp12/src/index.ts';
import { CREDENTIAL_NAME } from '../../scripts/src/credentials.ts';
import { redactSecrets, redactStep } from './ai-output.ts';

/**
 * A script's text for a model (writing its test cases, or its documentation): every literal hidden in a step that names a password, key,
 * token, credential, auth header or webhook anywhere (a calculation over several lines included), and in every
 * Insert from URL (its URL and cURL options); the usual redaction on the rest.
 */
export function scriptForModel(steps: ScriptStepLike[]): string {
  return redactSecrets(scriptText(scriptStepsForModel(steps)));
}

/** A detached copy for structured design exports, before any XML encoding. */
export function scriptStepsForModel(steps: ScriptStepLike[]): ScriptStepLike[] {
  const hide = (v: unknown): unknown => typeof v === 'string' ? redactSecrets(v, true)
    : Array.isArray(v) ? v.map(hide) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hide(x)])) : v;
  // The step's own strings, not its JSON: JSON writes a tab before "pw" as \tpw, which hides the word.
  const strings = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) ? v.map(strings).join(' ')
    : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${strings(x)}`).join(' ') : '';
  return steps.map((st) => (SENSITIVE.test(strings(st)) || st.name === 'Insert from URL' ? hide(st) as ScriptStepLike : redactStep(st)));
}
type ScriptStepLike = Parameters<typeof scriptText>[0][number];
// Share credential aliases; also hide literals in the broader authentication contexts used by script steps.
const SENSITIVE = new RegExp(String.raw`${CREDENTIAL_NAME}|pass|\bpw\b|\bpin\b|log[io]n|\bkey\b|auth|\bbasic\b|webhook|hooks\.|smtp`, 'i');
