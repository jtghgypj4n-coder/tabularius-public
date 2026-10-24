import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const COMPOSE = ['compose.yaml', 'compose.hardened.yaml', 'compose.https.yaml'];
const DIGEST = /^sha256:[a-f0-9]{64}$/;
type Ref = { file: string; image: string; line: number };

function imageFiles(root: string) {
  return ['Dockerfile', ...COMPOSE].filter((file) => {
    try { readFileSync(join(root, file)); return true; } catch { return false; }
  });
}

function references(root: string): Ref[] {
  const refs: Ref[] = [];
  for (const file of imageFiles(root)) {
    const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = file === 'Dockerfile'
        ? /^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+\S+)?\s*(?:#.*)?$/i.exec(line)
        : /^\s*image:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/.exec(line);
      if (match) refs.push({ file, image: match[1]!, line: index + 1 });
    });
  }
  return refs;
}

function pinned(image: string) { return /@sha256:[a-f0-9]{64}$/.test(image); }

function check(root: string, requirePinned: boolean): number {
  const refs = references(root);
  if (!refs.length) throw new Error('no image references found in Dockerfile or Compose files');
  for (const ref of refs) console.log(`${ref.file}:${ref.line} ${ref.image} — ${pinned(ref.image) ? 'pinned by digest' : 'tag only'}`);
  if (requirePinned && refs.some((ref) => !pinned(ref.image))) return 1;
  return 0;
}

function writePins(root: string, mapFile: string) {
  const map = JSON.parse(readFileSync(mapFile, 'utf8')) as Record<string, unknown>;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('digest map must be a JSON object');
  for (const [image, digest] of Object.entries(map)) {
    if (typeof digest !== 'string' || !DIGEST.test(digest)) throw new Error(`invalid digest for ${image}; expected sha256 followed by 64 lowercase hexadecimal characters`);
  }
  const files = imageFiles(root);
  const replacements = new Map<string, string>();
  for (const file of files) {
    let content = readFileSync(join(root, file), 'utf8');
    for (const ref of references(root).filter((item) => item.file === file)) {
      const digest = map[ref.image] ?? map[ref.image.split('@')[0]!];
      if (digest === undefined) continue;
      const cleanImage = ref.image.split('@')[0]!;
      const next = `${cleanImage}@${digest}`;
      const lines = content.split(/\r?\n/);
      const line = lines[ref.line - 1]!;
      lines[ref.line - 1] = line.replace(ref.image, next);
      content = lines.join('\n');
    }
    replacements.set(file, content);
  }
  for (const [file, content] of replacements) writeFileSync(join(root, file), content);
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const rootIndex = args.indexOf('--root');
    const root = resolve(rootIndex >= 0 ? args[rootIndex + 1]! : process.cwd());
    const commandArgs = rootIndex < 0 ? args : args.filter((_, index) => index !== rootIndex && index !== rootIndex + 1);
    if (commandArgs[0] === 'check' && commandArgs.slice(1).every((arg) => arg === '--require-pinned')) {
      process.exitCode = check(root, commandArgs.includes('--require-pinned'));
    } else if (commandArgs[0] === 'write' && commandArgs.length === 2) {
      writePins(root, resolve(commandArgs[1]!));
      console.log(`updated image references from ${commandArgs[1]}`);
    } else {
      console.error('usage: node scripts/pin-images.ts check [--require-pinned] | write <digest-map.json>');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
