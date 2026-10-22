# Install Tabularius with one command, on Windows (PowerShell 5.1 or 7):
#
#   powershell -NoProfile -File scripts\install.ps1                    from a checkout
#   powershell -NoProfile -File scripts\install.ps1 -Service C:\Databases
#                                     ...and run it as a service that hosts that folder
#
# It uses Node 22.20+ if you have it, and otherwise downloads Node into
# %USERPROFILE%\.openhbam\node (nothing is installed system-wide). It puts an
# `tabularius` command in %USERPROFILE%\.openhbam\bin and adds that to your PATH.
# Run from a trusted local checkout. This installer never fetches executable app
# source from a moving branch. Verify release checksums before extracting a release.
# If execution policy blocks this script, follow your organization's signing policy;
# the installer does not bypass it.
#
# Service options: -Port 8080, -HostName (default: this machine only, or every
# address when -ServeArgs '--https','files.example.com' asks for a certificate; 0.0.0.0
# reaches the network and needs HTTPS: -ServeArgs '--https','local'), -ServeArgs for more
# `tabularius serve` options, e.g. -ServeArgs '--sql-port','5432'.
#
#   -System      run at boot without anyone signed in, as the system account
#                (run from an administrator prompt; also opens the port in
#                Windows Firewall)
#   -Print       show the Task Scheduler task instead of installing it
#   -Uninstall   stop the service and remove it (hosted files are kept)
#   -Upgrade     refused here: use tabularius upgrade --from with a trusted local
#                release after verifying its published checksum

param(
  [string]$Service,
  [int]$Port = 8080,
  [string]$HostName = '',
  [switch]$System,
  [switch]$Print,
  [switch]$Uninstall,
  [switch]$Upgrade,
  [string[]]$ServeArgs = @()
)

$ErrorActionPreference = 'Stop'
$OhHome = if ($env:TABULARIUS_HOME) { $env:TABULARIUS_HOME } elseif ($env:OPENHBAM_HOME) { $env:OPENHBAM_HOME } else { Join-Path $env:USERPROFILE '.openhbam' }
$NodeVersion = '22.22.0'

function Say([string]$m) { Write-Host "==> $m" }
function Die([string]$m) { Write-Error "error: $m"; exit 1 }

