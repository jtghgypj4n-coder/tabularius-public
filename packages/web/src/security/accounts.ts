// Accounts: who can sign in, with which privilege set, and their second factor.

import { h, button, select, field, check, toast } from '../design/dom.ts';
import { accountImportForm } from './account-import.ts';
import { errorText, explain, type Sec } from './main.ts';
import type { Account, Security } from './client.ts';

/** A short local date-time for a timestamp. */
const when = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString(); };

// A second factor being set up, kept across re-renders until confirmed or cancelled.
let pendingTotp: { account: string; secret: string; uri: string } | undefined;

// The one-time passwords from the last migration, kept across re-renders so the
// admin can read them off (they are shown once and never stored in clear).
let migration: { account: string; password: string }[] | undefined;
const passwordResetsPending = new Set<string>();
const totpDisablesPending = new Set<string>();

/** Confirm removal of the selected account's enrolled authenticator. */
export function confirmTotpRemoval(account: string, ask: (message: string) => boolean = (message) => confirm(message)): boolean {
  return ask(`Turn off two-factor for "${account}"? This removes its enrolled authenticator.`);
}

function badges(a: Account): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (a.inactive) out.push(h('span', { class: 'sec-badge warn' }, 'inactive'));
  if (a.agent) out.push(h('span', { class: 'sec-badge' }, a.createdBy ? `AI agent · for ${a.createdBy}` : 'AI agent'));
  if (a.external) out.push(h('span', { class: 'sec-badge' }, 'external'));
  if (a.hasTotp) out.push(h('span', { class: 'sec-badge' }, '2FA'));
  if (a.blankPassword) out.push(h('span', { class: 'sec-badge warn' }, 'empty password'));
  else if (!a.hasPassword && !a.external) out.push(h('span', { class: 'sec-badge warn' }, 'no password'));
  else if (a.unmigrated) out.push(h('span', { class: 'sec-badge warn' }, 'from FileMaker'));
  if (a.mustChange) out.push(h('span', { class: 'sec-badge warn' }, 'must change password'));
  if (a.localOnly) out.push(h('span', { class: 'sec-badge' }, 'local only'));
  if (a.require2fa) out.push(h('span', { class: 'sec-badge' }, '2FA required'));
  return out;
}

export function accountsTab(sec: Sec): HTMLElement {
  const { accounts, privilegeSets } = sec.security;
  const setNames = privilegeSets.map((p) => p.name);
  const current = accounts.find((a) => a.name === sec.selected.account) ?? accounts[0];

  const list = h('ul', { class: 'd-list' });
  for (const a of accounts) {
    const li = h('li', { class: a === current ? 'selected' : '' },
      h('button', { type: 'button' }, h('span', {}, a.name), h('span', { class: 'd-count' }, a.privilegeSet ?? 'no set')));
    li.querySelector('button')!.addEventListener('click', () => {
      sec.selected.account = a.name;
      pendingTotp = undefined;
      sec.render();
    });
    list.append(li);
  }

  // Add a password account, an identity-provider account (no password), or an
  // AI agent (an MCP/AI identity, no password, never full access).
  const name = h('input', { placeholder: 'Account name', 'aria-label': 'Account name' });
  const password = h('input', { type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
  const setPick = select(setNames.length ? setNames : [''], setNames[0] ?? '', { 'aria-label': 'Privilege set' });
  const external = check('Identity-provider account (no password)', false);
  const agent = check('AI agent (MCP/AI identity, no password)', false);
  const needsApproval = check('Hold its record changes for a human to approve', false);
  const mustChange = check('Require a new password at first sign-in', false);
  const agentHint = h('p', { class: 'd-hint', style: 'display:none' }, 'An agent signs in only with an MCP token you mint for it (MCP tab), never a password, and can’t be given [Full Access]. Its actions are tagged as the agent in the audit log.');
  const sync = () => {
    const ext = external.input.checked, ag = agent.input.checked;
    password.style.display = ext || ag ? 'none' : '';
    mustChange.el.style.display = ext || ag ? 'none' : '';
    needsApproval.el.style.display = ag ? '' : 'none';
    agentHint.style.display = ag ? '' : 'none';
  };
  // The two no-password kinds are mutually exclusive.
  external.input.addEventListener('change', () => { if (external.input.checked) agent.input.checked = false; sync(); });
  agent.input.addEventListener('change', () => { if (agent.input.checked) external.input.checked = false; sync(); });
  const create = h('form', { class: 'd-inline-form sec-create' }, name, password, mustChange.el, external.el, agent.el, needsApproval.el, agentHint, field('Privilege set', setPick));
  create.append(button('Add account', () => create.requestSubmit(), { class: 'primary' }));
  create.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) return;
    const change = agent.input.checked
      ? { op: 'createAccount', kind: 'agent', name: n, privilegeSet: setPick.value, needsApproval: needsApproval.input.checked }
      : external.input.checked
      ? { op: 'createAccount', kind: 'external', name: n, privilegeSet: setPick.value }
      : { op: 'createAccount', kind: 'password', name: n, password: password.value, privilegeSet: setPick.value, mustChange: mustChange.input.checked };
    if (await sec.apply([change], `Added "${n}"`)) {
      sec.selected.account = n;
      sec.render();
    }
  });

  return h('div', { class: 'd-split' },
    h('aside', { class: 'd-side' }, h('h2', {}, 'Accounts'), list, create, migrateForm(sec), policyForm(sec)),
    h('section', { class: 'd-main' }, accountImportForm(sec), ...(current ? detail(sec, current, setNames) : [h('p', { class: 'd-muted' }, 'No accounts yet.')])),
  );
}

