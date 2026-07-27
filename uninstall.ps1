[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$InstallRoot = (Join-Path $HOME ".sol-review"),
  [string]$ClaudeSkillsRoot = (Join-Path $HOME ".claude\skills")
)

$ErrorActionPreference = "Stop"
$clientRoot = [IO.Path]::GetFullPath($InstallRoot)
$skillRoot = [IO.Path]::GetFullPath((Join-Path $ClaudeSkillsRoot "sol"))
$parallelSkillRoot = [IO.Path]::GetFullPath((Join-Path $ClaudeSkillsRoot "solute"))
$homeRoot = [IO.Path]::GetFullPath($HOME).TrimEnd("\") + "\"

if (-not $clientRoot.StartsWith($homeRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The client path must stay inside the current user profile."
}
foreach ($candidate in @($skillRoot, $parallelSkillRoot)) {
  if (-not $candidate.StartsWith($homeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The skill path must stay inside the current user profile."
  }
}

Write-Host ""
Write-Host "Sol Review Gate removal" -ForegroundColor Cyan

if ($PSCmdlet.ShouldProcess($clientRoot, "Remove the Sol Review client and credential")) {
  if (Test-Path -LiteralPath $clientRoot) {
    Remove-Item -LiteralPath $clientRoot -Recurse -Force
  }
}
if ($PSCmdlet.ShouldProcess($skillRoot, "Remove the personal /sol skill")) {
  if (Test-Path -LiteralPath $skillRoot) {
    Remove-Item -LiteralPath $skillRoot -Recurse -Force
  }
}
if ($PSCmdlet.ShouldProcess($parallelSkillRoot, "Remove the personal /solute skill")) {
  if (Test-Path -LiteralPath $parallelSkillRoot) {
    Remove-Item -LiteralPath $parallelSkillRoot -Recurse -Force
  }
}

$binRoot = Join-Path $clientRoot "bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath) {
  $parts = $currentPath -split ";" | Where-Object { $_ -and $_ -ne $binRoot }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
}

Write-Host "Removal complete. Restart Claude Code and your terminal." -ForegroundColor Green
