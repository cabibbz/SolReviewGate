import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { sha256 } from "../../lib/crypto";
import { OPAQUE_OUTPUT } from "../../lib/gate";
import {
  candidateRaw,
  clientResult,
  commitJob,
  createCandidate,
  createJob,
  deleteJob,
  getCandidate,
  JobError,
  listCandidates,
  publishCandidate,
  registerClient,
  releaseCandidate,
  saveCandidateResult,
  storageSummary,
  transitionJob,
  uploadChunk,
} from "../../lib/jobs";
import { getStore, resetMemoryStoreForTests, type Store } from "../../lib/store";
import type { ReviewJob } from "../../lib/types";

test.beforeEach(() => resetMemoryStoreForTests());

const review = (verdict: string) => JSON.stringify({
  kind: "review", verdict, assessment: "Supported by the packet.", recommendations: [], confidence: "HIGH",
  evidenceCited: ["S1"], counterargument: "None.", withheldReason: "",
});

async function approvedJob(store: Store): Promise<{ job: ReviewJob; capability: string }> {
  const { client } = await registerClient("candidate test", store);
  const raw = Buffer.from("# SOL REVIEW PACKET\n\nS1 | fixture\n");
  const compressed = gzipSync(raw);
  const { job, capability } = await createJob(client, {
    packetHash: sha256(raw),
    compressedHash: sha256(compressed),
    compressedBytes: compressed.length,
    chunkCount: 1,
  }, store);
  await uploadChunk(job.id, capability, 0, compressed.toString("base64"), store);
  await commitJob(job.id, capability, store);
  await transitionJob(job.id, ["AWAITING_APPROVAL"], "APPROVED", { approvedAt: Date.now() }, store);
  const running = await transitionJob(job.id, ["APPROVED"], "RUNNING", { startedAt: Date.now() }, store);
  return { job: running, capability };
}

async function candidateWith(id: string, model: string, protocolId: string, protocolVersion: string, store: Store, outcome?: { output: string; releasable: boolean; internalCode: string }) {
  const candidate = await createCandidate(id, { model, reasoning: "medium", protocolId, protocolVersion }, false, store);
  if (outcome) {
    await saveCandidateResult(id, candidate.id, { output: outcome.output, raw: outcome.output, releasable: outcome.releasable, internalCode: outcome.internalCode }, store);
  }
  return candidate;
}

test("keeps every candidate separate and records one run summary each", async () => {
  const store = getStore();
  const { job } = await approvedJob(store);
  const first = await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND", releasable: true, internalCode: "RELEASED" });
  const second = await candidateWith(job.id, "gpt-5.6-codex", "strict", "alignment-strict-v1", store, { output: OPAQUE_OUTPUT, releasable: false, internalCode: "MODEL_WITHHELD" });

  const candidates = await listCandidates(job.id, store);
  assert.deepEqual(candidates.map((candidate) => candidate.index), [1, 2]);
  assert.deepEqual(candidates.map((candidate) => candidate.state), ["COMPLETE", "COMPLETE"]);
  assert.equal((await getCandidate(job.id, first.id, store))?.releasable, true);
  assert.equal((await getCandidate(job.id, second.id, store))?.releasable, false);

  const stored = await store.get<ReviewJob>(`sol:job:${job.id}`);
  assert.equal(stored?.candidateCount, 2);
  assert.deepEqual(stored?.runs?.map((run) => `${run.model}/${run.protocolVersion}/${run.internalCode}`), [
    "gpt-5.6-sol/alignment-v1/RELEASED",
    "gpt-5.6-codex/alignment-strict-v1/MODEL_WITHHELD",
  ]);
});