/**
 * First-login flow for a converted file: give every account still signing in
 * with the file's own password a fresh temporary password and force a change
 * on next sign-in. The temporary passwords are shown once, here, for the admin
 * to hand out.
 */
function migrateForm(sec: Sec): HTMLElement | undefined {
  const pending = sec.security.accounts.filter((a) => a.unmigrated).length;
  if (!pending && !migration) return undefined;
  const wrap = h('div', { class: 'd-inline-form sec-migrate' }, h('h2', {}, 'Migrate from FileMaker'));
  if (pending) {
    wrap.append(
      h('p', { class: 'd-hint' }, `${pending} account${pending === 1 ? '' : 's'} still sign in with the converted file’s own password. Give each a temporary password and require a new one at first sign-in.`),
      button(`Migrate ${pending} account${pending === 1 ? '' : 's'}`, async () => {
        try {
          const r = await sec.client.migrate();
          migration = r.migrated;
          sec.set(r.security);
          toast(`Migrated ${r.migrated.length} account${r.migrated.length === 1 ? '' : 's'}.`, 'info');
        } catch (e) {
          toast(errorText(e));
        }
      }, { class: 'primary' }));
  }
  if (migration?.length) {
    const rows = migration.map((m) => h('tr', {}, h('td', {}, m.account), h('td', {}, h('code', {}, m.password))));
    wrap.append(
      h('p', { class: 'd-hint' }, 'One-time passwords — shown only now. Copy them before leaving this page; each account must change its password at first sign-in.'),
      h('table', { class: 'sec-migrate-pw' }, h('tbody', {}, ...rows)),
      button('Done', () => { migration = undefined; sec.render(); }));
  }
  return wrap;
}

/** The file-wide password policy (FileMaker's account options): minimum length and maximum age. */
function policyForm(sec: Sec): HTMLElement {
  const policy = sec.security.passwordPolicy ?? {};
  const num = (value: number | undefined, label: string) =>
    h('input', { type: 'number', min: '0', step: '1', 'aria-label': label, placeholder: '0', value: value ? String(value) : '' }) as HTMLInputElement;
  const minLen = num(policy.minLength, 'Minimum password length');
  const maxAge = num(policy.maxAgeDays, 'Maximum password age in days');
  const read = (el: HTMLInputElement) => { const n = Number(el.value); return el.value.trim() === '' || !Number.isFinite(n) ? 0 : Math.max(0, Math.trunc(n)); };
  const form = h('form', { class: 'd-inline-form sec-policy' },
    h('h2', {}, 'Password policy'),
    field('Minimum length', minLen, '0 for no minimum'),
    field('Expires after (days)', maxAge, '0 to never expire'),
  );
  form.append(button('Save policy', () => form.requestSubmit()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void sec.apply([{ op: 'setPasswordPolicy', policy: { minLength: read(minLen), maxAgeDays: read(maxAge) } }], 'Password policy saved');
  });

  // Require a second factor on every full-access account.
  const missing = sec.security.fullAccessWithout2fa ?? [];
  const require2fa = check('Require two-factor for full-access accounts', !!sec.security.requireTotpForFullAccess);
  const hint = require2fa.input.checked || !missing.length
    ? 'Full-access accounts must sign in with a second factor.'
    : `Set up two-factor for these full-access accounts first: ${missing.join(', ')}.`;
  require2fa.input.addEventListener('change', async () => {
    const ok = await sec.apply([{ op: 'setRequireTotpForFullAccess', on: require2fa.input.checked }],
      require2fa.input.checked ? 'Two-factor now required for full access' : 'Requirement cleared');
    if (!ok) sec.render(); // rejected (full-access accounts without 2FA): put the checkbox back
  });
  form.append(h('div', { class: 'sec-require-2fa' }, require2fa.el, h('p', { class: 'd-hint' }, hint)));
  return form;
}

