// Upload, review, then apply desired state for local accounts.
import { h, button, field } from '../design/dom.ts';
import { SecurityError, type AccountImportPlan, type SecurityClient } from './client.ts';
import type { Sec } from './main.ts';

interface ImportState {
  csv?: string;
  file?: string;
  preview?: AccountImportPlan;
  result?: AccountImportPlan;
  key?: string;
  busy?: boolean;
  error?: string;
}
const states = new WeakMap<SecurityClient, ImportState>();
const reasons: Record<string, string> = {
  'self-account': 'The import cannot change your own account.',
  'reserved-account': 'Built-in accounts cannot be imported.',
  'non-local-account': 'Only local accounts can be imported.',
  'unknown-privilege-set': 'Choose a privilege set already in this file.',
  'full-access-grant': 'CSV imports cannot assign Full Access to another account.',
  'duplicate-account': 'This account appears more than once.',
  'ambiguous-existing-account': 'Existing account names differ only by case. Resolve them before importing.',
  'ambiguous-unicode-account': 'These account names are equivalent under Unicode normalization. Keep one spelling and resolve the existing names before importing.',
  'invalid-account-name': 'Use a nonempty account name without control characters, surrounding spaces or a formula prefix.',
  'invalid-privilege-set': 'Use a privilege set name of at most 256 characters, without controls, surrounding whitespace or a formula prefix.',
  'last-full-access': 'Keep an active Full Access account with an unambiguous name, working credentials and required MFA set up.',
  'stale-or-changed-preview': 'The preview expired or accounts changed. Preview this file again.',
  'invalid-preview': 'Preview this file again before applying.',
  'import-rate-limit': 'Too many import requests. Wait one minute and try again.',
  'expected-account-privilegeSet-active-columns': 'The CSV must contain exactly account, privilegeSet and active columns.',
  'invalid-csv-quoting': 'Fix the CSV quoting and upload the file again.',
};
const reason = (code: string) => reasons[code] ?? code.replace(/-/g, ' ');
const stateText = (state: { privilegeSet: string | null; active: boolean } | null) => state ? `${state.privilegeSet ?? 'No set'} · ${state.active ? 'active' : 'inactive'}` : 'New account';

export function accountImportForm(sec: Sec): HTMLElement {
  let state = states.get(sec.client);
  if (!state) { state = {}; states.set(sec.client, state); }
  const s = state;
  const wrap = h('details', { class: 'd-group sec-account-import', ...(s.csv || s.result || s.error ? { open: '' } : {}) }, h('summary', {}, 'Import local accounts'));
  const upload = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Account CSV' });
  const output = h('div', { 'aria-live': 'polite' });
  const preview = button('Preview import', async () => {
    if (!s.csv || s.busy) return;
    s.busy = true; s.error = undefined; s.result = undefined;
    draw();
    try { s.preview = await sec.client.previewAccounts(s.csv); s.key = crypto.randomUUID(); }
    catch (e) { s.error = e instanceof Error ? reason(e.message) : 'Preview failed. Try again.'; s.preview = undefined; }
    finally { s.busy = false; draw(); }
  });
  const apply = button('Apply import', async () => {
    if (!s.csv || !s.preview?.previewToken || !s.preview.valid || !s.key || s.busy) return;
    s.busy = true; s.error = undefined;
    draw();
    try {
      s.result = await sec.client.importAccounts(s.csv, s.preview.previewToken, s.key);
      s.csv = undefined; s.preview = undefined; s.key = undefined;
      s.busy = false;
      sec.set(await sec.client.security());
    } catch (e) {
      s.error = e instanceof Error ? reason(e.message) : 'Apply failed. Try again.';
      if (e instanceof SecurityError && e.status === 409) s.preview = undefined;
    } finally { s.busy = false; draw(); }
  }, { class: 'primary' });
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file || s.busy) return;
    s.csv = undefined; s.preview = undefined; s.result = undefined; s.key = undefined; s.error = undefined; s.file = file.name;
    s.busy = true;
    draw();
    try {
      if (file.size > 1024 * 1024) throw new Error('Use a CSV smaller than 1 MiB.');
      s.csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch (e) { s.error = e instanceof Error ? e.message : 'Could not read this file.'; }
    finally { s.busy = false; draw(); }
  });
  function draw() {
    upload.disabled = !!s.busy;
    preview.disabled = !s.csv || !!s.busy;
    apply.disabled = !s.preview?.valid || !s.preview.previewToken || !!s.busy;
    output.replaceChildren();
    if (s.file) output.append(h('p', { class: 'd-hint' }, s.file));
    if (s.busy) output.append(h('p', {}, 'Working…'));
    if (s.error) output.append(h('p', { role: 'alert' }, s.error));
    const plan = s.result ?? s.preview;
    if (!plan) return;
    output.append(h('h3', {}, s.result ? 'Import complete' : 'Review account changes'));
    if (plan.errors.length) output.append(h('p', {}, 'Fix every error and upload the corrected file before applying.'), h('ul', {}, ...plan.errors.map((e) => h('li', {}, `${e.row ? `Row ${e.row}: ` : ''}${reason(e.code)}`))));
    if (plan.rows.length) {
      const labels = ['Row', 'Account', 'Changes', 'Before', 'After', 'Credential setup'];
      output.append(h('div', { class: 'sec-import-rows', tabindex: '0', 'aria-label': 'Account import rows' }, h('table', { class: 'sec-table' },
        h('caption', { class: 'd-hint' }, 'Each CSV row specifies the desired assignment and active state.'),
        h('thead', {}, h('tr', {}, ...labels.map((label) => h('th', { scope: 'col' }, label)))),
        h('tbody', {}, ...plan.rows.map((r) => h('tr', {}, ...[String(r.row), r.account, r.actions.join(', '), stateText(r.before), stateText(r.after), r.credentialSetupRequired ? 'Set up separately' : 'Keep existing credentials'].map((text, i) => h('td', { 'data-label': labels[i] }, text))))))));
    }
    if (plan.rows.some((r) => r.credentialSetupRequired)) output.append(h('p', { class: 'd-hint' }, 'New accounts cannot password-sign-in yet. Set a temporary password separately in the admin console with “must change” enabled. No passwords are imported or shown here.'));
    if (s.preview?.expiresAt) output.append(h('p', { class: 'd-hint' }, `Preview valid until ${new Date(s.preview.expiresAt).toLocaleTimeString()}. Changes to accounts require a new preview.`));
  }
  wrap.append(h('p', { class: 'd-hint' }, 'Upload UTF-8 CSV with account,privilegeSet,active columns. Use true or false for active. Missing accounts are left as they are. Maximum 1 MiB and 1,000 rows. External mappings, agent identities, your own account and Full Access grants are excluded.'),
    field('CSV file', upload), h('div', { class: 'd-row' }, preview, apply), output);
  draw();
  return wrap;
}
