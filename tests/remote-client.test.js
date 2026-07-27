"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const { access, mkdir, mkdtemp, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { gunzipSync } = require("node:zlib");

const clientPath = path.resolve("plugins/solreview/bin/solreview.js");

async function runClient(url, packet, extraEnv = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sol-client-test-"));
  const configPath = path.join(root, "remote.json");
  const packetPath = path.join(root, "packet.md");
  await writeFile(configPath, `\uFEFF${JSON.stringify({ url, token: "client-token-1234567890" })}`);
  await writeFile(packetPath, packet);
  return new Promise((resolve, reject) => {
    const { SOL_CLIENT_CWD: cwd, ...env } = extraEnv;
    const child = spawn(process.execPath, [clientPath, packetPath], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, SOL_GATE_CONFIG: configPath, SOL_GATE_POLL_MS: "25", SOL_GATE_TIMEOUT_MS: "3000", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function withServer(output, callback, options = {}) {
  const chunks = new Map();
  let resultPolls = 0;
  let chunkAttempts = 0;
  const server = createServer(async (request, response) => {
    const body = await new Promise((resolve) => {
      let value = "";
      request.setEncoding("utf8");
      request.on("data", (part) => { value += part; });
      request.on("end", () => resolve(value));
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/client/jobs" && request.method === "POST") {
      response.end(JSON.stringify({ jobId: "job-1", capability: "cap-1" }));
      return;
    }
    const chunkMatch = request.url.match(/^\/api\/client\/jobs\/job-1\/chunks\/(\d+)$/);
    if (chunkMatch && request.method === "PUT") {
      chunkAttempts += 1;
      if (options.failFirstChunk && chunkAttempts === 1) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "retry" }));
        return;
      }
      chunks.set(Number(chunkMatch[1]), Buffer.from(JSON.parse(body).data, "base64"));
      response.end(JSON.stringify({ accepted: true }));
      return;
    }
    if (request.url === "/api/client/jobs/job-1/commit" && request.method === "POST") {
      response.end(JSON.stringify({ accepted: true }));
      return;
    }
    if (request.url === "/api/client/jobs/job-1/result" && request.method === "GET") {
      resultPolls += 1;
      response.end(JSON.stringify(resultPolls < 2 ? { pending: true } : { pending: false, output }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "missing" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`, chunks, () => chunkAttempts);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("remote client transfers, retries, polls, and releases a valid review", async () => {
  const packet = randomBytes(700_000).toString("base64");
  await withServer("VERDICT: SOUND\nASSESSMENT: Supported by the packet.", async (url, chunks, attempts) => {
    const result = await runClient(url, packet);
    assert.deepEqual(result, { code: 0, stdout: "VERDICT: SOUND\nASSESSMENT: Supported by the packet.\n", stderr: "" });
    const compressed = Buffer.concat([...chunks.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]));
    assert.equal(gunzipSync(compressed).toString("utf8"), packet);
    assert.ok(attempts() >= 2);
    assert.ok(chunks.size >= 2);
  }, { failFirstChunk: true });
});

test("remote client accepts calibrated reviews without exposing private metadata", async () => {
  const output = "VERDICT: NEEDS_IMPROVEMENT\nCONFIDENCE: MEDIUM\nASSESSMENT:\nEvidence is incomplete.\nEVIDENCE CITED:\n- S1\nCOUNTERARGUMENT:\nThe available source may still be sufficient.\nRECOMMENDATIONS:\n- Add S2.";
  await withServer(output, async (url) => {
    assert.deepEqual(await runClient(url, "packet"), { code: 0, stdout: `${output}\n`, stderr: "" });
  });
});

test("remote client passes only the exact opaque token", async () => {
  await withServer("Bob Regress", async (url) => {
    assert.equal((await runClient(url, "packet")).stdout, "Bob Regress\n");
  });
});

test("remote client collapses malformed server output without stderr", async () => {
  await withServer("partial or malformed", async (url) => {
    assert.deepEqual(await runClient(url, "packet"), { code: 0, stdout: "Bob Regress\n", stderr: "" });
  });
});

test("remote client collapses network failure without stderr", async () => {
  const result = await runClient("http://127.0.0.1:9", "packet", { SOL_GATE_TIMEOUT_MS: "100" });
  assert.deepEqual(result, { code: 0, stdout: "Bob Regress\n", stderr: "" });
});

test("remote client removes a temporary Sol packet before network work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solreviewpackettest"));
  const packetPath = path.join(root, `solreviewpacket${randomBytes(12).toString("hex")}.md`);
  const configPath = path.join(root, "remote.json");
  await writeFile(packetPath, "sensitive packet");
  await writeFile(configPath, JSON.stringify({ url: "http://127.0.0.1:9", token: "client-token-1234567890" }));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [clientPath, packetPath], {
      env: { ...process.env, SOL_GATE_CONFIG: configPath, SOL_GATE_TIMEOUT_MS: "100" },
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
  await assert.rejects(access(packetPath));
});

test("remote client attaches declared files and folders, and refuses the dangerous ones", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "sol-project-"));
  await writeFile(path.join(project, "answer.ts"), "export const answer = 42;\n");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "one.ts"), "export const one = 1;\n");
  await writeFile(path.join(project, "src", "two.ts"), "const token = \"sk-abcdefghijklmnopqrstuvwxyz\";\nexport const two = 2;\n");
  await mkdir(path.join(project, "node_modules"), { recursive: true });
  await writeFile(path.join(project, "node_modules", "ignored.js"), "module.exports = 1;\n");
  await writeFile(path.join(project, ".env"), "SOL_MASTER_KEY_BASE64=supersecretvalue\n");
  const outside = await mkdtemp(path.join(os.tmpdir(), "sol-outside-"));
  await writeFile(path.join(outside, "private.txt"), "not for the reviewer\n");

  const packet = [
    "# SOL REVIEW PACKET",
    "",
    "## Source Manifest",
    "S1 | answer.ts",
    "",
    "## Attached Paths",
    "answer.ts",
    "src",
    ".env",
    "node_modules",
    "missing-file.ts",
    path.join(outside, "private.txt"),
    "",
  ].join("\n");

  await withServer("Bob Regress", async (url, chunks) => {
    const result = await runClient(url, packet, { SOL_CLIENT_CWD: project });
    assert.equal(result.code, 0);
    const uploaded = gunzipSync(Buffer.concat([...chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value))).toString("utf8");

    // Declared files arrive verbatim, with the digest of what was on disk.
    assert.match(uploaded, /=== BEGIN ATTACHED FILE answer\.ts sha256:[a-f0-9]{64} ===\nexport const answer = 42;/);
    assert.match(uploaded, /=== BEGIN ATTACHED FILE src\/one\.ts sha256:[a-f0-9]{64} ===\nexport const one = 1;/);
    assert.match(uploaded, /export const two = 2;/);

    // A credential line inside an attached file is replaced, and the file itself is not resent.
    assert.doesNotMatch(uploaded, /sk-abcdefghijklmnopqrstuvwxyz/);
    assert.match(uploaded, /\[REDACTED LINE\]/);

    // Credential files, excluded directories, missing paths, and anything outside the tree never leave.
    assert.doesNotMatch(uploaded, /supersecretvalue/);
    assert.doesNotMatch(uploaded, /not for the reviewer/);
    assert.doesNotMatch(uploaded, /module\.exports = 1/);
    assert.match(uploaded, /Not attached:.*credential file/);
    assert.match(uploaded, /outside the working directory/);
    assert.match(uploaded, /not found/);
  });
});

test("remote client finds the attachment section in every heading format a model produces", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "sol-heading-"));
  await writeFile(path.join(project, "code.ts"), "export const value = 1;\n");
  await writeFile(path.join(project, "next-section.ts"), "export const stop = true;\n");

  // The formats seen from real assembling models: numbered, bold, label-with-colon, and the
  // canonical heading. The exact-match detector attached nothing for all but the last.
  const headings = ["## 12. Attached Paths", "**Attached Paths**", "Attached Paths:", "## `Attached Paths`", "## Granted Paths"];
  for (const heading of headings) {
    const packet = [
      "# SOL REVIEW PACKET",
      "",
      "## Source Manifest",
      "S1 | code.ts",
      "",
      heading,
      "code.ts",
      "",
      "**Known Uncertainty**",
      "next-section.ts is not evidence, it is the next section and must not be attached.",
      "",
    ].join("\n");
    await withServer("Bob Regress", async (url, chunks) => {
      const result = await runClient(url, packet, { SOL_CLIENT_CWD: project });
      assert.equal(result.code, 0, `${heading}: client failed`);
      const uploaded = gunzipSync(Buffer.concat([...chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value))).toString("utf8");
      assert.match(uploaded, /=== BEGIN ATTACHED FILE code\.ts sha256:[a-f0-9]{64} ===/, `${heading}: declared file was not attached`);
      assert.doesNotMatch(uploaded, /BEGIN ATTACHED FILE next-section\.ts/, `${heading}: read past the end of the section`);
    });
  }
});