test("releases only the candidate the operator selects", async () => {
  const store = getStore();
  const { job, capability } = await approvedJob(store);
  const first = await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nFirst.", releasable: true, internalCode: "RELEASED" });
  const second = await candidateWith(job.id, "gpt-5.6-codex", "strict", "alignment-strict-v1", store, { output: "VERDICT: WRONG\nCONFIDENCE: HIGH\nASSESSMENT:\nSecond.", releasable: true, internalCode: "RELEASED" });
  await transitionJob(job.id, ["RUNNING"], "AWAITING_SELECTION", {}, store);

  assert.equal((await clientResult(job.id, capability, store)).pending, true);
  const released = await releaseCandidate(job.id, second.id, store);
  assert.equal(released.state, "COMPLETE_REVIEW");
  assert.equal(released.selectedCandidateId, second.id);
  assert.equal(released.model, "gpt-5.6-codex");
  assert.equal(released.protocolVersion, "alignment-strict-v1");

  const answer = await clientResult(job.id, capability, store);
  assert.equal(answer.pending, false);
  assert.match(answer.pending === false ? answer.output : "", /Second\./);
  assert.doesNotMatch(answer.pending === false ? answer.output : "", /First\./);
  assert.equal((await listCandidates(job.id, store)).length, 2);
  void first;
});

test("answers a packet exactly once", async () => {
  const store = getStore();
  const { job } = await approvedJob(store);
  const first = await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nFirst.", releasable: true, internalCode: "RELEASED" });
  const second = await candidateWith(job.id, "gpt-5.6-codex", "baseline", "alignment-v1", store, { output: "VERDICT: WRONG\nCONFIDENCE: HIGH\nASSESSMENT:\nSecond.", releasable: true, internalCode: "RELEASED" });
  await transitionJob(job.id, ["RUNNING"], "AWAITING_SELECTION", {}, store);
  await releaseCandidate(job.id, first.id, store);
  await assert.rejects(() => releaseCandidate(job.id, second.id, store), (error: unknown) => error instanceof JobError && error.code === "INVALID_STATE");
});

