// The security and authentication events the audit log records, besides record
// changes: the single source of their kinds, how they group for a reader, how
// urgent each is, and how to say each one in plain English. The store writes
// them through Store.logSecurity and reads them back through Store.securityEvents;
// /admin and the web client both render them from here, so the wording and the
// grouping stay in one place.

import type { AuditEntry } from './store.ts';

/**
 * Every security/authentication event kind, in one canonical list. The
 * SecurityEventKind type is derived from it, so adding a kind here (and only
 * here) is what makes it known everywhere; the category test then holds you to
 * placing it in a group.
 */
export const SECURITY_EVENT_KINDS = [
  'sign-in', 'sign-in-failed', 'locked-out', 'lockout-cleared',
  'account-added', 'account-removed', 'account-enabled', 'account-disabled', 'accounts-migrated', 'accounts-imported', 'accounts-import-rejected',
  'password-changed', 'must-change-set', 'must-change-cleared',
  'account-local-only-set', 'account-local-only-cleared',
  'account-require-2fa-set', 'account-require-2fa-cleared',
  'privilege-set-saved', 'privilege-set-deleted', 'privilege-set-assigned', 'privilege-set-unassigned', 'privilege-denied',
  'password-policy-changed', 'require-2fa-set', 'require-2fa-cleared', 'viewed-as',
  'two-factor-enrolled', 'two-factor-confirmed', 'two-factor-disabled',
  'passkey-registered', 'passkey-removed', 'recovery-codes-generated', 'recovery-code-used',
  'api-token-issued', 'api-token-revoked', 'scim-token-issued', 'scim-token-revoked',
  'agent-added', 'agent-removed', 'agent-change-proposed', 'agent-change-approved', 'agent-change-rejected',
  'schema-changed',
  'ai-turned-off', 'ai-turned-on', 'ai-access-refused', 'ai-policy-on', 'ai-policy-off',
  'pii-isolation-on', 'pii-isolation-off', 'pii-field-marked', 'ai-data-masked',
  'blank-password-lan-allowed', 'blank-password-lan-disallowed',
  'audit-settings-changed', 'audit-pruned',
  'plugin-installed', 'plugin-install-refused',
  'script-network-on', 'script-network-off',
  'web-viewer-hosts-changed',
  'standby-takeover',
  'data-exported', 'data-export-refused',
] as const;

/** The security and authentication events the audit log records, besides record changes. */
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

/**
 * The event kinds grouped the way a person reading a security log thinks about
 * them, in the order they're shown. Every kind in SECURITY_EVENT_KINDS belongs
 * to exactly one group (held by the category test).
 */
export const SECURITY_EVENT_CATEGORIES: Record<string, readonly SecurityEventKind[]> = {
  'Sign-in': ['sign-in', 'sign-in-failed', 'locked-out', 'lockout-cleared'],
  'Accounts': [
    'account-added', 'account-removed', 'account-enabled', 'account-disabled', 'accounts-migrated', 'accounts-imported', 'accounts-import-rejected',
    'password-changed', 'must-change-set', 'must-change-cleared',
    'account-local-only-set', 'account-local-only-cleared',
    'account-require-2fa-set', 'account-require-2fa-cleared',
  ],
  'Privilege sets': [
    'privilege-set-saved', 'privilege-set-deleted', 'privilege-set-assigned', 'privilege-set-unassigned', 'privilege-denied',
    'password-policy-changed', 'require-2fa-set', 'require-2fa-cleared', 'viewed-as',
  ],
  'Two-factor & passkeys': [
    'two-factor-enrolled', 'two-factor-confirmed', 'two-factor-disabled',
    'passkey-registered', 'passkey-removed', 'recovery-codes-generated', 'recovery-code-used',
  ],
  'API tokens': ['api-token-issued', 'api-token-revoked', 'scim-token-issued', 'scim-token-revoked'],
  'AI agents': ['agent-added', 'agent-removed', 'agent-change-proposed', 'agent-change-approved', 'agent-change-rejected'],
  'Schema': ['schema-changed'],
  'Audit log': ['audit-settings-changed', 'audit-pruned'],
  'Blank passwords': ['blank-password-lan-allowed', 'blank-password-lan-disallowed'],
  'Plug-ins': ['plugin-installed', 'plugin-install-refused'],
  'Script network access': ['script-network-on', 'script-network-off'],
  'Web viewer hosts': ['web-viewer-hosts-changed'],
  'Standby takeover': ['standby-takeover'],
  'Data export': ['data-exported', 'data-export-refused'],
  'AI access': ['ai-turned-off', 'ai-turned-on', 'ai-access-refused', 'ai-policy-on', 'ai-policy-off', 'pii-isolation-on', 'pii-isolation-off', 'pii-field-marked', 'ai-data-masked'],
};

