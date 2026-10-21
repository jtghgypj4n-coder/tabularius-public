// Generate the settings and CLI reference from the CLI's help text, code, and
// reviewed notes in settings-cli-metadata.json. --check is a read-only drift gate.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

type Entry = { description?: string; default?: string; accepted?: string; restart?: string; explainedBy?: string; exitCodes?: string; example?: string };
type Metadata = { intro: string; clientExampleNote: string; environment: Record<string, Entry>; serveFlags: Record<string, Entry>; commands: Record<string, Entry> };

const root = join(import.meta.dirname, '..');
const metadata = JSON.parse(readFileSync(join(root, 'scripts/reference/settings-cli-metadata.json'), 'utf8')) as Metadata;
const main = readFileSync(join(root, 'packages/cli/src/main.ts'), 'utf8');
const usage = main.split('const USAGE = `')[1]?.split('`;')[0];
if (!usage) throw new Error('Cannot find CLI help text in main.ts');
const names = (text: string) => new Set([...text.matchAll(/\bTABULARIUS_[A-Z0-9_]*[A-Z0-9]\b/g)].map((m) => m[0]));
const commands = new Set([...usage.matchAll(/^ {2}tabularius ([a-z][\w-]*)/gm)].map((m) => m[1]));
const subcommands = new Set(['show', 'save', 'account', 'external', 'policy', 'must-change', 'grant', 'revoke']);
const dispatched = new Set([...main.matchAll(/^ {4}case '([a-z][\w-]*)':/gm)].map((m) => m[1]).filter((name) => !subcommands.has(name)));
const absentCommands = [...dispatched].filter((name) => !commands.has(name));
if (absentCommands.length) throw new Error(`CLI commands missing from help: ${absentCommands.sort().join(', ')}`);
const serveHelp = usage.split('  tabularius serve ', 2)[1]?.split('  tabularius standby ', 1)[0];
if (!serveHelp) throw new Error('Cannot find serve help text');
const serveFlags = new Set([...serveHelp.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]));
const serveCode = main.split("    case 'serve': {")[1]?.split("    case '")[0];
if (!serveCode) throw new Error('Cannot find serve implementation');
const helperNames = ['aiExcludeFrom', 'mcpOriginsFrom', 'outboundFlags', 'mailFlags'];
const helperCode = helperNames.map((name) => {
  const start = main.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Cannot find serve option helper ${name}`);
  const end = main.indexOf('\nfunction ', start + 1);
  return main.slice(start, end < 0 ? undefined : end);
}).join('\n');
const codeFlags = new Set([
  ...[...(serveCode + helperCode).matchAll(/(?:flag|bool|optionValue)\((?:args|a),\s*['"](--[a-z][a-z0-9-]*)/g)].map((m) => m[1]),
  ...[...(serveCode + helperCode).matchAll(/args\.includes\(['"](--[a-z][a-z0-9-]*)['"]\)/g)].map((m) => m[1]),
]);
const absentFromHelp = [...codeFlags].filter((flag) => !serveFlags.has(flag));
if (absentFromHelp.length) throw new Error(`Serve flags missing from CLI help: ${absentFromHelp.sort().join(', ')}`);

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|js|cjs|mjs)$/.test(path) && (dir.startsWith('scripts') || path.includes('/src/')) ? [path] : [];
  });
}
const sources = [...sourceFiles('packages'), ...sourceFiles('scripts').filter((p) => p !== 'scripts/docs-settings-cli.ts')].sort();
const sourceLines = new Map(sources.map((file) => [file, readFileSync(join(root, file), 'utf8').split('\n')] as const));
const environment = new Set([...sourceLines.values()].flatMap((lines) => [...names(lines.join('\n'))]));

function checkEntries(kind: string, found: Set<string>, entries: Record<string, Entry>, fields: (keyof Entry)[]): void {
  const missing = [...found].filter((name) => !entries[name]).sort();
  const stale = Object.keys(entries).filter((name) => !found.has(name)).sort();
  const incomplete = Object.entries(entries).filter(([, entry]) => fields.some((field) => !entry[field])).map(([name]) => name);
  if (missing.length || stale.length || incomplete.length) throw new Error(`${kind} metadata coverage: missing ${missing.join(', ') || 'none'}; stale ${stale.join(', ') || 'none'}; incomplete ${incomplete.join(', ') || 'none'}`);
}
checkEntries('environment', environment, metadata.environment, ['description', 'default', 'accepted', 'restart', 'explainedBy']);
checkEntries('serve flags', serveFlags, metadata.serveFlags, ['default', 'accepted', 'explainedBy']);
checkEntries('commands', commands, metadata.commands, ['exitCodes', 'example']);
for (const [kind, entries] of [['environment', metadata.environment], ['serve flag', metadata.serveFlags]] as const) {
  for (const [name, entry] of Object.entries(entries)) {
    const path = join(root, entry.explainedBy!);
    if (!existsSync(path)) throw new Error(`${kind} ${name}: guide ${entry.explainedBy} does not exist`);
    if (!['docs/environment-variables.md', 'docs/reference/settings/serve-flags.md'].includes(entry.explainedBy!) && !readFileSync(path, 'utf8').includes(name)) {
      throw new Error(`${kind} ${name}: guide ${entry.explainedBy} does not name the setting`);
    }
  }
}

const generated = new Map<string, string>();
const envPath = (name: string) => `docs/reference/settings/environment/${name.toLowerCase()}.md`;
const flagPath = (name: string) => `docs/reference/settings/serve/${name.slice(2)}.md`;
const cmdPath = (name: string) => `docs/reference/cli/${name}.md`;
const link = (from: string, to: string) => relative(dirname(from), to).replaceAll('\\', '/');
const code = (value: string) => `\`${value.replaceAll('`', '\\`')}\``;
const rebaseLinks = (text: string, from: string, to: string) => text.replace(/\]\(([^)#]+)(#[^)]+)?\)/g, (whole, target: string, hash = '') => {
  if (/^(?:[a-z]+:|\/)/i.test(target)) return whole;
  return `](${link(to, join(dirname(from), target))}${hash})`;
});
const directLocations = new Map<string, string>();
const mentionedLocations = new Map<string, string>();
for (const [file, lines] of sourceLines) {
  if (file === 'packages/store/src/legacy-env.ts') continue;
  lines.forEach((line, index) => {
    if (!line.includes('TABULARIUS_')) return;
    for (const name of names(line)) if (!mentionedLocations.has(name)) mentionedLocations.set(name, `${file}:${index + 1}`);
    for (const match of line.matchAll(/(?:process\.env|\benv)\.(TABULARIUS_[A-Z0-9_]+)/g)) {
      if (!directLocations.has(match[1])) directLocations.set(match[1], `${file}:${index + 1}`);
    }
  });
}
const sourceLine = (name: string) => directLocations.get(name) ?? mentionedLocations.get(name);
const flagLine = (flag: string): number | undefined => {
  const lines = main.split('\n');
  const line = lines.findIndex((text) => new RegExp(`(?:flag|bool|optionValue)\\((?:args|a),\\s*['"]${flag}['"]`).test(text));
  return line < 0 ? undefined : line + 1;
};

const envIndex = 'docs/environment-variables.md';
const envRows: string[] = [];
for (const [name, entry] of Object.entries(metadata.environment).sort(([a], [b]) => a.localeCompare(b))) {
  const path = envPath(name);
  const guide = `[${entry.explainedBy}](${link(path, entry.explainedBy!)})`;
  const location = sourceLine(name);
  generated.set(path, `# ${name}\n\n${rebaseLinks(entry.description!, envIndex, path)}\n\n| Setting | Value |\n| --- | --- |\n| Default | ${entry.default} |\n| Accepted values | ${entry.accepted} |\n| Restart needed | ${entry.restart} |\n| Explained in | ${guide} |\n${location ? `| Code | [${location}](${link(path, location.split(':')[0])}#L${location.split(':')[1]}) |\n` : ''}\n[All environment variables](${link(path, envIndex)})\n`);
  envRows.push(`| [${code(name)}](${link(envIndex, path)}) | ${entry.default} | ${entry.accepted} | ${entry.restart} | [${entry.explainedBy}](${link(envIndex, entry.explainedBy!)}) |`);
}
generated.set(envIndex, `# Environment variables\n\n${metadata.intro}\n\nThis table is generated from the notes in \`scripts/reference/settings-cli-metadata.json\`. Each linked page gives the setting's details and code location. See [serve flags](reference/settings/serve-flags.md) and the [command-line reference](reference/cli/index.md).\n\n| Variable | Default | Accepted values | Restart needed | Guide |\n| --- | --- | --- | --- | --- |\n${envRows.join('\n')}\n\n## Names that appear in the documentation but are not read by the server\n\n${metadata.clientExampleNote}\n`);

const flagIndex = 'docs/reference/settings/serve-flags.md';
const flagRows: string[] = [];
for (const [flag, entry] of Object.entries(metadata.serveFlags).sort(([a], [b]) => a.localeCompare(b))) {
  const path = flagPath(flag);
  const specialEnv: Record<string, string> = { '--keep': 'TABULARIUS_BACKUP_KEEP', '--mcp-origin': 'TABULARIUS_MCP_ORIGINS', '--s3-region': 'TABULARIUS_S3_REGION', '--s3-endpoint': 'TABULARIUS_S3_ENDPOINT', '--capture-only': 'TABULARIUS_CAPTURE_ONLY' };
  const env = Object.keys(metadata.environment).filter((name) => main.includes(`'${flag}') ?? process.env.${name}`) || specialEnv[flag] === name);
  const equivalent = env.length ? env.map((name) => `[${code(name)}](${link(path, envPath(name))})`).join(', ') : flag === '--port' ? code('PORT') : 'No direct environment equivalent';
  const location = flagLine(flag);
  generated.set(path, `# tabularius serve ${flag}\n\n${code(flag)} is a serve option. The full command usage is in [serve](${link(path, cmdPath('serve'))}).\n\n| Setting | Value |\n| --- | --- |\n| Default | ${entry.default} |\n| Accepted values | ${entry.accepted} |\n| Restart needed | Yes; serve flags are read when the server starts. |\n| Environment | ${equivalent} |\n| Explained in | [${entry.explainedBy}](${link(path, entry.explainedBy!)}) |\n${location ? `| Code | [packages/cli/src/main.ts:${location}](${link(path, 'packages/cli/src/main.ts')}#L${location}) |\n` : ''}\n[All serve flags](${link(path, flagIndex)})\n`);
  flagRows.push(`| [${code(flag)}](${link(flagIndex, path)}) | ${entry.default} | ${entry.accepted} | [${entry.explainedBy}](${link(flagIndex, entry.explainedBy!)}) |`);
}
generated.set(flagIndex, `# Serve flags\n\nThese are the options named by \`tabularius help serve\`. A flag takes precedence over the matching environment variable. Changes take effect when the server starts.\n\n| Flag | Default | Accepted values | Guide |\n| --- | --- | --- | --- |\n${flagRows.join('\n')}\n`);

function commandUsage(command: string): string {
  const lines = usage!.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^  tabularius ${command}(\\s|$)`).test(lines[i])) continue;
    out.push(lines[i]);
    while (i + 1 < lines.length && /^ {4,}\S/.test(lines[i + 1])) out.push(lines[++i]);
  }
  if (!out.length) throw new Error(`No help for ${command}`);
  return `Usage:\n${out.join('\n')}`;
}

const cliIndex = 'docs/reference/cli/index.md';
const cliRows: string[] = [];
for (const [command, entry] of Object.entries(metadata.commands).sort(([a], [b]) => a.localeCompare(b))) {
  const path = cmdPath(command);
  const help = commandUsage(command);
  const options = [...new Set([...help.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]))].sort();
  generated.set(path, `# tabularius ${command}\n\nThis command's usage comes from \`tabularius help ${command}\`. Statements comparing behavior with FileMaker in this program help are inferred from the implementation.\n\n## Usage\n\n\`\`\`text\n${help}\n\`\`\`\n\n## Options\n\n${options.length ? options.map(code).join(', ') : 'No command options are listed.'}\n\n## Exit codes\n\n${entry.exitCodes}\n\n## Tested CLI example\n\n\`\`\`sh\n${entry.example}\n\`\`\`\n\nThis example is executed by the CLI reference test.\n\n[All commands](${link(path, cliIndex)})\n`);
  cliRows.push(`| [${code(command)}](${link(cliIndex, path)}) | ${options.length} |`);
}
generated.set(cliIndex, `# Command-line reference\n\nEach command page includes the current help text, options, exit codes, and a tested example.\n\n| Command | Options in help |\n| --- | ---: |\n${cliRows.join('\n')}\n\n[Serve flags](${link(cliIndex, flagIndex)}) · [Environment variables](${link(cliIndex, envIndex)})\n`);

let stale = 0;
for (const [path, content] of generated) {
  const target = join(root, path);
  if (existsSync(target) && readFileSync(target, 'utf8') === content) continue;
  if (process.argv.includes('--check')) { console.error(`${path}: out of date`); stale++; }
  else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }
}
for (const directory of ['docs/reference/settings/environment', 'docs/reference/settings/serve', 'docs/reference/cli']) {
  if (!existsSync(join(root, directory))) continue;
  for (const file of readdirSync(join(root, directory))) {
    const path = join(directory, file);
    if (file.endsWith('.md') && !generated.has(path)) { console.error(`${path}: obsolete generated page`); stale++; }
  }
}
console.log(`settings/CLI reference: ${environment.size} variables, ${serveFlags.size} serve flags, ${commands.size} commands; ${stale} stale pages`);
if (stale) process.exitCode = 1;
