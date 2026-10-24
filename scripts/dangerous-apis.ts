import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import ts from 'typescript';

export interface DangerousFinding { file: string; line: number; fn: string; kind: string; hash: string }
export interface DangerousAllowance { file: string; fn: string; kind: string; hash: string; reason: string }
const digest = (text: string) => createHash('sha256').update(text.replace(/\s+/g, ' ')).digest('hex').slice(0, 20);
const sourceFiles = (root: string) => {
  const dir = join(root, 'packages/server/src');
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name) ? [file] : [];
  });
  return walk(dir).sort();
};
function functionName(node: ts.Node): string {
  const names: string[] = [];
  const text = (n: ts.Node) => n.getText(node.getSourceFile());
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isConstructorDeclaration(p))
      names.unshift(ts.isConstructorDeclaration(p) ? 'constructor' : p.name ? text(p.name) : '<anonymous>');
    else if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      if (ts.isVariableDeclaration(p.parent) || ts.isPropertyAssignment(p.parent)) names.unshift(text(p.parent.name));
    } else if (ts.isClassDeclaration(p) && p.name) names.unshift(p.name.text);
  }
  return names.join('/') || '<module>';
}
function isShellTrue(node: ts.CallExpression): boolean {
  return node.arguments.some((arg) => ts.isObjectLiteralExpression(arg) && arg.properties.some((property) =>
    ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) ? property.name.text : ts.isStringLiteral(property.name) ? property.name.text : '') === 'shell' && property.initializer.kind === ts.SyntaxKind.TrueKeyword));
}
export function collectDangerousApis(root = resolve(import.meta.dirname, '..'), overrides = new Map<string, string>()): DangerousFinding[] {
  const files = sourceFiles(root);
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, allowImportingTsExtensions: true, allowJs: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = (path) => overrides.get(relative(root, path)) ?? read(path);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = host.readFile(fileName);
    return source === undefined ? getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(fileName, source, languageVersion, true);
  };
  const program = ts.createProgram(files, options, host);
  const included = new Set(files);
  const findings: DangerousFinding[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!included.has(sf.fileName)) continue;
    const childNames = new Set<string>();
    for (const statement of sf.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && /^(node:)?child_process$/.test(statement.moduleSpecifier.text)) {
      const clause = statement.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) childNames.add(el.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) childNames.add(clause.namedBindings.name.text);
    }
    const add = (node: ts.Node, kind: string) => findings.push({ file: relative(root, sf.fileName), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      fn: functionName(node), kind, hash: digest(node.getText(sf)) });
    const visit = (node: ts.Node) => {
      if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
        const caught = node.variableDeclaration.name.text;
        const findLogs = (part: ts.Node) => {
          if (ts.isCallExpression(part) && ts.isPropertyAccessExpression(part.expression) && ts.isIdentifier(part.expression.expression) && part.expression.expression.text === 'console' && part.expression.name.text === 'error' && part.arguments.length === 1 && ts.isIdentifier(part.arguments[0]) && part.arguments[0].text === caught) add(part, 'uncaught-error-log');
          ts.forEachChild(part, findLogs);
        };
        findLogs(node.block);
      }
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === 'eval' || name === 'Function') add(node, 'dynamic-code');
        else if (childNames.has(name) && ((['exec', 'execSync'].includes(name)) || (['spawn', 'spawnSync'].includes(name) || /^execFile/.test(name)) && isShellTrue(node as ts.CallExpression))) add(node, 'shell-child-process');
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (ts.isIdentifier(node.expression.expression) && childNames.has(node.expression.expression.text) && ((['exec', 'execSync'].includes(name)) || (['spawn', 'spawnSync'].includes(name) || /^execFile/.test(name)) && isShellTrue(node))) add(node, 'shell-child-process');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
}
export function validateAllowlist(found: DangerousFinding[], allowed: DangerousAllowance[]) {
  const key = (f: Pick<DangerousFinding, 'file' | 'fn' | 'kind' | 'hash'>) => JSON.stringify([f.file, f.fn, f.kind, f.hash]);
  const actual = new Set(found.map(key));
  const expected = new Set(allowed.map(key));
  return { missing: found.filter((f) => !expected.has(key(f))), stale: allowed.filter((a) => !actual.has(key(a))), withoutReason: allowed.filter((a) => !a.reason?.trim()) };
}
export function allowlistErrors(found: DangerousFinding[], allowed: DangerousAllowance[]): string[] {
  const result = validateAllowlist(found, allowed);
  return [
    ...result.missing.map((f) => `${f.file}:${f.line}: ${f.kind} in ${f.fn}; use logFault / logFaultFor from fault-log.ts for caught errors, or add a reasoned entry to scripts/dangerous-apis-allowlist.json`),
    ...result.stale.map((f) => `stale allow-list entry: ${f.file} ${f.fn} ${f.kind} ${f.hash}`),
    ...result.withoutReason.map((f) => `allow-list entry has no reason: ${f.file} ${f.fn} ${f.kind} ${f.hash}`),
  ];
}
function main() {
  const root = resolve(import.meta.dirname, '..');
  const path = join(root, 'scripts/dangerous-apis-allowlist.json');
  const found = collectDangerousApis(root);
  const allowed = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as DangerousAllowance[] : [];
  if (process.argv.includes('--write')) {
    const keys = new Set(allowed.map((a) => JSON.stringify([a.file, a.fn, a.kind, a.hash])));
    const additions = found.filter((f) => !keys.has(JSON.stringify([f.file, f.fn, f.kind, f.hash]))).map(({ file, fn, kind, hash }) => ({ file, fn, kind, hash, reason: '' }));
    writeFileSync(path, `${JSON.stringify([...allowed, ...additions], null, 2)}\n`);
    return;
  }
  const errors = allowlistErrors(found, allowed);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${found.length} dangerous API findings; all allowed`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
