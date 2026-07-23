[CmdletBinding()]
param(
  [string]$Url = $env:SOL_GATE_URL,
  [string]$ClientToken = $env:SOL_GATE_CLIENT_TOKEN,
  [string]$RepositoryRoot = "https://raw.githubusercontent.com/cabibbz/SolReviewGate/main",
  [string]$InstallRoot = (Join-Path $HOME ".sol-review"),
  [string]$ClaudeSkillsRoot = (Join-Path $HOME ".claude\skills"),
  [string]$LocalSourceRoot = "",
  [switch]$SkipPath,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Copy-SourceFile([string]$RelativePath, [string]$Destination) {
  if ($LocalSourceRoot) {
    Copy-Item -LiteralPath (Join-Path $LocalSourceRoot $RelativePath) -Destination $Destination -Force
    return
  }
  $source = "$($RepositoryRoot.TrimEnd('/'))/$($RelativePath.Replace('\', '/'))"
  Invoke-WebRequest -UseBasicParsing -Uri $source -OutFile $Destination
}

if (-not $Url) {
  $enteredUrl = Read-Host "PWA address [https://sol-review-gate.vercel.app]"
  $Url = if ($enteredUrl) { $enteredUrl } else { "https://sol-review-gate.vercel.app" }
}
$Url = $Url.Trim().TrimEnd("/")
$parsedUrl = $null
$validUrl = [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsedUrl)
$secureUrl = $validUrl -and $parsedUrl.Scheme -eq "https" -and [bool]$parsedUrl.Host
$localUrl = $validUrl -and $parsedUrl.Scheme -eq "http" -and $parsedUrl.Host -in @("localhost", "127.0.0.1")
if (-not $secureUrl -and -not $localUrl) {
  throw "The PWA address must use HTTPS."
}

if (-not $ClientToken) {
  $ClientToken = Read-SecretText "Client token from the phone PWA"
}
$ClientToken = $ClientToken.Trim()
if ($ClientToken.Length -lt 20 -or $ClientToken -notmatch "^[A-Za-z0-9_-]+$") {
  throw "The client token is invalid."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js 18 or newer is required. Install Node.js, then run this installer again."
}
$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 18) {
  throw "Node.js 18 or newer is required."
}

if (-not $SkipVerify) {
  try {
    $verified = Invoke-RestMethod -Method Get -Uri "$Url/api/client/verify" -Headers @{ Authorization = "Bearer $ClientToken" }
    if (-not $verified.ok) { throw "not verified" }
  } catch {
    throw "The PWA could not verify this client token. Create a new Claude client on the phone and try again."
  }
}

$ClientRoot = Join-Path $InstallRoot "client"
$BinRoot = Join-Path $InstallRoot "bin"
$SkillRoot = Join-Path $ClaudeSkillsRoot "sol"
$staging = Join-Path ([IO.Path]::GetTempPath()) "solreviewinstaller$([Guid]::NewGuid().ToString('N'))"

try {
  New-Item -ItemType Directory -Force -Path $staging, $ClientRoot, $BinRoot, $SkillRoot | Out-Null
  $stagedClient = Join-Path $staging "solreview.js"
  $stagedSkill = Join-Path $staging "SKILL.md"
  Copy-SourceFile "plugins\solreview\bin\solreview.js" $stagedClient
  Copy-SourceFile "plugins\solreview\skills\sol\SKILL.md" $stagedSkill

  & node --check $stagedClient
  if ($LASTEXITCODE -ne 0) { throw "The downloaded client did not pass validation." }
  if ((Get-Content -LiteralPath $stagedSkill -Raw) -notmatch "name:\s*sol") {
    throw "The downloaded Claude Code skill did not pass validation."
  }

  Copy-Item -LiteralPath $stagedClient -Destination (Join-Path $ClientRoot "solreview.js") -Force
  Copy-Item -LiteralPath $stagedSkill -Destination (Join-Path $SkillRoot "SKILL.md") -Force

  $config = @{ url = $Url; token = $ClientToken } | ConvertTo-Json
  Set-Content -LiteralPath (Join-Path $InstallRoot "remote.json") -Value $config -Encoding UTF8

  $clientEntry = Join-Path $ClientRoot "solreview.js"
  $shim = "@echo off`r`nnode `"$clientEntry`" %*`r`n"
  Set-Content -LiteralPath (Join-Path $BinRoot "solreview.cmd") -Value $shim -Encoding ASCII

  if (-not $SkipPath) {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = if ($currentPath) { $currentPath -split ";" | Where-Object { $_ } } else { @() }
    if ($parts -notcontains $BinRoot) {
      $nextPath = if ($currentPath) { "$currentPath;$BinRoot" } else { $BinRoot }
      [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
    }
    if (($env:Path -split ";") -notcontains $BinRoot) {
      $env:Path = "$env:Path;$BinRoot"
    }
  }
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

Write-Host ""
Write-Host "Sol Review is installed."
Write-Host "Restart Claude Code, then run /sol in any session."
Write-Host "The client credential is stored outside the project at $InstallRoot."
