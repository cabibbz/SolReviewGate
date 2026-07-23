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
