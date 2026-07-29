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

async function runClient(token, packet, extraArgs = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sol-e2e-"));
  const packetPath = path.join(root, "packet.md");
  const configPath = path.join(root, "remote.json");
  await writeFile(packetPath, packet);
  await writeFile(configPath, JSON.stringify({ url: baseUrl, token }));
  const child = spawn(process.execPath, [path.resolve("plugins/solreview/bin/solreview.js"), ...extraArgs, packetPath], {
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

const secondEnrollment = await signedFetch("/api/admin/clients", { method: "POST", body: JSON.stringify({ name: "E2E second computer" }) });
assert.equal(secondEnrollment.response.status, 200);
const clientList = await signedFetch("/api/admin/clients");
assert.equal(clientList.response.status, 200);
assert.equal(clientList.body.clients.length, 2);
const secondClientId = secondEnrollment.body.clientId;
assert.equal((await signedFetch(`/api/admin/clients/${secondClientId}`, { method: "DELETE" })).response.status, 200);
const revokedClient = await fetch(`${baseUrl}/api/client/verify`, { headers: { authorization: `Bearer ${secondEnrollment.body.token}` } });
assert.equal(revokedClient.status, 401);
assert.equal((await fetch(`${baseUrl}/api/client/verify`, { headers: { authorization: `Bearer ${enrollment.body.token}` } })).status, 200);
step("named clients isolated and revocable");

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

const settingsBefore = await signedFetch("/api/admin/settings");
assert.equal(settingsBefore.response.status, 200);
assert.deepEqual(settingsBefore.body.settings, { model: "gpt-5.6-sol", reasoning: "medium", protocolId: "baseline", research: false, panel: [] });
assert.ok(settingsBefore.body.modelChoices.includes("gpt-5.6-sol"));
assert.deepEqual(settingsBefore.body.protocols.map((protocol) => protocol.id), ["baseline", "control", "strict"]);
const invalidSettings = await signedFetch("/api/admin/settings", { method: "POST", body: JSON.stringify({ model: "-c model_reasoning_effort=\"high\"" }) });
assert.equal(invalidSettings.response.status, 400);
assert.equal(invalidSettings.body.error, "invalid_model");
const updatedSettings = await signedFetch("/api/admin/settings", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-terra", reasoning: "high", protocolId: "strict" }) });
assert.equal(updatedSettings.response.status, 200);
assert.deepEqual(updatedSettings.body.settings, { model: "gpt-5.6-terra", reasoning: "high", protocolId: "strict", research: false, panel: [] });
step("model and alignment protocol changed from the PWA");

const thirdClient = await runClient(enrollment.body.token, `${packet}\nThird request.`);
const thirdJob = await waitForJob(new Set([firstJob.id, secondJob.id]));
assert.equal((await signedFetch(`/api/admin/jobs/${thirdJob.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "approve" }) })).response.status, 200);
assert.equal((await thirdClient.completed).code, 0);
const thirdDetail = await signedFetch(`/api/admin/jobs/${thirdJob.id}`);
assert.equal(thirdDetail.body.job.model, "gpt-5.6-terra");
assert.equal(thirdDetail.body.job.reasoning, "high");
assert.equal(thirdDetail.body.job.protocolVersion, "alignment-strict-v1");
assert.notEqual(thirdDetail.body.job.policyHash, detailAfter.body.job.policyHash);
assert.equal(thirdDetail.body.job.schemaHash, detailAfter.body.job.schemaHash);
// A packet-only run reports no research trace at all, so "off" and "searched nothing" differ.
assert.equal(thirdDetail.body.job.research, false);
assert.equal(thirdDetail.body.job.searchCount, undefined);
step("selected model and protocol recorded on the next approved review");

const researchSettings = await signedFetch("/api/admin/settings", { method: "POST", body: JSON.stringify({ research: true }) });
assert.equal(researchSettings.response.status, 200);
assert.equal(researchSettings.body.settings.research, true);
const researchClient = await runClient(enrollment.body.token, `${packet}\nResearch this.`);
const researchJob = await waitForJob(new Set([firstJob.id, secondJob.id, thirdJob.id]));
assert.equal((await signedFetch(`/api/admin/jobs/${researchJob.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "approve" }) })).response.status, 200);
assert.equal((await researchClient.completed).code, 0);
const researchDetail = await signedFetch(`/api/admin/jobs/${researchJob.id}`);
assert.equal(researchDetail.body.job.research, true);
assert.equal(researchDetail.body.job.protocolVersion, "alignment-strict-v1+research");
assert.equal(researchDetail.body.job.searchCount, 1);
assert.deepEqual(researchDetail.body.job.searchLog, ["fixture query for gpt-5.6-terra"]);
// The queries are operator-visible and the client still receives only the review.
assert.ok(!(await researchClient.completed).stdout.includes("fixture query"));
assert.equal((await signedFetch("/api/admin/settings", { method: "POST", body: JSON.stringify({ research: false }) })).response.status, 200);
step("research run recorded the searches that left the sandbox");

// A packet carrying real attachments: the count is taken once at commit and must survive to the
// phone, because history and the lab report it without decrypting the packet again.
const attachedDigest = "d".repeat(64);
const attachedPacket = [
  packet,
  "",
  "## Attached Paths",
  "src/one.ts",
  "",
  `=== BEGIN ATTACHED FILE src/one.ts sha256:${attachedDigest} ===`,
  "export const one = 1;",
  "=== END ATTACHED FILE src/one.ts ===",
  `=== BEGIN ATTACHED FILE src/two.ts sha256:${attachedDigest} ===`,
  "export const two = 2;",
  "=== END ATTACHED FILE src/two.ts ===",
].join("\n");
const attachedClient = await runClient(enrollment.body.token, attachedPacket);
const attachedJob = await waitForJob(new Set([firstJob.id, secondJob.id, thirdJob.id, researchJob.id]));
const attachedPending = await signedFetch(`/api/admin/jobs/${attachedJob.id}`);
assert.equal(attachedPending.body.job.attachedFiles, 2, "the attachment count was not stored at commit");
assert.ok(attachedPending.body.job.attachedBytes > 0);
assert.deepEqual(attachedPending.body.packetQuality.attachedPaths, ["src/one.ts", "src/two.ts"]);
assert.equal((await signedFetch(`/api/admin/jobs/${attachedJob.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "approve" }) })).response.status, 200);
assert.equal((await attachedClient.completed).code, 0);
const attachedDone = await signedFetch(`/api/admin/jobs/${attachedJob.id}`);
assert.equal(attachedDone.body.job.attachedFiles, 2, "the attachment count did not survive the answered job");
assert.ok((attachedDone.body.result || "").includes("ATTACHED FILES USED:"), "released review lost the attached-files section on retention");
// A packet with no attachments records none, so the two cases stay distinguishable.
const plainDetail = await signedFetch(`/api/admin/jobs/${researchJob.id}`);
assert.equal(plainDetail.body.job.attachedFiles, 0, "a packet with no attachments recorded some");
assert.deepEqual(plainDetail.body.packetQuality.attachedPaths, []);
step("attached file count stored at commit and retained on the answered review");

const panel = [
  { model: "gpt-5.6-sol", reasoning: "medium", protocolId: "baseline" },
  { model: "gpt-5.6-sol", reasoning: "low", protocolId: "control" },
  { model: "gpt-5.6-luna", reasoning: "high", protocolId: "strict" },
];
const panelSaved = await signedFetch("/api/admin/settings", { method: "POST", body: JSON.stringify({ panel }) });
assert.equal(panelSaved.response.status, 200);
assert.equal(panelSaved.body.settings.panel.length, 3);
step("comparison set stored");

const panelClient = await runClient(enrollment.body.token, `${packet}\nCompare configurations.`);
const panelJob = await waitForJob(new Set([firstJob.id, secondJob.id, thirdJob.id]));
assert.equal((await signedFetch(`/api/admin/jobs/${panelJob.id}/decision`, { method: "POST", body: JSON.stringify({ decision: "approve_panel" }) })).response.status, 200);

let panelDetail = await signedFetch(`/api/admin/jobs/${panelJob.id}`);
for (let attempt = 0; attempt < 40 && panelDetail.body.job.state !== "AWAITING_SELECTION"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  panelDetail = await signedFetch(`/api/admin/jobs/${panelJob.id}`);
}
assert.equal(panelDetail.body.job.state, "AWAITING_SELECTION");
assert.equal(panelDetail.body.candidates.length, 3);
assert.deepEqual(panelDetail.body.candidates.map((candidate) => candidate.protocolVersion), ["alignment-v1", "alignment-control-v1", "alignment-strict-v1"]);
assert.deepEqual(panelDetail.body.candidates.map((candidate) => Boolean(candidate.releasable)), [true, false, true]);
step("three candidates finished and nothing was released");

const withheldCandidate = panelDetail.body.candidates[1];
const chosenCandidate = panelDetail.body.candidates[2];
const blockedRelease = await signedFetch(`/api/admin/jobs/${panelJob.id}/selection`, { method: "POST", body: JSON.stringify({ candidateId: withheldCandidate.id }) });
assert.equal(blockedRelease.response.status, 409);
assert.equal(blockedRelease.body.error, "invalid_candidate");

const chosenDetail = await signedFetch(`/api/admin/jobs/${panelJob.id}/candidates/${chosenCandidate.id}`);
assert.equal(chosenDetail.response.status, 200);
assert.match(chosenDetail.body.result, /gpt-5\.6-luna under alignment-strict-v1/);

const selection = await signedFetch(`/api/admin/jobs/${panelJob.id}/selection`, { method: "POST", body: JSON.stringify({ candidateId: chosenCandidate.id }) });
assert.equal(selection.response.status, 200);
assert.equal(selection.body.released, true);
const panelOutput = await panelClient.completed;
assert.equal(panelOutput.code, 0);
assert.match(panelOutput.stdout, /gpt-5\.6-luna under alignment-strict-v1/);
assert.equal(panelOutput.stderr, "");
step("operator choice reached Claude and the other candidates did not");

const rerun = await signedFetch(`/api/admin/jobs/${panelJob.id}/candidates`, { method: "POST", body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: "medium", protocolId: "baseline" }) });
assert.equal(rerun.response.status, 200);
assert.equal(rerun.body.candidate.postRelease, true);
let afterRerun = await signedFetch(`/api/admin/jobs/${panelJob.id}`);
for (let attempt = 0; attempt < 40 && afterRerun.body.candidates.length === 4 && afterRerun.body.candidates[3].state !== "COMPLETE"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  afterRerun = await signedFetch(`/api/admin/jobs/${panelJob.id}`);
}
assert.equal(afterRerun.body.candidates.length, 4);
assert.equal(afterRerun.body.candidates[3].state, "COMPLETE");
assert.equal(afterRerun.body.job.state, "COMPLETE_REVIEW");
assert.equal(afterRerun.body.job.selectedCandidateId, chosenCandidate.id);
assert.match(afterRerun.body.result, /gpt-5\.6-luna under alignment-strict-v1/);
assert.equal(afterRerun.body.job.runs.filter((run) => run.postRelease).length, 1);
const lateRelease = await signedFetch(`/api/admin/jobs/${panelJob.id}/selection`, { method: "POST", body: JSON.stringify({ candidateId: afterRerun.body.candidates[3].id }) });
assert.equal(lateRelease.response.status, 409);
step("re-run after release stayed on the phone");

const soluteClient = await runClient(enrollment.body.token, "# SOL PARALLEL PACKET\n\n## Request\nAnswer this independently.\n\n## Source Manifest\nS1 | E2E fixture\n", ["--parallel"]);
const soluteOutput = await soluteClient.completed;
assert.deepEqual(soluteOutput, { code: 0, stdout: "Sol has the same question.\n", stderr: "" });
step("parallel packet acknowledged without waiting");

const known = new Set([firstJob.id, secondJob.id, thirdJob.id, panelJob.id]);
let soluteJob = null;
for (let attempt = 0; attempt < 60 && !soluteJob; attempt += 1) {
  const list = await signedFetch("/api/admin/jobs");
  const found = list.body.jobs.find((job) => !known.has(job.id));
  if (found) {
    const detail = await signedFetch(`/api/admin/jobs/${found.id}`);
    if (detail.body.job.state.startsWith("COMPLETE")) soluteJob = detail.body;
  }
  if (!soluteJob) await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(soluteJob, "parallel answer did not complete on its own");
assert.equal(soluteJob.job.kind, "parallel");
assert.equal(soluteJob.job.internalCode, "ANSWER_RECORDED");
assert.equal(soluteJob.job.approvedAt > 0, true);
assert.equal(soluteJob.result, "Bob Regress");
assert.equal(soluteJob.candidates.length, 1);
const soluteCandidate = await signedFetch(`/api/admin/jobs/${soluteJob.job.id}/candidates/${soluteJob.candidates[0].id}`);
assert.match(soluteCandidate.body.raw, /"answer":"Independent answer from/);
assert.equal(soluteCandidate.body.candidate.releasable, false);
step("parallel answer recorded for the phone only");

const unauthorized = await fetch(`${baseUrl}/api/admin/jobs`);
assert.equal(unauthorized.status, 401);
assert.equal((await fetch(`${baseUrl}/api/admin/jobs/${panelJob.id}/candidates`)).status, 401);
assert.equal((await fetch(`${baseUrl}/api/admin/jobs/${panelJob.id}/selection`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId: null }) })).status, 401);
assert.equal((await fetch(`${baseUrl}/api/admin/settings`)).status, 401);
assert.equal((await fetch(`${baseUrl}/api/admin/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-5.6" }) })).status, 401);
process.stdout.write("E2E mock cycle passed: pair, login, enroll, upload, preview, approve, review, retain, reject, opaque, reconfigure, compare, select, parallel.\n");
