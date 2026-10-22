import { existsSync, readFileSync, statSync } from 'node:fs';

/** Read a token from a regular file without putting its contents in errors. Symlinks follow their target. */
export function readSecretFile(path: string, optionName: string): string {
  const command = optionName === '--token-file' ? 'standby' : 'serve';
  if (!existsSync(path)) throw new Error(`${command}: ${optionName} ${path} does not exist`);
  const info = statSync(path);
  if (!info.isFile()) throw new Error(`${command}: ${optionName} ${path} must be a regular file`);
  if (process.platform !== 'win32' && info.mode & 0o077) {
    throw new Error(`${command}: ${path} can be read by other users; run: chmod 600 ${path}`);
  }
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`${command}: ${path} is empty`);
  if (/[\r\n]/.test(value)) throw new Error(`${command}: ${optionName} ${path} must contain one line`);
  return value;
}
