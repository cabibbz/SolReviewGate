"use strict";

const assert = require("node:assert/strict");
const { access, readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("Claude marketplace, plugin, and skill versions stay aligned", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const marketplace = JSON.parse(await readFile(".claude-plugin/marketplace.json", "utf8"));
  const manifest = JSON.parse(await readFile("plugins/solreview/.claude-plugin/plugin.json", "utf8"));
  const skill = await readFile("plugins/solreview/skills/sol/SKILL.md", "utf8");
  const parallelSkill = await readFile("plugins/solreview/skills/solute/SKILL.md", "utf8");
  const entry = marketplace.plugins.find((plugin) => plugin.name === "solreview");

  assert.equal(packageJson.name, "solreviewgate");
  assert.equal(marketplace.name, "solreviewgate");
  assert.ok(entry);
  assert.equal(entry.version, packageJson.version);
  assert.equal(manifest.version, packageJson.version);
  assert.match(skill, /^---\r?\nname: sol\r?\n/m);
  assert.match(skill, /disable-model-invocation: true/);
  assert.match(skill, /invoke `solreview`/);

  assert.match(parallelSkill, /^---\r?\nname: solute\r?\n/m);
  assert.match(parallelSkill, /disable-model-invocation: true/);
  assert.match(parallelSkill, /solreview --parallel/);

  await access(path.join("plugins", "solreview", "bin", "solreview.js"));
  await access(path.join("install.ps1"));
  await access(path.join("install.sh"));
});

test("every installed skill is installed by both installers, packaged, and removed", async () => {
  const skills = (await readdir(path.join("plugins", "solreview", "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const shellInstaller = await readFile("install.sh", "utf8");
  const powershellInstaller = await readFile("install.ps1", "utf8");
  const uninstaller = await readFile("uninstall.ps1", "utf8");
  const packageScript = await readFile("scripts/package-release.ps1", "utf8");

  assert.deepEqual(skills.slice().sort(), ["sol", "solute"]);
  for (const name of skills) {
    assert.match(shellInstaller, new RegExp(`skills/${name}/SKILL\\.md`), `install.sh does not install ${name}`);
    assert.match(powershellInstaller, new RegExp(`skills\\\\${name}\\\\SKILL\\.md`), `install.ps1 does not install ${name}`);
    assert.match(uninstaller, new RegExp(`"${name}"`), `uninstall.ps1 does not remove ${name}`);
    assert.match(packageScript, new RegExp(`skills/${name}/SKILL\\.md`), `package-release.ps1 does not verify ${name}`);
  }
});
