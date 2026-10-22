import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const active = new Map<string, number>();
const key = (folder: string) => { try { return realpathSync.native(folder); } catch { return resolve(folder); } };

/** Keep this process's backup source files alive until its external copy finishes. */
export function holdContainerBackup(folder: string): () => void {
  const at = key(folder);
  active.set(at, (active.get(at) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (active.get(at) ?? 1) - 1;
    if (left) active.set(at, left);
    else active.delete(at);
  };
}

export const containerBackupInProgress = (folder: string): boolean => (active.get(key(folder)) ?? 0) > 0;
