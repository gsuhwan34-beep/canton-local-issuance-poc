$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$toolsDir = Join-Path $PSScriptRoot 'tools'
New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
$archive = Join-Path $toolsDir 'dpm.tar.gz'
$url = 'https://github.com/digital-asset/dpm/releases/download/1.1.2/dpm-1.1.2-windows-amd64.tar.gz'
$expectedHash = '3e3a33fe26ef674a7d7271d440d4ad4a35af42aa60fb22888c5083c96f7b58ba'
if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $expectedHash) {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'The downloaded archive does not match the published dpm checksum.'
}
& tar -xzf $archive -C $toolsDir
if ($LASTEXITCODE -ne 0) { throw 'Could not unpack dpm.' }
$env:DPM_HOME = Join-Path $PSScriptRoot '.dpm'
$env:DPM_REGISTRY = 'europe-docker.pkg.dev/da-images/public'
& (Join-Path $toolsDir 'dpm.exe') install 3.7.3
if ($LASTEXITCODE -ne 0) { throw 'SDK installation failed.' }
