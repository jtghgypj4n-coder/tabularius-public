// Linux resolves path components by their exact spelling. Check references on every host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../../..');

function files(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path, extensions) : entry.isFile() && extensions.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

/** Compare each component with the directory entry, even on a case insensitive host. */
function exactCase(path: string): boolean {
  const absolute = resolve(path);
  if (!absolute.startsWith(root + sep) && absolute !== root) return false;
  let parent = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    try {
      if (!readdirSync(parent).includes(part)) return false;
      parent = join(parent, part);
    } catch { return false; }
  }
  return true;
}

function staticAsset(node: ts.Node): string | undefined {
  if (ts.isNewExpression(node) && node.expression.getText() === 'URL' &&
      node.arguments?.length === 2 && ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[1].getText() === 'import.meta.url') return node.arguments[0].text;
  if (ts.isCallExpression(node) && ts.isCallExpression(node.parent) && node.parent.expression.getText() === 'readFileSync' &&
      node.expression.getText() === 'join' &&
      node.arguments[0]?.getText() === 'import.meta.dirname' &&
      node.arguments.slice(1).every(ts.isStringLiteralLike)) {
    return node.arguments.slice(1).map((part) => (part as ts.StringLiteral).text).join('/');
  }
  return undefined;
}

test('case guard recognizes wrong case on any host', () => {
  assert.equal(exactCase(join(root, 'package.json')), true);
  assert.equal(exactCase(join(root, 'PACKAGE.json')), false);
});

test('relative TypeScript imports and import.meta assets have exact file name case', () => {
  const problems: string[] = [];
  for (const pkg of readdirSync(join(root, 'packages'))) {
    for (const area of ['src', 'test']) {
      const dir = join(root, 'packages', pkg, area);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      for (const file of files(dir, ['.ts', '.tsx', '.js', '.mjs', '.cjs'])) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const check = (specifier: string, node: ts.Node) => {
          if (!specifier.startsWith('.')) return;
          const target = resolve(dirname(file), specifier);
          if (!exactCase(target)) problems.push(`${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${specifier}`);
        };
        const walk = (node: ts.Node) => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
            check(node.moduleSpecifier.text, node);
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0]))
            check(node.arguments[0].text, node);
          const asset = staticAsset(node);
          if (asset?.startsWith('.')) check(asset, node);
          ts.forEachChild(node, walk);
        };
        walk(source);
      }
    }
  }
  assert.deepEqual(problems, [], `case mismatches:\n${problems.join('\n')}`);
});

test('relative docs links have exact path case', () => {
  const problems: string[] = [];
  const docs = files(join(root, 'docs'), ['.md']);
  for (const name of ['README.md', 'ADMIN.md', 'QUICKSTART.md', 'SECURITY.md']) docs.push(join(root, name));
  for (const file of docs) {
    const prose = readFileSync(file, 'utf8').replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
      .replace(/`[^`\n]*`/g, (match) => match.replace(/[[\]()]/g, ' '));
    for (const match of prose.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1].split('#')[0];
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || isAbsolute(href)) continue;
      const target = resolve(dirname(file), decodeURIComponent(href));
      if (!exactCase(target)) problems.push(`${relative(root, file)}: ${href}`);
    }
  }
  assert.deepEqual(problems, [], `case mismatches:\n${problems.join('\n')}`);
});
