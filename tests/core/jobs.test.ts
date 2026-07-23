import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { sha256 } from "../../lib/crypto";
import {
  adminGetJob,
  adminJobEvents,
  adminLiveLog,
  adminRawOutput,
  authenticateClient,
  appendJobEvents,
  clientResult,
  commitJob,
  createJob,
  deleteJob,
  getAuthorizedJob,
  getRetentionDays,
  JobError,
  listClients,
  listRecentJobs,
  readPacket,
  registerClient,
  rejectJob,
  revokeClient,
  saveLiveLog,
  saveTerminalResult,
  setRetentionDays,
  storageSummary,
  transitionJob,
  uploadChunk,
} from "../../lib/jobs";
import { getStore, resetMemoryStoreForTests } from "../../lib/store";

function packetData(packet: string) {
  const raw = Buffer.from(packet);
  const compressed = gzipSync(raw);
  return { raw, compressed, packetHash: sha256(raw), compressedHash: sha256(compressed) };
}

test("registers, lists, uses, and revokes named clients independently", async () => {
  resetMemoryStoreForTests();
  const store = getStore();
  const first = await registerClient("Alice laptop", store);
  const second = await registerClient("Bob desktop", store);

  assert.deepEqual((await listClients(store)).map((client) => client.name).sort(), ["Alice laptop", "Bob desktop"]);
  assert.equal((await authenticateClient(first.token, store))?.name, "Alice laptop");
  assert.ok((await listClients(store)).find((client) => client.id === first.client.id)?.lastUsedAt);

  assert.ok(await revokeClient(first.client.id, store));
  assert.equal(await authenticateClient(first.token, store), null);
  assert.equal((await authenticateClient(second.token, store))?.name, "Bob desktop");
  assert.ok((await listClients(store)).find((client) => client.id === first.client.id)?.revokedAt);
});

test("keeps concurrent client registrations in the client index", async () => {
  resetMemoryStoreForTests();
  const store = getStore();
  await Promise.all(Array.from({ length: 20 }, (_, index) => registerClient(`Computer ${index + 1}`, store)));
  assert.equal((await listClients(store)).length, 20);
});

test.beforeEach(() => resetMemoryStoreForTests());

test("uploads chunks concurrently and commits only the exact packet", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("context\n".repeat(160_000));
  const chunkSize = 512 * 1024;
  const chunks = Array.from({ length: Math.ceil(data.compressed.length / chunkSize) }, (_, index) => data.compressed.subarray(index * chunkSize, (index + 1) * chunkSize));
  const { job, capability } = await createJob(client, {
    packetHash: data.packetHash,
    compressedHash: data.compressedHash,
    compressedBytes: data.compressed.length,
    chunkCount: chunks.length,
  }, store);
  await Promise.all(chunks.map((chunk, index) => uploadChunk(job.id, capability, index, chunk.toString("base64"), store)));
  const committed = await commitJob(job.id, capability, store);
  assert.equal(committed.state, "AWAITING_APPROVAL");
  assert.equal(await readPacket(committed, store), data.raw.toString());
});

test("capabilities cannot cross job boundaries", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("packet");
  const first = await createJob(client, { packetHash: data.packetHash, compressedHash: data.compressedHash, compressedBytes: data.compressed.length, chunkCount: 1 }, store);
  await assert.rejects(() => getAuthorizedJob(first.job.id, "wrong-capability", store), (error: unknown) => error instanceof JobError && error.code === "NOT_FOUND");
});

test("duplicate chunks are idempotent but conflicting duplicates fail", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("packet");
  const { job, capability } = await createJob(client, { packetHash: data.packetHash, compressedHash: data.compressedHash, compressedBytes: data.compressed.length, chunkCount: 1 }, store);
  await uploadChunk(job.id, capability, 0, data.compressed.toString("base64"), store);
  await uploadChunk(job.id, capability, 0, data.compressed.toString("base64"), store);
  await assert.rejects(() => uploadChunk(job.id, capability, 0, Buffer.from("different").toString("base64"), store));
});

