import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../../scripts/install.ps1', import.meta.url), 'utf8');

// A lexical check, not a PowerShell parser: comments, quoted strings and escaped quotes
// are removed before matching blocks. Real PowerShell 5.1/7 execution remains unverified.
function validate(text: string): void {
  const stack: string[] = [];
  let quote = '', clean = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '`') { i++; continue; }
      if (c === quote) { if (text[i + 1] === quote) i++; else quote = ''; }
      continue;
    }
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; clean += '\n'; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('({['.includes(c)) stack.push(c);
    if (')}]'.includes(c)) assert.equal(stack.pop(), ({ ')': '(', '}': '{', ']': '[' } as Record<string, string>)[c], 'unbalanced block');
    clean += c;
  }
  assert.equal(quote, '', 'unbalanced quote');
  assert.deepEqual(stack, [], 'unclosed block');
  assert.doesNotMatch(clean, /&&|\|\||\b(?:then|fi|esac|sudo)\b|\bset\s+-[eu]|\bexport\s+\w+=/, 'bash syntax');
}

test('installer is lexically balanced and the checker detects broken strings, blocks and bash syntax', () => {
  validate(script);
  for (const broken of [script + '\n"unclosed', script + '\n{', script + '\n}', script + '\nif true; then', script + '\nset -eu'])
    assert.throws(() => validate(broken));
});
test('installer fails closed and validates downloads before extraction', () => {
  assert.match(script, /\$ErrorActionPreference = 'Stop'/);
  assert.match(script, /\$LASTEXITCODE/);
  assert.match(script, /finally\s*\{/);
  assert.ok(script.indexOf('Get-FileHash -Algorithm SHA256') < script.indexOf('Expand-Archive'));
  assert.match(script, /SHA256 mismatch/);
  assert.doesNotMatch(script, /Invoke-Expression|\biex\b|^\s*git (?:clone|-C)/m);
});
test('installer preflights elevation, offline actions and firewall ownership before changing state', () => {
  assert.match(script, /WindowsPrincipal/);
  assert.ok(script.indexOf('WindowsPrincipal') < script.indexOf('# --- Node'));
  assert.match(script, /\$Print -or \$Uninstall/);
  assert.match(script, /Remove-NetFirewallRule/);
  assert.match(script, /Set-NetFirewallRule/);
  assert.match(script, /::1/);
  assert.doesNotMatch(script, /ExecutionPolicy Bypass/);
});
test('generated command uses explicit encoding and protects percent and delayed expansion', () => {
  assert.match(script, /DisableDelayedExpansion/);
  assert.match(script, /Replace\('%', '%%'\)/);
  assert.match(script, /UTF8Encoding/);
  assert.match(script, /chcp 65001/);
});

test('Node replacement preserves the previous install until publication and can restore it', () => {
  const verified = script.indexOf('Get-FileHash -Algorithm SHA256');
  const saved = script.indexOf("Move-Item -LiteralPath (Join-Path $OhHome 'node') -Destination $previousNode");
  const published = script.indexOf('Move-Item -LiteralPath (Join-Path $tmp "node-v$NodeVersion-win-$arch")');
  const rollback = script.indexOf('Move-Item -LiteralPath $previousNode -Destination', published);
  assert.ok(verified < saved && saved < published && published < rollback);
  assert.doesNotMatch(script, /Remove-Item[^\n]+\(Join-Path \$OhHome 'node'\)/);
  assert.ok(script.indexOf("$Npm = Join-Path") > script.indexOf('if ($Uninstall) {'));
});

import { checkWindowsInstallerChecksum } from './install-powershell-checks.ts';
test('existing exact-checksum and cleanup assertions remain valid', () => checkWindowsInstallerChecksum(script));
