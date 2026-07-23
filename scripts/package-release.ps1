[CmdletBinding()]
param(
  [string]$Version = "3.0.0",
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $repositoryRoot "distrelease"
}
$output = [IO.Path]::GetFullPath($OutputRoot)
$expectedOutput = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "distrelease"))
if ($output -ne $expectedOutput) {
  throw "Release output must be the repository distrelease directory."
}

$package = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
if ($package.version -ne $Version) {
  throw "Requested version $Version does not match package.json version $($package.version)."
}

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $output | Out-Null

$staging = Join-Path ([IO.Path]::GetTempPath()) "solreviewrelease$([Guid]::NewGuid().ToString('N'))"
try {
  $windowsRoot = Join-Path $staging "SolReviewGateWindows"
  $payloadRoot = Join-Path $windowsRoot "payload"
  $pluginRoot = Join-Path $staging "SolReviewPlugin"
  New-Item -ItemType Directory -Force -Path $windowsRoot, $payloadRoot, $pluginRoot | Out-Null

  Copy-Item -LiteralPath (Join-Path $repositoryRoot "install.ps1") -Destination (Join-Path $output "SolReviewSetup.ps1")
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "install.sh") -Destination (Join-Path $output "SolReviewSetup.sh")
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "uninstall.ps1") -Destination (Join-Path $output "SolReviewRemove.ps1")

  Copy-Item -LiteralPath (Join-Path $repositoryRoot "install.ps1") -Destination (Join-Path $windowsRoot "SolReviewSetup.ps1")
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "uninstall.ps1") -Destination (Join-Path $windowsRoot "SolReviewRemove.ps1")
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "plugins") -Destination $payloadRoot -Recurse

  @"
@echo off
setlocal
title Sol Review Gate Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0SolReviewSetup.ps1" -LocalSourceRoot "%~dp0payload"
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the message above, then try again.
  pause
  exit /b 1
)
echo.
pause
"@ | Set-Content -LiteralPath (Join-Path $windowsRoot "Install.cmd") -Encoding ASCII

  @"
Sol Review Gate $Version

1. Open Install.cmd.
2. Enter the HTTPS address of your private PWA.
3. Paste the client token created in the PWA.
4. Restart Claude Code and run /sol.

The installer writes only to your user profile. It does not modify a project.
Run SolReviewRemove.ps1 to remove the client, credential, and personal skill.
"@ | Set-Content -LiteralPath (Join-Path $windowsRoot "README.txt") -Encoding UTF8

  $pluginSourceRoot = Join-Path $pluginRoot "plugins"
  New-Item -ItemType Directory -Force -Path $pluginSourceRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $repositoryRoot ".claude-plugin") -Destination $pluginRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "plugins\solreview") -Destination (Join-Path $pluginSourceRoot "solreview") -Recurse
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "README.md") -Destination (Join-Path $pluginRoot "README.md")

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $compression = [IO.Compression.CompressionLevel]::Optimal
  $windowsZip = Join-Path $output "SolReviewGateWindows.zip"
  $pluginZip = Join-Path $output "SolReviewPlugin.zip"
  [IO.Compression.ZipFile]::CreateFromDirectory($windowsRoot, $windowsZip, $compression, $false)
  [IO.Compression.ZipFile]::CreateFromDirectory($pluginRoot, $pluginZip, $compression, $false)

  $windowsArchive = [IO.Compression.ZipFile]::OpenRead($windowsZip)
  try {
    $windowsEntries = $windowsArchive.Entries.FullName | ForEach-Object { $_.Replace("\", "/") }
    foreach ($required in @("Install.cmd", "SolReviewSetup.ps1", "SolReviewRemove.ps1", "payload/plugins/solreview/bin/solreview.js", "payload/plugins/solreview/skills/sol/SKILL.md")) {
      if ($windowsEntries -notcontains $required) {
        throw "Windows package is missing $required."
      }
    }
  } finally {
    $windowsArchive.Dispose()
  }

  $pluginArchive = [IO.Compression.ZipFile]::OpenRead($pluginZip)
  try {
    $pluginEntries = $pluginArchive.Entries.FullName | ForEach-Object { $_.Replace("\", "/") }
    foreach ($required in @(".claude-plugin/marketplace.json", "plugins/solreview/.claude-plugin/plugin.json", "plugins/solreview/bin/solreview.js", "plugins/solreview/skills/sol/SKILL.md")) {
      if ($pluginEntries -notcontains $required) {
        throw "Plugin package is missing $required."
      }
    }
  } finally {
    $pluginArchive.Dispose()
  }

  $hashLines = Get-ChildItem -LiteralPath $output -File |
    Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
    Sort-Object Name |
    ForEach-Object { "$(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName | Select-Object -ExpandProperty Hash)  $($_.Name)" }
  $hashLines | Set-Content -LiteralPath (Join-Path $output "SHA256SUMS.txt") -Encoding ASCII
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

Write-Host "Release package $Version created at $output"
