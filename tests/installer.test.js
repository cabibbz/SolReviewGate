"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { access, mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("Windows installer verifies the token and installs the client plus personal skill", { skip: process.platform !== "win32" }, async () => {
  const token = "installer-client-token-1234567890";
  let verified = false;
  const server = createServer((request, response) => {
    verified = request.url === "/api/client/verify" && request.headers.authorization === `Bearer ${token}`;
    response.setHeader("content-type", "application/json");
    response.statusCode = verified ? 200 : 401;
    response.end(JSON.stringify(verified ? { ok: true } : { error: "unavailable" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const root = await mkdtemp(path.join(os.tmpdir(), "solreviewinstallertest"));
  const installRoot = path.join(root, "install");
  const skillsRoot = path.join(root, "skills");
  const claudeRoot = path.dirname(skillsRoot);
  const legacyCommand = path.join(claudeRoot, "commands", "sol.md");
  const legacyClientRoot = path.join(installRoot, "remote-client");
  const legacyShim = path.join(installRoot, "bin", "sol-review.cmd");
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  try {
    await mkdir(path.dirname(legacyCommand), { recursive: true });
    await mkdir(legacyClientRoot, { recursive: true });
    await mkdir(path.dirname(legacyShim), { recursive: true });
    await writeFile(legacyCommand, "SOL REVIEW PACKET\nsol-review\nBob Regress\n");
    await writeFile(path.join(legacyClientRoot, "sol-review.js"), "legacy");
    await writeFile(legacyShim, "remote-client\\sol-review.js");

    const result = await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", path.resolve("install.ps1"),
        "-Url", url,
        "-ClientToken", token,
        "-LocalSourceRoot", process.cwd(),
        "-InstallRoot", installRoot,
        "-ClaudeSkillsRoot", skillsRoot,
        "-SkipPath",
      ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(verified, true);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(token));
    assert.match(result.stdout, /The PWA accepted this client token/);
    assert.match(result.stdout, /No packet or configuration file was added to a Claude project/);
    assert.match(await readFile(path.join(skillsRoot, "sol", "SKILL.md"), "utf8"), /name: sol/);
    assert.match(await readFile(path.join(installRoot, "client", "solreview.js"), "utf8"), /const TERMINAL/);
    assert.match(await readFile(path.join(installRoot, "bin", "solreview.cmd"), "utf8"), /solreview\.js/);
    assert.deepEqual(JSON.parse((await readFile(path.join(installRoot, "remote.json"), "utf8")).replace(/^\uFEFF/, "")), { url, token });
    await assert.rejects(access(legacyCommand));
    await assert.rejects(access(legacyClientRoot));
    await assert.rejects(access(legacyShim));
    assert.match(result.stdout, /previous Sol Review command was migrated/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