# Validate actions before downloading, installing dependencies or changing a task.
if ($Upgrade) { Die 'Use tabularius upgrade --from <trusted local release>; this installer does not execute unverified remote app code' }
if ($Uninstall -and ($Service -or $Print)) { Die '-Uninstall cannot be combined with -Service or -Print' }
if ($Port -lt 1 -or $Port -gt 65535) { Die '-Port must be between 1 and 65535' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($System -and -not $Print -and -not $isAdmin) { Die '-System needs an administrator prompt' }
$here = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { $null }
$App = if ($here -and (Test-Path -LiteralPath (Join-Path $here 'packages\cli\src\main.ts'))) { $here } else { Join-Path $OhHome 'app' }
$Cli = Join-Path $App 'packages\cli\src\main.ts'
if (-not (Test-Path -LiteralPath $Cli)) { Die 'Run this installer from a trusted local checkout or verified extracted release' }

# --- Node ------------------------------------------------------------------

function Test-Node([string]$exe) {
  try {
    $v = [version](& $exe -p 'process.versions.node' 2>$null)
    return ($LASTEXITCODE -eq 0 -and $v -ge [version]'22.20.0')
  } catch {
    return $false
  }
}

$Node = $null
$found = Get-Command node -ErrorAction SilentlyContinue
$own = Join-Path $OhHome 'node\node.exe'
# Recover an interrupted Node replacement before trying to download anything.
$previousNode = Join-Path $OhHome 'node.previous'
if (-not ($Print -or $Uninstall) -and (Test-Path -LiteralPath $previousNode) -and -not (Test-Path -LiteralPath (Join-Path $OhHome 'node'))) {
  Move-Item -LiteralPath $previousNode -Destination (Join-Path $OhHome 'node')
}
if ($found -and (Test-Node $found.Source)) {
  $Node = $found.Source
} elseif ((Test-Path $own) -and (Test-Node $own)) {
  $Node = $own
} else {
  if ($Print -or $Uninstall) { Die 'A compatible local Node is required; this action does not download or install Node' }
  $arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { Die "unsupported CPU $env:PROCESSOR_ARCHITECTURE" } }
  Say "Downloading Node $NodeVersion into $OhHome\node"
  New-Item -ItemType Directory -Force -Path $OhHome | Out-Null
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("tabularius-node-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'node.zip'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $file = "node-v$NodeVersion-win-$arch.zip"
    $dist = "https://nodejs.org/dist/v$NodeVersion"
    $sums = Join-Path $tmp 'SHASUMS256.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "$dist/$file" -OutFile $zip
    Invoke-WebRequest -UseBasicParsing -Uri "$dist/SHASUMS256.txt" -OutFile $sums
    $expected = '<missing>'
    foreach ($line in (Get-Content -LiteralPath $sums)) {
      if ($line.TrimEnd("`r") -cmatch '\A([0-9a-fA-F]{64}) {1,2}\*?(.*)\z' -and $Matches[2] -ceq $file) {
        $expected = $Matches[1]
        break
      }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
    if ($expected -eq '<missing>' -or $actual -ne $expected) {
      Die "SHA256 mismatch for ${file}: expected $expected, actual $actual"
    }
    Expand-Archive -Path $zip -DestinationPath $tmp
    if (Test-Path -LiteralPath $previousNode) { Die 'node.previous already exists; retain it and resolve the interrupted install before retrying' }
    if (Test-Path -LiteralPath (Join-Path $OhHome 'node')) {
      Move-Item -LiteralPath (Join-Path $OhHome 'node') -Destination $previousNode
    }
    try {
      Move-Item -LiteralPath (Join-Path $tmp "node-v$NodeVersion-win-$arch") -Destination (Join-Path $OhHome 'node')
    } catch {
      # Never remove the saved version if rollback itself fails.
      if (Test-Path -LiteralPath $previousNode) { Move-Item -LiteralPath $previousNode -Destination (Join-Path $OhHome 'node') }
      throw
    }
    if (Test-Path -LiteralPath $previousNode) { Remove-Item -LiteralPath $previousNode -Recurse -Force }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
  $Node = $own
}
$NodeDir = Split-Path $Node
Say "Using Node $(& $Node -v) at $Node"

# --- the app -----------------------------------------------------------------

$env:TABULARIUS_HOME = $OhHome
$env:PATH = "$NodeDir;$env:PATH"

# Uninstall uses the installed app and local Node, without installing dependencies.
if ($Uninstall) {
  & $Node --no-warnings $Cli service uninstall --platform win32
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  if ($isAdmin) {
    Get-NetFirewallRule -Name 'tabularius-server' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  } else {
    Say 'If a system firewall rule was installed, remove tabularius-server from an administrator prompt'
  }
  exit 0
}

if (-not $Print) {
  $Npm = Join-Path $NodeDir 'npm.cmd'
  if (-not (Test-Path -LiteralPath $Npm)) { $Npm = (Get-Command npm.cmd).Source }
  Say 'Installing dependencies'
  Push-Location $App
  try {
    & $Npm ci --omit=dev --ignore-scripts --no-audit --no-fund | Out-Null
    if ($LASTEXITCODE) { Die 'npm ci failed' }
  } finally {
    Pop-Location
  }
  $bin = Join-Path $OhHome 'bin'
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  # UTF-8 without BOM; switch CMD's code page before it reads non-ASCII paths.
  # Delayed expansion is disabled and literal percent signs are doubled.
  # CMD quoting/code-page behavior is unverified until the Windows checklist runs.
  $cmdNode = $Node.Replace('%', '%%')
  $cmdCli = $Cli.Replace('%', '%%')
  $wrapper = "@setlocal DisableDelayedExpansion`r`n@chcp 65001 >nul`r`n@`"$cmdNode`" --no-warnings `"$cmdCli`" %*`r`n@exit /b %errorlevel%`r`n"
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $bin 'tabularius.cmd'), $wrapper, $utf8)
  # Keep the deprecated command alias.
  [IO.File]::WriteAllText((Join-Path $bin 'openhbam.cmd'), $wrapper, $utf8)
  Say "Installed $bin\tabularius.cmd (and openhbam.cmd, its old name)"
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $bin)) {
    [Environment]::SetEnvironmentVariable('Path', ($(if ($userPath) { "$userPath;" } else { '' }) + $bin), 'User')
    Say "Added $bin to your PATH (open a new window to use Tabularius)"
  }
}

# --- service -------------------------------------------------------------------

if (-not $Service) { Say 'Done. Try: tabularius serve <folder of .fmp12 files>'; exit 0 }
$action = if ($Print) { 'print' } else { 'install' }
$serviceArgs = @('--no-warnings', $Cli, 'service', $action, $Service, '--platform', 'win32', '--port', "$Port")
if ($HostName) { $serviceArgs += @('--host', $HostName) }
if ($System) { $serviceArgs += '--system' }
$serviceArgs += '--'
$serviceArgs += $ServeArgs
& $Node @serviceArgs
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# Reachable from the network: a host other than this computer, or a certificate for a domain (which listens on every address).
$httpsAt = [array]::IndexOf($ServeArgs, '--https')
$reachable = if ($HostName) { $HostName -notin @('127.0.0.1', '::1', 'localhost') } else { $httpsAt -ge 0 -and $httpsAt + 1 -lt $ServeArgs.Count -and @('local', 'lan') -notcontains $ServeArgs[$httpsAt + 1] }
if ($System -and -not $Print -and $reachable) {
  # Others on the network reach it only once the firewall lets them in.
  if (-not (Get-NetFirewallRule -Name 'tabularius-server' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'tabularius-server' -DisplayName 'tabularius' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Say "Opened TCP port $Port in Windows Firewall"
  } else {
    Set-NetFirewallRule -Name 'tabularius-server' -LocalPort $Port -Protocol TCP -Action Allow | Out-Null
  }
} elseif ($System -and -not $Print) {
  Get-NetFirewallRule -Name 'tabularius-server' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
} elseif (-not $Print -and $reachable) {
  Say "If others can't reach it, allow TCP port $Port in Windows Firewall (or install with -System as administrator)"
}
