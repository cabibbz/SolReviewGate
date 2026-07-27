"use strict";

const assert = require("node:assert/strict");
const { access, readFile } = require("node:fs/promises");
const test = require("node:test");

test("release installers, package metadata, and workflow stay version aligned", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const powershellInstaller = await readFile("install.ps1", "utf8");
  const shellInstaller = await readFile("install.sh", "utf8");
  const packageScript = await readFile("scripts/package-release.ps1", "utf8");
  const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(powershellInstaller, new RegExp(`\\$ReleaseVersion = "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(shellInstaller, new RegExp(`release_version="${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(powershellInstaller, /SolReviewGate\/v\$ReleaseVersion/);
  assert.match(shellInstaller, /SolReviewGate\/v\$release_version/);
  assert.match(packageScript, /SolReviewGateWindows\.zip/);
  assert.match(packageScript, /SolReviewPlugin\.zip/);
  assert.match(packageScript, /SHA256SUMS\.txt/);
  assert.match(releaseWorkflow, /gh release (?:upload|create)/);

  await access("uninstall.ps1");
  await access("CHANGELOG.md");
});

test("the Windows updater runs from either shell and is shipped with every release", async () => {
  // The failure this pins: the README's `irm ... | iex` one-liner was pasted into Command Prompt,
  // where irm does not exist. The .cmd wrapper works from cmd.exe, PowerShell, and a double-click.
  const updater = await readFile("UpdateSolReview.cmd", "utf8");
  assert.match(updater, /^@echo off/);
  assert.match(updater, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -Command/);
  assert.match(updater, /update\.ps1/);
  assert.match(updater, /pause/, "a double-clicked window must not vanish before its message is read");

  const packageScript = await readFile("scripts/package-release.ps1", "utf8");
  assert.match(packageScript, /UpdateSolReview\.cmd/);
  assert.match(packageScript, /"Install\.cmd", "UpdateSolReview\.cmd"/, "the Windows zip must be verified to contain the updater");

  // Command Prompt has no irm, so any Windows one-liner offered for it must invoke powershell.
  const readme = await readFile("README.md", "utf8");
  const cmdBlocks = [...readme.matchAll(/```bat\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.ok(cmdBlocks.length > 0, "the README offers no Command Prompt form");
  for (const block of cmdBlocks) {
    if (/\birm\b/.test(block)) assert.match(block, /powershell/, `a bat block uses irm without powershell: ${block.trim()}`);
  }
  await access("update.ps1");
  await access("update.sh");
});
