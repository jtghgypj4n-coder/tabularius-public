import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function requestPath(folder: string, pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid server process id');
  return join(folder, `.openhbam-stop-${pid}`);
}

/** A local stop request has the same filesystem trust boundary as the hosted folder.
 * Windows signals cannot request Node cleanup. Task Scheduler behavior is unverified;
 * the CLI requests this path and waits for exit before asking Scheduler to start again.
 */
export function requestStop(folder: string, pid: number): void {
  const file = requestPath(folder, pid);
  try { writeFileSync(file, String(pid), { flag: 'wx', mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
}

export function listenForStop(folder: string, stop: () => void, platform: NodeJS.Platform = process.platform, pid = process.pid): () => void {
  if (platform !== 'win32') return () => {};
  const file = requestPath(folder, pid);
  // A reused PID must not inherit a stop request from a previous run.
  rmSync(file, { force: true });
  const timer = setInterval(() => {
    try {
      const st = lstatSync(file);
      if (!st.isFile() || st.size > 32 || readFileSync(file, 'utf8') !== String(pid)) return;
      rmSync(file);
    } catch { return; }
    clearInterval(timer);
    stop();
  }, 100);
  timer.unref();
  return () => {
    clearInterval(timer);
    // A leftover PID-specific request is harmless; failure to remove it must not block shutdown.
    try { rmSync(file, { force: true }); } catch { /* cleaned on next startup if this PID is reused */ }
  };
}
