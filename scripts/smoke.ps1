[CmdletBinding()]
param(
  [string]$WebUrl = $(if ($env:WEB_URL) { $env:WEB_URL } else { "http://localhost:2000" }),
  [string]$GatewayUrl = $env:GATEWAY_URL,
  [string]$ApiUrl = $env:API_URL,
  [string]$AlgoUrl = $env:ALGO_URL
)

$ErrorActionPreference = "Stop"
if (-not $GatewayUrl) { $GatewayUrl = $WebUrl }
if (-not $ApiUrl) { $ApiUrl = "$($GatewayUrl.TrimEnd('/'))/vo-api" }
$failed = $false

function Test-Endpoint([string]$Name, [string]$Url) {
  try {
    Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 15 -UseBasicParsing | Out-Null
    Write-Host "OK: $Name"
  } catch {
    Write-Error "Smoke check failed: $Name ($Url)" -ErrorAction Continue
    $script:failed = $true
  }
}

Test-Endpoint "web" "$($WebUrl.TrimEnd('/'))/"
Test-Endpoint "gateway API route" "$($GatewayUrl.TrimEnd('/'))/vo-api/health"
Test-Endpoint "API" "$($ApiUrl.TrimEnd('/'))/health"
if ($AlgoUrl) {
  Test-Endpoint "algo" "$($AlgoUrl.TrimEnd('/'))/health"
} else {
  Write-Host "SKIP: algo (set ALGO_URL when it is externally reachable)"
}

if ($failed) {
  throw "One or more smoke checks failed."
}
