"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const { access, mkdtemp, writeFile } = require("node:fs/promises");
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
    const child = spawn(process.execPath, [clientPath, packetPath], {
      env: { ...process.env, SOL_GATE_CONFIG: configPath, SOL_GATE_POLL_MS: "25", SOL_GATE_TIMEOUT_MS: "3000", ...extraEnv },
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
