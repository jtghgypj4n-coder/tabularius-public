import { renameSync, rmSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { renameSync as renameChecked } from './fs-boundary.ts';

const retryable = (e: unknown, platform: NodeJS.Platform, attempt: number) =>
  platform === 'win32' && attempt < 3 && ['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '');
const pause = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** Brief sharing violations get bounded retries. Never unlink a destination to force a rename.
 * Actual NTFS/antivirus sharing behavior remains unverified without a Windows run.
 */
export function retryFileSync<T>(action: () => T, platform: NodeJS.Platform = process.platform, wait = pause): T {
  for (let attempt = 0; ; attempt++) {
    try { return action(); }
    catch (e) { if (!retryable(e, platform, attempt)) throw e; wait(25 * (attempt + 1)); }
  }
}

export function renameFileSync(from: string, to: string): void {
  retryFileSync(() => renameSync(from, to));
}

export function removeFileSync(file: string, options?: Parameters<typeof rmSync>[1]): void {
  retryFileSync(() => rmSync(file, options));
}

export async function renameFile(from: string, to: string, platform: NodeJS.Platform = process.platform, move = rename, wait: (ms: number) => Promise<unknown> = delay): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await move(from, to); return; }
    catch (e) { if (!retryable(e, platform, attempt)) throw e; await wait(25 * (attempt + 1)); }
  }
}

/** Shipped code renames through the filesystem boundary (both entries checked again at the moment of use), with the same bounded retries. */
export function renameCheckedSync(from: string, to: string, platform: NodeJS.Platform = process.platform, wait?: (ms: number) => void): void {
  retryFileSync(() => renameChecked(from, to), platform, wait);
}

export function renameCheckedFile(from: string, to: string, platform: NodeJS.Platform = process.platform, wait?: (ms: number) => Promise<unknown>): Promise<void> {
  return renameFile(from, to, platform, async (a, b) => renameChecked(a, b), wait);
}