function detail(sec: Sec, a: Account, setNames: string[]): HTMLElement[] {
  const head = h('div', { class: 'd-heading' }, h('span', { class: 'd-title-input' }, a.name), ...badges(a),
    h('span', { class: 'd-spacer' }),
    ...explain(sec, `Explain what the account "${a.name}" can do in this file, through its privilege set, and anything about it that looks risky.`),
    button('Delete account…', () => {
      if (confirm(`Delete account "${a.name}"? Its API tokens and second factor go too.`)) {
        sec.selected.account = undefined;
        void sec.apply([{ op: 'deleteAccount', name: a.name }], 'Account deleted');
      }
    }, { class: 'danger' }));

  // Privilege set.
  const setPick = select(setNames, a.privilegeSet ?? setNames[0] ?? '', { 'aria-label': 'Privilege set' });
  const saveSet = button('Save', () => void sec.apply([{ op: 'setAccount', name: a.name, privilegeSet: setPick.value }], 'Privilege set changed'));
  const setRow = field('Privilege set', h('div', { class: 'd-row' }, setPick, saveSet));

  const blocks: HTMLElement[] = [head, setRow];

  // How an agent signs in — no password, only an MCP token.
  if (a.agent) {
    blocks.push(field('Sign-in',
      h('span', { class: 'd-muted' }, 'This is an AI agent. It signs in only with an MCP token minted for it on the MCP tab, never a password, and its actions are tagged as the agent in the audit log.')));

    // Hold its record changes for approval, and the queue of ones waiting.
    const approval = check('Hold its record changes for a human to approve', !!a.needsApproval);
    const saveApproval = button('Save', () => void sec.apply(
      [{ op: 'setAgentAccount', name: a.name, privilegeSet: a.privilegeSet ?? setNames[0] ?? '', needsApproval: approval.input.checked }],
      approval.input.checked ? 'Its changes now wait for approval' : 'Its changes now apply directly'));
    blocks.push(field('Change approval',
      h('div', { class: 'd-row' }, approval.el, saveApproval),
      'When on, the agent’s create, update and delete are recorded as proposals and nothing changes until you approve them here. Portal and container writes are refused while this is on.'));

    const pending = sec.security.pendingChanges.filter((p) => p.agent === a.name);
    if (pending.length) {
      const decide = async (fn: () => Promise<{ security: Security }>, done: string) => {
        try { sec.set((await fn()).security); toast(done); sec.render(); }
        catch (e) { toast(errorText(e)); }
      };
      blocks.push(field(`Waiting for approval (${pending.length})`,
        h('div', { class: 'd-col' }, ...pending.map((p) => h('div', { class: 'd-row' },
          h('span', {}, `${p.summary} · ${when(p.at)}`),
          button('Approve', () => void decide(() => sec.client.approvePending(p.id), 'Change approved and applied'), { class: 'primary' }),
          button('Reject', () => void decide(() => sec.client.rejectPending(p.id), 'Change rejected'), { class: 'danger' }))))));
    }
  }

  // Password (not for external or agent accounts, which don't sign in with one).
  if (!a.external && !a.agent) {
    const pw = h('input', { type: 'password', placeholder: 'New password', 'aria-label': 'New password' });
    const setPw = button('Set password', async () => {
      if (passwordResetsPending.has(a.name)) return;
      passwordResetsPending.add(a.name);
      setPw.disabled = true;
      try {
        if (await sec.apply([{ op: 'setAccount', name: a.name, password: pw.value }], 'Password set')) pw.value = '';
      } finally {
        passwordResetsPending.delete(a.name);
        for (const control of document.querySelectorAll<HTMLButtonElement>('.password-reset')) {
          if (control.dataset.account === a.name) control.disabled = false;
        }
      }
    }, { class: 'password-reset', 'data-account': a.name });
    setPw.disabled = passwordResetsPending.has(a.name);
    blocks.push(field('Password', h('div', { class: 'd-row' }, pw, setPw), a.blankPassword ? 'This account still has the file’s empty password.' : undefined));

    // Account options: require a password change on the next sign-in, on its own.
    const mustChange = check('User must change password on next sign-in', !!a.mustChange);
    const saveMust = button('Save', () => void sec.apply(
      [{ op: 'setAccount', name: a.name, mustChange: mustChange.input.checked }],
      mustChange.input.checked ? 'A password change is now required' : 'Requirement cleared'));
    blocks.push(field('Account options', h('div', { class: 'd-row' }, mustChange.el, saveMust)));

    // Opt-in sign-in restrictions (both off by default).
    const localOnly = check('Allow sign-in only from the server itself', !!a.localOnly);
    const require2fa = check('Require a second factor to sign in', !!a.require2fa);
    const saveRestrictions = button('Save', () => void sec.apply(
      [{ op: 'setAccount', name: a.name, localOnly: localOnly.input.checked, require2fa: require2fa.input.checked }],
      'Sign-in restrictions saved'));
    blocks.push(field('Sign-in restrictions',
      h('div', { class: 'd-col' }, localOnly.el, require2fa.el, h('div', { class: 'd-row' }, saveRestrictions)),
      a.require2fa && !a.hasTotp ? 'This account requires a second factor but has none set up — it can’t sign in until one is added below.' : 'Both are off by default; they restrict only this account.'));
  }

  // Two-factor.
  blocks.push(totpBlock(sec, a));
  return blocks;
}

