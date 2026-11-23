param([switch]$Prepare)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $PSScriptRoot 'network'
$network = Join-Path $root 'network'
$lens = Join-Path $PSScriptRoot '.lens/apps'
$lensRepo = Split-Path $lens -Parent
$dar = Join-Path $network 'model/.daml/dist/local-official-iou-1.0.0.dar'
if ($Prepare) {
    if (!(Test-Path (Join-Path $root 'tools/dpm.exe'))) { & (Join-Path $root 'setup.ps1') }
    if (!(Test-Path (Join-Path $lensRepo '.git'))) {
        git clone https://github.com/dsrvlabs/canton-lens.git $lensRepo
        if ($LASTEXITCODE) { throw 'Lens clone failed.' }
    }
    git -C $lensRepo checkout --detach 9e4751bd0604ea4ed1778b95c155975c5c100e16
    if ($LASTEXITCODE) { throw 'Lens checkout failed.' }
    Push-Location $lensRepo
    try {
        npx.cmd --yes pnpm@9.15.9 install --frozen-lockfile
        if ($LASTEXITCODE) { throw 'Lens dependency installation failed.' }
    } finally { Pop-Location }
    Push-Location $network
    try {
        npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'OIDC dependency installation failed.' }
    } finally { Pop-Location }
    $env:DPM_HOME = Join-Path $root '.dpm'
    $env:DPM_REGISTRY = 'europe-docker.pkg.dev/da-images/public'
    Push-Location (Join-Path $network 'model')
    try {
        & (Join-Path $root 'tools/dpm.exe') build
        if ($LASTEXITCODE) { throw 'IOU package build failed.' }
    } finally { Pop-Location }
}
if (!(Test-Path $dar) -or !(Test-Path (Join-Path $lensRepo 'node_modules')) -or !(Test-Path (Join-Path $network 'node_modules'))) {
    throw 'Run .\Start-CantonLens.ps1 -Prepare first.'
}
$jar = Get-ChildItem (Join-Path $root '.dpm') -Recurse -Filter 'canton-open-source-3.7.3.jar' | Select-Object -First 1
if (!$jar) { throw 'Canton 3.7.3 SDK is missing.' }

function Start-LocalService($port, $program, $arguments, $directory, $name) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return }
    Start-Process $program -ArgumentList $arguments -WorkingDirectory $directory -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtime "$name.live.out") `
        -RedirectStandardError (Join-Path $runtime "$name.live.err")
}

function Wait-Http($url) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { Invoke-RestMethod $url -TimeoutSec 2 | Out-Null; return } catch { Start-Sleep -Seconds 1 }
    }
    throw "Service not ready at $url. See logs under network."
}

Start-LocalService 17610 'node.exe' 'provider.mjs' $runtime 'oidc'
Wait-Http 'http://127.0.0.1:17610/.well-known/openid-configuration'
$cantonArgs = @('-XX:ActiveProcessorCount=4','-Xmx2200m','-jar',('"{0}"' -f $jar.FullName),'daemon','-c','simple-topology.conf','-c','h2.conf','-c','local.conf')
if (!(Test-Path (Join-Path $network 'data/participant2.mv.db'))) {
    $cantonArgs += @('--bootstrap','simple-ping.canton')
}
Start-LocalService 5013 'java.exe' $cantonArgs $network 'canton'
Wait-Http 'http://127.0.0.1:5013/v2/version'
Wait-Http 'http://127.0.0.1:5023/v2/version'
$seedMarker = Join-Path $network 'data/seeded'
if (!(Test-Path $seedMarker)) {
    Push-Location $network
    try {
        node seed.mjs
        if ($LASTEXITCODE) { throw 'Demo setup failed. See the Canton log.' }
        New-Item -ItemType File -Path $seedMarker -Force | Out-Null
    } finally { Pop-Location }
}

$env:LEDGER_AUTH_MODE = 'shared-identity'
$env:SHARED_IDENTITY_ISSUER = 'http://127.0.0.1:17610'
$env:SHARED_IDENTITY_CLIENT_ID = 'lens-viewer'
$env:SHARED_IDENTITY_CLIENT_SECRET = [IO.File]::ReadAllText((Join-Path $runtime 'lens-viewer.secret'))
$env:SHARED_IDENTITY_SCOPES = 'ledger.read'
$env:API_HOST = '127.0.0.1'
$env:VITE_AUTH_MODE = 'shared-identity'
foreach ($i in 0,1) {
    $port = 5173 + $i
    $apiPort = 7600 + $i
    $env:API_PORT = "$apiPort"
    $env:LEDGER_BASE = "http://127.0.0.1:$((5013,5023)[$i])"
    $env:PUBLIC_ENTRY_URL = "http://127.0.0.1:$port/"
    Start-LocalService $apiPort 'node.exe' 'src/live/serve.mjs' (Join-Path $lens 'backend') "backend-$i"
    $env:BACKEND_PROXY_TARGET = "http://127.0.0.1:$apiPort"
    Start-LocalService $port 'node.exe' "node_modules/vite/bin/vite.js --host 127.0.0.1 --port $port --strictPort" (Join-Path $lens 'frontend') "frontend-$i"
}
Remove-Item Env:SHARED_IDENTITY_CLIENT_SECRET
Wait-Http 'http://127.0.0.1:5173/api/contracts'
Wait-Http 'http://127.0.0.1:5174/api/contracts'
Write-Output 'Issuer http://127.0.0.1:5173/#/contracts'
Write-Output 'Broker http://127.0.0.1:5174/#/contracts'
