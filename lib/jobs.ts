import { gunzipSync } from "node:zlib";
import { config } from "@/lib/config";
import { decryptBuffer, decryptText, encryptBuffer, encryptText, randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { OPAQUE_OUTPUT } from "@/lib/gate";
import { getStore, type Store } from "@/lib/store";
import type { ClientRecord, JobState, ReviewEvent, ReviewJob } from "@/lib/types";

const jobKey = (id: string) => `sol:job:${id}`;
const chunkKey = (id: string, index: number) => `sol:job:${id}:chunk:${index}`;
const resultKey = (id: string) => `sol:job:${id}:result`;
const rawKey = (id: string) => `sol:job:${id}:raw`;
const eventsKey = (id: string) => `sol:job:${id}:events`;
const liveKey = (id: string) => `sol:job:${id}:live`;
const clientKey = (hash: string) => `sol:client:${hash}`;
const clientIdKey = (id: string) => `sol:client-id:${id}`;
const outstandingKey = (clientId: string) => `sol:client:${clientId}:outstanding`;
const retentionKey = "sol:settings:retention-days";

export class JobError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function now(): number {
  return Date.now();
}

function ttlFor(job: ReviewJob): number {
  return Math.max(1, Math.ceil((job.expiresAt - now()) / 1000));
}

export async function getRetentionDays(store: Store = getStore()): Promise<number> {
  const configured = await store.get<number>(retentionKey);
  if (configured && Number.isInteger(configured) && configured >= 1 && configured <= 30) return configured;
  return Math.max(1, Math.min(30, Math.round(config.resultTtlSeconds / 86_400)));
}

export async function setRetentionDays(days: number, store: Store = getStore()): Promise<number> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new JobError("INVALID_RETENTION");
  await store.set(retentionKey, days, 365 * 24 * 60 * 60);
  const ttlSeconds = days * 24 * 60 * 60;
  const ids = await store.recentIds(100);
  await Promise.all(ids.map(async (id) => {
    const job = await store.get<ReviewJob>(jobKey(id));
    if (!job || !["COMPLETE_REVIEW", "COMPLETE_OPAQUE", "REJECTED", "EXPIRED"].includes(job.state)) return;
    const retained = { ...job, expiresAt: now() + ttlSeconds * 1_000, updatedAt: now() };
    await store.set(jobKey(id), retained, ttlSeconds);
    const keys = [resultKey(id), rawKey(id), eventsKey(id), liveKey(id), ...Array.from({ length: job.chunkCount }, (_, index) => chunkKey(id, index))];
    await Promise.all(keys.map(async (key) => {
      const value = await store.get<unknown>(key);
      if (value !== null) await store.set(key, value, ttlSeconds);
    }));
  }));
  return days;
}

async function retentionSeconds(store: Store): Promise<number> {
  return (await getRetentionDays(store)) * 24 * 60 * 60;
}

export async function appendJobEvents(id: string, events: ReviewEvent[], store: Store = getStore(), ttlSeconds?: number): Promise<void> {
  if (!events.length) return;
  const key = eventsKey(id);
  const lockKey = `${key}:lock`;
  let locked = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    locked = await store.setIfAbsent(lockKey, true, 10);
    if (locked) break;
    await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
  }
  if (!locked) throw new JobError("EVENT_LOCKED");
  try {
    const encrypted = await store.get<string>(key);
    const existing = encrypted ? JSON.parse(decryptText(encrypted, key)) as ReviewEvent[] : [];
    const merged = new Map(existing.map((event) => [event.id, event]));
    for (const event of events) merged.set(event.id, event);
    const value = [...merged.values()].sort((left, right) => left.at - right.at).slice(-1_000);
    await store.set(key, encryptText(JSON.stringify(value), key), ttlSeconds || await retentionSeconds(store));
  } finally {
    await store.del(lockKey);
  }
}

export async function adminJobEvents(id: string, store: Store = getStore()): Promise<ReviewEvent[]> {
  const key = eventsKey(id);
  const encrypted = await store.get<string>(key);
  if (!encrypted) return [];
  try {
    return JSON.parse(decryptText(encrypted, key)) as ReviewEvent[];
  } catch {
    return [];
  }
}

export async function saveLiveLog(id: string, value: string, ttlSeconds: number, store: Store = getStore()): Promise<void> {
  const key = liveKey(id);
  await store.set(key, encryptText(value.slice(-500_000), key), ttlSeconds);
}

