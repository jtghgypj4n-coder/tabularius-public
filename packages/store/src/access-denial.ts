// A failed privilege check, without record data or calculation text.

import { writer } from './activity.ts';

export type AccessOperation = 'view' | 'edit' | 'create' | 'delete' | 'write' | 'run' | 'connect';
export type AccessPermission = 'view' | 'edit' | 'create' | 'delete' | 'field-write' | 'layout-write' | 'script-start' | 'extended-privilege';
export type RuleOutcome = 'allowed' | 'false' | 'evaluation-failure';

export interface AccessDenial {
  readonly database?: string;
  readonly privilegeSet: string;
  readonly operation: AccessOperation;
  readonly permission: AccessPermission;
  readonly source: 'table' | 'records' | 'field' | 'fieldsDefault' | 'layout' | 'layouts' | 'script' | 'scripts' | 'extendedPrivileges';
  readonly location: string;
  readonly ruleKind: 'none' | 'limited' | 'view-only' | 'missing';
  readonly outcome: Exclude<RuleOutcome, 'allowed'>;
  readonly policyFingerprint: string;
  readonly requiredPrivileges?: readonly string[];
}

interface DenialContext { readonly file: unknown; readonly account: string }
const contexts = new WeakMap<AccessDenial, DenialContext>();
const diagnostics = new WeakSet<AccessDenial>();

/** Owning-file provenance stays out of denial JSON and public projections. */
export function captureAccessDenial(denial: AccessDenial, file: unknown, account: string): AccessDenial {
  const captured = Object.freeze(denial);
  contexts.set(captured, Object.freeze({ file, account }));
  if ((file as { privilegeDenialAuditSuppressed?: boolean } | null)?.privilegeDenialAuditSuppressed || writer.getStore()?.transaction?.open?.quiet) diagnostics.add(captured);
  return captured;
}

export function accessDenialContext(denial: AccessDenial): DenialContext | undefined {
  return contexts.get(denial);
}

/** Capture-time suppression survives a trial ending before a boundary observes the error. */
export function denialAuditSuppressed(denial: AccessDenial): boolean {
  return diagnostics.has(denial);
}

// Conversions and script results carry context privately, never as serialized diagnostics.
const errors = new WeakMap<object, AccessDenial>();
export function denialOf(value: unknown): AccessDenial | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const denial = errors.get(value) ?? (value as { denial?: AccessDenial }).denial;
  return denial && contexts.has(denial) ? denial : undefined;
}

export function retainDenial(value: object, denial: AccessDenial | undefined): void {
  if (denial && contexts.has(denial)) errors.set(value, denial);
}

export interface DenialAudit {
  code: number;
  surface: 'web' | 'data-api' | 'mcp';
  identifier: string;
  origin: 'direct' | 'script';
  phase?: 'prerequest' | 'presort' | 'script';
  capturedAt: string;
}

/** Explicit allowlist: never copy the error, its message, or calculation inputs. */
export function denialAuditDetail(d: AccessDenial, audit: DenialAudit): Record<string, unknown> {
  return {
    version: 1, capturedAt: audit.capturedAt, code: audit.code, surface: audit.surface,
    identifier: audit.identifier.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80), origin: audit.origin,
    ...(audit.phase ? { phase: audit.phase } : {}),
    privilegeSet: d.privilegeSet, operation: d.operation, permission: d.permission,
    source: d.source, location: d.location, ruleKind: d.ruleKind, outcome: d.outcome,
    policyFingerprint: d.policyFingerprint,
    ...(d.requiredPrivileges ? { requiredPrivileges: d.requiredPrivileges.filter((p) =>
      ['fmapp', 'fmwebdirect', 'fmrest', 'fmxml', 'fmmcp'].includes(p)) } : {}),
  };
}

/** Runtime denials disclose less than access reports: no schema names or formulas. False and failed evaluation look alike. */
export interface AccessDenialExplanation {
  readonly operation: AccessOperation;
  readonly permission: AccessPermission;
  readonly explanation: string;
}

export function explainAccessDenial(denial: AccessDenial, admin = false): AccessDenialExplanation {
  const rules: Record<AccessPermission, string> = {
    view: 'record-view', edit: 'record-edit', create: 'record-create', delete: 'record-delete',
    'field-write': 'field-write', 'layout-write': 'layout record-write', 'script-start': 'script-start',
    'extended-privilege': 'extended privilege',
  };
  const reason = denial.permission === 'extended-privilege' && denial.requiredPrivileges?.length
    ? `It needs the ${denial.requiredPrivileges.join(' or ')} extended privilege to allow the request.`
    : denial.ruleKind === 'limited'
    ? `Its ${rules[denial.permission]} rule is limited, and did not allow the request.`
    : `Its ${rules[denial.permission]} permission does not allow the request.`;
  const explanation = `Your “${denial.privilegeSet}” privilege set does not allow this request. ${reason}` +
    (admin ? ` Configuration: ${denial.location} (${denial.source}).` : '');
  return { operation: denial.operation, permission: denial.permission, explanation };
}
