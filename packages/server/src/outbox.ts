// The outbox of outbound test mode (scripts/src/outbound.ts): every message
// and web request scripts made, kept in <folder>/Outbox/outbox.jsonl so the
// admin console can show them. Nothing here sends anything.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { OutboxEntry } from '../../scripts/src/index.ts';

export type StoredEntry = OutboxEntry & { id: string };

export class Outbox {
  private readonly file: string;

  constructor(dir: string) {
    const folder = join(dir, 'Outbox');
    mkdirSync(folder, { recursive: true });
    this.file = join(folder, 'outbox.jsonl');
  }

  record(entry: OutboxEntry): StoredEntry {
    const stored = { id: randomBytes(8).toString('hex'), ...entry };
    appendFileSync(this.file, JSON.stringify(stored) + '\n');
    return stored;
  }

  /** Newest first, without attachment contents. */
  list(limit = 200): StoredEntry[] {
    return this.all().reverse().slice(0, limit).map((e) => (e.kind === 'mail'
      ? { ...e, attachments: e.attachments.map(({ name, size }) => ({ name, size })) }
      : e));
  }

  get(id: string): StoredEntry | undefined {
    return this.all().find((e) => e.id === id);
  }

  clear(): void {
    rmSync(this.file, { force: true });
  }

  private all(): StoredEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as StoredEntry];
      } catch {
        return [];
      }
    });
  }
}