const CATEGORY_OF = new Map<string, string>();
for (const [cat, kinds] of Object.entries(SECURITY_EVENT_CATEGORIES)) for (const k of kinds) CATEGORY_OF.set(k, cat);

/** The group a security event kind belongs to, or undefined for a record-change kind. */
export function securityEventCategory(kind: string): string | undefined {
  return CATEGORY_OF.get(kind);
}

/** The kinds in a named category, or [] for an unknown category. */
export function categoryKinds(category: string): readonly SecurityEventKind[] {
  return SECURITY_EVENT_CATEGORIES[category] ?? [];
}

/**
 * How much a reader should care: `alert` for a failure or lockout to notice now,
 * `notice` for a change that weakens or removes protection, `info` otherwise.
 * (Also the basis the unusual-access alerts build on.)
 */
export type SecurityEventSeverity = 'alert' | 'notice' | 'info';

const ALERT = new Set<string>(['sign-in-failed', 'locked-out', 'accounts-import-rejected', 'plugin-install-refused', 'data-export-refused']);
const NOTICE = new Set<string>([
  'account-removed', 'account-disabled', 'account-local-only-cleared',
  'lockout-cleared',
  'account-require-2fa-cleared', 'require-2fa-cleared',
  'privilege-set-deleted', 'privilege-denied', 'password-policy-changed',
  'two-factor-disabled', 'passkey-removed', 'recovery-code-used',
  'api-token-issued', 'scim-token-issued', 'privilege-set-unassigned', 'agent-added', 'agent-change-rejected',
  'ai-turned-on', 'ai-access-refused', 'blank-password-lan-allowed', 'pii-isolation-off', 'pii-field-marked',
  'audit-settings-changed', 'audit-pruned', 'plugin-installed', 'web-viewer-hosts-changed', 'standby-takeover', 'data-exported',
]);

export function securityEventSeverity(kind: string): SecurityEventSeverity {
  return ALERT.has(kind) ? 'alert' : NOTICE.has(kind) ? 'notice' : 'info';
}

