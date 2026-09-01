$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'infra\bin'
$exe = Join-Path $binDir 'cloudflared.exe'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

if (-not (Test-Path $exe)) {
  Write-Host 'Downloading Cloudflare tunnel...'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
}

Write-Host 'Starting HTTPS tunnel to http://localhost:3000'
Write-Host 'Keep this window open. The https URL appears below.'
Write-Host 'Paste that URL into TikTok (and Google/GitHub) then set PUBLIC_ORIGIN in .env and restart pnpm dev.'
& $exe tunnel --url http://localhost:3000