export async function adminLiveLog(id: string, store: Store = getStore()): Promise<string | null> {
  const key = liveKey(id);
  const encrypted = await store.get<string>(key);
  return encrypted ? decryptText(encrypted, key) : null;
}

export async function registerClient(name: string, store: Store = getStore()): Promise<{ client: ClientRecord; token: string }> {
  const token = randomToken();
  const tokenHash = sha256(token);
  const client: ClientRecord = {
    id: randomToken(16),
    name: name.trim().slice(0, 80) || "Claude Code",
    tokenHash,
    createdAt: now(),
  };
  const ttl = 365 * 24 * 60 * 60;
  await Promise.all([
    store.set(clientKey(tokenHash), client, ttl),
    store.set(clientIdKey(client.id), client, ttl),
    store.addClientIndex(client.id, client.createdAt),
  ]);
  return { client, token };
}

export async function listClients(store: Store = getStore()): Promise<ClientRecord[]> {
  const ids = await store.clientIds(200);
  const records = await Promise.all(ids.map((id) => store.get<ClientRecord>(clientIdKey(id))));
  return records.filter((client): client is ClientRecord => Boolean(client)).sort((left, right) => right.createdAt - left.createdAt);
}

export async function revokeClient(id: string, store: Store = getStore()): Promise<ClientRecord | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(id)) return null;
  const client = await store.get<ClientRecord>(clientIdKey(id));
  if (!client) return null;
  const revoked = { ...client, revokedAt: client.revokedAt || now() };
  const ttl = 365 * 24 * 60 * 60;
  await Promise.all([
    store.set(clientKey(client.tokenHash), revoked, ttl),
    store.set(clientIdKey(client.id), revoked, ttl),
  ]);
  return revoked;
}

export async function authenticateClient(token: string, store: Store = getStore()): Promise<ClientRecord | null> {
  if (!token || token.length > 512) return null;
  const hash = sha256(token);
  const configured = (process.env.SOL_CLIENT_TOKEN_HASHES || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.some((candidate) => safeEqual(candidate, hash))) {
    return { id: `env-${hash.slice(0, 12)}`, name: "Configured client", tokenHash: hash, createdAt: 0 };
  }
  const client = await store.get<ClientRecord>(clientKey(hash));
  if (!client || client.revokedAt) return null;
  if (!client.lastUsedAt || now() - client.lastUsedAt > 60_000) {
    const updated = { ...client, lastUsedAt: now() };
    const ttl = 365 * 24 * 60 * 60;
    await Promise.all([
      store.set(clientKey(hash), updated, ttl),
      store.set(clientIdKey(client.id), updated, ttl),
    ]);
    return updated;
  }
  return client;
}

export async function createJob(
  client: ClientRecord,
  input: { packetHash: string; compressedHash: string; compressedBytes: number; chunkCount: number },
  store: Store = getStore(),
): Promise<{ job: ReviewJob; capability: string }> {
  if (!/^[a-f0-9]{64}$/.test(input.packetHash) || !/^[a-f0-9]{64}$/.test(input.compressedHash)) throw new JobError("INVALID_HASH");
  if (!Number.isSafeInteger(input.compressedBytes) || input.compressedBytes < 1 || input.compressedBytes > config.maxPacketBytes) throw new JobError("INVALID_SIZE");
  const expectedChunks = Math.ceil(input.compressedBytes / config.maxChunkBytes);
  if (input.chunkCount !== expectedChunks || expectedChunks > 64) throw new JobError("INVALID_CHUNKS");

  const id = randomToken(24);
  if (!(await store.setIfAbsent(outstandingKey(client.id), id, config.jobTtlSeconds))) throw new JobError("OUTSTANDING_JOB");

  const capability = randomToken();
  const createdAt = now();
  const job: ReviewJob = {
    id,
    clientId: client.id,
    clientTokenHash: sha256(capability),
    packetHash: input.packetHash,
    compressedHash: input.compressedHash,
    compressedBytes: input.compressedBytes,
    chunkCount: input.chunkCount,
    uploadedChunks: 0,
    state: "UPLOADING",
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + config.jobTtlSeconds * 1000,
  };
  await store.set(jobKey(id), job, config.jobTtlSeconds);
  await store.addRecent(id, createdAt);
  await appendJobEvents(id, [{ id: "system:created", at: createdAt, source: "system", level: "info", title: "Review requested", message: `${input.compressedBytes.toLocaleString()} compressed bytes received.` }], store, config.jobTtlSeconds).catch(() => undefined);
  return { job, capability };
}

