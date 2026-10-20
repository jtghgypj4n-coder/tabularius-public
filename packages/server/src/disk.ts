// Free disk space, for the backups (refuse one that cannot fit rather than fill the disk) and the metrics.

import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** What statfs says of a folder: free blocks for an ordinary user and the block size. */
export type StatFs = (path: string) => { bavail: number | bigint; bsize: number | bigint };

/**
 * Bytes free for this user where `path` is or would be made: a folder not made yet counts as the nearest folder above
 * it that is there. Undefined when the system does not say (some network and virtual file systems).
 */
export function freeBytes(path: string, statfs: StatFs = statfsSync): number | undefined {
  let at = resolve(path);
  for (;;) {
    try {
      const s = statfs(at);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      const up = dirname(at);
      if (up === at) return undefined;
      at = up;
    }
  }
}

/** "1.5 GB", "320 MB", "12 KB": a size to read. */
export function sizeText(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${units[i]}`;
}
