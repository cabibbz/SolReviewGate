"use strict";

const assert = require("node:assert/strict");
const { access, readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("Claude marketplace, plugin, and skill versions stay aligned", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const marketplace = JSON.parse(await readFile(".claude-plugin/marketplace.json", "utf8"));
  const manifest = JSON.parse(await readFile("plugins/solreview/.claude-plugin/plugin.json", "utf8"));
  const skill = await readFile("plugins/solreview/skills/sol/SKILL.md", "utf8");
  const entry = marketplace.plugins.find((plugin) => plugin.name === "solreview");

  assert.equal(packageJson.name, "solreviewgate");
  assert.equal(marketplace.name, "solreviewgate");
  assert.ok(entry);
  assert.equal(entry.version, packageJson.version);
  assert.equal(manifest.version, packageJson.version);
  assert.match(skill, /^---\r?\nname: sol\r?\n/m);
  assert.match(skill, /disable-model-invocation: true/);
  assert.match(skill, /invoke `solreview`/);

  await access(path.join("plugins", "solreview", "bin", "solreview.js"));
  await access(path.join("install.ps1"));
  await access(path.join("install.sh"));
});
