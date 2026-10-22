import assert from 'node:assert/strict';

/** Shared static assertions; no shell, downloads or PowerShell execution. */
export function checkWindowsInstallerChecksum(ps: string): void {
  assert.match(ps, /function Die\([^\n]+Write-Error[^\n]+exit 1/);
  const start = ps.indexOf('  $file = "node-v$NodeVersion-win-$arch.zip"');
  const end = ps.indexOf('  Expand-Archive -Path $zip');
  assert.ok(start >= 0 && end > start);
  const check = ps.slice(start, end);
  assert.match(check, /\$dist = "https:\/\/nodejs\.org\/dist\/v\$NodeVersion"/);
  assert.match(check, /Invoke-WebRequest[^\n]+-Uri "\$dist\/\$file" -OutFile \$zip/);
  assert.match(check, /\$sums = Join-Path \$tmp 'SHASUMS256.txt'/);
  assert.match(check, /Invoke-WebRequest[^\n]+-Uri "\$dist\/SHASUMS256.txt" -OutFile \$sums/);
  assert.match(check, /\$expected = '<missing>'/);
  assert.match(check, /foreach \(\$line in \(Get-Content -LiteralPath \$sums\)\)/);
  // The anchored pattern captures the complete filename, accepting CRLF and the binary marker.
  assert.ok(check.includes('$line.TrimEnd("`r") -cmatch \'\\A([0-9a-fA-F]{64}) {1,2}\\*?(.*)\\z\' -and $Matches[2] -ceq $file'));
  assert.match(check, /\$expected = \$Matches\[1\]\s+break/);
  assert.match(check, /\$actual = \(Get-FileHash -Algorithm SHA256 -Path \$zip\)\.Hash/);
  assert.match(check, /if \(\$expected -eq '<missing>' -or \$actual -ne \$expected\) \{\s+Die "SHA256 mismatch for \$\{file\}: expected \$expected, actual \$actual"\s+\}/);
  // Download, hashing and extraction all stay inside try; cleanup targets only the temp folder.
  assert.match(ps, /New-Item[^\n]+-Path \$tmp[^\n]+\n  try \{/);
  const tryStart = ps.indexOf('  try {', ps.indexOf('$tmp = Join-Path'));
  const finallyStart = ps.indexOf('  } finally {', tryStart);
  assert.ok(tryStart >= 0 && tryStart < start && finallyStart > end);
  assert.ok(ps.indexOf("Move-Item -LiteralPath (Join-Path $OhHome 'node') -Destination $previousNode") > end);
  assert.ok(ps.indexOf('Move-Item -LiteralPath $previousNode -Destination', end) > end);
  assert.doesNotMatch(ps, /Remove-Item[^\n]+\(Join-Path \$OhHome 'node'\)/);
  assert.match(ps.slice(finallyStart), /^  \} finally \{\s+Remove-Item -LiteralPath \$tmp -Recurse -Force\s+\}\s+\$Node = \$own/);
}
