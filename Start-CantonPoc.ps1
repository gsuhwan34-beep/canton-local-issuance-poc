[CmdletBinding(DefaultParameterSetName = 'Start')]
param(
    [Parameter(ParameterSetName = 'Start')][switch]$Prepare,
    [Parameter(ParameterSetName = 'Start')][switch]$Demo,
    [Parameter(Mandatory, ParameterSetName = 'Status')][switch]$Status
)

$ErrorActionPreference = 'Stop'
$check = Join-Path $PSScriptRoot 'platform/check.mjs'
if ($Status) {
    & node.exe $check
    if ($LASTEXITCODE) { throw 'The local PoC did not pass its readiness checks.' }
    return
}

foreach ($program in 'java.exe','javac.exe','node.exe','npm.cmd','git.exe','tar.exe') {
    if (!(Get-Command $program -ErrorAction SilentlyContinue)) {
        throw "Missing $program. Install an x64 JDK 21, Node.js 22.18+ and Git for Windows."
    }
}
$nodeVersion = [version](& node.exe -p 'process.versions.node')
if ($nodeVersion -lt [version]'22.18.0') { throw 'Node.js 22.18 or newer is required.' }
$javaVersion = & javac.exe -version
if (($javaVersion -join ' ') -notmatch '^javac 21([. ]|$)') { throw 'Select JDK 21 on PATH.' }

# All checkouts on this PC use the same loopback ports.
$lock = New-Object System.Threading.Mutex($false, 'Local\CantonPrivatePocBootstrap')
try {
    try { $acquired = $lock.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $acquired = $true }
    if (!$acquired) { throw 'Another PoC startup is in progress.' }
    if ((Get-NetTCPConnection -LocalPort 17610 -State Listen -ErrorAction SilentlyContinue) -and
        !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'network/participant_admin.secret'))) {
        throw 'Port 17610 is in use by another installation. Start this PoC in its original folder or on a free host.'
    }
    & (Join-Path $PSScriptRoot 'Start-CantonPlatform.ps1') -Prepare:$Prepare
    & node.exe $check
    if ($LASTEXITCODE) { throw 'The local PoC did not pass its readiness checks.' }
    & (Join-Path $PSScriptRoot 'Run-CantonTokenStandard.ps1') -Prepare:$Prepare -InstallOnly:(!$Demo)
} finally {
    if ($acquired) { $lock.ReleaseMutex() }
    $lock.Dispose()
}
