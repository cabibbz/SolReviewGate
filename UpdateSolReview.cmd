@echo off
setlocal
title Sol Review Gate Update

REM Double-click this file, or run it from Command Prompt or PowerShell. It works from any of them,
REM which the bare irm one-liner does not: irm is a PowerShell command and Command Prompt has no
REM such thing. Everything it needs beyond this file is already saved by the installer.

set "SOL_UPDATE_URL=https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/update.ps1"
if not "%~1"=="" set "SOL_UPDATE_URL=%~1"

echo.
echo Sol Review Gate update
echo Source: %SOL_UPDATE_URL%
echo.

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo Windows PowerShell was not found on PATH, so this updater cannot run.
  echo Install the client again from the README instructions instead.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-Expression (Invoke-RestMethod -UseBasicParsing -Uri $env:SOL_UPDATE_URL)"
if errorlevel 1 (
  echo.
  echo The update did not finish. Read the message above, then try again.
  pause
  exit /b 1
)

echo.
echo Update complete. Restart Claude Code so the updated skills load.
pause