export async function getAuthorizedJob(id: string, capability: string, store: Store = getStore()): Promise<ReviewJob> {
  const job = await store.get<ReviewJob>(jobKey(id));
  if (!job || !safeEqual(job.clientTokenHash, sha256(capability || ""))) throw new JobError("NOT_FOUND");
  if (job.expiresAt <= now() && !job.state.startsWith("COMPLETE")) throw new JobError("EXPIRED");
  return job;
}

export async function uploadChunk(id: string, capability: string, index: number, encoded: string, store: Store = getStore()): Promise<void> {
  const job = await getAuthorizedJob(id, capability, store);
  if (job.state !== "UPLOADING" || !Number.isSafeInteger(index) || index < 0 || index >= job.chunkCount) throw new JobError("INVALID_CHUNK");
  const chunk = Buffer.from(encoded, "base64");
  if (!chunk.length || chunk.length > config.maxChunkBytes) throw new JobError("INVALID_CHUNK");
  const key = chunkKey(id, index);
  const added = await store.setIfAbsent(key, encryptBuffer(chunk, key), ttlFor(job));
  if (!added) {
    const existing = await store.get<string>(key);
    if (!existing || !decryptBuffer(existing, key).equals(chunk)) throw new JobError("CHUNK_CONFLICT");
    return;
  }
}

async function compressedPacket(job: ReviewJob, store: Store): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (let index = 0; index < job.chunkCount; index += 1) {
    const key = chunkKey(job.id, index);
    const encrypted = await store.get<string>(key);
    if (!encrypted) throw new JobError("MISSING_CHUNK");
    chunks.push(decryptBuffer(encrypted, key));
  }
  const compressed = Buffer.concat(chunks);
  if (compressed.length !== job.compressedBytes || sha256(compressed) !== job.compressedHash) throw new JobError("PACKET_INTEGRITY");
  return compressed;
}

export async function readPacket(job: ReviewJob, store: Store = getStore()): Promise<string> {
  const packet = gunzipSync(await compressedPacket(job, store), { maxOutputLength: config.maxPacketBytes });
  if (!packet.length || packet.length > config.maxPacketBytes || sha256(packet) !== job.packetHash) throw new JobError("PACKET_INTEGRITY");
  return packet.toString("utf8");
}

export async function commitJob(id: string, capability: string, store: Store = getStore()): Promise<ReviewJob> {
  const job = await getAuthorizedJob(id, capability, store);
  if (job.state !== "UPLOADING") throw new JobError("INCOMPLETE_UPLOAD");
  await readPacket(job, store);
  const next: ReviewJob = { ...job, uploadedChunks: job.chunkCount, state: "AWAITING_APPROVAL", updatedAt: now() };
  if (!(await store.transition(jobKey(id), ["UPLOADING"], next, ttlFor(next)))) throw new JobError("RACE");
  await store.addPending(id, job.createdAt);
  await appendJobEvents(id, [{ id: "system:awaiting-approval", at: next.updatedAt, source: "system", level: "info", title: "Packet verified", message: "Integrity checks passed. Waiting for phone approval." }], store, ttlFor(next)).catch(() => undefined);
  return next;
}

export async function adminGetJob(id: string, store: Store = getStore()): Promise<ReviewJob | null> {
  return store.get<ReviewJob>(jobKey(id));
}

export async function listPendingJobs(store: Store = getStore()): Promise<ReviewJob[]> {
  const ids = await store.pendingIds(25);
  const jobs = await Promise.all(ids.map((id) => store.get<ReviewJob>(jobKey(id))));
  const active: ReviewJob[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const job = jobs[index];
    if (job && job.state === "AWAITING_APPROVAL" && job.expiresAt > now()) active.push(job);
    else await store.removePending(ids[index]);
  }
  return active;
}

export async function listRecentJobs(store: Store = getStore()): Promise<ReviewJob[]> {
  const ids = await store.recentIds(100);
  const jobs = await Promise.all(ids.map((id) => store.get<ReviewJob>(jobKey(id))));
  const active: ReviewJob[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const job = jobs[index];
    if (job && job.expiresAt > now()) active.push(job);
    else await store.removeRecent(ids[index]);
  }
  return active;
}

