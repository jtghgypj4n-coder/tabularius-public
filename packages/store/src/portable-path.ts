import path from 'node:path';

/** Names created by the server must also survive copying a folder to Windows. */
export function portableName(name: string): boolean {
  return !!name && !/[\x00-\x1f<>:"/\\|?*]/.test(name) && !/[ .]$/.test(name) &&
    !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:[ .]|$)/i.test(name) &&
    Buffer.byteLength(name) <= 255;
}

/** A name a script reads, writes or renames in the documents folder. Windows refuses device names, trailing dots and
 * the like, so they are refused there; elsewhere they are ordinary names and only an empty one is not.
 */
export function documentNamePart(name: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' ? portableName(name) : !!name;
}

/** Stored relative names. On Windows either separator is accepted, but never a drive, device or ADS.
 * Elsewhere a name is only checked structurally: backslash, quotes and the like are ordinary characters there.
 */
export function storageRelative(name: string, paths = path): string | undefined {
  if (!name || paths.isAbsolute(name)) return undefined;
  if (paths.sep === '/') return name;
  if (/^[\\/]/.test(name)) return undefined;
  const parts = name.split(/[\\/]/).filter((part) => part !== '.');
  if (!parts.length) return '.';
  if (parts.some((part) => !portableName(part))) return undefined;
  return parts.join(paths.sep);
}

export function withinPath(root: string, target: string, paths = path): boolean {
  const rel = paths.relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel);
}

/** Different drives/shares have no common ancestor; never loop at a volume root. */
export function commonParent(roots: string[], paths = path): string | undefined {
  if (!roots.length) return undefined;
  let common = paths.dirname(paths.resolve(roots[0]));
  while (roots.some((root) => !withinPath(common, paths.resolve(root), paths))) {
    const parent = paths.dirname(common);
    if (parent === common) return undefined;
    common = parent;
  }
  return common;
}

/** Conservative legacy Win32 boundary, including space reserved for staging/sidecars.
 * Long-path opt-in, network shares and antivirus behavior remain unverified on Windows.
 */
export function checkPathLength(file: string, reserve = 0, platform: NodeJS.Platform = process.platform, paths = platform === 'win32' ? path.win32 : path): void {
  if (platform === 'win32' && paths.resolve(file).length + reserve >= 260) {
    throw new Error('The path is too long for Windows (260 characters including staging files); choose a shorter backup, export or data folder');
  }
}

/** SQL export streams containers: reserve their maximum generated names before any output. */
export function checkSqlExportPath(file: string, platform: NodeJS.Platform = process.platform): void {
  const paths = platform === 'win32' ? path.win32 : path;
  const name = paths.basename(file);
  if (!portableName(name)) throw new Error('Choose a portable export file name without device names, trailing dots or special characters');
  checkPathLength(file, 0, platform, paths);
  const sidecar = paths.join(paths.dirname(file), name.replace(/\.sql$/i, '') + '.files', 't'.repeat(66), '9'.repeat(34) + '-' + 'f'.repeat(48));
  checkPathLength(sidecar, 0, platform, paths);
}
