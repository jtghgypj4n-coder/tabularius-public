import { Worker } from 'node:worker_threads';
import type { SecurityAuditVerification } from '../../store/src/security-chain.ts';
import type { RecordAuditVerification } from '../../store/src/record-chain.ts';

/** Which of a file's hash chains to check. */
export type AuditChain = 'security' | 'records';

const TIMEOUT_MS = 60_000;

/** One worker and no waiting queue; the production instance is shared by the serving process. */
export class SecurityAuditVerifier {
  private job?: { result: Promise<SecurityAuditVerification | RecordAuditVerification>; cancel(reason: Error): void };
  private readonly timeoutMs: number;
  private readonly createWorker: (path: string, chain: AuditChain) => Worker;

  constructor(opts: { timeoutMs?: number; createWorker?: (path: string, chain: AuditChain) => Worker } = {}) {
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.createWorker = opts.createWorker ?? ((path, chain) => new Worker(new URL('./security-audit-worker.ts', import.meta.url), { workerData: { path, chain } }));
  }

  /** Undefined means busy. Cancellation terminates the worker before freeing its slot. */
  verify(path: string, signal?: AbortSignal, chain: AuditChain = 'security'): Promise<SecurityAuditVerification | RecordAuditVerification> | undefined {
    if (this.job) return undefined;
    if (signal?.aborted) return Promise.reject(new Error('security audit verification cancelled'));
    let worker: Worker;
    try { worker = this.createWorker(path, chain); } catch (e) { return Promise.reject(e); }
    let cancel!: (reason: Error) => void;
    const result = new Promise<SecurityAuditVerification | RecordAuditVerification>((resolve, reject) => {
      let answer: SecurityAuditVerification | RecordAuditVerification | undefined;
      let error: Error | undefined;
      let finished = false;
      const finish = (code: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        this.job = undefined;
        if (error) reject(error);
        else if (code === 0 && answer) resolve(answer);
        else reject(new Error('security audit verification worker stopped without a result'));
      };
      cancel = (reason) => {
        error ??= reason;
        // terminate() also covers a worker stuck after sending its result.
        void worker.terminate().then(finish, (e) => { error ??= e; finish(1); });
      };
      const aborted = () => cancel(new Error('security audit verification cancelled'));
      const timer = setTimeout(() => cancel(new Error('security audit verification timed out')), this.timeoutMs);
      signal?.addEventListener('abort', aborted, { once: true });
      worker.once('message', (message: SecurityAuditVerification | RecordAuditVerification) => { answer = message; });
      worker.once('error', (e) => { error = e; });
      worker.once('exit', finish);
    });
    this.job = { result, cancel };
    if (signal?.aborted) cancel(new Error('security audit verification cancelled'));
    return result;
  }

  /** Resolves only when the worker has stopped and its slot is free. */
  async stop(): Promise<void> {
    const job = this.job;
    if (!job) return;
    const stopped = job.result.catch(() => {});
    job.cancel(new Error('security audit verification cancelled'));
    await stopped;
  }
}

export const securityAuditVerifier = new SecurityAuditVerifier();