export async function transitionJob(id: string, expected: JobState[], state: JobState, patch: Partial<ReviewJob> = {}, store: Store = getStore()): Promise<ReviewJob> {
  const job = await store.get<ReviewJob>(jobKey(id));
  if (!job || !expected.includes(job.state)) throw new JobError("INVALID_STATE");
  const next: ReviewJob = { ...job, ...patch, state, updatedAt: now() };
  if (!(await store.transition(jobKey(id), expected, next, ttlFor(next)))) throw new JobError("RACE");
  if (state !== "AWAITING_APPROVAL") await store.removePending(id);
  const eventTitle = state === "COMPLETE_OPAQUE"
    ? "Review was not released"
    : state.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  await appendJobEvents(id, [{ id: `state:${state}`, at: next.updatedAt, source: "system", level: state === "RUNNING" ? "success" : "info", title: eventTitle }], store, ttlFor(next)).catch(() => undefined);
  return next;
}

async function retainPacketChunks(job: ReviewJob, ttlSeconds: number, store: Store): Promise<void> {
  for (let index = 0; index < job.chunkCount; index += 1) {
    const key = chunkKey(job.id, index);
    const encrypted = await store.get<string>(key);
    if (encrypted) await store.set(key, encrypted, ttlSeconds);
  }
}

function gateEvent(internalCode: string, opaque: boolean): Pick<ReviewEvent, "title" | "message"> {
  const outcomes: Record<string, Pick<ReviewEvent, "title" | "message">> = {
    RELEASED: { title: "Review passed every release check", message: "The complete Codex review is ready to read." },
    MODEL_WITHHELD: { title: "Codex withheld the review", message: "Codex selected the no-review response. Its operator explanation is retained on this phone." },
    GATE_REFUSAL_LANGUAGE: { title: "Wrapper blocked the response", message: "The response contained refusal or non-assistance language." },
    GATE_SECRET: { title: "Wrapper blocked the response", message: "The response matched a protected credential or secret pattern." },
    GATE_INVALID_SCHEMA: { title: "Wrapper blocked the response", message: "The final response did not match the required structured format." },
    GATE_EMPTY: { title: "Wrapper blocked the response", message: "Codex returned no final response." },
    GATE_OVERSIZE: { title: "Wrapper blocked the response", message: "The final response exceeded the maximum retained size." },
    WORKER_REJECTED: { title: "Worker rejected the run", message: "The isolated run failed an execution, event-integrity, or secret-leak check." },
    START_FAILED: { title: "Review failed to start", message: "The isolated Codex review could not be started." },
    POLL_FAILED: { title: "Review became unavailable", message: "The running review could not be recovered or completed." },
    AUTH_UNAVAILABLE: { title: "Codex authentication unavailable", message: "The authenticated Codex snapshot was unavailable." },
  };
  return outcomes[internalCode] || (opaque
    ? { title: "Review was not released", message: `Unclassified outcome: ${internalCode}.` }
    : outcomes.RELEASED);
}

export async function saveTerminalResult(id: string, output: string, raw: string, opaque: boolean, internalCode: string, store: Store = getStore()): Promise<ReviewJob> {
  const job = await store.get<ReviewJob>(jobKey(id));
  if (!job) throw new JobError("NOT_FOUND");
  const completedAt = now();
  const retainedSeconds = await retentionSeconds(store);
  const releaseAt = Math.max(completedAt, (job.startedAt || completedAt) + config.minReleaseDelayMs + Math.floor(Math.random() * config.releaseJitterMs));
  await store.set(resultKey(id), encryptText(opaque ? OPAQUE_OUTPUT : output, resultKey(id)), retainedSeconds);
  await store.set(rawKey(id), encryptText(raw, rawKey(id)), retainedSeconds);
  await retainPacketChunks(job, retainedSeconds, store);
  const next = await transitionJob(id, ["RUNNING", "FILTERING", "APPROVED", "CLAIMED"], opaque ? "COMPLETE_OPAQUE" : "COMPLETE_REVIEW", {
    completedAt,
    releaseAt,
    internalCode,
    expiresAt: completedAt + retainedSeconds * 1000,
  }, store);
  const outcome = gateEvent(internalCode, opaque);
  await appendJobEvents(id, [
    { id: "gate:complete", at: completedAt, source: "gate", level: opaque ? "warning" : "success", ...outcome },
    { id: "result:stored", at: completedAt, source: "result", level: "success", title: "Review retained", message: `Stored for ${Math.round(retainedSeconds / 86_400)} day(s).` },
  ], store, retainedSeconds).catch(() => undefined);
  await store.del(outstandingKey(job.clientId));
  return next;
}

