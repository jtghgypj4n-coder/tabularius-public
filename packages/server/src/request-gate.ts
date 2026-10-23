// Admission for short HTTP requests. Long-lived live-update streams use their
// own per-session bound and never occupy a short-request slot.
import { positiveWholeNumber } from './setting-values.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientAddress } from './client-address.ts';

export type RequestClass = 'priority' | 'normal' | 'heavy';

/** A live-update stream outlives any short request: it has its own per-session bound and takes no slot. */
export const isEventStream = (method: string | undefined, path: string): boolean => method === 'GET' && /^\/tabularius\/live\/v1\/databases\/[^/]+\/events$/.test(path);

/** Data API calls answer a refusal in the Data API's own envelope. */
export const isDataApiPath = (path: string): boolean => path.startsWith('/fmi/data/');

export function requestClass(method: string | undefined, path: string): RequestClass {
  if (path.startsWith('/tabularius/auth/') || path === '/oauth/authorize' || path === '/oauth/token') return 'priority';
  if (method === 'GET' && (path === '/tabularius/admin/v1/metrics' || path === '/tabularius/admin/v1/sign-in-info' || path === '/tabularius/auth/v1/providers' || path === '/fmi/data/vLatest/databases')) return 'priority';
  if ((method === 'GET' || method === 'HEAD') && (path.startsWith('/app/') || path.startsWith('/admin/') || path.startsWith('/tabularius/images/') || path.startsWith('/tabularius/tls'))) return 'priority';
  if (method === 'POST' && (/^\/fmi\/data\/[^/]+\/databases\/[^/]+\/sessions$/.test(path) || /\/(?:sign-in|passkey-sign-in|signin|login|callback)$/.test(path))) return 'priority';
  if (path.includes('/_find') || /\/exports?(?:\/|$)|\/export(?:\/|$)/.test(path)) return 'heavy';
  return 'normal';
}

interface Waiter {
  address: string;
  kind: RequestClass;
  req: IncomingMessage;
  res: ServerResponse;
  resolve: (release?: () => void) => void;
  timer: ReturnType<typeof setTimeout>;
  close: () => void;
}

export class RequestGate {
  readonly limit: number;
  readonly queueLimit: number;
  readonly waitMs: number;
  private active = 0;
  private readonly byAddress = new Map<string, number>();
  private readonly waiting: Waiter[] = [];
  private shedCount = 0;

  constructor(limit = positiveWholeNumber('TABULARIUS_REQUEST_LIMIT', process.env.TABULARIUS_REQUEST_LIMIT, 32, { min: 4 }), queueLimit = 64, waitMs = 750) {
    if (!Number.isInteger(limit) || limit < 4 || !Number.isInteger(queueLimit) || queueLimit < 0 || !Number.isInteger(waitMs) || waitMs < 1) throw new Error('Invalid request gate settings');
    this.limit = limit;
    this.queueLimit = queueLimit;
    this.waitMs = waitMs;
  }

  get running(): number { return this.active; }
  get queued(): number { return this.waiting.length; }
  get shed(): number { return this.shedCount; }

  private capacity(kind: RequestClass): number {
    // Two slots are always available to sign-in and static requests.
    return kind === 'priority' ? this.limit : this.limit - 2;
  }

  private canRun(kind: RequestClass, address: string): boolean {
    if (this.active >= this.capacity(kind)) return false;
    // A single address can hold at most three quarters of ordinary capacity. Priority
    // calls can use the reserved slots even when that address is at its cap.
    return (this.byAddress.get(address) ?? 0) < Math.max(1, Math.floor((this.limit - 2) * 0.75)) + (kind === 'priority' ? 2 : 0);
  }

  private take(address: string, res: ServerResponse): () => void {
    this.active++;
    this.byAddress.set(address, (this.byAddress.get(address) ?? 0) + 1);
    let released = false;
    let operationDone = false;
    let responseDone = res.destroyed || res.writableFinished;
    const release = () => {
      if (released || !operationDone || !responseDone) return;
      released = true;
      res.off('close', responseEnded);
      res.off('finish', responseEnded);
      this.active--;
      const remaining = this.byAddress.get(address)! - 1;
      if (remaining) this.byAddress.set(address, remaining);
      else this.byAddress.delete(address);
      this.drain();
    };
    const responseEnded = () => { responseDone = true; release(); };
    res.once('close', responseEnded);
    res.once('finish', responseEnded);
    return () => { operationDone = true; release(); };
  }

  private drain(): void {
    for (;;) {
      const next = (['priority', 'normal', 'heavy'] as const).flatMap((kind) => this.waiting.filter((w) => w.kind === kind))
        .find((w) => this.canRun(w.kind, w.address));
      if (!next) return;
      const at = this.waiting.indexOf(next);
      this.waiting.splice(at, 1);
      clearTimeout(next.timer);
      next.res.off('close', next.close);
      // A socket may have closed between selection and admission.
      if (next.res.destroyed || next.res.writableEnded || next.req.socket.destroyed) { next.resolve(undefined); continue; }
      next.resolve(this.take(next.address, next.res));
    }
  }

  async enter(req: IncomingMessage, res: ServerResponse, kind: RequestClass): Promise<(() => void) | undefined> {
    const address = clientAddress(req);
    if (res.destroyed || req.socket.destroyed) return undefined;
    // Serve eligible waiters first. A full queue from one capped address must
    // not prevent a different address from taking a still-free slot.
    this.drain();
    if (this.canRun(kind, address)) return this.take(address, res);
    if (this.waiting.length >= this.queueLimit && kind === 'priority') {
      const displaced = this.waiting.findLast((w) => w.kind === 'heavy') ?? this.waiting.findLast((w) => w.kind === 'normal');
      if (displaced) {
        this.waiting.splice(this.waiting.indexOf(displaced), 1);
        clearTimeout(displaced.timer);
        displaced.res.off('close', displaced.close);
        this.shedCount++;
        displaced.resolve(undefined);
      }
    }
    if (this.waiting.length >= this.queueLimit) { this.shedCount++; return undefined; }
    return new Promise<(() => void) | undefined>((resolve) => {
      const close = () => {
        const at = this.waiting.indexOf(waiter);
        if (at >= 0) this.waiting.splice(at, 1);
        clearTimeout(waiter.timer);
        res.off('close', close);
        resolve(undefined);
        this.drain();
      };
      const timer = setTimeout(() => {
        close();
        this.shedCount++;
      }, this.waitMs);
      const waiter: Waiter = { address, kind, req, res, resolve, timer, close };
      this.waiting.push(waiter);
      res.once('close', close);
      this.drain();
    });
  }
}