function totpBlock(sec: Sec, a: Account): HTMLElement {
  if (a.agent) return h('div', { class: 'd-group' }, field('Two-factor', h('span', { class: 'd-muted' }, 'Not used — an agent signs in with an MCP token, not a password.')));
  if (a.external) return h('div', { class: 'd-group' }, field('Two-factor', h('span', { class: 'd-muted' }, 'Left to the identity provider.')));
  if (a.hasTotp) {
    const turnOff = button('Turn off', async () => {
      if (totpDisablesPending.has(a.name) || !confirmTotpRemoval(a.name)) return;
      totpDisablesPending.add(a.name);
      turnOff.disabled = true;
      try { await sec.apply([{ op: 'disableTotp', account: a.name }], 'Two-factor turned off'); }
      finally {
        totpDisablesPending.delete(a.name);
        for (const control of document.querySelectorAll<HTMLButtonElement>('.totp-disable')) {
          if (control.dataset.account === a.name) control.disabled = false;
        }
      }
    }, { class: 'danger totp-disable', 'data-account': a.name });
    turnOff.disabled = totpDisablesPending.has(a.name);
    return h('div', { class: 'd-group' }, field('Two-factor',
      h('div', { class: 'd-row' }, h('span', { class: 'sec-ok' }, 'On ✓'),
        turnOff)));
  }
  if (pendingTotp?.account === a.name) {
    const code = h('input', { placeholder: '6-digit code', 'aria-label': 'Code from the app', inputmode: 'numeric' });
    const confirm = button('Confirm', async () => {
      try {
        const r = await sec.client.confirmTotp(a.name, code.value.trim());
        if (!r.confirmed) { toast('That code didn’t match. Try the current one.'); return; }
        pendingTotp = undefined;
        sec.set(r.security);
        toast('Two-factor is on.', 'info');
      } catch (e) {
        toast(errorText(e));
      }
    }, { class: 'primary' });
    return h('div', { class: 'd-group' },
      h('div', { class: 'd-label' }, 'Set up two-factor'),
      h('p', { class: 'd-hint' }, 'Add this secret to an authenticator app (Google Authenticator, 1Password, Authy), then enter the code it shows.'),
      h('div', { class: 'd-code sec-secret' }, pendingTotp.secret),
      h('p', { class: 'd-hint' }, h('a', { href: pendingTotp.uri }, 'Open in an authenticator app')),
      h('div', { class: 'd-row' }, code, confirm,
        button('Cancel', () => { pendingTotp = undefined; sec.render(); })));
  }
  return h('div', { class: 'd-group' }, field('Two-factor',
    h('div', { class: 'd-row' }, h('span', { class: 'd-muted' }, 'Off'),
      button('Set up…', async () => {
        try {
          const r = await sec.client.enrollTotp(a.name);
          pendingTotp = { account: a.name, secret: r.secret, uri: r.uri };
          sec.set(r.security);
        } catch (e) {
          toast(errorText(e));
        }
      }))));
}