export async function rejectJob(id: string, store: Store = getStore()): Promise<void> {
  const completedAt = now();
  const retainedSeconds = await retentionSeconds(store);
  const job = await transitionJob(id, ["AWAITING_APPROVAL"], "REJECTED", { completedAt, releaseAt: completedAt + config.minReleaseDelayMs, expiresAt: completedAt + retainedSeconds * 1000 }, store);
  await store.set(resultKey(id), encryptText(OPAQUE_OUTPUT, resultKey(id)), retainedSeconds);
  await retainPacketChunks(job, retainedSeconds, store);
  await appendJobEvents(id, [{ id: "gate:rejected", at: completedAt, source: "gate", level: "warning", title: "Packet rejected on phone" }], store, retainedSeconds).catch(() => undefined);
  await store.del(outstandingKey(job.clientId));
}

export async function clientResult(id: string, capability: string, store: Store = getStore()): Promise<{ pending: true } | { pending: false; output: string }> {
  const job = await getAuthorizedJob(id, capability, store);
  const terminal = ["COMPLETE_REVIEW", "COMPLETE_OPAQUE", "REJECTED", "EXPIRED"].includes(job.state);
  if (!terminal || (job.releaseAt && job.releaseAt > now())) return { pending: true };
  const encrypted = await store.get<string>(resultKey(id));
  if (!encrypted) return { pending: false, output: OPAQUE_OUTPUT };
  return { pending: false, output: decryptText(encrypted, resultKey(id)) };
}

export async function adminRawOutput(id: string, store: Store = getStore()): Promise<string | null> {
  const encrypted = await store.get<string>(rawKey(id));
  return encrypted ? decryptText(encrypted, rawKey(id)) : null;
}

export async function adminResult(id: string, store: Store = getStore()): Promise<string | null> {
  const encrypted = await store.get<string>(resultKey(id));
  return encrypted ? decryptText(encrypted, resultKey(id)) : null;
}

export async function deleteJob(id: string, store: Store = getStore()): Promise<void> {
  const job = await store.get<ReviewJob>(jobKey(id));
  if (!job) throw new JobError("NOT_FOUND");
  if (!["COMPLETE_REVIEW", "COMPLETE_OPAQUE", "REJECTED", "EXPIRED"].includes(job.state)) throw new JobError("JOB_ACTIVE");
  await store.del(
    jobKey(id), resultKey(id), rawKey(id), eventsKey(id), liveKey(id), `${eventsKey(id)}:lock`,
    `sol:job:${id}:poll-lock`, outstandingKey(job.clientId),
    ...Array.from({ length: job.chunkCount }, (_, index) => chunkKey(id, index)),
  );
  await store.removePending(id);
  await store.removeRecent(id);
}

export async function storageSummary(store: Store = getStore()): Promise<{ retentionDays: number; jobs: number; packetBytes: number; eventBytes: number; rawBytes: number; totalBytes: number }> {
  const jobs = await listRecentJobs(store);
  const payloads = await Promise.all(jobs.map(async (job) => {
    const [events, raw, result, live] = await Promise.all([adminJobEvents(job.id, store), adminRawOutput(job.id, store), adminResult(job.id, store), adminLiveLog(job.id, store)]);
    return {
      packet: job.compressedBytes,
      events: Buffer.byteLength(JSON.stringify(events), "utf8"),
      raw: Buffer.byteLength(raw || "", "utf8") + Buffer.byteLength(result || "", "utf8") + Buffer.byteLength(live || "", "utf8"),
    };
  }));
  const packetBytes = payloads.reduce((sum, item) => sum + item.packet, 0);
  const eventBytes = payloads.reduce((sum, item) => sum + item.events, 0);
  const rawBytes = payloads.reduce((sum, item) => sum + item.raw, 0);
  return { retentionDays: await getRetentionDays(store), jobs: jobs.length, packetBytes, eventBytes, rawBytes, totalBytes: packetBytes + eventBytes + rawBytes };
}
