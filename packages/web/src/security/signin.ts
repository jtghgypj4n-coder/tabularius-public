// "My sign-in": the signed-in account's own passkeys and recovery codes.
// Passkeys let this account sign in without a password (and are phishing-proof,
// which FileMaker has no answer to); recovery codes are the one-time fallback
// for when a passkey or authenticator is lost. Everything here acts on the
// account you are signed in as — the server's self-service endpoints never
// touch another account.

import { h, button, toast } from '../design/dom.ts';
import type { Sec } from './main.ts';
import { generateMyRecoveryCodes, listMyPasskeys, passkeySupported, registerPasskey, removeMyPasskey, type Passkey } from '../webauthn.ts';
import { errorText } from './main.ts';

/** A date/time as the rest of the UI shows them (ISO strings from the server). */
const when = (iso?: string): string => (iso ? new Date(iso).toLocaleString() : '');

export function signinTab(sec: Sec): HTMLElement {
  const db = sec.client.db, token = sec.client.token;
  const wrap = h('div', { class: 'd-pane signin-pane' });

  const passkeyList = h('div', { class: 'signin-list' });
  const render = (passkeys: Passkey[]): void => {
    if (!passkeys.length) {
      passkeyList.replaceChildren(h('p', { class: 'd-hint' }, 'You have no passkeys yet.'));
      return;
    }
    passkeyList.replaceChildren(...passkeys.map((p) => h('div', { class: 'signin-row' },
      h('span', { class: 'signin-name' }, p.label || 'Passkey'),
      h('span', { class: 'd-hint' }, `added ${when(p.created)}${p.lastUsed ? `, last used ${when(p.lastUsed)}` : ''}`),
      button('Remove', () => void remove(p), { class: 'd-danger' }),
    )));
  };
  const reload = async (): Promise<void> => {
    try {
      render(await listMyPasskeys(db, token));
    } catch (e) {
      passkeyList.replaceChildren(h('p', { class: 'd-hint' }, errorText(e)));
    }
  };
  const remove = async (p: Passkey): Promise<void> => {
    if (!confirm(`Remove the passkey “${p.label || 'Passkey'}”? You won't be able to sign in with it any more.`)) return;
    try {
      await removeMyPasskey(db, token, p.id);
      toast('Passkey removed.', 'info');
      await reload();
    } catch (e) { toast(errorText(e)); }
  };
  const add = async (): Promise<void> => {
    const label = prompt('A name for this passkey (e.g. “MacBook Touch ID”):', 'This device');
    if (label === null) return;
    try {
      await registerPasskey(db, token, label.trim() || 'Passkey');
      toast('Passkey added.', 'info');
      await reload();
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) toast('Adding the passkey was cancelled.', 'info');
      else toast(errorText(e));
    }
  };

  const codesOut = h('div', { class: 'signin-codes' });
  const generate = async (): Promise<void> => {
    if (!confirm('Generate a new set of recovery codes? Any codes you had before will stop working.')) return;
    try {
      const { codes } = await generateMyRecoveryCodes(db, token);
      codesOut.replaceChildren(
        h('p', { class: 'd-hint' }, 'Save these somewhere safe. Each code works once, and they are shown only now.'),
        h('ul', { class: 'signin-code-list' }, ...codes.map((c) => h('li', {}, h('code', {}, c)))),
      );
    } catch (e) { toast(errorText(e)); }
  };

  wrap.append(
    h('h2', { class: 'd-h2' }, 'Passkeys'),
    h('p', { class: 'd-hint' }, 'Sign in without a password, using this device’s fingerprint, face or security key. Passkeys can’t be phished or reused across sites.'),
    passkeyList,
    passkeySupported()
      ? button('Add a passkey', () => void add(), { class: 'd-primary' })
      : h('p', { class: 'd-hint' }, 'This browser can’t create passkeys here (they need a secure https connection).'),
    h('h2', { class: 'd-h2' }, 'Recovery codes'),
    h('p', { class: 'd-hint' }, 'One-time codes to sign in if you lose your passkey or authenticator. Generating a new set replaces the old one.'),
    button('Generate recovery codes', () => void generate(), {}),
    codesOut,
  );
  void reload();
  return wrap;
}