function factorName(factor: unknown): string {
  return factor === 'two-factor' || factor === 'totp' ? 'a second factor'
    : factor === 'passkey' ? 'a passkey'
    : factor === 'recovery-code' || factor === 'recovery' ? 'a recovery code'
    : typeof factor === 'string' ? factor : 'a second factor';
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * One security event said in plain English, self-contained enough to read on its
 * own line or in an exported row. The acting account and the place it came from
 * are the entry's own `account`/`from`; this names the object acted on and the
 * salient detail, so a log reads like a sentence per line. Falls back to a
 * title-cased kind for anything it doesn't recognise.
 */
export function describeSecurityEvent(e: AuditEntry): string {
  const t = e.target ? ` ${e.target}` : '';
  const d = (e.changes ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'sign-in': return d.factor ? `Signed in with ${factorName(d.factor)}` : 'Signed in';
    case 'sign-in-failed': return 'Sign-in failed';
    case 'locked-out': return 'Locked out after too many failed sign-ins';
    case 'lockout-cleared': return `Sign-in block cleared for ${str(d.scope) === 'address' ? 'address' : 'account'} ${e.target ?? '?'}`;
    case 'account-added': return `Account${t} added`;
    case 'account-removed': return `Account${t} removed`;
    case 'account-enabled': return `Account${t} enabled`;
    case 'account-disabled': return `Account${t} disabled`;
    case 'accounts-imported': return `${num(d.changed) ?? 0} accounts changed by CSV import`;
    case 'accounts-import-rejected': return `CSV account import refused (${str(d.reason) ?? 'invalid-import'})`;
    case 'accounts-migrated': return `${num(d.count) ?? 0} account${num(d.count) === 1 ? '' : 's'} migrated to this file`;
    case 'password-changed': return e.target ? `Password changed for${t}` : 'Password changed';
    case 'password-policy-changed': return 'Password policy changed';
    case 'must-change-set': return `${e.target ?? 'An account'} must change password at next sign-in`;
    case 'must-change-cleared': return `Must-change-password cleared for${t}`;
    case 'account-local-only-set': return `${e.target ?? 'An account'} limited to this computer`;
    case 'account-local-only-cleared': return `${e.target ?? 'An account'} allowed from the network again`;
    case 'account-require-2fa-set': return `${e.target ?? 'An account'} now requires a second factor`;
    case 'account-require-2fa-cleared': return `Second-factor requirement cleared for${t}`;
    case 'privilege-denied': return `${titleCase(str(d.operation) ?? 'request')} refused for privilege set “${e.target ?? '?'}”: the ${str(d.ruleKind) ?? ''} ${str(d.permission) ?? ''} rule ${d.outcome === 'evaluation-failure' ? 'could not be evaluated' : 'did not allow the request'}. Configuration: ${str(d.location) ?? '?'}.`;
    case 'privilege-set-saved': return `Privilege set${t} saved`;
    case 'privilege-set-deleted': return `Privilege set${t} deleted`;
    case 'privilege-set-assigned': return `${e.target ?? 'An account'} assigned the ${str(d.privilegeSet) ?? '?'} privilege set`;
    case 'privilege-set-unassigned': return `${e.target ?? 'An account'} no longer has a privilege set${str(d.privilegeSet) ? ` (was ${str(d.privilegeSet)})` : ''}`;
    case 'require-2fa-set': return 'Second factor now required for Full Access';
    case 'require-2fa-cleared': return 'Second-factor requirement for Full Access cleared';
    case 'viewed-as': return `Previewed ${str(d.layout) ?? 'a layout'} as the ${str(d.privilegeSet) ?? '?'} privilege set`;
    case 'two-factor-enrolled': return `Second factor enrolled for${t}`;
    case 'two-factor-confirmed': return `Second factor confirmed for${t}`;
    case 'two-factor-disabled': return `Second factor turned off for${t}`;
    case 'passkey-registered': return `Passkey registered for${t}${str(d.label) ? ` (${str(d.label)})` : ''}`;
    case 'passkey-removed': return `Passkey removed for${t}`;
    case 'recovery-codes-generated': return `${num(d.count) ?? 0} recovery codes generated for${t}`;
    case 'recovery-code-used': return `Recovery code used by${t}`;
    case 'api-token-issued': return `API token issued to${t}${tokenScope(d)}`;
    case 'api-token-revoked': return 'API token revoked';
    case 'scim-token-issued': return `Provisioning (SCIM) token issued${str(d.expires) ? `, valid until ${str(d.expires)}` : ''}: an identity provider can now add, change and remove accounts`;
    case 'scim-token-revoked': return 'Provisioning (SCIM) token revoked';
    case 'agent-added': return `AI agent${t} added${d.needsApproval ? ' (its changes need approval)' : ''}`;
    case 'agent-removed': return `AI agent${t} removed`;
    case 'agent-change-proposed': return `AI agent${t} proposed a record ${str(d.kind) ?? 'change'}${num(d.recordId) != null ? ` (#${num(d.recordId)})` : ''}`;
    case 'agent-change-approved': return `Approved a record ${str(d.kind) ?? 'change'} by AI agent${t}${num(d.recordId) != null ? ` (#${num(d.recordId)})` : ''}`;
    case 'agent-change-rejected': return `Rejected a record ${str(d.kind) ?? 'change'} by AI agent${t}`;
    case 'schema-changed': return `Schema changed${schemaOps(d)}`;
    case 'standby-takeover': {
      const kept = d.keptTokens === true;
      return `Taken over from a standby of ${str(d.standbyOf) ?? 'another server'}; its copy was last updated ${str(d.lastChange) ?? 'at an unknown time'}. ${kept ? 'API tokens kept' : `${num(d.tokensEnded) ?? 0} API token${num(d.tokensEnded) === 1 ? '' : 's'} ended`}. Accounts, passwords and privileges changed on the main server after that are not here: review them`;
    }
    case 'script-network-on': return 'Script network access turned on: this file\'s scripts can reach the network';
    case 'script-network-off': return 'Script network access turned off for this file';
    case 'web-viewer-hosts-changed': {
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []).join(', ');
      const [added, removed] = [list(d.added), list(d.removed)];
      return `Web viewer hosts changed${added ? `: allowed ${added}` : ''}${removed ? `${added ? '; ' : ': '}no longer allowed ${removed}` : ''}`;
    }
    case 'ai-policy-on': return 'AI-visible policy turned on';
    case 'ai-policy-off': return 'AI-visible policy turned off';
    case 'ai-turned-off': return 'AI turned off for this file';
    case 'ai-turned-on': return 'AI turned on for this file';
    case 'ai-access-refused': return `AI access refused (AI is off for this file)${str(d.via) ? `: ${str(d.via)}` : ''}`;
    case 'pii-isolation-on': return 'Personal data isolation turned on: AI models get stand-ins for personal data';
    case 'pii-isolation-off': return 'Personal data isolation turned off';
    case 'pii-field-marked': return `${e.target ?? 'A field'} ${d.pii === true ? 'marked as personal data' : d.pii === false ? 'marked as not personal data' : 'back to the worked-out setting'}`;
    case 'ai-data-masked': return `Personal data kept from AI${str(d.via) ? ` (${str(d.via)})` : ''}: ${maskedCounts(d.masked)}${d.blocked ? '; a tool was refused' : ''}`;
    case 'audit-settings-changed': return `Audit log settings changed${str(d.summary) ? `: ${str(d.summary)}` : ''}`;
    case 'audit-pruned': return `${num(d.removed) ?? 0} audit entries up to #${num(d.through) ?? '?'} removed by the retention setting (${num(d.days) ?? '?'} days)`;
    case 'blank-password-lan-allowed': return 'An empty-password account allowed to sign in from this LAN';
    case 'plugin-installed': return `Plug-in ${str(d.id) ?? '?'} ${str(d.version) ?? ''} installed by a script${str(d.script) ? ` (${str(d.script)})` : ''}, signed by ${str(d.signer) ?? 'nobody'}`.replace('  ', ' ');
    case 'plugin-install-refused': return `A script's plug-in install was refused${str(d.script) ? ` (${str(d.script)})` : ''}: ${str(d.why) ?? 'no reason given'}`;
    case 'data-exported': return d.discarded === true
      ? `${e.account ?? 'An account'} discarded an unfinished full-file export${str(d.folder) ? ` at ${str(d.folder)}` : ''}`
      : `${e.account ?? 'An account'} exported a full copy of the file to ${str(d.folder) ?? '?'}`;
    case 'data-export-refused': return `A full-file export as ${e.account ?? 'an unknown account'} was refused: ${str(d.reason) ?? 'no reason given'}`;
    case 'blank-password-lan-disallowed': return 'Empty-password accounts limited to this computer again';
    default: return titleCase(e.kind);
  }
}

function maskedCounts(m: unknown): string {
  const parts = m && typeof m === 'object' ? Object.entries(m as Record<string, unknown>).filter(([, n]) => typeof n === 'number' && n > 0).map(([k, n]) => `${n} ${k.toLowerCase()}`) : [];
  return parts.length ? parts.join(', ') : 'nothing to swap';
}

function tokenScope(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (d.readOnly) parts.push('read-only');
  const surfaces = Array.isArray(d.surfaces) ? d.surfaces.filter((s): s is string => typeof s === 'string') : [];
  if (surfaces.length) parts.push(surfaces.join(', '));
  const layouts = Array.isArray(d.layouts) ? d.layouts.filter((s): s is string => typeof s === 'string') : [];
  if (layouts.length) parts.push(`layouts: ${layouts.join(', ')}`);
  const label = str(d.label);
  const scope = parts.length ? ` (${parts.join('; ')})` : '';
  return label ? ` "${label}"${scope}` : scope;
}

function schemaOps(d: Record<string, unknown>): string {
  const ops = d.ops && typeof d.ops === 'object' ? (d.ops as Record<string, unknown>) : undefined;
  if (!ops) return '';
  const parts = Object.entries(ops)
    .filter(([, n]) => num(n))
    .map(([op, n]) => `${titleCase(op)} ×${num(n)}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** A kind or op name ("agent-change-proposed", "addField") as readable words. */
function titleCase(s: string): string {
  const spaced = s.replace(/-/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
