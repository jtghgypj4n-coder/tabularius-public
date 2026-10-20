// Shared test-only source grep and syntax inspection. TypeScript is already a dev dependency.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

export { ts };
const root = resolve(import.meta.dirname, '../../..');
export const source = (file: string) => readFileSync(join(root, file), 'utf8');
export const parse = (code: string) => ts.createSourceFile('surface.ts', code, ts.ScriptTarget.Latest, true);
export function nodes<T extends ts.Node>(node: ts.Node, predicate: (n: ts.Node) => n is T): T[] {
  const found: T[] = [];
  const visit = (n: ts.Node) => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); };
  visit(node);
  return found;
}
export function calls(node: ts.Node, pattern: RegExp): ts.CallExpression[] {
  return nodes(node, ts.isCallExpression).filter((c) => pattern.test(c.expression.getText()));
}
export function body(tree: ts.Node, name: string): ts.Node {
  const found = nodes(tree, (n): n is ts.FunctionDeclaration | ts.MethodDeclaration =>
    ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)).find((n) => n.name?.getText() === name)?.body;
  assert.ok(found, `missing function ${name}`);
  return found;
}
export function owner(node: ts.Node): string {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if (ts.isPropertyAssignment(n) && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.getText();
  }
  return '<module>';
}

/** Grep source files, including newly added files; no shell or rg installation needed in CI. */
export function grep(directory: string, pattern: RegExp): { file: string; match: string }[] {
  const found: { file: string; match: string }[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...grep(file, pattern));
    else if (file.endsWith('.ts')) for (const m of source(file).matchAll(new RegExp(pattern.source, 'gm'))) {
      found.push({ file, match: m[0] });
    }
  }
  return found;
}
