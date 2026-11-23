param([switch]$Prepare)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$platform = Join-Path $PSScriptRoot 'platform'
$runtime = Join-Path $env:LOCALAPPDATA 'CantonPrivatePoc/runtime'
$keycloak = Join-Path $runtime 'keycloak-26.8.2'
$pqsJar = Join-Path $runtime 'pqs.jar'
$temporal = Join-Path $runtime 'temporal-1.10.1/temporal.exe'
$env:JAVA_HOME = Split-Path (Split-Path (Get-Command java.exe).Source)

function Get-VerifiedArchive($url, $path, $hash) {
    if (!(Test-Path -LiteralPath $path)) {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash) {
        throw "Checksum mismatch: $path"
    }
}

function Wait-Http($url) {
    for ($i = 0; $i -lt 120; $i++) {
        try { Invoke-RestMethod $url -TimeoutSec 2 | Out-Null; return }
        catch { Start-Sleep -Seconds 1 }
    }
    throw "Service not ready: $url. Check logs under $runtime"
}

function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-LocalService($port, $program, $arguments, $directory, $name) {
    if (Test-Port $port) { return }
    Start-Process $program -ArgumentList $arguments -WorkingDirectory $directory -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtime "$name.out.log") `
        -RedirectStandardError (Join-Path $runtime "$name.err.log")
}

function Invoke-Local($directory, $program, $arguments) {
    Push-Location $directory
    try {
        & $program @arguments
        if ($LASTEXITCODE) { throw "$program failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
}

if ($Prepare) {
    & (Join-Path $PSScriptRoot 'Start-CantonLens.ps1') -Prepare
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    if (!(Test-Path $keycloak)) {
        $archive = Join-Path $runtime 'keycloak-26.8.2.zip'
        Get-VerifiedArchive 'https://github.com/keycloak/keycloak/releases/download/26.8.2/keycloak-26.8.2.zip' $archive '321ffee62ec28fab18fe885d8cd62cc814edce72a35cd062dc81b504c1a406b3'
        Invoke-Local $runtime 'tar.exe' @('-xf', $archive)
    }
    if (!(Test-Path $pqsJar)) {
        $layerHash = '41775bf1028aa58263aa652ba36d91074fea493199cb14604ae5be3095e4b766'
        $archive = Join-Path $runtime 'pqs-layer.tar.gz'
        Get-VerifiedArchive "https://europe-docker.pkg.dev/v2/da-images/public/docker/participant-query-store/blobs/sha256:${layerHash}" $archive $layerHash
        Invoke-Local $runtime 'tar.exe' @('-xzf', $archive, 'pqs.jar')
    }
    if (!(Test-Path -LiteralPath $temporal)) {
        $archive = Join-Path $runtime 'temporal-1.10.1-win-x64.zip'
        Get-VerifiedArchive 'https://github.com/temporalio/cli/releases/download/v1.10.1/temporal_cli_1.10.1_windows_amd64.zip' $archive '5069cdb76569914305ed7c90e1c8406cd27bcb6c2a822fce201a488c34ab074f'
        Expand-Archive -LiteralPath $archive -DestinationPath (Split-Path $temporal -Parent) -Force
    }
    Copy-Item (Join-Path $platform 'postgres-runtime/package*.json') -Destination $runtime
    Copy-Item (Join-Path $platform 'postgres.mjs') -Destination $runtime
    if (!(Test-Port 15432)) {
        Invoke-Local $runtime 'npm.cmd' @('ci','--no-audit','--no-fund')
    }
    if (Test-Port 18090) {
        # npm ci replaces loaded native Temporal modules, which Windows locks.
        Invoke-Local $platform 'npm.cmd' @('ls','--depth=0')
    } else {
        Invoke-Local $platform 'npm.cmd' @('ci','--no-audit','--no-fund')
    }
    Invoke-Local $platform 'npm.cmd' @('run','build')
    $env:DPM_HOME = Join-Path $PSScriptRoot '.dpm'
    $env:DPM_REGISTRY = 'europe-docker.pkg.dev/da-images/public'
    & (Join-Path $PSScriptRoot 'Run-CantonTokenStandard.ps1') -Prepare -BuildOnly
    Invoke-Local (Join-Path $platform 'model') (Join-Path $PSScriptRoot 'tools/dpm.exe') @('build')
} else {
    & (Join-Path $PSScriptRoot 'Start-CantonLens.ps1')
}

if (!(Test-Path $pqsJar) -or !(Test-Path -LiteralPath $temporal) -or !(Test-Path (Join-Path $platform 'dist/index.html'))) {
    throw 'Run .\Start-CantonPlatform.ps1 -Prepare first.'
}
Invoke-Local $platform 'node.exe' @('identity.mjs')
Start-LocalService 15432 'node.exe' 'postgres.mjs' $runtime 'postgres'
$dbReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $log = Join-Path $runtime 'postgres.out.log'
        if ((Test-Port 15432) -and ((Select-String -LiteralPath $log -Pattern 'PostgreSQL ready' -Quiet -ErrorAction SilentlyContinue) -or !(Test-Path $log))) {
            $dbReady = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
}
if (!$dbReady) { throw 'PostgreSQL did not finish initializing.' }

if (!(Test-Path (Join-Path $PSScriptRoot 'network/platform-writer.secret'))) {
    throw 'The local OIDC process predates the platform-writer client. Restart the existing Canton Lens stack and rerun.'
}
Invoke-Local $platform 'node.exe' @('provision.mjs')
$keycloakArgs = '/d /c ""{0}" start-dev --http-host 127.0.0.1 --http-port 18084 --import-realm"' -f (Join-Path $keycloak 'bin/kc.bat')
Start-LocalService 18084 'cmd.exe' $keycloakArgs $keycloak 'keycloak'

$env:PQS_PIPELINE_OAUTH_CLIENTID = 'lens-viewer'
$env:PQS_PIPELINE_OAUTH_CLIENTSECRET = Get-Content -Raw (Join-Path $PSScriptRoot 'network/lens-viewer.secret')
$env:PQS_PIPELINE_OAUTH_SCOPE = 'ledger.read'
$env:PQS_PIPELINE_OAUTH_ENDPOINT = 'http://127.0.0.1:17610/token'
$env:PQS_PIPELINE_OAUTH_PREEMPTEXPIRY = 'PT15S'
$env:PQS_TARGET_POSTGRES_USERNAME = 'poc'
$env:PQS_TARGET_POSTGRES_PASSWORD = Get-Content -Raw (Join-Path $runtime 'postgres.secret')
try {
    for ($i = 0; $i -lt 2; $i++) {
        $port = 18081 + $i
        $ledgerPort = (5011,5021)[$i]
        $db = ('pqs_issuer','pqs_broker')[$i]
        $cache = Join-Path $runtime "pqs-cache-$i"
        $args = @('-XX:ActiveProcessorCount=2','-Xmx700m','-jar',('"{0}"' -f $pqsJar),
            'pipeline','ledger','postgres-document','--source-ledger-host','127.0.0.1',
            '--source-ledger-port',"$ledgerPort",'--source-ledger-auth','OAuth','--source-ledger-cachedir',('"{0}"' -f $cache),
            '--pipeline-ledger-start','Oldest','--target-postgres-host','127.0.0.1','--target-postgres-port','15432',
            '--target-postgres-database',$db,'--target-postgres-maxconnections','4','--health-port',"$port")
        Start-LocalService $port 'java.exe' $args $runtime "pqs-$i"
    }
} finally {
    Remove-Item Env:PQS_PIPELINE_OAUTH_CLIENTSECRET,Env:PQS_TARGET_POSTGRES_PASSWORD
}

Wait-Http 'http://127.0.0.1:18084/realms/canton-poc/.well-known/openid-configuration'
Wait-Http 'http://127.0.0.1:18081/readyz'
Wait-Http 'http://127.0.0.1:18082/readyz'
Start-LocalService 7233 $temporal @('server','start-dev','--ip','127.0.0.1','--ui-ip','127.0.0.1','--ui-port','8233',
    '--db-filename','issuance-workflows.db') $runtime 'temporal'
Wait-Http 'http://127.0.0.1:8233/'
Start-LocalService 18090 'node.exe' 'server.mjs' $platform 'platform'
Wait-Http 'http://127.0.0.1:18090/healthz'
Write-Output 'Platform http://127.0.0.1:18090/'
Write-Output 'Temporal UI http://127.0.0.1:8233/'
Write-Output "Local demo accounts: $runtime\platform-demo-accounts.json"
