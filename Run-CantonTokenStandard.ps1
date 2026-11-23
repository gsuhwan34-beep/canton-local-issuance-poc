param([switch]$Prepare, [switch]$InstallOnly, [switch]$BuildOnly)

$ErrorActionPreference = 'Stop'
$ref = '17c6a5957eb2f193d9f7fa8f5283bbac5e30d9a1'
$checkout = Join-Path $PSScriptRoot '.token-standard'
$standard = Join-Path $checkout 'token-standard'
$dpm = Join-Path $PSScriptRoot 'tools/dpm.exe'
$bundle = Join-Path $standard 'examples/splice-test-token-v1/.daml/dist/splice-test-token-v1-current.dar'
$env:DPM_HOME = Join-Path $PSScriptRoot '.dpm'
$env:DPM_REGISTRY = 'europe-docker.pkg.dev/da-images/public'
$env:JAVA_HOME = Split-Path (Split-Path (Get-Command java.exe).Source)

function Invoke-Checked($program, $arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$program exited with code $LASTEXITCODE" }
}

if ($Prepare) {
    if (!(Test-Path -LiteralPath $dpm)) { & (Join-Path $PSScriptRoot 'setup.ps1') }
    if (!(Test-Path -LiteralPath $checkout)) {
        Invoke-Checked 'git.exe' @('init', $checkout)
        Invoke-Checked 'git.exe' @('-C', $checkout, 'remote', 'add', 'origin', 'https://github.com/canton-network/splice.git')
    }
    if (!(Test-Path -LiteralPath $standard)) {
        Invoke-Checked 'git.exe' @('-C', $checkout, 'sparse-checkout', 'set', 'token-standard')
        Invoke-Checked 'git.exe' @('-C', $checkout, 'fetch', '--depth', '1', 'https://github.com/canton-network/splice.git', $ref)
        Invoke-Checked 'git.exe' @('-C', $checkout, 'checkout', '--detach', $ref)
    }
    $head = & git.exe -C $checkout rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $head -ne $ref) { throw 'Unexpected Splice source revision.' }

    $projects = @('splice-api-token-metadata-v1', 'splice-api-token-holding-v1', 'splice-api-token-holding-v2',
        'splice-api-token-allocation-v1', 'splice-api-token-allocation-v2',
        'splice-api-token-allocation-instruction-v1', 'splice-api-token-allocation-instruction-v2',
        'splice-api-token-allocation-request-v1', 'splice-api-token-allocation-request-v2',
        'splice-api-token-transfer-instruction-v1', 'splice-api-token-transfer-instruction-v2',
        'splice-api-token-transfer-events-v2', 'splice-token-standard-utils', 'examples/splice-test-token-v1')
    foreach ($project in $projects) {
        $path = Join-Path $standard $project
        $config = Join-Path $path 'daml.yaml'
        # Match the SDK used by the running Canton demo. Keep upstream Daml sources intact.
        $yaml = Get-Content -LiteralPath $config -Raw
        $pinned = $yaml -replace '(?m)^sdk-version: [^\r\n]+', 'sdk-version: 3.7.3'
        if ($yaml -cne $pinned) { [IO.File]::WriteAllText($config, $pinned) }
        $output = Join-Path $path ('.daml/dist/' + (Split-Path $project -Leaf) + '-current.dar')
        New-Item -ItemType Directory -Path (Split-Path $output -Parent) -Force | Out-Null
        Push-Location $path
        try { Invoke-Checked $dpm @('build', '-o', $output) }
        finally { Pop-Location }
    }
}

if (!(Test-Path -LiteralPath $bundle)) { throw 'Run .\Run-CantonTokenStandard.ps1 -Prepare with the local Canton platform running.' }
$demoArgs = @((Join-Path $PSScriptRoot 'token-standard/demo.mjs'), $bundle)
if ($BuildOnly) { return }
if ($InstallOnly) { $demoArgs += '--install-only' }
Invoke-Checked 'node.exe' $demoArgs
