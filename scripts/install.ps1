# Install Tabularius with one command, on Windows (PowerShell 5.1 or 7):
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1                    from a checkout
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Service C:\Databases
#                                     ...and run it as a service that hosts that folder
#
# It uses Node 22.20+ if you have it, and otherwise downloads Node into
# %USERPROFILE%\.openhbam\node (nothing is installed system-wide). It puts an
# `tabularius` command in %USERPROFILE%\.openhbam\bin and adds that to your PATH.
# Run from outside a checkout, it clones the repository into
# %USERPROFILE%\.openhbam\app (needs Git; set TABULARIUS_REPO for another URL).
#
# Service options: -Port 8080, -HostName 127.0.0.1 (default: this machine only;
# 0.0.0.0 reaches the network and needs HTTPS: -ServeArgs '--https','local'), -ServeArgs for more
# `tabularius serve` options, e.g. -ServeArgs '--sql-port','5432'.
#
#   -System      run at boot without anyone signed in, as the system account
#                (run from an administrator prompt; also opens the port in
#                Windows Firewall)
#   -Print       show the Task Scheduler task instead of installing it
#   -Uninstall   stop the service and remove it (hosted files are kept)
#   -Upgrade     update to the newest version in place: back up the hosted
#                folder, restart the service on the new version, and go back
#                to the old one if it doesn't start (tabularius upgrade)

param(
  [string]$Service,
  [int]$Port = 8080,
  [string]$HostName = '127.0.0.1',
  [switch]$System,
  [switch]$Print,
  [switch]$Uninstall,
  [switch]$Upgrade,
  [string[]]$ServeArgs = @()
)

$ErrorActionPreference = 'Stop'
$OhHome = if ($env:TABULARIUS_HOME) { $env:TABULARIUS_HOME } elseif ($env:OPENHBAM_HOME) { $env:OPENHBAM_HOME } else { Join-Path $env:USERPROFILE '.openhbam' }
$Repo = if ($env:TABULARIUS_REPO) { $env:TABULARIUS_REPO } elseif ($env:OPENHBAM_REPO) { $env:OPENHBAM_REPO } else { 'https://github.com/sitotisai/tabularius.git' }
$NodeVersion = '22.22.0'

function Say([string]$m) { Write-Host "==> $m" }
function Die([string]$m) { Write-Error "error: $m"; exit 1 }

# --- Node ------------------------------------------------------------------

function Test-Node([string]$exe) {
  try {
    $v = [version](& $exe -p 'process.versions.node' 2>$null)
    return $v -ge [version]'22.20.0'
  } catch {
    return $false
  }
}

$Node = $null
$found = Get-Command node -ErrorAction SilentlyContinue
$own = Join-Path $OhHome 'node\node.exe'
if ($found -and (Test-Node $found.Source)) {
  $Node = $found.Source
} elseif ((Test-Path $own) -and (Test-Node $own)) {
  $Node = $own
} else {
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
    if (Test-Path (Join-Path $OhHome 'node')) { Remove-Item -Recurse -Force (Join-Path $OhHome 'node') }
    Move-Item (Join-Path $tmp "node-v$NodeVersion-win-$arch") (Join-Path $OhHome 'node')
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
  $Node = $own
}
$NodeDir = Split-Path $Node
$Npm = Join-Path $NodeDir 'npm.cmd'
if (-not (Test-Path $Npm)) { $Npm = (Get-Command npm.cmd).Source }
Say "Using Node $(& $Node -v) at $Node"

# --- the app -----------------------------------------------------------------

$here = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { $null }
if ($here -and (Test-Path (Join-Path $here 'packages\cli\src\main.ts'))) {
  $App = $here
} else {
  $App = Join-Path $OhHome 'app'
  if ($Upgrade -or $Uninstall) {
    if (-not (Test-Path (Join-Path $App '.git'))) { Die "Tabularius isn't installed in $App" }
  } elseif (Test-Path (Join-Path $App '.git')) {
    Say "Updating $App"
    git -C $App pull --ff-only
    if ($LASTEXITCODE) { Die 'git pull failed' }
  } else {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'Git is needed to fetch tabularius: install Git for Windows, then run this again' }
    Say "Cloning $Repo into $App"
    git clone --depth 1 $Repo $App
    if ($LASTEXITCODE) { Die 'git clone failed' }
  }
}
$Cli = Join-Path $App 'packages\cli\src\main.ts'
$env:TABULARIUS_HOME = $OhHome
$env:PATH = "$NodeDir;$env:PATH"

# Upgrading fetches the new version itself, so it can go back if it doesn't start.
if ($Upgrade) { & $Node --no-warnings $Cli upgrade; exit $LASTEXITCODE }
if ($Uninstall) { & $Node --no-warnings $Cli service uninstall --platform win32; exit $LASTEXITCODE }

if (-not $Print) {
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
  Set-Content -Encoding ASCII -Path (Join-Path $bin 'tabularius.cmd') -Value "@`"$Node`" --no-warnings `"$Cli`" %*"
  # The command was called openhbam before it was Tabularius; that name keeps working.
  Set-Content -Encoding ASCII -Path (Join-Path $bin 'openhbam.cmd') -Value "@`"$Node`" --no-warnings `"$Cli`" %*"
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
$serviceArgs = @('--no-warnings', $Cli, 'service', $action, $Service, '--platform', 'win32', '--port', "$Port", '--host', $HostName)
if ($System) { $serviceArgs += '--system' }
$serviceArgs += '--'
$serviceArgs += $ServeArgs
& $Node @serviceArgs
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if ($System -and -not $Print -and $HostName -ne '127.0.0.1') {
  # Others on the network reach it only once the firewall lets them in.
  if (-not (Get-NetFirewallRule -DisplayName 'tabularius' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'tabularius' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Say "Opened TCP port $Port in Windows Firewall"
  }
} elseif (-not $Print -and $HostName -ne '127.0.0.1') {
  Say "If others can't reach it, allow TCP port $Port in Windows Firewall (or install with -System as administrator)"
}
