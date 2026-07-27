[CmdletBinding()]
param(
  [string]$ReleaseRoot = ""
)

$ErrorActionPreference = "Stop"
if (-not $ReleaseRoot) {
  $ReleaseRoot = Join-Path (Join-Path $PSScriptRoot "..") "distrelease"
}
$release = [IO.Path]::GetFullPath($ReleaseRoot)
$testRoot = Join-Path $HOME ".solreviewpackagetest$([Guid]::NewGuid().ToString('N'))"
$extractRoot = Join-Path $testRoot "release"
$installRoot = Join-Path $testRoot "client"
$skillsRoot = Join-Path $testRoot "skills"
$token = "release-package-client-token-1234567890"

try {
  Expand-Archive -LiteralPath (Join-Path $release "SolReviewGateWindows.zip") -DestinationPath $extractRoot

  & (Join-Path $extractRoot "SolReviewSetup.ps1") `
    -Url "http://127.0.0.1:32199" `
    -ClientToken $token `
    -LocalSourceRoot (Join-Path $extractRoot "payload") `
    -InstallRoot $installRoot `
    -ClaudeSkillsRoot $skillsRoot `
    -SkipVerify `
    -SkipPath

  $installedClient = Join-Path $installRoot "client\solreview.js"
  if (-not (Test-Path -LiteralPath $installedClient)) { throw "Packaged client was not installed." }
  if ((Get-FileHash -LiteralPath $installedClient).Hash -ne (Get-FileHash -LiteralPath (Join-Path $extractRoot "payload\plugins\solreview\bin\solreview.js")).Hash) {
    throw "Installed client does not match the release payload."
  }

  $installedSkills = @()
  foreach ($skill in @("sol", "solute")) {
    $installed = Join-Path $skillsRoot "$skill\SKILL.md"
    $packaged = Join-Path $extractRoot "payload\plugins\solreview\skills\$skill\SKILL.md"
    if (-not (Test-Path -LiteralPath $installed)) { throw "Packaged $skill skill was not installed." }
    if ((Get-FileHash -LiteralPath $installed).Hash -ne (Get-FileHash -LiteralPath $packaged).Hash) {
      throw "Installed $skill skill does not match the release payload."
    }
    $installedSkills += $installed
  }

  & (Join-Path $extractRoot "SolReviewRemove.ps1") -InstallRoot $installRoot -ClaudeSkillsRoot $skillsRoot -Confirm:$false
  if (Test-Path -LiteralPath $installRoot) { throw "The packaged remover left the client installed." }
  foreach ($installed in $installedSkills) {
    if (Test-Path -LiteralPath $installed) { throw "The packaged remover left $installed installed." }
  }
} finally {
  $resolvedHome = [IO.Path]::GetFullPath($HOME).TrimEnd("\") + "\"
  $resolvedTest = [IO.Path]::GetFullPath($testRoot)
  if ($resolvedTest.StartsWith($resolvedHome, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTest)) {
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
  }
}

Write-Host "Windows release package install and removal passed."
