import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = (process.env.SOL_E2E_URL || "http://127.0.0.1:3210").replace(/\/$/, "");
const bootstrap = process.env.SOL_E2E_BOOTSTRAP || "solreviewgate e2e bootstrap secret";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
let credentialId = "";
const step = (message) => process.stdout.write(`[e2e] ${message}\n`);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function jsonFetch(route, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...init, cache: "no-store" });
  const body = await response.json();
  return { response, body };
}

async function signedFetch(route, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const challenge = await jsonFetch("/api/admin/challenge", { method: "POST" });
  assert.equal(challenge.response.status, 200);
  const timestamp = String(Date.now());
  const payload = [method, route, timestamp, challenge.body.nonce, sha256(body)].join("\n");
  const signature = sign("sha256", Buffer.from(payload), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return jsonFetch(route, {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      "x-sol-credential": credentialId,
      "x-sol-timestamp": timestamp,
      "x-sol-nonce": challenge.body.nonce,
      "x-sol-signature": signature,
    },
  });
}

async function waitForJob(excluded = new Set()) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await signedFetch("/api/admin/jobs");
    assert.equal(result.response.status, 200);
    const job = result.body.jobs.find((candidate) => candidate.state === "AWAITING_APPROVAL" && !excluded.has(candidate.id));
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("review did not reach the approval queue");
}

async function runClient(token, packet) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sol-e2e-"));
  const packetPath = path.join(root, "packet.md");
  const configPath = path.join(root, "remote.json");
  await writeFile(packetPath, packet);
  await writeFile(configPath, JSON.stringify({ url: baseUrl, token }));
  const child = spawn(process.execPath, [path.resolve("plugins/solreview/bin/solreview.js"), packetPath], {
    env: { ...process.env, SOL_GATE_CONFIG: configPath, SOL_GATE_POLL_MS: "25", SOL_GATE_TIMEOUT_MS: "15000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  return { completed };
}

const health = await jsonFetch("/api/health");
assert.equal(health.response.status, 200);
assert.equal(health.body.mode, "mock");
step("health");

const paired = await jsonFetch("/api/admin/pair", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret: bootstrap, publicKey: publicKey.export({ format: "jwk" }) }),
});
assert.equal(paired.response.status, 200);
credentialId = paired.body.credentialId;
step("paired");

const replacementAttempt = await jsonFetch("/api/admin/pair", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret: bootstrap, publicKey: publicKey.export({ format: "jwk" }) }),
});
assert.equal(replacementAttempt.response.status, 409);
assert.equal(replacementAttempt.body.error, "already_paired");
step("replacement blocked");

assert.equal((await signedFetch("/api/admin/codex/login", { method: "POST", body: "{}" })).response.status, 200);
assert.equal((await signedFetch("/api/admin/codex/login")).body.state, "ready");
step("codex connected");

const enrollment = await signedFetch("/api/admin/clients", { method: "POST", body: JSON.stringify({ name: "E2E Claude" }) });
assert.equal(enrollment.response.status, 200);
assert.ok(enrollment.body.token);
step("client enrolled");

const verifiedClient = await fetch(`${baseUrl}/api/client/verify`, { headers: { authorization: `Bearer ${enrollment.body.token}` } });
assert.equal(verifiedClient.status, 200);
assert.equal((await verifiedClient.json()).ok, true);
const rejectedClient = await fetch(`${baseUrl}/api/client/verify`, { headers: { authorization: "Bearer invalid" } });
assert.equal(rejectedClient.status, 401);
step("client installer verification checked");

const packet = "# SOL REVIEW PACKET\n\n## User Request\nVerify the complete remote cycle.\n\n## Source Manifest\nS1 | E2E fixture\n";
const firstClient = await runClient(enrollment.body.token, packet);
const firstJob = await waitForJob();
step("first packet queued");
const detailBefore = await signedFetch(`/api/admin/jobs/${firstJob.id}`);
assert.equal(detailBefore.response.status, 200);
assert.equal(detailBefore.body.preview, packet);
assert.equal(detailBefore.body.raw, null);
assert.ok(detailBefore.body.packetQuality);
assert.equal(detailBefore.body.packetQuality.sectionsPresent, 2);
assert.equal((await signedFetch(`/api/admin/jobs/${firstJob.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "approve" }) })).response.status, 200);
step("first packet approved");
assert.deepEqual(await firstClient.completed, {
  code: 0,
  stdout: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nThe decision is supported by the transferred evidence.\nEVIDENCE CITED:\n- S1\nCOUNTERARGUMENT:\nThe fixture does not exercise a real model.\nRECOMMENDATIONS:\n- None\n",
  stderr: "",
});
const detailAfter = await signedFetch(`/api/admin/jobs/${firstJob.id}`);
assert.equal(detailAfter.body.job.state, "COMPLETE_REVIEW");
assert.equal(detailAfter.body.job.protocolVersion, "alignment-v1");
assert.match(detailAfter.body.job.policyHash, /^[a-f0-9]{64}$/);
assert.match(detailAfter.body.job.schemaHash, /^[a-f0-9]{64}$/);
assert.match(detailAfter.body.job.workerHash, /^[a-f0-9]{64}$/);
assert.match(detailAfter.body.raw, /"kind":"review"/);
step("first review retained");

const secondClient = await runClient(enrollment.body.token, `${packet}\nSecond request.`);
const secondJob = await waitForJob(new Set([firstJob.id]));
step("second packet queued");
assert.equal((await signedFetch(`/api/admin/jobs/${secondJob.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "reject" }) })).response.status, 200);
assert.deepEqual(await secondClient.completed, { code: 0, stdout: "Bob Regress\n", stderr: "" });
step("second packet rejected opaquely");

const unauthorized = await fetch(`${baseUrl}/api/admin/jobs`);
assert.equal(unauthorized.status, 401);
process.stdout.write("E2E mock cycle passed: pair, login, enroll, upload, preview, approve, review, retain, reject, opaque.\n");