test("rejection produces only the terminal token after release", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("packet");
  const { job, capability } = await createJob(client, { packetHash: data.packetHash, compressedHash: data.compressedHash, compressedBytes: data.compressed.length, chunkCount: 1 }, store);
  await uploadChunk(job.id, capability, 0, data.compressed.toString("base64"), store);
  await commitJob(job.id, capability, store);
  await rejectJob(job.id, store);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await clientResult(job.id, capability, store), { pending: false, output: "Bob Regress" });
  const replacement = await createJob(client, {
    packetHash: data.packetHash,
    compressedHash: data.compressedHash,
    compressedBytes: data.compressed.length,
    chunkCount: 1,
  }, store);
  assert.equal(replacement.job.state, "UPLOADING");
});

test("keeps a withheld Codex response phone-only while the client gets only Bob Regress", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("private review boundary");
  const { job, capability } = await createJob(client, {
    packetHash: data.packetHash,
    compressedHash: data.compressedHash,
    compressedBytes: data.compressed.length,
    chunkCount: 1,
  }, store);
  await uploadChunk(job.id, capability, 0, data.compressed.toString("base64"), store);
  await commitJob(job.id, capability, store);
  await transitionJob(job.id, ["AWAITING_APPROVAL"], "APPROVED", {}, store);
  const privateResponse = JSON.stringify({ kind: "review", verdict: "SOUND", assessment: "Private phone-only response", recommendations: [] });
  await saveTerminalResult(job.id, "Bob Regress", privateResponse, true, "FILTERED", store);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(await clientResult(job.id, capability, store), { pending: false, output: "Bob Regress" });
  assert.equal(await adminRawOutput(job.id, store), privateResponse);
});

test("one client cannot open multiple simultaneous jobs", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("packet");
  const input = { packetHash: data.packetHash, compressedHash: data.compressedHash, compressedBytes: data.compressed.length, chunkCount: 1 };
  await createJob(client, input, store);
  await assert.rejects(() => createJob(client, input, store), (error: unknown) => error instanceof JobError && error.code === "OUTSTANDING_JOB");
});

test("retains deduplicated timelines and encrypted live logs", async () => {
  const store = getStore();
  const { client } = await registerClient("test", store);
  const data = packetData("retained packet");
  const { job } = await createJob(client, {
    packetHash: data.packetHash,
    compressedHash: data.compressedHash,
    compressedBytes: data.compressed.length,
    chunkCount: 1,
  }, store);
  await appendJobEvents(job.id, [
    { id: "event:1", at: 2, source: "codex", level: "info", title: "First" },
    { id: "event:1", at: 3, source: "codex", level: "success", title: "Updated" },
  ], store, 60);
  await saveLiveLog(job.id, '{"type":"turn.started"}', 60, store);

  const events = await adminJobEvents(job.id, store);
  assert.equal(events.filter((event) => event.id === "event:1").length, 1);
  assert.equal(events.find((event) => event.id === "event:1")?.title, "Updated");
  assert.equal(await adminLiveLog(job.id, store), '{"type":"turn.started"}');
  assert.ok((await storageSummary(store)).totalBytes > data.compressed.length);
});

test("validates retention and purges all review artifacts", async () => {
  const store = getStore();
  assert.equal(await setRetentionDays(14, store), 14);
  assert.equal(await getRetentionDays(store), 14);
  await assert.rejects(() => setRetentionDays(0, store), (error: unknown) => error instanceof JobError && error.code === "INVALID_RETENTION");

  const { client } = await registerClient("test", store);
  const data = packetData("delete me");
  const { job, capability } = await createJob(client, {
    packetHash: data.packetHash,
    compressedHash: data.compressedHash,
    compressedBytes: data.compressed.length,
    chunkCount: 1,
  }, store);
  await saveLiveLog(job.id, "private log", 60, store);
  await assert.rejects(() => deleteJob(job.id, store), (error: unknown) => error instanceof JobError && error.code === "JOB_ACTIVE");
  await uploadChunk(job.id, capability, 0, data.compressed.toString("base64"), store);
  await commitJob(job.id, capability, store);
  await rejectJob(job.id, store);
  await deleteJob(job.id, store);

  assert.equal(await adminGetJob(job.id, store), null);
  assert.deepEqual(await adminJobEvents(job.id, store), []);
  assert.equal(await adminLiveLog(job.id, store), null);
  assert.deepEqual(await listRecentJobs(store), []);
  assert.equal((await storageSummary(store)).jobs, 0);
});
