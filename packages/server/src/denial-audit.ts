import { AsyncLocalStorage } from 'node:async_hooks';
import { Store } from '../../store/src/store.ts';
import { accessDenialContext, denialAuditSuppressed, denialOf, type AccessDenial, type DenialAudit } from '../../store/src/access-denial.ts';

/** One outward operation's first refusal, separate from a script's current error. */
export class DenialCollector {
  private first?: { denial: AccessDenial; audit: DenialAudit };
  private finished = false;
  private readonly surface: DenialAudit['surface'];
  private readonly identifier: string;
  constructor(surface: DenialAudit['surface'], identifier: string) {
    this.surface = surface;
    this.identifier = identifier;
  }

  observe(denial: AccessDenial, code: number, origin: DenialAudit['origin'] = 'script', phase?: DenialAudit['phase']): void {
    const owner = accessDenialContext(denial)?.file;
    if (this.finished || this.first || !(owner instanceof Store) || denialAuditSuppressed(denial)) return;
    this.first = { denial, audit: { code, surface: this.surface, identifier: this.identifier,
      origin, ...(phase ? { phase } : {}), capturedAt: new Date().toISOString() } };
  }

  error(error: unknown): void {
    const denial = denialOf(error);
    const code = (error as { code?: unknown } | null)?.code;
    if (denial && typeof code === 'number') this.observe(denial, code, 'direct');
  }

  flush(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.first) return;
    const { denial, audit } = this.first;
    const owner = accessDenialContext(denial)?.file;
    try { if (owner instanceof Store) owner.recordPrivilegeDenied(denial, audit); } catch { /* auditing cannot change a response */ }
  }
}

export const denialOperation = new AsyncLocalStorage<DenialCollector>();
export function captureDenial(error: unknown): void {
  denialOperation.getStore()?.error(error);
}
