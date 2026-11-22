param(
    [ValidateSet('Build', 'Test', 'Sandbox', 'Demo')]
    [string]$Action = 'Test'
)

$ErrorActionPreference = 'Stop'
$java = Get-Command java -ErrorAction Stop
$env:JAVA_HOME = Split-Path (Split-Path $java.Source -Parent) -Parent
$env:DPM_HOME = Join-Path $PSScriptRoot '.dpm'
$env:DPM_REGISTRY = 'europe-docker.pkg.dev/da-images/public'
$dpm = Join-Path $PSScriptRoot 'tools/dpm.exe'
$project = Join-Path $PSScriptRoot 'issuance'
$dar = Join-Path $project '.daml/dist/local-mock-issuance-0.0.1.dar'

if (-not (Test-Path -LiteralPath $dpm)) {
    throw 'Run .\setup.ps1 first to install dpm and the SDK.'
}

Push-Location $project
try {
    if ($Action -eq 'Build') {
        & $dpm build
    }
    elseif ($Action -eq 'Test') {
        & $dpm test
    }
    elseif ($Action -eq 'Sandbox') {
        if (-not (Test-Path -LiteralPath $dar)) {
            throw 'Build the project before starting sandbox.'
        }
        & $dpm sandbox --ledger-api-port 6865 --json-api-port 7575 --dar $dar
    }
    else {
        if (-not (Test-Path -LiteralPath $dar)) {
            throw 'Build the project before running the demo.'
        }
        & $dpm script --dar $dar --script-name Main:demo --ledger-host localhost --ledger-port 6865
    }
    if ($LASTEXITCODE -ne 0) {
        throw "dpm exited with code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
