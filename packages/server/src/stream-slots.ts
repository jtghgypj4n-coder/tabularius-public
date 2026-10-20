import type { ServerResponse } from 'node:http';

export const MAX_MCP_STREAMS = 256;
export const MAX_MCP_STREAMS_PER_IDENTITY = 10;

/** A subscriber has no operation lifetime separate from its response. Entries disappear on every end path. */
export class StreamSlots {
  private total = 0;
  private readonly identities = new Map<string, number>();
  private readonly open = new Set<ServerResponse>();
  constructor(max = MAX_MCP_STREAMS, perIdentity = MAX_MCP_STREAMS_PER_IDENTITY) {
    this.max = max;
    this.perIdentity = perIdentity;
  }
  private readonly max: number;
  private readonly perIdentity: number;
  /** Ends every stream held (the server is stopping): a client reconnects when it is back. */
  closeAll(): void {
    for (const res of this.open) res.end();
  }

  enter(identity: string, res: ServerResponse): (() => void) | undefined {
    if (res.destroyed || res.writableEnded || res.socket?.destroyed) return;
    const held = this.identities.get(identity) ?? 0;
    if (this.total >= this.max || held >= this.perIdentity) return;
    this.total++;
    this.open.add(res);
    this.identities.set(identity, held + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.open.delete(res);
      this.total--;
      const n = this.identities.get(identity)! - 1;
      if (n) this.identities.set(identity, n); else this.identities.delete(identity);
      res.off('finish', release);
      res.off('close', release);
    };
    res.once('finish', release);
    res.once('close', release);
    return release;
  }
}