test("refuses to release a candidate that did not pass the gate", async () => {
  const store = getStore();
  const { job } = await approvedJob(store);
  const blocked = await candidateWith(job.id, "gpt-5.6-sol", "control", "alignment-control-v1", store, { output: OPAQUE_OUTPUT, releasable: false, internalCode: "MODEL_WITHHELD" });
  await candidateWith(job.id, "gpt-5.6-codex", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nOk.", releasable: true, internalCode: "RELEASED" });
  await transitionJob(job.id, ["RUNNING"], "AWAITING_SELECTION", {}, store);
  await assert.rejects(() => releaseCandidate(job.id, blocked.id, store), (error: unknown) => error instanceof JobError && error.code === "INVALID_CANDIDATE");
});

test("releasing nothing gives the client the fixed terminal response", async () => {
  const store = getStore();
  const { job, capability } = await approvedJob(store);
  await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nUsable.", releasable: true, internalCode: "RELEASED" });
  await candidateWith(job.id, "gpt-5.6-codex", "strict", "alignment-strict-v1", store, { output: "VERDICT: WRONG\nCONFIDENCE: HIGH\nASSESSMENT:\nAlso usable.", releasable: true, internalCode: "RELEASED" });
  await transitionJob(job.id, ["RUNNING"], "AWAITING_SELECTION", {}, store);

  const withheld = await releaseCandidate(job.id, null, store);
  assert.equal(withheld.state, "COMPLETE_OPAQUE");
  assert.equal(withheld.internalCode, "OPERATOR_WITHHELD");
  assert.equal(withheld.selectedCandidateId, undefined);
  const answer = await clientResult(job.id, capability, store);
  assert.deepEqual(answer, { pending: false, output: OPAQUE_OUTPUT });
});

test("a single candidate answers the packet without an operator selection", async () => {
  const store = getStore();
  const { job, capability } = await approvedJob(store);
  const only = await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nOnly run.", releasable: true, internalCode: "RELEASED" });
  const completed = await publishCandidate(job.id, only.id, store);
  assert.equal(completed.state, "COMPLETE_REVIEW");
  assert.equal(completed.selectedCandidateId, only.id);
  const answer = await clientResult(job.id, capability, store);
  assert.match(answer.pending === false ? answer.output : "", /Only run\./);
});

test("a candidate created after release never becomes the client answer", async () => {
  const store = getStore();
  const { job, capability } = await approvedJob(store);
  const first = await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nReleased answer.", releasable: true, internalCode: "RELEASED" });
  await publishCandidate(job.id, first.id, store);

  const research = await createCandidate(job.id, { model: "gpt-5.6-codex", reasoning: "high", protocolId: "strict", protocolVersion: "alignment-strict-v1" }, true, store);
  await saveCandidateResult(job.id, research.id, { output: "VERDICT: WRONG\nCONFIDENCE: HIGH\nASSESSMENT:\nLater opinion.", raw: review("WRONG"), releasable: true, internalCode: "RELEASED" }, store);

  await assert.rejects(() => releaseCandidate(job.id, research.id, store), (error: unknown) => error instanceof JobError && error.code === "INVALID_STATE");
  const answer = await clientResult(job.id, capability, store);
  assert.match(answer.pending === false ? answer.output : "", /Released answer\./);
  assert.doesNotMatch(answer.pending === false ? answer.output : "", /Later opinion\./);
  const stored = await store.get<ReviewJob>(`sol:job:${job.id}`);
  assert.equal(stored?.runs?.filter((run) => run.postRelease).length, 1);
});

test("counts candidate payloads in storage and removes them with the review", async () => {
  const store = getStore();
  const { job } = await approvedJob(store);
  const only = await candidateWith(job.id, "gpt-5.6-sol", "baseline", "alignment-v1", store, { output: "VERDICT: SOUND\nCONFIDENCE: HIGH\nASSESSMENT:\nStored.", releasable: true, internalCode: "RELEASED" });
  await publishCandidate(job.id, only.id, store);
  const summary = await storageSummary(store);
  assert.ok(summary.rawBytes > 0);

  await deleteJob(job.id, store);
  assert.deepEqual(await listCandidates(job.id, store), []);
  assert.equal(await store.get(`sol:job:${job.id}:candidate:${only.id}`), null);
  assert.equal(await store.get(`sol:job:${job.id}:candidate:${only.id}:output`), null);
});

test("a parallel answer takes no approval slot and never reaches the client", async () => {
  const store = getStore();
  const { client } = await registerClient("parallel test", store);
  const raw = Buffer.from("# SOL PARALLEL PACKET\n\n## Request\nAnswer this.\n\n## Source Manifest\nS1 | fixture\n");
  const compressed = gzipSync(raw);

  // A review is already outstanding for this client.
  const review = await createJob(client, { packetHash: sha256(raw), compressedHash: sha256(compressed), compressedBytes: compressed.length, chunkCount: 1 }, store);
  await uploadChunk(review.job.id, review.capability, 0, compressed.toString("base64"), store);
  await commitJob(review.job.id, review.capability, store);

  // The parallel submission is neither blocked by it nor queued for approval.
  const parallel = await createJob(client, { packetHash: sha256(raw), compressedHash: sha256(compressed), compressedBytes: compressed.length, chunkCount: 1, kind: "parallel" }, store);
  await uploadChunk(parallel.job.id, parallel.capability, 0, compressed.toString("base64"), store);
  const committed = await commitJob(parallel.job.id, parallel.capability, store);
  assert.equal(committed.kind, "parallel");
  assert.deepEqual(await store.pendingIds(10), [review.job.id]);

  await transitionJob(parallel.job.id, ["AWAITING_APPROVAL"], "APPROVED", {}, store);
  await transitionJob(parallel.job.id, ["APPROVED"], "RUNNING", { startedAt: Date.now() }, store);
  const candidate = await createCandidate(parallel.job.id, { model: "gpt-5.6-sol", reasoning: "medium", protocolId: "baseline", protocolVersion: "answer-v1" }, false, store);
  const answer = JSON.stringify({ answer: "Independent answer.", approach: "Read the context.", confidence: "MEDIUM", assumptions: [], evidenceCited: ["S1"], openQuestions: [] });
  await saveCandidateResult(parallel.job.id, candidate.id, { output: OPAQUE_OUTPUT, raw: answer, releasable: false, internalCode: "ANSWER_RECORDED" }, store);
  await publishCandidate(parallel.job.id, candidate.id, store);

  // The answer is retained for the phone and is not what the client can read.
  assert.match((await candidateRaw(parallel.job.id, candidate.id, store)) || "", /Independent answer\./);
  const clientView = await clientResult(parallel.job.id, parallel.capability, store);
  assert.deepEqual(clientView, { pending: false, output: OPAQUE_OUTPUT });

  // The waiting review still owns the outstanding slot and is unaffected.
  assert.equal(await store.get(`sol:client:${client.id}:outstanding`), review.job.id);
});
