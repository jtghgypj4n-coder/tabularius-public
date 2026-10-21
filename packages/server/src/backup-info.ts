import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, withStateLock } from '../../store/src/durable.ts';

/** Missing is allowed only when building a new manifest or reading legacy metadata. */
export function readBackupInfo<T extends object = Record<string, unknown>>(setDir: string, allowMissing = false): T {
  try {
    const info: unknown = JSON.parse(readFileSync(join(setDir, 'backup.json'), 'utf8'));
    if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('expected an object');
    return info as T;
  } catch (e) {
    if (allowMissing && (e as NodeJS.ErrnoException).code === 'ENOENT') return {} as T;
    throw new Error(`unreadable manifest ${join(setDir, 'backup.json')}: ${e instanceof SyntaxError ? 'invalid JSON' : 'manifest could not be read'}`);
  }
}

export function writeBackupInfo(setDir: string, info: object): void {
  atomicWrite(join(setDir, 'backup.json'), JSON.stringify(info, null, 2));
}

/** All manifest editors share one lock, including checks run by a CLI beside the server. */
export function updateBackupInfo<T extends object = Record<string, unknown>>(setDir: string, change: (info: T) => void): void {
  withStateLock(join(setDir, 'backup.json'), () => {
    const info = readBackupInfo<T>(setDir, true);
    change(info);
    writeBackupInfo(setDir, info);
  });
}
