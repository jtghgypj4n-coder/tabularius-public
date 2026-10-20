import type { ServerResponse } from 'node:http';

export const MAX_IDENTITY_IN_FLIGHT = 32;
const MAX_ACTIVE_IDENTITIES = 4096;

/** No queue and no idle entries. Each surface owns a limiter; credentials for one account share a key. */
export class IdentityInFlight {
  private readonly active = new Map<string, number>();

  /** Finish the operation in a finally block. A disconnected client cannot release work still running. */
  enter(identity: string, res: ServerResponse): (() => void) | undefined {
    const count = this.active.get(identity) ?? 0;
    if (count >= MAX_IDENTITY_IN_FLIGHT || (!count && this.active.size >= MAX_ACTIVE_IDENTITIES)) return undefined;
    this.active.set(identity, count + 1);
    let operationDone = false;
    let responseDone = res.destroyed || res.writableFinished;
    let released = false;
    const release = () => {
      if (released || !operationDone || !responseDone) return;
      released = true;
      res.off('finish', ended);
      res.off('close', ended);
      const remaining = this.active.get(identity)! - 1;
      if (remaining) this.active.set(identity, remaining);
      else this.active.delete(identity);
    };
    const ended = () => { responseDone = true; release(); };
    res.once('finish', ended);
    res.once('close', ended);
    return () => { operationDone = true; release(); };
  }
}

/** A rejected request may still be sending a body. Close after sending the normal surface error. */
export function busyHeaders(res: ServerResponse): void {
  res.setHeader('retry-after', '1');
  res.setHeader('connection', 'close');
}
