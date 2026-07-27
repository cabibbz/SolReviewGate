#Requires -Version 5
# One-command update for an existing Sol Review Gate installation.
#
#   irm 'https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/update.ps1' | iex
#
# Reads the PWA address and client token the installer already saved, then reinstalls the client
# and both skills from the repository's main branch. Nothing is prompted and nothing else changes.
# Set SOL_REPOSITORY_ROOT to update from a different branch, tag, or local checkout.

$ErrorActionPreference = "Stop"

$source = if ($env:SOL_REPOSITORY_ROOT) { $env:SOL_REPOSITORY_ROOT } else { "https://raw.githubusercontent.com/cabibbz/SolReviewGate/main" }
$installRoot = if ($env:SOL_INSTALL_ROOT) { $env:SOL_INSTALL_ROOT } else { Join-Path $HOME ".sol-review" }
$configPath = Join-Path $installRoot "remote.json"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "No installed client was found at $configPath. Run the installer once first; updating needs its saved address and token."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $config.url -or -not $config.token) {
  throw "The saved configuration at $configPath is missing its address or token. Run the installer once to recreate it."
}

Write-Host "Updating Sol Review Gate for $($config.url)" -ForegroundColor Cyan
Write-Host "Source: $source"

$env:SOL_GATE_URL = $config.url
$env:SOL_GATE_CLIENT_TOKEN = $config.token
$env:SOL_REPOSITORY_ROOT = $source

Invoke-Expression (Invoke-RestMethod -UseBasicParsing -Uri "$source/install.ps1")
